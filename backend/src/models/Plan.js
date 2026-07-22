const { Schema, model, models } = require("mongoose");

// Phase C: database-driven plan definitions. Replaces hardcoded PLAN_CONFIGS as
// the source for NEW purchases + display. Existing subscribers are unaffected
// (they read the frozen snapshot on Client). `*Limit: null` = unlimited.
const planSchema = new Schema(
  {
    appId: { type: String, required: true, unique: true, index: true },
    code: { type: String, required: true, index: true }, // FREE | PRO | ENTERPRISE | custom
    name: { type: String, required: true, trim: true },
    price: { type: Number, default: 0 },
    discountPercentage: { type: Number, default: 0 },
    credits: { type: Number, default: 0 },
    validityDays: { type: Number, default: 30 },
    features: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true },
);

module.exports = models.Plan || model("Plan", planSchema);
