const User = require("../models/User");
const Client = require("../models/Client");
const Notification = require("../models/Notification");
const Training = require("../models/Training");
const { hashPassword } = require("../helpers/auth");
const { issuePasswordEmail } = require("../services/authService");
const { ok, fail } = require("../helpers/response");
const {
  CREDIT_COSTS, consumeClientCredits,
  ensureClientEntitlement, assertLifetimeQuota,
  assertSubscriptionActive, SUBSCRIPTION_EXPIRED_MESSAGE,
} = require("../helpers/credits");

// Issue 1 vs Issue 2: expiry → 402 (Payment Required), quota → 403 (Forbidden).
const quotaErrorStatus = (message) =>
  message === SUBSCRIPTION_EXPIRED_MESSAGE ? 402 : 403;

// Task 2 (user lifetime): one-time backfill + lifetime check + permanent
// increment. Returns an error string if the subscription is expired (Issue 1)
// or the lifetime user quota would be exceeded, else null.
// `currentActiveUsers` seeds the backfill.
const enforceUserLifetime = async (client, clientId, currentActiveUsers, addCount) => {
  // Issue 1: expired subscription cannot add users regardless of remaining quota.
  const expiredError = assertSubscriptionActive(client);
  if (expiredError) {
    return expiredError;
  }
  if (!client.quotaInitialized) {
    const publishedCount = await Training.countDocuments({ clientId, "payload.status": "approved" });
    await ensureClientEntitlement(client, {
      training: publishedCount,
      session: Number(client.sessions || 0),
      user: Number(currentActiveUsers || 0),
    });
  }
  return assertLifetimeQuota(client, "user", addCount);
};
const { notifyUserIds } = require("../helpers/notifications");
const { isValidEmail } = require("../helpers/validation");
const {
  areSamePermissions,
  buildAllowedFromPermissions,
  filterPermissionArrayForRequester,
  getUnauthorizedPermissionKeys,
  getRoleDefinitions,
  getRoleDefinitionById,
  normalizePermissionArray,
  resolveUserAccess,
} = require("../helpers/permissions");
const { getTenantClientId, getTenantSetting, syncClientMetrics } = require("../helpers/tenant");

const sanitizeUserRecord = (user, roleDefinitions, options = {}) => {
  const access = resolveUserAccess(user, roleDefinitions);

  return {
    id: user.appId,
    name: user.name,
    email: user.email,
    role: user.role,
    roleName: access.roleName,
    status: user.status,
    trainings: Number(user.trainings || 0),
    lastActive: user.lastActive || "Today",
    permission: access.permission,
    allowed: access.allowed,
    permissionSource: user.useRoleDefaults === false ? "custom" : "role",
    isPrimaryAdmin: Boolean(options.primaryAdminUserId && user.appId === options.primaryAdminUserId),
  };
};

const paginate = (records, query) => {
  const limit = Math.max(1, Number(query.limit || 10));
  const pageNo = Math.max(1, Number(query.pageNo || 1));
  const count = records.length;
  const totalPages = Math.max(1, Math.ceil(count / limit));
  const currentPage = Math.min(pageNo, totalPages);
  const startIndex = (currentPage - 1) * limit;

  return {
    count,
    totalPages,
    record: records.slice(startIndex, startIndex + limit),
    pagination: Array.from({ length: totalPages }, (_, index) => index + 1),
  };
};

