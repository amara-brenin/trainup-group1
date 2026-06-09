import { useDeferredValue, useEffect, useState } from "react";
import { generateScriptAudioDataUri } from "../../helper/scriptAudio";

type ScriptAudioPlayerProps = {
  script: string;
  provider?: string;
  voiceName?: string;
  voiceId?: string;
  modelId?: string;
  apiKey?: string;
  trainingId?: string;
  className?: string;
};

type AudioState = {
  status: "idle" | "loading" | "ready" | "error";
  src: string;
  message: string;
};

const initialAudioState: AudioState = {
  status: "idle",
  src: "",
  message: "",
};

const ScriptAudioPlayer = ({
  script,
  provider,
  voiceName,
  voiceId,
  modelId,
  apiKey,
  trainingId,
  className = "",
}: ScriptAudioPlayerProps) => {
  const deferredScript = useDeferredValue(script);
  const [audioState, setAudioState] = useState<AudioState>(initialAudioState);

  useEffect(() => {
    const normalized = deferredScript.trim();

    if (!normalized) {
      setAudioState(initialAudioState);
      return () => undefined;
    }

    let active = true;
    const timeoutId = window.setTimeout(() => {
      setAudioState((current) => ({ ...current, status: "loading" }));

      void generateScriptAudioDataUri(normalized, {
        provider,
        voiceName,
        voiceId,
        modelId,
        apiKey,
        trainingId,
      })
        .then((src) => {
          if (!active) {
            return;
          }

          setAudioState({
            status: src ? "ready" : "idle",
            src,
            message: "",
          });
        })
        .catch((error: unknown) => {
          if (!active) {
            return;
          }

          setAudioState({
            status: "error",
            src: "",
            message: error instanceof Error ? error.message : "Audio preview could not be generated for this script.",
          });
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [apiKey, deferredScript, modelId, provider, trainingId, voiceId, voiceName]);

  if (!script.trim()) {
    return (
      <div className={`training-audio-player-empty ${className}`.trim()}>
        Add narration script to generate the slide audio preview.
      </div>
    );
  }

  if (audioState.status === "loading") {
    return (
      <div className={`training-audio-player-empty ${className}`.trim()}>
        Generating narration audio from the current script...
      </div>
    );
  }

  if (audioState.status === "error") {
    return (
      <div className={`training-audio-player-empty ${className}`.trim()}>
        {audioState.message || "Audio preview could not be generated for this script."}
      </div>
    );
  }

  return (
    <div className={`training-audio-player ${className}`.trim()}>
      <audio controls preload="metadata" className="w-100" src={audioState.src} />
    </div>
  );
};

export default ScriptAudioPlayer;
