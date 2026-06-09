# Group Training Hall — Final Enterprise Readiness Report

Date: 2026-06-06
Objective: enterprise-grade, multi-instance, highly-available deployment with no
change to the existing user experience or workflow.

---

## 1. Architecture Diagram

```
                         ┌──────────────────── Load Balancer / Ingress (TLS, WSS) ───────────────────┐
                         │            HTTP→HTTPS redirect · WebSocket upgrade · CORS allowlist        │
                         └───────────────┬───────────────────────────┬───────────────────────────────┘
                                         │                           │
                         ┌───────────────▼───────────┐   ┌───────────▼───────────────┐
                         │  Backend instance A         │   │  Backend instance B  …N    │
                         │  • Express REST (rate-ltd)  │   │  • Express REST            │
                         │  • Socket.IO + Redis adapter│◄─►│  • Socket.IO + Redis adptr │
                         │  • GroupRuntime (floor FSM) │   │  • GroupRuntime            │
                         │  • Scheduler (leader only)  │   │  • Scheduler (standby)     │
                         └───────┬───────────┬─────────┘   └─────────┬──────────────────┘
                                 │           │                       │
                  ┌──────────────▼──┐   ┌────▼─────────┐    ┌────────▼─────────┐
                  │ Redis           │   │ MongoDB       │    │ AI providers      │
                  │ • SIO adapter   │   │ • GroupSession│    │ • Groq (LLM)      │
                  │   (room fan-out)│   │ • Lock (leader)│   │ • ElevenLabs/     │
                  └─────────────────┘   │ • Training/…  │    │   Trulience (TTS/ │
                                        └───────────────┘    │   avatar/STT)     │
                                                             └───────────────────┘
   CLIENTS: Hall Screen (/hall/:gsId) · Trainee (/group/:qrToken) · Admin Dashboard (/group-sessions/:gsId/live)
            — all are pure views of backend state; reconnect restores via session:sync
```

---

## 2. Session Lifecycle Diagram

```
                    ┌─────────────┐  scheduler (start ≤ now, atomic+idempotent)
   create + approve │  scheduled  │──────────────┐
   + Launch Hall    └─────┬───────┘              │
                          │ scheduler            ▼
                    (start−lead) │          ┌──────────┐      ┌──────────┐
                          ▼      └─────────►│ starting │─────►│   live   │
                    ┌─────────────┐         └──────────┘      └────┬─────┘
                    │   waiting   │──────────────────────────────► │  phases: presenting ⇄ qa ⇄ assessment ⇄ paused
                    └─────────────┘                                │
                          │                                        │ scheduler (endTime) OR manual end
                          │ cancelled (any non-terminal)           ▼
                          ▼                                  ┌────────────┐
                    ┌────────────┐                           │ completed  │ → attendance finalized → flattened to reports
                    │ cancelled  │                           └────────────┘
                    └────────────┘
   Invalid transitions are blocked + logged. Reconnects restore current state.
```

---

## 3. Scaling Architecture

- **Stateless app instances** behind a load balancer; horizontal scale-out.
- **Socket.IO Redis adapter** (`REDIS_URL`) shares rooms/broadcasts across all
  instances → a client on any node receives events produced on any other node.
- **One audio pipeline per hall** → AI load scales with concurrent halls, not
  trainees.
- **Delta broadcasts** (queue/attendance/state) instead of snapshots; heartbeats
  throttled (15s).
- See `GROUP_TRAINING_CAPACITY.md` for numbers and topology by scale.

---

## 4. High Availability Design

- **No single orchestrator dependency**: the backend (not the Hall Screen) owns
  lifecycle; any instance can serve any client.
- **Leader-elected scheduler** via Mongo distributed lock with TTL; **automatic
  failover** within one TTL window if the leader dies; graceful shutdown releases
  the lock immediately.
- **Idempotent start** guarantees correctness even during a brief two-leader
  overlap.
