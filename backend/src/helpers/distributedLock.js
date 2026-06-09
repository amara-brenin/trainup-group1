const crypto = require("crypto");
const Lock = require("../models/Lock");
const logger = require("./logger");

// Mongo-backed distributed lock with TTL + automatic failover.
//
// Strategy:
//  - A lock is a single document keyed by name (e.g. "group-scheduler").
//  - acquire(): atomically claim the lock if it is unowned, already ours, or
//    expired. Uses an upsert with a conditional filter so only one instance can
//    win a contested lock.
//  - The holder must renew() before `ttlMs` elapses (heartbeat). If the holder
//    crashes, the lock expires and another instance acquires it → failover.
//
// This requires only the existing MongoDB — no extra infrastructure. For very
// high lock-churn workloads a Redis lock (Redlock) is an alternative, but the
// scheduler ticks every 10s so Mongo is more than sufficient.

const INSTANCE_ID = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;

const createLock = (key, ttlMs = 30000) => {
  let owned = false;

  const acquire = async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    try {
      // Win the lock only if it is free/expired or already ours.
      const res = await Lock.findOneAndUpdate(
        {
          _id: key,
          $or: [{ owner: INSTANCE_ID }, { owner: "" }, { expiresAt: { $lt: now } }],
        },
        { $set: { owner: INSTANCE_ID, expiresAt } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      const nowOwned = res?.owner === INSTANCE_ID;
      if (nowOwned && !owned) {
        logger.scheduler.info("lock acquired", { key, owner: INSTANCE_ID });
      }
      owned = nowOwned;
      return owned;
    } catch (error) {
      // Duplicate-key race: another instance created the row first. Not owned.
      if (error?.code === 11000) {
        owned = false;
        return false;
      }
      logger.error.error("lock acquire failed", { key, error: error?.message });
      owned = false;
      return false;
    }
  };

  const release = async () => {
    if (!owned) return;
    try {
      await Lock.updateOne({ _id: key, owner: INSTANCE_ID }, { $set: { owner: "", expiresAt: new Date(0) } });
      logger.scheduler.info("lock released", { key, owner: INSTANCE_ID });
    } catch (_e) { /* best effort */ }
    owned = false;
  };

  return { acquire, release, isOwned: () => owned, instanceId: INSTANCE_ID };
};

module.exports = { createLock, INSTANCE_ID };
