const { Schema, model, models } = require("mongoose");

// Task 3: append-only credit audit trail. Separate (uncapped) collection so the
// full history survives — unlike Client.creditTransactions which is capped to 25.
// Purely additive: existing credit math is unchanged; entries are written
// best-effort alongside each credit change.
const creditAuditLogSchema = new Schema(
  {
    clientId: { type: String, required: true, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
    actionType: { type: String, default: "" }, // training_created | session_created | user_allocation | credit_purchase | admin_adjustment | plan_assignment | debit
    entityType: { type: String, default: "" }, // training | session | user | credit | plan
    entityId: { type: String, default: "" },
    creditChange: { type: Number, default: 0 }, // signed: negative = deduction, positive = addition
    balanceBefore: { type: Number, default: 0 },
    balanceAfter: { type: Number, default: 0 },
    performedBy: { type: String, default: "" },
    reason: { type: String, default: "" },
    reference: { type: String, default: "" }, // human-friendly (e.g. training name)
  },
  { timestamps: true },
);

creditAuditLogSchema.index({ clientId: 1, timestamp: -1 });
creditAuditLogSchema.index({ actionType: 1 });

module.exports = models.CreditAuditLog || model("CreditAuditLog", creditAuditLogSchema);
