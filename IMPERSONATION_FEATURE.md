# Secure Admin Impersonation — Implementation

Super Admin → Client Admin → User impersonation with full audit, signed-JWT
sessions, a one-time cross-app handoff, and a non-destructive restore flow.
The existing login/auth/permission system is untouched (all changes additive).

---

## 1. How it works (architecture)

The app ships as **two builds** (Super Admin app + Client app) with separate
token stores. To move between identities without logging out and without
putting a JWT in a URL, each transition uses a **single-use handoff code**:

```
[source app]  POST impersonate/restore  ──►  { handoffCode, targetRole }
              window.location → {targetApp}?imp=<handoffCode>
[target app]  POST /auth/impersonation/exchange { code } ──► { token }
              setAuthToken(token) → strip ?imp → normal /profile bootstrap
```

- The impersonation token is an ordinary **signed JWT** (`config.authSecret`),
  verified by the same `authTokenAdmin` middleware, with an extra `imp` claim:
  `{ rootId, rootRole, stack:[{appId,role,clientId}…], level, auditId }`.
- `req.user` always remains the **effective** identity, so existing permission
  checks work unchanged (you act *as* the target with the target's permissions).
- Token expiry: **2h** for impersonation tokens; restoring to the original
  issues a fresh normal session token.
- The handoff code is opaque, **single-use**, and expires in **60s**.

---

## 2. Endpoints

| Method | Route | Guard | Purpose |
|---|---|---|---|
| POST | `/api-v1/super-admin/impersonate/client/:clientId` | authTokenAdmin + `allowRoles("super_admin")` | FEATURE 1: SA → Client Admin |
| POST | `/api-v1/users/impersonate/:userId` | authTokenAdmin + `allowAccess("users.view")` + controller role check | FEATURE 2: Client Admin (or SA-as-CA) → User |
| POST | `/api-v1/auth/restore-session` | authTokenAdmin (no module perm) | FEATURE 3: pop one level / return |
| POST | `/api-v1/auth/impersonation/exchange` | public (single-use code) | cross-app token handoff |

`/profile` now also returns an `impersonation` context block (additive) so the
banner survives reloads.

---

## 3. Security rules enforced (FEATURE 5)

1. **Only Super Admin** can impersonate a Client Admin — route is `allowRoles("super_admin")`; a genuine SA can never itself be impersonated (the SA endpoint is unreachable with an `imp` token because its role would be `admin`).
2. **Only Client Admin** can impersonate Users — controller requires effective `role === "admin"`.
3. **SA impersonating a Client Admin can also impersonate Users** — allowed because the effective role is then `admin`, level 1, `rootRole==="super_admin"`.
4. **No user can impersonate anyone** — non-admin effective roles are rejected (403), verified live.
5. **Token expiry 2h**, signed JWT.
6. **Chain depth capped** at Super Admin → Client Admin → User. `impersonateUser` only proceeds when current level is 0 (genuine CA) or 1 with `rootRole==="super_admin"`; any other chain shape is rejected.
7. Same-client only (`target.clientId === actor.clientId`), no self-impersonation, no impersonating `super_admin`, target must be active.
8. Handoff code is single-use + 60s TTL; the JWT never appears in a URL.

---

## 4. Audit logging (FEATURE 4)

Collection **`ImpersonationAudit`** (`backend/src/models/ImpersonationAudit.js`):
`appId, actorId, actorRole, targetId, targetRole, clientId, action, rootId,
rootRole, level, startedAt, endedAt, ipAddress, userAgent` (+ transient handoff
fields). Actions logged:
`SUPER_ADMIN_LOGIN_AS_CLIENT_ADMIN`, `CLIENT_ADMIN_LOGIN_AS_USER`,
`SUPER_ADMIN_LOGIN_AS_USER`, `RESTORE_SESSION`. Start rows are closed
(`endedAt`) on restore.

---

## 5. Full file list changed

**Backend (new)**
- `backend/src/models/ImpersonationAudit.js`
- `backend/src/helpers/impersonation.js`
- `backend/src/controllers/impersonationController.js`

**Backend (edited, additive only)**
- `backend/src/middelwares/authTokenAdmin.js` — expose `req.tokenPayload` / `req.impersonation`
- `backend/src/controllers/authController.js` — `/profile` returns `impersonation` context
- `backend/src/routes/super-admin.routes.js` — SA→CA route
- `backend/src/routes/admin.routes.js` — user-impersonate + restore routes
- `backend/src/routes/open.routes.js` — public exchange route

**Frontend (new)**
- `src/helper/impersonationApi.ts`
- `src/component/common/ImpersonationHandoffGate.tsx`
- `src/component/common/ImpersonationBanner.tsx`

**Frontend (edited)**
- `src/App.tsx` — mount gate + banner
- `src/redux/authSlice.ts` — `impersonation` state
- `src/constant/interfaces.ts` — `AdminUser.impersonation`
- `src/routes/clients/Clients.tsx` — "Login as Client Admin" action + modal
- `src/routes/users/Users.tsx` — "Login as User" action + modal

---

## 6. Environment (cross-app redirects)

The redirect target is chosen from the frontend env URLs. In production (same
origin, different base paths) the defaults work. For local dev (two ports) set:

```
# Super Admin app build
VITE_ADMIN_APP_URL=http://localhost:5173/
VITE_SUPERADMIN_APP_URL=http://localhost:5174/
# Client app build — same two values
```

---

## 7. Manual test cases

> Verified live (CA→User cycle + all security guards). SA→CA requires a Super
> Admin login to exercise end-to-end in the browser.

1. **SA → Client Admin**: Super Admin app → Clients → row menu → *Login as Client Admin* → Continue. Lands in the client admin dashboard; amber **Impersonation Mode** banner shows "Logged in as admin: {name}" + *Return to Super Admin*.
2. **Return to Super Admin**: click the banner button → back in the Super Admin console, banner gone.
3. **Client Admin → User**: Client app → Users → *Login as User* icon → Continue → lands in that user's panel; banner shows *Return to Admin*. ✔ verified.
4. **SA → User (via CA)**: do #1, then in the client app do #3 → user panel, banner *Return to Admin*; one click returns to the **Client Admin**, a second click returns to **Super Admin**.
5. **Restore with no impersonation** → `400 This session is not impersonated`. ✔
6. **Self-impersonation** → `400`. ✔
7. **Missing user** → `404`. ✔
8. **A normal user tries to impersonate** → `403` (no user can impersonate). ✔
9. **Client Admin calls the SA endpoint** → `403`. ✔
10. **Handoff code reuse** → `400` (single-use). ✔
11. **Token expiry**: an impersonation token stops working after 2h (standard JWT exp).
12. **Audit**: each action writes an `ImpersonationAudit` row with actor/target/ip/userAgent; `RESTORE_SESSION` sets `endedAt`.

---

## 8. Non-breaking guarantees

- Normal login tokens have no `imp` claim → `req.impersonation = null` → `/profile.impersonation = null` → banner hidden. Existing auth, permissions, and sessions are unchanged.
- All middleware/profile edits are additive. `tsc --noEmit` passes; backend boots and serves all existing routes.