const contains = (value, query) => String(value || "").toLowerCase().includes(String(query || "").trim().toLowerCase());
const applyUserListControls = (records, queryParams, options = {}) => {
  const query = String(queryParams.query || "").trim();
  const status = String(queryParams.status || "all").trim().toLowerCase();
  const role = String(queryParams.role || "all").trim();
  const sortBy = String(queryParams.sortBy || "name").trim();

  const filtered = records.filter((user) => {
    const matchesQuery = [user.name, user.email, user.role, user.roleName, user.status].some((value) => contains(value, query));
    const matchesStatus = status === "all" || String(user.status || "").toLowerCase() === status;
    const matchesRole = options.skipRoleFilter || role === "all" || String(user.role || "") === role;
    return matchesQuery && matchesStatus && matchesRole;
  });

  return [...filtered].sort((left, right) => {
    if (sortBy === "role") {
      return String(left.roleName || left.role || "").localeCompare(String(right.roleName || right.role || ""));
    }
    if (sortBy === "status") {
      return String(left.status || "").localeCompare(String(right.status || "")) || String(left.name || "").localeCompare(String(right.name || ""));
    }
    if (sortBy === "activity") {
      return String(right.lastActive || "").localeCompare(String(left.lastActive || ""));
    }
    return String(left.name || "").localeCompare(String(right.name || ""));
  });
};
const normalizeValue = (value) => String(value || "").trim();
const isSessionForTrainee = (session, trainee) => {
  const traineeEmail = normalizeValue(trainee.email).toLowerCase();
  const traineeName = normalizeValue(trainee.name).toLowerCase();
  const sessionEmail = normalizeValue(session?.learnerEmail || session?.ssoId).toLowerCase();
  const sessionName = normalizeValue(session?.learnerName).toLowerCase();

  return Boolean((traineeEmail && sessionEmail && traineeEmail === sessionEmail) || (traineeName && sessionName && traineeName === sessionName));
};

const buildAssignedTrainingCounts = (trainees, trainings) => {
  const counts = new Map(trainees.map((trainee) => [trainee.appId, 0]));

  trainings.forEach((training) => {
    const sessions = Array.isArray(training?.payload?.sessions) ? training.payload.sessions : [];
    trainees.forEach((trainee) => {
      if (sessions.some((session) => isSessionForTrainee(session, trainee))) {
        counts.set(trainee.appId, (counts.get(trainee.appId) || 0) + 1);
      }
    });
  });

  return counts;
};

const parseSessionDate = (value) => {
  const parsed = new Date(String(value || "").trim());
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const getStoredRoleDefinitions = async (clientId) => getRoleDefinitions(await getTenantSetting(clientId, "rolePermissions"));

const getEffectiveRequester = (req) => ({
  ...(req.user || {}),
  permission: req.access?.permission || req.user?.permission || [],
  allowed: req.access?.allowed || req.user?.allowed || [],
});

const buildAccessFromPayload = (values, roleDefinitions, requester, preservePermission = []) => {
  const roleDefinition = getRoleDefinitionById(values.role, roleDefinitions);
  const defaultPermission = filterPermissionArrayForRequester(requester, roleDefinition?.permission || []);
  const customPermission = filterPermissionArrayForRequester(requester, normalizePermissionArray(values.permission));
  const preservedPermission = getUnauthorizedPermissionKeys(requester, preservePermission);
  const permission = Array.from(new Set([...(customPermission.length ? customPermission : defaultPermission), ...preservedPermission]));
  const useRoleDefaults = areSamePermissions(permission, defaultPermission);

  return {
    roleName: roleDefinition?.roleName || "User",
    permission: useRoleDefaults ? defaultPermission : permission,
    allowed: useRoleDefaults ? roleDefinition?.allowed || [] : buildAllowedFromPermissions(permission),
    useRoleDefaults,
  };
};

const hasAccessPayload = (values) => Object.prototype.hasOwnProperty.call(values, "role") || Array.isArray(values.permission);

const hasPermissionOrRoleChange = (values, targetUser) => {
  const requestedRole = String(values.role || targetUser.role);
  const roleChanged = requestedRole !== targetUser.role;
  const permissionChanged = Array.isArray(values.permission) && !areSamePermissions(values.permission, targetUser.permission);

  return roleChanged || permissionChanged;
};

const validateGrantablePermissionPayload = (requester, permission) => {
  const unauthorizedPermission = getUnauthorizedPermissionKeys(requester, permission);

  if (!unauthorizedPermission.length) {
    return null;
  }

  return {
    permission: "Remove restricted permissions before saving.",
  };
};

const validateGrantablePermissionChange = (requester, permission, existingPermission = []) => {
  const existingKeys = new Set(normalizePermissionArray(existingPermission));
  const unauthorizedPermission = getUnauthorizedPermissionKeys(requester, permission).filter((item) => !existingKeys.has(item));

  if (!unauthorizedPermission.length) {
    return null;
  }

  return {
    permission: "Remove restricted permissions before saving.",
  };
};

const getEditableRole = (roleId, roleDefinitions) =>
  roleDefinitions.find((role) => role.id === String(roleId || "").trim()) || null;

const validateUser = (values, existingUsers, currentId) => {
  const errors = {};

  if (!String(values.name || "").trim()) {
    errors.name = "Name is required.";
  }

  if (!isValidEmail(values.email)) {
    errors.email = "Use a valid email address.";
  }

  const duplicate = existingUsers.find(
    (user) => String(user.email).toLowerCase() === String(values.email).toLowerCase() && user.appId !== currentId,
  );

  if (duplicate) {
    errors.email = "Email already exists.";
  }

  return errors;
};

const validateTrainee = (values, existingUsers, currentId) => {
  const errors = {};

  if (!String(values.name || "").trim()) {
    errors.name = "Name is required.";
  }

  if (!isValidEmail(values.email)) {
    errors.email = "Use a valid email address.";
  }

  const duplicate = existingUsers.find(
    (user) => String(user.email).toLowerCase() === String(values.email).toLowerCase() && user.appId !== currentId,
  );

  if (duplicate) {
    errors.email = "Email already exists.";
  }

  return errors;
};

const buildUserDbFilter = (clientId, queryParams, baseRoleFilter) => {
  const filter = { clientId, ...baseRoleFilter };
  const query = String(queryParams.query || "").trim();
  const status = String(queryParams.status || "all").trim().toLowerCase();
  const role = String(queryParams.role || "all").trim();

  if (query) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: escaped, $options: "i" } },
      { email: { $regex: escaped, $options: "i" } },
    ];
  }
  if (status !== "all") filter.status = status;
  if (role !== "all" && !baseRoleFilter.role) filter.role = role;
  return filter;
};

