# TrainUp ↔ External LMS Integration — Deep Research & Architecture

**Goal:** A customer uses their **own LMS** (Moodle, Canvas, Blackboard, TalentLMS, Docebo, SAP SuccessFactors, an in-house portal, etc.). They do **not** want to adopt the whole TrainUp platform — they just want the **trainings authored in TrainUp** to appear and be consumable **inside their LMS**, with completion/score data flowing back.

This document maps the real integration standards to **TrainUp's existing architecture**, recommends a phased plan, and covers how to add **video / iframe / web-embed training types** (today we only build PDF/PPT slide trainings).

---

## 1. What TrainUp already has (grounding)

These are the surfaces we build on — most integration work *reuses* them rather than starting from scratch.

| Capability | Where (code) | Notes |
|---|---|---|
| Multi-tenant clients | `Client` model, `clientId` everywhere | Each customer = one tenant. |
| **Public training launch link** | `GET /api-v1/launch/trainings/:id`, `routes/launch/TrainingLaunch.tsx`, `/slideshows/:id` | Already a self-contained, brandable player URL — the embed primitive. |
| **Branding endpoint** | `GET /api-v1/launch/trainings/:id/branding` | White-label per training. |
| **Demo / tokenized access** | `/demo/:demoToken/*` | Pattern for signed, scoped external access. |
| **Session + result capture** | `POST /launch/trainings/:id/session`, Ask mode, F&Q scoring, proctoring | The data an LMS wants back (completion, score, attention). |
| **Webhooks (signed)** | `helpers/clientDelivery.js` → `buildWebhookConfigPayload`, `sendWebhookTest`; headers `x-trainup-signature`, `x-trainup-event`; events array; signing secret | Already push events like `training.completed`. This is our "push to LMS" channel. |
| **API keys + scope** | `apiKeyController`, `Client.apiScope`, per-key `permission` (Read Only…) | Our "pull from LMS" channel auth. |
| **iFrame config** | `Client.iframeEnabled`, `iframeBaseUrl`, `iframeAllowedParentDomains`, `allowedOrigins` | Controls who may embed us — the security gate for embedding. |
| **SSO** | Google OIDC (`/auth/google`), Employee SSO (`/employee-sso`) | Basis for recognizing LMS learners. |
| **Flexible training content** | `Training.payload` is `Schema.Types.Mixed` | New content types (video/iframe) are **payload additions — no DB migration**. |

> Key insight: TrainUp is *already* an embeddable, brandable, event-emitting training player with per-tenant auth. LMS integration is mostly about **speaking the LMS's standard protocols on top of these primitives.**

---

## 2. The integration methods (deep dive)

There is no single "integrate with any LMS" switch — LMSs are heterogeneous. There are **5 industry-standard mechanisms**, used in combination. Below, each is explained + mapped to TrainUp.

### Method A — Embed / Deep Link (web link or iFrame) — *simplest, mostly already built*
- **What:** The LMS stores a **link** (or an `<iframe>`) to a TrainUp launch URL. The learner clicks it inside the LMS and the TrainUp player opens (inline or new tab).
- **How it works:** TrainUp issues a per-training (optionally per-learner, signed, expiring) URL. The LMS admin pastes it as an "External URL / Web Content" activity. We already have `/slideshows/:id` and `/demo/:demoToken`.
- **Identity:** pass learner identity via a **signed launch token** in the URL/JWT (never raw PII in query string) — mirrors our demo-token + handoff-code pattern.
- **Data back:** via **webhook** (Method E) on completion.
- **TrainUp work:** add a "signed external launch URL" generator (training id + learner id + clientId + exp, HMAC-signed) and a public resolve endpoint (like demo resolve). Honor `iframeAllowedParentDomains` for iframe embeds.
- **Pros:** works with *every* LMS (they all support a web link). Fastest to ship.
- **Cons:** tracking is one-way (webhook only) unless paired with LTI/xAPI; iframe has cookie/3rd-party-context caveats (see §6).

