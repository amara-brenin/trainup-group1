# Group Training Hall — Capacity Planning Report

Estimates for the AI-managed Group Training Hall. Figures are engineering
estimates from the architecture (one gated speaker per hall, delta broadcasts,
Mongo-persisted state) — validate with a load test in your environment before
committing SLAs.

---

## 1. Workload model

A "hall" = one live `GroupSession`. Per hall:
- 1 Hall Screen (host socket) + N trainee sockets + a few admin observers.
- Exactly **one active audio pipeline** at a time (one speaker → one Groq call →
  one TTS) regardless of N. This is the key property: **AI cost scales with the
  number of concurrent halls, not trainees.**

Per-trainee steady-state load:
- 1 socket connection.
- 1 heartbeat / 15s (≈0.067 msg/s) → a small Mongo write.
- Occasional hand-raise / Q&A (bursty, queue-gated).

---

## 2. Concurrent trainees supported

| Deployment | Concurrent sockets | Notes |
|---|---|---|
| 1 instance (2 vCPU / 4 GB) | ~3,000–5,000 idle sockets | Socket.IO handles 10k idle sockets on modest hardware; practical limit set by event/write rate, not raw connections. |
| 1 instance, active sessions | ~1,000–1,500 active trainees across halls | Heartbeats + queue/attendance broadcasts dominate. |
| N instances + Redis adapter | Linear with N | Add instances behind the LB; Redis fans out room events. |

Per **single hall**: 250 trainees (the stated target) is comfortable on one
instance — only one speaker is active, broadcasts are deltas, and heartbeats are
throttled to 15s (≈17 writes/s for 250 trainees).

---

## 3. Socket connection limits

- Raise OS file-descriptor limits (`ulimit -n` ≥ 65535) on each node.
- Behind an ALB/NGINX: enable WebSocket upgrade, raise idle timeouts > heartbeat
  interval, and size worker connections accordingly.
- With the Redis adapter, total sockets = sum across instances; plan ~3–5k
  active sockets per 2 vCPU instance as a safe starting point.

---

## 4. Scheduler performance

- One leader runs every 10s; each tick is 2–3 indexed Mongo queries
  (`lifecycle` + `startTime`/`endTime`) over the small set of upcoming/live
  sessions. Sub-50ms typical.
- Cost is independent of trainee count and of the number of instances (only the
  leader works). Thousands of scheduled sessions are fine; add a compound index
  on `{ lifecycle, startTime }` / `{ lifecycle, endTime }` if the session
  collection grows very large.

---

## 5. Database impact

Dominant writes:
- **Heartbeats**: N/15 writes/s per hall (250 → ~17/s). Mostly small `$set`
  updates on one document.
- **Queue/floor/attendance**: bursty, low volume.
- **Transcripts**: one push per answered question.

Mitigations at scale:
- Throttle/raise heartbeat interval (env) for very large halls.
- Hot live-state already isolated in `GroupSession`; flatten to training only at
  end (one write per attendee).
- For >100 active trainees per hall or many simultaneous halls, consider moving
  hot counters to Redis and persisting periodically.

Indexes present: `appId`, `clientId`, `trainingId`, `lifecycle`, `joinCode`,
`qrToken`. Add `{lifecycle,startTime}` + `{lifecycle,endTime}` for large scale.

---

## 6. Expected bottlenecks (in order)

1. **AI provider latency/limits** (Groq/ElevenLabs/Trulience) — per active
   speaker. Concurrent halls multiply this; negotiate provider rate limits and
   add retry/backoff + a fallback message.
2. **Mongo write throughput** from heartbeats at very high aggregate trainee
   counts — throttle or move to Redis counters.
3. **Single instance socket fan-out** without Redis — add instances + adapter.
4. **Scheduler is not a bottleneck** (single leader, tiny work).

---

## 7. Recommended starting topology

| Scale | Topology |
|---|---|
| ≤ 250 trainees, 1–2 halls | 1 instance, no Redis needed. |
| ≤ 1,000 trainees or several halls | 2 instances + Redis adapter + managed Mongo. |
| Enterprise (many halls, thousands) | 3+ autoscaled instances + Redis (adapter + optional hot state) + Mongo replica set; heartbeat throttling; provider rate-limit agreements. |
