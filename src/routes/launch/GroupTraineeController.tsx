import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { Socket } from "socket.io-client";
import { getGroupAuthToken } from "../../helper/authSession";
import {
  askGroupQuestion,
  joinGroupSession,
  resolveGroupJoin,
  type GroupSessionView,
} from "../../helper/groupSessionApi";
import { connectGroupSocket } from "../../helper/groupSocket";
import { withBase } from "../../helper/basePath";

type QueueEntry = { traineeId: string; name: string };
type FaqItem = { name: string; question: string; answer: string };
type Slide = { id: string; title: string; script: string; mediaUrl: string; mediaName: string };

const isVideo = (name: string) => /\.(mp4|webm|ogg)$/i.test(name || "");

// Trainee phone = thin controller. No content, no AI controls — only raise-hand,
// status, attendance confirm, F&Q view, and (when called) speak via phone mic.
const GroupTraineeController = () => {
  const { joinToken = "" } = useParams();
  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef<string>("");
  const meRef = useRef<{ traineeId: string; name: string } | null>(null);

  const [phase, setPhase] = useState<"loading" | "needs-login" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [session, setSession] = useState<GroupSessionView | null>(null);
  const [me, setMe] = useState<{ traineeId: string; name: string } | null>(null);
  const [status, setStatus] = useState("scheduled");
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [handRaised, setHandRaised] = useState(false);
  const [hasFloor, setHasFloor] = useState(false);
  const [listening, setListening] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState<number | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [attention, setAttention] = useState(false);
  // Live context (driven by backend session:state / session:sync).
  const [topic, setTopic] = useState("");
  const [slideIndex, setSlideIndex] = useState(0);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [myQuestion, setMyQuestion] = useState("");
  const [lastAnswer, setLastAnswer] = useState<FaqItem | null>(null);
  const totalSlides = slides.length;
  const currentSlide = slides[slideIndex] ?? null;

  const myPosition = useMemo(() => {
    if (!me) return -1;
    return queue.findIndex((q) => q.traineeId === me.traineeId);
  }, [queue, me]);

  const msUntilStart = startTime ? startTime - now : 0;
  const isLive = ["presenting", "qa", "assessment", "paused"].includes(status);
  const isEnded = status === "ended";
  // Lifecycle is backend-driven: waiting until the server flips to live.
  const isWaiting = !isLive && !isEnded && ["scheduled", "waiting", "starting"].includes(status);

  // Attention alert: short beep + vibration so waiting trainees look up exactly
  // when the session goes live.
  const fireAttention = useCallback(() => {
    setAttention(true);
    window.setTimeout(() => setAttention(false), 6000);
    try {
      navigator.vibrate?.([200, 100, 200, 100, 200]);
    } catch (_e) { /* ignore */ }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.15;
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      }
    } catch (_e) { /* ignore */ }
  }, []);

  // Resolve + join + connect.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!getGroupAuthToken()) {
        setPhase("needs-login");
        return;
      }
      const resolved = await resolveGroupJoin(joinToken);
      if (!active) return;
      if (!resolved.data.status) {
        setError(resolved.data.message || "This QR code or join link is invalid.");
        setPhase("error");
        return;
      }
      // Completed/expired sessions → completion screen (no join attempt).
      if (resolved.data.data.ended) {
        setSession(resolved.data.data.session);
        setStatus("ended");
        setPhase("ready");
        return;
      }
      const gsId = resolved.data.data.session.id;
      const joined = await joinGroupSession(gsId);
      if (!active) return;
      if (!joined.data.status) {
        setError(joined.data.message || "Unable to join this session.");
        setPhase("error");
        return;
      }
      tokenRef.current = joined.data.data.token;
      meRef.current = joined.data.data.me;
      setSession(joined.data.data.session);
      setStatus(joined.data.data.session.status);
      setTopic(joined.data.data.session.currentTopic || "");
      setSlideIndex(joined.data.data.session.currentSlideIndex || 0);
      const trainingSlides = (joined.data.data.training as { slides?: Slide[] })?.slides;
      setSlides(Array.isArray(trainingSlides) ? trainingSlides : []);
      setStartTime(joined.data.data.session.startTime ? new Date(joined.data.data.session.startTime).getTime() : null);
      setMe(joined.data.data.me);

      const socket = connectGroupSocket({ token: joined.data.data.token });
      socketRef.current = socket;
      socket.on("connect", () => socket.emit("session:join"));
      socket.on("queue:update", (p: { queue: QueueEntry[] }) => {
        const q = p.queue || [];
        setQueue(q);
        const m = meRef.current; // ref avoids the stale-closure bug
        setHandRaised(Boolean(m && q.some((entry) => entry.traineeId === m.traineeId)));
      });
      const applyState = (p: { status: string; currentTopic?: string; currentSlideIndex?: number }) => {
        setStatus(p.status);
        if (typeof p.currentTopic === "string") setTopic(p.currentTopic);
        if (typeof p.currentSlideIndex === "number") setSlideIndex(p.currentSlideIndex);
      };
      socket.on("session:state", applyState);
      socket.on("session:sync", applyState);
      socket.on("session:attention", () => fireAttention());
      socket.on("floor:granted", (p: { traineeId: string }) => {
        setHasFloor(p.traineeId === meRef.current?.traineeId);
      });
      socket.on("floor:released", () => {
        setHasFloor(false);
        setListening(false);
      });
      socket.on("hand:rejected", (p: { reason: string }) => {
        setError(p.reason === "cooldown" ? "Please wait before raising your hand again." : "You've reached your question limit.");
        setTimeout(() => setError(""), 3000);
      });
      socket.on("qa:answer", (p: { question: string; answer: string }) => {
        setLastAnswer({ name: "AI Trainer", question: p.question, answer: p.answer });
      });
      socket.on("session:ended", () => setStatus("ended"));
      setPhase("ready");
    })();
    return () => {
      active = false;
      socketRef.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinToken]);

  // Heartbeat while connected.
  useEffect(() => {
    if (phase !== "ready") return;
    const id = window.setInterval(() => socketRef.current?.emit("attendance:heartbeat"), 15000);
    return () => window.clearInterval(id);
  }, [phase]);

  // Ticking clock for the countdown.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const countdown = useMemo(() => {
    const total = Math.max(0, Math.floor(msUntilStart / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h > 0 ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [msUntilStart]);

  const toggleHand = () => {
    if (handRaised) {
      socketRef.current?.emit("hand:lower");
      setHandRaised(false);
    } else {
      socketRef.current?.emit("hand:raise");
      setHandRaised(true); // optimistic; reconciled by queue:update
    }
  };

  const confirmPresence = () => {
    socketRef.current?.emit("attendance:confirm");
    setConfirmedAt(Date.now());
  };

  // Auto-confirm presence once the session is live (no manual button needed —
  // the footer carries only Raise Hand + Mic, like a real classroom).
  useEffect(() => {
    if (isLive && !confirmedAt) {
      socketRef.current?.emit("attendance:confirm");
      setConfirmedAt(Date.now());
    }
  }, [isLive, confirmedAt]);

  // Floor granted → capture the question via the phone mic (Web Speech API).
  // Flow: listen → transcript → send to AI → AI answer is spoken by the hall
  // avatar → release the floor. The floor is released only AFTER the question is
  // sent (or on cancel), so "training continues" follows the answer.
  const startSpeaking = useCallback(async () => {
    setError("");
    const SR = (window as unknown as { webkitSpeechRecognition?: unknown; SpeechRecognition?: unknown });
    const Recognition = SR.SpeechRecognition || SR.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Speech input isn't supported on this device/browser. Please use Chrome.");
      return;
    }
    setListening(true);
    setMyQuestion("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new (Recognition as any)();
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    let finalText = "";

    recognition.onresult = (event: { results: Array<{ 0: { transcript: string }; isFinal: boolean }> }) => {
      let interim = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setMyQuestion((finalText || interim).trim());
    };
    recognition.onerror = (e: { error?: string }) => {
      setListening(false);
      setError(e?.error === "no-speech" ? "Didn't catch that — tap the mic and try again." : "Microphone error — please retry.");
      // Keep the floor so the trainee can retry; they can also tap Cancel.
    };
    recognition.onend = async () => {
      setListening(false);
      const transcript = finalText.trim() || myQuestion.trim();
      if (!transcript || !session) {
        setError("Didn't catch that — tap the mic and try again.");
        return; // keep the floor for a retry
      }
      try {
        const res = await askGroupQuestion(session.id, tokenRef.current, transcript);
        if (res.data.status && res.data.data?.reply) {
          setLastAnswer({ name: "AI Trainer", question: transcript, answer: res.data.data.reply });
        }
      } catch (_e) {
        setError("Could not send your question. Please try again.");
        return;
      }
      socketRef.current?.emit("qa:done"); // release after the question is answered
    };
    recognition.start();
  }, [session, myQuestion]);

  const cancelFloor = () => {
    setListening(false);
    setMyQuestion("");
    socketRef.current?.emit("qa:done");
  };

  if (phase === "needs-login") {
    return (
      <div className="d-flex vh-100 align-items-center justify-content-center text-center p-4">
        <div>
          <h5>Sign in required</h5>
          <p className="text-muted">Please log in as a trainee, then reopen this join link.</p>
          <a className="btn btn-primary" href={withBase("/")}>Go to login</a>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return <div className="d-flex vh-100 align-items-center justify-content-center text-danger text-center p-4">{error}</div>;
  }

  if (phase === "loading") {
    return <div className="d-flex vh-100 align-items-center justify-content-center">Joining session…</div>;
  }

  // Completion screen — session ended/expired.
  if (isEnded) {
    return (
      <div className="d-flex vh-100 flex-column align-items-center justify-content-center text-center p-4">
        <div style={{ fontSize: "3rem" }}>✅</div>
        <h5 className="mt-2">{session?.trainingTitle || "Training"}</h5>
        <p className="text-muted">This session has ended. Thank you for attending.</p>
        <p className="text-muted small">Your attendance has been recorded.</p>
      </div>
    );
  }

  // Waiting room — shown until the session goes live.
  if (isWaiting) {
    return (
      <div className="d-flex vh-100 flex-column align-items-center justify-content-center text-center p-4">
        <span className="badge bg-success mb-3">You're in the waiting room</span>
        <h5 className="mb-1">{session?.trainingTitle}</h5>
        <div className="text-muted small mb-4">Welcome{me ? `, ${me.name}` : ""}. The session starts automatically.</div>
        <div className="text-uppercase small text-muted">Starts in</div>
        <div style={{ fontSize: "3rem", fontWeight: 700 }}>{countdown}</div>
        <div className="text-muted small mb-4">{startTime ? new Date(startTime).toLocaleString() : ""}</div>
        <button className="btn btn-outline-secondary btn-sm" onClick={confirmPresence}>
          {confirmedAt ? "✓ Presence confirmed" : "I'm here ✓"}
        </button>
        <div className="text-muted small mt-4">Keep this screen open. You'll be alerted when it begins.</div>
      </div>
    );
  }

  // ---- Live session: a presentation FOLLOWER (feels like a training, not a
  // control panel). Audio is delivered by the hall; the phone mirrors the slide
  // + narration text, shows progress, and carries only Raise Hand + Mic. ----
  const progressPct = totalSlides > 0 ? Math.round(((slideIndex + 1) / totalSlides) * 100) : 0;
  const micEnabled = hasFloor; // mic is disabled until the AI grants the floor

  return (
    <div className="d-flex flex-column vh-100" style={{ background: "#0b1220", color: "#fff" }}>
      {attention ? (
        <div
          className="position-fixed top-0 start-0 w-100 text-center text-white py-2"
          style={{ background: "#ff6200", zIndex: 1080, fontWeight: 600 }}
        >
          🔔 The training is starting now — please follow along!
        </div>
      ) : null}

      {/* Header: title, progress, status */}
      <div className="px-3 pt-3 pb-2">
        <div className="d-flex justify-content-between align-items-center">
          <div className="fw-semibold text-truncate">{session?.trainingTitle}</div>
          <span className={`badge ${status === "paused" ? "bg-warning text-dark" : "bg-success"}`}>
            {status === "qa" ? "Q&A" : status === "paused" ? "Paused" : "Live"}
          </span>
        </div>
        <div className="small text-secondary text-truncate">{topic || currentSlide?.title || ""}</div>
        {totalSlides > 0 ? (
          <>
            <div className="progress mt-2" style={{ height: 5, background: "#1f2a3a" }}>
              <div className="progress-bar" style={{ width: `${progressPct}%`, background: "#ff6200" }} />
            </div>
            <div className="small text-secondary mt-1">Slide {Math.min(slideIndex + 1, totalSlides)} / {totalSlides}</div>
          </>
        ) : null}
      </div>

      {/* Main learning surface: the current slide (mirrors the hall). */}
      <div className="flex-grow-1 d-flex align-items-center justify-content-center px-3" style={{ minHeight: 0 }}>
        <div className="w-100 h-100 d-flex align-items-center justify-content-center bg-black rounded" style={{ overflow: "hidden" }}>
          {currentSlide?.mediaUrl ? (
            isVideo(currentSlide.mediaName) ? (
              <video src={currentSlide.mediaUrl} controls={false} autoPlay muted className="w-100 h-100" style={{ objectFit: "contain" }} />
            ) : (
              <img src={currentSlide.mediaUrl} alt={currentSlide.title} style={{ objectFit: "contain", maxWidth: "100%", maxHeight: "100%" }} />
            )
          ) : (
            <div className="text-center p-3">
              <h5>{currentSlide?.title || "Training in progress"}</h5>
            </div>
          )}
        </div>
      </div>

      {/* Narration subtitle (what the AI trainer is saying) or the latest answer. */}
      <div className="px-3 py-2" style={{ minHeight: 64 }}>
        {hasFloor ? (
          <div className="text-warning fw-semibold">🎤 How can I help you{me ? `, ${me.name}` : ""}?</div>
        ) : lastAnswer ? (
          <div className="small"><span className="text-secondary">AI: </span>{lastAnswer.answer}</div>
        ) : (
          <div className="small text-secondary" style={{ whiteSpace: "pre-wrap" }}>{currentSlide?.script || ""}</div>
        )}
        {myQuestion ? <div className="small text-info mt-1">You: {myQuestion}</div> : null}
        {error ? <div className="small text-warning mt-1">{error}</div> : null}
      </div>

      {/* Footer controls: ONLY Raise Hand + Microphone (mic disabled by default). */}
      <div className="d-flex gap-2 p-3 border-top" style={{ borderColor: "#1f2a3a" }}>
        <button
          className={`btn flex-fill ${handRaised ? "btn-outline-light" : "btn-primary"}`}
          disabled={hasFloor}
          onClick={toggleHand}
        >
          {handRaised
            ? myPosition >= 0 ? `✋ #${myPosition + 1} in queue` : "✋ Raised"
            : "✋ Raise Hand"}
        </button>
        <button
          className={`btn flex-fill ${micEnabled ? "btn-warning" : "btn-secondary"}`}
          disabled={!micEnabled || listening}
          onClick={startSpeaking}
          title={micEnabled ? "Ask your question" : "Microphone activates when the AI calls on you"}
        >
          {listening ? "🎙️ Listening…" : micEnabled ? "🎤 Speak" : "🎤 Mic"}
        </button>
        {hasFloor ? (
          <button className="btn btn-outline-light" onClick={cancelFloor} title="Done">✕</button>
        ) : null}
      </div>
    </div>
  );
};

export default GroupTraineeController;
