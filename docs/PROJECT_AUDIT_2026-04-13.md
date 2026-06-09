# Project Audit - 2026-04-13

## Audit Scope

- Workspace scanned from `D:\trainup`
- Excluded from detailed review: `.git`, `node_modules`, `dist`, `.vercel`, `.codex`
- Source/config/doc files scanned: `253`

## Executive Summary

This project is no longer a simple prototype. It already contains a substantial React/Vite admin app, a large trainer/reviewer workspace, a training launch player, a Vercel-style serverless API layer, and a separate Express backend intended for Render.

The main issue is not "missing UI". The main issue is architectural split and parity:

- The **frontend is broadly implemented**
- The **Express backend is fairly complete**
- The **Vercel serverless API is only partially complete**
- The project still contains **mock/browser-local fallbacks** for core flows
- Real **employee SSO is not implemented yet**

So the project is best described as:

- `UI/UX status`: strong and mostly built
- `feature status`: mostly built for admin/workspace flows
- `backend status`: usable in Express/Render mode
- `deployment parity status`: incomplete, because Vercel API mode does not match Express mode

## High-Level Structure

### Root

- `src/` - main React frontend
- `api/` - Vercel serverless API functions
- `backend/` - standalone Express backend for Render
- `docs/` - internal project documentation
- `public/` - static deployment files and SPA fallback assets
- `deploy/` - example deployment config
- `.github/` - CI workflow

### File Counts By Top-Level Directory

| Directory | Files |
|---|---:|
| `src` | 143 |
| `backend` | 43 |
| `api` | 27 |
| `public` | 8 |
| `docs` | 4 |
| `.github` | 1 |
| `deploy` | 1 |

## What Is Complete

## 1. Frontend Shell And Routing

Completed:

- App bootstrap with Redux, router, suspense loader, error boundary
- Protected/admin route structure
- Public role route structure
- Training launch route structure
- Shared layouts for auth, public, and admin shells

Key files:

- `src/App.tsx`
- `src/router.ts`
- `src/sub-routes/*`
- `src/layouts/*`

Assessment:

- This part is production-shaped and not just placeholder routing.

## 2. Admin Panel UI

Completed:

- Dashboard
- Clients list + create flow
- Client detail + section-based editing
- Users list + create/edit/delete
- Roles list + permission editing + role creation UI
- Settings tabs
- API keys UI
- Webhook settings UI
- iFrame configuration UI
- Profile editing UI

Key files:

- `src/routes/Dashboard.tsx`
- `src/routes/clients/Clients.tsx`
- `src/routes/clients/ClientDetail.tsx`
- `src/routes/users/Users.tsx`
- `src/routes/users/Roles.tsx`
- `src/routes/settings/Settings.tsx`
- `src/routes/integrations/ApiKeys.tsx`
- `src/routes/integrations/WebhookSettings.tsx`
- `src/routes/integrations/IframeConfiguration.tsx`
- `src/routes/profile/Profile.tsx`

Assessment:

- This is one of the strongest completed areas in the repo.
- The admin surface is real, not just a static theme conversion.

## 3. Permission And Access Model In Frontend

Completed:

- Permission constants
- Access-control utilities
- Permission-aware menu rendering
- Permission-blocked actions
- Permission matrix UI

Key files:

- `src/constant/accessControl.ts`
- `src/constant/permissions.ts`
- `src/constant/routePermissions.ts`
- `src/component/common/PermissionBlock.tsx`
- `src/component/common/PermissionMatrix.tsx`

Assessment:

- The app has a real RBAC-style frontend model.
- This is mature enough for real admin workflows.

## 4. Trainer/Reviewer Workspace UI

Completed:

- Shared workspace shell
- Dashboard for trainer/reviewer
- Training list
- Builder flow
- Detail view
- Review tab
- Session/report tabs
- Slide-level comments and review actions
- Profile panel inside workspace

Key files:

- `src/component/training-workspace/TrainingWorkspace.tsx`
- `src/component/training-workspace/TrainingSlideForm.tsx`
- `src/component/training-workspace/TrainingFormBuilderModal.tsx`
- `src/component/training-workspace/SlideMediaPreview.tsx`
- `src/component/training-workspace/ScriptAudioPlayer.tsx`
- `src/routes/trainer/TrainerWorkspacePanel.tsx`
- `src/routes/reviewer/ReviewerWorkspacePanel.tsx`

Assessment:

- Very substantial implementation.
- This is not a stub. It is a full authoring/review UI.

## 5. Media Import And Slide Processing

Completed:

- Image import
- PDF page extraction to images
- PPTX extraction to generated slide previews
- OCR extraction support
- IndexedDB storage fallback
- Remote S3 upload support
- Remote media resolve/delete helpers

Key files:

- `src/helper/slideMediaStore.ts`
- `src/helper/slideOcr.ts`
- `api/media/*`
- `backend/src/controllers/mediaController.js`

Assessment:

- This is a real feature area and one of the more advanced parts of the repo.

## 6. Training Launch Player

Completed:

- Slide navigation
- Audio narration playback
- Avatar runtime integration
- Ask-question flow
- Form submission inside launch
- Session progress updates
- Completion flow
- Preview/public mode logic

Key files:

- `src/routes/launch/TrainingLaunch.tsx`
- `src/component/launch/TrainingLaunchAvatar.tsx`
- `backend/src/controllers/launchController.js`

Assessment:

- The learner-side launch experience is broadly implemented.
- This is a major completed feature area.

## 7. Express Backend

Completed:

- Auth login/logout/profile
- Dashboard data
- Users CRUD
- Roles list/create/update
- Clients CRUD
- Tenant settings
- API keys CRUD
- Webhooks config
- iFrame config
- Training workspace sync
- Media signed upload flow
- Launch access/session/Q&A
- Narration generation
- TTS voice listing/verification/generation

Key files:

- `backend/server.js`
- `backend/src/routes/open.routes.js`
- `backend/src/routes/admin.routes.js`
- `backend/src/routes/super-admin.routes.js`
- `backend/src/controllers/*`

Assessment:

- The Express backend is the most complete backend implementation in the repo.
- If you want one backend to trust, this is the better candidate.

## 8. Deployment And Ops Basics

Completed:

- Vite production build
- SPA fallback configs for Vercel/Netlify/Apache/Nginx
- GitHub Actions build workflow
- Render backend config
- Environment templates and deployment docs

Key files:

- `vite.config.ts`
- `vercel.json`
- `netlify.toml`
- `public/_redirects`
- `public/.htaccess`
- `render.yaml`
- `.github/workflows/ci.yml`
- `DEPLOYMENT.md`
- `docs/SPA_DEPLOYMENT_GUIDE.md`

Assessment:

- The deployment groundwork is present.

## What Is Incomplete Or Partial

## 1. Vercel Serverless API Is Not At Parity With Express

This is the biggest project gap.

The app contains a Vercel catch-all API in:

- `api/[...route].js`

But it does **not** match the feature surface of the Express backend.

Missing or incomplete relative to the frontend/Express backend:

- no `GET /tenant-settings`
- no `PUT /tenant-settings/:section`
- no `GET /roles`
- no `POST /roles`
- no `PUT /roles/:id`
- no `PUT /profile`
- no `GET /tts/voices`
- no `POST /tts/verify`
- no `POST /narration`
- no `GET /launch/trainings/:id`
- no `POST /launch/trainings/:id/session`
- no `POST /launch/trainings/:id/ask`

Impact:

- If you deploy frontend + same-origin `api/` on Vercel and expect full product behavior, multiple flows will fail.
- The current docs suggest Vercel mode is a valid path, but actual API parity is incomplete.

Status:

- `Incomplete`

## 2. Frontend Still Has Mock And Browser-Local Persistence

