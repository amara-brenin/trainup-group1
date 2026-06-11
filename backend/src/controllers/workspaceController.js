const crypto = require("crypto");
const Training = require("../models/Training");
const Client = require("../models/Client");
const User = require("../models/User");
const { ok, fail } = require("../helpers/response");
const { getTenantClientId, syncClientMetrics } = require("../helpers/tenant");
const { CREDIT_COSTS, assertUsageWithinPlan, consumeClientCredits } = require("../helpers/credits");
const { notifyRolesInClient, notifyTrainingOwner } = require("../helpers/notifications");
const { sendTrainingAssignmentEmails } = require("../helpers/clientDelivery");
const { buildPublicUrl } = require("../helpers/publicUrl");

const normalizeStatus = (value) => String(value || "").trim().toLowerCase();

const extractReviewMessages = (payload) =>
  Array.isArray(payload?.reviewMessages) ? payload.reviewMessages.filter(Boolean) : [];

const toTrainingRecord = (training) => ({
  id: training.appId,
  ...training.payload,
  sessions: Array.isArray(training.payload?.sessions) ? training.payload.sessions : [],
});

const buildAssignedTrainingSession = (training, trainee) => ({
  id: `assigned-${training.appId}-${trainee.appId}-${crypto.randomUUID().slice(0, 8)}`,
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
});

const buildLaunchUrl = (req, client, trainingId, isGroup = false) => {
  const referer = String(req.headers.referer || "").trim();
  const origin = String(req.headers.origin || "").trim();
  const baseUrl = origin || (referer ? new URL(referer).origin : "");

  // Group trainings route into the group experience (waiting room → live →
  // completion), resolved to the current/upcoming session by training id.
  // One-on-one keeps the existing slideshow launch (lowercased id).
  const path = isGroup
    ? `/group/${String(trainingId || "")}`
    : `/slideshows/${String(trainingId || "").toLowerCase()}`;

  // Prefer the admin app's base path sent per-request (X-App-Base-Path), so the
  // link auto-matches the deployed subpath even without server env config; fall
  // back to PUBLIC_BASE_PATH when the header is absent.
  const headerBase = req.headers["x-app-base-path"];
  const resolvedOrigin = baseUrl || (client?.domain ? `https://${client.domain}` : `https://${client?.subdomain || "app"}.trainup.ai`);
  return buildPublicUrl(resolvedOrigin, path, headerBase);
};

const list = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const records = await Training.find({ clientId }).sort({ sortIndex: 1, createdAt: 1 }).lean();
  return ok(res, "Training workspace loaded.", records.map(toTrainingRecord));
};

const capacity = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const client = await Client.findOne({ appId: clientId }).lean();

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  const metrics = await syncClientMetrics(clientId);
  const trainingLimit = client.planLimits?.trainings ?? null;
  const currentTrainingCount = Number(metrics?.trainings ?? client.trainings ?? 0);
  const usageError = assertUsageWithinPlan({
    client,
    resource: "trainings",
    nextCount: currentTrainingCount + 1,
  });

  return ok(res, "Training capacity loaded.", {
    trainings: currentTrainingCount,
    trainingLimit,
    canCreateTraining: !usageError,
    reason: usageError || null,
  });
};

const listAssignableTrainees = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const query = String(req.query.query || "").trim().toLowerCase();
  const records = await User.find({ clientId, role: "trainee", status: "active" }).sort({ appId: 1 }).lean();
  const filtered = records
    .filter((user) => !query || [user.name, user.email].some((value) => String(value || "").toLowerCase().includes(query)))
    .map((user) => ({
      id: user.appId,
      name: user.name,
      email: user.email,
      role: user.role,
      roleName: user.roleName || "Trainee",
      status: user.status,
      trainings: Number(user.trainings || 0),
      lastActive: user.lastActive || "Today",
      permission: [],
      allowed: [],
      permissionSource: "role",
    }));

  return ok(res, "Trainees loaded.", {
    count: filtered.length,
    totalPages: 1,
    record: filtered,
    pagination: [1],
  });
};

