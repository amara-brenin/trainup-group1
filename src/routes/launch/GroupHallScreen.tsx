import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { Socket } from "socket.io-client";
import { bootstrapGroupHost } from "../../helper/groupSessionApi";
import { connectGroupSocket } from "../../helper/groupSocket";
import { generateQrDataUrl } from "../../helper/qrCode";
import { generateScriptAudioDataUri } from "../../helper/scriptAudio";
import TrainingLaunchAvatar, {
  type TrainingLaunchAvatarHandle,
} from "../../component/launch/TrainingLaunchAvatar";

const defaultAvatarId = "1647619895205577317";

type Slide = { id: string; order: number; title: string; script: string; mediaUrl: string; mediaName: string };
type QueueEntry = { traineeId: string; name: string; raisedAt: string };
type TrainingPayload = {
  id?: string;
  title: string;
  type?: string;
  audience?: string;
  presenterNotes?: string;
  previewThumbnailUrl?: string;
  slides: Slide[];
  avatarId?: string;
  avatarName?: string;
  trainingMode?: string;
  ttsProvider?: string;
  voiceId?: string;
  voiceName?: string;
  avatarEngine?: { avatarId?: string; language?: string } | null;
};
type StatePayload = { lifecycle: string; phase: string; currentSlideIndex?: number };

const isVideo = (name: string) => /\.(mp4|webm|ogg)$/i.test(name || "");