The app still supports a fully mocked/browser-local mode:

- `src/helper/mockApi.ts`
- `src/helper/runtimeApi.ts`
- `src/redux/trainingWorkspaceSlice.ts`
- `src/helper/slideMediaStore.ts`

Current behavior:

- If `VITE_API_BASE_URL` is not set in dev, frontend falls back to local mock API
- Training workspace persists to `localStorage`
- Media can persist to IndexedDB

Impact:

- There are two sources of truth depending on environment
- Bugs can hide in mock mode and only appear against the real backend
- Product behavior is less predictable across environments

Status:

- `Partial`

## 3. Employee SSO Is Still Demo-Only

The employee entry experience is polished, but not real Samsung SSO.

Key file:

- `src/routes/employee/EmployeeSso.tsx`

Current behavior:

- Uses demo records from local constants
- Simulates verification
- Creates browser session state

Docs also confirm this:

- `backend/README.md`
- `DEPLOYMENT.md`
- `docs/BACKEND_BLUEPRINT.md`

Status:

- `Incomplete`

## 4. Old Demo Panels Still Exist Beside Real Workspace

There are two trainer/reviewer experiences:

- simple demo panels:
  - `src/routes/trainer/TrainerPanel.tsx`
  - `src/routes/reviewer/ReviewerPanel.tsx`
- real shared workspace:
  - `src/routes/trainer/TrainerWorkspacePanel.tsx`
  - `src/routes/reviewer/ReviewerWorkspacePanel.tsx`

Assessment:

- The real workspace is the serious implementation
- The smaller demo panels look legacy/demo-oriented
- They increase maintenance surface and product ambiguity

Status:

- `Partial / redundant`

## 5. Lint Is Not Clean

Validation result:

- `npm run lint` fails

Current blocking error:

- `src/component/launch/TrainingLaunchAvatar.tsx`

Additional warnings:

- `src/routes/launch/TrainingLaunch.tsx`

Main issue type:

- React hook dependency / memoization issues

Status:

- `Incomplete`

## 6. Automated Test Coverage Is Missing

Observed:

- no unit test suite
- no integration test suite
- no component tests
- CI only runs build

CI file:

- `.github/workflows/ci.yml`

Impact:

- Build can pass while functional regressions still ship
- Large workspace and launch flows are unprotected

Status:

- `Incomplete`

## 7. Documentation Is Inconsistent

Examples:

- root `README.md` is still the default Vite template and does not describe the real product
- backend blueprint says earlier repo state was local-only, but the repo has moved beyond that
- deployment docs describe Vercel mode as stronger than current API parity actually supports

Impact:

- New developers will get the wrong mental model
- Onboarding cost is higher than it should be

Status:

- `Partial`

## 8. Some Text Encoding Is Corrupted In UI Strings

Examples seen in source output:

- `Â·`
- `â€¢`
- `âœ“`

This appears in several UI strings.

Impact:

- Premium UI quality drops immediately
- Signals encoding inconsistencies in saved source files

Status:

- `Partial / cleanup needed`

## 9. Bundle Size Is Heavy

Build output shows several large chunks:

- `speech-engine` ~ `1.19 MB`
- `pdfjs` ~ `453 KB`
- `TrainingWorkspace` ~ `130 KB`
- `TrainingLaunch` uses multiple heavy runtime features
- CSS bundle is also large

Impact:

- Slower first load
- Heavier trainer/reviewer experience
- Mobile launch experience could degrade on weaker devices

Status:

- `Partial optimization needed`

## 10. Workspace Persistence Model Is Coarse

Current backend approach for workspace:

- syncs large training blobs through `/training-workspace/sync`

Assessment:

- Works for now
- But it is not a strong long-term shape for collaboration, versioning, conflict handling, or auditability

Status:

- `Functional but not mature`

## Feature-by-Feature Status