const assignTraining = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const traineeIds = Array.isArray(req.body?.traineeIds) ? req.body.traineeIds.map((item) => String(item).trim()).filter(Boolean) : [];

  if (!traineeIds.length) {
    return fail(res, 400, "Select at least one trainee.");
  }

  const [training, client, trainees] = await Promise.all([
    Training.findOne({ appId: req.params.id, clientId }),
    Client.findOne({ appId: clientId }),
    User.find({ clientId, appId: { $in: traineeIds }, role: "trainee", status: "active" }).lean(),
  ]);

  if (!training) {
    return fail(res, 404, "Training not found.");
  }

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  if (!trainees.length) {
    return fail(res, 400, "No active trainees were found for assignment.");
  }

  const existingSessions = Array.isArray(training.payload?.sessions) ? training.payload.sessions : [];
  const existingSessionKeys = new Set(existingSessions.map((session) => String(session?.learnerEmail || session?.ssoId || "").toLowerCase()));
  const newAssignees = trainees.filter((trainee) => !existingSessionKeys.has(String(trainee.email || "").toLowerCase()));

  if (!newAssignees.length) {
    return fail(res, 400, "Selected trainees are already assigned.");
  }

  const newSessions = newAssignees.map((trainee) => buildAssignedTrainingSession(training, trainee));
  training.payload = {
    ...training.payload,
    sessions: [...existingSessions, ...newSessions],
    lastActivity: "Today",
  };
  await training.save();

  const isGroupTraining = String(training.payload?.trainingType || "").trim() === "group";
  const launchUrl = buildLaunchUrl(req, client, training.appId, isGroupTraining);
  const emailResult = await sendTrainingAssignmentEmails(
    client,
    newAssignees.map((trainee) => ({ name: trainee.name, email: trainee.email })),
    training.payload,
    launchUrl,
  );

  await syncClientMetrics(clientId);
  return ok(
    res,
    emailResult.success
      ? `Training assigned to ${newSessions.length} trainee${newSessions.length === 1 ? "" : "s"}.`
      : `Training assigned to ${newSessions.length} trainee${newSessions.length === 1 ? "" : "s"}, but invite email delivery needs attention.`,
    {
      training: toTrainingRecord(training.toObject()),
      emailResult,
    },
  );
};

