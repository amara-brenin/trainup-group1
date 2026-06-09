const { Schema, model, models } = require("mongoose");

const mediaAssetSchema = new Schema(
  {
    appId: { type: String, required: true, unique: true, index: true },
    clientId: { type: String, required: true, index: true },
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    mimeType: { type: String, required: true },
    source: { type: String, required: true },
    pageNumber: { type: Number, default: null },
    extractedText: { type: [String], default: [] },
    interactiveHotspots: { type: [Schema.Types.Mixed], default: [] },
    originalFile: { type: Boolean, default: false },
    uploadedBy: { type: String, default: "" },
  },
  {
    timestamps: true,
  },
);

module.exports = models.MediaAsset || model("MediaAsset", mediaAssetSchema);
