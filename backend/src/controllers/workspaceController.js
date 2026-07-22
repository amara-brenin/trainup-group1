const crypto = require("crypto");
const Training = require("../models/Training");
const Client = require("../models/Client");
const User = require("../models/User");
const { ok, fail } = require("../helpers/response");
const { getTenantClientId, syncClientMetrics } = require("../helpers/tenant");
const {
  getCreditCosts, consumeClientCredits,
  assertLifetimeQuota, buildClientCreditSnapshot,
  assertSubscriptionActive,
} = require("../helpers/credits");
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

// Lightweight shape for the workspace LIST/library screen. Excludes slides,
// scripts, narration, question payloads, and other large embedded content —
// those are only fetched (via getOne) when a specific training is opened.
const toTrainingListRecord = (record) => {
  const payload = record.payload || {};
  return {
    id: record.appId,
    title: payload.title || "",
    type: payload.type || "Other",
    audience: payload.audience || "All Learners",
    trainer: payload.trainer || "",
    status: payload.status || "draft",
    created: payload.created || "",
    submittedOn: payload.submittedOn ?? null,
    approvedOn: payload.approvedOn ?? null,
    lastActivity: payload.lastActivity || "",
    trainingType: payload.trainingType,
    avatarName: payload.avatarName || "",
    avatarId: payload.avatarId || "",
    lastLaunchLink: payload.lastLaunchLink || null,
    ttsMode: payload.ttsMode,
    ttsProvider: payload.ttsProvider || "",
    voiceName: payload.voiceName || "",
    voiceId: payload.voiceId || "",
    questionButtonLabel: payload.questionButtonLabel || "",
    isPublished: Boolean(payload.isPublished),
    publishedOn: payload.publishedOn ?? null,
    durationMins: Number(payload.durationMins || 0),
    maxDurationMins: Number(payload.maxDurationMins || 0),
    idleRefreshMins: payload.idleRefreshMins ?? null,
    options: payload.options || {
      allowSkipAhead: false,
      allowMultipleAttempts: false,
      showProgressBar: true,
      showSubtitles: true,
      disablePreviousButton: false,
      enableReviewMode: false,
      markAnswersInRealTime: false,
      showMarksInProgressBar: false,
      showFinalScore: true,
    },
    // Excluded on purpose: slides, sessions, scriptPrompt, presenterNotes,
    // knowledgeDocuments, questionGeneratorConfig, questionCheckpoints,
    // questionSets, localizedVoiceovers, reviewMessages, branding, theme,
    // avatarEngine, groupConfig — not rendered by the listing screen.
    slides: [],
    sessions: [],
    slidesCount: Number(record.slidesCount || 0),
    sessionsCount: Number(record.sessionsCount || 0),
    completedSessionsCount: Number(record.completedSessionsCount || 0),
    traineesCount: Number(record.traineesCount || 0),
  };
};

