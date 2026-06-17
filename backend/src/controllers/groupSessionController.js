const crypto = require("crypto");
const Training = require("../models/Training");
const Client = require("../models/Client");
const User = require("../models/User");
const GroupSession = require("../models/GroupSession");
const { ok, fail } = require("../helpers/response");
const logger = require("../helpers/logger");
const { getTenantClientId } = require("../helpers/tenant");
const {
  LIFECYCLE,
  PHASE,
  ATTENDANCE_STATE,
  legacyStatus,
  resolveGroupConfig,
  generateJoinCode,
  generateQrToken,
  signSessionToken,
  verifySessionToken,
  normalizeValue,
} = require("../helpers/groupSession");

const TERMINAL = [LIFECYCLE.COMPLETED, LIFECYCLE.CANCELLED];
const LIVE_LIFECYCLES = [LIFECYCLE.LIVE];

// Count invited trainees (assigned to the training) for the monitoring metrics.
const countInvited = (training) => {
  const sessions = Array.isArray(training?.payload?.sessions) ? training.payload.sessions : [];
  const emails = new Set(
    sessions
      .map((s) => normalizeValue(s?.learnerEmail || s?.ssoId).toLowerCase())
      .filter(Boolean),
  );
  return emails.size;
};
const {
  createTrainingReply,
  buildLaunchPayload,
  findTrainingById,
  buildLaunchBrandingPayload,
} = require("./launchController");
const {
  gradeAssessment,
  resolveCompletionStatus,
  buildAssessmentSnapshot,
  publicCheckpoints,
} = require("../helpers/assessmentScoring");
const { ensureClientEntitlement, assertLifetimeQuota } = require("../helpers/credits");
const { ensureGroupSession, findActiveSession, findGroupTrainingByAppId } = require("../services/groupSessionService");

// ----------------------------------------------------------------------------
// Serialization
// ----------------------------------------------------------------------------

const publicSessionView = (session) => ({
  id: session.appId,
  trainingId: session.trainingId,
  trainingTitle: session.trainingTitle,
  lifecycle: session.lifecycle,
  phase: session.phase,
  status: legacyStatus(session),
  currentSlideId: session.currentSlideId,
  currentSlideIndex: session.currentSlideIndex,
  currentTopic: session.currentTopic,
  activeSpeakerId: session.activeSpeakerId,
  queue: (session.queue || []).map((entry) => ({
    traineeId: entry.traineeId,
    name: entry.name,
    raisedAt: entry.raisedAt,
  })),
  attendeeCount: (session.attendees || []).filter((a) => a.connected).length,
  capacity: session.capacity,
  minParticipants: Number(session.config?.autoStart?.minParticipants || 1),
  autoEnter: Boolean(session.config?.autoStart?.autoEnter),
  startTime: session.startTime,
  endTime: session.endTime,
  startedAt: session.startedAt,
  endedAt: session.endedAt,
});

const buildMetrics = (session, invited = 0) => {
  const attendees = session.attendees || [];
  const present = attendees.filter(
    (a) => a.attendanceState === ATTENDANCE_STATE.PRESENT || a.attendanceState === ATTENDANCE_STATE.COMPLETED,
  ).length;
  return {
    invited,
    joined: attendees.length,
    connected: attendees.filter((a) => a.connected).length,
    waiting: attendees.filter((a) => a.attendanceState === ATTENDANCE_STATE.WAITING).length,
    present,
    completed: attendees.filter((a) => a.attendanceState === ATTENDANCE_STATE.COMPLETED).length,
  };
};

const adminSessionView = (session, invited = 0) => ({
  ...publicSessionView(session),
  config: session.config,
  metrics: buildMetrics(session, invited),
  transitions: (session.transitions || []).slice(-30),
  attendees: (session.attendees || []).map((a) => ({
    traineeId: a.traineeId,
    name: a.name,
    email: a.email,
    connected: a.connected,
    attendanceState: a.attendanceState,
    joinedAt: a.joinedAt,
    confirmTime: a.confirmTime,
    completionTime: a.completionTime,
    leftAt: a.leftAt,
    rejoins: a.rejoins,
    totalActiveMs: a.totalActiveMs,
    handRaises: a.handRaises,
    questionsAsked: a.questionsAsked,
    questionsAnswered: a.questionsAnswered,
    attendancePct: a.attendancePct,
    completionStatus: a.completionStatus,
    // Feature 4: live proctoring summary for the host dashboard.
    proctoringRiskScore: Number(a.proctoring?.riskScore || 0),
    proctoringEventCount: Array.isArray(a.proctoring?.events) ? a.proctoring.events.length : 0,
  })),
  transcripts: session.transcripts || [],
});

// Append a capped, structured join-attempt log + console line.
const logJoinAttempt = async (session, { traineeId, email, outcome, reason }) => {
  console.log(`[group-join] ${session.appId} ${outcome}${reason ? `:${reason}` : ""} email=${email || "?"}`);
  try {
    session.joinLog.push({ at: new Date(), traineeId: traineeId || "", email: email || "", outcome, reason: reason || "" });
    if (session.joinLog.length > 200) session.joinLog = session.joinLog.slice(-200);
    await session.save();
  } catch (_e) { /* non-fatal */ }
};

// ----------------------------------------------------------------------------
// Admin / trainer endpoints (auth via authTokenAdmin)
// ----------------------------------------------------------------------------