| Area | Status | Notes |
|---|---|---|
| App shell and routing | Complete | Strong routing/layout structure |
| Admin dashboard | Complete | Real UI and data loading |
| Client management | Complete in UI + Express | Serverless parity weak |
| User management | Complete in UI + Express | Serverless behavior simpler than UI model |
| Role management | Complete in UI + Express | Missing in serverless API |
| Tenant settings | Complete in UI + Express | Missing in serverless API |
| API keys | Complete | UI + Express + partial serverless |
| Webhooks/iFrame config | Complete | UI + Express + partial serverless |
| Profile editing | Partial | Works in Express, missing `PUT` in serverless |
| Trainer/reviewer workspace UI | Complete | Major feature is built |
| Training persistence | Partial | Works, but environment split remains |
| Media upload/resolve/delete | Complete | Good feature coverage |
| OCR/PDF/PPT processing | Complete | Advanced client-side implementation |
| Narration generation | Complete in Express path | Missing in serverless catch-all |
| TTS integration | Complete in Express path | Serverless has separate `api/tts.js`, but voice list/verify parity is missing |
| Launch player | Complete | Strong implementation |
| Employee SSO | Incomplete | Demo simulation only |
| Vercel same-origin backend mode | Incomplete | API parity gap |
| Render Express backend mode | Mostly complete | Best current deployment option |
| Automated tests | Incomplete | No coverage |
| Lint health | Incomplete | Failing |
| Documentation | Partial | Several docs are outdated/inconsistent |

## Validation Results

Run date:

- `2026-04-13`

### Frontend Build

Command:

- `npm run build`

Result:

- `Passed`

### Frontend Lint

Command:

- `npm run lint`

Result:

- `Failed`

Main issue:

- React compiler/manual memoization conflict in `src/component/launch/TrainingLaunchAvatar.tsx`

### Backend Check

Command:

- `cd backend && npm run check`

Result:

- `Passed`

## Important Architecture Findings

## 1. There Are Effectively Three App Modes

The repo currently supports:

1. Frontend-only mock mode
2. Frontend + Vercel serverless mode
3. Frontend + separate Express backend mode

Only mode `3` looks close to full-feature parity right now.

## 2. The Express Backend Should Be Treated As The Primary Backend

Reason:

- better route coverage
- more complete feature implementation
- launch/narration/TTS/admin flows are more coherent there

## 3. The Vercel API Layer Looks Like An Earlier/Alternate Backend Track

Reason:

- partial feature surface
- missing endpoints required by current frontend
- weaker parity with current product scope

## Recommended Next Steps

## Priority 1

- Pick one backend strategy as the source of truth
- Either:
  - finish `api/[...route].js` to full parity
  - or de-emphasize/remove Vercel API mode and standardize on `backend/`

## Priority 2

- Fix lint errors in:
  - `src/component/launch/TrainingLaunchAvatar.tsx`
  - `src/routes/launch/TrainingLaunch.tsx`

## Priority 3

- Replace root `README.md` with a real project README
- Document:
  - architecture
  - env setup
  - supported deployment paths
  - which backend is canonical

## Priority 4

- Decide whether mock mode remains intentional
- If yes:
  - document it clearly as a design/dev mode
- If no:
  - reduce fallback behavior and move toward one real data path

## Priority 5

- Implement real employee SSO
- This is the most obvious product-level incomplete area

## Priority 6

- Add tests for:
  - auth
  - client/user/role flows
  - training workspace persistence
  - launch session flow

## Final Assessment

This project is **not incomplete in the usual sense**. It already contains a lot of real product work.

The more accurate assessment is:

- **Frontend/product UI is largely complete**
- **Express backend is mostly complete**
- **Vercel API path is incomplete**
- **employee SSO is incomplete**
- **tooling quality gates are incomplete**
- **documentation is incomplete**

If you want the fastest route to a stable production-ready system, the best path is:

1. standardize on the Express backend
2. fix lint
3. clean docs
4. finish employee SSO
5. add tests

