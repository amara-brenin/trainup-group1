const { Schema, model, models } = require("mongoose");

// Generic distributed lock document. One row per lock key (e.g. the scheduler).
// Ownership is claimed/renewed atomically; an expired lock can be taken over by
// any instance, giving automatic failover if the holder dies.
const lockSchema = new Schema(
  {
    _id: { type: String }, // lock key, e.g. "group-scheduler"
    owner: { type: String, default: "" }, // instance id
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false },
);

module.exports = models.Lock || model("Lock", lockSchema);