// POST /training-workspace/:id/group-session
const createGroupSession = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const training = await Training.findOne({ appId: req.params.id, clientId }).lean();

  if (!training) {
    return fail(res, 404, "Training not found.");
  }

  if (normalizeValue(training.payload?.trainingType) !== "group") {
    return fail(res, 400, "This training is not configured as a Group Training.");
  }

  if (normalizeValue(training.payload?.status) !== "approved") {
    return fail(res, 400, "Only approved trainings can be launched as a group session.");
  }

  // Task 2 (session lifetime): enforce only when a NEW session will be created.
  // Reusing an existing active session is free (idempotent Launch Hall).
  const client = await Client.findOne({ appId: clientId });
  if (client && !client.quotaInitialized) {
    const publishedCount = await Training.countDocuments({ clientId, "payload.status": "approved" });
    await ensureClientEntitlement(client, {
      training: publishedCount,
      session: Number(client.sessions || 0),
      user: Number(client.activeUsers || 0),
    });
  }
  const willReuse = Boolean(await findActiveSession(training.appId, clientId));
  if (client && !willReuse) {
    const quotaError = assertLifetimeQuota(client, "session", 1);
    if (quotaError) {
      return fail(res, 400, quotaError);
    }
  }

  // Idempotent: reuse the current non-terminal session if one already exists
  // (prevents duplicate sessions on repeated Launch Hall), else create one.
  const { session, created } = await ensureGroupSession({
    training,
    createdBy: req.user?.appId || "",
    allowRecreate: true,
  });

  // Lifetime consume happens ONLY on actual creation (never on reuse) → delete/
  // recreate cannot reclaim quota (this counter is never decremented anywhere).
  if (client && created) {
    client.sessionUsedLifetime = Number(client.sessionUsedLifetime || 0) + 1;
    await client.save();
  }

  return ok(res, created ? "Group session created." : "Existing group session reused.", {
    session: adminSessionView(session, countInvited(training)),
    joinCode: session.joinCode,
    qrToken: session.qrToken,
    reused: !created,
  });
};

// GET /group-sessions/:gsId/debug — live proof of session identity + room
// membership (real socket ids). Use this to verify hall + trainees share the
// same room and resolve to the same session.
const debugSnapshot = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const session = await GroupSession.findOne({ appId: req.params.gsId, clientId }).lean();
  if (!session) return fail(res, 404, "Group session not found.");

  const runtime = req.app.get("groupRuntime");
  const room = runtime ? await runtime.getRoomInfo(session.appId) : null;

  return ok(res, "Group session debug snapshot.", {
    identity: {
      gsId: session.appId,
      trainingId: session.trainingId,
      joinCode: session.joinCode,
      qrToken: session.qrToken,
      lifecycle: session.lifecycle,
      phase: session.phase,
      startTime: session.startTime,
      endTime: session.endTime,
      currentSlideIndex: session.currentSlideIndex,
    },
    room, // { room, socketCount, members:[{socketId, role, sub}] }
    attendees: (session.attendees || []).map((a) => ({
      traineeId: a.traineeId, name: a.name, email: a.email,
      connected: a.connected, attendanceState: a.attendanceState,
    })),
    queue: (session.queue || []).map((q) => ({ traineeId: q.traineeId, name: q.name })),
  });
};

// GET /group-sessions/:gsId/live
const getLiveSnapshot = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const session = await GroupSession.findOne({ appId: req.params.gsId, clientId }).lean();

  if (!session) {
    return fail(res, 404, "Group session not found.");
  }

  const training = await findTrainingById(session.trainingId);
  return ok(res, "Live session snapshot.", {
    session: adminSessionView(session, countInvited(training)),
  });
};

// POST /group-sessions/:gsId/control  { action: pause|resume|skip-queue|end }
const controlGroupSession = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const session = await GroupSession.findOne({ appId: req.params.gsId, clientId });

  if (!session) {
    return fail(res, 404, "Group session not found.");
  }

  const runtime = req.app.get("groupRuntime");
  if (!runtime) {
    return fail(res, 503, "Realtime runtime is not available.");
  }

  const action = normalizeValue(req.body?.action).toLowerCase();
  try {
    await runtime.adminControl(session.appId, action, req.body || {});
  } catch (error) {
    return fail(res, 400, error instanceof Error ? error.message : "Control action failed.");
  }

  const refreshed = await GroupSession.findOne({ appId: session.appId }).lean();
  const training = await findTrainingById(session.trainingId);
  return ok(res, `Action '${action}' applied.`, {
    session: adminSessionView(refreshed, countInvited(training)),
  });
};

// ----------------------------------------------------------------------------
// Public endpoints
// ----------------------------------------------------------------------------

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Resolve a session from a join key. Accepts (in priority order):
//  1. qrToken (from the Hall QR), joinCode, or the GroupSession id (gs-…)
//  2. a trainingId (from assignment emails) → the latest non-terminal session
//     for that training, so email links enter the same flow as the QR.
const findSessionByJoinKey = async (key) => {
  const normalized = normalizeValue(key);
  if (!normalized) return null;

  const direct = await GroupSession.findOne({
    $or: [
      { qrToken: normalized },
      { joinCode: normalized.toUpperCase() },
      { appId: normalized },
    ],
  });
  if (direct) return direct;

  // Fallback: training-scoped email link → THE single active session for that
  // training (RULE 2). findActiveSession uses the same selector ensureGroupSession
  // uses, and the DB partial unique index guarantees there is at most one — so
  // email, QR and the Hall always converge on the same gsId. Match the training
  // id case-insensitively first to get the canonical id.
  const groupTraining = await findGroupTrainingByAppId(normalized);
  if (!groupTraining) return null;

  const existingActive = await findActiveSession(groupTraining.appId, groupTraining.clientId);
  if (existingActive) return existingActive;

  // None yet → auto-create (only for approved group trainings).
  if (normalizeValue(groupTraining.payload?.status) === "approved") {
    const { session } = await ensureGroupSession({ training: groupTraining, createdBy: "auto-resolve" });
    return session;
  }
  return null;
};