// Hall Screen = a pure VIEW of backend state. The backend scheduler starts the
// session at the scheduled time (no dependency on this screen being open). This
// screen renders the waiting/live UI, drives slide narration + Q&A, and reacts
// to backend lifecycle events. State is restored on reconnect via session:sync.
const GroupHallScreen = () => {
  const { gsId = "" } = useParams();
  const socketRef = useRef<Socket | null>(null);
  const avatarRef = useRef<TrainingLaunchAvatarHandle | null>(null);
  const queueRef = useRef<QueueEntry[]>([]);
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);

  const [error, setError] = useState("");
  const [training, setTraining] = useState<TrainingPayload | null>(null);
  const [avatarReady, setAvatarReady] = useState(false);
  const [lifecycle, setLifecycle] = useState("scheduled");
  const [phase, setPhase] = useState("presenting");
  const [startTime, setStartTime] = useState<number | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [attendance, setAttendance] = useState<{ count: number }>({ count: 0 });
  const [nowSpeaking, setNowSpeaking] = useState<{ name: string } | null>(null);
  const [caption, setCaption] = useState("");
  const [now, setNow] = useState(Date.now());
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const [audioReady, setAudioReady] = useState(false);
  const [autoRun, setAutoRun] = useState(true);
  const presentTimerRef = useRef<number | null>(null);

  const slides = training?.slides ?? [];
  const currentSlide = slides[slideIndex] ?? null;
  const useAvatar = training?.trainingMode !== "voice";
  const resolvedAvatarId = training?.avatarEngine?.avatarId || training?.avatarId || defaultAvatarId;
  const speechLanguage = training?.avatarEngine?.language;

  const isLive = lifecycle === "live";
  const isWaiting = lifecycle === "scheduled" || lifecycle === "waiting" || lifecycle === "starting";
  const isEnded = lifecycle === "completed" || lifecycle === "cancelled";
  const msUntilStart = startTime ? startTime - now : 0;

  // Narration-completion plumbing (Priority 3): advance on actual narration end
  // rather than a pure time estimate.
  const onNarrationDoneRef = useRef<(() => void) | null>(null);
  const sawTalkingRef = useRef(false);

  const finishNarration = useCallback(() => {
    const cb = onNarrationDoneRef.current;
    onNarrationDoneRef.current = null;
    sawTalkingRef.current = false;
    if (cb) cb();
  }, []);

  // ElevenLabs fallback (parity with One-on-One): when the avatar runtime is
  // unavailable, play the same server-generated TTS audio rather than the
  // browser's lower-quality speechSynthesis voice. Completion drives onDone.
  const playFallbackAudio = useCallback(
    async (text: string) => {
      try {
        const uri = await generateScriptAudioDataUri(text, {
          provider: training?.ttsProvider || "ElevenLabs",
          voiceId: training?.voiceId,
          voiceName: training?.voiceName,
          trainingId: training?.id,
        });
        if (!uri) throw new Error("empty-audio");
        const el = fallbackAudioRef.current || new Audio();
        fallbackAudioRef.current = el;
        el.onended = () => finishNarration();
        el.onerror = () => finishNarration();
        el.src = uri;
        await el.play();
      } catch {
        // Last resort only if ElevenLabs/local TTS is unavailable.
        if (typeof window !== "undefined" && window.speechSynthesis) {
          window.speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance(text);
          utter.onend = () => finishNarration();
          window.speechSynthesis.speak(utter);
        } else {
          finishNarration();
        }
      }
    },
    [training?.ttsProvider, training?.voiceId, training?.voiceName, training?.id, finishNarration],
  );

  // Speak `text`; when narration completes, invoke onDone. Avatar path resolves
  // via avatar status (talking → idle); fallback resolves via audio 'ended'.
  const speak = useCallback(
    (text: string, onDone?: () => void) => {
      const normalized = String(text || "").trim();
      if (!normalized) {
        onDone?.();
        return;
      }
      setCaption(normalized);
      onNarrationDoneRef.current = onDone || null;
      sawTalkingRef.current = false;

      const spoke =
        useAvatar && avatarReady
          ? avatarRef.current?.speakText({
              text: `repeat exact text: ${normalized}`,
              trainingId: training?.id,
              currentSlideId: currentSlide?.id ?? null,
            })
          : false;

      if (!spoke) void playFallbackAudio(normalized);
    },
    [useAvatar, avatarReady, training?.id, currentSlide?.id, playFallbackAudio],
  );

  // The socket handlers below are registered once (effect deps [gsId]) and would
  // otherwise capture the mount-time `speak` (training=null, avatarReady=false).
  // Route them through a ref that always holds the CURRENT speak, so greetings
  // and answers use the live avatar state + configured voice.
  const speakRef = useRef(speak);
  useEffect(() => {
    speakRef.current = speak;
  }, [speak]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await bootstrapGroupHost(gsId);
      if (!active) return;
      if (!data.status) {
        setError(data.message || "Unable to open the hall. Are you signed in as admin/trainer?");
        return;
      }
      const s = data.data.session;
      setLifecycle(s.lifecycle);
      setPhase(s.phase);
      setSlideIndex(s.currentSlideIndex || 0);
      setStartTime(s.startTime ? new Date(s.startTime).getTime() : null);
      const t = data.data.training as unknown as TrainingPayload;
      setTraining({ ...t, slides: Array.isArray(t.slides) ? t.slides : [] });

      // Secure QR encodes the session's qrToken (not the raw id).
      const url = `${window.location.origin}/group/${data.data.qrToken}`;
      setJoinUrl(url);
      void generateQrDataUrl(url, 260).then((dataUrl) => active && setQrDataUrl(dataUrl));

      const socket = connectGroupSocket({ token: data.data.token });
      socketRef.current = socket;
      socket.on("connect", () => socket.emit("session:join"));
      socket.on("queue:update", (p: { queue: QueueEntry[] }) => {
        queueRef.current = p.queue || [];
        setQueue(p.queue || []);
      });
      socket.on("attendance:update", (p: { count: number }) => setAttendance({ count: p.count }));
      const applyState = (p: StatePayload) => {
        setLifecycle(p.lifecycle);
        setPhase(p.phase);
        if (typeof p.currentSlideIndex === "number") setSlideIndex(p.currentSlideIndex);
      };
      socket.on("session:state", applyState);
      socket.on("session:sync", applyState);
      socket.on("session:attention", () => {
        // Session went live (backend-driven). The presentation auto-run effect
        // handles narration + slide advance once audio is unlocked.
        setAutoRun(true);
      });
      socket.on("floor:granted", (p: { name: string }) => {
        setNowSpeaking({ name: p.name });
        speakRef.current(`How can I help you, ${p.name}?`);
      });
      socket.on("floor:released", (p?: { reason?: string }) => {
        setNowSpeaking(null);
        // The backend grants the next speaker (if any) on release. When the
        // queue is empty, resume the presentation automatically.
        if (p?.reason === "queue-empty") {
          socketRef.current?.emit("host:phase", { phase: "presenting" });
        }
      });
      // Speak the AI answer through the avatar (or ElevenLabs fallback). When it
      // finishes, tell the backend so it releases the floor and grants the next
      // trainee — guaranteeing strict one-at-a-time turn sequencing.
      socket.on("qa:answer", (p: { answer: string }) => {
        speakRef.current(p.answer, () => socketRef.current?.emit("host:answer-complete"));
      });
      socket.on("session:ended", () => setLifecycle("completed"));
    })();
    return () => {
      active = false;
      socketRef.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gsId]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const prime = () => {
    avatarRef.current?.primeAudio();
    setAudioReady(true); // a control interaction satisfies the browser autoplay gate
  };

  // Phase control (only meaningful when live).
  const setLivePhase = (next: string) => {
    prime();
    socketRef.current?.emit("host:phase", { phase: next });
  };
  // Manual override start (backend validates; normally the scheduler starts it).
  const manualStart = () => {
    prime();
    socketRef.current?.emit("host:start");
  };

  // Advance the slide + tell the backend. Narration is handled by the auto-run
  // effect (single narrator), so manual Prev/Next also narrate via that effect.
  const goToSlide = (index: number) => {
    prime();
    if (presentTimerRef.current) window.clearTimeout(presentTimerRef.current);
    const clamped = Math.max(0, Math.min(slides.length - 1, index));
    setSlideIndex(clamped);
    const slide = slides[clamped];
    socketRef.current?.emit("host:advance", { slideId: slide?.id, slideIndex: clamped, topic: slide?.title });
  };

  // Autonomous presentation: when live + presenting + audio unlocked, narrate the
  // current slide and auto-advance after an estimated duration. No per-slide
  // operator clicks required. Works on first start AND on a late hall open
  // (it keys off live state, not the one-shot attention event).
  useEffect(() => {
    if (!isLive || phase !== "presenting" || !audioReady || !autoRun) return;
    const slide = slides[slideIndex];
    if (!slide) return;

    let done = false;
    const advance = () => {
      if (done) return;
      done = true;
      if (presentTimerRef.current) window.clearTimeout(presentTimerRef.current);
      if (slideIndex < slides.length - 1) goToSlide(slideIndex + 1);
      else socketRef.current?.emit("host:phase", { phase: "qa" }); // auto-open Q&A after last slide
    };

    // Advance when narration actually completes…
    speak(slide.script || "", advance);

    // …with a safety cap so we never get stuck if no completion event arrives
    // (e.g., avatar status quirk). Generous: estimate + 12s buffer.
    const words = String(slide.script || "").split(/\s+/).filter(Boolean).length;
    const capSecs = Math.max(10, Math.ceil(words / 2.3)) + 12;
    if (presentTimerRef.current) window.clearTimeout(presentTimerRef.current);
    presentTimerRef.current = window.setTimeout(advance, capSecs * 1000);

    return () => {
      if (presentTimerRef.current) window.clearTimeout(presentTimerRef.current);
      onNarrationDoneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, phase, slideIndex, audioReady, autoRun, slides.length]);

  const countdown = useMemo(() => {
    const total = Math.max(0, Math.floor(msUntilStart / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h > 0 ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [msUntilStart]);

  const sessionTimer = useMemo(() => {
    const base = startTime && now > startTime ? Math.floor((now - startTime) / 1000) : 0;
    return `${Math.floor(base / 60)}:${String(base % 60).padStart(2, "0")}`;
  }, [now, startTime]);

  if (error) {
    return <div className="d-flex vh-100 align-items-center justify-content-center text-danger fs-5 p-4 text-center">{error}</div>;
  }

  // ---- Waiting / pre-training screen ----
  if (isWaiting) {
    return (
      <div className="vh-100 d-flex flex-column align-items-center justify-content-center text-white text-center p-4" style={{ background: "#0b1220" }}>
        {training?.previewThumbnailUrl ? (
          <img src={training.previewThumbnailUrl} alt={training.title} style={{ maxHeight: "28vh", borderRadius: 16, marginBottom: 24, objectFit: "contain" }} />
        ) : null}
        <h1 className="fw-bold mb-2">{training?.title || "Group Training"}</h1>
        <div className="text-info text-uppercase small mb-1">{training?.type}{training?.audience ? ` • ${training.audience}` : ""}</div>
        {training?.presenterNotes ? <p className="text-secondary mb-4" style={{ maxWidth: 720 }}>{training.presenterNotes}</p> : null}

        <div className="d-flex flex-wrap align-items-center justify-content-center gap-5 mt-2">
          <div>
            <div className="text-uppercase small text-secondary mb-2">Starts in</div>
            <div style={{ fontSize: "4rem", fontWeight: 700, lineHeight: 1 }}>{startTime ? countdown : "--:--"}</div>
            <div className="text-secondary mt-2">Scheduled: {startTime ? new Date(startTime).toLocaleString() : "—"}</div>
          </div>
          <div className="text-center">
            <div className="text-uppercase small text-secondary mb-2">Scan to join</div>
            {qrDataUrl ? <img src={qrDataUrl} alt="Join QR" style={{ width: 220, height: 220, borderRadius: 12 }} /> : <div style={{ width: 220, height: 220 }} className="bg-secondary rounded" />}
            <div className="small text-secondary mt-2" style={{ maxWidth: 240, wordBreak: "break-all" }}>{joinUrl}</div>
          </div>
        </div>

        <div className="mt-4 d-flex align-items-center gap-3">
          <span className="badge bg-info text-dark">👥 {attendance.count} joined</span>
          <span className="badge bg-secondary text-uppercase">{lifecycle}</span>
        </div>
        <div className="text-secondary small mt-3">Starts automatically at the scheduled time.</div>
        <button className="btn btn-sm btn-outline-light mt-2" onClick={manualStart}>Start now (override)</button>
      </div>
    );
  }

  // ---- Live training screen ----
  return (
    <div className="vh-100 d-flex flex-column bg-dark text-white" style={{ overflow: "hidden" }}>
      {/* Audio unlock — browsers block autoplay audio until one user gesture.
          A single tap then lets the presentation run autonomously. */}
      {isLive && !audioReady ? (
        <div
          className="position-fixed top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center"
          style={{ background: "rgba(0,0,0,0.92)", zIndex: 1090 }}
          onClick={prime}
          role="button"
        >
          <div style={{ fontSize: "3rem" }}>🔊</div>
          <h3 className="mt-2">Tap to start the presentation</h3>
          <p className="text-secondary">The AI trainer will then present and narrate automatically.</p>
        </div>
      ) : null}

      <div className="d-flex align-items-center justify-content-between px-4 py-2 border-bottom border-secondary">
        <div className="fw-bold">{training?.title || "Group Training"}</div>
        <div className="d-flex gap-4 align-items-center">
          <span>Topic: {currentSlide?.title || "—"}</span>
          <span>⏱ {sessionTimer}</span>
          <span>👥 {attendance.count}</span>
          <span className="badge bg-info text-dark text-uppercase">{isLive ? phase : lifecycle}</span>
        </div>
      </div>

      <div className="flex-grow-1 d-flex" style={{ minHeight: 0 }}>
        {/* RED region: slide carousel */}
        <div className="flex-grow-1 p-3 d-flex flex-column" style={{ minWidth: 0 }}>
          <div className="flex-grow-1 position-relative bg-black rounded d-flex align-items-center justify-content-center" style={{ minHeight: 0, overflow: "hidden" }}>
            {slides.map((slide, i) => (
              <div
                key={slide.id}
                className="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
                style={{
                  opacity: i === slideIndex ? 1 : 0,
                  transform: i === slideIndex ? "translateX(0)" : i < slideIndex ? "translateX(-24px)" : "translateX(24px)",
                  transition: "opacity 0.5s ease, transform 0.5s ease",
                  pointerEvents: i === slideIndex ? "auto" : "none",
                }}
              >
                {slide.mediaUrl ? (
                  isVideo(slide.mediaName) ? (
                    <video src={slide.mediaUrl} controls className="w-100 h-100" style={{ objectFit: "contain" }} />
                  ) : (
                    <img src={slide.mediaUrl} alt={slide.title} style={{ objectFit: "contain", maxHeight: "100%", maxWidth: "100%" }} />
                  )
                ) : (
                  <div className="text-center p-4">
                    <h2>{slide.title}</h2>
                    <p className="text-muted">{slide.script}</p>
                  </div>
                )}
              </div>
            ))}
            {!slides.length ? <div className="text-center p-4"><h2>Waiting to begin</h2></div> : null}
          </div>
          {slides.length > 1 ? (
            <div className="d-flex justify-content-center gap-2 mt-2">
              {slides.map((s, i) => (
                <span key={s.id} style={{ width: 8, height: 8, borderRadius: 8, background: i === slideIndex ? "#ff6200" : "#495057", transition: "background 0.3s ease" }} />
              ))}
            </div>
          ) : null}
          {caption ? <div className="mt-2 p-2 bg-secondary rounded small">{caption}</div> : null}
        </div>

        {/* GREEN region: fixed avatar */}
        <div className="group-hall-avatar border-start border-secondary" style={{ width: 360, flexShrink: 0, background: "#000" }}>
          {useAvatar && resolvedAvatarId ? (
            <TrainingLaunchAvatar
              ref={avatarRef}
              avatarId={resolvedAvatarId}
              language={speechLanguage}
              username="Hall"
              positionClass=""
              onReady={() => {
                setAvatarReady(true);
                avatarRef.current?.pushTrainingContext({ trainingId: training?.id, currentSlideId: currentSlide?.id ?? null });
              }}
              onStatusChange={(status) => {
                // Narration-end detection: once the avatar has been talking and
                // returns to idle, the current slide narration is complete.
                if (status.state === "talking") sawTalkingRef.current = true;
                else if ((status.state === "idle" || status.state === "loaded") && sawTalkingRef.current) {
                  finishNarration();
                }
              }}
            />
          ) : (
            <div className="h-100 d-flex align-items-center justify-content-center">
              <i className="bi bi-soundwave" style={{ fontSize: 72 }} />
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="border-start border-secondary p-3 d-flex flex-column" style={{ width: 280, flexShrink: 0 }}>
          <div className="mb-3">
            <div className="text-uppercase small text-muted">Now Speaking</div>
            <div className="fs-5">{nowSpeaking ? `🎤 ${nowSpeaking.name}` : "—"}</div>
          </div>
          <div className="flex-grow-1">
            <div className="text-uppercase small text-muted">Queue ({queue.length})</div>
            <ol className="ps-3">
              {queue.map((q) => <li key={q.traineeId}>{q.name}</li>)}
              {!queue.length ? <li className="list-unstyled text-muted">No hands raised</li> : null}
            </ol>
          </div>
          {useAvatar && !avatarReady ? <div className="small text-warning">Avatar connecting…</div> : null}
        </div>
      </div>

      {/* Host controls — autonomous by default; toggle to operator mode. */}
      <div className="d-flex gap-2 flex-wrap px-4 py-2 border-top border-secondary align-items-center">
        <button
          className={`btn btn-sm ${autoRun ? "btn-success" : "btn-outline-light"}`}
          onClick={() => setAutoRun((v) => !v)}
          title="When ON, the AI presents and advances slides automatically"
        >
          {autoRun ? "● Auto" : "Manual"}
        </button>
        <span className="vr mx-1" />
        <button className="btn btn-sm btn-primary" onClick={() => setLivePhase("presenting")}>Present</button>
        <button className="btn btn-sm btn-outline-light" onClick={() => goToSlide(slideIndex - 1)}>◀ Prev</button>
        <button className="btn btn-sm btn-outline-light" onClick={() => goToSlide(slideIndex + 1)}>Next ▶</button>
        <button className="btn btn-sm btn-outline-light" onClick={() => { prime(); if (currentSlide?.script) speak(currentSlide.script); }}>🔊 Narrate</button>
        <button className="btn btn-sm btn-warning" onClick={() => setLivePhase("qa")}>Open Q&amp;A</button>
        <button className="btn btn-sm btn-outline-warning" onClick={() => { prime(); socketRef.current?.emit("host:grant-next"); }}>Next Speaker</button>
        <button className="btn btn-sm btn-outline-danger ms-auto" onClick={() => socketRef.current?.emit("host:end")}>End Session</button>
      </div>

      {isEnded ? (
        <div className="position-absolute top-50 start-50 translate-middle text-center p-4 bg-dark rounded border border-secondary">
          <h3>Session ended</h3>
          <p className="text-muted">Attendance and reports have been saved.</p>
        </div>
      ) : null}
    </div>
  );
};

export default GroupHallScreen;
