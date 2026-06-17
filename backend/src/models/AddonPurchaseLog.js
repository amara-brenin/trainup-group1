const { Schema, model, models } = require("mongoose");

// Phase D: audit trail for add-on capacity purchases (training/session/user slots).
// Append-only; never decremented. Add-ons never expire and stack.
const addonPurchaseLogSchema = new Schema(
  {
    appId: { type: String, required: true, unique: true, index: true },
    clientId: { type: String, required: true, index: true },
    type: { type: String, default: "" }, // training | session | user
    quantity: { type: Number, default: 0 },
    purchaseMethod: { type: String, default: "" }, // credits | razorpay
    unitCost: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    currency: { type: String, default: "" }, // credits | INR
    orderId: { type: String, default: "" },
    paymentId: { type: String, default: "" },
    status: { type: String, default: "completed" }, // completed | captured
    performedBy: { type: String, default: "" },
    idempotencyKey: { type: String, default: "" },
  },
  { timestamps: true },
);

addonPurchaseLogSchema.index({ orderId: 1 }, { sparse: true });
addonPurchaseLogSchema.index({ idempotencyKey: 1 }, { sparse: true });

module.exports = models.AddonPurchaseLog || model("AddonPurchaseLog", addonPurchaseLogSchema);