// GET /group/:joinToken/resolve  -> validate + return session header + branding
const resolveJoin = async (req, res) => {
  const session = await findSessionByJoinKey(req.params.joinToken);

  if (!session) {
    // Invalid / unknown QR or code -> friendly 404 for the error page.
    return fail(res, 404, "This QR code or join link is invalid.");
  }

  const training = await findTrainingById(session.trainingId);
  const branding = training ? await buildLaunchBrandingPayload(training) : {};

  // Completed/cancelled -> let the client show a completion screen (200 + flag).
  if (TERMINAL.includes(session.lifecycle)) {
    return ok(res, "This group session has ended.", {
      session: publicSessionView(session),
      branding,
      ended: true,
    });
  }

  // Expired by end time even if not formally completed.
  if (session.endTime && Date.now() > new Date(session.endTime).getTime()) {
    return ok(res, "This group session has expired.", {
      session: publicSessionView(session),
      branding,
      ended: true,
    });
  }

  return ok(res, "Group session resolved.", {
    session: publicSessionView(session),
    branding,
    joinCode: session.joinCode,
  });
};

// POST /group/:gsId/join  { authToken }  (trainee must be authenticated)
const joinGroupSession = async (req, res) => {
  const session = await findSessionByJoinKey(req.params.gsId);

  if (!session) {
    return fail(res, 404, "This QR code or join link is invalid.");
  }

  const viewer = req.user; // populated by authTokenAdmin on this route
  const viewerEmail = normalizeValue(viewer?.email).toLowerCase();
  // Include a machine-readable `reason` so the client can render the correct
  // error SCREEN (not a generic toast).
  const deny = (status, reason, message) => {
    void logJoinAttempt(session, { traineeId: viewer?.appId, email: viewerEmail, outcome: "denied", reason });
    return fail(res, status, message, { reason });
  };

  if (TERMINAL.includes(session.lifecycle) ||
    (session.endTime && Date.now() > new Date(session.endTime).getTime())) {
    return deny(410, "expired", "This group session has ended.");
  }

  if (!viewer || normalizeValue(viewer.role) !== "trainee") {
    return deny(403, "not-trainee", "Only trainees can join a group session.");
  }
  if (normalizeValue(viewer.clientId) !== normalizeValue(session.clientId)) {
    return deny(403, "wrong-org", "You are not part of this organization.");
  }
  if (normalizeValue(viewer.status).toLowerCase() === "inactive") {
    return deny(403, "blocked", "Your account is blocked.");
  }

  const training = await findTrainingById(session.trainingId);
  if (!training) {
    return deny(404, "no-training", "Training not found.");
  }

  // Must be assigned: an assigned trainee has a session record (by email/ssoId).
  const sessions = Array.isArray(training.payload?.sessions) ? training.payload.sessions : [];
  const isAssigned = sessions.some(
    (s) => normalizeValue(s?.learnerEmail).toLowerCase() === viewerEmail ||
      normalizeValue(s?.ssoId).toLowerCase() === viewerEmail,
  );
  if (!isAssigned) {
    return deny(403, "not-assigned", "You are not assigned to this training.");
  }

  // Single-session lock: not already an active attendee elsewhere.
  const otherLive = await GroupSession.findOne({
    appId: { $ne: session.appId },
    lifecycle: { $in: LIVE_LIFECYCLES },
    attendees: { $elemMatch: { traineeId: viewer.appId, connected: true } },
  }).lean();
  if (otherLive) {
    return deny(409, "dual-session", "You are already joined in another live session.");
  }

  // Capacity check on distinct attendees.
  const alreadyAttendee = (session.attendees || []).some((a) => a.traineeId === viewer.appId);
  if (!alreadyAttendee && (session.attendees || []).length >= session.capacity) {
    return deny(409, "at-capacity", "This session is at full capacity.");
  }

  void logJoinAttempt(session, { traineeId: viewer.appId, email: viewerEmail, outcome: "success", reason: "" });

  const token = signSessionToken({
    gsId: session.appId,
    clientId: session.clientId,
    sub: viewer.appId,
    role: "trainee",
    name: viewer.fullname || viewer.name,
    email: viewer.email,
  });

  const launchPayload = await buildLaunchPayload({ training, viewer, preview: false });

  return ok(res, "Joined group session.", {
    token,
    session: publicSessionView(session),
    training: launchPayload,
    me: { traineeId: viewer.appId, name: viewer.fullname || viewer.name },
  });
};

// GET /group/:gsId/host  -> Hall Screen kiosk bootstrap (admin/trainer auth)
const bootstrapHost = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const session = await GroupSession.findOne({ appId: req.params.gsId, clientId }).lean();

  if (!session) {
    return fail(res, 404, "Group session not found.");
  }

  const training = await findTrainingById(session.trainingId);
  if (!training) {
    return fail(res, 404, "Training not found.");
  }

  const token = signSessionToken({
    gsId: session.appId,
    clientId: session.clientId,
    sub: req.user.appId,
    role: "host",
    name: req.user.fullname || req.user.name,
  });

  const launchPayload = await buildLaunchPayload({ training, viewer: req.user, preview: true });

  return ok(res, "Host bootstrap ready.", {
    token,
    session: publicSessionView(session),
    qrToken: session.qrToken,
    joinCode: session.joinCode,
    training: launchPayload,
  });
};

