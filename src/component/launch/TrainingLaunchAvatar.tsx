import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  TrulienceAvatar as TrulienceAvatarSdk,
  type TrulienceAvatarProps,
} from "@trulience/react-sdk";

const trulienceSdkUrl = "https://trulience.com/sdk/trulience.sdk.js";

const resolveLanguageCode = (value?: string) => {
  const normalized = String(value || "").trim();
  const matches = [...normalized.matchAll(/\(([^()]+)\)/g)];
  const candidate = (matches.length ? matches[matches.length - 1]?.[1] : normalized) || normalized;
  return candidate.trim();
};

const normalizeTranscript = (eventData: unknown) => {
  if (typeof eventData === "string") {
    return eventData.trim();
  }

  if (eventData && typeof eventData === "object") {
    const payload = eventData as Record<string, unknown>;
    return String(
      payload.finalTranscript ??
      payload.transcript ??
      payload.message ??
      payload.text ??
      payload.result ??
      "",
    ).trim();
  }

  return "";
};

const emitTranscript = (eventData: unknown, onTranscript?: (transcript: string) => void) => {
  const transcript = normalizeTranscript(eventData);

  if (!transcript) {
    return;
  }

  onTranscript?.(transcript);
};

const avatarStatusLookup = {
  0: "idle",
  1: "talking",
  2: "listening",
  3: "unloaded",
  4: "loaded",
  5: "thinking",
  6: "loading",
} as const;

export type TrainingLaunchAvatarStatusState =
  | (typeof avatarStatusLookup)[keyof typeof avatarStatusLookup]
  | "unknown";

export type TrainingLaunchAvatarStatus = {
  raw: unknown;
  code: number | null;
  state: TrainingLaunchAvatarStatusState;
};

const normalizeAvatarStatus = (status: unknown): TrainingLaunchAvatarStatus => {
  if (typeof status === "number") {
    return {
      raw: status,
      code: status,
      state: avatarStatusLookup[status as keyof typeof avatarStatusLookup] ?? "unknown",
    };
  }

  if (typeof status === "string") {
    const normalized = status.trim().toLowerCase();
    const matchingEntry = Object.entries(avatarStatusLookup).find(([, label]) => label === normalized);

    return {
      raw: status,
      code: matchingEntry ? Number(matchingEntry[0]) : null,
      state: (matchingEntry?.[1] as TrainingLaunchAvatarStatusState | undefined) ?? "unknown",
    };
  }

  if (status && typeof status === "object") {
    const payload = status as Record<string, unknown>;
    const nextStatus =
      payload.avatarStatus ??
      payload.status ??
      payload.state ??
      payload.value ??
      payload.code;

    if (nextStatus !== undefined) {
      return normalizeAvatarStatus(nextStatus);
    }
  }

  return {
    raw: status,
    code: null,
    state: "unknown",
  };
};

export type TrainingLaunchAvatarHandle = {
  primeAudio: () => void;
  attachAudioElement: (audioElement: HTMLAudioElement | null) => void;
  pushTrainingContext: (payload: { trainingId?: string; currentSlideId?: string | null }) => boolean;
  speakText: (payload: { text: string; trainingId?: string; currentSlideId?: string | null }) => boolean;
  silence: () => void;
  stop: () => void;
  stopSpeaking: () => void;
  startListening: () => boolean;
  stopListening: () => void;
  setMuted: (muted: boolean) => void;
  isReady: () => boolean;
};

type TrainingLaunchAvatarPropsCustom = {
  avatarId: string;
  language?: string;
  username?: string;
  positionClass: string;
  onReady?: () => void;
  onTranscript?: (transcript: string) => void;
  onMicChange?: (enabled: boolean) => void;
  onStatusChange?: (status: TrainingLaunchAvatarStatus) => void;
};

type AvatarSdkObject = {
  fixAudioContext?: () => void;
  setWaitForUnmute?: (waitForUnmute: boolean) => void;
  setSpeechRecogLang?: (lang: string) => void;
  setMicEnabled?: (status: boolean, userInteraction?: boolean) => void;
  setSpeakerEnabled?: (status: boolean) => void;
  stopAvatarSpeech?: () => void;
  setMediaStream?: (mediaStream: MediaStream) => void;
  setNeedMicAccess?: (needAccess: boolean) => void;
  isMicEnabled?: () => boolean;
  toggleMic?: () => void;
  sendMessage?: (message: string) => void;
  sendMessageToAvatar?: (message: string) => void;
  isConnected?: () => boolean;
};

