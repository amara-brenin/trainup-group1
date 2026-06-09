const { Schema, model, models } = require("mongoose");

const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  {
    timestamps: true,
  },
);

module.exports = models.Setting || model("Setting", settingSchema);
