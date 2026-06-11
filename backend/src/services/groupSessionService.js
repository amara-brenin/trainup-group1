const crypto = require("crypto");
const GroupSession = require("../models/GroupSession");
const Training = require("../models/Training");
const logger = require("../helpers/logger");
const {
  LIFECYCLE,
  PHASE,
  resolveGroupConfig,
  generateJoinCode,
  generateQrToken,
  normalizeValue,
} = require("../helpers/groupSession");

const TERMINAL = [LIFECYCLE.COMPLETED, LIFECYCLE.CANCELLED];
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Derive an end time so auto-completion always works:
//  1. explicit config.endTime (manual override) wins
//  2. else startTime + training duration (durationMins / maxDurationMins)
//  3. else startTime + estimate from slide count (~45s/slide + 5m buffer)
//  4. else startTime + 60m default
const deriveEndTime = (startTime, training, config) => {
  if (config?.endTime) return new Date(config.endTime);
  if (!startTime) return null;

  const start = new Date(startTime).getTime();
  const payload = training?.payload || {};
  let minutes = Number(payload.durationMins || payload.maxDurationMins || 0);

  if (!minutes || minutes <= 0) {
    const slideCount = Array.isArray(payload.slides) ? payload.slides.length : 0;
    minutes = slideCount > 0 ? Math.ceil((slideCount * 45 + 300) / 60) : 60;
  }
  return new Date(start + minutes * 60 * 1000);
};

// Idempotent: reuse an existing non-terminal session for the training, else
// create one. Used by Launch Hall, the scheduler (auto-create), and join/resolve
// fallback — so a session reliably exists without manual intervention and
// repeated calls never produce duplicates.
// allowRecreate: explicit Launch Hall may start a fresh run after a previous
// occurrence completed. Auto-create paths (scheduler/auto-resolve) leave it
// false so a finished occurrence is never silently recreated (no restart loop).
const ensureGroupSession = async ({ training, createdBy = "", allowRecreate = false }) => {
  if (!training) return { session: null, created: false, reason: "no-training" };

  const clientId = training.clientId;
  const config = resolveGroupConfig(training.payload?.groupConfig || {});
  const startTime = config.startTime ? new Date(config.startTime) : null;

  // RULE 2: a single deterministic selector for THE active session, shared with
  // the join/resolve path (findSessionByJoinKey). The DB partial unique index
  // guarantees at most one, so Hall, Email and QR converge to the same gsId.
  const existing = await findActiveSession(training.appId, clientId);

  if (existing) {
    // Idempotent reuse — but if the session has NOT started yet, re-sync the
    // schedule + config from the (possibly edited) training so admin edits to
    // start/end time and rules take effect. A live/started session is left as-is.
    if (existing.lifecycle === LIFECYCLE.SCHEDULED || existing.lifecycle === LIFECYCLE.WAITING) {
      const endTime = deriveEndTime(startTime, training, config);
      const newStartMs = startTime ? startTime.getTime() : null;
      const oldStartMs = existing.startTime ? new Date(existing.startTime).getTime() : null;
      const changed = newStartMs !== oldStartMs;

      existing.trainingTitle = normalizeValue(training.payload?.title) || existing.trainingTitle;
      existing.capacity = config.capacity;
      existing.startTime = startTime;
      existing.endTime = endTime;
      existing.config = { ...config, endTime: endTime ? endTime.toISOString() : config.endTime || null };
      // If the start time moved back to the future, ensure it waits again.
      if (changed && newStartMs && newStartMs > Date.now() && existing.lifecycle === LIFECYCLE.WAITING) {
        existing.lifecycle = LIFECYCLE.SCHEDULED;
      }
      await existing.save();
      if (changed) {
        logger.lifecycle.info("group session reschedule synced", {
          gsId: existing.appId, trainingId: training.appId, startTime,
        });
      }
    }
    return { session: existing, created: false };
  }

  // Don't auto-recreate a session for an occurrence that already ran (any
  // lifecycle, matched by this training + scheduled startTime).
  if (!allowRecreate && startTime) {
    const sameOccurrence = await GroupSession.findOne({
      trainingId: training.appId,
      clientId,
      startTime,
    }).sort({ createdAt: -1 });
    if (sameOccurrence) return { session: sameOccurrence, created: false };
  }

  const endTime = deriveEndTime(startTime, training, config);

  try {
    const session = await GroupSession.create({
      appId: `gs-${crypto.randomUUID()}`,
      clientId,
      trainingId: training.appId,
      trainingTitle: normalizeValue(training.payload?.title) || "Group Training",
      joinCode: generateJoinCode(),
      qrToken: generateQrToken(),
      capacity: config.capacity,
      startTime,
      endTime,
      lifecycle: LIFECYCLE.SCHEDULED,
      phase: PHASE.PRESENTING,
      active: true,
      config: { ...config, endTime: endTime ? endTime.toISOString() : config.endTime || null },
      createdBy,
    });
    logger.lifecycle.info("group session ensured (created)", {
      gsId: session.appId, trainingId: training.appId, startTime, endTime,
    });
    return { session, created: true };
  } catch (error) {
    // RULE 1/2: the partial unique index rejected a concurrent second active
    // session (E11000). Re-read THE active one and reuse it.
    if (error?.code === 11000) {
      const winner = await findActiveSession(training.appId, clientId);
      if (winner) return { session: winner, created: false };
    }
    throw error;
  }
};

// THE single active session for a training (DB guarantees at most one).
const findActiveSession = async (trainingId, clientId) => {
  const filter = { trainingId, active: true };
  if (clientId) filter.clientId = clientId;
  return GroupSession.findOne(filter).sort({ createdAt: -1 });
};

// Find a group Training by its appId (case-insensitive), only if it is an
// approved group training (used by the join/resolve auto-create fallback).
const findGroupTrainingByAppId = async (key) => {
  const normalized = normalizeValue(key);
  if (!normalized) return null;
  return Training.findOne({
    appId: { $regex: `^${escapeRegex(normalized)}$`, $options: "i" },
    "payload.trainingType": "group",
  }).lean();
};

module.exports = { ensureGroupSession, findActiveSession, deriveEndTime, findGroupTrainingByAppId, TERMINAL };
