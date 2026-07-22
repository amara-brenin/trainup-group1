import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import type { TrainingProctoringReport } from "../../constant/interfaces";

const PROCTORING_APP_URL = "https://interview-proctoring-02o3.onrender.com";
const FRAME_INTERVAL_MS = 125;
const SOCKET_CONNECT_TIMEOUT_MS = 15000;
const INITIAL_CONNECT_RETRIES = 2;
const INITIAL_CONNECT_RETRY_DELAY_MS = 4000;
const MAX_EVENT_LOGS = 36;
const MAX_TIMELINE_POINTS = 180;
const MAX_RECONNECT_ATTEMPTS = 6;
const RECONNECT_DELAY_MS = 2500;
const RISK_RECOVERY_INTERVAL_MS = 2000;
const RISK_RECOVERY_IDLE_MS = 6000;
const RISK_RECOVERY_STEP = 3;
const EVENT_COOLDOWN_MS: Record<string, number> = {
  reading: 4500,
  talking: 3500,
  looking_away: 2500,
  tab_switch: 8000,
  no_face: 3500,
  crowd: 4000,
  another_device: 5000,
  candidate_returned: 2500,
};
const EVENT_RISK_WEIGHTS = {
  reading: 0,
  talking: 0,
  lookingAway: 9,
  tabSwitch: 18,
  noFace: 12,
  multipleFaces: 16,
  anotherDevice: 20,
  returnedToInterview: 0,
} as const;

type TrainingLaunchProctoringHandle = {
  startSession: () => Promise<boolean>;
  stopSession: () => TrainingProctoringReport | null;
  resetSession: () => void;
  getSnapshot: () => TrainingProctoringReport | null;
};

type TrainingLaunchProctoringProps = {
  className?: string;
  onStatusChange?: (status: TrainingProctoringReport["status"]) => void;
};

type ProctoringSocketPayload = {
  risk_score?: number;
  message?: string;
  type?: string;
  event_code?: string;
  vision_data?: Array<
    | {
      xmin: number;
      ymin: number;
      width: number;
      height: number;
    }
    | {
      x: number;
      y: number;
    }
  >;
  vision_type?: "boxes" | "mesh";
};

const createInitialCounts = () => ({
  reading: 0,
  talking: 0,
  lookingAway: 0,
  tabSwitch: 0,
  noFace: 0,
  multipleFaces: 0,
  returnedToInterview: 0,
  anotherDevice: 0,
});

const formatLogTimestamp = (value = new Date()) =>
  value.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const clampScore = (value: unknown) =>
  Math.max(0, Math.min(100, Number(value || 0)));

const getAttentionLabel = (score: number) => {
  if (score >= 85) {
    return "Focused";
  }

  if (score >= 60) {
    return "Needs Attention";
  }

  return "Critical";
};

const formatScoreValue = (value: number) => {
  const nextValue = Math.max(0, Math.min(100, Number(value || 0)));

  if (Number.isInteger(nextValue)) {
    return String(nextValue);
  }

  return nextValue.toFixed(3).replace(/\.?0+$/, "");
};

const getRiskDeltaForEvent = (eventCode: string) => {
  if (eventCode === "looking_away") return EVENT_RISK_WEIGHTS.lookingAway;
  if (eventCode === "tab_switch") return EVENT_RISK_WEIGHTS.tabSwitch;
  if (eventCode === "no_face") return EVENT_RISK_WEIGHTS.noFace;
  if (eventCode === "crowd") return EVENT_RISK_WEIGHTS.multipleFaces;
  if (eventCode === "another_device") return EVENT_RISK_WEIGHTS.anotherDevice;
  return 0;
};

const normalizeEventCode = (value: unknown) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (
    normalized === "reading" ||
    normalized === "talking" ||
    normalized === "looking_away" ||
    normalized === "tab_switch" ||
    normalized === "tab_focus" ||
    normalized === "no_face" ||
    normalized === "crowd" ||
    normalized === "mobile_detected" ||
    normalized === "another_device" ||
    normalized === "candidate_returned"
  ) {
    if (normalized === "tab_focus") {
      return "candidate_returned";
    }

    if (normalized === "mobile_detected") {
      return "another_device";
    }

    return normalized;
  }

  return "";
};

