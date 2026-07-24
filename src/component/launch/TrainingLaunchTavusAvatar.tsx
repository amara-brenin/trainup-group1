import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import DailyIframe, { type DailyCall } from "@daily-co/daily-js";
import AxiosHelper from "../../helper/AxiosHelper";
import type { TrainingLaunchAvatarHandle, TrainingLaunchAvatarStatus } from "./TrainingLaunchAvatar";

type TavusSessionResponse = {
  conversationId: string;
  conversationUrl: string;
  status?: string;
};

type TrainingLaunchTavusAvatarPropsCustom = {
  // For Tavus this is the replica id (avatarEngine.replicaId, falls back to avatarId).
  avatarId: string;
  personaId?: string;
  // Trainer-selected ElevenLabs voice for this training (overrides the
  // avatar's default voice baked into its Tavus persona).
  voiceId?: string;
  // Used server-side to ground Tavus's native conversation (Ask mode Q&A) in
  // this specific training's Ask Assistant Prompt + knowledge base, scoped
  // per-conversation — never shared across other trainings on the same avatar.
  trainingId?: string;
  language?: string;
  username?: string;
  positionClass: string;
  onReady?: () => void;
  onTranscript?: (transcript: string) => void;
  onMicChange?: (enabled: boolean) => void;
  onStatusChange?: (status: TrainingLaunchAvatarStatus) => void;
};

// Tavus's own persona/LLM never drives the conversation here — every utterance
// is pushed explicitly via the Interactions Protocol "conversation.echo" event,
// mirroring how TrainingLaunchAvatar (Trulience) is driven by speakText(). This
// keeps behavior identical across providers: the avatar only ever says what the
// training app tells it to say.
const sendEcho = (callFrame: DailyCall | null, conversationId: string | null, text: string, joined: boolean) => {
  // sendAppMessage() throws synchronously ("only supported after join") if the
  // Daily call hasn't finished joining yet — e.g. stopSpeaking() fires from
  // TrainingLaunch's stopCurrentPlayback() the instant training starts, well
  // before our own "joined-meeting" event has landed.
  if (!callFrame || !conversationId || !joined) {
    return false;
  }

  callFrame.sendAppMessage(
    {
      message_type: "conversation",
      event_type: "conversation.echo",
      conversation_id: conversationId,
      properties: { text },
    },
    "*",
  );

  return true;
};