### Method B — **LTI 1.3** (Learning Tools Interoperability) — *the real standard for "my tool inside your LMS"*
- **What:** The IMS Global standard that Canvas, Moodle, Blackboard, Brightspace, Sakai, etc. all support. TrainUp becomes an **LTI Tool**; the customer's LMS is the **Platform**.
- **Sub-services:**
  - **LTI Resource Link launch** (OIDC-based): learner clicks the activity → LMS POSTs a signed `id_token` (JWT) → TrainUp verifies (JWKS) → opens the training as that learner. **Single sign-on + identity for free.**
  - **Deep Linking (Content-Item):** the LMS instructor opens TrainUp's "content picker", **selects a training authored in TrainUp**, and the LMS stores it as an activity. ← *this is exactly the user's "training I create here shows in their LMS".*
  - **AGS (Assignment & Grade Services):** TrainUp **pushes the score/completion back into the LMS gradebook** automatically.
  - **NRPS (Names & Roles):** TrainUp can read the LMS course roster.
- **TrainUp work:** implement the LTI 1.3 tool endpoints (OIDC login init, launch/redirect, JWKS, deep-link return, AGS score post). Store per-customer LTI registration (client_id, deployment_id, platform keyset URL, auth/token endpoints) — fits naturally in the `Client` integration settings + a new `LtiRegistration` model. Reuse our existing JWT/auth helpers.
- **Pros:** the **gold standard**; one implementation works across most enterprise/academic LMSs; gives SSO + content selection + grade passback in one protocol.
- **Cons:** most engineering effort; requires per-customer registration handshake.

### Method C — **SCORM 1.2 / 2004** (export a package the LMS hosts)
- **What:** Package a training as a **SCORM zip** (imsmanifest.xml + content). The customer **uploads it into their LMS**; the LMS hosts/plays it and tracks via the SCORM JS API (`cmi.core.lesson_status`, `cmi.core.score.raw`, etc.).
- **Two flavors:**
  1. **Fully offline package** — export the slides/quiz as self-contained HTML+JS (heaviest; loses AI Ask/live proctoring).
  2. **SCORM "wrapper/dispatch"** — a tiny SCORM package that just **iframes the live TrainUp player** and bridges completion/score to the SCORM API. Keeps all live features (AI, proctoring) while still being a normal SCORM upload. ← recommended.
- **TrainUp work:** a "Download SCORM package" export that emits the manifest + a wrapper `index.html` embedding `/slideshows/:id` and mapping our session-complete/score events to SCORM API calls.
- **Pros:** universally accepted by corporate LMSs; admin just uploads a file; no live registration.
- **Cons:** SCORM is old (no rich analytics); dispatch flavor still needs network to TrainUp.

### Method D — **xAPI (Tin Can) / cmi5** (modern tracking to an LRS)
- **What:** TrainUp sends learning **statements** ("Asha *completed* Patient-Safety with score 80, attention 92, asked 3 questions") to the customer's **LRS** (Learning Record Store) — many LMSs embed one, or it's standalone (Veracity, Learning Locker).
- **cmi5** = xAPI + a launch/packaging profile (the modern SCORM replacement; LMS launches content + receives xAPI).
- **TrainUp work:** an xAPI emitter that converts our session/quiz/proctoring/Ask data into statements and POSTs to the configured LRS endpoint (auth via Basic/OAuth). This is a natural extension of the **webhook layer**.
- **Pros:** captures the *rich* data TrainUp uniquely has (proctoring, AI Ask transcript, attention) — far beyond SCORM's pass/fail. Future-proof.
- **Cons:** customer must have an LRS / xAPI-capable LMS.

### Method E — **REST API + Webhooks** (custom / in-house LMS) — *mostly already built*
- **What:** For customers with a **custom/personal LMS** and no LTI/SCORM:
  - **Pull:** their LMS calls TrainUp's REST API (API key scoped per tenant) to **list trainings**, fetch metadata, get a launch URL: e.g. `GET /api/v1/trainings`, `GET /api/v1/trainings/:id`, `POST /api/v1/trainings/:id/launch-url {learnerId}`.
  - **Push:** TrainUp fires **signed webhooks** on `training.created`, `training.updated`, `training.completed`, `session.scored`, so their LMS stays in sync and records results. We already have the webhook engine + signature header.
