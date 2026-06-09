# AI-Managed Group Training Hall — Implementation & User Guide

This document describes the end-to-end Group Training Hall experience: an
AI-managed physical-hall training where one big screen runs the AI avatar as the
trainer, trainees join from their phones, and the session starts automatically at
its scheduled time — no human trainer required.

It complements the One-on-One training flow, which is unchanged. A training is a
Group Training when its **Delivery Type = Group Training (Hall)**.

---

## 1. End-to-End Flow

```
ADMIN/TRAINER                 HALL SCREEN (/hall/:gsId)            TRAINEE PHONE (/group/:gsId)
─────────────                 ────────────────────────            ────────────────────────────
Create training
 Delivery Type = Group
 Set schedule + rules
Approve training
Assign trainees
Click "Launch Hall"  ───────► opens hall + live dashboard
 (generates joinCode,QR)       Shows WAITING screen:
                               • banner / title / details
                               • QR code (→ /group/:gsId)
                               • countdown to start time   ◄──── scan QR → login → JOIN
                                                                  WAITING ROOM:
                                                                  • countdown
                                                                  • "I'm here" confirm
              ── at scheduled time (e.g. 16:00) ──
                               AUTO-START → PRESENTING            🔔 ATTENTION ALERT
                               • avatar fixed (right)             (beep + vibrate + banner)
                               • slides carousel (left)           → live controller view
                               • narrates slides
   live dashboard:            Open Q&A →                          ✋ Raise Hand → queue
   attendance/queue/          grants floor by name               🎤 granted → speak (phone mic)
   transcript + controls      AI answers aloud (avatar)          F&Q updates
   (pause/skip/end)           queue advances
              ── End Session ──
                               attendance flattened to
                               Training.payload.sessions →
                               visible in trainee reports
```

### Step detail

1. **Admin creates & schedules training** — In the Training workspace, set
   **Delivery Type = Group Training (Hall)** and fill *Group Training Hall
   Settings*: capacity, min participants, **Start Time**, End Time, min
   attendance %, max speak secs, max questions/trainee. Submit for review →
   approve (existing workflow).
2. **QR code generation** — When the admin clicks **Launch Hall** on an approved
   group training, the backend creates a `GroupSession` and returns a **join
   code** + **QR token**. The hall screen renders a QR for
   `…/group/<gsId>` using the `qrcode` library (client-side, no external call).
3. **Hall display before start** — The hall shows the waiting screen: training
   thumbnail/banner, title, type/audience, description, the QR, a live joined
   count, and a **countdown** to the scheduled start.
4. **Trainee QR scan** — A trainee scans the QR → opens `/group/<gsId>` → must be
   logged in as an assigned trainee → backend validates (assigned, role, client,
   not blocked, not in another live session, capacity) → issues a session token.
5. **Waiting room** — The trainee sees a countdown, training title, and an "I'm
   here" presence confirm. Many trainees can join during the countdown.
6. **Countdown & timer logic** — Both hall and phones run a 1-second clock against
   the session `startTime`. The hall auto-starts **exactly** at `startTime`
   (not before, not after) via an idempotent guard.
7. **Attention alert** — On the start transition the server broadcasts
   `session:attention` to the room; every waiting phone plays a beep, vibrates,
   and shows an orange "training is starting" banner.
8. **Automatic start** — At `startTime` the hall emits `host:state: presenting`
   and advances to slide 1; the waiting screen is replaced by the live screen.
9. **Live session** — Avatar (fixed, right region) narrates slides (carousel,
   left region). Trainees **Raise Hand** → FIFO queue → host/AI **Opens Q&A** →
   floor granted by name → trainee speaks via phone mic (Web Speech API) →
   `/group/:gsId/ask` (Groq, bounded to the module KB) → avatar answers aloud →
   floor released → next in queue. Silence/max-speak timeouts and cooldowns are
   enforced server-side.
10. **Completion** — On **End Session**, the server finalizes attendance
    (active time, attendance %, completion status) and **flattens** each attendee
    into `Training.payload.sessions`, so the existing trainee reports and
    `getTraineeSessions` show the group attendance + Q&A history.

---

## 2. Admin Guide

### Create a training session
1. Go to **Training → Create Training**.
2. Fill Title, Training Type, then set **Delivery Type = Group Training (Hall)**.
3. The **Group Training Hall Settings** panel appears. Configure:
   - **Session Capacity** — max distinct attendees.
   - **Min Participants** — informational threshold for auto-start logic.
   - **Start Time / End Time** — the scheduled window (Start Time drives the
     countdown + auto-start).
   - **Min Attendance %** — threshold for "completed" status.
   - **Max Speak (secs)** — hard cap on a single Q&A turn.
   - **Max Questions / Trainee** — per-trainee question limit.
4. Add slides/content and the avatar/voice exactly as for One-on-One.
5. Submit for review → approve.

### Schedule a session
The **Start Time** in the settings panel is the scheduled start. The hall screen
counts down to it and auto-starts at that moment. (If the hall is opened after the
start time, it starts immediately.)

