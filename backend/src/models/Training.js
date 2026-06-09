const { Schema, model, models } = require("mongoose");

const trainingSchema = new Schema(
  {
    appId: { type: String, required: true, unique: true, index: true },
    clientId: { type: String, required: true, index: true },
    sortIndex: { type: Number, default: 0 },
    payload: { type: Schema.Types.Mixed, required: true },
  },
  {
    timestamps: true,
  },
);

module.exports = models.Training || model("Training", trainingSchema);
