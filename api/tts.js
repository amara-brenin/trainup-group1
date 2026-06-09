const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL_ID = process.env.ELEVENLABS_TTS_MODEL_ID || "eleven_flash_v2_5";
const DEFAULT_VOICE_NAME = process.env.ELEVENLABS_TTS_VOICE_NAME || "Anurja - Auto Sales Follow-Ups (Female )";
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_TTS_VOICE_ID || "";

const voiceCache = new Map();

const json = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
};

const normalizeValue = (value) => String(value ?? "").trim();
const normalizeVoiceLookup = (value) =>
  normalizeValue(value)
    .replace(/\s+/g, " ")
    .replace(/\s+\)/g, ")")
    .toLowerCase();

const readBody = async (req) => {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const resolveVoiceId = async ({ apiKey, voiceId, voiceName }) => {
  const requestedVoiceId = normalizeValue(voiceId);

  if (requestedVoiceId && requestedVoiceId.toLowerCase() !== "auto") {
    return requestedVoiceId;
  }

  if (DEFAULT_VOICE_ID) {
    return DEFAULT_VOICE_ID;
  }

  const requestedVoiceName = normalizeValue(voiceName) || DEFAULT_VOICE_NAME;
  const cacheKey = normalizeVoiceLookup(requestedVoiceName);

  if (voiceCache.has(cacheKey)) {
    return voiceCache.get(cacheKey);
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
  const voices = Array.isArray(payload.voices) ? payload.voices : [];
  const matchedVoice =
    voices.find((voice) => normalizeVoiceLookup(voice.name) === cacheKey) ??
    voices.find((voice) => normalizeVoiceLookup(voice.name).includes(cacheKey)) ??
    voices.find((voice) => cacheKey.includes(normalizeVoiceLookup(voice.name)));

  if (!matchedVoice?.voice_id) {
    throw new Error(`Voice "${requestedVoiceName}" was not found in ElevenLabs.`);
  }

  voiceCache.set(cacheKey, matchedVoice.voice_id);
  return matchedVoice.voice_id;
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, {
      status: false,
      message: "Method not allowed.",
    });
  }

  const apiKey = normalizeValue(process.env.ELEVENLABS_API_KEY);

  if (!apiKey) {
    return json(res, 503, {
      status: false,
      message: "ElevenLabs is not configured on this deployment.",
    });
  }

  try {
    const body = await readBody(req);
    const text = normalizeValue(body.text);

    if (!text) {
      return json(res, 400, {
        status: false,
        message: "Text is required for narration generation.",
      });
    }

    const provider = normalizeValue(body.provider || "ElevenLabs");

    if (provider.toLowerCase() !== "elevenlabs") {
      return json(res, 400, {
        status: false,
        message: "Unsupported TTS provider.",
      });
    }

    const modelId = normalizeValue(body.modelId) || DEFAULT_MODEL_ID;
    const voiceName = normalizeValue(body.voiceName) || DEFAULT_VOICE_NAME;
    const voiceId = await resolveVoiceId({
      apiKey,
      voiceId: body.voiceId,
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

      return json(res, ttsResponse.status, {
        status: false,
        message: "ElevenLabs audio generation failed.",
        data: errorText,
      });
    }

    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());

    return json(res, 200, {
      status: true,
      message: "Narration generated successfully.",
      data: {
        provider: "ElevenLabs",
        modelId,
        voiceId,
        voiceName,
        mimeType: "audio/mpeg",
        audioBase64: audioBuffer.toString("base64"),
      },
    });
  } catch (error) {
    return json(res, 500, {
      status: false,
      message: error instanceof Error ? error.message : "Narration generation failed.",
    });
  }
}
