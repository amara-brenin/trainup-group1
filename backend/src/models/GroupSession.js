const { Schema, model, models } = require("mongoose");

// Live state for an AI-managed Group Training Hall session.
// The hot/live state lives here while the session is running; on END the
// attendees are flattened into Training.payload.sessions (reusing the existing
// TrainingSessionRecord shape) so the existing reports keep working.

const attendeeSchema = new Schema(
  {
    traineeId: { type: String, required: true },
    name: { type: String, default: "" },
    email: { type: String, default: "" },
    joinedAt: { type: Date, default: null },
    leftAt: { type: Date, default: null },
    rejoins: { type: Number, default: 0 },
    totalActiveMs: { type: Number, default: 0 },
    lastHeartbeat: { type: Date, default: null },
    lastActiveConfirmAt: { type: Date, default: null },
    lastSpokeAt: { type: Date, default: null },
    connected: { type: Boolean, default: false },
    handRaises: { type: Number, default: 0 },
    questionsAsked: { type: Number, default: 0 },
    questionsAnswered: { type: Number, default: 0 },
    attendancePct: { type: Number, default: 0 },
    assessmentScore: { type: Number, default: null },
    completionStatus: { type: String, default: "in-progress" },
    // Attendance progression: registered → joined → waiting → present → completed
    attendanceState: { type: String, default: "joined" },
    confirmTime: { type: Date, default: null },
    completionTime: { type: Date, default: null },
  },
  { _id: false },
);

const transitionSchema = new Schema(
  {
    from: { type: String, default: "" },
    to: { type: String, default: "" },
    reason: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const joinLogSchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    traineeId: { type: String, default: "" },
    email: { type: String, default: "" },
    outcome: { type: String, default: "" }, // success | denied
    reason: { type: String, default: "" },
  },
  { _id: false },
);

const queueEntrySchema = new Schema(
  {
    traineeId: { type: String, required: true },
    name: { type: String, default: "" },
    raisedAt: { type: Date, default: Date.now },
    priority: { type: Number, default: 0 },
  },
  { _id: false },
);

const transcriptSchema = new Schema(
  {
    traineeId: { type: String, default: "" },
    name: { type: String, default: "" },
    question: { type: String, default: "" },
    answer: { type: String, default: "" },
    askedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const groupSessionSchema = new Schema(
  {
    appId: { type: String, required: true, unique: true, index: true },
    clientId: { type: String, required: true, index: true },
    trainingId: { type: String, required: true, index: true },
    trainingTitle: { type: String, default: "" },

    // Access control
    joinCode: { type: String, required: true, index: true },
    qrToken: { type: String, required: true, index: true },
    capacity: { type: Number, default: 50 },
    startTime: { type: Date, default: null },
    endTime: { type: Date, default: null },

    // Authoritative lifecycle: scheduled | waiting | starting | live | completed | cancelled
    lifecycle: { type: String, default: "scheduled", index: true },
    // Live sub-phase: presenting | qa | assessment | paused
    phase: { type: String, default: "presenting" },
    resumePhase: { type: String, default: "" },
    transitions: { type: [transitionSchema], default: [] },
    joinLog: { type: [joinLogSchema], default: [] },
    currentSlideId: { type: String, default: "" },
    currentSlideIndex: { type: Number, default: 0 },
    currentTopic: { type: String, default: "" },

    // Floor control
    activeSpeakerId: { type: String, default: "" },
    floorGrantedAt: { type: Date, default: null },
    queue: { type: [queueEntrySchema], default: [] },

    attendees: { type: [attendeeSchema], default: [] },
    transcripts: { type: [transcriptSchema], default: [] },

    config: { type: Schema.Types.Mixed, default: {} },

    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    createdBy: { type: String, default: "" },

    // RULE 1: exactly one ACTIVE (non-terminal) session per training+client.
    // `active` is true while the session is usable (scheduled/waiting/starting/
    // live) and set false on completed/cancelled. A partial unique index below
    // enforces this at the database layer.
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// DB-level guarantee: at most one active GroupSession per (trainingId, clientId).
// Partial filter uses an equality match (supported by partial indexes).
groupSessionSchema.index(
  { trainingId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);

// Build indexes explicitly after startup reconciliation (see
// reconcileGroupSessions) so a pre-existing duplicate cannot abort index build.
groupSessionSchema.set("autoIndex", false);

module.exports = models.GroupSession || model("GroupSession", groupSessionSchema);