const TrainingLaunchAvatar = (
  {
    avatarId,
    language,
    username = "Learner",
    positionClass,
    onReady,
    onTranscript,
    onMicChange,
    onStatusChange,
  }: TrainingLaunchAvatarPropsCustom,
  ref: Ref<TrainingLaunchAvatarHandle>,
) => {
  const sdkRef = useRef<InstanceType<typeof TrulienceAvatarSdk> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioBridgeReadyRef = useRef(false);
  const readyNotifiedRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const mutedRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [avatarRenderKey, setAvatarRenderKey] = useState(0);
  const speechLanguage = resolveLanguageCode(language);

  const getAvatarObject = () => (sdkRef.current?.getTrulienceObject?.() ?? null) as AvatarSdkObject | null;

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const getAudioContext = () => {
    if (typeof window === "undefined") {
      return null;
    }

    const windowWithWebkitAudio = window as Window & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextConstructor = window.AudioContext || windowWithWebkitAudio.webkitAudioContext;

    if (!AudioContextConstructor) {
      return null;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextConstructor();
    }

    return audioContextRef.current;
  };

  const ensureAudioBridge = (audioElement: HTMLAudioElement | null) => {
    if (!audioElement) {
      return null;
    }

    const context = getAudioContext();

    if (!context) {
      return null;
    }

    if (!audioDestinationRef.current) {
      audioDestinationRef.current = context.createMediaStreamDestination();
    }

    if (!audioSourceRef.current || audioElementRef.current !== audioElement) {
      if (audioSourceRef.current) {
        audioSourceRef.current.disconnect();
      }

      audioSourceRef.current = context.createMediaElementSource(audioElement);
      audioElementRef.current = audioElement;
      audioBridgeReadyRef.current = false;
    }

    if (!audioBridgeReadyRef.current && audioSourceRef.current && audioDestinationRef.current) {
      audioSourceRef.current.connect(context.destination);
      audioSourceRef.current.connect(audioDestinationRef.current);
      audioBridgeReadyRef.current = true;
    }

    return {
      context,
      stream: audioDestinationRef.current?.stream ?? null,
    };
  };

  const silenceAvatar = () => {
    const avatar = getAvatarObject();

    if (!avatar) {
      return;
    }

    // avatar.stopAvatarSpeech?.();
    avatar.setMicEnabled?.(false);
  };

  const sendBridgePayload = (payload: Record<string, unknown>) => {
    const avatar = getAvatarObject();

    if (!avatar || !isConnected) {
      return false;
    }

    const serializedPayload = JSON.stringify(payload);
    avatar.sendMessage?.(serializedPayload);
    return true;
  };

  const attachAudioElement = (audioElement: HTMLAudioElement | null) => {
    const avatar = getAvatarObject();

    if (!avatar || !audioElement) {
      return;
    }

    const bridge = ensureAudioBridge(audioElement);

    if (!bridge?.stream) {
      return;
    }

    avatar.fixAudioContext?.();
    avatar.setWaitForUnmute?.(false);
    avatar.setSpeakerEnabled?.(false);
    avatar.setMediaStream?.(bridge.stream);
    void bridge.context.resume?.().catch(() => undefined);
  };

  const primeAudio = () => {
    const avatar = getAvatarObject();

    if (!avatar) {
      return;
    }

    avatar.fixAudioContext?.();
    avatar.setWaitForUnmute?.(false);
    avatar.setSpeakerEnabled?.(!mutedRef.current);
    void getAudioContext()?.resume?.().catch(() => undefined);

    if (speechLanguage) {
      avatar.setSpeechRecogLang?.(speechLanguage);
    }

    if (audioElementRef.current) {
      attachAudioElement(audioElementRef.current);
    }
  };

  const markReady = () => {
    clearReconnectTimer();
    setIsConnected(true);
    primeAudio();
    silenceAvatar();

    if (audioElementRef.current) {
      attachAudioElement(audioElementRef.current);
    }

    if (readyNotifiedRef.current) {
      return;
    }

    readyNotifiedRef.current = true;
    setIsReady(true);
    onReady?.();
  };

  const markDisconnected = () => {
    setIsConnected(false);
    onMicChange?.(false);
    clearReconnectTimer();
    reconnectTimerRef.current = window.setTimeout(() => {
      setAvatarRenderKey((current) => current + 1);
    }, 1200);
  };

  const eventCallbacks: NonNullable<TrulienceAvatarProps["eventCallbacks"]> = {
    "auth-success": () => {
      markReady();
    },
    "websocket-connect": () => {
      markReady();
    },
    "media-connected": () => {
      markReady();
    },
    "websocket-disconnect": () => {
      markDisconnected();
    },
    "websocket-disconnected": () => {
      markDisconnected();
    },
    "websocket-close": () => {
      markDisconnected();
    },
    "websocket-error": () => {
      markDisconnected();
    },
    disconnect: () => {
      markDisconnected();
    },
    "speech-recognition-final-transcript": (eventData: unknown) => {
      emitTranscript(eventData, onTranscript);
    },
    "speech-recognition-result": (eventData: unknown) => {
      emitTranscript(eventData, onTranscript);
    },
    "speech-recognition-transcript": (eventData: unknown) => {
      emitTranscript(eventData, onTranscript);
    },
    "speech-recognition-final": (eventData: unknown) => {
      emitTranscript(eventData, onTranscript);
    },
    "speech-recognition-final-result": (eventData: unknown) => {
      emitTranscript(eventData, onTranscript);
    },
    "speech-recognition-text": (eventData: unknown) => {
      emitTranscript(eventData, onTranscript);
    },
    "mic-update": (enabled: unknown) => {
      onMicChange?.(Boolean(enabled));
    },
    "speech-recognition-start": () => {
      onMicChange?.(true);
    },
    "speech-recognition-end": () => {
      onMicChange?.(false);
    },
    "avatar-status-update": (status: unknown) => {
      onStatusChange?.(normalizeAvatarStatus(status));
    },
  };

  useEffect(() => () => clearReconnectTimer(), []);

  useImperativeHandle(
    ref,
    () => ({
      primeAudio: () => {
        primeAudio();
      },
      attachAudioElement: (audioElement: HTMLAudioElement | null) => {
        if (!audioElement) {
          return;
        }

        attachAudioElement(audioElement);
      },
      pushTrainingContext: ({ trainingId, currentSlideId }) =>
        sendBridgePayload({
          type: "training-context",
          trainingId,
          currentSlideId,
        }),
      speakText: ({ text, trainingId, currentSlideId }) => {
        const normalizedText = String(text || "").trim();

        if (!normalizedText) {
          return false;
        }

        const avatar = getAvatarObject();

        if (!avatar) {
          return false;
        }

        primeAudio();
        silenceAvatar();

        // Main Trulience speech trigger
        avatar.sendMessageToAvatar?.(normalizedText);

        sendBridgePayload({
          type: "speak",
          text: normalizedText,
          trainingId,
          currentSlideId,
        });

        return true;
      },
      silence: () => {
        silenceAvatar();
      },
      stop: () => {
        silenceAvatar();
      },
      stopSpeaking: () => {
        // silenceAvatar();
        const avatar = getAvatarObject();
        avatar?.setSpeakerEnabled?.(false);
        // avatar?.stopAvatarSpeech?.();
      },
      startListening: () => {
        const avatar = getAvatarObject();

        if (!avatar || !isConnected) {
          return false;
        }

        primeAudio();
        silenceAvatar();
        avatar.setNeedMicAccess?.(true);
        avatar.setWaitForUnmute?.(false);
        avatar.setSpeakerEnabled?.(!mutedRef.current);
        if (avatar.isMicEnabled?.()) {
          return true;
        }

        avatar.setMicEnabled?.(true, true);

        if (!avatar.isMicEnabled?.() && typeof avatar.toggleMic === "function") {
          avatar.toggleMic();
        }

        return true;
      },
      stopListening: () => {
        const avatar = getAvatarObject();

        if (!avatar) {
          return;
        }

        avatar.setMicEnabled?.(false);
      },
      setMuted: (muted: boolean) => {
        mutedRef.current = muted;
        getAvatarObject()?.setSpeakerEnabled?.(!muted);
      },
      isReady: () => isReady,
    }),
  );

  return (
    <div className={`training-launch-avatar ${positionClass}${isConnected ? " is-connected" : ""}`}>
      <div className="training-launch-avatar-native">
        <TrulienceAvatarSdk
          key={avatarRenderKey}
          ref={sdkRef}
          avatarId={avatarId}
          url={trulienceSdkUrl}
          width="100%"
          height="100%"
          username={username}
          backgroundColor="transparent"
          eventCallbacks={eventCallbacks}
          autoConnect
          retry
          style={{ backgroundColor: "transparent" }}
        />
      </div>
    </div>
  );
};

export default forwardRef(TrainingLaunchAvatar);
