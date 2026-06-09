import crypto from "crypto";
import { getCollections } from "./_lib/db.js";
import { getBearerToken, getRoleAccess, hashPassword, sanitizeUserForClient, signAuthToken, verifyAuthToken, verifyPassword } from "./_lib/auth.js";
import { buildDashboard, buildLoginResponse, ensureSeedData, sanitizeUserRecord } from "./_lib/seeds.js";
import { contains, fail, getSegments, ok, paginate, parseUrl, readBody } from "./_lib/http.js";
import { createReadUrl, createStorageKey, createUploadUrl, deleteObject, isStorageConfigured } from "./_lib/storage.js";

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
const isValidUrl = (value) => {
  try {
    const parsed = new URL(String(value ?? "").trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};
const ensureArray = (value) =>
  Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : String(value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

const normalizeValue = (value) => String(value ?? "").trim();
const isSessionForTrainee = (session, trainee) => {
  const traineeEmail = normalizeValue(trainee?.email).toLowerCase();
  const traineeName = normalizeValue(trainee?.name).toLowerCase();
  const sessionEmail = normalizeValue(session?.learnerEmail || session?.ssoId).toLowerCase();
  const sessionName = normalizeValue(session?.learnerName).toLowerCase();

  return Boolean((traineeEmail && sessionEmail && traineeEmail === sessionEmail) || (traineeName && sessionName && traineeName === sessionName));
};

const buildAssignedTrainingCounts = (trainees, trainingRecords) => {
  const counts = new Map(trainees.map((trainee) => [trainee.appId, 0]));

  trainingRecords.forEach((training) => {
    const sessions = Array.isArray(training?.payload?.sessions) ? training.payload.sessions : [];
    trainees.forEach((trainee) => {
      if (sessions.some((session) => isSessionForTrainee(session, trainee))) {
        counts.set(trainee.appId, (counts.get(trainee.appId) || 0) + 1);
      }
    });
  });

  return counts;
};

const createApiKey = (name) =>
  `sk_live_${String(name).toLowerCase().replace(/\s+/g, "_")}_${Math.random().toString(36).slice(2, 16)}`;

const getConfigValue = async (configs, key) => {
  const record = await configs.findOne({ key });
  return record?.value ?? null;
};

const setConfigValue = async (configs, key, value) => {
  await configs.updateOne({ key }, { $set: { key, value, updatedAt: new Date() } }, { upsert: true });
};

const getCurrentUser = async (req, users) => {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  const payload = verifyAuthToken(token);

  if (!payload?.sub) {
    return null;
  }

  return users.findOne({ appId: payload.sub });
};

const requireAuth = async (req, res, users, predicate = () => true) => {
  const user = await getCurrentUser(req, users);

  if (!user) {
    fail(res, 401, "Unauthorized.");
    return null;
  }

  if (!predicate(user)) {
    fail(res, 403, "You do not have permission to access this resource.");
    return null;
  }

  return user;
};

const validateClient = (values, existingClients, currentId) => {
  const errors = {};

  if (!String(values.name ?? "").trim()) {
    errors.name = "Client name is required.";
  }
  if (!String(values.industry ?? "").trim()) {
    errors.industry = "Industry is required.";
  }
  if (!String(values.csm ?? "").trim()) {
    errors.csm = "Customer success manager is required.";
  }
  if (!String(values.subdomain ?? "").trim()) {
    errors.subdomain = "Subdomain is required.";
  } else if (
    existingClients.some(
      (client) =>
        String(client.subdomain).toLowerCase() === String(values.subdomain).toLowerCase() &&
        client.appId !== currentId,
    )
  ) {
    errors.subdomain = "Subdomain already exists.";
  }

  if (values.domain && !String(values.domain).includes(".")) {
    errors.domain = "Use a valid domain.";
  }

  return errors;
};

const validateUser = (values, existingUsers, currentId) => {
  const errors = {};

  if (!String(values.name ?? "").trim()) {
    errors.name = "Name is required.";
  }
  if (!isValidEmail(values.email)) {
    errors.email = "Use a valid email address.";
  }
  if (!currentId && !String(values.password ?? "").trim()) {
    errors.password = "Password is required.";
  } else if (String(values.password ?? "").trim() && String(values.password).trim().length < 6) {
    errors.password = "Password must be at least 6 characters.";
  }
  if (
    existingUsers.some(
      (user) =>
        String(user.email).toLowerCase() === String(values.email).toLowerCase() &&
        user.appId !== currentId,
    )
  ) {
    errors.email = "Email already exists.";
  }

  return errors;
};

const validateApiKey = (values) => {
  const errors = {};

  if (!String(values.name ?? "").trim()) {
    errors.name = "Key name is required.";
  }

  return errors;
};

const toClientRecord = (client) => ({
  id: client.appId,
  name: client.name,
  industry: client.industry,
  plan: client.plan,
  status: client.status,
  domain: client.domain,
  domainStatus: client.domainStatus,
  subdomain: client.subdomain,
  activeUsers: client.activeUsers,
  trainings: client.trainings,
  sessions: client.sessions,
  joined: client.joined,
  csm: client.csm,
  logo: client.logo,
  logoColor: client.logoColor,
  logoBg: client.logoBg,
  applicationName: client.applicationName,
  logoUrl: client.logoUrl,
  darkLogoUrl: client.darkLogoUrl,
  faviconUrl: client.faviconUrl,
  iframeEnabled: client.iframeEnabled,
  ssoType: client.ssoType,
  ssoStatus: client.ssoStatus,
  primaryColor: client.primaryColor,
  secondaryColor: client.secondaryColor,
  supportEmail: client.supportEmail,
  allowedOrigins: client.allowedOrigins ?? [],
  webhookUrl: client.webhookUrl,
  apiScope: client.apiScope,
});

const buildClientAppSettings = (client, fallback = {}) => ({
  ...fallback,
  application_name: client?.applicationName || client?.name || fallback.application_name || "Trainup",
  logo: client?.logoUrl || fallback.logo || "/branding/logo.png",
  dark_logo: client?.darkLogoUrl || client?.logoUrl || fallback.dark_logo || "/branding/logo-dark.png",
  favicon: client?.faviconUrl || fallback.favicon || "/branding/favicon.png",
  primaryColor: client?.primaryColor || fallback.primaryColor || "#2563eb",
  secondaryColor: client?.secondaryColor || fallback.secondaryColor || "#475569",
  accentColor: client?.secondaryColor || fallback.accentColor || "#14b8a6",
  gradientFrom: client?.primaryColor || fallback.gradientFrom || "#2563eb",
  gradientTo: client?.secondaryColor || fallback.gradientTo || "#14b8a6",
  email: client?.supportEmail || fallback.email || "support@trainup.ai",
  copyright: `© ${new Date().getFullYear()} ${client?.applicationName || client?.name || fallback.application_name || "Trainup"}. All rights reserved.`,
  phone: client?.companyPhone || fallback.phone || "+91 1800 120 9999",
  path: fallback.path || "/dashboard",
});

const toApiKeyRecord = (key) => ({
  id: key.appId,
  name: key.name,
  key: key.key,
  permission: key.permission,
  createdAt: key.createdAt,
  lastUsed: key.lastUsed,
  callsToday: key.callsToday,
  status: key.status,
});

const toTrainingRecord = (training) => {
  const { _id, appId, createdAt, updatedAt, sortIndex, ...rest } = training;
  return {
    id: appId,
    ...rest,
  };
};

const hasAccess = (user, permissionKey, allowedKey) => {
  const permission = Array.isArray(user?.permission) ? user.permission : getRoleAccess(user?.role).permission;
  const allowed = Array.isArray(user?.allowed) ? user.allowed : getRoleAccess(user?.role).allowed;

  return (!permissionKey || permission.includes(permissionKey)) && (!allowedKey || allowed.includes(allowedKey));
};

const buildAssignableAccess = (requester, role, requestedPermission = [], preservePermission = []) => {
  const roleAccess = getRoleAccess(role);
  const grantable = new Set(Array.isArray(requester?.permission) ? requester.permission : getRoleAccess(requester?.role).permission);
  const defaultPermission = roleAccess.permission.filter((permission) => grantable.has(permission));
  const requested = Array.isArray(requestedPermission)
    ? requestedPermission.map((permission) => String(permission).trim()).filter(Boolean)
    : [];
  const customPermission = requested.filter((permission) => grantable.has(permission));
  const preservedPermission = (Array.isArray(preservePermission) ? preservePermission : []).filter((permission) => !grantable.has(permission));
  const permission = Array.from(new Set([...(customPermission.length ? customPermission : defaultPermission), ...preservedPermission]));
  const allowed = Array.from(new Set(permission.flatMap((permissionKey) => {
    if (permissionKey.startsWith("dashboard.")) return ["dashboard"];
    if (permissionKey.startsWith("billing.")) return ["billing"];
    if (permissionKey.startsWith("users.")) return ["users"];
    if (permissionKey.startsWith("trainees.")) return ["trainees"];
    if (permissionKey.startsWith("roles.")) return ["roles"];
    if (permissionKey.startsWith("api.")) return ["api"];
    if (permissionKey.startsWith("webhooks.")) return ["webhooks"];
    if (permissionKey.startsWith("notifications.")) return ["notifications"];
    if (permissionKey.startsWith("iframe.")) return ["iframe"];
    if (permissionKey.startsWith("settings.")) return ["settings"];
    if (permissionKey.startsWith("profile.")) return ["profile"];
    if (permissionKey.startsWith("training.")) return ["trainingWorkspace"];
    return [];
  })));

  return {
    roleName: roleAccess.roleName,
    permission,
    allowed,
  };
};

const roleCanAccessTrainingWorkspace = (user) => hasAccess(user, "training.library.view", "trainingWorkspace");
const canAssignTraining = (user) => hasAccess(user, "training.assign", "trainingWorkspace");

export default async function handler(req, res) {
  const { users, clients, apiKeys, configs, trainings, mediaAssets } = await getCollections();
  await ensureSeedData({ users, clients, apiKeys, configs });

  const segments = getSegments(req);
  const url = parseUrl(req);
  const query = Object.fromEntries(url.searchParams.entries());
  const method = req.method || "GET";

  if (method === "POST" && segments[0] === "auth" && segments[1] === "login") {
    const body = await readBody(req);
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "").trim();
    const user = await users.findOne({ email });

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return fail(res, 401, "Invalid email or password.", {
        email: "",
        password: "Use valid internal Samsung LMS credentials.",
      });
    }

    const token = signAuthToken({
      sub: user.appId,
      role: user.role,
      email: user.email,
    });

    await users.updateOne({ appId: user.appId }, { $set: { lastActive: "Today" } });
    return ok(res, "Login successful.", buildLoginResponse(user, token));
  }

  if (method === "POST" && segments[0] === "auth" && segments[1] === "logout") {
    return ok(res, "Logged out successfully.", true);
  }

  if (method === "GET" && segments[0] === "settings") {
    const settings = await getConfigValue(configs, "settings");
    const currentUser = await getCurrentUser(req, users);
    const client = currentUser?.clientId ? await clients.findOne({ appId: currentUser.clientId }) : null;
    return ok(res, "Settings loaded.", client ? buildClientAppSettings(client, settings ?? {}) : settings);
  }

  if (method === "GET" && segments[0] === "profile") {
    const user = await requireAuth(req, res, users, (candidate) =>
      ["super_admin", "admin"].includes(candidate.role),
    );
    if (!user) return;
    return ok(res, "Profile loaded.", sanitizeUserForClient(user));
  }

  if (method === "PUT" && segments[0] === "profile") {
    const user = await requireAuth(req, res, users, (candidate) =>
      ["super_admin", "admin"].includes(candidate.role),
    );
    if (!user) return;

    const body = await readBody(req);
    const nextName = String(body.name || "").trim();
    const nextEmail = String(body.email || "").trim().toLowerCase();
    const currentPassword = String(body.currentPassword || "").trim();
    const newPassword = String(body.newPassword || "").trim();
    const confirmPassword = String(body.confirmPassword || "").trim();
    const shouldUpdatePassword = Boolean(newPassword || confirmPassword);
    const errors = {};

    if (!nextName) {
      errors.name = "Name is required.";
    }

    if (!isValidEmail(nextEmail)) {
      errors.email = "Use a valid email address.";
    } else {
      const duplicate = await users.findOne({
        email: nextEmail,
        appId: { $ne: user.appId },
      });

      if (duplicate) {
        errors.email = "Email already exists.";
      }
    }

    if (shouldUpdatePassword) {
      if (!currentPassword) {
        errors.currentPassword = "Current password is required.";
      } else if (!verifyPassword(currentPassword, user.passwordHash)) {
        errors.currentPassword = "Current password is incorrect.";
      }

      if (!newPassword) {
        errors.newPassword = "New password is required.";
      } else if (newPassword.length < 6) {
        errors.newPassword = "Password must be at least 6 characters.";
      }

      if (newPassword !== confirmPassword) {
        errors.confirmPassword = "Passwords must match.";
      }
    }

    if (Object.keys(errors).length) {
      return fail(res, 400, "Please correct the highlighted fields.", errors);
    }

    await users.updateOne(
      { appId: user.appId },
      {
        $set: {
          name: nextName,
          fullname: nextName,
          email: nextEmail,
          phone: String(body.phone || "").trim(),
          title: String(body.title || "").trim(),
          department: String(body.department || "").trim(),
          image: Object.prototype.hasOwnProperty.call(body, "image")
            ? String(body.image || "").trim()
            : String(user.image || "").trim(),
          ...(shouldUpdatePassword ? { passwordHash: hashPassword(newPassword) } : {}),
        },
      },
    );

    const updatedUser = await users.findOne({ appId: user.appId });
    return ok(res, "Profile updated successfully.", sanitizeUserForClient(updatedUser));
  }

  if (method === "GET" && segments[0] === "dashboard") {
    const session = await requireAuth(req, res, users, (candidate) =>
      ["super_admin", "admin"].includes(candidate.role),
    );
    if (!session) return;
    const clientRecords = await clients.find({}).sort({ appId: 1 }).toArray();
    const platformUsers = await users.find({ role: { $ne: "super_admin" } }).toArray();
    const trainingRecords = await trainings.find({}).toArray();
    const webhookConfig = await getConfigValue(configs, "webhookConfig");
    return ok(
      res,
      "Dashboard loaded.",
      buildDashboard({
        clients: clientRecords.map(toClientRecord),
        webhookConfig,
        session: sanitizeUserForClient(session),
        users: platformUsers,
        trainingRecords,
      }),
    );
  }

  if (segments[0] === "clients") {
    const currentUser = await requireAuth(req, res, users, (candidate) => candidate.role === "super_admin");
    if (!currentUser) return;

    if (method === "GET" && segments.length === 1) {
      const allClients = (await clients.find({}).sort({ appId: 1 }).toArray()).map(toClientRecord);
      const needle = String(query.query ?? "").trim();
      const filtered = allClients.filter((client) =>
        [client.name, client.industry, client.csm, client.subdomain, client.domain]
          .filter(Boolean)
          .some((value) => contains(value, needle)),
      );

      return ok(res, "Clients loaded.", paginate(filtered, query));
    }

    if (method === "POST" && segments.length === 1) {
      const body = await readBody(req);
      const existingClients = await clients.find({}).toArray();
      const errors = validateClient(body, existingClients, null);

      if (Object.keys(errors).length) {
        return fail(res, 400, "Please correct the highlighted fields.", errors);
      }

      const record = {
        appId: `client-${Date.now()}`,
        name: String(body.name).trim(),
        industry: String(body.industry).trim(),
        plan: body.plan,
        status: body.status,
        csm: String(body.csm).trim(),
        activeUsers: Number(body.activeUsers),
        trainings: Number(body.trainings),
        sessions: Number(body.sessions),
        subdomain: String(body.subdomain).trim(),
        domain: String(body.domain ?? "").trim(),
        domainStatus: body.domain ? "verified" : "not_configured",
        joined: "Apr 2026",
        logo: String(body.name)
          .split(" ")
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
          .toUpperCase(),
        logoColor: "#3e60d5",
        logoBg: "#ebf2ff",
        iframeEnabled: true,
        ssoType: "Samsung IAM",
        ssoStatus: "connected",
        primaryColor: "#1428a0",
        secondaryColor: "#3e60d5",
        supportEmail: "training@samsung.com",
        allowedOrigins: [],
        webhookUrl: "",
        apiScope: "Session sync",
      };

      await clients.insertOne(record);
      return ok(res, "Client created successfully.", toClientRecord(record));
    }

    if (segments.length === 2) {
      const client = await clients.findOne({ appId: segments[1] });

      if (!client) {
        return fail(res, 404, "Client not found.", {});
      }

      if (method === "GET") {
        return ok(res, "Client loaded.", toClientRecord(client));
      }

      if (method === "PUT") {
        const body = await readBody(req);
        const existingClients = await clients.find({}).toArray();
        const errors = validateClient(body, existingClients, client.appId);

        if (Object.keys(errors).length) {
          return fail(res, 400, "Please correct the highlighted fields.", errors);
        }

        const nextClient = {
          ...client,
          name: String(body.name).trim(),
          industry: String(body.industry).trim(),
          plan: body.plan,
          status: body.status,
          csm: String(body.csm).trim(),
          activeUsers: Number(body.activeUsers),
          trainings: Number(body.trainings),
          sessions: Number(body.sessions),
          subdomain: String(body.subdomain).trim(),
          domain: String(body.domain ?? "").trim(),
          domainStatus: body.domain ? "verified" : "not_configured",
          logo: String(body.name)
            .split(" ")
            .slice(0, 2)
            .map((part) => part[0])
            .join("")
            .toUpperCase(),
        };

        await clients.updateOne({ appId: client.appId }, { $set: nextClient });
        return ok(res, "Client updated successfully.", toClientRecord(nextClient));
      }

      if (method === "DELETE") {
        await clients.deleteOne({ appId: client.appId });
        return ok(res, "Client deleted successfully.", true);
      }
    }

    if (method === "PUT" && segments.length === 3 && segments[2] === "settings") {
      const client = await clients.findOne({ appId: segments[1] });
      if (!client) {
        return fail(res, 404, "Client not found.", {});
      }

      const body = await readBody(req);
      const section = String(body.section ?? "");
      const values = body.values ?? {};
      const nextClient = { ...client };

      if (section === "branding" || section === "whitelabel") {
        if (values.supportEmail && !isValidEmail(values.supportEmail)) {
          return fail(res, 400, "Please correct the highlighted fields.", {
            supportEmail: "Use a valid support email.",
          });
        }
        nextClient.applicationName = String(values.applicationName ?? nextClient.applicationName ?? nextClient.name);
        nextClient.primaryColor = String(values.primaryColor ?? nextClient.primaryColor);
        nextClient.secondaryColor = String(values.secondaryColor ?? nextClient.secondaryColor);
        nextClient.logoUrl = String(values.logoUrl ?? nextClient.logoUrl ?? "");
        nextClient.darkLogoUrl = String(values.darkLogoUrl ?? nextClient.darkLogoUrl ?? "");
        nextClient.faviconUrl = String(values.faviconUrl ?? nextClient.faviconUrl ?? "");
        nextClient.supportEmail = String(values.supportEmail ?? nextClient.supportEmail);
      }

      if (section === "domain") {
        nextClient.domain = String(values.domain ?? nextClient.domain);
        nextClient.subdomain = String(values.subdomain ?? nextClient.subdomain);
        nextClient.domainStatus = values.domain ? "verified" : "not_configured";
        nextClient.iframeEnabled = Boolean(values.iframeEnabled ?? nextClient.iframeEnabled);
      }

      if (section === "sso") {
        nextClient.ssoType = String(values.ssoType ?? nextClient.ssoType);
        nextClient.ssoStatus = values.ssoType ? "connected" : "not_configured";
      }

      if (section === "api") {
        if (values.webhookUrl && !isValidUrl(values.webhookUrl)) {
          return fail(res, 400, "Please correct the highlighted fields.", {
            webhookUrl: "Use a valid webhook URL.",
          });
        }
        nextClient.webhookUrl = String(values.webhookUrl ?? nextClient.webhookUrl);
        nextClient.apiScope = String(values.apiScope ?? nextClient.apiScope);
        nextClient.allowedOrigins = ensureArray(values.allowedOrigins);
      }

      await clients.updateOne({ appId: client.appId }, { $set: nextClient });
      return ok(res, "Client settings updated successfully.", toClientRecord(nextClient));
    }
  }

  if (segments[0] === "users") {
    const currentUser = await requireAuth(req, res, users, (candidate) => candidate.role === "admin");
    if (!currentUser) return;

    if (method === "GET" && segments.length === 1) {
      const allUsers = (await users.find({ role: { $nin: ["super_admin", "trainee"] } }).sort({ appId: 1 }).toArray()).map(sanitizeUserRecord);
      const needle = String(query.query ?? "").trim();
      const filtered = allUsers.filter((user) =>
        [user.name, user.email, user.role, user.status].some((value) => contains(value, needle)),
      );
      return ok(res, "Users loaded.", paginate(filtered, query));
    }

    if (method === "POST" && segments.length === 1) {
      const body = await readBody(req);
      const existingUsers = await users.find({}).toArray();
      const errors = validateUser(body, existingUsers, null);

      if (body.role === "super_admin") {
        return fail(res, 400, "Only a super admin can create another super admin.", {
          role: "Super admin access can only be assigned by a super admin.",
        });
      }

      if (Object.keys(errors).length) {
        return fail(res, 400, "Please correct the highlighted fields.", errors);
      }

      const roleAccess = buildAssignableAccess(currentUser, body.role, body.permission);
      const record = {
        appId: `user-${Date.now()}`,
        name: String(body.name).trim(),
        fullname: String(body.name).trim(),
        email: String(body.email).trim().toLowerCase(),
        role: body.role,
        roleName: roleAccess.roleName,
        permission: roleAccess.permission,
        allowed: roleAccess.allowed,
        status: body.status,
        trainings: 0,
        lastActive: "Just now",
        usedCredits: 6380,
        totalCredits: 10000,
        isUnreadNotifications: true,
        image: "/branding/avatar.png",
        passwordHash: hashPassword(String(body.password)),
      };

      await users.insertOne(record);
      return ok(res, "User invited successfully.", sanitizeUserRecord(record));
    }

    if (segments.length === 2) {
      const targetUser = await users.findOne({ appId: segments[1], role: { $ne: "super_admin" } });

      if (!targetUser) {
        return fail(res, 404, "User not found.", {});
      }

      if (method === "PUT") {
        const body = await readBody(req);
        const existingUsers = await users.find({}).toArray();
        const errors = validateUser(body, existingUsers, targetUser.appId);

        if (body.role === "super_admin") {
          return fail(res, 400, "Only a super admin can update super admin access.", {
            role: "Super admin access can only be changed by a super admin.",
          });
        }

        if (Object.keys(errors).length) {
          return fail(res, 400, "Please correct the highlighted fields.", errors);
        }

        const accessPayloadChanged =
          String(body.role || targetUser.role) !== targetUser.role ||
          (Array.isArray(body.permission) && JSON.stringify([...body.permission].sort()) !== JSON.stringify([...(targetUser.permission || [])].sort()));

        if (targetUser.appId === currentUser.appId && accessPayloadChanged) {
          return fail(res, 403, "You cannot change your own role or permissions.", {
            permission: "Ask another authorized admin to change your access.",
          });
        }

        const roleAccess = buildAssignableAccess(currentUser, body.role, body.permission, targetUser.permission);
        const nextValues = {
          name: String(body.name).trim(),
          fullname: String(body.name).trim(),
          email: String(body.email).trim().toLowerCase(),
          role: body.role,
          roleName: roleAccess.roleName,
          permission: roleAccess.permission,
          allowed: roleAccess.allowed,
          status: body.status,
        };

        if (String(body.password ?? "").trim()) {
          nextValues.passwordHash = hashPassword(String(body.password));
        }

        await users.updateOne({ appId: targetUser.appId }, { $set: nextValues });
        const updatedUser = await users.findOne({ appId: targetUser.appId });
        return ok(res, "User updated successfully.", sanitizeUserRecord(updatedUser));
      }

      if (method === "DELETE") {
        await users.deleteOne({ appId: targetUser.appId });
        return ok(res, "User removed successfully.", true);
      }
    }
  }

  if (segments[0] === "trainees") {
    const permissionByMethod = method === "POST"
      ? "trainees.add"
      : method === "PUT"
        ? "trainees.edit"
        : method === "DELETE"
          ? "trainees.delete"
          : segments[2] === "sessions"
            ? "trainees.report"
            : "trainees.view";
    const currentUser = await requireAuth(req, res, users, (candidate) => hasAccess(candidate, permissionByMethod, "trainees"));
    if (!currentUser) return;

    if (method === "GET" && segments.length === 1) {
      const traineeRecords = await users.find({ role: "trainee" }).sort({ appId: 1 }).toArray();
      const trainingRecords = await trainings.find({}, { projection: { "payload.sessions": 1 } }).toArray();
      const assignedTrainingCounts = buildAssignedTrainingCounts(traineeRecords, trainingRecords);
      const allUsers = traineeRecords.map((user) => ({
        ...sanitizeUserRecord(user),
        trainings: assignedTrainingCounts.get(user.appId) || 0,
      }));
      const needle = String(query.query ?? "").trim();
      const filtered = allUsers.filter((user) =>
        [user.name, user.email, user.role, user.status].some((value) => contains(value, needle)),
      );
      return ok(res, "Trainees loaded.", paginate(filtered, query));
    }

    if (method === "GET" && segments.length === 3 && segments[2] === "sessions") {
      const trainee = await users.findOne({ appId: segments[1], role: "trainee" });

      if (!trainee) {
        return fail(res, 404, "Trainee not found.", {});
      }

      const allTrainings = await trainings.find({}).sort({ sortIndex: 1, createdAt: 1 }).toArray();
      const sessions = allTrainings
        .flatMap((training) => {
          const items = Array.isArray(training?.payload?.sessions) ? training.payload.sessions : [];
          return items
            .filter((session) => {
              return isSessionForTrainee(session, trainee);
            })
            .map((session, index) => ({
              id: String(session?.id || `launch-session-${training.appId}-${index}`),
              trainingId: String(training.appId || ""),
              trainingTitle: String(training?.payload?.title || "Untitled Training"),
              trainingType: String(training?.payload?.type || ""),
              trainingAudience: String(training?.payload?.audience || ""),
              ssoId: String(session?.ssoId || session?.learnerEmail || trainee.email || ""),
              learnerName: String(session?.learnerName || trainee.name || ""),
              learnerEmail: String(session?.learnerEmail || trainee.email || ""),
              status: String(session?.status || "not-started"),
              timeSpent: String(session?.timeSpent || "0m 00s"),
              slidesViewed: Number(session?.slidesViewed || 0),
              totalSlides: Number(session?.totalSlides || 0),
              viewedSlideIds: Array.isArray(session?.viewedSlideIds) ? session.viewedSlideIds : [],
              score: typeof session?.score === "number" ? session.score : null,
              startedAt: session?.startedAt || null,
              completedAt: session?.completedAt || null,
              correctAnswers: Number(session?.correctAnswers || 0),
              totalQuestions: Number(session?.totalQuestions || 0),
              progressPercent: typeof session?.progressPercent === "number" ? session.progressPercent : undefined,
              mode: String(session?.mode || "public"),
              askHistory: Array.isArray(session?.askHistory) ? session.askHistory : [],
              proctoringReport: session?.proctoringReport || null,
            }));
        })
        .sort((left, right) => new Date(String(right.startedAt || right.completedAt || 0)).getTime() - new Date(String(left.startedAt || left.completedAt || 0)).getTime());

      const scoreRecords = sessions.filter((session) => typeof session.score === "number");
      return ok(res, "Trainee sessions loaded.", {
        trainee: sanitizeUserRecord(trainee),
        sessions,
        summary: {
          totalSessions: sessions.length,
          completedSessions: sessions.filter((session) => String(session.status).toLowerCase() === "completed").length,
          inProgressSessions: sessions.filter((session) => String(session.status).toLowerCase() === "in-progress").length,
          notStartedSessions: sessions.filter((session) => String(session.status).toLowerCase() === "not-started").length,
          averageScore: scoreRecords.length
            ? Math.round(scoreRecords.reduce((sum, session) => sum + Number(session.score || 0), 0) / scoreRecords.length)
            : null,
        },
      });
    }

    if (method === "POST" && segments.length === 1) {
      const body = await readBody(req);
      const existingUsers = await users.find({}).toArray();
      const errors = validateUser(body, existingUsers, null);

      if (Object.keys(errors).length) {
        return fail(res, 400, "Please correct the highlighted fields.", errors);
      }

      const roleAccess = getRoleAccess("trainee");
      const record = {
        appId: `user-${Date.now()}`,
        name: String(body.name).trim(),
        fullname: String(body.name).trim(),
        email: String(body.email).trim().toLowerCase(),
        role: "trainee",
        roleName: roleAccess.roleName,
        permission: roleAccess.permission,
        allowed: roleAccess.allowed,
        status: body.status ?? "active",
        trainings: 0,
        lastActive: "Just now",
        usedCredits: 0,
        totalCredits: 0,
        isUnreadNotifications: false,
        image: "/branding/avatar.png",
        passwordHash: hashPassword(String(body.password)),
      };

      await users.insertOne(record);
      return ok(res, "Trainee created successfully.", sanitizeUserRecord(record));
    }

    if (method === "POST" && segments[1] === "import") {
      const body = await readBody(req);
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      const existingUsers = await users.find({}).toArray();
      const existingEmails = new Set(existingUsers.map((user) => String(user.email).toLowerCase()));
      const roleAccess = getRoleAccess("trainee");
      const created = [];

      rows.forEach((row, index) => {
        const name = String(row?.name || "").trim();
        const email = String(row?.email || "").trim().toLowerCase();

        if (!name || !isValidEmail(email) || existingEmails.has(email)) {
          return;
        }

        existingEmails.add(email);
        created.push({
          appId: `user-${Date.now()}-${index}`,
          name,
          fullname: name,
          email,
          role: "trainee",
          roleName: roleAccess.roleName,
          permission: roleAccess.permission,
          allowed: roleAccess.allowed,
          status: String(row?.status || "active").trim() || "active",
          trainings: 0,
          lastActive: "Just now",
          usedCredits: 0,
          totalCredits: 0,
          isUnreadNotifications: false,
          image: "/branding/avatar.png",
          passwordHash: hashPassword(String(row?.password || "trainee123")),
        });
      });

      if (!created.length) {
        return fail(res, 400, "No valid trainee rows were found in the CSV.", {});
      }

      await users.insertMany(created);
      return ok(res, "Trainees imported successfully.", paginate(created.map(sanitizeUserRecord), { pageNo: 1, limit: created.length }));
    }

    if (segments.length === 2) {
      const targetUser = await users.findOne({ appId: segments[1], role: "trainee" });

      if (!targetUser) {
        return fail(res, 404, "Trainee not found.", {});
      }

      if (method === "PUT") {
        const body = await readBody(req);
        const existingUsers = await users.find({}).toArray();
        const errors = validateUser(body, existingUsers, targetUser.appId);

        if (Object.keys(errors).length) {
          return fail(res, 400, "Please correct the highlighted fields.", errors);
        }

        const nextValues = {
          name: String(body.name).trim(),
          fullname: String(body.name).trim(),
          email: String(body.email).trim().toLowerCase(),
          status: body.status,
        };

        if (String(body.password ?? "").trim()) {
          nextValues.passwordHash = hashPassword(String(body.password));
        }

        await users.updateOne({ appId: targetUser.appId }, { $set: nextValues });
        const updatedUser = await users.findOne({ appId: targetUser.appId });
        return ok(res, "Trainee updated successfully.", sanitizeUserRecord(updatedUser));
      }

      if (method === "DELETE") {
        await users.deleteOne({ appId: targetUser.appId });
        return ok(res, "Trainee removed successfully.", true);
      }
    }
  }

  if (segments[0] === "api-keys") {
    const currentUser = await requireAuth(req, res, users, (candidate) => candidate.role === "admin");
    if (!currentUser) return;

    if (method === "GET" && segments.length === 1) {
      const needle = String(query.query ?? "").trim();
      const allKeys = (await apiKeys.find({ status: "active" }).sort({ createdAt: -1 }).toArray()).map(toApiKeyRecord);
      const filtered = allKeys.filter((record) =>
        [record.name, record.permission, record.lastUsed].some((value) => contains(value, needle)),
      );
      return ok(res, "API keys loaded.", paginate(filtered, query));
    }

    if (method === "POST" && segments.length === 1) {
      const body = await readBody(req);
      const errors = validateApiKey(body);

      if (Object.keys(errors).length) {
        return fail(res, 400, "Please correct the highlighted fields.", errors);
      }

      const record = {
        appId: `key-${Date.now()}`,
        name: String(body.name).trim(),
        key: createApiKey(body.name),
        permission: body.permission ?? "Read Only",
        createdAt: new Date().toISOString().slice(0, 10),
        lastUsed: "Never",
        callsToday: 0,
        status: "active",
      };

      await apiKeys.insertOne(record);
      return ok(res, "API key generated successfully.", toApiKeyRecord(record));
    }

    if (method === "DELETE" && segments.length === 2) {
      await apiKeys.updateOne({ appId: segments[1] }, { $set: { status: "revoked" } });
      return ok(res, "API key revoked successfully.", true);
    }
  }

  if (segments[0] === "api-config") {
    const currentUser = await requireAuth(req, res, users, (candidate) => candidate.role === "admin");
    if (!currentUser) return;

    if (method === "GET") {
      return ok(res, "API configuration loaded.", await getConfigValue(configs, "apiConfig"));
    }

    if (method === "PUT") {
      const body = await readBody(req);
      if (!isValidUrl(body.baseUrl)) {
        return fail(res, 400, "Please correct the highlighted fields.", { baseUrl: "Use a valid API base URL." });
      }

      const nextValue = {
        baseUrl: String(body.baseUrl),
        rateLimitPerMinute: Number(body.rateLimitPerMinute ?? 0),
        tokenExpiryHours: Number(body.tokenExpiryHours ?? 0),
        corsAllowedOrigins: ensureArray(body.corsAllowedOrigins),
        endpoints: (await getConfigValue(configs, "apiConfig"))?.endpoints ?? [],
      };

      await setConfigValue(configs, "apiConfig", nextValue);
      return ok(res, "API configuration updated successfully.", nextValue);
    }
  }

  if (segments[0] === "webhooks") {
    const currentUser = await requireAuth(req, res, users, (candidate) => candidate.role === "admin");
    if (!currentUser) return;

    if (method === "GET") {
      return ok(res, "Webhook configuration loaded.", await getConfigValue(configs, "webhookConfig"));
    }

    if (method === "PUT") {
      const body = await readBody(req);
      if (!isValidUrl(body.url)) {
        return fail(res, 400, "Please correct the highlighted fields.", { url: "Use a valid webhook URL." });
      }

      await setConfigValue(configs, "webhookConfig", body);
      return ok(res, "Webhook configuration updated successfully.", body);
    }
  }

  if (segments[0] === "iframe") {
    const currentUser = await requireAuth(req, res, users, (candidate) => candidate.role === "admin");
    if (!currentUser) return;

    if (method === "GET") {
      return ok(res, "iFrame configuration loaded.", await getConfigValue(configs, "iframeConfig"));
    }

    if (method === "PUT") {
      const body = await readBody(req);
      if (!isValidUrl(body.baseUrl)) {
        return fail(res, 400, "Please correct the highlighted fields.", { baseUrl: "Use a valid embed URL." });
      }
      await setConfigValue(configs, "iframeConfig", body);
      return ok(res, "iFrame settings updated successfully.", body);
    }
  }

  if (segments[0] === "training-workspace") {
    const currentUser = await requireAuth(req, res, users, roleCanAccessTrainingWorkspace);
    if (!currentUser) return;

    if (method === "GET" && segments[1] === "trainees") {
      if (!canAssignTraining(currentUser)) {
        return fail(res, 403, "You do not have permission to access this resource.");
      }

      const needle = String(query.query ?? "").trim();
      const allUsers = (await users.find({ role: "trainee", status: "active" }).sort({ appId: 1 }).toArray()).map(sanitizeUserRecord);
      const filtered = allUsers.filter((user) =>
        [user.name, user.email, user.role, user.status].some((value) => contains(value, needle)),
      );
      return ok(res, "Trainees loaded.", paginate(filtered, query));
    }

    if (method === "GET" && segments.length === 1) {
      const allTrainings = await trainings.find({}).sort({ sortIndex: 1, createdAt: 1 }).toArray();
      return ok(res, "Training workspace loaded.", allTrainings.map(toTrainingRecord));
    }

    if (method === "POST" && segments.length === 3 && segments[2] === "assign") {
      if (!canAssignTraining(currentUser)) {
        return fail(res, 403, "You do not have permission to access this resource.");
      }

      const body = await readBody(req);
      const traineeIds = Array.isArray(body.traineeIds) ? body.traineeIds.map((item) => String(item).trim()).filter(Boolean) : [];

      if (!traineeIds.length) {
        return fail(res, 400, "Select at least one trainee.", {});
      }

      const training = await trainings.findOne({ appId: segments[1] });
      if (!training) {
        return fail(res, 404, "Training not found.", {});
      }

      const traineeRecords = await users.find({ appId: { $in: traineeIds }, role: "trainee", status: "active" }).toArray();
      const existingSessions = Array.isArray(training.payload?.sessions) ? training.payload.sessions : [];
      const existingSessionKeys = new Set(existingSessions.map((session) => `${session?.learnerEmail || session?.ssoId || ""}`.toLowerCase()));
      const newSessions = traineeRecords
        .filter((trainee) => !existingSessionKeys.has(String(trainee.email || "").toLowerCase()))
        .map((trainee, index) => ({
          id: `assigned-${training.appId}-${trainee.appId}-${index}`,
          ssoId: trainee.email,
          learnerName: trainee.name,
          learnerEmail: trainee.email,
          status: "not-started",
          timeSpent: "0m 00s",
          slidesViewed: 0,
          totalSlides: Array.isArray(training.payload?.slides) ? training.payload.slides.length : 0,
          viewedSlideIds: [],
          score: null,
          startedAt: null,
          completedAt: null,
          correctAnswers: 0,
          totalQuestions: Array.isArray(training.payload?.questionCheckpoints) ? training.payload.questionCheckpoints.length : 0,
          progressPercent: 0,
          mode: "public",
          askHistory: [],
          proctoringReport: null,
        }));

      if (!newSessions.length) {
        return fail(res, 400, "Selected trainees are already assigned.", {});
      }

      await trainings.updateOne(
        { appId: training.appId },
        {
          $set: {
            payload: {
              ...training.payload,
              sessions: [...existingSessions, ...newSessions],
              lastActivity: "Today",
            },
            updatedAt: new Date(),
          },
        },
      );
      const updatedTraining = await trainings.findOne({ appId: training.appId });
      return ok(res, "Training assigned successfully.", {
        training: toTrainingRecord(updatedTraining),
        emailResult: {
          success: true,
          message: `Training assigned to ${newSessions.length} trainee${newSessions.length === 1 ? "" : "s"}.`,
        },
      });
    }

    if (method === "PUT" && segments[1] === "sync") {
      const body = await readBody(req);
      const nextTrainings = Array.isArray(body.trainings) ? body.trainings : [];

      const operations = nextTrainings.map((training, index) => ({
        updateOne: {
          filter: { appId: training.id },
          update: {
            $set: {
              ...training,
              appId: training.id,
              sortIndex: index,
              updatedAt: new Date(),
            },
            $setOnInsert: {
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      }));

      if (operations.length) {
        await trainings.bulkWrite(operations);
      }

      const incomingIds = nextTrainings.map((training) => training.id);
      await trainings.deleteMany({ appId: { $nin: incomingIds } });

      const refreshed = await trainings.find({}).sort({ sortIndex: 1, createdAt: 1 }).toArray();
      return ok(res, "Training workspace synced successfully.", refreshed.map(toTrainingRecord));
    }
  }

  if (segments[0] === "media") {
    const currentUser = await requireAuth(req, res, users, roleCanAccessTrainingWorkspace);
    if (!currentUser) return;

    if (method === "POST" && segments[1] === "upload-url") {
      if (!isStorageConfigured) {
        return fail(res, 503, "S3 storage is not configured on this deployment.");
      }

      const body = await readBody(req);
      const fileName = String(body.fileName ?? "").trim();
      const mimeType = String(body.mimeType ?? "application/octet-stream").trim();

      if (!fileName) {
        return fail(res, 400, "File name is required.");
      }

      const assetId = `media-${crypto.randomUUID()}`;
      const key = createStorageKey({
        fileName,
        category: body.originalFile ? "originals" : "slides",
      });
      const uploadUrl = await createUploadUrl({ key, mimeType });

      await mediaAssets.insertOne({
        appId: assetId,
        key,
        name: fileName,
        mimeType,
        source: body.source ?? "image",
        pageNumber: body.pageNumber ?? null,
        extractedText: Array.isArray(body.extractedText) ? body.extractedText : [],
        originalFile: Boolean(body.originalFile),
        createdAt: new Date(),
        uploadedBy: currentUser.appId,
      });

      return ok(res, "Upload URL created.", {
        assetId,
        key,
        uploadUrl,
      });
    }

    if (method === "GET" && segments.length === 3 && segments[2] === "resolve") {
      if (!isStorageConfigured) {
        return fail(res, 503, "S3 storage is not configured on this deployment.");
      }

      const asset = await mediaAssets.findOne({ appId: segments[1] });

      if (!asset) {
        return fail(res, 404, "Media asset not found.");
      }

      const urlValue = await createReadUrl({ key: asset.key });
      return ok(res, "Media asset resolved.", {
        id: asset.appId,
        name: asset.name,
        mimeType: asset.mimeType,
        source: asset.source,
        pageNumber: asset.pageNumber,
        extractedText: asset.extractedText ?? [],
        url: urlValue,
      });
    }

    if (method === "DELETE" && segments.length === 2) {
      const asset = await mediaAssets.findOne({ appId: segments[1] });

      if (!asset) {
        return fail(res, 404, "Media asset not found.");
      }

      if (isStorageConfigured) {
        await deleteObject({ key: asset.key });
      }

      await mediaAssets.deleteOne({ appId: asset.appId });
      return ok(res, "Media asset removed successfully.", true);
    }
  }

  return fail(res, 404, "The requested API endpoint is not implemented.");
}