// POST /group/:gsId/ask  { token, message }  (server-gated to active speaker)
const askGroupQuestion = async (req, res) => {
  const session = await GroupSession.findOne({ appId: req.params.gsId });

  if (!session) {
    return fail(res, 404, "Group session not found.");
  }

  if (session.lifecycle !== LIFECYCLE.LIVE) {
    return fail(res, 409, "The session is not live.");
  }

  const tokenPayload = verifySessionToken(normalizeValue(req.body?.token));
  if (!tokenPayload || tokenPayload.gsId !== session.appId) {
    return fail(res, 401, "Invalid session token.");
  }

  const traineeId = normalizeValue(tokenPayload.sub);
  if (normalizeValue(session.activeSpeakerId) !== traineeId || !traineeId) {
    return fail(res, 403, "You do not currently have the floor.");
  }

  const message = normalizeValue(req.body?.message);
  if (!message) {
    return fail(res, 400, "Question is required.");
  }
  // Feature 1: how the question was asked. Anything other than "text" is treated
  // as voice (default), so existing voice callers that send no questionType keep
  // working unchanged.
  const questionType = normalizeValue(req.body?.questionType) === "text" ? "text" : "voice";
  logger.qa.info("Question Received", { gsId: session.appId, traineeId, chars: message.length, questionType });

  const training = await findTrainingById(session.trainingId);
  if (!training) {
    return fail(res, 404, "Training not found.");
  }

  try {
    // Conversation memory parity with One-on-One: pass recent session Q&A as
    // history so follow-up questions ("which version did you mention?") have
    // context. The hall is a shared room, so the whole session's recent Q&A is
    // the conversation.
    const history = (session.transcripts || [])
      .slice(-5)
      .flatMap((t) => [
        { role: "user", content: normalizeValue(t.question) },
        { role: "assistant", content: normalizeValue(t.answer) },
      ])
      .filter((entry) => entry.content);
    const reply = await createTrainingReply({ training, message, history });
    const attendee = (session.attendees || []).find((a) => a.traineeId === traineeId);

    const askedAt = new Date();
    // Floor duration for this question: granted → answered. 0 when unknown.
    const speakerDurationMs = session.floorGrantedAt
      ? Math.max(0, askedAt.getTime() - new Date(session.floorGrantedAt).getTime())
      : 0;
    session.transcripts.push({
      traineeId,
      name: attendee?.name || "",
      question: message,
      answer: reply,
      askedAt,
      questionType,
      // Feature 3: answer playback is about to start (hall will speak the reply).
      // Completion (answeredAt) is stamped by the runtime on host:answer-complete
      // (or the safety timeout), so responseTimeSec reflects full answer time.
      answerStartedAt: new Date(),
      answeredAt: null,
      speakerDurationMs,
    });
    if (attendee) {
      attendee.questionsAsked = Number(attendee.questionsAsked || 0) + 1;
      attendee.questionsAnswered = Number(attendee.questionsAnswered || 0) + 1;
    }
    await session.save();

    // Broadcast the answer so the Hall Screen speaks it.
    const runtime = req.app.get("groupRuntime");
    if (runtime) {
      runtime.broadcastAnswer(session.appId, { traineeId, question: message, answer: reply });
    }

    return ok(res, "Answer ready.", { reply });
  } catch (error) {
    return fail(res, 502, error instanceof Error ? error.message : "Unable to answer right now.");
  }
};

// ---- Phase 1: Consolidated Group Training Report (read-only) --------------
// Aggregates entirely from the persisted GroupSession document, so it works for
// both live and completed sessions and adds NO new write paths. The PDF is
// produced client-side (frontend already ships jspdf); this endpoint returns
// structured JSON only.
const mean = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);
const msToMin = (ms) => Math.round((Number(ms || 0) / 60000) * 10) / 10;

// A session is "final" only once it has reached a terminal lifecycle; otherwise
// attendance %, completion and drop-off are still being accumulated and must be
// presented as provisional (Task 1).
const isFinalLifecycle = (lifecycle) => TERMINAL.includes(lifecycle);

