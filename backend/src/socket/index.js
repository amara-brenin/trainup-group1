const { Server } = require("socket.io");
const GroupSession = require("../models/GroupSession");
const Training = require("../models/Training");
const config = require("../config");
const logger = require("../helpers/logger");
const { verifyAuthToken } = require("../helpers/auth");
const {
  LIFECYCLE,
  PHASE,
  canTransition,
  ATTENDANCE_STATE,
  legacyStatus,
  verifySessionToken,
  addToQueue,
  removeFromQueue,
  computeAttendancePct,
  normalizeValue,
} = require("../helpers/groupSession");

const roomName = (gsId) => `session:${gsId}`;
const isTrustedVercelPreviewOrigin = (origin) => /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin || "");

const log = (msg, meta) => logger.lifecycle.info(msg, meta);

// One runtime instance owns the io server + per-session floor timers. The
// backend is the single source of truth for session lifecycle; clients only
// react to the events emitted here.
class GroupRuntime {
  constructor(io) {
    this.io = io;
    this.timers = new Map();
    // gsId -> { traineeId, timer }: an answer is being delivered on the hall.
    // The next speaker is NOT granted until the hall reports answer-complete.
    this.pendingAnswers = new Map();
  }

  _clearPendingAnswer(gsId) {
    const pending = this.pendingAnswers.get(gsId);
    if (pending?.timer) clearTimeout(pending.timer);
    this.pendingAnswers.delete(gsId);
  }

  // ---- timers ----------------------------------------------------------
  _timers(gsId) {
    if (!this.timers.has(gsId)) this.timers.set(gsId, { floor: null, silence: null });
    return this.timers.get(gsId);
  }
  _clearFloorTimers(gsId) {
    const t = this._timers(gsId);
    if (t.floor) clearTimeout(t.floor);
    if (t.silence) clearTimeout(t.silence);
    t.floor = null;
    t.silence = null;
  }

  // ---- transition (validated + logged) ---------------------------------
  async transition(session, toLifecycle, reason = "") {
    const from = session.lifecycle;
    if (from === toLifecycle) return true;
    if (!canTransition(from, toLifecycle)) {
      logger.lifecycle.warn("blocked transition", { gsId: session.appId, from, to: toLifecycle, reason });
      return false;
    }
    session.lifecycle = toLifecycle;
    session.transitions.push({ from, to: toLifecycle, reason, at: new Date() });
    if (session.transitions.length > 200) session.transitions = session.transitions.slice(-200);
    logger.lifecycle.info("transition", { gsId: session.appId, from, to: toLifecycle, reason });
    return true;
  }

  // ---- broadcasting ----------------------------------------------------
  _statePayload(session) {
    return {
      lifecycle: session.lifecycle,
      phase: session.phase,
      status: legacyStatus(session),
      currentSlideId: session.currentSlideId,
      currentSlideIndex: session.currentSlideIndex,
      currentTopic: session.currentTopic,
      activeSpeakerId: session.activeSpeakerId,
      startTime: session.startTime,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    };
  }
  _emitState(session) {
    this.io.to(roomName(session.appId)).emit("session:state", this._statePayload(session));
  }
  _emitQueue(session) {
    this.io.to(roomName(session.appId)).emit("queue:update", {
      queue: (session.queue || []).map((q) => ({ traineeId: q.traineeId, name: q.name, raisedAt: q.raisedAt })),
    });
  }
  _emitAttendance(session) {
    const connected = (session.attendees || []).filter((a) => a.connected);
    this.io.to(roomName(session.appId)).emit("attendance:update", {
      count: connected.length,
      list: connected.map((a) => ({ traineeId: a.traineeId, name: a.name })),
    });
  }
  // Full snapshot for reconnect/recovery.
  _emitSync(session, socket) {
    const payload = {
      ...this._statePayload(session),
      queue: (session.queue || []).map((q) => ({ traineeId: q.traineeId, name: q.name })),
      attendeeCount: (session.attendees || []).filter((a) => a.connected).length,
      transcripts: session.transcripts || [],
    };
    (socket || this.io.to(roomName(session.appId))).emit("session:sync", payload);
  }
  // The answer is generated; the hall will speak it. Hold the floor until the
  // hall reports it finished (host:answer-complete), so the next speaker is not
  // granted while the previous answer is still playing. Floor timers are cleared
  // (the trainee is no longer "speaking"); a safety timeout prevents a deadlock
  // if the hall never reports completion.
  broadcastAnswer(gsId, { traineeId, question, answer }) {
    this._clearFloorTimers(gsId);
    this._clearPendingAnswer(gsId);
    const timer = setTimeout(() => this.answerComplete(gsId, "answer-timeout"), 60000);
    this.pendingAnswers.set(gsId, { traineeId, timer });
    this.io.to(roomName(gsId)).emit("qa:answer", { traineeId, question, answer });
  }

