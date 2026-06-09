# Group Training Hall — Production Readiness Report

Date: 2026-06-06
Scope: AI-managed Group Training Hall (autonomous, scheduled, no operator required).

---

## 1. Implemented Features

### Autonomy & scheduling
- **Server-side scheduler** (`backend/src/socket/scheduler.js`) runs every 10s, independent of any Hall Screen:
  - Moves `scheduled → waiting` as the start time approaches (60-min lead, configurable).
  - **Auto-starts at the exact scheduled time** via an **atomic, idempotent** `findOneAndUpdate` guard (`runtime.startSession`) — safe across restarts and duplicate ticks.
  - Runs once on boot to reconcile due sessions after a restart.
- **Backend is the source of truth.** Clients (hall + trainee + admin) only render backend-emitted state; the hall no longer drives start.

### Strict lifecycle state machine
- Lifecycle: `scheduled → waiting → starting → live → completed` (+ `cancelled`).
- Live sub-phase: `presenting | qa | assessment | paused`.
- **Invalid transitions blocked** (`canTransition` in `helpers/groupSession.js`); every transition is **logged** to console and appended to `session.transitions[]`.
- **Reconnect recovery**: on (re)connect the server emits `session:sync` with the full snapshot; countdown uses the absolute `startTime` so it stays accurate. Server restart preserves state (persisted in Mongo); scheduler resumes.

### QR & join validation
- QR encodes the session's **secure `qrToken`** (`…/group/<qrToken>`), not a guessable id.
- Join validates: assigned + trainee role + same client + not blocked + not in another live session + capacity + not expired/completed.
- **Expired/completed** sessions return a completion flag → trainee sees a completion screen; **invalid** QR → friendly error page.
- **All join attempts logged** (`session.joinLog[]` + console) with outcome/reason.

### Attendance tracking
- Per-trainee states: `registered → joined → waiting → present → completed`.
- Timestamps: `joinedAt`, `confirmTime`, `completionTime`, plus `totalActiveMs`, `rejoins`, `attendancePct`.
- Finalized on end and **flattened** into `Training.payload.sessions` for existing reports.

### Admin monitoring dashboard (`/group-sessions/:gsId/live`)
- Metrics: **invited, joined, waiting, present, completed**, in-queue, now-speaking.
- Lifecycle + phase badges, session start/end timestamps.
- Participants table with attendance state, connection, join time, active time, attendance %, hands, questions.
- Live queue + Q&A transcript; **Pause / Resume / Skip Speaker / End** controls.

### Hall & trainee UX
- Hall: fixed avatar (right), smooth slide carousel (left), waiting screen (banner/title/details/QR/countdown), backend-driven auto-start.
- Trainee: waiting room + countdown, **attention alert** (beep + vibration + banner) on start, raise-hand queue, phone-mic Q&A, completion screen.

---

## 2. Architecture Overview

```
                     ┌─────────────────────────────────────────────┐
                     │                BACKEND (source of truth)      │
   Mongo  ◄──────────┤  GroupSession (lifecycle/phase/attendees/…)   │
                     │  groupSessionController (REST: create/join/…) │
   Scheduler ───────►│  GroupRuntime (Socket.IO rooms + floor FSM)   │
   (10s tick)        │   • startSession (atomic, idempotent)         │
                     │   • transition() validated + logged           │
                     │   • emits session:state / :sync / :attention  │
                     └───────────────▲───────────────▲──────────────┘
                                     │ socket          │ socket
              ┌──────────────────────┘                 └───────────────────────┐
   HALL SCREEN (/hall/:gsId, host token)               TRAINEE (/group/:qrToken, trainee token)
   • renders waiting/live from backend state            • waiting room + countdown
   • avatar speaks; slides carousel                     • raise hand / phone-mic Q&A
   • host phase controls (validated server-side)        • attention alert on start
                                     │
                          ADMIN DASHBOARD (/group-sessions/:gsId/live, admin JWT)
                          • metrics + controls (pause/resume/skip/end)
```

Transport: Socket.IO rooms `session:<gsId>`; REST under the API prefix. Auth: short-lived
group-session JWT (host/trainee) or admin JWT (+gsId) for the dashboard observer.

---

## 3. Session Flow Diagram