const buildConsolidatedReport = (session, training) => {
  const attendees = Array.isArray(session.attendees) ? session.attendees : [];
  const transcripts = Array.isArray(session.transcripts) ? session.transcripts : [];
  const startedAt = session.startedAt ? new Date(session.startedAt) : null;
  const endedAt = session.endedAt ? new Date(session.endedAt) : null;
  const elapsedMs = startedAt ? (endedAt || new Date()).getTime() - startedAt.getTime() : 0;
  const isFinal = isFinalLifecycle(session.lifecycle);
  const reportStatus = isFinal ? "final" : "live";

  // Question-type availability: the field is only persisted once the text-Q&A
  // feature lands (Phase 3). Until any transcript actually carries a stored
  // questionType, we report null (NOT a fake "voice") — Task 2.
  const hasQuestionTypes = transcripts.some((t) => normalizeValue(t.questionType));
  const hasResponseTimes = transcripts.some((t) => t.answeredAt);
  const hasSpeakerDurations = transcripts.some((t) => Number(t.speakerDurationMs || 0) > 0);
  const submittedAssessments = attendees.filter((a) => a.assessment?.submitted);
  const hasAssessmentData = submittedAssessments.length > 0;
  const passedAssessments = submittedAssessments.filter((a) => a.assessment?.passFail === "pass");
  const assessmentScores = submittedAssessments.map((a) => Number(a.assessment?.score || 0));
  // Feature 4: proctoring aggregates.
  const proctored = attendees.filter((a) => (a.proctoring?.events || []).length > 0 || Number(a.proctoring?.riskScore || 0) > 0);
  const hasProctoringData = proctored.length > 0;
  const riskScores = proctored.map((a) => Number(a.proctoring?.riskScore || 0));

  const typesByTrainee = new Map();
  transcripts.forEach((t) => {
    const stored = normalizeValue(t.questionType);
    if (!stored) return; // only aggregate REAL stored types
    const id = normalizeValue(t.traineeId);
    if (!typesByTrainee.has(id)) typesByTrainee.set(id, new Set());
    typesByTrainee.get(id).add(stored);
  });

  // Live vs final attendance %: in a final session use the persisted, computed
  // attendancePct; in a live session compute a PROVISIONAL current value from
  // totalActiveMs / elapsed, WITHOUT mutating the DB (Task 4).
  const liveAttendancePct = (a) => {
    if (!elapsedMs || elapsedMs <= 0) return 0;
    return Math.min(100, Math.round((Number(a.totalActiveMs || 0) / elapsedMs) * 100));
  };
  const attendancePctOf = (a) => (isFinal ? Number(a.attendancePct || 0) : liveAttendancePct(a));
  const completionOf = (a) => (isFinal ? a.completionStatus || "in-progress" : "in-progress");

  const joined = attendees.filter((a) => a.joinedAt);
  const completed = attendees.filter((a) => completionOf(a) === "completed");
  const attendancePcts = attendees.map(attendancePctOf);

  const participants = attendees.map((a) => ({
    name: a.name || "",
    email: a.email || "",
    joinTime: a.joinedAt || null,
    leaveTime: a.leftAt || null,
    durationMin: msToMin(a.totalActiveMs),
    attendancePct: attendancePctOf(a),
    completionStatus: completionOf(a),
    questionsAsked: Number(a.questionsAsked || 0),
    handRaises: Number(a.handRaises || 0),
    // null when the feature hasn't stored any types yet, so the UI shows N/A
    // rather than a fabricated value (Task 2).
    questionTypes: hasQuestionTypes ? Array.from(typesByTrainee.get(normalizeValue(a.traineeId)) || []) : null,
    lastActivity: a.lastActiveConfirmAt || a.lastHeartbeat || a.leftAt || a.joinedAt || null,
    // Feature 2: assessment result (null when not taken).
    assessmentScore: a.assessment?.submitted ? (a.assessment.score ?? null) : null,
    assessmentPassFail: a.assessment?.submitted ? (a.assessment.passFail || null) : null,
    assessmentTimeTakenMs: a.assessment?.submitted ? Number(a.assessment.timeTakenMs || 0) : null,
    // Feature 4: per-participant proctoring summary.
    proctoringRiskScore: Number(a.proctoring?.riskScore || 0),
    proctoringEventCount: Array.isArray(a.proctoring?.events) ? a.proctoring.events.length : 0,
  }));

  const interactions = transcripts.map((t) => {
    const storedType = normalizeValue(t.questionType);
    const answeredAt = t.answeredAt || null;
    return {
      question: t.question || "",
      questionType: storedType || null, // Task 2: no fake "voice"
      askedBy: t.name || "",
      askedAt: t.askedAt || null,
      answeredAt, // Task 2: null until persisted (Phase 3)
      responseTimeSec:
        t.askedAt && answeredAt
          ? Math.max(0, Math.round((new Date(answeredAt).getTime() - new Date(t.askedAt).getTime()) / 1000))
          : null,
      speakerDurationMs: Number(t.speakerDurationMs || 0) || null,
    };
  });

  const byActive = [...attendees].sort((a, b) => Number(b.totalActiveMs || 0) - Number(a.totalActiveMs || 0));
  const byQuestions = [...attendees].sort((a, b) => Number(b.questionsAsked || 0) - Number(a.questionsAsked || 0));
  const byAttendanceDesc = [...attendees].sort((a, b) => attendancePctOf(b) - attendancePctOf(a));
  const engagedCount = attendees.filter(
    (a) => Number(a.questionsAsked || 0) > 0 || Number(a.handRaises || 0) > 0,
  ).length;

  return {
    // Task 1 + Task 6: top-level metadata so the UI/PDF can label provisional data.
    reportStatus,
    dataQuality: {
      reportStatus,
      hasQuestionTypes,
      hasResponseTimes,
      hasSpeakerDurations,
      hasAssessmentData,
      hasProctoringData,
    },
    sessionSummary: {
      trainingName: training?.payload?.title || session.trainingTitle || "",
      trainingId: session.trainingId,
      sessionId: session.appId,
      lifecycle: session.lifecycle,
      date: startedAt,
      startTime: startedAt,
      endTime: endedAt,
      durationMin: msToMin(elapsedMs),
      invitedCount: countInvited(training),
      joinedCount: joined.length,
      // Provisional in a live session (no one is "completed" until end).
      completedCount: completed.length,
      dropOffCount: isFinal ? Math.max(0, joined.length - completed.length) : 0,
      averageAttendancePct: Math.round(mean(attendancePcts)),
      averageDurationMin: msToMin(mean(attendees.map((a) => Number(a.totalActiveMs || 0)))),
      totalQuestions: transcripts.length,
      totalVoiceQuestions: transcripts.filter((t) => (normalizeValue(t.questionType) || "voice") === "voice").length,
      totalTextQuestions: transcripts.filter((t) => normalizeValue(t.questionType) === "text").length,
      // Feature 3: share of questions asked via text (0–1, 2dp). 0 when none.
      textQuestionRatio: transcripts.length
        ? Math.round((transcripts.filter((t) => normalizeValue(t.questionType) === "text").length / transcripts.length) * 100) / 100
        : 0,
      totalHandRaises: attendees.reduce((sum, a) => sum + Number(a.handRaises || 0), 0),
      // Feature 2: assessment summary (only meaningful when hasAssessmentData).
      assessmentSubmittedCount: submittedAssessments.length,
      assessmentPassedCount: passedAssessments.length,
      assessmentPassRatePct: submittedAssessments.length
        ? Math.round((passedAssessments.length / submittedAssessments.length) * 100)
        : 0,
      averageAssessmentScore: assessmentScores.length ? Math.round(mean(assessmentScores)) : null,
      // Feature 4: proctoring summary.
      averageRiskScore: riskScores.length ? Math.round(mean(riskScores)) : 0,
      totalProctoringEvents: proctored.reduce((s, a) => s + (a.proctoring?.events || []).length, 0),
    },
    participants,
    interactions,
    engagement: {
      mostActiveParticipant: byActive[0]?.name || "—",
      mostQuestionsAsked: byQuestions[0] && Number(byQuestions[0].questionsAsked || 0) > 0 ? byQuestions[0].name : "—",
      highestAttendance: byAttendanceDesc[0]
        ? { name: byAttendanceDesc[0].name, pct: attendancePctOf(byAttendanceDesc[0]) }
        : null,
      lowestAttendance: byAttendanceDesc.length
        ? { name: byAttendanceDesc[byAttendanceDesc.length - 1].name, pct: attendancePctOf(byAttendanceDesc[byAttendanceDesc.length - 1]) }
        : null,
      // Drop-off only meaningful once final; provisional sessions report 0.
      dropOffRatePct: isFinal && joined.length ? Math.round(((joined.length - completed.length) / joined.length) * 100) : 0,
      participationRatePct: joined.length ? Math.round((engagedCount / joined.length) * 100) : 0,
    },
  };
};