  // Called when the hall finishes speaking the answer (or the safety timeout).
  // Only now is the floor released and the next trainee granted.
  async answerComplete(gsId, reason = "host-answer-complete") {
    if (!this.pendingAnswers.has(gsId)) return;
    this._clearPendingAnswer(gsId);
    await this.releaseFloor(gsId, reason);
  }

  // ---- start a session (scheduler OR manual override) ------------------
  // Atomic + idempotent: only one caller can move scheduled/waiting → starting.
  async startSession(gsId, reason = "scheduler") {
    const claimed = await GroupSession.findOneAndUpdate(
      { appId: gsId, lifecycle: { $in: [LIFECYCLE.SCHEDULED, LIFECYCLE.WAITING] } },
      { $set: { lifecycle: LIFECYCLE.STARTING } },
      { new: true },
    );
    if (!claimed) return false; // already started/ended by someone else

    claimed.transitions.push({ from: LIFECYCLE.WAITING, to: LIFECYCLE.STARTING, reason, at: new Date() });
    claimed.lifecycle = LIFECYCLE.LIVE;
    claimed.phase = PHASE.PRESENTING;
    claimed.startedAt = claimed.startedAt || new Date();
    claimed.currentSlideIndex = 0;
    claimed.transitions.push({ from: LIFECYCLE.STARTING, to: LIFECYCLE.LIVE, reason, at: new Date() });
    // Connected trainees are now present.
    claimed.attendees.forEach((a) => {
      if (a.connected) a.attendanceState = ATTENDANCE_STATE.PRESENT;
    });
    await claimed.save();
    logger.lifecycle.info("session started", { gsId, reason });

    this.io.to(roomName(gsId)).emit("session:attention", { title: claimed.trainingTitle, startedAt: claimed.startedAt });
    this._emitState(claimed);
    this._emitSync(claimed);
    return true;
  }

  // Move scheduled → waiting as the start time approaches (so the waiting
  // screen + joins are valid).
  async openWaiting(gsId, reason = "scheduler") {
    const session = await GroupSession.findOne({ appId: gsId });
    if (!session || session.lifecycle !== LIFECYCLE.SCHEDULED) return false;
    const ok = await this.transition(session, LIFECYCLE.WAITING, reason);
    if (ok) {
      await session.save();
      this._emitState(session);
    }
    return ok;
  }

  // ---- host phase control (only while LIVE) ----------------------------
  async setPhase(gsId, phase, role) {
    if (role !== "host") return;
    const session = await GroupSession.findOne({ appId: gsId });
    if (!session || session.lifecycle !== LIFECYCLE.LIVE) return;
    if (![PHASE.PRESENTING, PHASE.QA, PHASE.ASSESSMENT, PHASE.PAUSED].includes(phase)) return;
    if (session.phase === PHASE.PAUSED && phase !== PHASE.PAUSED) {
      session.resumePhase = "";
    }
    session.phase = phase;
    await session.save();
    this._emitState(session);
    if (phase === PHASE.QA && !session.activeSpeakerId) await this.grantNext(gsId);
  }

