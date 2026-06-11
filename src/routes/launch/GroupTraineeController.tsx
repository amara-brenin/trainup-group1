import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { Socket } from "socket.io-client";
import AxiosHelper from "../../helper/AxiosHelper";
import { getGroupAuthToken, setLaunchAuthToken } from "../../helper/authSession";
import {
  askGroupQuestion,
  joinGroupSession,
  resolveGroupJoin,
  type GroupSessionView,
} from "../../helper/groupSessionApi";
import { connectGroupSocket } from "../../helper/groupSocket";

type QueueEntry = { traineeId: string; name: string };
type FaqItem = { name: string; question: string; answer: string };
type Slide = { id: string; title: string; script: string; mediaUrl: string; mediaName: string };
type TrainingMeta = { presenterNotes?: string; type?: string; audience?: string };
type LoginResponse = { token?: string; user?: { role?: string } };

const isVideo = (name: string) => /\.(mp4|webm|ogg)$/i.test(name || "");

// Phases enforce the correct sequence: authentication → authorization → lobby →
// training. We never attempt to join (authorize) before the user is signed in.
type Phase = "loading" | "login" | "lobby" | "live" | "error";
type ErrorCase = "invalid" | "not-assigned" | "expired" | "full" | "inactive" | "generic";

const ERROR_SCREENS: Record<ErrorCase, { title: string; message: string }> = {
  invalid: { title: "Invalid link", message: "This QR code or join link is invalid." },
  "not-assigned": { title: "Not assigned", message: "You are not assigned to this training session." },
  expired: { title: "Session unavailable", message: "This training session is no longer available." },
  full: { title: "Session full", message: "Maximum participant limit reached." },
  inactive: { title: "Account inactive", message: "Your account is currently inactive." },
  generic: { title: "Unable to join", message: "Something went wrong joining this session. Please try again." },
};

// Map the backend deny `reason` (machine code) to a proper error screen.
const reasonToCase = (reason?: string): ErrorCase => {
  switch (reason) {
    case "not-assigned": return "not-assigned";
    case "expired": return "expired";
    case "at-capacity": return "full";
    case "blocked": return "inactive";
    case "not-trainee":
    case "wrong-org": return "not-assigned";
    default: return "generic";
  }
};

