import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { Socket } from "socket.io-client";
import AxiosHelper from "../../helper/AxiosHelper";
import { getGroupAuthToken, setLaunchAuthToken } from "../../helper/authSession";
import {
  askGroupQuestion,
  getGroupAssessment,
  joinGroupSession,
  resolveGroupJoin,
  submitGroupAssessment,
  submitProctoringEvents,
  type GroupAssessmentView,
  type GroupSessionView,
  type ProctoringEventType,
} from "../../helper/groupSessionApi";
import { connectGroupSocket } from "../../helper/groupSocket";

type QueueEntry = { traineeId: string; name: string };
type FaqItem = { name: string; question: string; answer: string };
type Slide = { id: string; title: string; script: string; mediaUrl: string; mediaName: string };
type TrainingMeta = { presenterNotes?: string; type?: string; audience?: string };
type LoginResponse = { token?: string; user?: { role?: string } };

// Feature 3: per-session-per-trainee draft key for the text composer, so a
// refresh while typing can restore the draft.
const TEXT_Q_MAX = 1000;
const draftKey = (gsId: string, traineeId?: string) => `group-qdraft-${gsId}-${traineeId || ""}`;

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
  // Feature 1: text-question fallback.
  const [textMode, setTextMode] = useState(false); // typing instead of speaking
  const [textValue, setTextValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null); // active SpeechRecognition
  const transcriptRef = useRef(""); // accumulates across Start/Stop within one turn
  const submitOnEndRef = useRef(false); // true → recognition.onend submits the question
  const fallbackTimerRef = useRef<number | null>(null); // 8s silence → offer text
  const VOICE_FALLBACK_SECS = 8;
  // Feature 2: end-of-training assessment.
  const [assessment, setAssessment] = useState<GroupAssessmentView | null>(null);
  const [assessmentAnswers, setAssessmentAnswers] = useState<Record<string, string | string[]>>({});
  const [assessmentResult, setAssessmentResult] = useState<{ score: number | null; passFail: string } | null>(null);
  const [assessmentBusy, setAssessmentBusy] = useState(false);
  const assessmentLoadedRef = useRef(false);
  const assessmentStartedAtRef = useRef<string>("");
  // Feature 4: proctoring (event-only, no frames sent).
  const proctorVideoRef = useRef<HTMLVideoElement | null>(null);
  const proctorStreamRef = useRef<MediaStream | null>(null);
  const proctorQueueRef = useRef<Array<{ type: ProctoringEventType; ts: string }>>([]);
  const proctorFlushRef = useRef<number | null>(null);
  const proctorActiveRef = useRef(false);
  const [proctorCam, setProctorCam] = useState<"pending" | "on" | "denied">("pending");

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
      // Feature 3 reconnect: if a text draft was saved (e.g. the trainee refreshed
      // while typing) and the floor is still theirs, restore the composer.
      try {
        const draft = window.localStorage.getItem(draftKey(gsIdRef.current, meRef.current?.traineeId));
        if (draft) { setTextValue(draft); setTextMode(true); }
      } catch (_e) { /* ignore storage errors */ }
    });
    socket.on("floor:released", () => {
      transcriptRef.current = "";
      submitOnEndRef.current = false;
      if (fallbackTimerRef.current) { window.clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }
      setHasFloor(false); setListening(false); setFollowUp(false); setFollowUpPrompt(""); setMyQuestion("");
      setTextMode(false); setTextValue("");
      try { window.localStorage.removeItem(draftKey(gsIdRef.current, meRef.current?.traineeId)); } catch (_e) { /* ignore */ }
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

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current) { window.clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }
  }, []);

  // Feature 3: persist/clear the text composer draft (survives a refresh).
  const persistDraft = useCallback((v: string) => {
    try { window.localStorage.setItem(draftKey(gsIdRef.current, meRef.current?.traineeId), v); } catch (_e) { /* ignore */ }
  }, []);
  const clearDraft = useCallback(() => {
    try { window.localStorage.removeItem(draftKey(gsIdRef.current, meRef.current?.traineeId)); } catch (_e) { /* ignore */ }
  }, []);
  const onTextChange = (v: string) => { const t = v.slice(0, TEXT_Q_MAX); setTextValue(t); persistDraft(t); };

  // Submit the accumulated question to the AI. `type` distinguishes voice vs the
  // typed fallback (Feature 1) — persisted on the transcript for reporting.
  const submitQuestion = useCallback(async (raw: string, type: "voice" | "text" = "voice") => {
    const transcript = (raw || "").trim();
    if (!transcript || !session) {
      setError("Didn't catch that — tap “Start Speaking” or type your question.");
      return;
    }
    setMyQuestion(transcript);
    setSubmitting(true);
    try {
      const res = await askGroupQuestion(session.id, tokenRef.current, transcript, type);
      if (res.data.status && res.data.data?.reply) {
        setLastAnswer({ name: "AI Trainer", question: transcript, answer: res.data.data.reply });
        setTextMode(false);
        setTextValue("");
        clearDraft();
      } else {
        setError(res.data.message || "Could not send your question. Please try again.");
      }
    } catch (_e) { setError("Could not send your question. Please try again."); }
    finally { setSubmitting(false); }
    // Do NOT release the floor here. The hall speaks the answer; the backend
    // then opens the follow-up window. Use "I'm Done" to end the turn early.
  }, [session, clearDraft]);

  // "Type Question" — switch to text input (also auto-triggered on voice failure).
  const enterTextMode = useCallback(() => {
    clearFallbackTimer();
    try { recognitionRef.current?.stop(); } catch (_e) { /* ignore */ }
    setListening(false);
    setFollowUp(false);
    setFollowUpPrompt("");
    socketRef.current?.emit("qa:speaking"); // hold the floor while typing
    // Prefer an existing saved draft; else seed with any partial speech.
    let saved = "";
    try { saved = window.localStorage.getItem(draftKey(gsIdRef.current, meRef.current?.traineeId)) || ""; } catch (_e) { /* ignore */ }
    setTextValue(saved || transcriptRef.current.trim());
    transcriptRef.current = "";
    setTextMode(true);
  }, [clearFallbackTimer]);

  const submitText = () => { void submitQuestion(textValue, "text"); };

  // "Start Speaking" / "Continue Speaking" / "Ask Follow-Up" — begin capturing.
  // Recognition appends to transcriptRef so Stop → Start continues the same
  // question. Submission happens only on "Done Asking" (submitOnEndRef).
  const startSpeaking = useCallback(async () => {
    setError("");
    const SR = (window as unknown as { webkitSpeechRecognition?: unknown; SpeechRecognition?: unknown });
    const Recognition = SR.SpeechRecognition || SR.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Speech input isn't supported on this device/browser. Please use Chrome.");
      return;
    }
    setFollowUp(false); // re-engaging → leave the follow-up window
    setFollowUpPrompt("");
    submitOnEndRef.current = false;
    // Tell the backend the speaker re-engaged so it cancels the follow-up
    // release timers and does not pull the floor while they speak.
    socketRef.current?.emit("qa:speaking");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new (Recognition as any)();
    recognitionRef.current = recognition;
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    // Local accumulators for THIS recognition session; never stale closures.
    let sessionFinal = "";
    let sessionInterim = "";
    const liveText = () => (transcriptRef.current + " " + (sessionFinal || sessionInterim)).trim();
    recognition.onresult = (event: { results: Array<{ 0: { transcript: string }; isFinal: boolean }> }) => {
      let interim = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const r = event.results[i];
        if (r.isFinal) sessionFinal += r[0].transcript; else interim += r[0].transcript;
      }
      sessionInterim = interim;
      if (sessionFinal || sessionInterim) clearFallbackTimer(); // speech detected → no fallback
      setMyQuestion(liveText());
    };
    recognition.onerror = (ev: { error?: string }) => {
      setListening(false);
      // Feature 1: any mic failure / silence auto-switches to the text fallback
      // so the trainee is never stuck without a way to ask.
      const e = ev?.error || "";
      if (["not-allowed", "service-not-allowed", "audio-capture", "no-speech"].includes(e)) {
        setError(
          e === "not-allowed" || e === "service-not-allowed"
            ? "Microphone blocked — you can type your question instead."
            : "Didn't catch any speech — you can type your question instead.",
        );
        enterTextMode();
        return;
      }
      setError("Microphone error — tap “Start Speaking” or type your question.");
    };
    recognition.onend = async () => {
      setListening(false);
      recognitionRef.current = null;
      clearFallbackTimer(); // recognition ended → no pending auto-switch
      // Fold this session's speech into the running transcript.
      const piece = (sessionFinal.trim() || sessionInterim.trim()).trim();
      if (piece) transcriptRef.current = (transcriptRef.current + " " + piece).trim();
      setMyQuestion(transcriptRef.current);
      if (submitOnEndRef.current) {
        submitOnEndRef.current = false;
        const full = transcriptRef.current;
        transcriptRef.current = "";
        await submitQuestion(full, "voice");
      }
      // else: paused — keep transcriptRef so the user can Continue Speaking.
    };
    // recognition.start() can throw (no gesture, mic busy, permission).
    try {
      recognition.start();
      setListening(true);
      // Voice-path only: arm the 8s silence timer NOW (after the trainee chose
      // to speak). If no speech is captured, auto-switch to chat. Speech
      // (onresult) clears it; chat path never arms this.
      clearFallbackTimer();
      fallbackTimerRef.current = window.setTimeout(() => {
        if (!transcriptRef.current.trim()) enterTextMode();
      }, VOICE_FALLBACK_SECS * 1000);
    } catch (_e) {
      // Starting failed (gesture/permission) → offer the text fallback.
      setListening(false);
      recognitionRef.current = null;
      setError("Couldn't start the mic — you can type your question instead.");
      enterTextMode();
    }
  }, [submitQuestion, clearFallbackTimer, enterTextMode]);

  // NOTE: the mic is NOT auto-started on floor grant. Starting recognition while
  // the hall avatar speaks the greeting caused the assistant's own voice to be
  // captured as trainee speech on some devices. The participant taps
  // [🎤 Start Speaking] to begin — see the footer controls.

  // "Stop Speaking" — pause capture (mic off, transcript finalized & kept). The
  // user can resume with "Continue Speaking" or finalize with "Done Asking".
  const stopSpeaking = () => {
    submitOnEndRef.current = false;
    try { recognitionRef.current?.stop(); } catch (_e) { /* ignore */ }
  };

  // "Done Asking" — finalize and submit the question to the AI. If still
  // recording, stop with the submit flag; if already paused, submit now.
  const doneAsking = () => {
    if (recognitionRef.current && listening) {
      submitOnEndRef.current = true;
      try { recognitionRef.current.stop(); } catch (_e) { /* ignore */ }
    } else {
      const full = transcriptRef.current.trim();
      transcriptRef.current = "";
      void submitQuestion(full);
    }
  };

  // "I'm Done" — release the floor now; backend moves to the next participant.
  const cancelFloor = () => {
    submitOnEndRef.current = false;
    transcriptRef.current = "";
    clearFallbackTimer();
    try { recognitionRef.current?.stop(); } catch (_e) { /* ignore */ }
    setListening(false); setMyQuestion(""); setFollowUp(false); setFollowUpPrompt("");
    setTextMode(false); setTextValue("");
    clearDraft();
    socketRef.current?.emit("qa:done");
  };

  // Feature 2: once the session has ended, fetch the (answer-stripped) assessment.
  useEffect(() => {
    if (phase !== "live" || !isEnded || !session || assessmentLoadedRef.current) return;
    assessmentLoadedRef.current = true;
    (async () => {
      const { data } = await getGroupAssessment(session.id, tokenRef.current);
      if (data.status && data.data) {
        setAssessment(data.data);
        if (data.data.alreadySubmitted && data.data.result) setAssessmentResult(data.data.result);
        assessmentStartedAtRef.current = new Date().toISOString();
      }
    })();
  }, [phase, isEnded, session]);

  const setAnswer = (id: string, value: string) => setAssessmentAnswers((p) => ({ ...p, [id]: value }));
  const toggleMulti = (id: string, opt: string) => setAssessmentAnswers((p) => {
    const cur = Array.isArray(p[id]) ? (p[id] as string[]) : [];
    return { ...p, [id]: cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt] };
  });
  const submitAssessment = async () => {
    if (!session) return;
    setAssessmentBusy(true);
    const { data } = await submitGroupAssessment(
      session.id, tokenRef.current, assessmentAnswers, assessmentStartedAtRef.current || undefined,
    );
    setAssessmentBusy(false);
    if (data.status && data.data) setAssessmentResult({ score: data.data.score, passFail: data.data.passFail });
    else setError(data.message || "Could not submit your assessment. Please try again.");
  };
  const skipAssessment = () => setAssessment((a) => (a ? { ...a, available: false } : a));

  // Feature 4: proctoring during the assessment screen. Event-only — NO video
  // frames are sent; only batched events every 10s. Camera denial does NOT block
  // the assessment (records a CAMERA_DENIED event instead).
  useEffect(() => {
    const showing = phase === "live" && isEnded && Boolean(assessment?.available) && !assessmentResult;
    if (!showing || proctorActiveRef.current) return undefined;
    proctorActiveRef.current = true;

    const queue = (type: ProctoringEventType) => {
      proctorQueueRef.current.push({ type, ts: new Date().toISOString() });
    };
    const flush = async () => {
      if (!session || !proctorQueueRef.current.length) return;
      const batch = proctorQueueRef.current.splice(0, proctorQueueRef.current.length);
      try { await submitProctoringEvents(session.id, tokenRef.current, batch); }
      catch (_e) { proctorQueueRef.current.unshift(...batch); } // requeue on failure
    };
    const onVis = () => { if (document.hidden) queue("TAB_SWITCH"); };
    const onBlur = () => queue("WINDOW_BLUR");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    proctorFlushRef.current = window.setInterval(() => void flush(), 10000);

    let faceTimer = 0;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        proctorStreamRef.current = stream;
        if (proctorVideoRef.current) { proctorVideoRef.current.srcObject = stream; void proctorVideoRef.current.play?.(); }
        setProctorCam("on");
        stream.getVideoTracks().forEach((t) => t.addEventListener("ended", () => queue("CAMERA_OFF")));
        // Optional, best-effort face checks where the browser supports it.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const FD = (window as any).FaceDetector;
        if (FD) {
          const detector = new FD({ fastMode: true });
          faceTimer = window.setInterval(async () => {
            if (!proctorVideoRef.current) return;
            try {
              const faces = await detector.detect(proctorVideoRef.current);
              if (faces.length === 0) queue("NO_FACE");
              else if (faces.length > 1) queue("MULTIPLE_FACES");
            } catch (_e) { /* detector unsupported on this frame */ }
          }, 5000);
        }
      } catch (_e) {
        // Permission denied / no device → assessment continues; record the event.
        setProctorCam("denied");
        queue("CAMERA_DENIED");
      }
    })();

    return () => {
      proctorActiveRef.current = false;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      if (proctorFlushRef.current) { window.clearInterval(proctorFlushRef.current); proctorFlushRef.current = null; }
      if (faceTimer) window.clearInterval(faceTimer);
      proctorStreamRef.current?.getTracks().forEach((t) => t.stop());
      proctorStreamRef.current = null;
      void flush(); // final flush on unmount / after submit
    };
  }, [phase, isEnded, assessment?.available, assessmentResult, session]);

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
  // Completion / assessment screen.
  if (isEnded) {
    // Assessment not yet submitted and questions exist → show the assessment.
    if (assessment?.available && !assessmentResult) {
      return (
        <div className="d-flex vh-100 flex-column p-4" style={{ overflowY: "auto", maxWidth: 640, margin: "0 auto" }}>
          <div className="d-flex justify-content-between align-items-start">
            <h5 className="mb-1">{session?.trainingTitle || "Training"} — Assessment</h5>
            {/* Proctoring preview (local only — no video is uploaded). */}
            <div className="text-end">
              <video ref={proctorVideoRef} muted playsInline
                style={{ width: 96, height: 72, borderRadius: 8, objectFit: "cover", background: "#000", display: proctorCam === "on" ? "block" : "none" }} />
              <div className="small mt-1">
                {proctorCam === "on" ? <span className="text-success">● Camera on</span>
                  : proctorCam === "denied" ? <span className="text-warning">Camera off</span>
                  : <span className="text-secondary">Camera…</span>}
              </div>
            </div>
          </div>
          <p className="text-muted small mb-3">
            Answer the questions below.{assessment.skipAllowed ? " This assessment is optional." : " A passing score is required to complete."}
            {proctorCam === "denied" ? " Camera is off — the assessment will continue." : ""}
          </p>
          {assessment.checkpoints.map((q, i) => (
            <div key={q.id} className="card mb-3">
              <div className="card-body">
                <div className="fw-semibold mb-2">{i + 1}. {q.prompt}</div>
                {q.questionType === "objective" ? (
                  q.options.map((opt) => (
                    <label key={opt} className="d-block">
                      <input type="radio" name={q.id} className="me-2"
                        checked={assessmentAnswers[q.id] === opt}
                        onChange={() => setAnswer(q.id, opt)} />{opt}
                    </label>
                  ))
                ) : q.questionType === "multi_select" ? (
                  q.options.map((opt) => (
                    <label key={opt} className="d-block">
                      <input type="checkbox" className="me-2"
                        checked={Array.isArray(assessmentAnswers[q.id]) && (assessmentAnswers[q.id] as string[]).includes(opt)}
                        onChange={() => toggleMulti(q.id, opt)} />{opt}
                    </label>
                  ))
                ) : (
                  <textarea className="form-control" rows={3}
                    value={(assessmentAnswers[q.id] as string) || ""}
                    onChange={(e) => setAnswer(q.id, e.target.value)} />
                )}
              </div>
            </div>
          ))}
          {error ? <div className="alert alert-warning py-2">{error}</div> : null}
          <div className="d-flex gap-2">
            <button className="btn btn-success flex-fill fw-bold" disabled={assessmentBusy} onClick={() => void submitAssessment()}>
              {assessmentBusy ? "Submitting…" : "Submit Assessment"}
            </button>
            {assessment.skipAllowed ? (
              <button className="btn btn-outline-light" disabled={assessmentBusy} onClick={skipAssessment}>Skip</button>
            ) : null}
          </div>
        </div>
      );
    }
    // Result / completion screen.
    return (
      <div className="d-flex vh-100 flex-column align-items-center justify-content-center text-center p-4">
        <div style={{ fontSize: "3rem" }}>{assessmentResult?.passFail === "fail" ? "📋" : "✅"}</div>
        <h5 className="mt-2">{session?.trainingTitle || "Training"}</h5>
        {assessmentResult ? (
          <p className="text-muted">
            Assessment submitted{assessmentResult.score != null ? ` — score ${assessmentResult.score}%` : ""}
            {assessmentResult.passFail ? ` (${assessmentResult.passFail})` : ""}.
          </p>
        ) : (
          <p className="text-muted">This session has ended. Thank you for attending.</p>
        )}
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
          textMode ? (
            <div>
              <div className="text-info fw-bold">💬 Type your question</div>
              <div className="small text-secondary mt-1">Type below and tap “Send Question”.</div>
            </div>
          ) : listening ? (
            <div>
              <div className="text-danger fw-bold">🔴 Recording…</div>
              <div className="small text-warning mt-1">Tap “Stop Speaking” to pause, or “Send Question” to ask the AI.</div>
            </div>
          ) : followUp ? (
            <div>
              <div className="text-success fw-bold">🗣️ Your turn to speak</div>
              <div className="small text-warning mt-1">
                {followUpPrompt || "Tap “Ask Follow-Up” for another question, or “Finish My Turn” to pass."}
              </div>
            </div>
          ) : myQuestion ? (
            <div>
              <div className="text-warning fw-bold">⏸️ Paused</div>
              <div className="small text-secondary mt-1">Tap “Continue Speaking” to add more, or “Send Question” to ask the AI.</div>
            </div>
          ) : (
            <div>
              <div className="text-success fw-bold">🗣️ Your turn to speak</div>
              <div className="small text-warning mt-1">Tap “Start Speaking” to ask your question{me ? `, ${me.name}` : ""}.</div>
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

      {/* State-driven controls: Start → (Recording) Stop / Done → answer. */}
      <div className="d-flex gap-2 p-3 border-top" style={{ borderColor: "#1f2a3a" }}>
        {!hasFloor ? (
          <button className={`btn flex-fill ${handRaised ? "btn-outline-light" : "btn-primary"}`} disabled={status === "ended"} onClick={toggleHand}>
            {handRaised ? (myPosition >= 0 ? `✋ #${myPosition + 1} in queue` : "✋ Raised") : "✋ Raise Hand"}
          </button>
        ) : textMode ? (
          // Feature 3: text-question composer (manual "Type Question" OR auto on
          // mic failure). Draft persists to localStorage; char counter shown.
          <div className="d-flex flex-column flex-fill gap-2">
            <textarea
              className="form-control" rows={2} autoFocus value={textValue}
              placeholder="Type your question…" maxLength={TEXT_Q_MAX}
              onChange={(e) => onTextChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitText(); } }}
            />
            <div className="small text-secondary text-end">{textValue.length}/{TEXT_Q_MAX}</div>
            <div className="d-flex gap-2">
              <button className="btn btn-success flex-fill fw-bold" disabled={submitting || !textValue.trim()} onClick={submitText}>
                {submitting ? "Sending…" : "✅ Submit"}
              </button>
              <button className="btn btn-outline-secondary" disabled={submitting} onClick={() => { setTextMode(false); setTextValue(""); clearDraft(); }} title="Cancel typing">Cancel</button>
              <button className="btn btn-outline-info" disabled={submitting} onClick={() => { setTextMode(false); setTextValue(""); }} title="Switch back to voice">🎤 Speak</button>
            </div>
            <button className="btn btn-outline-light btn-sm w-100" onClick={cancelFloor}>✖ Finish My Turn (no question)</button>
          </div>
        ) : listening ? (
          <>
            <button className="btn btn-outline-warning flex-fill fw-bold" onClick={stopSpeaking}>⏸️ Stop Speaking</button>
            <button className="btn btn-success flex-fill fw-bold" onClick={doneAsking}>✅ Send Question</button>
          </>
        ) : followUp ? (
          <div className="d-flex flex-column flex-fill gap-2">
            <div className="d-flex gap-2">
              <button className="btn btn-warning flex-fill" onClick={startSpeaking}>🎤 Ask Follow-Up</button>
              <button className="btn btn-outline-info" onClick={enterTextMode}>💬 Type</button>
            </div>
            <button className="btn btn-outline-light btn-sm w-100" onClick={cancelFloor} title="Release the mic — no more questions">✖ Finish My Turn</button>
          </div>
        ) : myQuestion ? (
          // Paused mid-question: continue capturing or finalize.
          <div className="d-flex flex-column flex-fill gap-2">
            <div className="d-flex gap-2">
              <button className="btn btn-warning flex-fill fw-bold" onClick={startSpeaking}>🎤 Continue Speaking</button>
              <button className="btn btn-success flex-fill fw-bold" onClick={doneAsking}>✅ Send Question</button>
            </div>
            <button className="btn btn-outline-light btn-sm w-100" onClick={cancelFloor} title="Release the mic without asking">✖ Finish My Turn (no question)</button>
          </div>
        ) : (
          // Two equal primary actions, shown immediately when the floor is
          // granted: speak (voice path, with 8s silence fallback) or chat (text
          // path, no mic/silence checks).
          <div className="d-flex flex-column flex-fill gap-2">
            <div className="d-flex gap-2">
              <button
                className="btn btn-warning fw-bold flex-fill"
                style={{ fontSize: "1.15rem", padding: "0.8rem 1rem" }}
                onClick={startSpeaking}
              >
                🎤 Start Speaking
              </button>
              <button
                className="btn btn-info fw-bold flex-fill"
                style={{ fontSize: "1.15rem", padding: "0.8rem 1rem" }}
                onClick={enterTextMode}
              >
                💬 Type Question
              </button>
            </div>
            <div className="text-center small text-secondary">Speak your question, or type it instead</div>
            <button className="btn btn-outline-light btn-sm w-100" onClick={cancelFloor} title="Release the mic without asking">
              ✖ Finish My Turn (no question)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default GroupTraineeController;
