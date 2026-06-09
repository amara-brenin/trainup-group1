const config = require("../config");
const Training = require("../models/Training");
const { ok, fail } = require("../helpers/response");

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";
const VOICE_CACHE_TTL_MS = 5 * 60 * 1000;

let voicesPayloadCache = {
  apiKey: "",
  fetchedAt: 0,
  payload: null,
};

const normalizeValue = (value) => String(value || "").trim();
const normalizeVoiceLookup = (value) =>
  normalizeValue(value)
    .replace(/\s+/g, " ")
    .replace(/\s+\)/g, ")")
    .toLowerCase();

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findVoiceByName = (voices, requestedVoiceName) => {
  const cacheKey = normalizeVoiceLookup(requestedVoiceName);

  if (!cacheKey) {
    return null;
  }

  return (
    voices.find((voice) => normalizeVoiceLookup(voice.name) === cacheKey) ||
    voices.find((voice) => normalizeVoiceLookup(voice.name).includes(cacheKey)) ||
    voices.find((voice) => cacheKey.includes(normalizeVoiceLookup(voice.name))) ||
    null
  );
};

const mapVoiceRecord = (voice) => ({
  voiceId: normalizeValue(voice.voice_id),
  name: normalizeValue(voice.name),
  category: normalizeValue(voice.category),
  previewUrl: normalizeValue(voice.preview_url),
  gender: normalizeValue(voice.labels?.gender),
  accent: normalizeValue(voice.labels?.accent),
  age: normalizeValue(voice.labels?.age),
  description: normalizeValue(voice.description),
});

const fetchVoices = async (apiKey) => {
  const now = Date.now();

  if (
    voicesPayloadCache.payload &&
    voicesPayloadCache.apiKey === apiKey &&
    now - voicesPayloadCache.fetchedAt < VOICE_CACHE_TTL_MS
  ) {
    return voicesPayloadCache.payload;
  }

  const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
    headers: {
      "xi-api-key": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error("Unable to load ElevenLabs voices.");
  }

  const payload = await response.json();
  const voices = (Array.isArray(payload.voices) ? payload.voices : [])
    .map(mapVoiceRecord)
    .filter((voice) => voice.voiceId && voice.name);

  const configuredDefaultVoice =
    voices.find((voice) => normalizeValue(config.elevenlabs.voiceId) && voice.voiceId === config.elevenlabs.voiceId) ||
    findVoiceByName(voices, config.elevenlabs.voiceName) ||
    voices[0] ||
    null;

  const normalizedPayload = {
    provider: "ElevenLabs",
    defaultVoiceId: configuredDefaultVoice?.voiceId ?? "",
    defaultVoiceName: configuredDefaultVoice?.name ?? "",
    voices: voices.map((voice) => ({
      ...voice,
      isDefault: configuredDefaultVoice ? voice.voiceId === configuredDefaultVoice.voiceId : false,
    })),
  };

  voicesPayloadCache = {
    apiKey,
    fetchedAt: now,
    payload: normalizedPayload,
  };

  return normalizedPayload;
};

const resolveTraining = async (trainingId) => {
  const normalizedTrainingId = normalizeValue(trainingId);

  if (!normalizedTrainingId) {
    return null;
  }

  return Training.findOne({
    appId: { $regex: `^${escapeRegex(normalizedTrainingId)}$`, $options: "i" },
  }).lean();
};

const resolveApiKey = async ({ apiKey, trainingId }) => {
  const directApiKey = normalizeValue(apiKey);

  if (directApiKey) {
    return directApiKey;
  }

  const training = await resolveTraining(trainingId);
  const trainingApiKey =
    training?.payload?.ttsMode === "manual" ? normalizeValue(training.payload.manualTtsApiKey) : "";

  if (trainingApiKey) {
    return trainingApiKey;
  }

  return normalizeValue(config.elevenlabs.apiKey);
};

const resolveVoiceId = async ({ apiKey, voiceId, voiceName }) => {
  const requestedVoiceId = normalizeValue(voiceId);

  if (requestedVoiceId && requestedVoiceId.toLowerCase() !== "auto") {
    return requestedVoiceId;
  }

  const requestedVoiceName = normalizeValue(voiceName) || config.elevenlabs.voiceName;
  const voicesPayload = await fetchVoices(apiKey);
  const matchedVoice = findVoiceByName(voicesPayload.voices, requestedVoiceName);

  if (matchedVoice?.voiceId) {
    return matchedVoice.voiceId;
  }

  if (voicesPayload.defaultVoiceId) {
    return voicesPayload.defaultVoiceId;
  }

  throw new Error(`Voice "${requestedVoiceName}" was not found in ElevenLabs.`);
};

const listVoices = async (req, res) => {
  const apiKey = await resolveApiKey({
    apiKey: req.header("x-elevenlabs-api-key"),
    trainingId: req.query.trainingId,
  });

  if (!apiKey) {
    return fail(res, 503, "ElevenLabs is not configured on this deployment.");
  }

  try {
    const voicesPayload = await fetchVoices(apiKey);
    return ok(res, "ElevenLabs voices loaded successfully.", voicesPayload);
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : "Unable to load ElevenLabs voices.",
    );
  }
};

const verifyApiKey = async (req, res) => {
  const apiKey = normalizeValue(req.body.apiKey);

  if (!apiKey) {
    return fail(res, 400, "ElevenLabs API key is required.");
  }

  try {
    const voicesPayload = await fetchVoices(apiKey);
    return ok(res, "ElevenLabs API key verified successfully.", voicesPayload);
  } catch (error) {
    return fail(
      res,
      401,
      error instanceof Error ? error.message : "Unable to verify the provided ElevenLabs API key.",
    );
  }
};

const generate = async (req, res) => {
  try {
    const text = normalizeValue(req.body.text);

    if (!text) {
      return fail(res, 400, "Text is required for narration generation.");
    }

    const provider = normalizeValue(req.body.provider || "ElevenLabs");

    if (provider.toLowerCase() !== "elevenlabs") {
      return fail(res, 400, "Unsupported TTS provider.");
    }

    const apiKey = await resolveApiKey({
      apiKey: req.body.apiKey,
      trainingId: req.body.trainingId,
    });

    if (!apiKey) {
      return fail(res, 503, "ElevenLabs is not configured on this deployment.");
    }

    const modelId = normalizeValue(req.body.modelId) || config.elevenlabs.modelId;
    const voiceName = normalizeValue(req.body.voiceName) || config.elevenlabs.voiceName;
    const voiceId = await resolveVoiceId({
      apiKey,
      voiceId: req.body.voiceId,
      voiceName,
    });

    const ttsResponse = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0.2,
          use_speaker_boost: true,
        },
      }),
    });

    if (!ttsResponse.ok) {
      const errorText = await ttsResponse.text();
      return fail(res, ttsResponse.status, "ElevenLabs audio generation failed.", errorText);
    }

    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
    return ok(res, "Narration generated successfully.", {
      provider: "ElevenLabs",
      modelId,
      voiceId,
      voiceName,
      mimeType: "audio/mpeg",
      audioBase64: audioBuffer.toString("base64"),
    });
  } catch (error) {
    return fail(
      res,
      502,
      error instanceof Error ? error.message : "Unable to generate narration audio.",
    );
  }
};

module.exports = {
  generate,
  listVoices,
  verifyApiKey,
};
