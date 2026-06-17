# Trainup Backend Blueprint

This document defines the recommended backend blueprint for converting the current browser-local Trainup prototype into a real dynamic system.

Scope:
- trainer create/edit workflow
- reviewer review/comment/approve workflow
- employee SSO access and session tracking
- admin user/role/permission management
- future-safe multi-client expansion

Current repo state:
- frontend is dynamic only inside the browser
- training records are stored in Redux + `localStorage`
- slide media is stored in IndexedDB
- real backend currently exists only for ElevenLabs TTS in `api/tts.js`

This blueprint replaces local-only persistence with a real API + database + object storage design.

## 1. Product Rules Locked

### Roles
- `admin`
  - full access
  - manages users, roles, permissions, access toggles, platform configuration
- `trainer`
  - creates trainings
  - edits any training fields inside assigned training records
  - responds to reviewer comments
  - resolves comments
  - resubmits for review
  - cannot manage users/roles
- `reviewer`
  - sees available review-ready trainings
  - adds slide-level and thread-level comments
  - requests changes
  - approves training
- `employee`
  - accesses training through direct link
  - authenticates through client SSO
  - resumes from last progress point
  - must complete all required slides/forms/quiz pass criteria for completion

### Review Rules
- training becomes live only after `approved`
- current approval rule: any one reviewer approval is sufficient
- future-safe requirement: support later expansion to multiple required approvals without schema rewrite
- current versioning rule: same training record is overwritten, no historical version copies

### Employee Completion Rules
- employee resumes from last slide
- training is complete only when:
  - required slides are completed
  - required forms / feedback are submitted
  - quiz pass criteria is met
- in-progress state shows progress percentage
- completed state unlocks final report

### Reporting Rules
- report visible only after completion
- report should include:
  - slide-by-slide attention score
  - anomalies
  - FAQ result
  - Ask Question to AI transcription
  - quiz result

### Storage Rules
- object storage: AWS S3
- upload max file size: `50 MB`
- preserve:
  - original uploaded file
  - extracted slide assets

## 2. Recommended Stack

This is the recommended production-safe baseline unless infrastructure decisions change later.

### Application
- frontend: current Vite + React app
- backend: Node.js + TypeScript API
- runtime style:
  - Vercel-compatible API routes if the chosen deployment stays serverless-friendly
  - or a separate Node service with the same route contract

### Persistence
- relational DB: PostgreSQL
- object storage: AWS S3

### Why PostgreSQL
- role/permission management is relational
- training review assignments are relational
- employee sessions and progress reporting are relational
- multi-client expansion is easier to model cleanly
- approval rules and permission overrides fit SQL better than a document-first shape

## 3. High-Level Architecture

```text
Frontend (React/Vite)
  -> Auth API
  -> Training API
  -> Review API
  -> Reporting API
  -> Media API
  -> TTS / AI integration API

Backend API (Node + TypeScript)
  -> PostgreSQL
  -> S3
  -> ElevenLabs
  -> Client SSO provider
  -> Optional AI/transcription provider
```

### Core backend modules
- `auth`
- `users`
- `roles`
- `permissions`
- `trainings`
- `slides`
- `media-assets`
- `reviews`
- `training-assignments`
- `training-sessions`
- `reports`
- `ai-transcripts`
- `audit-logs`

## 4. Multi-Tenancy Direction

Current business target is Trainup only, but future multi-client support is likely.

Recommended approach:
- build from day one with a `tenant` layer
- current Trainup deployment can run as a single tenant
- later clients can be added without schema rebuild

### Tenant strategy
- every business record references `tenant_id`
- internal roles and permissions are evaluated within tenant scope
- employee SSO config is tenant-specific
- S3 media paths are tenant-scoped

## 5. Authorization Model

Use a hybrid authorization model:
- role-based default permissions
- per-user permission overrides

### Base entities
- `roles`
- `permissions`
- `role_permissions`
- `user_permission_overrides`

### Why this matters
- admin can give default trainer/reviewer behavior by role
- admin can still enable special permissions for specific users
- example:
  - a reviewer can be granted `training.edit`
  - a trainer can be denied `training.publish`

### Permission evaluation order
1. load user role
2. load role permissions
3. load user-specific overrides
4. apply explicit deny first
5. apply explicit allow next
6. compute effective permissions

