const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");

const normalizeValue = (value) => String(value || "").trim();

// High-level lifecycle (backend is the source of truth).
const LIFECYCLE = Object.freeze({
  SCHEDULED: "scheduled",
  WAITING: "waiting",
  STARTING: "starting",
  LIVE: "live",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

// Sub-phase, only meaningful while lifecycle === LIVE.
const PHASE = Object.freeze({
  PRESENTING: "presenting",
  QA: "qa",
  ASSESSMENT: "assessment",
  PAUSED: "paused",
});

// Allowed lifecycle transitions. Anything else is blocked.
const LIFECYCLE_TRANSITIONS = Object.freeze({
  scheduled: ["waiting", "starting", "cancelled"],
  waiting: ["starting", "cancelled"],
  starting: ["live", "cancelled"],
  live: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
});

const canTransition = (from, to) =>
  Boolean(LIFECYCLE_TRANSITIONS[from]?.includes(to));

// Attendance progression for a single trainee.
const ATTENDANCE_STATE = Object.freeze({
  REGISTERED: "registered",
  JOINED: "joined",
  WAITING: "waiting",
  PRESENT: "present",
  COMPLETED: "completed",
});

// Map the authoritative lifecycle/phase to the legacy `status` string the
// existing clients understand (keeps hall/trainee UI working).
const legacyStatus = (session) => {
  if (session.lifecycle === LIFECYCLE.LIVE) return session.phase || PHASE.PRESENTING;
  if (session.lifecycle === LIFECYCLE.COMPLETED) return "ended";
  return session.lifecycle;
};

// Back-compat alias (older modules import SESSION_STATES / LIVE_STATES).
const SESSION_STATES = Object.freeze({
  SCHEDULED: "scheduled",
  LOBBY: "waiting",
  PRESENTING: "presenting",
  QA: "qa",
  ASSESSMENT: "assessment",
  PAUSED: "paused",
  ENDED: "completed",
  CANCELLED: "cancelled",
});

const LIVE_STATES = new Set([PHASE.PRESENTING, PHASE.QA, PHASE.ASSESSMENT, PHASE.PAUSED]);

const DEFAULT_GROUP_CONFIG = Object.freeze({
  capacity: 50,
  autoStart: { mode: "scheduled", minParticipants: 1, graceMins: 10 },
  attendanceRules: { minAttendancePct: 75, activeConfirmIntervalMins: 10 },
  qaRules: {
    maxSpeakSecs: 90,
    silenceTimeoutSecs: 20,
    maxQuestionsPerTrainee: 3,
    handRaiseCooldownSecs: 30,
  },
  completionRules: { minAttendancePct: 75, requireAssessmentPass: false },
  assessment: { passPct: 60, scoring: "both" },
});

// Merge a training's stored groupConfig over the defaults (shallow per-section).
const resolveGroupConfig = (raw = {}) => {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    capacity: Number(source.capacity || DEFAULT_GROUP_CONFIG.capacity),
    autoStart: { ...DEFAULT_GROUP_CONFIG.autoStart, ...(source.autoStart || {}) },
    attendanceRules: { ...DEFAULT_GROUP_CONFIG.attendanceRules, ...(source.attendanceRules || {}) },
    qaRules: { ...DEFAULT_GROUP_CONFIG.qaRules, ...(source.qaRules || {}) },
    completionRules: { ...DEFAULT_GROUP_CONFIG.completionRules, ...(source.completionRules || {}) },
    assessment: { ...DEFAULT_GROUP_CONFIG.assessment, ...(source.assessment || {}) },
    startTime: source.startTime || null,
    endTime: source.endTime || null,
  };
};

// 8-char human-friendly join code (no ambiguous chars).
const generateJoinCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i += 1) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
};

const generateQrToken = () => crypto.randomBytes(24).toString("base64url");

// Short signed token scoped to one group session + identity (trainee or host).
// `sub` is the stable trainee/user appId; `email` is carried for report mapping.
const signSessionToken = ({ gsId, clientId, sub, role, name, email }) =>
  jwt.sign(
    { gsId, clientId, sub, role, name: name || "", email: email || "", scope: "group-session" },
    config.authSecret,
    { expiresIn: "12h" },
  );

const verifySessionToken = (token) => {
  try {
    const payload = jwt.verify(token, config.authSecret);
    return payload?.scope === "group-session" ? payload : null;
  } catch (_error) {
    return null;
  }
};

// FIFO queue insert: idempotent on traineeId, ordered by raisedAt then arrival.
const addToQueue = (queue, entry) => {
  const next = Array.isArray(queue) ? [...queue] : [];
  if (next.some((item) => normalizeValue(item.traineeId) === normalizeValue(entry.traineeId))) {
    return next; // duplicate raise = no-op
  }
  next.push({
    traineeId: entry.traineeId,
    name: entry.name || "",
    raisedAt: entry.raisedAt || new Date(),
    priority: Number(entry.priority || 0),
  });
  return next.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return new Date(a.raisedAt).getTime() - new Date(b.raisedAt).getTime();
  });
};

const removeFromQueue = (queue, traineeId) =>
  (Array.isArray(queue) ? queue : []).filter(
    (item) => normalizeValue(item.traineeId) !== normalizeValue(traineeId),
  );

// Compute attendance % from active time against the session's elapsed duration.
const computeAttendancePct = (attendee, sessionElapsedMs) => {
  if (!sessionElapsedMs || sessionElapsedMs <= 0) {
    return 0;
  }
  const activeMs = Number(attendee?.totalActiveMs || 0);
  return Math.min(100, Math.round((activeMs / sessionElapsedMs) * 100));
};

module.exports = {
  LIFECYCLE,
  PHASE,
  LIFECYCLE_TRANSITIONS,
  canTransition,
  ATTENDANCE_STATE,
  legacyStatus,
  SESSION_STATES,
  LIVE_STATES,
  DEFAULT_GROUP_CONFIG,
  resolveGroupConfig,
  generateJoinCode,
  generateQrToken,
  signSessionToken,
  verifySessionToken,
  addToQueue,
  removeFromQueue,
  computeAttendancePct,
  normalizeValue,
};