- **TrainUp work:** publish a documented **public API surface** (read trainings, mint signed launch URL) gated by API keys + `apiScope`; expand the webhook **event catalog** (currently mainly completion) to include `training.created/updated/published`.
- **Pros:** total flexibility; ideal for bespoke/personal LMSs (the user's "may be they use their own personal LMS"). Reuses existing key + webhook infra.
- **Cons:** every customer integrates a little differently; we must ship clear API docs + SDK examples.

---

## 3. Method comparison

| Method | "Training shows in their LMS" | SSO/identity | Grade/score back | Rich analytics (proctor/AI) | Works with which LMS | TrainUp effort | Reuses existing |
|---|---|---|---|---|---|---|---|
| A. Embed / deep link | ✅ (as a link/iframe) | via signed token | webhook only | webhook only | **All** | **Low** | launch links, iframe cfg |
| B. LTI 1.3 | ✅ **native picker** | ✅ built-in | ✅ AGS | partial (+xAPI) | Canvas/Moodle/Blackboard/Brightspace/Sakai… | **High** | JWT/auth, Client settings |
| C. SCORM (dispatch) | ✅ (upload package) | learner = LMS user | ✅ cmi | partial | **Corporate LMSs** | Medium | launch player |
| D. xAPI / cmi5 | via launch profile | cmi5 launch | ✅ statements | ✅ **full** | xAPI/LRS-capable | Medium | webhook layer |
| E. REST API + Webhooks | ✅ (their LMS renders/links) | their SSO + our token | ✅ webhook | ✅ (custom) | **Custom / in-house** | Low–Med | API keys, webhooks |

---

## 4. Recommended phased roadmap (for TrainUp specifically)

**Phase 1 — Embed + Webhook bundle (weeks, reuses ~80% existing).** Most customers covered immediately.
- Signed external launch URL generator (training + learner + clientId + exp, HMAC) + public resolve endpoint (clone of demo-token flow).
- Honor `iframeAllowedParentDomains` / `allowedOrigins` for iframe embedding; set proper `Content-Security-Policy: frame-ancestors` and `X-Frame-Options` per tenant.
- Expand webhook events: `training.created`, `training.updated`, `training.published`, `session.completed`, `session.scored` (keep `x-trainup-signature` HMAC).
- Publish a **public REST API** (list/get trainings, mint launch URL) gated by API key + `apiScope`, with docs.
→ Covers **A + E**. Handles custom/personal LMSs and any LMS that accepts a web link.

**Phase 2 — SCORM dispatch export (medium).** One-click "Download SCORM package" that wraps the live player + bridges completion/score. Covers the large corporate-LMS base that "just wants an upload".

**Phase 3 — xAPI/cmi5 emitter (medium).** Convert our uniquely rich data (proctoring, AI Ask, attention, F&Q) to xAPI statements → LRS. Differentiator.

**Phase 4 — LTI 1.3 Tool (high, highest value for enterprise/EDU).** Deep Linking content picker + AGS grade passback + OIDC SSO. The "native inside your LMS" experience.

---

## 5. Adding **video / iframe / web-embed** training types

Today a training = slides from PDF/PPT (`Training.payload`). Because `payload` is `Schema.Types.Mixed`, **new content types are additive (no DB migration)** — work is in the **builder** and the **player**.

### 5.1 Model a slide "kind"
Extend each slide in `payload.slides[]` with a `kind`:
- `image` (current PDF/PPT-extracted) — unchanged.
- `video.upload` — an MP4 uploaded to **S3** (reuse `helpers/imageStorage` pattern → a `storeVideoFile`/`uploadPublicObject` for video; serve via S3 URL, optionally signed). Track watch progress (played %, completed).
- `video.embed` — YouTube/Vimeo/Loom by URL → render the provider's iframe/embed. Store provider + id.
- `iframe` / `web` — an arbitrary external URL rendered in a sandboxed `<iframe>` (e.g. an interactive doc, a 3D demo). Guard with `sandbox`, allow-list domains, and a "open in new tab" fallback for sites that block framing.
- `html` / `scorm-embedded` (future) — embed a packaged interactive.

### 5.2 Builder (`TrainingWorkspace`)
- Add a slide-type chooser in the builder: Upload Image | Upload Video | Embed Video (URL) | Web/iFrame (URL) | (existing PDF/PPT import stays).
- For video: upload → S3, generate poster/thumbnail, optional auto-transcript → feeds existing AI narration/question generation.
- For embed/iframe: URL input + validation + preview; store allowed flag.

### 5.3 Player (`TrainingLaunch` / slideshow)
- Render per `kind`: `<video>` for uploads (with progress + completion gating), provider embed for `video.embed`, sandboxed `<iframe>` for `web`.
- **Completion rules:** video slide completes at ≥X% watched; iframe slide completes on dwell-time or an explicit "Mark complete" (since we can't see inside a 3rd-party iframe).
- Knowledge-check/F&Q and proctoring continue to work around the new slide kinds.

### 5.4 How video/iframe trainings flow to the LMS
- **Embed/LTI/SCORM dispatch:** they wrap the **whole player**, so video/iframe slides "just work" inside the LMS automatically (no per-type LMS work).
- **SCORM fully-offline export:** video uploads can be bundled or referenced by S3 URL; external embeds require network — document the trade-off.
- **xAPI:** emit `played`/`completed` statements per video; `experienced` for web/iframe.

---

## 6. Security & cross-origin considerations (critical for embedding)

- **iFrame embedding:** modern browsers block 3rd-party cookies → an embedded TrainUp player may not see its own session. Mitigate with: token-in-launch (not cookie) auth (we already use bearer tokens, not session cookies), `SameSite=None; Secure` only where needed, and per-tenant `frame-ancestors` CSP from `iframeAllowedParentDomains`.
- **Signed launch URLs:** HMAC/JWT with short expiry + one-time/nonce (reuse the impersonation handoff + demo-token patterns). **Never** put learner PII in raw query strings.
- **Webhook security:** keep `x-trainup-signature` (HMAC of body with per-client signing secret); add timestamp + replay protection; document verification for the receiver.
- **API keys:** enforce per-key scope (`apiScope`) and per-tenant isolation (already `clientId`-scoped); rate-limit; rotate.
- **LTI 1.3:** verify platform `id_token` against the platform JWKS; validate `nonce`, `aud`, `deployment_id`; sign our own service calls with our keyset.
- **xAPI/LRS & SCORM dispatch:** auth the LRS endpoint (Basic/OAuth); scope statements to the tenant.
- **CORS:** drive `Access-Control-Allow-Origin` from `Client.allowedOrigins`.

---

## 7. Concrete next steps (smallest valuable slice first)

1. **Signed external launch URL + resolve endpoint** (clone demo-token flow) → instantly embeddable in *any* LMS as a web link/iframe.
2. **Webhook event catalog expansion** + a short **receiver guide** (signature verification sample) → results flow back to custom LMSs.
3. **Public REST API doc** (list/get trainings, mint launch URL) gated by API key + `apiScope`.
4. **Video + iframe slide kinds** in builder + player (payload-additive; S3 for uploads).
5. Then evaluate demand: **SCORM dispatch** (corporate) vs **LTI 1.3** (enterprise/EDU) vs **xAPI** (analytics-led) and build in that priority.

> Bottom line: TrainUp doesn't need a rewrite to integrate. Phase 1 (signed embed links + expanded webhooks + a documented API) reuses what's already here and covers customers who keep their **own/personal LMS**. LTI 1.3 and SCORM/xAPI are then added to meet the bigger enterprise and corporate LMS markets.