const GroupTraineeController = () => {
  const { joinToken = "" } = useParams();
  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef<string>("");
  const meRef = useRef<{ traineeId: string; name: string } | null>(null);
  const gsIdRef = useRef<string>("");

  const [phase, setPhase] = useState<Phase>("loading");
  const [errorCase, setErrorCase] = useState<ErrorCase>("generic");
  const [session, setSession] = useState<GroupSessionView | null>(null);
  const [trainingMeta, setTrainingMeta] = useState<TrainingMeta>({});
  const [me, setMe] = useState<{ traineeId: string; name: string } | null>(null);
  const [status, setStatus] = useState("scheduled");
  const [attendeeCount, setAttendeeCount] = useState(0);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [handRaised, setHandRaised] = useState(false);
  const [hasFloor, setHasFloor] = useState(false);
  const [listening, setListening] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState<number | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [attention, setAttention] = useState(false);
  const [topic, setTopic] = useState("");
  const [slideIndex, setSlideIndex] = useState(0);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [myQuestion, setMyQuestion] = useState("");
  const [lastAnswer, setLastAnswer] = useState<FaqItem | null>(null);
  const [error, setError] = useState(""); // in-session transient messages only
  const [socketConnected, setSocketConnected] = useState(false);
  const [followUp, setFollowUp] = useState(false); // post-answer window: ask follow-up or done
  const [followUpPrompt, setFollowUpPrompt] = useState(""); // AI's "are you still there?" text
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null); // active SpeechRecognition, for "Done Asking"

  // Login form state.
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");

  const totalSlides = slides.length;
  const currentSlide = slides[slideIndex] ?? null;
  const myPosition = useMemo(() => (me ? queue.findIndex((q) => q.traineeId === me.traineeId) : -1), [queue, me]);
  const msUntilStart = startTime ? startTime - now : 0;
  const isLive = ["presenting", "qa", "assessment", "paused"].includes(status);
  const isEnded = status === "ended";
  const isWaiting = !isLive && !isEnded && ["scheduled", "waiting", "starting"].includes(status);

  const fireAttention = useCallback(() => {
    setAttention(true);
    window.setTimeout(() => setAttention(false), 6000);
    try { navigator.vibrate?.([200, 100, 200, 100, 200]); } catch (_e) { /* ignore */ }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880; gain.gain.value = 0.15;
        osc.start(); osc.stop(ctx.currentTime + 0.5);
      }
    } catch (_e) { /* ignore */ }
  }, []);

  // Connect the socket + wire all live handlers (used after a successful join).
  const connectAndWire = useCallback((token: string) => {
    const socket = connectGroupSocket({ token }, "trainee");
    socketRef.current = socket;
    socket.on("connect", () => { setSocketConnected(true); socket.emit("session:join"); });
    socket.on("disconnect", () => setSocketConnected(false));
    socket.io.on("reconnect_attempt", () => setSocketConnected(false));
    socket.on("attendance:update", (p: { count: number }) => setAttendeeCount(p.count));
    socket.on("queue:update", (p: { queue: QueueEntry[] }) => {
      const q = p.queue || [];
      setQueue(q);
      const m = meRef.current;
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
      if (p.traineeId !== meRef.current?.traineeId) return;
      setHasFloor(true);
      setFollowUp(false);
      setFollowUpPrompt("");
    });
    socket.on("floor:released", () => {
      setHasFloor(false); setListening(false); setFollowUp(false); setFollowUpPrompt("");
    });
    // After the AI answer: keep the floor; show [Ask Follow-Up] / [I'm Done].
    socket.on("qa:follow-up", (p: { traineeId: string }) => {
      if (p.traineeId === meRef.current?.traineeId) { setFollowUp(true); setListening(false); }
    });
    // The AI verbally prompted "are you still there?" — surface it as text too.
    socket.on("qa:follow-up-prompt", (p: { traineeId: string; text: string }) => {
      if (p.traineeId === meRef.current?.traineeId) { setFollowUp(true); setFollowUpPrompt(p.text || ""); }
    });
    socket.on("hand:rejected", (p: { reason: string }) => {
      setError(p.reason === "cooldown" ? "Please wait before raising your hand again." : "You've reached your question limit.");
      setTimeout(() => setError(""), 3000);
    });
    socket.on("qa:answer", (p: { question: string; answer: string }) =>
      setLastAnswer({ name: "AI Trainer", question: p.question, answer: p.answer }));
    socket.on("session:ended", () => setStatus("ended"));
  }, [fireAttention]);

  // STEP 2/3 — Authorize (join) AFTER authentication. Maps failures to screens.
  const doJoin = useCallback(async () => {
    setPhase("loading");
    const joined = await joinGroupSession(gsIdRef.current);
    if (!joined.data.status) {
      setErrorCase(reasonToCase(joined.data.data?.reason));
      setPhase("error");
      return;
    }
    const d = joined.data.data;
    tokenRef.current = d.token;
    meRef.current = d.me;
    setMe(d.me);
    setSession(d.session);
    setStatus(d.session.status);
    setTopic(d.session.currentTopic || "");
    setSlideIndex(d.session.currentSlideIndex || 0);
    setStartTime(d.session.startTime ? new Date(d.session.startTime).getTime() : null);
    setAttendeeCount(d.session.attendeeCount || 0);
    const t = d.training as { slides?: Slide[]; presenterNotes?: string; type?: string; audience?: string };
    setSlides(Array.isArray(t?.slides) ? t.slides : []);
    setTrainingMeta({ presenterNotes: t?.presenterNotes, type: t?.type, audience: t?.audience });
    connectAndWire(d.token);
    setPhase("lobby"); // do NOT drop straight into the live training
  }, [connectAndWire]);

  // STEP 1 — Resolve the session (public, no auth, no join), then check auth.
  useEffect(() => {
    let active = true;
    (async () => {
      const resolved = await resolveGroupJoin(joinToken);
      if (!active) return;
      if (!resolved.data.status) {
        setErrorCase("invalid");
        setPhase("error");
        return;
      }
      if (resolved.data.data.ended) {
        setSession(resolved.data.data.session);
        setErrorCase("expired");
        setPhase("error");
        return;
      }
      const sess = resolved.data.data.session;
      gsIdRef.current = sess.id;
      setSession(sess);
      setStatus(sess.status);
      setStartTime(sess.startTime ? new Date(sess.startTime).getTime() : null);
      setAttendeeCount(sess.attendeeCount || 0);

      // Authentication FIRST. If not signed in, show the login screen (the join
      // is NOT attempted until after login).
      if (!getGroupAuthToken()) {
        setPhase("login");
        return;
      }
      await doJoin();
    })();
    return () => {
      active = false;
      socketRef.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinToken]);

  // Inline login → store token via the app's mechanism → continue join flow.
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoginBusy(true);
    try {
      const res = await AxiosHelper.postData<LoginResponse, { email: string; password: string }>(
        "/auth/login",
        { email: loginEmail.trim(), password: loginPassword },
      );
      if (!res.data.status || !res.data.data?.token) {
        setLoginError(res.data.message || "Invalid email or password.");
        return;
      }
      setLaunchAuthToken(res.data.data.token); // stored where the group flow reads it
      await doJoin(); // automatically return to the original session — no manual reopen
    } catch (_e) {
      setLoginError("Unable to sign in. Please try again.");
    } finally {
      setLoginBusy(false);
    }
  };

  // Heartbeat once connected (lobby or live).
  useEffect(() => {
    if (phase !== "lobby" && phase !== "live") return;
    const id = window.setInterval(() => socketRef.current?.emit("attendance:heartbeat"), 15000);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Auto-confirm presence once the trainee has entered the live training.
  useEffect(() => {
    if (phase === "live" && isLive && !confirmedAt) {
      socketRef.current?.emit("attendance:confirm");
      setConfirmedAt(Date.now());
    }
  }, [phase, isLive, confirmedAt]);

  // P3: when the session goes live while the trainee is still on the lobby,
  // alert them. If Auto Enter is configured, enter the training automatically;
  // otherwise the lobby shows a "Training has started" prompt + Enter button.
  useEffect(() => {
    if (phase === "lobby" && isLive) {
      fireAttention();
      if (session?.autoEnter) setPhase("live");
    }
  }, [phase, isLive, session?.autoEnter, fireAttention]);

  const countdown = useMemo(() => {
    const total = Math.max(0, Math.floor(msUntilStart / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h > 0 ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [msUntilStart]);

  const toggleHand = () => {
    if (handRaised) { socketRef.current?.emit("hand:lower"); setHandRaised(false); }
    else { socketRef.current?.emit("hand:raise"); setHandRaised(true); }
  };

  const startSpeaking = useCallback(async () => {
    setError("");
    const SR = (window as unknown as { webkitSpeechRecognition?: unknown; SpeechRecognition?: unknown });
    const Recognition = SR.SpeechRecognition || SR.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Speech input isn't supported on this device/browser. Please use Chrome.");
      return;
    }
    setFollowUp(false); // re-asking → cancel the follow-up window (backend resets on /ask)
    setFollowUpPrompt("");
    setMyQuestion("");
    // Tell the backend the speaker re-engaged so it cancels the follow-up
    // release timers and does not pull the floor while they speak.
    socketRef.current?.emit("qa:speaking");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new (Recognition as any)();
    recognitionRef.current = recognition;
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    // Track final + last interim in LOCAL vars (not React state) so the onend
    // handler always reads the freshest transcript — never a stale closure.
    let finalText = "";
    let interimText = "";
    recognition.onresult = (event: { results: Array<{ 0: { transcript: string }; isFinal: boolean }> }) => {
      let interim = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      interimText = interim;
      setMyQuestion((finalText || interim).trim());
    };
    recognition.onerror = (ev: { error?: string }) => {
      setListening(false);
      // Fall back to the manual Speak button — never leave the user stuck.
      setError(ev?.error === "no-speech" ? "Didn't catch that — tap Speak and try again."
        : ev?.error === "not-allowed" || ev?.error === "service-not-allowed"
          ? "Microphone blocked. Allow mic access, then tap Speak."
          : "Microphone error — tap Speak to retry.");
    };
    recognition.onend = async () => {
      setListening(false);
      // Merge: prefer finalized text, else the last interim we captured. The
      // local interimText is never stale (unlike the myQuestion state closure).
      const transcript = (finalText.trim() || interimText.trim()).trim();
      if (!transcript || !session) { setError("Didn't catch that — tap Speak and try again."); return; }
      try {
        const res = await askGroupQuestion(session.id, tokenRef.current, transcript);
        if (res.data.status && res.data.data?.reply) {
          setLastAnswer({ name: "AI Trainer", question: transcript, answer: res.data.data.reply });
        }
      } catch (_e) { setError("Could not send your question. Please try again."); return; }
      // Do NOT release the floor here. The hall speaks the answer; the backend
      // then opens a short follow-up window and auto-releases on inactivity. Use
      // the "I'm Done" button to end early.
    };
    // recognition.start() can throw (no gesture, mic busy, permission). On
    // failure, surface the manual Speak button rather than a stuck "listening".
    try {
      recognition.start();
      setListening(true);
    } catch (_e) {
      setListening(false);
      recognitionRef.current = null;
      setError("Tap Speak to start your question.");
    }
  }, [session]);

  // NOTE: the mic is NOT auto-started on floor grant. Starting recognition while
  // the hall avatar speaks the greeting caused the assistant's own voice to be
  // captured as trainee speech on some devices. The participant taps [🎤 Speak]
  // to begin — see the footer controls.

  // "Done Asking" — stop capturing immediately and let the AI answer (bypasses
  // browser silence detection). recognition.onend then sends the question.
  const doneAsking = () => {
    try { recognitionRef.current?.stop(); } catch (_e) { /* ignore */ }
  };

  // "I'm Done" — release the floor now; backend moves to the next participant.
  const cancelFloor = () => {
    setListening(false); setMyQuestion(""); setFollowUp(false); setFollowUpPrompt("");
    socketRef.current?.emit("qa:done");
  };

  const shell = (children: React.ReactNode) => (
    <div className="d-flex vh-100 align-items-center justify-content-center text-center p-4">{children}</div>
  );

  // ---- LOADING ----
  if (phase === "loading") return shell(<div>Loading session…</div>);

  // ---- ERROR SCREENS (proper screens, not toasts) ----
  if (phase === "error") {
    const screen = ERROR_SCREENS[errorCase];
    return shell(
      <div style={{ maxWidth: 420 }}>
        <div style={{ fontSize: "2.5rem" }}>⚠️</div>
        <h5 className="mt-2">{screen.title}</h5>
        <p className="text-muted">{screen.message}</p>
        {session?.trainingTitle ? <p className="text-muted small">Training: {session.trainingTitle}</p> : null}
      </div>,
    );
  }

  // ---- LOGIN (authentication FIRST; auto-continues to the same session) ----
  if (phase === "login") {
    return (
      <div className="d-flex vh-100 align-items-center justify-content-center p-4">
        <form onSubmit={handleLogin} className="card shadow-sm" style={{ maxWidth: 380, width: "100%" }}>
          <div className="card-body">
            <h5 className="mb-1">Sign in to join</h5>
            {session?.trainingTitle ? <div className="text-muted small mb-3">{session.trainingTitle}</div> : null}
            {loginError ? <div className="alert alert-danger py-2">{loginError}</div> : null}
            <div className="mb-2">
              <label className="form-label small">Email</label>
              <input type="email" className="form-control" value={loginEmail} required autoFocus
                onChange={(e) => setLoginEmail(e.target.value)} />
            </div>
            <div className="mb-3">
              <label className="form-label small">Password</label>
              <input type="password" className="form-control" value={loginPassword} required
                onChange={(e) => setLoginPassword(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary w-100" disabled={loginBusy}>
              {loginBusy ? "Signing in…" : "Sign in & continue"}
            </button>
            <div className="text-muted small mt-3 text-center">
              You'll be taken straight to the training after signing in.
            </div>
          </div>
        </form>
      </div>
    );
  }

  // ---- LOBBY (validated; not yet in the live training) ----
  if (phase === "lobby") {
    return (
      <div className="d-flex vh-100 flex-column align-items-center justify-content-center text-center p-4">
        <span className="badge bg-success mb-3">You're in</span>
        <h4 className="mb-1">{session?.trainingTitle}</h4>
        {trainingMeta.type || trainingMeta.audience ? (
          <div className="text-uppercase small text-muted mb-2">
            {trainingMeta.type}{trainingMeta.audience ? ` • ${trainingMeta.audience}` : ""}
          </div>
        ) : null}
        {trainingMeta.presenterNotes ? (
          <p className="text-muted" style={{ maxWidth: 520 }}>{trainingMeta.presenterNotes}</p>
        ) : null}

        <div className="d-flex flex-wrap justify-content-center gap-4 my-3">
          <div>
            <div className="small text-muted text-uppercase">Date &amp; time</div>
            <div className="fw-semibold">{startTime ? new Date(startTime).toLocaleString() : "—"}</div>
          </div>
          <div>
            <div className="small text-muted text-uppercase">Status</div>
            <div className="fw-semibold text-capitalize">{isLive ? "Live now" : isEnded ? "Ended" : "Not started"}</div>
          </div>
          <div>
            <div className="small text-muted text-uppercase">Participants joined</div>
            <div className="fw-semibold">{attendeeCount}</div>
          </div>
        </div>

        {isLive ? (
          <div className="alert alert-success py-2 px-3 fw-semibold">🔔 Training has started</div>
        ) : isWaiting ? (
          <>
            <div className="text-uppercase small text-muted">Starts in</div>
            <div style={{ fontSize: "2.5rem", fontWeight: 700 }}>{startTime ? countdown : "--:--"}</div>
          </>
        ) : null}

        <button className={`btn btn-lg mt-3 ${isLive ? "btn-success" : "btn-primary"}`} onClick={() => setPhase("live")}>
          {isLive ? "Enter Training Now" : "Enter Waiting Room"}
        </button>
        <div className="text-muted small mt-3">Welcome{me ? `, ${me.name}` : ""}.</div>
      </div>
    );
  }

  // ---- LIVE (phase === "live") ----
  // Completion screen.
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

  // Waiting room.
  if (isWaiting) {
    return (
      <div className="d-flex vh-100 flex-column align-items-center justify-content-center text-center p-4">
        <span className="badge bg-success mb-3">You're in the waiting room</span>
        <h5 className="mb-1">{session?.trainingTitle}</h5>
        <div className="text-muted small mb-4">Welcome{me ? `, ${me.name}` : ""}. The session starts automatically.</div>
        <div className="text-uppercase small text-muted">Starts in</div>
        <div style={{ fontSize: "3rem", fontWeight: 700 }}>{startTime ? countdown : "--:--"}</div>
        <div className="text-muted small mb-4">{startTime ? new Date(startTime).toLocaleString() : ""}</div>
        <div className="text-muted small mt-2">👥 {attendeeCount} joined · Keep this screen open.</div>
      </div>
    );
  }

  // Live presentation follower.
  const progressPct = totalSlides > 0 ? Math.round(((slideIndex + 1) / totalSlides) * 100) : 0;

  return (
    <div className="d-flex flex-column vh-100" style={{ background: "#0b1220", color: "#fff" }}>
      {attention ? (
        <div className="position-fixed top-0 start-0 w-100 text-center text-white py-2"
          style={{ background: "#ff6200", zIndex: 1080, fontWeight: 600 }}>
          🔔 The training is starting now — please follow along!
        </div>
      ) : null}

      <div className="px-3 pt-3 pb-2">
        <div className="d-flex justify-content-between align-items-center">
          <div className="fw-semibold text-truncate">{session?.trainingTitle}</div>
          <div className="d-flex align-items-center gap-2">
            <span
              className={`badge ${socketConnected ? "bg-success" : "bg-danger"}`}
              title={socketConnected ? "Realtime connected" : "Realtime disconnected — reconnecting…"}
            >
              ● {socketConnected ? "Connected" : "Reconnecting…"}
            </span>
            <span className={`badge ${status === "paused" ? "bg-warning text-dark" : "bg-info text-dark"}`}>
              {status === "qa" ? "Q&A" : status === "paused" ? "Paused" : "Live"}
            </span>
          </div>
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

      <div className="flex-grow-1 d-flex align-items-center justify-content-center px-3" style={{ minHeight: 0 }}>
        <div className="w-100 h-100 d-flex align-items-center justify-content-center bg-black rounded" style={{ overflow: "hidden" }}>
          {currentSlide?.mediaUrl ? (
            isVideo(currentSlide.mediaName) ? (
              <video src={currentSlide.mediaUrl} autoPlay muted className="w-100 h-100" style={{ objectFit: "contain" }} />
            ) : (
              <img src={currentSlide.mediaUrl} alt={currentSlide.title} style={{ objectFit: "contain", maxWidth: "100%", maxHeight: "100%" }} />
            )
          ) : (
            <div className="text-center p-3"><h5>{currentSlide?.title || "Training in progress"}</h5></div>
          )}
        </div>
      </div>

      <div className="px-3 py-2" style={{ minHeight: 64 }}>
        {hasFloor ? (
          listening ? (
            <div className="text-warning fw-semibold">🎙️ Listening… speak your question, then tap “Done Asking”.</div>
          ) : followUp ? (
            <div>
              <div className="text-success fw-bold">🗣️ Your turn to speak</div>
              <div className="small text-warning mt-1">
                {followUpPrompt || "Tap “Ask Follow-Up” to continue, or “Done” if you’re finished."}
              </div>
            </div>
          ) : (
            <div>
              <div className="text-success fw-bold">🗣️ Your turn to speak</div>
              <div className="small text-warning mt-1">Tap “Speak” to ask your question{me ? `, ${me.name}` : ""}.</div>
            </div>
          )
        ) : lastAnswer ? (
          <div className="small"><span className="text-secondary">AI: </span>{lastAnswer.answer}</div>
        ) : (
          <div className="small text-secondary" style={{ whiteSpace: "pre-wrap" }}>{currentSlide?.script || ""}</div>
        )}
        {myQuestion ? <div className="small text-info mt-1">You: {myQuestion}</div> : null}
        {error ? <div className="small text-warning mt-1">{error}</div> : null}
      </div>

      {/* State-driven controls — no repeated Speak clicks within one turn. */}
      <div className="d-flex gap-2 p-3 border-top" style={{ borderColor: "#1f2a3a" }}>
        {!hasFloor ? (
          <button className={`btn flex-fill ${handRaised ? "btn-outline-light" : "btn-primary"}`} disabled={status === "ended"} onClick={toggleHand}>
            {handRaised ? (myPosition >= 0 ? `✋ #${myPosition + 1} in queue` : "✋ Raised") : "✋ Raise Hand"}
          </button>
        ) : listening ? (
          <button className="btn btn-success flex-fill" onClick={doneAsking}>✅ Done Asking</button>
        ) : followUp ? (
          <>
            <button className="btn btn-warning flex-fill" onClick={startSpeaking}>🎤 Ask Follow-Up</button>
            <button className="btn btn-outline-light flex-fill" onClick={cancelFloor}>I’m Done</button>
          </>
        ) : (
          // Large, obvious primary action — non-technical users need a clear
          // "now it's your time to talk" cue, not a terse "Speak".
          <div className="d-flex flex-column flex-fill gap-2">
            <button
              className="btn btn-warning fw-bold w-100"
              style={{ fontSize: "1.4rem", padding: "0.9rem 1rem" }}
              onClick={startSpeaking}
            >
              🎤 Start Speaking
            </button>
            <div className="text-center small text-secondary">Click and ask your question</div>
            <button className="btn btn-outline-light btn-sm w-100" onClick={cancelFloor} title="Release the floor">
              I’m Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default GroupTraineeController;