  // ---- floor control ---------------------------------------------------
  async grantNext(gsId) {
    const session = await GroupSession.findOne({ appId: gsId });
    if (!session || session.lifecycle !== LIFECYCLE.LIVE || session.phase !== PHASE.QA) return;
    this._clearFloorTimers(gsId);

    if (!session.queue.length) {
      session.activeSpeakerId = "";
      session.floorGrantedAt = null;
      await session.save();
      this.io.to(roomName(gsId)).emit("floor:released", { reason: "queue-empty" });
      this._emitState(session);
      return;
    }
    const next = session.queue[0];
    session.queue = session.queue.slice(1);
    session.activeSpeakerId = next.traineeId;
    session.floorGrantedAt = new Date();
    const attendee = session.attendees.find((a) => a.traineeId === next.traineeId);
    await session.save();

    const qa = session.config?.qaRules || {};
    const maxSpeakSecs = Number(qa.maxSpeakSecs || 90);
    const silenceTimeoutSecs = Number(qa.silenceTimeoutSecs || 20);
    this.io.to(roomName(gsId)).emit("floor:granted", {
      traineeId: next.traineeId,
      name: attendee?.name || next.name || "",
      maxSpeakSecs,
    });
    this._emitQueue(session);
    this._emitState(session);

    const t = this._timers(gsId);
    t.silence = setTimeout(() => this.releaseFloor(gsId, "silence-timeout"), silenceTimeoutSecs * 1000);
    t.floor = setTimeout(() => this.releaseFloor(gsId, "max-speak"), maxSpeakSecs * 1000);
  }

  async releaseFloor(gsId, reason = "done") {
    const session = await GroupSession.findOne({ appId: gsId });
    if (!session) return;
    this._clearFloorTimers(gsId);
    session.activeSpeakerId = "";
    session.floorGrantedAt = null;
    await session.save();
    this.io.to(roomName(gsId)).emit("floor:released", { reason });
    await this.grantNext(gsId);
  }

  // ---- admin control ---------------------------------------------------
  async adminControl(gsId, action, _body = {}) {
    const session = await GroupSession.findOne({ appId: gsId });
    if (!session) throw new Error("Group session not found.");

    switch (action) {
      case "pause": {
        if (session.lifecycle !== LIFECYCLE.LIVE) throw new Error("Session is not live.");
        session.resumePhase = session.phase;
        session.phase = PHASE.PAUSED;
        this._clearFloorTimers(gsId);
        this._clearPendingAnswer(gsId);
        await session.save();
        this._emitState(session);
        return;
      }
      case "resume": {
        if (session.lifecycle !== LIFECYCLE.LIVE || session.phase !== PHASE.PAUSED) throw new Error("Session is not paused.");
        session.phase = session.resumePhase || PHASE.PRESENTING;
        session.resumePhase = "";
        await session.save();
        this._emitState(session);
        return;
      }
      case "skip-queue":
        await this.releaseFloor(gsId, "admin-skip");
        return;
      case "start":
        await this.startSession(gsId, "admin-manual");
        return;
      case "end":
        await this.endSession(gsId, "admin-ended");
        return;
      default:
        throw new Error(`Unknown control action: ${action}`);
    }
  }

  // ---- end session + flatten ------------------------------------------
  async endSession(gsId, reason = "ended") {
    const session = await GroupSession.findOne({ appId: gsId });
    if (!session || session.lifecycle === LIFECYCLE.COMPLETED || session.lifecycle === LIFECYCLE.CANCELLED) return;
    const ok = await this.transition(session, LIFECYCLE.COMPLETED, reason);
    if (!ok) return;

    this._clearFloorTimers(gsId);
    const now = Date.now();
    const elapsedMs = session.startedAt ? now - new Date(session.startedAt).getTime() : 0;
    const minPct = Number(session.config?.completionRules?.minAttendancePct || 75);

    session.endedAt = new Date();
    session.activeSpeakerId = "";
    session.attendees.forEach((a) => {
      if (a.connected && a.lastHeartbeat) a.totalActiveMs += now - new Date(a.lastHeartbeat).getTime();
      a.connected = false;
      if (!a.leftAt) a.leftAt = new Date();
      a.attendancePct = computeAttendancePct(a, elapsedMs);
      const completed = a.attendancePct >= minPct;
      a.completionStatus = completed ? "completed" : "incomplete";
      a.attendanceState = completed ? ATTENDANCE_STATE.COMPLETED : a.attendanceState;
      a.completionTime = new Date();
    });
    await session.save();
    await this._flattenToTraining(session);

    // Release all per-session runtime state so the maps don't grow unbounded.
    this._clearPendingAnswer(gsId);
    this.timers.delete(gsId);

    this.io.to(roomName(gsId)).emit("session:ended", { reason });
    this._emitState(session);
  }