const buildUserDbSort = (sortBy) => {
  if (sortBy === "role") return { roleName: 1, name: 1 };
  if (sortBy === "status") return { status: 1, name: 1 };
  if (sortBy === "activity") return { lastActive: -1 };
  return { name: 1 };
};

const list = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const limit = Math.max(1, Number(req.query.limit || 10));
  const pageNo = Math.max(1, Number(req.query.pageNo || 1));
  const skip = (pageNo - 1) * limit;
  const sortBy = String(req.query.sortBy || "name").trim();

  const filter = buildUserDbFilter(clientId, req.query, { role: { $nin: ["super_admin", "trainee"] } });
  const sort = buildUserDbSort(sortBy);

  const [roleDefinitions, client, users, count] = await Promise.all([
    getStoredRoleDefinitions(clientId),
    Client.findOne({ appId: clientId }, { clientAdminUserId: 1 }).lean(),
    // sanitizeUserRecord never reads `image` — exclude it so this list read
    // doesn't drag every user's base64 avatar over the wire just to discard it.
    User.find(filter, { image: 0 }).sort(sort).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  const record = users.map((user) =>
    sanitizeUserRecord(user, roleDefinitions, { primaryAdminUserId: client?.clientAdminUserId }),
  );
  const totalPages = Math.max(1, Math.ceil(count / limit));
  return ok(res, "Users loaded.", {
    count,
    totalPages,
    record,
    pagination: Array.from({ length: totalPages }, (_, i) => i + 1),
  });
};

const listTrainees = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const limit = Math.max(1, Number(req.query.limit || 10));
  const pageNo = Math.max(1, Number(req.query.pageNo || 1));
  const skip = (pageNo - 1) * limit;
  const sortBy = String(req.query.sortBy || "name").trim();

  const filter = buildUserDbFilter(clientId, req.query, { role: "trainee" });
  const sort = buildUserDbSort(sortBy);

  const [roleDefinitions, trainees, count] = await Promise.all([
    getStoredRoleDefinitions(clientId),
    User.find(filter, { image: 0 }).sort(sort).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  // Build training counts only for the paginated trainees (not all)
  let assignedTrainingCounts = new Map();
  if (trainees.length) {
    const trainings = await Training.find({ clientId }, { "payload.sessions": 1 }).lean();
    assignedTrainingCounts = buildAssignedTrainingCounts(trainees, trainings);
  }

  const record = trainees.map((user) => ({
    ...sanitizeUserRecord(user, roleDefinitions),
    trainings: assignedTrainingCounts.get(user.appId) || 0,
  }));
  const totalPages = Math.max(1, Math.ceil(count / limit));
  return ok(res, "Trainees loaded.", {
    count,
    totalPages,
    record,
    pagination: Array.from({ length: totalPages }, (_, i) => i + 1),
  });
};

const getTraineeSessions = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const roleDefinitions = await getStoredRoleDefinitions(clientId);
  const trainee = await User.findOne({ appId: req.params.id, clientId, role: "trainee" }).lean();

  if (!trainee) {
    return fail(res, 404, "Trainee not found.");
  }

  const trainings = await Training.find(
    { clientId },
    { appId: 1, "payload.title": 1, "payload.type": 1, "payload.audience": 1, "payload.sessions": 1 },
  ).lean();

  const sessions = trainings
    .flatMap((record) => {
      const trainingTitle = normalizeValue(record?.payload?.title) || "Untitled Training";
      const trainingType = normalizeValue(record?.payload?.type) || "";
      const trainingAudience = normalizeValue(record?.payload?.audience) || "";
      const items = Array.isArray(record?.payload?.sessions) ? record.payload.sessions : [];

      return items
        .filter((session) => isSessionForTrainee(session, trainee))
        .map((session, index) => ({
          id: normalizeValue(session?.id) || `launch-session-${record.appId}-${index}`,
          trainingId: normalizeValue(record?.appId),
          trainingTitle,
          trainingType,
          trainingAudience,
          ssoId: normalizeValue(session?.ssoId) || normalizeValue(session?.learnerEmail) || normalizeValue(trainee.email),
          learnerName: normalizeValue(session?.learnerName) || normalizeValue(trainee.name),
          learnerEmail: normalizeValue(session?.learnerEmail) || normalizeValue(trainee.email),
          status: normalizeValue(session?.status) || "not-started",
          timeSpent: normalizeValue(session?.timeSpent) || "0m 00s",
          slidesViewed: Number(session?.slidesViewed || 0),
          totalSlides: Number(session?.totalSlides || 0),
          viewedSlideIds: Array.isArray(session?.viewedSlideIds) ? session.viewedSlideIds : [],
          score: typeof session?.score === "number" ? session.score : null,
          startedAt: normalizeValue(session?.startedAt) || null,
          completedAt: normalizeValue(session?.completedAt) || null,
          correctAnswers: Number(session?.correctAnswers || 0),
          totalQuestions: Number(session?.totalQuestions || 0),
          progressPercent: typeof session?.progressPercent === "number" ? session.progressPercent : undefined,
          mode: normalizeValue(session?.mode) || "public",
          askHistory: Array.isArray(session?.askTranscripts)
            ? session.askTranscripts
            : Array.isArray(session?.askHistory)
              ? session.askHistory
              : [],
          attemptNo: Number(session?.attemptNo || 1),
          maxAttempts: Number(session?.maxAttempts || 0),
          isRetake: Boolean(session?.isRetake),
          bestScore: typeof session?.bestScore === "number" ? session.bestScore : null,
          latestScore: typeof session?.latestScore === "number" ? session.latestScore : (typeof session?.score === "number" ? session.score : null),
          resetByAdmin: Boolean(session?.resetByAdmin),
          resetAt: normalizeValue(session?.resetAt) || null,
          resetBy: normalizeValue(session?.resetBy) || null,
          proctoringReport: session?.proctoringReport || null,
        }));
    })
    .sort((left, right) => parseSessionDate(right.startedAt || right.completedAt) - parseSessionDate(left.startedAt || left.completedAt));

  const scoreRecords = sessions.filter((session) => typeof session.score === "number");
  const summary = {
    totalSessions: sessions.length,
    completedSessions: sessions.filter((session) => String(session.status).toLowerCase() === "completed").length,
    inProgressSessions: sessions.filter((session) => String(session.status).toLowerCase() === "in-progress").length,
    notStartedSessions: sessions.filter((session) => String(session.status).toLowerCase() === "not-started").length,
    averageScore: scoreRecords.length
      ? Math.round(scoreRecords.reduce((sum, session) => sum + Number(session.score || 0), 0) / scoreRecords.length)
      : null,
  };

  return ok(res, "Trainee sessions loaded.", {
    trainee: sanitizeUserRecord(trainee, roleDefinitions),
    sessions,
    summary,
  });
};

const reopenTraineeSessionAttempt = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const trainee = await User.findOne({ appId: req.params.id, clientId, role: "trainee" }).lean();

  if (!trainee) {
    return fail(res, 404, "Trainee not found.");
  }

  const training = await Training.findOne({ appId: req.params.trainingId, clientId });

  if (!training) {
    return fail(res, 404, "Training not found.");
  }

  const sessions = Array.isArray(training.payload?.sessions) ? [...training.payload.sessions] : [];
  const sessionIndex = sessions.findIndex((session) => normalizeValue(session?.id) === normalizeValue(req.params.sessionId));

  if (sessionIndex < 0 || !isSessionForTrainee(sessions[sessionIndex], trainee)) {
    return fail(res, 404, "Session not found for this trainee.");
  }

  sessions[sessionIndex] = {
    ...sessions[sessionIndex],
    resetByAdmin: true,
    resetAt: new Date().toISOString(),
    resetBy: normalizeValue(req.user?.appId || req.user?.email || req.user?.name),
  };

  await Training.updateOne(
    { appId: training.appId, clientId },
    {
      $set: {
        "payload.sessions": sessions,
        "payload.lastActivity": "Today",
      },
    },
  );

  await syncClientMetrics(clientId);

  return ok(res, "Learner attempt reopened. The previous completed attempt remains in reporting.", {
    session: sessions[sessionIndex],
  });
};