const buildAssignedTrainingSession = (training, trainee) => ({
  id: `assigned-${training.appId}-${trainee.appId}-${crypto.randomUUID().slice(0, 8)}`,
  ssoId: trainee.email,
  learnerName: trainee.name,
  learnerEmail: trainee.email,
  status: "not-started",
  timeSpent: "0m 00s",
  slidesViewed: 0,
  totalSlides: Array.isArray(training.payload?.slides) ? training.payload.slides.filter((slide) => !slide.unselected).length : 0,
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

  // A tenant with a custom domain configured must always get links on that
  // domain — this URL goes into trainee-facing assignment emails, so it can't
  // depend on whichever origin the admin's browser happened to be on.
  const resolvedOrigin = client?.domain
    ? `https://${client.domain}`
    : baseUrl || `https://${client?.subdomain || "app"}.trainup.ai`;
  return buildPublicUrl(resolvedOrigin, path, headerBase);
};

const list = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const records = await Training.aggregate([
    { $match: { clientId } },
    { $sort: { sortIndex: 1, createdAt: 1 } },
    {
      $project: {
        appId: 1,
        payload: {
          title: 1, type: 1, audience: 1, trainer: 1, status: 1, created: 1,
          submittedOn: 1, approvedOn: 1, lastActivity: 1, trainingType: 1,
          avatarName: 1, avatarId: 1, ttsMode: 1, ttsProvider: 1, voiceName: 1,
          voiceId: 1, questionButtonLabel: 1, isPublished: 1, publishedOn: 1,
          durationMins: 1, maxDurationMins: 1, idleRefreshMins: 1, options: 1,
        },
        slidesCount: {
          $size: {
            $filter: {
              input: { $ifNull: ["$payload.slides", []] },
              as: "slide",
              cond: { $ne: ["$$slide.unselected", true] }
            }
          }
        },
        sessionsCount: { $size: { $ifNull: ["$payload.sessions", []] } },
        completedSessionsCount: {
          $size: {
            $filter: {
              input: { $ifNull: ["$payload.sessions", []] },
              as: "session",
              cond: { $eq: ["$$session.status", "completed"] },
            },
          },
        },
        traineesCount: {
          $size: {
            $setUnion: [
              {
                $map: {
                  input: { $ifNull: ["$payload.sessions", []] },
                  as: "session",
                  in: { $ifNull: ["$$session.learnerEmail", "$$session.ssoId"] },
                },
              },
              [],
            ],
          },
        },
      },
    },
  ]);
  return ok(res, "Training workspace loaded.", records.map(toTrainingListRecord));
};

const getOne = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const training = await Training.findOne({ appId: req.params.id, clientId }).lean();

  if (!training) {
    return fail(res, 404, "Training not found.");
  }

  return ok(res, "Training loaded.", toTrainingRecord(training));
};

const capacity = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const client = await Client.findOne({ appId: clientId });

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  const metrics = await syncClientMetrics(clientId);
  // Lifetime per-resource limits (trainingBaseLimit/trainingUsedLifetime/...) were
  // retired in favor of a single credit pool (see credits.js) — there's no more
  // fixed lifetime cap to backfill or report, only "can the credit balance afford
  // one more of this resource". assertLifetimeQuota is now a permanent no-op, so
  // this gate is really just the subscription-active check.
  const quotaError = assertSubscriptionActive(client);
  const snapshot = buildClientCreditSnapshot(client);
  const creditCosts = await getCreditCosts(client);

  const report = (resource, used) => {
    const cost = Math.max(1, Number(creditCosts[resource] || 1));
    const affordable = snapshot.planExpired ? 0 : Math.floor(snapshot.availableCredits / cost);
    return {
      limit: null,
      used,
      remaining: affordable,
      unlimited: false,
    };
  };

  const trainingsUsed = Number(metrics?.trainings ?? client.trainings ?? 0);
  const sessionsUsed = Number(metrics?.sessions ?? client.sessions ?? 0);
  const usersUsed = Number(metrics?.activeUsers ?? client.activeUsers ?? 0);

  return ok(res, "Training capacity loaded.", {
    // Back-compat fields (existing UI):
    trainings: trainingsUsed,
    trainingLimit: null,
    canCreateTraining: !quotaError,
    reason: quotaError || null,
    // Credit-based capacity for all three resources (see report() above).
    usage: {
      training: report("training", trainingsUsed),
      session: report("session", sessionsUsed),
      user: report("user", usersUsed),
    },
  });
};

