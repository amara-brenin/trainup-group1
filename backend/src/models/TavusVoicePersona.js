const { Schema, model, models } = require("mongoose");

// Caches the cloned Tavus persona created when a training overrides its
// avatar's default voice, keyed by (base persona, voice) so the same clone
// is reused across sessions instead of creating a new one on every launch.
const tavusVoicePersonaSchema = new Schema(
  {
    basePersonaId: { type: String, required: true, index: true },
    voiceId: { type: String, required: true },
    personaId: { type: String, required: true },
  },
  {
    timestamps: true,
  },
);

tavusVoicePersonaSchema.index({ basePersonaId: 1, voiceId: 1 }, { unique: true });

module.exports = models.TavusVoicePersona || model("TavusVoicePersona", tavusVoicePersonaSchema);
