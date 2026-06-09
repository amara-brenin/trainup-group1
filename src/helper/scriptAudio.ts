import { getRequestUrl } from "./runtimeApi";

type MeSpeakModule = {
  isConfigLoaded?: () => boolean;
  isVoiceLoaded?: () => boolean;
  loadConfig: (config: unknown) => void;
  loadVoice: (voice: unknown) => void;
  speak: (text: string, options: Record<string, unknown>) => string;
};

export type ScriptAudioRequestOptions = {
  provider?: string;
  voiceName?: string;
  voiceId?: string;
  modelId?: string;
  apiKey?: string;
  trainingId?: string;
};

type RemoteTtsErrorPayload = {
  message?: string;
};

let meSpeakPromise: Promise<MeSpeakModule> | null = null;
const audioCache = new Map<string, string>();

const ensureMeSpeak = async () => {
  if (!meSpeakPromise) {
    meSpeakPromise = (async () => {
      const [module, configResponse, voiceResponse] = await Promise.all([
        import("mespeak"),
        fetch("/mespeak/mespeak_config.json"),
        fetch("/mespeak/en-us.json"),
      ]);

      if (!configResponse.ok || !voiceResponse.ok) {
        throw new Error("Unable to load narration voice assets.");
      }

      const [config, voice] = await Promise.all([configResponse.json(), voiceResponse.json()]);
      const meSpeak = (module.default ?? module) as MeSpeakModule;

      if (!meSpeak.isConfigLoaded?.()) {
        meSpeak.loadConfig(config);
      }

      if (!meSpeak.isVoiceLoaded?.()) {
        meSpeak.loadVoice(voice);
      }

      return meSpeak;
    })();
  }

  return meSpeakPromise;
};

const generateLocalScriptAudioDataUri = async (script: string) => {
  const meSpeak = await ensureMeSpeak();

  return meSpeak.speak(script, {
    rawdata: "mime",
    amplitude: 100,
    pitch: 46,
    speed: 162,
  });
};

const generateRemoteScriptAudioDataUri = async (script: string, options: ScriptAudioRequestOptions) => {
  const response = await fetch(getRequestUrl("/tts"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: script,
      provider: options.provider,
      voiceName: options.voiceName,
      voiceId: options.voiceId,
      modelId: options.modelId,
      apiKey: options.apiKey,
      trainingId: options.trainingId,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as RemoteTtsErrorPayload | null;
    throw new Error(payload?.message || "Remote TTS generation failed.");
  }

  const payload = (await response.json()) as {
    data?: {
      audioBase64?: string;
      mimeType?: string;
    };
  };

  const audioBase64 = payload.data?.audioBase64 ?? "";
  const mimeType = payload.data?.mimeType ?? "audio/mpeg";

  if (!audioBase64) {
    throw new Error("Remote TTS response was empty.");
  }

  return `data:${mimeType};base64,${audioBase64}`;
};

export const buildScriptAudioKey = (script: string, options?: ScriptAudioRequestOptions) =>
  [
    options?.provider ?? "default",
    options?.voiceName ?? "default",
    options?.voiceId ?? "default",
    options?.modelId ?? "default",
    options?.apiKey ?? "default",
    options?.trainingId ?? "default",
    script.trim(),
  ].join("::");

export const generateScriptAudioDataUri = async (script: string, options: ScriptAudioRequestOptions = {}) => {
  const normalized = script.trim();

  if (!normalized) {
    return "";
  }

  const cacheKey = buildScriptAudioKey(normalized, options);

  if (audioCache.has(cacheKey)) {
    return audioCache.get(cacheKey) as string;
  }

  const shouldUseRemoteProvider = options.provider?.toLowerCase() === "elevenlabs";
  let audioDataUri = "";

  if (shouldUseRemoteProvider) {
    audioDataUri = await generateRemoteScriptAudioDataUri(normalized, options);
  } else {
    audioDataUri = await generateLocalScriptAudioDataUri(normalized);
  }

  audioCache.set(cacheKey, audioDataUri);
  return audioDataUri;
};
