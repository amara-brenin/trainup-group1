const { Schema, model, models } = require("mongoose");

const notificationSchema = new Schema(
  {
    appId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    clientId: { type: String, default: "", index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    category: { type: String, default: "system", trim: true },
    severity: { type: String, default: "info", trim: true },
    link: { type: String, default: "", trim: true },
    readAt: { type: String, default: "" },
    actorName: { type: String, default: "", trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  },
);

module.exports = models.Notification || model("Notification", notificationSchema);
