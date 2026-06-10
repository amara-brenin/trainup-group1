const GroupSession = require("../models/GroupSession");
const Training = require("../models/Training");
const { LIFECYCLE } = require("../helpers/groupSession");
const { createLock } = require("../helpers/distributedLock");
const { ensureGroupSession } = require("../services/groupSessionService");
const logger = require("../helpers/logger");

// How early before startTime we move scheduled → waiting.
const WAITING_LEAD_MS = Number(process.env.GROUP_WAITING_LEAD_MS || 60 * 60 * 1000);
const TICK_MS = Number(process.env.GROUP_SCHEDULER_TICK_MS || 10 * 1000);
const LOCK_TTL_MS = Number(process.env.GROUP_SCHEDULER_LOCK_TTL_MS || 30 * 1000);

// Server-side scheduler — the backend is the source of truth for when sessions
// start and end. Safe for multi-instance deployment: a distributed lock ensures
// only ONE instance acts as the active scheduler at a time, with automatic
// failover if that instance dies (the lock expires and another takes over).
const startScheduler = (runtime) => {
  const lock = createLock("group-scheduler", LOCK_TTL_MS);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    const t0 = Date.now();
    try {
      // Only the lock holder runs the scheduling work.
      const isLeader = await lock.acquire();
      if (!isLeader) {
        running = false;
        return;
      }

      const now = Date.now();
      let ensured = 0;
      let opened = 0;
      let started = 0;
      let ended = 0;

      // 0) Auto-create sessions for approved group trainings whose scheduled
      //    start is within the lead window — so a session reliably exists from
      //    scheduling alone, without anyone clicking "Launch Hall".
      const groupTrainings = await Training.find({
        "payload.trainingType": "group",
        "payload.status": "approved",
        "payload.groupConfig.startTime": { $ne: null },
      }).lean();
      for (const t of groupTrainings) {
        const st = Date.parse(t.payload?.groupConfig?.startTime);
        if (!Number.isFinite(st)) continue;
        // Within [start - lead, start + 6h]: ensure (idempotent) a session.
        if (now >= st - WAITING_LEAD_MS && now <= st + 6 * 60 * 60 * 1000) {
          const { created } = await ensureGroupSession({ training: t, createdBy: "scheduler-auto-create" });
          if (created) ensured += 1;
        }
      }

      // 1) Open the waiting room as start time approaches.
      const upcoming = await GroupSession.find({
        lifecycle: LIFECYCLE.SCHEDULED,
        startTime: { $ne: null, $lte: new Date(now + WAITING_LEAD_MS) },
      }).select({ appId: 1 }).lean();
      for (const s of upcoming) {
        if (await runtime.openWaiting(s.appId, "scheduler-waiting-window")) opened += 1;
      }

      // 2) Start sessions whose scheduled time has arrived — but only once the
      //    Min Participants threshold is met, OR the grace period has elapsed.
      const due = await GroupSession.find({
        lifecycle: { $in: [LIFECYCLE.SCHEDULED, LIFECYCLE.WAITING] },
        startTime: { $ne: null, $lte: new Date(now) },
      }).select({ appId: 1, startTime: 1, attendees: 1, config: 1 }).lean();
      for (const s of due) {
        const minP = Number(s.config?.autoStart?.minParticipants || 1);
        const graceMins = Number(s.config?.autoStart?.graceMins ?? 15);
        const connected = (s.attendees || []).filter((a) => a.connected).length;
        const graceDeadline = new Date(s.startTime).getTime() + graceMins * 60 * 1000;
        const graceElapsed = now >= graceDeadline;

        if (connected >= minP || graceElapsed) {
          const reason = connected >= minP ? "scheduler-auto-start" : "scheduler-grace-start";
          if (await runtime.startSession(s.appId, reason)) started += 1;
        } else {
          // Hold in the waiting room; the Hall Screen shows "waiting for
          // minimum participants (X / Y)" using the broadcast state.
          await runtime.holdForParticipants(s.appId, connected, minP, graceDeadline);
        }
      }

      // 3) Auto-end live sessions that have reached their endTime.
      const expired = await GroupSession.find({
        lifecycle: LIFECYCLE.LIVE,
        endTime: { $ne: null, $lte: new Date(now) },
      }).select({ appId: 1 }).lean();
      for (const s of expired) {
        await runtime.endSession(s.appId, "scheduler-auto-end");
        ended += 1;
      }

      if (ensured || opened || started || ended) {
        logger.scheduler.info("tick actions", { ensured, opened, started, ended, ms: Date.now() - t0 });
      } else {
        logger.scheduler.debug("tick idle", { ms: Date.now() - t0 });
      }
    } catch (error) {
      logger.error.error("scheduler tick failed", { error: error?.message });
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, TICK_MS);
  if (handle.unref) handle.unref();
  void tick();

  // Release the lock on graceful shutdown so failover is immediate.
  const shutdown = async () => { await lock.release(); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  logger.scheduler.info("scheduler running", {
    tickMs: TICK_MS,
    waitingLeadMs: WAITING_LEAD_MS,
    lockTtlMs: LOCK_TTL_MS,
    instance: lock.instanceId,
  });
  return () => { clearInterval(handle); void lock.release(); };
};

module.exports = { startScheduler };