// GET /group-sessions/:gsId/report  (admin/trainer/super_admin)
const getConsolidatedReport = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const session = await GroupSession.findOne({ appId: req.params.gsId, clientId }).lean();
  if (!session) {
    return fail(res, 404, "Group session not found.");
  }
  const training = await findTrainingById(session.trainingId);
  return ok(res, "Consolidated group training report.", {
    report: buildConsolidatedReport(session, training),
  });
};

// GET /training-workspace/:trainingId/group-report  (Task 5)
// Aggregates ALL group sessions of one training (foundation for the Training
// Dashboard / analytics). Read-only; builds no UI.
const getTrainingGroupReport = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const trainingId = normalizeValue(req.params.trainingId);
  const training = await findTrainingById(trainingId);
  if (!training) {
    return fail(res, 404, "Training not found.");
  }
  const sessions = await GroupSession.find({ trainingId, clientId }).sort({ createdAt: -1 }).lean();
  const reports = sessions.map((s) => buildConsolidatedReport(s, training));
  const finals = reports.filter((r) => r.reportStatus === "final");

  const sumBy = (arr, fn) => arr.reduce((acc, r) => acc + fn(r), 0);
  const avg = (arr, fn) => (arr.length ? Math.round(sumBy(arr, fn) / arr.length) : 0);

  return ok(res, "Training-level group report.", {
    report: {
      trainingId,
      trainingName: training?.payload?.title || "",
      sessionsCount: sessions.length,
      finalSessionsCount: finals.length,
      invitedCount: countInvited(training),
      joinedCount: sumBy(reports, (r) => r.sessionSummary.joinedCount),
      completedCount: sumBy(reports, (r) => r.sessionSummary.completedCount),
      // Averages computed over FINAL sessions only (live ones are provisional).
      avgAttendancePct: avg(finals, (r) => r.sessionSummary.averageAttendancePct),
      avgQuestionsAsked: finals.length
        ? Math.round((sumBy(finals, (r) => r.sessionSummary.totalQuestions) / finals.length) * 10) / 10
        : 0,
      // Feature 2: assessment aggregates across final sessions that have data.
      assessmentPassRatePct: (() => {
        const subs = finals.reduce((s, r) => s + r.sessionSummary.assessmentSubmittedCount, 0);
        const pass = finals.reduce((s, r) => s + r.sessionSummary.assessmentPassedCount, 0);
        return subs ? Math.round((pass / subs) * 100) : 0;
      })(),
      avgAssessmentScore: (() => {
        const withScore = finals.filter((r) => r.sessionSummary.averageAssessmentScore != null);
        return withScore.length
          ? Math.round(withScore.reduce((s, r) => s + r.sessionSummary.averageAssessmentScore, 0) / withScore.length)
          : null;
      })(),
      // Feature 4: average proctoring risk across final sessions that have data.
      averageRiskScore: (() => {
        const withRisk = finals.filter((r) => r.dataQuality.hasProctoringData);
        return withRisk.length
          ? Math.round(withRisk.reduce((s, r) => s + r.sessionSummary.averageRiskScore, 0) / withRisk.length)
          : 0;
      })(),
      sessions: reports.map((r) => ({
        sessionId: r.sessionSummary.sessionId,
        reportStatus: r.reportStatus,
        date: r.sessionSummary.date,
        durationMin: r.sessionSummary.durationMin,
        joinedCount: r.sessionSummary.joinedCount,
        completedCount: r.sessionSummary.completedCount,
        averageAttendancePct: r.sessionSummary.averageAttendancePct,
        totalQuestions: r.sessionSummary.totalQuestions,
        averageAssessmentScore: r.sessionSummary.averageAssessmentScore,
        assessmentPassRatePct: r.sessionSummary.assessmentPassRatePct,
      })),
    },
  });
};