const inferEventCodeFromMessage = (value: unknown) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized) {
    return "";
  }

  if (
    normalized.includes("2 faces detected") ||
    normalized.includes("two faces detected") ||
    normalized.includes("multiple faces")
  ) {
    return "crowd";
  }

  if (
    normalized.includes("candidate returned to interview") ||
    normalized.includes("returned to interview")
  ) {
    return "candidate_returned";
  }

  if (normalized.includes("another tab") || normalized.includes("tab switch")) {
    return "tab_switch";
  }

  if (normalized.includes("speaking detected") || normalized.includes("speaking!")) {
    return "talking";
  }

  if (normalized.includes("screen reading") || normalized.includes("reading screen")) {
    return "reading";
  }

  if (normalized.includes("looking away")) {
    return "looking_away";
  }

  if (
    normalized.includes("another device") ||
    normalized.includes("mobile detect") ||
    normalized.includes("mobile detected") ||
    normalized.includes("phone detected")
  ) {
    return "another_device";
  }

  if (normalized.includes("no face") || normalized.includes("face not detected")) {
    return "no_face";
  }

  return "";
};

const createEmptyReport = (): TrainingProctoringReport => ({
  status: "idle",
  attentionScore: 100,
  riskScore: 0,
  attentionLabel: "Focused",
  startedAt: null,
  completedAt: null,
  aiVisionEnabled: false,
  sourceUrl: PROCTORING_APP_URL,
  eventCounts: createInitialCounts(),
  timeline: [],
  events: [],
});