const listAssignableTrainees = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const query = String(req.query.query || "").trim();
  const limit = Math.max(1, Number(req.query.limit || 50));
  const pageNo = Math.max(1, Number(req.query.pageNo || 1));
  const skip = (pageNo - 1) * limit;

  const filter = { clientId, role: "trainee", status: "active" };
  if (query) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: escaped, $options: "i" } },
      { email: { $regex: escaped, $options: "i" } },
    ];
  }

  const [records, count] = await Promise.all([
    User.find(filter, { appId: 1, name: 1, email: 1, role: 1, roleName: 1, status: 1, trainings: 1, lastActive: 1 })
      .sort({ name: 1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  const record = records.map((user) => ({
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

  const totalPages = Math.max(1, Math.ceil(count / limit));
  return ok(res, "Trainees loaded.", {
    count,
    totalPages,
    record,
    pagination: Array.from({ length: totalPages }, (_, i) => i + 1),
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

  // Issue 1: an expired subscription cannot assign trainings (these become
  // session records that consume session quota on completion).
  const expiredError = assertSubscriptionActive(client);
  if (expiredError) {
    return fail(res, 402, expiredError);
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

  // Task 2: quota is consumed on the FIRST transition into "approved" (publish),
  // exactly once per training (quotaConsumed flag). Drafts/pending consume nothing.
  const publishConsumeIds = new Set();
  for (const training of nextTrainings) {
    const existingRecord = existingById.get(training.id);
    const prevPayload = existingRecord?.payload || {};
    const prevStatus = normalizeStatus(prevPayload.status);
    const nextStatus = normalizeStatus(training.status);
    if (nextStatus === "approved" && prevStatus !== "approved" && !prevPayload.quotaConsumed) {
      publishConsumeIds.add(training.id);
    }
  }
  // Issue 1: block any credit/quota-consuming sync (new trainings or publishing)
  // once the subscription has expired. Pure metadata edits to existing trainings
  // (no new creates, no new publishes) are allowed through.
  if (nextTrainingCreateCount > 0 || publishConsumeIds.size > 0) {
    const expiredError = assertSubscriptionActive(client);
    if (expiredError) {
      return fail(res, 402, expiredError);
    }
  }
  if (publishConsumeIds.size > 0) {
    const quotaError = assertLifetimeQuota(client, "training", publishConsumeIds.size);
    if (quotaError) {
      return fail(res, 400, quotaError);
    }
  }

  // Credits still charged at create time (existing billing behavior unchanged).
  if (nextTrainingCreateCount > 0) {
    const creditResult = await consumeClientCredits({
      clientId,
      credits: (await getCreditCosts(client)).training * nextTrainingCreateCount,
      reason: `${nextTrainingCreateCount} training${nextTrainingCreateCount === 1 ? "" : "s"} created`,
      actionType: "training_created",
      entityType: "training",
      performedBy: req.user?.fullname || req.user?.name || req.user?.email || "",
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
    // Data-integrity guard: never let an incoming payload that is missing or
    // empty for heavy authored content silently wipe content that already
    // exists on the stored record. This protects against a client that syncs
    // a partially-loaded/stub training (e.g. editor opened before slide detail
    // finished loading) from destroying slides/knowledge/question data.
    // A non-empty incoming value always wins (normal edits pass through).
    const preserveAuthoredField = (field) => {
      const incoming = payload[field];
      const incomingHasContent = Array.isArray(incoming) ? incoming.length > 0 : Boolean(incoming);
      if (incomingHasContent) {
        return incoming;
      }
      const existing = previousPayload[field];
      const existingHasContent = Array.isArray(existing) ? existing.length > 0 : Boolean(existing);
      return existingHasContent ? existing : incoming;
    };
    const nextPayload = {
      ...payload,
      slides: preserveAuthoredField("slides"),
      knowledgeDocuments: preserveAuthoredField("knowledgeDocuments"),
      questionSets: preserveAuthoredField("questionSets"),
      questionCheckpoints: preserveAuthoredField("questionCheckpoints"),
      localizedVoiceovers: preserveAuthoredField("localizedVoiceovers"),
      sessions: preservedSessions,
      // Task 2: server-derived, permanent. Once consumed it stays consumed
      // (republish/draft-toggle never re-charges quota); client cannot reset it.
      quotaConsumed: Boolean(previousPayload.quotaConsumed) || publishConsumeIds.has(id),
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

  // Task 2: permanently record lifetime training usage for newly-published
  // trainings. Deletes above never touch this counter (no refund).
  if (publishConsumeIds.size > 0) {
    client.trainingUsedLifetime = Number(client.trainingUsedLifetime || 0) + publishConsumeIds.size;
    await client.save();
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
  getOne,
  capacity,
  listAssignableTrainees,
  assignTraining,
  sync,
};