// ---- Training-Level Analytics (read-only aggregation) -------------------
// GET /training/:trainingId/analytics — aggregates ALL group sessions of one
// training. Reuses buildConsolidatedReport per session (no new aggregation
// logic, no schema/scheduler/queue/assessment/proctoring changes).
const getTrainingAnalytics = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const trainingId = normalizeValue(req.params.trainingId);
  const training = await findTrainingById(trainingId);
  if (!training) return fail(res, 404, "Training not found.");

  const sessions = await GroupSession.find({ trainingId, clientId }).sort({ createdAt: -1 }).lean();
  const reports = sessions.map((s) => buildConsolidatedReport(s, training));
  const finals = reports.filter((r) => r.reportStatus === "final");

  const sum = (arr, fn) => arr.reduce((a, r) => a + (Number(fn(r)) || 0), 0);
  const meanOf = (arr, fn) => (arr.length ? Math.round(sum(arr, fn) / arr.length) : 0);

  const totalQuestions = sum(reports, (r) => r.sessionSummary.totalQuestions);
  const totalVoiceQuestions = sum(reports, (r) => r.sessionSummary.totalVoiceQuestions);
  const totalTextQuestions = sum(reports, (r) => r.sessionSummary.totalTextQuestions);
  const totalSubmitted = sum(reports, (r) => r.sessionSummary.assessmentSubmittedCount);
  const totalPassed = sum(reports, (r) => r.sessionSummary.assessmentPassedCount);
  const scoredSessions = finals.filter((r) => r.sessionSummary.averageAssessmentScore != null);
  const proctoredSessions = finals.filter((r) => r.dataQuality.hasProctoringData);
  const durationSessions = finals.filter((r) => r.sessionSummary.durationMin > 0);

  return ok(res, "Training analytics.", {
    analytics: {
      trainingId,
      trainingName: training?.payload?.title || "",
      totalSessions: sessions.length,
      completedSessions: finals.length,
      liveSessions: sessions.length - finals.length,
      totalInvited: countInvited(training),
      totalJoined: sum(reports, (r) => r.sessionSummary.joinedCount),
      totalCompleted: sum(reports, (r) => r.sessionSummary.completedCount),
      avgAttendancePct: meanOf(finals, (r) => r.sessionSummary.averageAttendancePct),
      avgSessionDuration: meanOf(durationSessions, (r) => r.sessionSummary.durationMin),
      avgQuestionsPerSession: sessions.length ? Math.round((totalQuestions / sessions.length) * 10) / 10 : 0,
      totalQuestions,
      totalVoiceQuestions,
      totalTextQuestions,
      textQuestionRatio: totalQuestions ? Math.round((totalTextQuestions / totalQuestions) * 100) / 100 : 0,
      avgAssessmentScore: scoredSessions.length
        ? Math.round(sum(scoredSessions, (r) => r.sessionSummary.averageAssessmentScore) / scoredSessions.length)
        : null,
      assessmentPassRate: totalSubmitted ? Math.round((totalPassed / totalSubmitted) * 100) : 0,
      avgRiskScore: meanOf(proctoredSessions, (r) => r.sessionSummary.averageRiskScore),
      totalProctoringEvents: sum(reports, (r) => r.sessionSummary.totalProctoringEvents),
      // Session trend (newest-first as queried; chart can reverse for chronology).
      sessionTrend: reports.map((r) => ({
        sessionId: r.sessionSummary.sessionId,
        sessionDate: r.sessionSummary.date,
        reportStatus: r.reportStatus,
        joinedCount: r.sessionSummary.joinedCount,
        attendancePct: r.sessionSummary.averageAttendancePct,
        questionsAsked: r.sessionSummary.totalQuestions,
        assessmentPassRate: r.sessionSummary.assessmentPassRatePct,
        riskScore: r.sessionSummary.averageRiskScore,
      })),
    },
  });
};

// ---- Feature 2: End-of-training assessment ------------------------------
// Auth is ALWAYS derived from the session token's `sub` (never a body field).
const authenticateTrainee = (req, session) => {
  const tokenPayload = verifySessionToken(normalizeValue(req.body?.token || req.query?.token));
  if (!tokenPayload || tokenPayload.gsId !== session.appId) return null;
  const traineeId = normalizeValue(tokenPayload.sub);
  return traineeId || null;
};

// Lazily capture the snapshot if it doesn't exist yet (covers sessions that were
// created before this feature, or a fetch before the session ended).
const ensureSnapshot = async (session) => {
  if (session.assessmentSnapshot?.capturedAt) return session.assessmentSnapshot;
  const training = await findTrainingById(session.trainingId);
  session.assessmentSnapshot = buildAssessmentSnapshot(training, session.config);
  await session.save();
  return session.assessmentSnapshot;
};

// GET /group/:gsId/assessment?token=...  → checkpoints WITHOUT answer keys.
const getGroupAssessment = async (req, res) => {
  const session = await GroupSession.findOne({ appId: req.params.gsId });
  if (!session) return fail(res, 404, "Group session not found.");
  const traineeId = authenticateTrainee(req, session);
  if (!traineeId) return fail(res, 401, "Invalid session token.");

  const snapshot = await ensureSnapshot(session);
  const checkpoints = publicCheckpoints(snapshot.checkpoints); // strips expectedAnswer/keywordMatches
  const requireAssessmentPass = Boolean(session.config?.completionRules?.requireAssessmentPass);
  const attendee = (session.attendees || []).find((a) => a.traineeId === traineeId);

  return ok(res, "Assessment.", {
    // Requirement 12: no questions → trainee auto-skips (attendance-only).
    available: checkpoints.length > 0,
    skipAllowed: !requireAssessmentPass, // optional unless a pass is required
    passPct: snapshot.passPct,
    alreadySubmitted: Boolean(attendee?.assessment?.submitted),
    result: attendee?.assessment?.submitted
      ? { score: attendee.assessment.score, passFail: attendee.assessment.passFail }
      : null,
    checkpoints,
  });
};