const buildSocketUrl = () => {
  const url = new URL(PROCTORING_APP_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
};

const getElapsedLabel = (startedAtMs: number) => {
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const elapsedSeconds = Math.round(elapsedMs / 1000);

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
};

const waitForVideoLive = (element: HTMLVideoElement) =>
  new Promise<void>((resolve) => {
    const isLive = () =>
      element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      element.videoWidth > 0 &&
      element.videoHeight > 0 &&
      !element.paused;

    if (isLive()) {
      resolve();
      return;
    }

    const handleReady = () => {
      if (!isLive()) {
        return;
      }

      element.removeEventListener("loadeddata", handleReady);
      element.removeEventListener("canplay", handleReady);
      element.removeEventListener("playing", handleReady);
      resolve();
    };

    element.addEventListener("loadeddata", handleReady);
    element.addEventListener("canplay", handleReady);
    element.addEventListener("playing", handleReady);
  });

const TrainingLaunchProctoring = (
  { className = "", onStatusChange }: TrainingLaunchProctoringProps,
  ref: Ref<TrainingLaunchProctoringHandle>,
) => {
  const [report, setReport] = useState<TrainingProctoringReport>(() =>
    createEmptyReport(),
  );
  const [showVision] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const captureIntervalRef = useRef<number | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const reportRef = useRef<TrainingProctoringReport>(createEmptyReport());
  const sessionStartedAtRef = useRef<number | null>(null);
  const manualStopRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectSessionRef = useRef<(() => Promise<void>) | null>(null);
  const riskScoreRef = useRef(0);
  const lastRiskEventAtRef = useRef(0);
  const recoveryIntervalRef = useRef<number | null>(null);
  const lastCountedEventAtRef = useRef<Record<string, number>>({});
  const tabSwitchActiveRef = useRef(false);
  const lastLogAtRef = useRef<Record<string, number>>({});
  const onStatusChangeRef = useRef(onStatusChange);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    // Wake up the proctoring service (Render free tier) as early as possible
    fetch(PROCTORING_APP_URL, { mode: "no-cors" }).catch(() => undefined);
  }, []);

  const commitReport = useCallback(
    (
      value:
        | TrainingProctoringReport
        | ((
          current: TrainingProctoringReport,
        ) => TrainingProctoringReport),
    ) => {
      const next =
        typeof value === "function"
          ? value(reportRef.current)
          : value;
      reportRef.current = next;
      setReport(next);
      onStatusChangeRef.current?.(next.status);
      return next;
    },
    [],
  );

  const clearVisionOverlay = useCallback(() => {
    const canvas = overlayRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const pushLog = useCallback(
    (message: string) => {
      const normalizedMessage = String(message || "").trim();

      if (!normalizedMessage) {
        return;
      }

      commitReport((current) => ({
        ...current,
        events: [
          ...current.events,
          {
            timestamp: formatLogTimestamp(),
            message: normalizedMessage,
          },
        ].slice(-MAX_EVENT_LOGS),
      }));
    },
    [commitReport],
  );

  const pushLogWithCooldown = useCallback(
    (message: string, cooldownMs = 2000) => {
      const normalizedMessage = String(message || "").trim();

      if (!normalizedMessage) {
        return;
      }

      const now = Date.now();
      const lastLoggedAt = lastLogAtRef.current[normalizedMessage] ?? 0;

      if (now - lastLoggedAt < cooldownMs) {
        return;
      }

      lastLogAtRef.current[normalizedMessage] = now;
      pushLog(normalizedMessage);
    },
    [pushLog],
  );

  const syncVisionFlag = useCallback(
    (enabled: boolean) => {
      commitReport((current) => ({
        ...current,
        aiVisionEnabled: enabled,
      }));

      if (!enabled) {
        clearVisionOverlay();
      }
    },
    [clearVisionOverlay, commitReport],
  );

  const stopMediaStream = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const stopCaptureLoop = useCallback(() => {
    if (captureIntervalRef.current !== null) {
      window.clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
  }, []);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const stopRecoveryLoop = useCallback(() => {
    if (recoveryIntervalRef.current !== null) {
      window.clearInterval(recoveryIntervalRef.current);
      recoveryIntervalRef.current = null;
    }
  }, []);

  const startRecoveryLoop = useCallback(() => {
    stopRecoveryLoop();

    recoveryIntervalRef.current = window.setInterval(() => {
      if (reportRef.current.status !== "monitoring") {
        return;
      }

      if (riskScoreRef.current <= 0) {
        return;
      }

      const now = Date.now();

      if (now - lastRiskEventAtRef.current < RISK_RECOVERY_IDLE_MS) {
        return;
      }

      const nextRiskScore = clampScore(riskScoreRef.current - RISK_RECOVERY_STEP);

      if (nextRiskScore === riskScoreRef.current) {
        return;
      }

      riskScoreRef.current = nextRiskScore;
      const attentionScore = clampScore(100 - nextRiskScore);
      const sessionStartedAt = sessionStartedAtRef.current || now;

      commitReport((current) => ({
        ...current,
        riskScore: nextRiskScore,
        attentionScore,
        attentionLabel: getAttentionLabel(attentionScore),
        timeline: [
          ...current.timeline,
          {
            elapsedLabel: getElapsedLabel(sessionStartedAt),
            riskScore: nextRiskScore,
            attentionScore,
            eventCode: "attention_recovered",
          },
        ].slice(-MAX_TIMELINE_POINTS),
      }));
    }, RISK_RECOVERY_INTERVAL_MS);
  }, [commitReport, stopRecoveryLoop]);

  const teardownSocket = useCallback((manualStop: boolean) => {
    const socket = socketRef.current;
    socketRef.current = null;
    manualStopRef.current = manualStop;

    if (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
    ) {
      socket.close();
    }
  }, []);

  const finalizeSession = useCallback(
    (status: "stopped" | "error", message: string) =>
      commitReport((current) => {
        if (current.status === "idle") {
          return {
            ...current,
            aiVisionEnabled: showVision,
          };
        }

        return {
          ...current,
          status,
          completedAt: current.completedAt || new Date().toISOString(),
          aiVisionEnabled: showVision,
          events: [
            ...current.events,
            {
              timestamp: formatLogTimestamp(),
              message,
            },
          ].slice(-MAX_EVENT_LOGS),
        };
      }),
    [commitReport, showVision],
  );

  const drawVision = useCallback(
    (
      visionData: ProctoringSocketPayload["vision_data"],
      visionType: ProctoringSocketPayload["vision_type"],
    ) => {
      const canvas = overlayRef.current;
      const video = videoRef.current;

      if (!canvas || !video || !showVision) {
        clearVisionOverlay();
        return;
      }

      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      canvas.width = video.videoWidth || canvas.width;
      canvas.height = video.videoHeight || canvas.height;
      context.clearRect(0, 0, canvas.width, canvas.height);

      if (!Array.isArray(visionData)) {
        return;
      }

      if (visionType === "boxes") {
        context.strokeStyle = "#ff6b6b";
        context.lineWidth = 3;

        visionData.forEach((entry) => {
          if (
            !("xmin" in entry) ||
            !("ymin" in entry) ||
            !("width" in entry) ||
            !("height" in entry)
          ) {
            return;
          }

          context.strokeRect(
            entry.xmin * canvas.width,
            entry.ymin * canvas.height,
            entry.width * canvas.width,
            entry.height * canvas.height,
          );
        });

        return;
      }

      if (visionType === "mesh") {
        context.fillStyle = "#00d084";

        visionData.forEach((entry) => {
          if (!("x" in entry) || !("y" in entry)) {
            return;
          }

          context.beginPath();
          context.arc(entry.x * canvas.width, entry.y * canvas.height, 1.8, 0, 2 * Math.PI);
          context.fill();
        });
      }
    },
    [clearVisionOverlay, showVision],
  );

  const handleSocketMessage = useCallback(
    (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as ProctoringSocketPayload;
        const eventCode =
          normalizeEventCode(payload.event_code) ||
          inferEventCodeFromMessage(payload.message);
        const sessionStartedAt =
          sessionStartedAtRef.current || Date.now();
        const now = Date.now();

        if (payload.type === "vision_update" && payload.vision_data) {
          drawVision(payload.vision_data, payload.vision_type);
        } else if (!showVision) {
          clearVisionOverlay();
        }

        commitReport((current) => {
          const nextCounts = { ...current.eventCounts };
          let shouldCountEvent = false;

          if (eventCode === "tab_switch") {
            if (!tabSwitchActiveRef.current) {
              shouldCountEvent = true;
              tabSwitchActiveRef.current = true;
            }
          } else if (eventCode) {
            const cooldownMs = EVENT_COOLDOWN_MS[eventCode] ?? 3000;
            const lastCountedAt = lastCountedEventAtRef.current[eventCode] ?? 0;
            shouldCountEvent = now - lastCountedAt >= cooldownMs;
          }

          if (shouldCountEvent && eventCode) {
            lastCountedEventAtRef.current[eventCode] = now;
          }

          if (shouldCountEvent && eventCode === "reading") {
            nextCounts.reading += 1;
          }

          if (shouldCountEvent && eventCode === "talking") {
            nextCounts.talking += 1;
          }

          if (shouldCountEvent && eventCode === "looking_away") {
            nextCounts.lookingAway += 1;
          }

          if (shouldCountEvent && eventCode === "tab_switch") {
            nextCounts.tabSwitch += 1;
          }

          if (shouldCountEvent && eventCode === "no_face") {
            nextCounts.noFace += 1;
          }

          if (shouldCountEvent && eventCode === "crowd") {
            nextCounts.multipleFaces += 1;
          }

          if (shouldCountEvent && eventCode === "candidate_returned") {
            nextCounts.returnedToInterview += 1;
            tabSwitchActiveRef.current = false;
          }

          if (shouldCountEvent && eventCode === "another_device") {
            nextCounts.anotherDevice += 1;
          }

          const normalizedCounts = shouldCountEvent ? nextCounts : current.eventCounts;
          const riskDelta =
            shouldCountEvent && eventCode
              ? getRiskDeltaForEvent(eventCode)
              : 0;
          const normalizedRiskScore = clampScore(riskScoreRef.current + riskDelta);

          if (riskDelta > 0) {
            riskScoreRef.current = normalizedRiskScore;
            lastRiskEventAtRef.current = now;
          }

          const attentionScore = clampScore(100 - normalizedRiskScore);

          return {
            ...current,
            status: "monitoring",
            riskScore: normalizedRiskScore,
            attentionScore,
            attentionLabel: getAttentionLabel(attentionScore),
            eventCounts: normalizedCounts,
            timeline: shouldCountEvent && eventCode
              ? [
                ...current.timeline,
                {
                  elapsedLabel: getElapsedLabel(sessionStartedAt),
                  riskScore: normalizedRiskScore,
                  attentionScore,
                  eventCode,
                },
              ].slice(-MAX_TIMELINE_POINTS)
              : current.timeline,
          };
        });

        if (
          payload.message &&
          (eventCode ||
            payload.message.includes("WARNING") ||
            payload.message.includes("System:"))
        ) {
          pushLogWithCooldown(payload.message);
        }
      } catch {
        const fallbackMessage = String(event.data || "").trim();

        if (fallbackMessage) {
          pushLogWithCooldown(fallbackMessage);
        }
      }
    },
    [
      clearVisionOverlay,
      commitReport,
      drawVision,
      pushLogWithCooldown,
      showVision,
    ],
  );

  const handleUnexpectedDisconnect = useCallback(() => {
    if (manualStopRef.current) {
      manualStopRef.current = false;
      return;
    }

    stopCaptureLoop();
    stopRecoveryLoop();
    clearVisionOverlay();
    socketRef.current = null;

    if (!sessionActiveRef.current) {
      finalizeSession("error", "Proctoring service disconnected.");
      return;
    }

    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      finalizeSession("error", "Proctoring service disconnected.");
      return;
    }

    reconnectAttemptsRef.current += 1;
    pushLogWithCooldown("Proctoring disconnected. Reconnecting...", 1000);
    commitReport((current) => ({
      ...current,
      status: "connecting",
      completedAt: null,
    }));

    clearReconnectTimeout();
    reconnectTimeoutRef.current = window.setTimeout(async () => {
      if (!sessionActiveRef.current) {
        return;
      }

      try {
        await reconnectSessionRef.current?.();
      } catch {
        handleUnexpectedDisconnect();
      }
    }, RECONNECT_DELAY_MS);
  }, [
    clearVisionOverlay,
    clearReconnectTimeout,
    commitReport,
    finalizeSession,
    pushLogWithCooldown,
    stopCaptureLoop,
    stopRecoveryLoop,
  ]);

  const sendBrowserEvent = useCallback((eventName: string) => {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (reportRef.current.status !== "monitoring") {
      return;
    }

    socket.send(JSON.stringify({ event: eventName }));
  }, []);

  const startCaptureLoop = useCallback(() => {
    const videoElement = videoRef.current;
    const socket = socketRef.current;

    if (!videoElement || !socket) {
      return;
    }

    const captureCanvas =
      captureCanvasRef.current || document.createElement("canvas");
    captureCanvasRef.current = captureCanvas;
    const captureContext = captureCanvas.getContext("2d");

    if (!captureContext) {
      return;
    }

    stopCaptureLoop();

    captureIntervalRef.current = window.setInterval(() => {
      if (
        !socketRef.current ||
        socketRef.current.readyState !== WebSocket.OPEN ||
        videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        return;
      }

      captureCanvas.width = videoElement.videoWidth || captureCanvas.width || 640;
      captureCanvas.height = videoElement.videoHeight || captureCanvas.height || 480;
      captureContext.drawImage(
        videoElement,
        0,
        0,
        captureCanvas.width,
        captureCanvas.height,
      );

      socketRef.current.send(
        JSON.stringify({
          event: "frame",
          image: captureCanvas.toDataURL("image/jpeg", 0.5),
          frame_interval: FRAME_INTERVAL_MS,
          is_background: document.hidden || !document.hasFocus(),
        }),
      );
    }, FRAME_INTERVAL_MS);
  }, [stopCaptureLoop]);

  const connectSocket = useCallback(async () => {
    const socket = new WebSocket(buildSocketUrl());
    socketRef.current = socket;
    manualStopRef.current = false;

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      // Render's free tier spins the proctoring service down when idle, so a
      // cold start can leave this socket neither open nor errored for a long
      // time. Without an explicit timeout the "Preparing Training" screen can
      // hang indefinitely waiting on this promise.
      const timeoutId = window.setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
        socket.close();
        reject(new Error("Proctoring service is taking too long to respond."));
      }, SOCKET_CONNECT_TIMEOUT_MS);

      const handleOpen = () => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        socket.removeEventListener("error", handleError);
        resolve();
      };

      const handleError = () => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        socket.removeEventListener("open", handleOpen);
        reject(new Error("Proctoring service is not reachable."));
      };

      socket.addEventListener("open", handleOpen, { once: true });
      socket.addEventListener("error", handleError, { once: true });
    });

    socket.addEventListener("message", handleSocketMessage as EventListener);
    socket.addEventListener("close", handleUnexpectedDisconnect);
    socket.addEventListener("error", handleUnexpectedDisconnect);
    socket.send(JSON.stringify({ event: "connected" }));
  }, [handleSocketMessage, handleUnexpectedDisconnect]);

  // Wraps connectSocket with a few retries so a cold Render dyno (which can
  // take longer than one SOCKET_CONNECT_TIMEOUT_MS window to wake up) gets a
  // couple more chances before startSession gives up and reports an error.
  const connectSocketWithRetry = useCallback(async () => {
    let attempt = 0;

    for (;;) {
      try {
        await connectSocket();
        return;
      } catch (error) {
        if (attempt >= INITIAL_CONNECT_RETRIES) {
          throw error;
        }

        attempt += 1;
        pushLogWithCooldown("Proctoring service is waking up, retrying...", 1000);
        await new Promise((resolve) => {
          window.setTimeout(resolve, INITIAL_CONNECT_RETRY_DELAY_MS);
        });
      }
    }
  }, [connectSocket, pushLogWithCooldown]);

  const reconnectSession = useCallback(async () => {
    await connectSocket();
    reconnectAttemptsRef.current = 0;
    commitReport((current) => ({
      ...current,
      status: "monitoring",
      completedAt: null,
    }));
    startRecoveryLoop();
    pushLog("Proctoring reconnected.");
    startCaptureLoop();
  }, [commitReport, connectSocket, pushLog, startCaptureLoop, startRecoveryLoop]);

  const initCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is not supported in this browser.");
    }

    let stream: MediaStream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 960 },
          height: { ideal: 540 },
        },
        audio: false,
      });
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === "NotAllowedError") {
          throw new Error("Camera permission was blocked. Please allow camera access and start training again.");
        }

        if (error.name === "NotFoundError") {
          throw new Error("No camera device was found on this system.");
        }

        if (error.name === "NotReadableError") {
          throw new Error("Camera is busy in another application. Close the other app and try again.");
        }
      }

      throw error;
    }

    mediaStreamRef.current = stream;

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;

      await new Promise<void>((resolve) => {
        const element = videoRef.current;

        if (!element) {
          resolve();
          return;
        }

        const handleReady = () => {
          element.onloadedmetadata = null;
          resolve();
        };

        if (element.readyState >= 1) {
          resolve();
          return;
        }

        element.onloadedmetadata = handleReady;
      });

      await videoRef.current.play().catch(() => undefined);
      await waitForVideoLive(videoRef.current);
    }
  }, []);

  const resetSession = useCallback(() => {
    sessionActiveRef.current = false;
    reconnectAttemptsRef.current = 0;
    clearReconnectTimeout();
    stopCaptureLoop();
    stopRecoveryLoop();
    teardownSocket(true);
    stopMediaStream();
    clearVisionOverlay();
    sessionStartedAtRef.current = null;
    riskScoreRef.current = 0;
    lastRiskEventAtRef.current = 0;
    lastCountedEventAtRef.current = {};
    tabSwitchActiveRef.current = false;
    lastLogAtRef.current = {};
    commitReport({
      ...createEmptyReport(),
      aiVisionEnabled: showVision,
    });
  }, [
    clearVisionOverlay,
    clearReconnectTimeout,
    commitReport,
    showVision,
    stopCaptureLoop,
    stopRecoveryLoop,
    stopMediaStream,
    teardownSocket,
  ]);

  const stopSession = useCallback(() => {
    sessionActiveRef.current = false;
    reconnectAttemptsRef.current = 0;
    clearReconnectTimeout();
    stopCaptureLoop();
    stopRecoveryLoop();
    teardownSocket(true);
    stopMediaStream();
    clearVisionOverlay();
    sessionStartedAtRef.current = null;
    tabSwitchActiveRef.current = false;

    return finalizeSession("stopped", "Monitoring stopped.");
  }, [
    clearVisionOverlay,
    clearReconnectTimeout,
    finalizeSession,
    stopCaptureLoop,
    stopRecoveryLoop,
    stopMediaStream,
    teardownSocket,
  ]);

  const startSession = useCallback(async () => {
    if (
      reportRef.current.status === "monitoring" ||
      reportRef.current.status === "connecting"
    ) {
      return true;
    }

    resetSession();
    sessionActiveRef.current = true;
    reconnectAttemptsRef.current = 0;
    clearReconnectTimeout();
    sessionStartedAtRef.current = Date.now();
    riskScoreRef.current = 0;
    lastRiskEventAtRef.current = 0;
    lastCountedEventAtRef.current = {};
    tabSwitchActiveRef.current = false;
    lastLogAtRef.current = {};

    commitReport((current) => ({
      ...current,
      status: "connecting",
      startedAt: new Date().toISOString(),
      completedAt: null,
      aiVisionEnabled: showVision,
    }));
    pushLog("Initializing camera...");

    try {
      // Previously camera and the proctoring socket were started together via
      // Promise.all, which rejects as soon as either promise rejects. A fast
      // proctoring-socket failure (e.g. connection refused rather than a slow
      // cold start) could therefore abort this whole try block before the
      // learner had even responded to the camera permission prompt, which is
      // what let the "Preparing Training" screen disappear before camera
      // access was resolved and before the avatar had finished loading.
      // Resolving the camera prompt first guarantees it always completes
      // before anything else can short-circuit the flow.
      await initCamera();
      pushLog("Camera connected.");
      await connectSocketWithRetry();
      commitReport((current) => ({
        ...current,
        status: "monitoring",
        startedAt: current.startedAt || new Date().toISOString(),
      }));
      startRecoveryLoop();
      pushLog("Proctoring session started.");
      startCaptureLoop();
      return true;
    } catch (error) {
      stopCaptureLoop();
      stopRecoveryLoop();
      teardownSocket(true);
      stopMediaStream();
      clearVisionOverlay();
      sessionStartedAtRef.current = null;
      const message =
        error instanceof Error
          ? error.message
          : "Unable to start proctoring.";
      commitReport((current) => ({
        ...current,
        status: "error",
        completedAt: new Date().toISOString(),
        events: [
          ...current.events,
          {
            timestamp: formatLogTimestamp(),
            message,
          },
        ].slice(-MAX_EVENT_LOGS),
      }));
      return false;
    }
  }, [
    clearVisionOverlay,
    clearReconnectTimeout,
    commitReport,
    connectSocketWithRetry,
    initCamera,
    pushLog,
    resetSession,
    showVision,
    startCaptureLoop,
    startRecoveryLoop,
    stopCaptureLoop,
    stopRecoveryLoop,
    stopMediaStream,
    teardownSocket,
  ]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        sendBrowserEvent("tab_switch");
        return;
      }

      tabSwitchActiveRef.current = false;
      sendBrowserEvent("tab_focus");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [sendBrowserEvent]);

  useEffect(() => {
    syncVisionFlag(showVision);
  }, [showVision, syncVisionFlag]);

  useEffect(() => {
    reconnectSessionRef.current = reconnectSession;

    return () => {
      reconnectSessionRef.current = null;
    };
  }, [reconnectSession]);

  useEffect(
    () => () => {
      sessionActiveRef.current = false;
      reconnectAttemptsRef.current = 0;
      clearReconnectTimeout();
      stopCaptureLoop();
      stopRecoveryLoop();
      teardownSocket(true);
      stopMediaStream();
      clearVisionOverlay();
    },
    [
      clearReconnectTimeout,
      clearVisionOverlay,
      stopCaptureLoop,
      stopRecoveryLoop,
      stopMediaStream,
      teardownSocket,
    ],
  );

  useImperativeHandle(
    ref,
    () => ({
      startSession,
      stopSession,
      resetSession,
      getSnapshot: () => reportRef.current,
    }),
    [resetSession, startSession, stopSession],
  );


  const statusLabel =
    report.status === "monitoring"
      ? "Live"
      : report.status === "connecting"
        ? "Connecting"
        : report.status === "error"
          ? "Issue"
          : report.status === "stopped"
            ? "Stopped"
            : "Idle";

  return (
    <aside className={`training-launch-proctor ${className}`.trim()}>
      <div className="training-launch-proctor-card">
        <div className="training-launch-proctor-video-shell">
          <video
            ref={videoRef}
            className="training-launch-proctor-video"
            autoPlay
            muted
            playsInline
          />
          <canvas
            ref={overlayRef}
            className="training-launch-proctor-overlay"
          />
          <div className="training-launch-proctor-video-chrome">
            <div className="training-launch-proctor-kicker">
              <span>Attention Score</span>
              <strong>{formatScoreValue(report.attentionScore)}/100</strong>
            </div>
            <span
              className={`training-launch-proctor-status is-${report.status}`}
            >
              <span className="training-launch-proctor-status-dot" />
              {statusLabel}
            </span>
          </div>
          <div className="training-launch-proctor-score training-launch-proctor-score-overlay">
            <div className="training-launch-proctor-score-meta">
              <strong>{report.attentionLabel}</strong>
              <span>Risk {formatScoreValue(report.riskScore)}</span>
            </div>
            <div className="training-launch-proctor-score-bar">
              <span style={{ width: `${Math.max(2, report.attentionScore)}%` }} />
            </div>
          </div>
          {report.status === "idle" ? (
            <div className="training-launch-proctor-empty">
              <i className="bi bi-camera-video-off" />
              <span>Monitoring starts once training begins.</span>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
};

export type { TrainingLaunchProctoringHandle };

export default forwardRef(TrainingLaunchProctoring);
