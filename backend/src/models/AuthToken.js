const { Schema, model, models } = require("mongoose");

const authTokenSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    purpose: {
      type: String,
      required: true,
      enum: ["set_password", "reset_password"],
      index: true,
    },
    userId: { type: String, required: true, index: true },
    userModel: { type: String, required: true, enum: ["User", "SuperAdmin"] },
    clientId: { type: String, default: "", index: true },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null },
    createdBy: { type: String, default: "" },
  },
  {
    timestamps: true,
  },
);

module.exports = models.AuthToken || model("AuthToken", authTokenSchema);