### Hall display configuration
Click **Launch Hall** on an approved group training. This:
- Creates the live `GroupSession` (generates join code + QR token).
- Copies the join code + trainee link to the clipboard.
- Opens the **Hall Screen** (`/hall/:gsId`) and the **Live Dashboard**
  (`/group-sessions/:gsId/live`) in new tabs.

Put the Hall Screen tab full-screen on the hall display. Keep it open for the
whole session (it is the orchestrator and the source of the auto-start).

### QR codes
The QR is rendered automatically on the hall waiting screen and encodes the
trainee join URL. No manual step is needed. The 8-character **join code** is also
available (clipboard) for trainees who prefer manual entry.

### Live dashboard
`/group-sessions/:gsId/live` shows real-time attendance, the question queue, the
current speaker, the Q&A transcript, and **Pause / Resume / Skip Speaker / End**
fallback controls.

---

## 3. Trainee Guide

1. **Join** — Scan the hall QR (or open the shared link). Log in as your trainee
   account if prompted, then reopen the link.
2. **After scanning** — You enter the **waiting room**: training title, a
   countdown to start, and an "I'm here" confirm button.
3. **While waiting** — Keep the screen open. More trainees can join during the
   countdown.
4. **When training begins** — Your phone alerts you (sound + vibration + banner).
   The screen switches to the live controller:
   - **Raise Hand** to join the question queue (shows your position).
   - When the AI calls your name you get the floor — tap **ask your question**
     and speak; your phone mic captures it, the AI answers on the hall speaker.
   - **F&Q** lists questions and answers as they happen.
   - Watch and listen to the **hall screen** for all content — your phone is a
     controller only (no slides/AI controls on the phone).

---

## 4. Hall Setup

### Required hardware
- **One large display** (TV/projector) for the Hall Screen.
- **One audio system** (the hall speaker) — the AI voice plays here.
- **A computer/mini-PC/browser device** driving the display (Chrome recommended).
- Trainees use **their own phones** (Chrome/modern browser for mic + Web Speech).

> Note: there is **no shared hall microphone**. When a trainee is called, they
> speak through **their own phone mic** (one at a time, queue-gated). This avoids
> hall-mic hardware and feedback problems.

### Display screen requirements
- Modern Chromium-based browser (Chrome/Edge) for Trulience avatar + audio.
- Landscape orientation; 1080p or higher recommended.
- Audio output enabled and unmuted. The operator should click any control once
  to satisfy the browser's audio-autoplay gesture requirement.

### Internet / network
- Stable broadband for the hall device (avatar streaming + LLM/TTS calls).
- Trainee phones on Wi-Fi/data with access to the app + socket endpoint.
- WebSocket (Socket.IO) traffic must be allowed through the network/firewall.

### Recommended screen layout (live)
```
┌───────────────────────────────────────────────────────────┐
│ Title          Topic: …   ⏱ timer   👥 count   [STATUS]    │
├──────────────────────────────────┬──────────┬─────────────┤
│                                  │          │ NOW SPEAKING │
│   SLIDE CAROUSEL (red region)    │  AVATAR  │  🎤 Name      │
│   • smooth fade/slide transitions│ (fixed,  │ ── QUEUE ──  │
│   • slide dots                   │  green)  │  1. …        │
│                                  │          │  2. …        │
├──────────────────────────────────┴──────────┴─────────────┤
│ Lobby Present ◀Prev Next▶ Narrate  Open Q&A  Next Speaker … │
└───────────────────────────────────────────────────────────┘
```

### Lifecycle the hall display follows
`scheduled/lobby (waiting screen) → presenting ⇄ qa ⇄ assessment → ended`.
- **Waiting screen** until the scheduled start (banner/title/details/QR/countdown).
- **Auto-start** at the scheduled time → presenting.
- **Live** with avatar + slides + queue.
- **Ended** → attendance saved and shown in reports.

---

## 5. Flow Verification — what's implemented vs. known limits

**Implemented**
- Group delivery type + schedule + rules in training setup.
- Group session creation with join code + QR token (Launch Hall).
- Hall waiting screen: banner, title, details, QR, countdown.
- Trainee QR scan → validated join → waiting room with countdown.
- Multiple concurrent joins during countdown.
- Auto-start exactly at scheduled time (hall-driven, idempotent).
- Attention alert (server broadcast → beep + vibrate + banner on phones).
- Auto-transition waiting → live on all surfaces.
- Live avatar (fixed) + slide carousel (smooth transitions).
- Hand-raise queue, floor control, phone-mic Q&A, AI answers aloud.
- Admin live dashboard + pause/resume/skip/end.
- Completion → attendance flattened into existing reports.

**Known limitations / future work**
- **Auto-start requires the Hall Screen to be open** at the scheduled time (the
  hall is the orchestrator). For unattended halls, a server-side scheduler/cron
  could trigger the start independently — not yet implemented.
- **"Start now (override)"** exists on the hall for operators; remove it if a
  strict no-early-start policy is required.
- Q&A uses the **browser Web Speech API** for the phone mic and the Trulience
  voice for output. Pre-generated ElevenLabs slide narration (lower latency) is
  not yet wired.
- Disconnected trainees lose their queue place immediately (no grace hold).
- Assessment/quiz scoring during the hall is stubbed (config exists; UI pending).