const TrainingLaunchTavusAvatar = (
  {
    avatarId,
    personaId,
    voiceId,
    trainingId,
    positionClass,
    onReady,
    onTranscript,
    onMicChange,
    onStatusChange,
  }: TrainingLaunchTavusAvatarPropsCustom,
  ref: Ref<TrainingLaunchAvatarHandle>,
) => {
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const remoteStreamRef = useRef<MediaStream>(new MediaStream());
  const callFrameRef = useRef<DailyCall | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const replicaSessionIdRef = useRef<string | null>(null);
  const joinedRef = useRef(false);
  const readyNotifiedRef = useRef(false);
  const mutedRef = useRef(false);
  const pendingSpeechRef = useRef<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      try {
        const res = await AxiosHelper.postData<TavusSessionResponse>("/avatars/tavus/session", {
          replicaId: avatarId,
          personaId,
          voiceId,
          trainingId,
        });

        if (cancelled) {
          return;
        }

        if (!res.data.status || !res.data.data?.conversationUrl) {
          console.error("Tavus session creation failed", res.data);
          return;
        }

        conversationIdRef.current = res.data.data.conversationId;

        // Headless call object — renders nothing of its own (no Daily/Tavus
        // prejoin screen, no in-call controls). We own 100% of the UI: just
        // the replica's raw video+audio tracks piped into our own <video>.
        const callFrame = DailyIframe.createCallObject({
          subscribeToTracksAutomatically: true,
        });

        callFrameRef.current = callFrame;

        callFrame.on("joined-meeting", () => {
          setIsConnected(true);
        });

        callFrame.on("track-started", (event) => {
          const participant = event?.participant;
          const track = event?.track;

          if (!participant || participant.local || !track) {
            return;
          }

          if (event?.type === "video" || event?.type === "audio") {
            remoteStreamRef.current.addTrack(track);

            if (videoElRef.current && videoElRef.current.srcObject !== remoteStreamRef.current) {
              videoElRef.current.srcObject = remoteStreamRef.current;
            }

            void videoElRef.current?.play().catch(() => undefined);
          }
        });

        callFrame.on("track-stopped", (event) => {
          const track = event?.track;

          if (track) {
            remoteStreamRef.current.removeTrack(track);
          }
        });

        callFrame.on("participant-joined", (event) => {
          const participant = event?.participant;

          if (!participant || participant.local) {
            return;
          }

          replicaSessionIdRef.current = participant.session_id;
          onStatusChange?.({ raw: "loaded", code: 4, state: "loaded" });

          if (!readyNotifiedRef.current) {
            readyNotifiedRef.current = true;
            setIsReady(true);
            onReady?.();
          }

          const queuedText = pendingSpeechRef.current;
          if (queuedText) {
            pendingSpeechRef.current = null;
            sendEcho(callFrameRef.current, conversationIdRef.current, queuedText, joinedRef.current);
          }
        });

        callFrame.on("participant-left", (event) => {
          if (event?.participant?.session_id === replicaSessionIdRef.current) {
            replicaSessionIdRef.current = null;
          }
        });

        callFrame.on("left-meeting", () => {
          joinedRef.current = false;
          setIsConnected(false);
          onMicChange?.(false);
        });

        callFrame.on("error", (event) => {
          console.error("Tavus/Daily call error", event);
          joinedRef.current = false;
          setIsConnected(false);
        });

        callFrame.on("app-message", (event) => {
          const payload = event?.data as Record<string, unknown> | undefined;

          if (!payload) {
            return;
          }

          const eventType = String(payload.event_type || payload.message_type || "");

          if (eventType.includes("utterance") || eventType.includes("transcript")) {
            const properties = (payload.properties as Record<string, unknown> | undefined) || {};
            const role = String(properties.role || payload.role || "");
            const text = String(properties.text || payload.text || "").trim();

            if (text && role !== "replica" && role !== "assistant") {
              onTranscript?.(text);
            }
          }

          if (eventType.includes("replica_started_speaking")) {
            onStatusChange?.({ raw: eventType, code: 1, state: "talking" });
          }

          if (eventType.includes("replica_stopped_speaking")) {
            onStatusChange?.({ raw: eventType, code: 0, state: "idle" });
          }
        });

        // No camera needed — the learner's video only ever goes to
        // proctoring, never into the Tavus call. Mic starts off; toggled via
        // startListening()/stopListening() for the Ask-a-question flow.
        await callFrame.join({
          url: res.data.data.conversationUrl,
          startAudioOff: true,
          startVideoOff: true,
        });

        if (cancelled) {
          return;
        }

        joinedRef.current = true;

        const queuedText = pendingSpeechRef.current;
        if (queuedText) {
          pendingSpeechRef.current = null;
          sendEcho(callFrameRef.current, conversationIdRef.current, queuedText, joinedRef.current);
        }
      } catch (error) {
        console.error("Failed to initialize Tavus avatar", error);
      }
    };

    void setup();

    return () => {
      cancelled = true;
      joinedRef.current = false;
      readyNotifiedRef.current = false;
      remoteStreamRef.current.getTracks().forEach((track) => remoteStreamRef.current.removeTrack(track));

      const callFrame = callFrameRef.current;
      const conversationId = conversationIdRef.current;
      callFrameRef.current = null;

      if (callFrame) {
        callFrame.leave().catch(() => undefined);
        callFrame.destroy().catch(() => undefined);
      }

      if (conversationId) {
        AxiosHelper.postData(`/avatars/tavus/session/${conversationId}/end`, {}).catch(() => undefined);
      }
    };
    // Only (re)initialize when the underlying avatar identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarId, personaId, voiceId, trainingId]);

  useImperativeHandle(
    ref,
    () => ({
      primeAudio: () => {
        void videoElRef.current?.play().catch(() => undefined);
      },
      attachAudioElement: () => {
        // Audio plays directly from the replica's MediaStream via the <video>
        // element above; no separate bridge element needed for Tavus.
      },
      pushTrainingContext: () => false,
      speakText: ({ text }) => {
        const normalizedText = String(text || "").trim();

        if (!normalizedText) {
          return false;
        }

        if (!joinedRef.current || !replicaSessionIdRef.current) {
          pendingSpeechRef.current = normalizedText;
          return false;
        }

        pendingSpeechRef.current = null;
        return sendEcho(callFrameRef.current, conversationIdRef.current, normalizedText, joinedRef.current);
      },
      silence: () => {
        callFrameRef.current?.setLocalAudio(false);
      },
      stop: () => {
        callFrameRef.current?.setLocalAudio(false);
      },
      stopSpeaking: () => {
        sendEcho(callFrameRef.current, conversationIdRef.current, "", joinedRef.current);
      },
      startListening: () => {
        if (!callFrameRef.current || !isConnected) {
          return false;
        }

        callFrameRef.current.setLocalAudio(true);
        onMicChange?.(true);
        return true;
      },
      stopListening: () => {
        callFrameRef.current?.setLocalAudio(false);
        onMicChange?.(false);
      },
      setMuted: (muted: boolean) => {
        mutedRef.current = muted;
        if (videoElRef.current) {
          videoElRef.current.muted = muted;
        }
      },
      isReady: () => isReady,
    }),
    [isConnected, isReady],
  );

  return (
    <div className={`training-launch-avatar ${positionClass}${isConnected ? " is-connected" : ""}`}>
      <div className="training-launch-avatar-native">
        <video
          ref={videoElRef}
          autoPlay
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    </div>
  );
};

export default forwardRef(TrainingLaunchTavusAvatar);