  async _flattenToTraining(session) {
    const training = await Training.findOne({ appId: session.trainingId, clientId: session.clientId });
    if (!training) return;
    const existing = Array.isArray(training.payload?.sessions) ? training.payload.sessions : [];
    // Match by stable identifiers, not display name: prefer the deterministic
    // group record id, fall back to the assigned record's email/ssoId.
    const byId = new Map(existing.map((s, i) => [normalizeValue(s.id), i]));
    const byEmail = new Map();
    existing.forEach((s, i) => {
      const key = normalizeValue(s.learnerEmail || s.ssoId).toLowerCase();
      if (key && !byEmail.has(key)) byEmail.set(key, i);
    });
    const totalSlides = Array.isArray(training.payload?.slides) ? training.payload.slides.length : 0;
    const next = [...existing];

    session.attendees.forEach((a) => {
      const email = normalizeValue(a.email).toLowerCase();
      const askHistory = session.transcripts
        .filter((t) => t.traineeId === a.traineeId)
        .map((t) => ({ question: t.question, answer: t.answer, askedAt: t.askedAt, inputMode: "group-voice" }));
      const record = {
        id: `group-${session.appId}-${a.traineeId}`,
        groupSessionId: session.appId,
        ssoId: a.email,
        learnerName: a.name,
        learnerEmail: a.email,
        status: a.completionStatus === "completed" ? "completed" : "in-progress",
        timeSpent: `${Math.floor(a.totalActiveMs / 60000)}m ${String(Math.floor((a.totalActiveMs % 60000) / 1000)).padStart(2, "0")}s`,
        slidesViewed: totalSlides,
        totalSlides,
        viewedSlideIds: [],
        score: a.assessmentScore,
        startedAt: a.joinedAt,
        completedAt: a.completionStatus === "completed" ? session.endedAt : null,
        progressPercent: a.attendancePct,
        mode: "public",
        askHistory,
        askTranscripts: askHistory,
        attendancePct: a.attendancePct,
        handRaises: a.handRaises,
        questionsAsked: a.questionsAsked,
      };
      // Stable-identifier match: group record id first, then assigned email/ssoId.
      const idx = byId.has(record.id) ? byId.get(record.id) : (email ? byEmail.get(email) : undefined);
      if (idx !== undefined) next[idx] = { ...next[idx], ...record };
      else next.push(record);
    });
    training.payload = { ...training.payload, sessions: next, lastActivity: "Today" };
    await training.save();
  }