### Initial permission catalogue
- `dashboard.view`
- `users.view`
- `users.create`
- `users.edit`
- `users.delete`
- `roles.view`
- `roles.create`
- `roles.edit`
- `roles.delete`
- `permissions.view`
- `permissions.edit`
- `training.view`
- `training.create`
- `training.edit`
- `training.delete`
- `training.submit_review`
- `training.review`
- `training.comment`
- `training.resolve_comment`
- `training.request_changes`
- `training.approve`
- `training.publish`
- `training.assign_employee`
- `training.session_view`
- `training.report_view`
- `media.upload`
- `media.replace`
- `media.delete`
- `ai.ask_view`
- `ai.ask_export`
- `settings.view`
- `settings.edit`

## 6. Authentication Model

### Internal users
Used by:
- admin
- trainer
- reviewer

Recommended auth:
- email + password
- JWT access token + refresh token or secure session cookies
- password hashing with Argon2 or bcrypt

### Employee users
Used by:
- learners who access training via direct link

Recommended auth:
- client-provided Trainup SSO
- SSO handshake validates employee identity before access
- direct training link carries a unique access token or training assignment token
- SSO identity is mapped to employee session access

### Required SSO inputs later
- provider type: `SAML` or `OIDC`
- issuer / metadata URL
- client ID / entity ID
- callback URL
- logout URL
- claims mapping:
  - `employee_id`
  - `email`
  - `name`
  - `department`
  - optional `tenant_id`

## 7. Data Model

Below is the recommended logical schema. Field names may be adjusted during implementation, but structure should remain.

## 7.1 Core organization tables

### `tenants`
- `id`
- `name`
- `slug`
- `status`
- `primary_color`
- `secondary_color`
- `logo_url`
- `created_at`
- `updated_at`

### `tenant_sso_configs`
- `id`
- `tenant_id`
- `provider_type`
- `entity_id`
- `issuer`
- `metadata_url`
- `client_id`
- `client_secret_encrypted`
- `login_url`
- `logout_url`
- `callback_path`
- `claim_employee_id`
- `claim_email`
- `claim_name`
- `claim_department`
- `is_active`
- `created_at`
- `updated_at`

## 7.2 User / access tables

### `users`
- `id`
- `tenant_id`
- `name`
- `email`
- `password_hash`
- `status`
- `last_login_at`
- `created_at`
- `updated_at`

### `roles`
- `id`
- `tenant_id`
- `name`
- `key`
- `description`
- `is_system_role`
- `created_at`
- `updated_at`

### `permissions`
- `id`
- `key`
- `description`
- `module`
- `created_at`

### `role_permissions`
- `id`
- `role_id`
- `permission_id`
- `is_allowed`

### `user_roles`
- `id`
- `user_id`
- `role_id`

### `user_permission_overrides`
- `id`
- `user_id`
- `permission_id`
- `is_allowed`
- `reason`
- `created_by`
- `created_at`

## 7.3 Training authoring tables

### `trainings`
- `id`
- `tenant_id`
- `title`
- `type`
- `audience`
- `trainer_user_id`
- `status`
- `approval_mode`
- `required_approvals`
- `approved_count`
- `created_at`
- `updated_at`
- `submitted_at`
- `approved_at`
- `published_at`
- `last_activity_at`

Notes:
- `status` initial values:
  - `draft`
  - `review`
  - `changes_requested`
  - `approved`
- `approved` is currently live
- keep `required_approvals` now even if default is `1`

### `training_settings`
- `training_id`
- `avatar_name`
- `avatar_id`
- `tts_mode`
- `tts_provider`
- `tts_voice_name`
- `tts_voice_id`
- `question_button_label`
- `presenter_notes`
- `duration_mins`
- `max_duration_mins`
- `idle_refresh_mins`
- `allow_skip_ahead`
- `show_progress_bar`
- `show_subtitles`
- `disable_previous_button`
- `enable_review_mode`
- `mark_answers_in_real_time`
- `show_marks_in_progress_bar`
- `show_final_score`
- `theme_payload_json`

### `training_slides`
- `id`
- `training_id`
- `sort_order`
- `title`
- `script`
- `additional_info`
- `media_asset_id`
- `is_required`
- `created_at`
- `updated_at`

