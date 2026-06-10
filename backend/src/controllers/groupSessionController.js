const crypto = require("crypto");
const Training = require("../models/Training");
const Client = require("../models/Client");
const User = require("../models/User");
const GroupSession = require("../models/GroupSession");
const { ok, fail } = require("../helpers/response");
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
const { ensureGroupSession, findGroupTrainingByAppId } = require("../services/groupSessionService");

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

  // Idempotent: reuse the current non-terminal session if one already exists
  // (prevents duplicate sessions on repeated Launch Hall), else create one.
  const { session, created } = await ensureGroupSession({
    training,
    createdBy: req.user?.appId || "",
    allowRecreate: true,
  });

  return ok(res, created ? "Group session created." : "Existing group session reused.", {
    session: adminSessionView(session, countInvited(training)),
    joinCode: session.joinCode,
    qrToken: session.qrToken,
    reused: !created,
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

  // Fallback: training-scoped email link → the session that is actually running.
  // Prefer an ACTIVE session (live/waiting/starting) so trainees land in the
  // one the hall has open, not a newer still-scheduled one. Else newest scheduled.
  const trainingFilter = { trainingId: { $regex: `^${escapeRegex(normalized)}$`, $options: "i" } };
  const active = await GroupSession.findOne({
    ...trainingFilter,
    lifecycle: { $in: [LIFECYCLE.LIVE, LIFECYCLE.WAITING, LIFECYCLE.STARTING] },
  }).sort({ createdAt: -1 });
  if (active) return active;

  const scheduled = await GroupSession.findOne({
    ...trainingFilter,
    lifecycle: LIFECYCLE.SCHEDULED,
  }).sort({ createdAt: -1 });
  if (scheduled) return scheduled;

  // No session yet for this training id → if it's an approved group training,
  // auto-create one so email/QR links resolve without a manual Launch Hall.
  const training = await findGroupTrainingByAppId(normalized);
  if (training && normalizeValue(training.payload?.status) === "approved") {
    const { session } = await ensureGroupSession({ training, createdBy: "auto-resolve" });
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

    session.transcripts.push({
      traineeId,
      name: attendee?.name || "",
      question: message,
      answer: reply,
      askedAt: new Date(),
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

module.exports = {
  createGroupSession,
  getLiveSnapshot,
  controlGroupSession,
  resolveJoin,
  joinGroupSession,
  bootstrapHost,
  askGroupQuestion,
};
