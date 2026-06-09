const { Schema, model, models } = require("mongoose");

const apiKeySchema = new Schema(
  {
    appId: { type: String, required: true, unique: true, index: true },
    clientId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true, trim: true },
    permission: { type: String, required: true },
    createdAtLabel: { type: String, required: true },
    lastUsed: { type: String, default: "Never" },
    callsToday: { type: Number, default: 0 },
    status: { type: String, default: "active" },
  },
  {
    timestamps: true,
  },
);

module.exports = models.ApiKey || model("ApiKey", apiKeySchema);