const sync = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const nextTrainings = Array.isArray(req.body.trainings) ? req.body.trainings : [];
  const client = await Client.findOne({ appId: clientId });

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  const existingRecords = nextTrainings.length
    ? await Training.find({ clientId, appId: { $in: nextTrainings.map((training) => training.id) } }).lean()
    : [];
  const existingById = new Map(existingRecords.map((record) => [record.appId, record]));
  const pendingNotifications = [];
  const nextTrainingCreateCount = nextTrainings.filter((training) => !existingById.has(training.id)).length;

  if (nextTrainingCreateCount > 0) {
    const currentTrainingCount = await Training.countDocuments({ clientId });
    const usageError = assertUsageWithinPlan({
      client,
      resource: "trainings",
      nextCount: currentTrainingCount + nextTrainingCreateCount,
    });

    if (usageError) {
      return fail(res, 400, usageError);
    }

    const creditResult = await consumeClientCredits({
      clientId,
      credits: CREDIT_COSTS.training * nextTrainingCreateCount,
      reason: `${nextTrainingCreateCount} training${nextTrainingCreateCount === 1 ? "" : "s"} created`,
    });

    if (!creditResult.ok) {
      return fail(res, 400, creditResult.message);
    }
  }

  const operations = nextTrainings.map((training, index) => {
    const { id, ...payload } = training;
    const existingRecord = existingById.get(id);
    const previousPayload = existingRecord?.payload || {};
    const preservedSessions = Array.isArray(existingRecord?.payload?.sessions)
      ? existingRecord.payload.sessions
      : Array.isArray(payload.sessions)
        ? payload.sessions
        : [];
    const nextPayload = {
      ...payload,
      sessions: preservedSessions,
    };

    const previousStatus = normalizeStatus(previousPayload.status);
    const nextStatus = normalizeStatus(nextPayload.status);
    const trainerName = String(nextPayload.trainer || previousPayload.trainer || "").trim();
    const trainingTitle = String(nextPayload.title || previousPayload.title || "Training").trim();
    const previousMessages = extractReviewMessages(previousPayload);
    const nextMessages = extractReviewMessages(nextPayload);
    const previousMessageIds = new Set(previousMessages.map((message) => String(message.id || "")));
    const newMessages = nextMessages.filter((message) => {
      const messageId = String(message?.id || "");
      return messageId && !previousMessageIds.has(messageId);
    });

    if (req.user?.role === "trainer" && previousStatus !== "review" && nextStatus === "review") {
      pendingNotifications.push(
        notifyRolesInClient({
          clientId,
          roles: ["reviewer", "admin"],
          excludeUserId: req.user?.appId,
          payload: {
            title: previousStatus === "changes_requested" ? "Training re-submitted" : "Training submitted for review",
            message: `${trainingTitle} is ready for reviewer action.`,
            category: "training",
            severity: "info",
            link: "/dashboard",
            actorName: req.user?.fullname || req.user?.name || "",
          },
        }),
      );
    }

    if (req.user?.role === "reviewer" && previousStatus !== "approved" && nextStatus === "approved") {
      pendingNotifications.push(
        notifyTrainingOwner({
          clientId,
          trainerName,
          excludeUserId: req.user?.appId,
          payload: {
            title: "Training approved",
            message: `${trainingTitle} has been approved by reviewer.`,
            category: "review",
            severity: "success",
            link: "/dashboard",
            actorName: req.user?.fullname || req.user?.name || "",
          },
        }),
        notifyRolesInClient({
          clientId,
          roles: ["admin"],
          payload: {
            title: "Training approved",
            message: `${trainingTitle} is now approved and ready for rollout.`,
            category: "review",
            severity: "success",
            link: "/dashboard",
            actorName: req.user?.fullname || req.user?.name || "",
          },
        }),
      );
    }

    if (req.user?.role === "reviewer" && previousStatus !== "changes_requested" && nextStatus === "changes_requested") {
      pendingNotifications.push(
        notifyTrainingOwner({
          clientId,
          trainerName,
          excludeUserId: req.user?.appId,
          payload: {
            title: "Changes requested",
            message: `${trainingTitle} needs updates before approval.`,
            category: "review",
            severity: "warning",
            link: "/dashboard",
            actorName: req.user?.fullname || req.user?.name || "",
          },
        }),
        notifyRolesInClient({
          clientId,
          roles: ["admin"],
          payload: {
            title: "Training sent back for changes",
            message: `${trainingTitle} requires trainer revisions.`,
            category: "review",
            severity: "warning",
            link: "/dashboard",
            actorName: req.user?.fullname || req.user?.name || "",
          },
        }),
      );
    }

    for (const message of newMessages) {
      const messageRole = String(message?.role || "").trim().toLowerCase();
      if (messageRole === "reviewer" && req.user?.role === "reviewer") {
        pendingNotifications.push(
          notifyTrainingOwner({
            clientId,
            trainerName,
            excludeUserId: req.user?.appId,
            payload: {
              title: "Reviewer comment added",
              message: `New review feedback was added on ${trainingTitle}.`,
              category: "review",
              severity: "info",
              link: "/dashboard",
              actorName: req.user?.fullname || req.user?.name || "",
            },
          }),
        );
      }

      if (messageRole === "trainer" && req.user?.role === "trainer") {
        pendingNotifications.push(
          notifyRolesInClient({
            clientId,
            roles: ["reviewer"],
            excludeUserId: req.user?.appId,
            payload: {
              title: "Trainer replied to feedback",
              message: `${trainingTitle} has a new trainer response in the review room.`,
              category: "review",
              severity: "info",
              link: "/dashboard",
              actorName: req.user?.fullname || req.user?.name || "",
            },
          }),
        );
      }
    }

    return {
      updateOne: {
        filter: { appId: id, clientId },
        update: {
          $set: {
            appId: id,
            clientId,
            sortIndex: index,
            payload: nextPayload,
          },
        },
        upsert: true,
      },
    };
  });

  if (operations.length) {
    await Training.bulkWrite(operations);
    await Training.deleteMany({ clientId, appId: { $nin: nextTrainings.map((training) => training.id) } });
  } else {
    await Training.deleteMany({ clientId });
  }

  await syncClientMetrics(clientId);
  if (pendingNotifications.length) {
    await Promise.allSettled(pendingNotifications);
  }
  const refreshed = await Training.find({ clientId }).sort({ sortIndex: 1, createdAt: 1 }).lean();
  return ok(res, "Training workspace synced successfully.", refreshed.map(toTrainingRecord));
};

module.exports = {
  list,
  capacity,
  listAssignableTrainees,
  assignTraining,
  sync,
};