- **State durability**: live state in MongoDB; a server/instance restart
  preserves sessions; scheduler reconciles due/expired sessions on boot; clients
  auto-reconnect and `session:sync` restores their view.
- **Graceful degradation**: Redis adapter failure → in-memory fallback; AI
  provider failure → slides continue + fallback messaging.

Recommended infra: ≥2 app instances across AZs, Mongo replica set, managed Redis
with failover.

---

## 5. Security Review

Implemented: per-IP **rate limiting** (resolve/join/ask), **secure QR token**,
short-lived scoped JWTs, active-speaker-gated Q&A, single-session lock, full join
validation, **join-attempt logging**, input normalization + whitelists, proxy-aware
client IPs, header-based tokens (no CSRF surface).

Deployment-enforced: **HTTPS/WSS** termination + HTTP→HTTPS redirect, **CORS
allowlist** (`CORS_ORIGINS`), secrets via a secret store. Full checklist in
`GROUP_TRAINING_ENTERPRISE.md §6`.

Residual: add WAF/bot protection at the edge if the join URL is widely shared;
consider per-account (not just per-IP) limits behind shared NAT.

---

## 6. Monitoring Strategy

Structured JSON logs by category (`scheduler`, `lifecycle`, `join`, `qa`,
`socket`, `perf`, `error`). Five recommended dashboards: scheduler/leader health,
lifecycle funnel, join success/denial, error rate, performance (tick + socket
counts). Alerting: 0 active scheduler leaders > 2× TTL; error spikes on
`redis`/`scheduler`; abnormal join-denial rates. Details in
`GROUP_TRAINING_ENTERPRISE.md §5`.

---

## 7. Capacity Estimates (summary)

- **250 trainees / hall**: comfortable on a single 2 vCPU instance.
- **~1,000–1,500 active trainees**: 1 instance; beyond that add instances + Redis.
- **Scheduler**: single leader, sub-50ms ticks, independent of trainee count.
- **DB**: heartbeats dominate (~N/15 writes/s/hall); throttle / move to Redis at
  very high aggregate. Full report: `GROUP_TRAINING_CAPACITY.md`.

---

## 8. Remaining Risks

| Risk | Severity | Mitigation |
|---|---|---|
| AI provider latency/limits under many concurrent halls | Medium | Rate-limit agreements, retry/backoff, fallback messaging |
| Mongo write volume from heartbeats at extreme scale | Medium | Throttle heartbeats; Redis hot counters |
| Redis outage | Low–Med | Adapter failure falls back to in-memory (per-instance); restore Redis to re-link nodes |
| Floor timers lost on instance restart mid-Q&A | Low | State intact; host/next-speaker recovers; (future: persist floor deadline) |
| Widely-shared join URL abuse | Low–Med | Rate limiting + logging now; add WAF/account limits |
| In-session assessment/quiz UI not built | Low | Config present; feature pending (non-blocking) |

---

## 9. Final Go-Live Recommendation

**Status: ✅ GREEN — approved for enterprise, multi-instance, HA production.**

The system meets the enterprise objectives:
- Fully **autonomous** scheduled start **and** end, backend-owned, no operator or
  Hall Screen dependency.
- **Multi-instance** via Redis Socket.IO adapter; **HA** via leader-elected
  scheduler with automatic failover and durable state.
- **Secured** (rate limiting, secure tokens, validation, logging) and
  **observable** (structured logs + dashboards).
- **No change to the user experience or workflow** — all scaling features are
  additive and default-off where infra-dependent (`REDIS_URL`).

Pre-flight before production:
1. Provision managed **Redis** (set `REDIS_URL`) and **Mongo replica set**.
2. Enforce **HTTPS/WSS** + restrict **CORS_ORIGINS**; load secrets from a vault.
3. Set OS fd limits + LB WebSocket/idle timeouts.
4. Wire logs to your aggregator + create the five dashboards/alerts.
5. Run a load test at target hall size to validate provider + DB headroom.

Single-instance deployments remain fully supported with zero configuration.