const create = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const requester = getEffectiveRequester(req);
  const client = await Client.findOne({ appId: clientId });
  const existingUsers = await User.find({ clientId }).lean();
  const errors = validateUser(req.body, existingUsers, null);
  const roleDefinitions = await getStoredRoleDefinitions(clientId);
  const editableRole = getEditableRole(req.body.role, roleDefinitions);

  if (req.body.role === "super_admin") {
    return fail(res, 400, "Only a super admin can create another super admin.", {
      role: "Super admin access can only be assigned by a super admin.",
    });
  }

  if (!editableRole || editableRole.status !== "active") {
    return fail(res, 400, "Invalid role selected.", {
      role: "Choose an active role.",
    });
  }

  if (Object.keys(errors).length) {
    return fail(res, 400, "Please correct the highlighted fields.", errors);
  }

  const grantErrors = validateGrantablePermissionPayload(requester, normalizePermissionArray(req.body.permission));
  if (grantErrors) {
    return fail(res, 403, "You can only assign permissions available to your account.", grantErrors);
  }

  const currentActiveUsers = await User.countDocuments({ clientId, role: { $ne: "super_admin" }, status: "active" });
  // D1: user limit is now SNAPSHOT-based only (never PLAN_CONFIGS). Lifetime gate
  // reads client.userBaseLimit + userPurchasedLimit − userUsedLifetime.
  const lifetimeError = await enforceUserLifetime(client, clientId, currentActiveUsers, 1);
  if (lifetimeError) {
    return fail(res, quotaErrorStatus(lifetimeError), lifetimeError);
  }

  const creditResult = await consumeClientCredits({
    clientId,
    credits: CREDIT_COSTS.user,
    reason: `User seat created for ${String(req.body.email || "").trim().toLowerCase()}`,
  });

  if (!creditResult.ok) {
    return fail(res, 400, creditResult.message);
  }

  // Permanent lifetime consume (never decremented on deactivate/delete).
  client.userUsedLifetime = Number(client.userUsedLifetime || 0) + 1;
  await client.save();

  const roleAccess = buildAccessFromPayload(req.body, roleDefinitions, requester);
  const appId = `user-${Date.now()}`;
  const record = await User.create({
    appId,
    clientId,
    clientName: req.user.clientName || "",
    name: String(req.body.name).trim(),
    fullname: String(req.body.name).trim(),
    email: String(req.body.email).trim().toLowerCase(),
    role: req.body.role,
    roleName: roleAccess.roleName,
    permission: roleAccess.permission,
    allowed: roleAccess.allowed,
    useRoleDefaults: roleAccess.useRoleDefaults,
    status: req.body.status,
    trainings: 0,
    lastActive: "Just now",
    usedCredits: 6380,
    totalCredits: 10000,
    isUnreadNotifications: false,
    image: "/branding/avatar.png",
    phone: String(req.body.phone || "").trim(),
    title: String(req.body.title || "").trim(),
    department: String(req.body.department || "").trim(),
    passwordHash: hashPassword(`pending-user-${appId}`),
    isActivated: false,
    activatedAt: null,
  });

  await syncClientMetrics(clientId);
  const inviteResult = await issuePasswordEmail({
    req,
    user: record,
    purpose: "set_password",
    forcePlatform: req.user?.role === "super_admin",
    createdBy: req.user?.appId || "",
  });
  await notifyUserIds(
    [record.appId],
    {
      title: "Welcome to your workspace",
      message: `${roleAccess.roleName} access has been assigned to your account.`,
      category: "users",
      severity: "success",
      link: "/dashboard",
      actorName: req.user?.fullname || req.user?.name || "",
      metadata: {
        role: req.body.role,
      },
    },
    { clientId },
  );
  return ok(
    res,
    inviteResult.emailResult.success
      ? "User created and set password email sent."
      : "User created, but email delivery needs attention.",
    sanitizeUserRecord(record.toObject(), roleDefinitions, { primaryAdminUserId: client?.clientAdminUserId }),
  );
};