  // ---- connection lifecycle -------------------------------------------
  registerConnection(socket) {
    const { gsId, role, sub, name } = socket.data;
    socket.join(roomName(gsId));

    // Wrap every async handler so one failure cannot crash the process or leak
    // an unhandled rejection. Errors are logged structurally and a safe,
    // generic notice is returned to the offending client only.
    const on = (event, handler) =>
      socket.on(event, async (...args) => {
        try {
          await handler(...args);
        } catch (error) {
          logger.error.error("socket handler error", { event, gsId, role, error: error?.message });
          try {
            socket.emit("server:error", { event, message: "A server error occurred. Please retry." });
          } catch (_e) { /* ignore emit failures */ }
        }
      });

    on("session:join", async () => {
      const session = await GroupSession.findOne({ appId: gsId });
      if (!session) return;
      if (role === "trainee") {
        let attendee = session.attendees.find((a) => a.traineeId === sub);
        const waiting = session.lifecycle === LIFECYCLE.SCHEDULED || session.lifecycle === LIFECYCLE.WAITING;
        if (attendee) {
          if (!attendee.connected) attendee.rejoins += 1;
          attendee.connected = true;
          attendee.lastHeartbeat = new Date();
          if (!attendee.joinedAt) attendee.joinedAt = new Date();
          if (attendee.attendanceState === ATTENDANCE_STATE.REGISTERED || attendee.attendanceState === ATTENDANCE_STATE.JOINED) {
            attendee.attendanceState = waiting ? ATTENDANCE_STATE.WAITING : ATTENDANCE_STATE.PRESENT;
          } else if (!waiting && attendee.attendanceState === ATTENDANCE_STATE.WAITING) {
            attendee.attendanceState = ATTENDANCE_STATE.PRESENT;
          }
        } else {
          session.attendees.push({
            traineeId: sub,
            name,
            email: socket.data.email || "",
            joinedAt: new Date(),
            lastHeartbeat: new Date(),
            connected: true,
            attendanceState: waiting ? ATTENDANCE_STATE.WAITING : ATTENDANCE_STATE.PRESENT,
          });
        }
        await session.save();
        this._emitAttendance(session);
      }
      // Always send a full sync so the (re)connecting client restores state.
      this._emitSync(session, socket);
      this._emitQueue(session);

      // Reconnect floor restoration: if this trainee currently holds the floor,
      // re-send floor:granted to THIS socket only. No server state changes and
      // no broadcast, so it cannot create a duplicate grant for anyone else.
      if (role === "trainee" && session.activeSpeakerId === sub) {
        const me = session.attendees.find((a) => a.traineeId === sub);
        const maxSpeakSecs = Number(session.config?.qaRules?.maxSpeakSecs || 90);
        socket.emit("floor:granted", { traineeId: sub, name: me?.name || name || "", maxSpeakSecs });
      }
    });

    on("attendance:heartbeat", async () => {
      if (role !== "trainee") return;
      const session = await GroupSession.findOne({ appId: gsId });
      if (!session) return;
      const a = session.attendees.find((x) => x.traineeId === sub);
      if (a) {
        const now = Date.now();
        if (a.lastHeartbeat) {
          const delta = now - new Date(a.lastHeartbeat).getTime();
          if (delta < 60000) a.totalActiveMs += delta;
        }
        a.lastHeartbeat = new Date();
        a.connected = true;
        if (session.lifecycle === LIFECYCLE.LIVE && a.attendanceState === ATTENDANCE_STATE.WAITING) {
          a.attendanceState = ATTENDANCE_STATE.PRESENT;
        }
        await session.save();
      }
    });

    on("attendance:confirm", async () => {
      if (role !== "trainee") return;
      const session = await GroupSession.findOne({ appId: gsId });
      if (!session) return;
      const a = session.attendees.find((x) => x.traineeId === sub);
      if (a) {
        a.lastActiveConfirmAt = new Date();
        a.confirmTime = a.confirmTime || new Date();
        a.attendanceState = ATTENDANCE_STATE.PRESENT;
        await session.save();
        this._emitAttendance(session);
      }
    });

    on("hand:raise", async () => {
      if (role !== "trainee") return;
      const session = await GroupSession.findOne({ appId: gsId });
      if (!session || session.lifecycle !== LIFECYCLE.LIVE) return;
      const a = session.attendees.find((x) => x.traineeId === sub);
      const qa = session.config?.qaRules || {};
      if (a && Number(a.questionsAsked || 0) >= Number(qa.maxQuestionsPerTrainee || 3)) {
        socket.emit("hand:rejected", { reason: "max-questions-reached" });
        return;
      }
      const cooldownSecs = Number(qa.handRaiseCooldownSecs || 30);
      if (a?.lastSpokeAt && Date.now() - new Date(a.lastSpokeAt).getTime() < cooldownSecs * 1000) {
        socket.emit("hand:rejected", { reason: "cooldown" });
        return;
      }
      if (session.activeSpeakerId === sub) return;
      session.queue = addToQueue(session.queue, { traineeId: sub, name });
      if (a) a.handRaises = Number(a.handRaises || 0) + 1;
      await session.save();
      this._emitQueue(session);
      if (session.phase === PHASE.QA && !session.activeSpeakerId) await this.grantNext(gsId);
    });

    on("hand:lower", async () => {
      if (role !== "trainee") return;
      const session = await GroupSession.findOne({ appId: gsId });
      if (!session) return;
      session.queue = removeFromQueue(session.queue, sub);
      await session.save();
      this._emitQueue(session);
    });

    on("qa:done", async () => {
      if (role !== "trainee") return;
      const session = await GroupSession.findOne({ appId: gsId });
      if (!session || session.activeSpeakerId !== sub) return;
      const a = session.attendees.find((x) => x.traineeId === sub);
      if (a) { a.lastSpokeAt = new Date(); await session.save(); }
      // If an answer is being delivered, the hall's answer-complete drives the
      // floor release (strict turn sequencing). Only release here when there is
      // no pending answer (e.g. the trainee cancelled without asking).
      if (this.pendingAnswers.has(gsId)) return;
      await this.releaseFloor(gsId, "trainee-done");
    });

    // Hall reports the AI answer finished playing → release + grant next.
    on("host:answer-complete", async () => {
      if (role !== "host") return;
      await this.answerComplete(gsId, "host-answer-complete");
    });

    // Host phase control + slide advance (only meaningful while LIVE).
    on("host:phase", async ({ phase } = {}) => {
      await this.setPhase(gsId, normalizeValue(phase), role);
    });
    on("host:start", async () => {
      if (role !== "host") return;
      await this.startSession(gsId, "host-manual");
    });
    on("host:end", async () => {
      if (role !== "host") return;
      await this.endSession(gsId, "host-ended");
    });
    on("host:advance", async ({ slideId, slideIndex, topic } = {}) => {
      if (role !== "host") return;
      const session = await GroupSession.findOne({ appId: gsId });
      if (!session) return;
      session.currentSlideId = normalizeValue(slideId);
      session.currentSlideIndex = Number(slideIndex || 0);
      if (topic !== undefined) session.currentTopic = normalizeValue(topic);
      await session.save();
      this._emitState(session);
    });
    on("host:grant-next", async () => {
      if (role !== "host") return;
      await this.grantNext(gsId);
    });

    on("disconnect", async () => {
      if (role !== "trainee") return;
      const session = await GroupSession.findOne({ appId: gsId });
      if (!session) return;
      const a = session.attendees.find((x) => x.traineeId === sub);
      if (a) {
        if (a.connected && a.lastHeartbeat) {
          a.totalActiveMs += Math.min(60000, Date.now() - new Date(a.lastHeartbeat).getTime());
        }
        a.connected = false;
        a.leftAt = new Date();
        await session.save();
        this._emitAttendance(session);
      }
      if ((session.queue || []).some((q) => q.traineeId === sub)) {
        session.queue = removeFromQueue(session.queue, sub);
        await session.save();
        this._emitQueue(session);
      }
    });
  }
}