// POST /group/:gsId/assessment  { token, answers, startedAt? }
// Server-side grading; idempotent; never blocks session lifecycle.
const submitGroupAssessment = async (req, res) => {
  const session = await GroupSession.findOne({ appId: req.params.gsId });
  if (!session) return fail(res, 404, "Group session not found.");
  const traineeId = authenticateTrainee(req, session);
  if (!traineeId) return fail(res, 401, "Invalid session token.");

  const attendee = (session.attendees || []).find((a) => a.traineeId === traineeId);
  if (!attendee) return fail(res, 403, "You are not a participant of this session.");

  // Idempotency: never re-grade or overwrite a submitted assessment (replay-safe).
  if (attendee.assessment?.submitted) {
    return ok(res, "Assessment already submitted.", {
      score: attendee.assessment.score,
      passFail: attendee.assessment.passFail,
      completionStatus: attendee.completionStatus,
      idempotent: true,
    });
  }

  const snapshot = await ensureSnapshot(session);

  // Normalize answers → { [checkpointId]: response }. Accept object or array form.
  const raw = req.body?.answers;
  const answers = {};
  if (Array.isArray(raw)) {
    raw.forEach((a) => { if (a && a.checkpointId) answers[normalizeValue(a.checkpointId)] = a.response; });
  } else if (raw && typeof raw === "object") {
    Object.entries(raw).forEach(([k, v]) => { answers[normalizeValue(k)] = v; });
  }

  const graded = gradeAssessment(snapshot.checkpoints, answers, snapshot.passPct);
  const startedAt = req.body?.startedAt ? new Date(req.body.startedAt) : new Date();
  const completedAt = new Date();
  attendee.assessment = {
    startedAt,
    completedAt,
    score: graded.score,
    passFail: graded.passFail,
    timeTakenMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    submitted: true,
    answers: graded.gradedAnswers,
  };
  attendee.assessmentScore = graded.score; // flatten back-compat

  // Recompute completion ONLY when the session has ended (attendance is final).
  // While live, endSession will combine attendance + this assessment later.
  const isTerminal = [LIFECYCLE.COMPLETED, LIFECYCLE.CANCELLED].includes(session.lifecycle);
  if (isTerminal) {
    const minPct = Number(session.config?.completionRules?.minAttendancePct || 75);
    const requireAssessmentPass = Boolean(session.config?.completionRules?.requireAssessmentPass);
    attendee.completionStatus = resolveCompletionStatus({
      attendancePass: Number(attendee.attendancePct || 0) >= minPct,
      requireAssessmentPass,
      hasAssessment: (snapshot.checkpoints || []).length > 0,
      assessment: attendee.assessment,
    });
    if (attendee.completionStatus === "completed") attendee.attendanceState = ATTENDANCE_STATE.COMPLETED;
    attendee.completionTime = new Date();
  }
  await session.save();
  logger.qa.info("Assessment submitted", { gsId: session.appId, traineeId, score: graded.score, passFail: graded.passFail });

  // Requirement 11: re-flatten so reports/exports get the updated score.
  if (isTerminal) {
    const runtime = req.app.get("groupRuntime");
    if (runtime?.reflattenSession) {
      try { await runtime.reflattenSession(session.appId); }
      catch (error) { logger.error.error("assessment:reflatten-failed", { gsId: session.appId, error: error?.message }); }
    }
  }

  return ok(res, "Assessment submitted.", {
    score: graded.score,
    passFail: graded.passFail,
    completionStatus: attendee.completionStatus,
  });
};

// ---- Feature 4: Proctoring Lite (event-only, no video) ------------------
const PROCTORING_WEIGHTS = Object.freeze({
  CAMERA_DENIED: 30,
  CAMERA_OFF: 20,
  MULTIPLE_FACES: 20,
  NO_FACE: 15,
  TAB_SWITCH: 10,
  WINDOW_BLUR: 10,
});
const PROCTORING_SEVERITY = (type) => {
  const w = PROCTORING_WEIGHTS[type] || 0;
  return w >= 20 ? "high" : w >= 15 ? "medium" : "low";
};
const PROCTORING_EVENTS_CAP = 100;

// POST /group/:gsId/proctoring  { token, events:[{ type, ts? }] }
// Batched (client sends every ~10s). Authenticated trainee only; no frames.
const submitProctoringEvents = async (req, res) => {
  const session = await GroupSession.findOne({ appId: req.params.gsId });
  if (!session) return fail(res, 404, "Group session not found.");
  const traineeId = authenticateTrainee(req, session);
  if (!traineeId) return fail(res, 401, "Invalid session token.");

  const attendee = (session.attendees || []).find((a) => a.traineeId === traineeId);
  if (!attendee) return fail(res, 403, "You are not a participant of this session.");

  const incoming = Array.isArray(req.body?.events) ? req.body.events : [];
  if (!attendee.proctoring) attendee.proctoring = { riskScore: 0, events: [] };
  incoming.forEach((e) => {
    const type = normalizeValue(e?.type).toUpperCase();
    if (!(type in PROCTORING_WEIGHTS)) return; // ignore unknown event types
    attendee.proctoring.events.push({
      ts: e?.ts ? new Date(e.ts) : new Date(),
      type,
      severity: PROCTORING_SEVERITY(type),
    });
  });
  // Cap stored events to bound document growth.
  if (attendee.proctoring.events.length > PROCTORING_EVENTS_CAP) {
    attendee.proctoring.events = attendee.proctoring.events.slice(-PROCTORING_EVENTS_CAP);
  }
  // Cumulative risk, capped at 100.
  const risk = attendee.proctoring.events.reduce((sum, ev) => sum + (PROCTORING_WEIGHTS[ev.type] || 0), 0);
  attendee.proctoring.riskScore = Math.min(100, risk);
  await session.save();

  return ok(res, "Proctoring events recorded.", {
    riskScore: attendee.proctoring.riskScore,
    eventCount: attendee.proctoring.events.length,
  });
};

module.exports = {
  createGroupSession,
  getLiveSnapshot,
  debugSnapshot,
  controlGroupSession,
  resolveJoin,
  joinGroupSession,
  bootstrapHost,
  askGroupQuestion,
  getConsolidatedReport,
  getTrainingGroupReport,
  getTrainingAnalytics,
  getGroupAssessment,
  submitGroupAssessment,
  submitProctoringEvents,
};