const update = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const requester = getEffectiveRequester(req);
  const targetUser = await User.findOne({ appId: req.params.id, clientId, role: { $ne: "super_admin" } });

  if (!targetUser) {
    return fail(res, 404, "User not found.");
  }

  if (req.body.role === "super_admin") {
    return fail(res, 400, "Only a super admin can update super admin access.", {
      role: "Super admin access can only be changed by a super admin.",
    });
  }

  const existingUsers = await User.find({ clientId }).lean();
  const errors = validateUser(req.body, existingUsers, targetUser.appId);
  const roleDefinitions = await getStoredRoleDefinitions(clientId);
  const editableRole = getEditableRole(req.body.role, roleDefinitions);
  const client = await Client.findOne({ appId: clientId }).lean();
  const accessPayloadChanged = hasAccessPayload(req.body) && hasPermissionOrRoleChange(req.body, targetUser);

  if (!editableRole || (editableRole.status !== "active" && targetUser.role !== editableRole.id)) {
    return fail(res, 400, "Invalid role selected.", {
      role: "Choose an active role.",
    });
  }

  if (Object.keys(errors).length) {
    return fail(res, 400, "Please correct the highlighted fields.", errors);
  }

  if (targetUser.appId === req.user?.appId && accessPayloadChanged) {
    return fail(res, 403, "You cannot change your own role or permissions.", {
      permission: "Ask another authorized admin to change your access.",
    });
  }

  if (client?.clientAdminUserId === targetUser.appId && req.user?.role !== "super_admin" && accessPayloadChanged) {
    return fail(res, 403, "Primary admin permissions can only be changed by a super admin.", {
      permission: "This account is the tenant primary admin.",
    });
  }

  const grantErrors = accessPayloadChanged
    ? validateGrantablePermissionChange(requester, normalizePermissionArray(req.body.permission), targetUser.permission)
    : null;
  if (grantErrors) {
    return fail(res, 403, "You can only assign permissions available to your account.", grantErrors);
  }

  const roleAccess = buildAccessFromPayload(req.body, roleDefinitions, requester, targetUser.permission);
  targetUser.name = String(req.body.name).trim();
  targetUser.fullname = String(req.body.name).trim();
  targetUser.email = String(req.body.email).trim().toLowerCase();
  targetUser.role = req.body.role;
  targetUser.roleName = roleAccess.roleName;
  targetUser.permission = roleAccess.permission;
  targetUser.allowed = roleAccess.allowed;
  targetUser.useRoleDefaults = roleAccess.useRoleDefaults;
  targetUser.status = req.body.status;
  targetUser.phone = String(req.body.phone || targetUser.phone || "").trim();
  targetUser.title = String(req.body.title || targetUser.title || "").trim();
  targetUser.department = String(req.body.department || targetUser.department || "").trim();

  await targetUser.save();
  await syncClientMetrics(clientId);
  return ok(res, "User updated successfully.", sanitizeUserRecord(targetUser.toObject(), roleDefinitions, { primaryAdminUserId: client?.clientAdminUserId }));
};

