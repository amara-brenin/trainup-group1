const { Schema, model, models } = require("mongoose");

// Phase C: audit trail for plan definition changes (who/old/new/when).
const planChangeLogSchema = new Schema(
  {
    planId: { type: String, required: true, index: true }, // Plan.appId
    code: { type: String, default: "" },
    action: { type: String, default: "" }, // created | updated | activated | deactivated
    previousValues: { type: Schema.Types.Mixed, default: null },
    newValues: { type: Schema.Types.Mixed, default: null },
    changedBy: { type: String, default: "" },
    changedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = models.PlanChangeLog || model("PlanChangeLog", planChangeLogSchema);
