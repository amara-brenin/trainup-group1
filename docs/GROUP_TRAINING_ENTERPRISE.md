# Group Training Hall — Enterprise Deployment Guide

Covers the multi-instance, highly-available configuration: Redis Socket.IO
adapter, distributed scheduler lock, automatic session ending, observability,
and security hardening. All features degrade gracefully — with **no env changes
the system runs exactly as the single-instance build**.

---

## 1. Configuration (environment variables)

### Scaling / HA
| Var | Default | Purpose |
|---|---|---|
| `REDIS_URL` | _(unset)_ | When set, enables the **Socket.IO Redis adapter** so multiple backend instances share rooms/broadcasts. Unset → single-instance in-memory adapter. e.g. `redis://:pass@host:6379` |
| `GROUP_SCHEDULER_TICK_MS` | `10000` | Scheduler poll interval. |
| `GROUP_SCHEDULER_LOCK_TTL_MS` | `30000` | Distributed-lock TTL. Must be > tick interval (holder renews each tick). |
| `GROUP_WAITING_LEAD_MS` | `3600000` | How early `scheduled → waiting` opens before start. |

### Logging
| Var | Default | Purpose |
|---|---|---|
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`. |
| `LOG_PRETTY` | `false` | `true` for human-readable lines (dev); default emits JSON. |

### Rate limiting (per IP)
| Var | Default | Endpoint |
|---|---|---|
| `RL_RESOLVE_MAX` / `RL_RESOLVE_WINDOW_MS` | `30` / `60000` | `GET /group/:token/resolve` |
| `RL_JOIN_MAX` / `RL_JOIN_WINDOW_MS` | `15` / `60000` | `POST /group/:id/join` |
| `RL_ASK_MAX` / `RL_ASK_WINDOW_MS` | `20` / `60000` | `POST /group/:id/ask` |

> `app.set("trust proxy", 1)` is already enabled so rate limits + client IPs work
> correctly behind a load balancer / reverse proxy.

---

## 2. Redis Socket.IO Adapter

**File:** `backend/src/socket/index.js` (`attachRedisAdapter`).

- When `REDIS_URL` is set, the server creates a pub/sub client pair and installs
  `@socket.io/redis-adapter`. Every `io.to(room).emit(...)` is fan-outed across
  all instances, so a trainee connected to instance A receives events produced by
  instance B (e.g. the scheduler running on instance C).
- **No duplicate broadcasts**: the adapter de-duplicates room delivery; each
  socket belongs to exactly one node and receives each event once.
- **Reconnect** continues to work: a reconnecting client may land on any node and
  still receive the `session:sync` snapshot + live deltas for its room.
- **Failure isolation**: adapter setup never crashes boot — on connection error
  it logs and falls back to the in-memory adapter (single-instance behavior).

Deployment notes:
- Use a managed Redis (ElastiCache / Memorystore / Upstash) reachable from all
  app instances.
- Configure the load balancer for WebSocket upgrades; sticky sessions are *not*
  required with the Redis adapter but reduce reconnect churn.

---

## 3. Distributed Scheduler Lock

**Files:** `backend/src/helpers/distributedLock.js`, `backend/src/models/Lock.js`,
`backend/src/socket/scheduler.js`.

Strategy — **Mongo-backed leader election** (no extra infra; uses the existing DB):
- A single `locks` document keyed `group-scheduler` holds `{ owner, expiresAt }`.
- Each instance ticks every `TICK_MS` and calls `acquire()`, an atomic
  `findOneAndUpdate` that wins the lock **only if** it is unowned, already ours,
  or **expired**. Only the winner runs scheduling work.
- The leader renews on every tick (owner == self short-circuit), extending
  `expiresAt`. If the leader **crashes**, it stops renewing; after `LOCK_TTL_MS`
  the lock is considered expired and the next instance to tick **takes over →
  automatic failover** (typically within one TTL window).
- Graceful shutdown (`SIGTERM`/`SIGINT`) releases the lock immediately for
  near-instant failover.

Why Mongo, not Redis: the scheduler ticks only every 10s, so lock churn is
negligible and reusing Mongo avoids making Redis a hard dependency. (If Redis is
already deployed for the adapter, a Redlock-based lock is a drop-in alternative.)

Safety: even without the lock, `startSession` is **atomic + idempotent**, so a
brief two-leader overlap during failover cannot double-start a session.

---

## 4. Automatic Session Ending

**File:** `backend/src/socket/scheduler.js` (step 3).

- Each tick, the leader finds `lifecycle: live` sessions with `endTime <= now`
  and calls `runtime.endSession(gsId, "scheduler-auto-end")`.
- `endSession` transitions `live → completed` (validated), **finalizes
  attendance** (active time, attendance %, completion status, `completionTime`),
  flattens results into `Training.payload.sessions`, and **broadcasts
  `session:ended`** to the room.
- Hall and trainee clients already react to `session:ended` → completion state.
- **Manual end remains** available (host "End Session" + admin "End"), acting as
  an override before `endTime`.

---

## 5. Observability & Monitoring

**File:** `backend/src/helpers/logger.js`. Structured JSON, one object per line.

### Format
```json
{"ts":"2026-06-06T16:00:00.000Z","level":"info","category":"lifecycle","msg":"session started","gsId":"gs-…","reason":"scheduler-auto-start"}
```

### Categories
| Category | Emits |
|---|---|
| `scheduler` | leader election (lock acquired/released), tick actions (`opened`/`started`/`ended`), idle ticks (debug), tick duration |
| `lifecycle` | every state transition (`from`,`to`,`reason`), session start, blocked transitions (warn) |
| `join` | join attempts (success/denied + reason) — also persisted to `session.joinLog[]` |
| `qa` | (reserved) question/answer events |
| `socket` | adapter mode, connection lifecycle |
| `perf` | tick durations, broadcast timings |
| `error` | adapter/lock/scheduler failures |

### Recommended dashboards
1. **Scheduler health** — count of `category=scheduler msg="lock acquired"` per
   instance (should be ~1 active leader); alert if 0 leaders for > 2× TTL.
2. **Lifecycle funnel** — transitions over time: scheduled → waiting → live →
   completed; alert on `blocked transition` (warn) spikes.
3. **Join success rate** — `category=join` success vs denied, by reason
   (not-assigned / at-capacity / dual-session / expired). Spike in denials =
   possible abuse or misconfiguration.
4. **Errors** — `level=error` rate by `category`; page on `redis` or `scheduler`.
5. **Performance** — scheduler tick `ms`, socket connection count per node.

Ship JSON logs to CloudWatch/Loki/Datadog; index on `category`, `level`, `gsId`.

---

## 6. Security Hardening — Checklist

| Item | Status | Notes |
|---|---|---|
| Rate limiting on public group endpoints | ✅ | `resolve`, `join`, `ask` (per-IP, env-tunable). |
| Secure QR token | ✅ | QR encodes a 192-bit random `qrToken`, not the session id. |
| Short-lived session tokens | ✅ | 12h scoped JWTs (host/trainee); ask gated to active speaker. |
| Single-session lock | ✅ | A trainee cannot be active in two sessions. |
| Join validation | ✅ | assigned + role + client + not-blocked + capacity + not-expired. |
| Join attempt logging | ✅ | `joinLog[]` + structured `join` logs. |
| Input validation | ✅ | `normalizeValue` on all inputs; numeric coercion on config; action/phase whitelists; message required. |
| Trust proxy for correct client IP | ✅ | `app.set("trust proxy", 1)`. |
| HTTPS / WSS enforcement | ⚙️ Deploy | Terminate TLS at the LB/ingress; redirect HTTP→HTTPS; serve WSS. App is proxy-aware. |
| Secure token handling | ✅ | Bearer tokens in `Authorization` header (not cookies) → no CSRF surface for group APIs. |
| CORS allowlist | ⚙️ Deploy | Set `CORS_ORIGINS` to known origins in production. |
| Secrets management | ⚙️ Deploy | `AUTH_SECRET`, `REDIS_URL`, provider keys via secret store, not source. |

### HTTPS/WSS enforcement (deployment)
- Terminate TLS at the ingress/ALB; forward `X-Forwarded-Proto`.
- Redirect HTTP→HTTPS at the edge; the Socket.IO client auto-upgrades to WSS on
  an HTTPS origin (the frontend derives the socket origin from the API base URL).
- Restrict `CORS_ORIGINS` and the Socket.IO CORS to production domains.
