const GroupSession = require("../models/GroupSession");
const logger = require("./logger");

const TERMINAL = ["completed", "cancelled"];
// Lifecycle preference when choosing which duplicate to keep.
const RANK = { live: 4, starting: 3, waiting: 2, scheduled: 1 };

// One-time, idempotent reconciliation run at boot. Guarantees the invariant
// "one active GroupSession per (trainingId, clientId)" BEFORE the partial unique
// index is built, so legacy duplicates (created before this rule existed) can't
// abort index creation and can't cause Hall/Email to resolve different gsIds.
const reconcileGroupSessions = async () => {
  // 1. Backfill the `active` flag on legacy documents that predate it.
  await GroupSession.updateMany(
    { active: { $exists: false }, lifecycle: { $nin: TERMINAL } },
    { $set: { active: true } },
  );
  await GroupSession.updateMany(
    { active: { $exists: false }, lifecycle: { $in: TERMINAL } },
    { $set: { active: false } },
  );
  // Terminal sessions must never be active.
  await GroupSession.updateMany(
    { active: true, lifecycle: { $in: TERMINAL } },
    { $set: { active: false } },
  );

  // 2. Collapse duplicate active sessions: keep the best one, cancel the rest.
  const dupes = await GroupSession.aggregate([
    { $match: { active: true } },
    { $group: { _id: { t: "$trainingId", c: "$clientId" }, ids: { $push: "$_id" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  let collapsed = 0;
  for (const d of dupes) {
    const sessions = await GroupSession.find({ _id: { $in: d.ids } });
    sessions.sort(
      (a, b) => (RANK[b.lifecycle] || 0) - (RANK[a.lifecycle] || 0) || new Date(b.createdAt) - new Date(a.createdAt),
    );
    const drop = sessions.slice(1);
    if (drop.length) {
      await GroupSession.updateMany(
        { _id: { $in: drop.map((s) => s._id) } },
        { $set: { active: false, lifecycle: "cancelled" } },
      );
      collapsed += drop.length;
      logger.lifecycle.warn("reconciled duplicate group sessions", {
        trainingId: d._id.t,
        kept: sessions[0].appId,
        cancelled: drop.map((s) => s.appId),
      });
    }
  }

  // 3. Build indexes now that the invariant holds (the unique partial index).
  try {
    await GroupSession.syncIndexes();
  } catch (error) {
    logger.error.error("group session syncIndexes failed", { error: error?.message });
  }

  logger.lifecycle.info("group sessions reconciled", { duplicateGroups: dupes.length, collapsed });
};

module.exports = { reconcileGroupSessions };