### `slide_settings`
- `slide_id`
- `avatar_position`
- `form_position`
- `desktop_respect_safe_area`
- `desktop_sizing`
- `mobile_respect_safe_area`
- `mobile_sizing`
- `wait_for_audio`
- `wait_for_video`
- `auto_advance_delay_ms`
- `disable_auto_advance`
- `hide_pause_button`
- `hide_ask_question_button`
- `hide_previous_button`
- `hide_autoplay_button`
- `avatar_initiates_conversation`

### `slide_forms`
- `id`
- `slide_id`
- `wait_for_submit`
- `require_correct`
- `limit_submissions`
- `submission_limit`
- `on_correct_slide_id`
- `on_incorrect_slide_id`
- `timer`
- `created_at`
- `updated_at`

### `slide_form_fields`
- `id`
- `slide_form_id`
- `sort_order`
- `type`
- `label`
- `required`
- `placeholder`
- `options_json`
- `help_text`
- `table_col`
- `unique_val`
- `correct_answer`
- `cols_json`
- `min_value`
- `max_value`
- `max_rating`

### `training_quizzes`
- `id`
- `training_id`
- `pass_percentage`
- `max_attempts`
- `created_at`
- `updated_at`

### `quiz_questions`
- `id`
- `quiz_id`
- `sort_order`
- `question`
- `type`
- `options_json`
- `correct_answer_json`
- `points`

## 7.4 Media storage tables

### `media_assets`
- `id`
- `tenant_id`
- `training_id`
- `slide_id`
- `kind`
- `source_type`
- `original_file_name`
- `mime_type`
- `file_size_bytes`
- `s3_bucket`
- `s3_key`
- `public_url`
- `page_number`
- `extracted_from_asset_id`
- `checksum`
- `created_by`
- `created_at`

Kinds:
- `original_upload`
- `slide_image`
- `generated_audio`
- `thumbnail`

Source types:
- `image`
- `pdf`
- `pptx`
- `pdf_page`
- `ppt_slide`

### Storage behavior
- upload original file to S3
- extract slide previews/pages
- store each extracted slide asset separately
- link extracted assets back to original upload

## 7.5 Review workflow tables

### `review_assignments`
- `id`
- `training_id`
- `reviewer_user_id`
- `status`
- `assigned_by`
- `assigned_at`
- `completed_at`

### `review_comments`
- `id`
- `training_id`
- `slide_id`
- `author_user_id`
- `author_role`
- `parent_comment_id`
- `comment_text`
- `status`
- `resolved_by`
- `resolved_at`
- `created_at`
- `updated_at`

Status:
- `open`
- `resolved`

### `review_decisions`
- `id`
- `training_id`
- `reviewer_user_id`
- `decision`
- `note`
- `created_at`

Decision:
- `changes_requested`
- `approved`

Why this is future-safe:
- today: one reviewer approval is enough
- later: count `approved` decisions against `required_approvals`

## 7.6 Employee assignment and session tables

### `employees`
- `id`
- `tenant_id`
- `sso_employee_id`
- `email`
- `name`
- `department`
- `status`
- `created_at`
- `updated_at`

### `training_assignments`
- `id`
- `tenant_id`
- `training_id`
- `employee_id`
- `access_token`
- `status`
- `assigned_at`
- `expires_at`
- `started_at`
- `completed_at`

Status:
- `assigned`
- `in_progress`
- `completed`
- `expired`

### `training_sessions`
- `id`
- `training_assignment_id`
- `employee_id`
- `training_id`
- `current_slide_order`
- `progress_percent`
- `status`
- `started_at`
- `last_activity_at`
- `completed_at`
- `quiz_passed`
- `quiz_score`
- `attention_score`
- `anomaly_count`

### `slide_progress`
- `id`
- `training_session_id`
- `slide_id`
- `status`
- `time_spent_seconds`
- `attention_score`
- `anomaly_json`
- `started_at`
- `completed_at`

### `form_submissions`
- `id`
- `training_session_id`
- `slide_id`
- `payload_json`
- `submitted_at`

### `quiz_attempts`
- `id`
- `training_session_id`
- `quiz_id`
- `attempt_no`
- `score_percentage`
- `passed`
- `submitted_at`

### `faq_sessions`
- `id`
- `training_session_id`
- `question`
- `answer`
- `created_at`