```
ADMIN: create+approve group training → assign → "Launch Hall" (creates GroupSession + QR/code)

SCHEDULER (server):  scheduled ──(near start)──► waiting ──(== startTime)──► starting ─► live
                                                                                  │
TRAINEE: scan QR → login → join (validated, logged) → waiting room (countdown)     │
                                                            │  session:attention ◄──┘ (beep+vibrate)
HALL: waiting screen (QR+countdown) ──────────────────────► live (avatar + slides)
                                                            │
LIVE: presenting ⇄ qa (raise hand → queue → floor granted → phone mic → Groq → avatar answers)
                                                            │
END (manual or policy): live ─► completed → attendance finalized → flattened to reports
```

---

## 4. Production Readiness Review

### Remaining gaps
1. **Multi-instance scheduler**: the atomic start guard makes duplicate starts safe, but the `setInterval` runs in every process. For horizontal scaling, add a distributed lock (e.g., Mongo TTL lock / Redis) so only one instance ticks, and a **Socket.IO Redis adapter** so room broadcasts span instances.
2. **Auto-end**: sessions auto-start but do not auto-end at `endTime` (only manual/host end). Add an end branch to the scheduler.
3. **Floor timers are in-memory**: a server restart mid-Q&A loses the speak/silence timers (state is intact; next-speaker/host recovers). Persist `floorGrantedAt` deadline and rehydrate on boot for full autonomy.
4. **Assessment/quiz** during the hall is configured but the in-session UI/scoring is not built.
5. **Disconnect grace**: a dropped trainee loses queue place immediately (no hold window).
6. **Pre-generated ElevenLabs narration** (lower latency) not wired; hall uses Trulience voice / browser fallback.

### Potential failure scenarios & handling
| Scenario | Current behavior |
|---|---|
| Hall screen closed at start | Backend scheduler still starts the session; hall shows live state when reopened (sync). |
| Server restart | State persisted; scheduler reconciles on boot; clients reconnect + `session:sync`. |
| Duplicate start (ticks/instances) | Atomic guard — only one wins. |
| Trainee network drop | Socket auto-reconnect + `session:sync`; attendance resumes; queue place dropped. |
| Groq/Trulience/ElevenLabs outage | Q&A returns a 502 to the speaker; slides still advance; browser TTS fallback for narration. |
| Invalid/expired QR | Friendly error / completion screen; join denied + logged. |

### Scalability concerns
- One audio pipeline per hall (one speaker at a time) → AI cost scales with **number of halls**, not trainees.
- Single Socket.IO process is fine to ~hundreds of sockets per hall; **add Redis adapter for >100 concurrent or multi-instance**.
- Mongo writes per heartbeat/queue change are frequent; batch/throttle heartbeats (currently 15s) and consider write-coalescing at large scale.

### Security concerns
- Secure `qrToken` (non-guessable) + short-lived session JWTs; ask endpoint gated to the active speaker.
- Join attempts logged. **Add rate limiting** on `/group/:id/resolve` and `/join` to deter scanning/abuse.
- Single-session lock prevents dual-device presence.
- Recommend HTTPS/WSS in production and tightening CORS to known origins.

### Performance concerns
- Dashboard polls every 5s + socket deltas — fine for one operator; avoid many concurrent dashboards per session.
- Floor timers and broadcasts are O(room size); broadcast deltas (already done) rather than snapshots.

### Recommended fixes (priority)
1. Add **auto-end at `endTime`** to the scheduler (small, high value).
2. Add **rate limiting** to public group endpoints.
3. For scale-out: **Redis adapter + distributed scheduler lock**.
4. Persist/rehydrate **floor deadlines** for full mid-session restart resilience.

---

## 5. Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| Multi-instance double scheduling | Low | Low (single instance) | Atomic guard now; Redis lock for scale-out |
| AI provider outage during Q&A | Medium | Medium | Fallbacks + retries; slides continue |
| No auto-end leaves sessions "live" | Low | Medium | Add scheduler end branch |
| Mongo write volume at scale | Medium | Low–Med | Throttle heartbeats; Redis hot state |
| Abuse of public join endpoints | Medium | Low | Rate limiting + logging (logging done) |

---

## 6. Go-Live Readiness Status

**Status: ✅ Ready for controlled production (single-instance) — GREEN with conditions.**

- Core autonomous flow (schedule → auto-start → live → complete) works **without operator intervention** and **without the Hall Screen open**.
- Backend is the source of truth; clients recover on reconnect; QR/join hardened and logged; attendance + monitoring in place.

**Conditions before high-scale / multi-instance go-live:**
1. Add Socket.IO **Redis adapter** + **distributed scheduler lock**.
2. Add **auto-end at endTime** and **rate limiting** on public endpoints.
3. Serve over **HTTPS/WSS** with tightened CORS.

These are additive and do not change the current architecture.