const remove = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const client = await Client.findOne({ appId: clientId }).lean();

  if (client?.clientAdminUserId === req.params.id && req.user?.role !== "super_admin") {
    return fail(res, 403, "Primary admin can only be removed by a super admin.");
  }

  const result = await User.deleteOne({ appId: req.params.id, clientId, role: { $ne: "super_admin" } });

  if (!result.deletedCount) {
    return fail(res, 404, "User not found.");
  }

  await syncClientMetrics(clientId);
  await Notification.deleteMany({ userId: req.params.id });
  return ok(res, "User removed successfully.", true);
};

const createTrainee = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const [existingUsers, client] = await Promise.all([
    User.find({ clientId }).lean(),
    Client.findOne({ appId: clientId }),
  ]);
  const errors = validateTrainee(req.body, existingUsers, null);
  const roleDefinitions = await getStoredRoleDefinitions(clientId);

  if (Object.keys(errors).length) {
    return fail(res, 400, "Please correct the highlighted fields.", errors);
  }

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  const currentActiveUsers = existingUsers.filter((user) => user.role !== "super_admin" && user.status === "active").length;
  // D1: snapshot-based user limit (no PLAN_CONFIGS).
  const lifetimeError = await enforceUserLifetime(client, clientId, currentActiveUsers, 1);
  if (lifetimeError) {
    return fail(res, quotaErrorStatus(lifetimeError), lifetimeError);
  }

  const creditResult = await consumeClientCredits({
    clientId,
    credits: CREDIT_COSTS.user,
    reason: `User seat created for ${String(req.body.email || "").trim().toLowerCase()}`,
  });

  if (!creditResult.ok) {
    return fail(res, 400, creditResult.message);
  }

  client.userUsedLifetime = Number(client.userUsedLifetime || 0) + 1;
  await client.save();

  const roleAccess = resolveUserAccess({ role: "trainee", permission: [], allowed: [], useRoleDefaults: true }, roleDefinitions);
  const appId = `user-${Date.now()}`;
  const record = await User.create({
    appId,
    clientId,
    clientName: req.user.clientName || "",
    name: String(req.body.name).trim(),
    fullname: String(req.body.name).trim(),
    email: String(req.body.email).trim().toLowerCase(),
    role: "trainee",
    roleName: roleAccess.roleName,
    permission: roleAccess.permission,
    allowed: roleAccess.allowed,
    useRoleDefaults: true,
    status: req.body.status || "active",
    trainings: 0,
    lastActive: "Just now",
    usedCredits: 0,
    totalCredits: 0,
    isUnreadNotifications: false,
    image: "/branding/avatar.png",
    phone: String(req.body.phone || "").trim(),
    title: String(req.body.title || "Trainee").trim(),
    department: String(req.body.department || "").trim(),
    passwordHash: hashPassword(`pending-trainee-${appId}`),
    isActivated: false,
    activatedAt: null,
  });

  await syncClientMetrics(clientId);
  const inviteResult = await issuePasswordEmail({
    req,
    user: record,
    purpose: "set_password",
    forcePlatform: req.user?.role === "super_admin",
    createdBy: req.user?.appId || "",
  });
  return ok(
    res,
    inviteResult.emailResult.success
      ? "Trainee created and set password email sent."
      : "Trainee created, but email delivery needs attention.",
    sanitizeUserRecord(record.toObject(), roleDefinitions),
  );
};