### `ask_ai_transcripts`
- `id`
- `training_session_id`
- `slide_id`
- `prompt`
- `response`
- `created_at`

## 7.7 Reporting and audit tables

### `training_reports`
- `id`
- `training_session_id`
- `employee_id`
- `training_id`
- `completion_status`
- `progress_percent`
- `quiz_score`
- `quiz_passed`
- `attention_summary_json`
- `anomaly_summary_json`
- `faq_summary_json`
- `ask_ai_summary_json`
- `generated_at`

### `audit_logs`
- `id`
- `tenant_id`
- `actor_user_id`
- `entity_type`
- `entity_id`
- `action`
- `before_json`
- `after_json`
- `created_at`

Critical audit events:
- user created
- role changed
- permission override changed
- training submitted
- comment resolved
- training approved
- training completed

## 8. Status Machine

### Training lifecycle
```text
draft
  -> review
  -> changes_requested
  -> approved
```

### Allowed transitions
- `draft -> review`
- `review -> changes_requested`
- `review -> approved`
- `changes_requested -> review`
- `approved -> draft` only if admin explicitly allows post-live edit workflow later

Current recommendation:
- keep approved record live
- trainer editing an approved training should be restricted unless product rules explicitly allow reopening

## 9. API Contract

Use REST initially because current frontend structure already maps well to resource routes.

## 9.1 Auth APIs