// Socket auth: accepts a group-session token (trainee/host) or an admin JWT.
const authenticateSocket = (socket, next) => {
  const token = normalizeValue(socket.handshake.auth?.token);
  if (!token) return next(new Error("Auth token required."));

  const sessionToken = verifySessionToken(token);
  if (sessionToken) {
    socket.data = {
      gsId: sessionToken.gsId,
      clientId: sessionToken.clientId,
      sub: sessionToken.sub,
      role: sessionToken.role,
      name: sessionToken.name,
      email: sessionToken.email || "",
    };
    return next();
  }

  const adminPayload = verifyAuthToken(token);
  const gsId = normalizeValue(socket.handshake.auth?.gsId);
  if (adminPayload?.sub && gsId) {
    socket.data = { gsId, clientId: "", sub: adminPayload.sub, role: "admin", name: "" };
    return next();
  }
  return next(new Error("Invalid auth token."));
};

// Optionally attach the Redis adapter so multiple backend instances share
// Socket.IO rooms/broadcasts. Enabled only when REDIS_URL is set; otherwise the
// server runs single-instance with the default in-memory adapter.
const attachRedisAdapter = async (io) => {
  const url = String(process.env.REDIS_URL || "").trim();
  if (!url) {
    logger.socket.info("redis adapter disabled (single-instance, no REDIS_URL)");
    return;
  }
  try {
    const { createAdapter } = require("@socket.io/redis-adapter");
    const { createClient } = require("redis");
    const pubClient = createClient({ url });
    const subClient = pubClient.duplicate();
    pubClient.on("error", (e) => logger.error.error("redis pub error", { error: e?.message }));
    subClient.on("error", (e) => logger.error.error("redis sub error", { error: e?.message }));
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    logger.socket.info("redis adapter enabled (multi-instance)", { url: url.replace(/\/\/.*@/, "//***@") });
  } catch (error) {
    // Never crash startup over the adapter — fall back to single-instance.
    logger.error.error("redis adapter setup failed; falling back to in-memory", { error: error?.message });
  }
};

const attachSocket = async (httpServer, app) => {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, cb) => {
        const allowed = !origin || config.corsOrigins.includes(origin) || isTrustedVercelPreviewOrigin(origin);
        cb(null, allowed);
      },
      credentials: true,
    },
  });

  await attachRedisAdapter(io);

  const runtime = new GroupRuntime(io);
  app.set("groupRuntime", runtime);

  io.use(authenticateSocket);
  io.on("connection", (socket) => runtime.registerConnection(socket));

  return runtime;
};

module.exports = { attachSocket, GroupRuntime };