const updateTrainee = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const targetUser = await User.findOne({ appId: req.params.id, clientId, role: "trainee" });

  if (!targetUser) {
    return fail(res, 404, "Trainee not found.");
  }

  const existingUsers = await User.find({ clientId }).lean();
  const errors = validateTrainee(req.body, existingUsers, targetUser.appId);
  const roleDefinitions = await getStoredRoleDefinitions(clientId);

  if (Object.keys(errors).length) {
    return fail(res, 400, "Please correct the highlighted fields.", errors);
  }

  targetUser.name = String(req.body.name).trim();
  targetUser.fullname = String(req.body.name).trim();
  targetUser.email = String(req.body.email).trim().toLowerCase();
  targetUser.status = req.body.status || targetUser.status;
  targetUser.phone = String(req.body.phone || targetUser.phone || "").trim();
  targetUser.title = String(req.body.title || targetUser.title || "Trainee").trim();
  targetUser.department = String(req.body.department || targetUser.department || "").trim();

  await targetUser.save();
  await syncClientMetrics(clientId);
  return ok(res, "Trainee updated successfully.", sanitizeUserRecord(targetUser.toObject(), roleDefinitions));
};

const removeTrainee = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const result = await User.deleteOne({ appId: req.params.id, clientId, role: "trainee" });

  if (!result.deletedCount) {
    return fail(res, 404, "Trainee not found.");
  }

  await syncClientMetrics(clientId);
  await Notification.deleteMany({ userId: req.params.id });
  return ok(res, "Trainee removed successfully.", true);
};