### Internal auth
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`
- `GET /api/auth/me`

### Employee SSO
- `GET /api/sso/training-access/:accessToken`
- `POST /api/sso/login`
- `POST /api/sso/callback`
- `POST /api/sso/logout`

Behavior:
- direct link loads assignment metadata
- SSO verifies employee identity
- backend maps employee to assignment
- active session starts or resumes

## 9.2 User / role / permission APIs

- `GET /api/users`
- `POST /api/users`
- `GET /api/users/:id`
- `PUT /api/users/:id`
- `DELETE /api/users/:id`

- `GET /api/roles`
- `POST /api/roles`
- `PUT /api/roles/:id`
- `DELETE /api/roles/:id`

- `GET /api/permissions`
- `GET /api/users/:id/effective-permissions`
- `PUT /api/users/:id/permission-overrides`
- `PUT /api/roles/:id/permissions`

## 9.3 Training authoring APIs

- `GET /api/trainings`
- `POST /api/trainings`
- `GET /api/trainings/:id`
- `PUT /api/trainings/:id`
- `DELETE /api/trainings/:id`
- `POST /api/trainings/:id/submit-review`
- `POST /api/trainings/:id/request-changes`
- `POST /api/trainings/:id/approve`

### Slide APIs
- `POST /api/trainings/:id/slides`
- `PUT /api/trainings/:id/slides/:slideId`
- `DELETE /api/trainings/:id/slides/:slideId`
- `PUT /api/trainings/:id/slides/reorder`

### Form / quiz APIs
- `PUT /api/trainings/:id/slides/:slideId/form`
- `PUT /api/trainings/:id/quiz`

## 9.4 Review APIs

- `GET /api/trainings/review-queue`
- `POST /api/trainings/:id/review-assignments`
- `GET /api/trainings/:id/comments`
- `POST /api/trainings/:id/comments`
- `POST /api/trainings/:id/comments/:commentId/reply`
- `POST /api/trainings/:id/comments/:commentId/resolve`
- `POST /api/trainings/:id/review-decisions`

## 9.5 Media APIs

- `POST /api/media/upload`
- `POST /api/media/extract/pdf`
- `POST /api/media/extract/pptx`
- `POST /api/media/:id/replace`
- `DELETE /api/media/:id`
- `GET /api/media/:id`

Recommended media upload flow:
1. frontend requests signed upload target
2. file uploads to S3
3. backend stores metadata
4. extraction job or synchronous process creates slide assets
5. extracted assets are linked to training slides

## 9.6 Employee session APIs

- `GET /api/assignments/:accessToken`
- `POST /api/assignments/:accessToken/start`
- `POST /api/sessions/:sessionId/resume`
- `POST /api/sessions/:sessionId/slide-progress`
- `POST /api/sessions/:sessionId/form-submit`
- `POST /api/sessions/:sessionId/quiz-submit`
- `POST /api/sessions/:sessionId/faq`
- `POST /api/sessions/:sessionId/ask-ai`
- `GET /api/sessions/:sessionId/report`

## 10. Frontend Integration Changes Required

To make the current app truly dynamic, these local-only systems need replacement.

### Replace browser-local training store
Current:
- [trainingWorkspaceSlice.ts](D:/trainup/src/redux/trainingWorkspaceSlice.ts)

Future:
- async thunks or RTK Query calling real APIs
- backend becomes source of truth
- `localStorage` no longer stores training records

### Replace local media storage
Current:
- [slideMediaStore.ts](D:/trainup/src/helper/slideMediaStore.ts)

Future:
- S3-backed upload and retrieval
- IndexedDB only optional for client-side temporary previews

### Replace admin mock API
Current:
- [mockApi.ts](D:/trainup/src/helper/mockApi.ts)

Future:
- real `/api/users`
- `/api/roles`
- `/api/permissions`
- `/api/trainings`

## 11. Validation Rules

### Upload validation
- allow only supported media types
- max size `50 MB`
- reject unsupported extensions
- validate content type server-side, not only client-side

### Training validation
- title required
- audience required
- trainer required
- at least one slide required
- approve only if:
  - no blocking reviewer comments remain open, if this rule is enabled
  - required slide content exists
  - quiz configuration is valid when quiz is required

### Session validation
- employee must match assignment and tenant
- assignment token must be active and not expired
- completion only if all required steps are satisfied

## 12. Reporting Logic

### In progress
- show progress percent from `slide_progress`
- no final report yet

### Completed
- generate `training_reports` record
- show:
  - completion timestamp
  - quiz score / pass status
  - slide-by-slide attention score
  - anomaly summary
  - FAQ summary
  - Ask AI transcript summary

## 13. Review Queue Logic

Current product rule:
- any single reviewer can approve

Schema should still support:
- many reviewers assigned
- multiple comments from multiple reviewers
- later expansion to `required_approvals > 1`

Suggested review queue logic today:
- `review` status trainings appear to reviewers
- any reviewer with `training.review` can comment
- first valid `approved` decision transitions training to `approved`

Suggested future extension:
- do not set training `approved` until:
  - `approved_count >= required_approvals`

## 14. File Storage Design

### S3 object key pattern
- `tenants/{tenantId}/trainings/{trainingId}/original/{assetId}-{fileName}`
- `tenants/{tenantId}/trainings/{trainingId}/slides/{slideId}/{assetId}.png`
- `tenants/{tenantId}/trainings/{trainingId}/audio/{slideId}/{assetId}.mp3`

### Keep both
- original uploaded file
- extracted slide assets

### Why
- reprocessing later
- auditability
- downstream export/rebuild use cases

## 15. Suggested Backend Folder Structure

```text
backend/
  src/
    config/
    modules/
      auth/
      users/
      roles/
      permissions/
      trainings/
      slides/
      media/
      reviews/
      assignments/
      sessions/
      reports/
      ai/
      audit/
    middleware/
    lib/
    db/
      migrations/
      schema/
      repositories/
    types/
    app.ts
    server.ts
```

If deployed as Vercel functions, route handlers can still map to the same module/service structure.

## 16. Recommended Implementation Phases

### Phase 1
- internal auth
- users / roles / permissions
- real training CRUD
- real review comments and approval

### Phase 2
- S3 media upload
- original + extracted slide storage
- training session persistence
- employee SSO entry flow

### Phase 3
- quiz / form completion logic
- progress resume
- completed reports
- Ask AI transcript persistence

### Phase 4
- multi-approver workflow
- multi-tenant rollout
- advanced analytics

## 17. Current Known Open Decisions

These are not blockers for blueprinting, but they are still needed before final implementation.

- final database choice confirmation
- final backend deployment target confirmation
- Trainup SSO technical protocol details
- whether approved trainings can later be reopened and edited directly
- whether reviewer approval should be limited to assigned reviewers only

## 18. Recommended Next Deliverables

Before coding the real backend, create these implementation documents:
- `ERD`
- `permissions matrix`
- `training lifecycle state chart`
- `employee SSO flow chart`
- `API contract spec`
- `S3 upload/extraction workflow`

This blueprint should be treated as the base source of truth for backend implementation.