const importTrainees = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const roleDefinitions = await getStoredRoleDefinitions(clientId);
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const existingUsers = await User.find({ clientId }).lean();
  const existingEmails = new Set(existingUsers.map((user) => String(user.email).toLowerCase()));
  const roleAccess = resolveUserAccess({ role: "trainee", permission: [], allowed: [], useRoleDefaults: true }, roleDefinitions);
  const docs = [];

  rows.forEach((row, index) => {
    const name = String(row?.name || "").trim();
    const email = String(row?.email || "").trim().toLowerCase();

    if (!name || !isValidEmail(email) || existingEmails.has(email)) {
      return;
    }

    existingEmails.add(email);
    docs.push({
      appId: `user-${Date.now()}-${index}`,
      clientId,
      clientName: req.user.clientName || "",
      name,
      fullname: name,
      email,
      role: "trainee",
      roleName: roleAccess.roleName,
      permission: roleAccess.permission,
      allowed: roleAccess.allowed,
      useRoleDefaults: true,
      status: String(row?.status || "active").trim() || "active",
      trainings: 0,
      lastActive: "Just now",
      usedCredits: 0,
      totalCredits: 0,
      isUnreadNotifications: false,
      image: "/branding/avatar.png",
      phone: String(row?.phone || "").trim(),
      title: String(row?.title || "Trainee").trim(),
      department: String(row?.department || "").trim(),
      passwordHash: hashPassword(`pending-trainee-import-${Date.now()}-${index}`),
      isActivated: false,
      activatedAt: null,
    });
  });

  if (!docs.length) {
    return fail(res, 400, "No valid trainee rows were found in the CSV.");
  }

  const client = await Client.findOne({ appId: clientId });

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  const currentActiveUsers = existingUsers.filter((user) => user.role !== "super_admin" && user.status === "active").length;
  // D1: snapshot-based user limit for the whole import batch (one slot per created user).
  const lifetimeError = await enforceUserLifetime(client, clientId, currentActiveUsers, docs.length);
  if (lifetimeError) {
    return fail(res, quotaErrorStatus(lifetimeError), lifetimeError);
  }

  const creditResult = await consumeClientCredits({
    clientId,
    credits: CREDIT_COSTS.user * docs.length,
    reason: `${docs.length} user seat${docs.length === 1 ? "" : "s"} created by trainee import`,
  });

  if (!creditResult.ok) {
    return fail(res, 400, creditResult.message);
  }

  client.userUsedLifetime = Number(client.userUsedLifetime || 0) + docs.length;
  await client.save();

  await User.insertMany(docs);
  await syncClientMetrics(clientId);
  await Promise.allSettled(
    docs.map((user) =>
      issuePasswordEmail({
        req,
        user,
        purpose: "set_password",
        forcePlatform: req.user?.role === "super_admin",
        createdBy: req.user?.appId || "",
      }),
    ),
  );
  const created = docs.map((user) => sanitizeUserRecord(user, roleDefinitions));
  return ok(res, "Trainees imported and onboarding emails queued.", paginate(created, { pageNo: 1, limit: created.length || 10 }));
};

const sendPasswordReset = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const targetUser = await User.findOne({ appId: req.params.id, clientId, role: { $ne: "super_admin" } });

  if (!targetUser) {
    return fail(res, 404, "User not found.");
  }

  const result = await issuePasswordEmail({
    req,
    user: targetUser,
    purpose: targetUser.isActivated === false ? "set_password" : "reset_password",
    forcePlatform: req.user?.role === "super_admin",
    createdBy: req.user?.appId || "",
  });

  if (!result.emailResult.success) {
    return fail(res, 500, "Password email could not be sent.", result.emailResult);
  }

  return ok(res, "Password email sent successfully.", {
    expiresAt: result.expiresAt,
  });
};

module.exports = {
  list,
  create,
  update,
  remove,
  listTrainees,
  getTraineeSessions,
  reopenTraineeSessionAttempt,
  createTrainee,
  updateTrainee,
  removeTrainee,
  importTrainees,
  sendPasswordReset,
};
