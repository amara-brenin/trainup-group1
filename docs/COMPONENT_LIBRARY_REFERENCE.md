# Trainup Component Library Reference

This file documents the current reusable component surface exactly as it exists in the project today.

Scope:
- reusable React components in `src/component`
- shell/layout components in `src/layouts`
- route-level composition patterns that future modules should follow

Out of scope:
- redesigning styles
- introducing new primitives
- replacing existing CSS architecture

## 1. Styling Pattern Used

Current styling system:
- Global CSS theme files imported in [App.tsx](D:/trainup/src/App.tsx)
- Base theme and utility styling from:
  - [app.min.css](D:/trainup/src/assets/css/app.min.css)
  - [icons.min.css](D:/trainup/src/assets/css/icons.min.css)
  - [custom.css](D:/trainup/src/assets/css/custom.css)
  - [samsung-lms.css](D:/trainup/src/assets/css/samsung-lms.css)
  - [design-system.css](D:/trainup/src/assets/css/design-system.css)

Styling approach:
- React + TypeScript components
- Bootstrap class system and theme variables (`--ct-*`)
- custom semantic CSS classes:
  - `admin-*`
  - `training-*`
  - `employee-*`
  - `action-dropdown-*`
  - `ds-*`
- no Tailwind
- no styled-components
- no CSS modules

Icon system:
- Remix Icons (`ri-*`) for shell, navigation, workspace chrome
- Bootstrap Icons (`bi-*`) for CRUD, table actions, modal actions, field builder, status affordances

## 2. Naming Conventions

Component file naming:
- PascalCase component files, for example `Navbar.tsx`, `TrainingWorkspace.tsx`

Component families:
- `common/`: shared shell and reusable UI
- `training-workspace/`: trainer/reviewer feature components
- `layouts/`: route shell wrappers

CSS naming already in use:
- `admin-*`: admin dashboards, settings, list pages
- `training-*`: training builder, slide media, form builder, review flow
- `employee-*`: employee SSO portal and access flow
- `action-dropdown-*`: row action dropdown pattern
- `ds-*`: extracted reusable design-system layer

## 3. Reusable Layout Structure

### Protected Admin Shell
- `wrapper`
- `Navbar`
- `Sidebar`
- `content-page`
- `content`
- `container-fluid`
- `BreadCrumb`
- page content
- `Footer`

Primary files:
- [MainLayout.tsx](D:/trainup/src/layouts/MainLayout.tsx)
- [Navbar.tsx](D:/trainup/src/component/common/Navbar.tsx)
- [Sidebar.tsx](D:/trainup/src/component/common/Sidebar.tsx)
- [BreadCrumb.tsx](D:/trainup/src/component/common/BreadCrumb.tsx)
- [Footer.tsx](D:/trainup/src/component/common/Footer.tsx)

### Auth / Public Shell
- `account-pages`
- `container`
- route content
- `Footer`

Primary files:
- [AuthLayout.tsx](D:/trainup/src/layouts/AuthLayout.tsx)
- [PublicLayout.tsx](D:/trainup/src/layouts/PublicLayout.tsx)

### Trainer / Reviewer Shell
- same admin-style `wrapper`
- custom role topbar and sidebar
- `content-page`
- `container-fluid`
- `Footer`

Primary file:
- [RoleWorkspaceShell.tsx](D:/trainup/src/component/common/RoleWorkspaceShell.tsx)

## 4. Component Inventory

## 4.1 Application / Layout Components

### `ErrorBoundary`
- File: [ErrorBoundary.tsx](D:/trainup/src/component/common/ErrorBoundary.tsx)
- Purpose: catches runtime render errors and shows a project-standard fallback card
- Props:
```ts
type Props = {
  children: ReactNode;
}
```
- Styling pattern:
  - Bootstrap utility layout classes
  - `admin-error-card`
  - `admin-error-icon`
- Variants / states:
  - `hasError = false`: render children
  - `hasError = true`: render fallback state
- Reuse when:
  - wrapping top-level app or unstable feature boundaries

### `ProviderCustom`
- File: [ProviderCustom.tsx](D:/trainup/src/layouts/ProviderCustom.tsx)
- Purpose: loads app settings and applies HTML theme attributes
- Props:
```ts
{
  children: ReactNode;
}
```
- Styling pattern:
  - no visual output of its own
  - uses `Loader` during bootstrap
- Variants / states:
  - loading
  - ready
- Reuse when:
  - app-level providers need to set theme metadata and fetch global settings

### `ThemeSettingsProvider`
- File: [ThemeSettingsProvider.tsx](D:/trainup/src/component/common/ThemeSettingsProvider.tsx)
- Purpose: alternate helper to sync Redux theme state into HTML attributes
- Props:
```ts
PropsWithChildren
```
- Styling pattern:
  - no visual output
- Variants / states:
  - driven by Redux theme state
- Reuse note:
  - available, but current app bootstrap is using `ProviderCustom`

### `AuthLayout`
- File: [AuthLayout.tsx](D:/trainup/src/layouts/AuthLayout.tsx)
- Purpose: login-only route shell with session redirect handling
- Props:
  - none directly, renders nested routes via `Outlet`
- Styling pattern:
  - `account-pages`
  - Bootstrap spacing utilities
- Variants / states:
  - checking profile
  - authenticated redirect
  - auth page shell

### `PublicLayout`
- File: [PublicLayout.tsx](D:/trainup/src/layouts/PublicLayout.tsx)
- Purpose: simple public route shell
- Props:
  - none directly, renders nested routes via `Outlet`
- Styling pattern:
  - same `account-pages` shell as auth pages

### `MainLayout`
- File: [MainLayout.tsx](D:/trainup/src/layouts/MainLayout.tsx)
- Purpose: protected admin shell
- Props:
  - none directly, renders nested routes via `Outlet`
- Styling pattern:
  - wrapper/topbar/sidebar/content/footer shell
- Variants / states:
  - loading
  - unauthorized redirect
  - permission-blocked route
  - mobile offcanvas backdrop

## 4.2 Shared Shell Components

### `Navbar`
- File: [Navbar.tsx](D:/trainup/src/component/common/Navbar.tsx)
- Purpose: admin topbar with branding, notifications, theme toggle, fullscreen, credits, user menu
- Props:
  - none
- Data source:
  - Redux `settings`, `admin`, `theme`
- Styling pattern:
  - `navbar-custom`
  - `topbar`
  - Bootstrap utility classes
  - Remix icons
- Variants / states:
  - light / dark theme icon
  - responsive sidebar-size behavior
  - unread notification badge

### `Sidebar`
- File: [Sidebar.tsx](D:/trainup/src/component/common/Sidebar.tsx)
- Purpose: admin left navigation
- Props:
  - none
- Data source:
  - Redux `settings`, `admin`
  - `adminMenu` configuration
- Styling pattern:
  - `leftside-menu`
  - `side-nav`
  - `side-nav-link`
- Variants / states:
  - single-level item
  - expandable multi-level item
  - active item state
  - permission-gated item state

### `BreadCrumb`
- File: [BreadCrumb.tsx](D:/trainup/src/component/common/BreadCrumb.tsx)
- Purpose: route-aware breadcrumb generator
- Props:
  - none
- Styling pattern:
  - `page-title-box`
  - `breadcrumb`
- Variants / states:
  - hidden on root with no segments
  - auto label mapping from `adminMenu`

### `Footer`
- File: [Footer.tsx](D:/trainup/src/component/common/Footer.tsx)
- Purpose: bottom footer with settings-driven branding
- Props:
  - none
- Data source:
  - Redux `settings`

### `UserBox`
- File: [UserBox.tsx](D:/trainup/src/component/common/UserBox.tsx)
- Purpose: top-right profile dropdown and account modal
- Props:
  - none
- Data source:
  - Redux `admin`
- Styling pattern:
  - `nav-user`
  - `profile-dropdown`
  - `admin-settings-list`
  - `admin-settings-item`
- Variants / states:
  - dropdown closed/open
  - account modal closed/open

### `RoleWorkspaceShell`
- File: [RoleWorkspaceShell.tsx](D:/trainup/src/component/common/RoleWorkspaceShell.tsx)
- Purpose: trainer/reviewer shell matching the admin layout structure
- Props:
```ts
type RoleWorkspaceShellProps = {
  role: "trainer" | "reviewer";
  sessionName: string;
  activeItem: "dashboard" | "trainings";
  onSelectItem: (item: "dashboard" | "trainings") => void;
  onSignOut: () => void;
  children: ReactNode;
}
```
- Styling pattern:
  - same shell class system as admin
  - Bootstrap utilities
  - Remix icons
- Variants / states:
  - role variant: `trainer` / `reviewer`
  - active nav item: `dashboard` / `trainings`
  - mobile sidebar overlay
  - account modal

## 4.3 Shared UI Primitives

### `Image`
- File: [Image.tsx](D:/trainup/src/component/common/Image.tsx)
- Purpose: resilient image renderer with fallback asset
- Props:
```ts
type ImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  title?: string;
}
```
- Styling pattern:
  - inherits all styling from caller
- Variants / states:
  - success
  - fallback image on load error

### `Loader`
- File: [Loader.tsx](D:/trainup/src/component/common/Loader.tsx)
- Purpose: full-screen loading state
- Props:
  - none
- Styling pattern:
  - Bootstrap centering utilities
  - `.hm-spinner` from [custom.css](D:/trainup/src/assets/css/custom.css)
- Variants / states:
  - single spinner variant only

### `Modal`
- File: [Modal.tsx](D:/trainup/src/component/common/Modal.tsx)
- Purpose: shared modal wrapper with Redux-backed open-count handling
- Props:
```ts
export interface ModalProps {
  show: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  centered?: boolean;
  scrollable?: boolean;
}
```
- Styling pattern:
  - Bootstrap modal structure
  - project modal overlay behavior from [custom.css](D:/trainup/src/assets/css/custom.css)
- Variants / states:
  - size: `sm`, `md`, `lg`, `xl`
  - position: centered or default
  - content overflow: scrollable or default
  - open / closed

### `Pagination`
- File: [Pagination.tsx](D:/trainup/src/component/common/Pagination.tsx)
- Purpose: generic paginated footer for list pages
- Props:
```ts
type Props<T> = {
  data: PaginatedResponse<T>;
  param: PageParamState;
  setParam: Dispatch<SetStateAction<PageParamState>>;
  showStatistics?: boolean;
}
```
- Styling pattern:
  - Bootstrap button group style with inline controls
- Variants / states:
  - statistics hidden / shown
  - disabled first/last controls
  - active page button uses `btn-primary`
  - inactive page button uses `btn-outline-secondary`

### `ActionDropdown`
- File: [ActionDropdown.tsx](D:/trainup/src/component/common/ActionDropdown.tsx)
- Purpose: reusable row-action trigger and floating menu
- Props:
```ts
type ActionDropdownProps = {
  label?: string;
  children: (helpers: { close: () => void }) => ReactNode;
}
```
- Styling pattern:
  - `action-dropdown-toggle`
  - `action-dropdown-menu`
  - body-level portal render
- Variants / states:
  - open / closed
  - menu alignment auto-adjusts to viewport
- Reuse when:
  - any table has an `Action` column

### `PermissionBlock`
- File: [PermissionBlock.tsx](D:/trainup/src/component/common/PermissionBlock.tsx)
- Purpose: conditional rendering wrapper for action- and section-level permissions
- Props:
```ts
type BlockProps = PropsWithChildren<{
  permissionKey?: string;
  allowedKey?: string;
  fallback?: ReactNode;
}>
```
- Styling pattern:
  - no own styling
  - fallback can be any node
- Variants / states:
  - allowed
  - blocked with fallback

### `CheckPermission`
- File: [PermissionBlock.tsx](D:/trainup/src/component/common/PermissionBlock.tsx)
- Purpose: route-level permission gate
- Props:
  - `children`
- Styling pattern:
  - blocked state uses `admin-403-icon` and card shell

## 4.4 Auth / Public Flow Components

### `PublicExperienceShell`
- File: [PublicExperienceShell.tsx](D:/trainup/src/component/common/PublicExperienceShell.tsx)
- Purpose: generic public-facing feature wrapper with icon, eyebrow, title, subtitle, badge, and optional action bar
- Props:
```ts
type PublicExperienceShellProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  badge: string;
  badgeClassName?: string;
  icon: string;
  actions?: ReactNode;
  children: ReactNode;
}
```
- Styling pattern:
  - `page-title-box`
  - Bootstrap avatar, badge, and card classes
- Variants / states:
  - badge style via `badgeClassName`
  - optional `actions`

### `PublicRoleLoginCard`
- File: [PublicRoleLoginCard.tsx](D:/trainup/src/component/common/PublicRoleLoginCard.tsx)
- Purpose: reusable role login card for non-admin role flows
- Props:
```ts
type PublicRoleLoginCardProps = {
  role: PublicRole;
  title: string;
  description: string;
  identifierLabel: string;
  identifierPlaceholder: string;
  identifierType?: string;
  demoText: string;
  initialValues: {
    identifier: string;
    password: string;
  };
  redirectTo: string;
  authenticate: (
    identifier: string,
    password: string,
  ) => {
    session?: PublicRoleSession;
    message: string;
    errors?: Record<string, string>;
  };
}
```
- Styling pattern:
  - auth card shell
  - Bootstrap form controls
  - Formik + Yup
- Variants / states:
  - identifier input type override
  - authenticated redirect
  - invalid state via Formik errors

## 4.5 Training Workspace Components

### `TrainingWorkspace`
- File: [TrainingWorkspace.tsx](D:/trainup/src/component/training-workspace/TrainingWorkspace.tsx)
- Purpose: full trainer/reviewer composite workspace
- Props:
```ts
type TrainingWorkspaceProps = {
  role: "trainer" | "reviewer";
  sessionName: string;
  onSignOut: () => void;
}
```
- Styling pattern:
  - `RoleWorkspaceShell`
  - `training-*` classes
  - Bootstrap layout, forms, tables, cards
  - Formik + Yup for slideshow setup
- Variants / states:
  - role: `trainer` / `reviewer`
  - internal views: `dashboard`, `trainings`, `builder`, `detail`
  - builder mode: `upload`, `create`
  - detail tab: `sessions`, `review`
- Reuse note:
  - this is a composite feature module, not a primitive

### `SlideMediaPreview`
- File: [SlideMediaPreview.tsx](D:/trainup/src/component/training-workspace/SlideMediaPreview.tsx)
- Purpose: preview and interaction layer for stored slide media
- Props:
```ts
type SlideMediaPreviewProps = {
  slide: TrainingSlideRecord;
  accentColor: string;
  showLink?: boolean;
  className?: string;
  fallbackNote?: string;
  hideBadge?: boolean;
  removeLabel?: string;
  onRemove?: () => void;
  onUpload?: () => void;
  uploadLabel?: string;
  onRestore?: () => void;
  showRestore?: boolean;
}
```
- Styling pattern:
  - `training-slide-media`
  - `training-slide-media-frame`
  - `training-slide-media-fallback`
  - `training-slide-link-row`
- Variants / states:
  - ready image
  - loading
  - missing
  - empty/fallback
  - link shown / hidden
  - source badge shown / hidden
  - upload action enabled / absent
  - restore action enabled / absent

### `ScriptAudioPlayer`
- File: [ScriptAudioPlayer.tsx](D:/trainup/src/component/training-workspace/ScriptAudioPlayer.tsx)
- Purpose: generates and previews narration audio from slide script text
- Props:
```ts
type ScriptAudioPlayerProps = {
  script: string;
  voiceName?: string;
  className?: string;
}
```
- Styling pattern:
  - `training-audio-player`
  - `training-audio-player-empty`
- Variants / states:
  - no script
  - loading
  - error
  - ready audio

### `TrainingFormBuilderModal`
- File: [TrainingFormBuilderModal.tsx](D:/trainup/src/component/training-workspace/TrainingFormBuilderModal.tsx)
- Purpose: reference-style form builder for slide-level forms
- Props:
```ts
type TrainingFormBuilderModalProps = {
  show: boolean;
  slide: TrainingSlideRecord | null;
  onClose: () => void;
  onSave: (
    slideId: string,
    formFields: TrainingFormField[],
    formConfig: TrainingFormConfig,
  ) => void;
}
```
- Styling pattern:
  - built on shared `Modal`
  - `training-form-builder-*`
  - Bootstrap buttons, inputs, selects, textareas
- Variants / states:
  - tab: `form` / `element`
  - field groups:
    - Input Fields
    - Selection
    - Advanced
    - Content
    - Actions
  - empty builder
  - selected field vs no field selected
- Built-in button variants:
  - primary submit/save actions
  - light utility actions

## 5. Route-Level Composition Components

These are not library primitives, but they are important reuse references for future modules.

### `Login`
- File: [Login.tsx](D:/trainup/src/routes/Auth/Login.tsx)
- Pattern:
  - auth card
  - logo header
  - Formik + Yup
  - primary submit CTA
  - contextual helper alerts

### `Dashboard`
- File: [Dashboard.tsx](D:/trainup/src/routes/Dashboard.tsx)
- Pattern:
  - `admin-page-intro`
  - KPI cards
  - chart/progress card
  - integration status card
  - data table
  - quick action buttons

### `Clients`, `Users`, `ApiKeys`
- Files:
  - [Clients.tsx](D:/trainup/src/routes/clients/Clients.tsx)
  - [Users.tsx](D:/trainup/src/routes/users/Users.tsx)
  - [ApiKeys.tsx](D:/trainup/src/routes/integrations/ApiKeys.tsx)
- Pattern:
  - intro header
  - search/filter row
  - primary CTA
  - bordered table
  - `ActionDropdown` in the action column
  - `Pagination`
  - `Modal` + Formik form
  - `PermissionBlock` around protected actions

### `EmployeeSso`
- File: [EmployeeSso.tsx](D:/trainup/src/routes/employee/EmployeeSso.tsx)
- Pattern:
  - portal-style public flow
  - checking/loading state
  - granted/already-logged-in state
  - primary handoff action
  - `employee-*` CSS family

### `TrainerWorkspacePanel`, `ReviewerWorkspacePanel`
- Files:
  - [TrainerWorkspacePanel.tsx](D:/trainup/src/routes/trainer/TrainerWorkspacePanel.tsx)
  - [ReviewerWorkspacePanel.tsx](D:/trainup/src/routes/reviewer/ReviewerWorkspacePanel.tsx)
- Pattern:
  - route/session wrapper around `TrainingWorkspace`
  - redirect on missing session

## 6. Reusable UI Patterns Already Established

### CRUD List Page Pattern
- intro block with `admin-page-intro`
- search/filter in card header
- primary action button on the right
- table wrapped in `.table-responsive`
- row action menu via `ActionDropdown`
- modal-based add/edit form
- pagination footer
- permission gating around create/edit/delete/revoke

### Topbar / Sidebar Shell Pattern
- logo left
- sidebar toggle
- notification icon
- theme toggle
- fullscreen action
- credits block
- user dropdown
- sticky left navigation

### Auth Card Pattern
- centered card
- branded top section
- concise helper/demo text
- Formik validation
- single primary submit button

### Slide Media Pattern
- media preview on left
- narration/audio on right
- unique URL row
- collapsible additional settings
- form builder launched in modal

### Settings Card Pattern
- `admin-settings-list`
- `admin-settings-item`
- small muted label
- strong value

## 7. Variants Summary

Current explicit component variants already present:

- `Modal`
  - size: `sm`, `md`, `lg`, `xl`
  - centered: `true/false`
  - scrollable: `true/false`

- `Pagination`
  - `showStatistics: true/false`

- `PermissionBlock`
  - permission key optional
  - allowed key optional
  - custom fallback optional

- `PublicExperienceShell`
  - `badgeClassName`
  - optional `actions`

- `PublicRoleLoginCard`
  - `identifierType`
  - authentication callback per role

- `RoleWorkspaceShell`
  - role: `trainer` / `reviewer`
  - active nav item: `dashboard` / `trainings`

- `SlideMediaPreview`
  - show/hide link
  - show/hide badge
  - upload action on/off
  - remove action on/off
  - restore action on/off

- `ScriptAudioPlayer`
  - empty
  - loading
  - ready
  - error

- `TrainingFormBuilderModal`
  - tab: `Form Properties` / `Element Properties`
  - field-type variants based on `TrainingFieldType`

## 8. Reuse Rules For Future Modules

Use these existing components first before creating new ones:
- `Modal` for dialog workflows
- `ActionDropdown` for all table action columns
- `Pagination` for paged lists
- `PermissionBlock` for action-level protection
- `RoleWorkspaceShell` for trainer/reviewer-like protected workspaces
- `PublicRoleLoginCard` for credential-driven public-role logins
- `SlideMediaPreview`, `ScriptAudioPlayer`, `TrainingFormBuilderModal` for slide/media/form flows

Do not introduce:
- a second modal pattern
- a second row-action pattern
- a second permission wrapper
- a second trainer/reviewer shell
- a new styling system outside the current CSS theme stack

## 9. Quick Reference

Primary reusable component files:
- [ActionDropdown.tsx](D:/trainup/src/component/common/ActionDropdown.tsx)
- [BreadCrumb.tsx](D:/trainup/src/component/common/BreadCrumb.tsx)
- [ErrorBoundary.tsx](D:/trainup/src/component/common/ErrorBoundary.tsx)
- [Footer.tsx](D:/trainup/src/component/common/Footer.tsx)
- [Image.tsx](D:/trainup/src/component/common/Image.tsx)
- [Loader.tsx](D:/trainup/src/component/common/Loader.tsx)
- [Modal.tsx](D:/trainup/src/component/common/Modal.tsx)
- [Navbar.tsx](D:/trainup/src/component/common/Navbar.tsx)
- [Pagination.tsx](D:/trainup/src/component/common/Pagination.tsx)
- [PermissionBlock.tsx](D:/trainup/src/component/common/PermissionBlock.tsx)
- [PublicExperienceShell.tsx](D:/trainup/src/component/common/PublicExperienceShell.tsx)
- [PublicRoleLoginCard.tsx](D:/trainup/src/component/common/PublicRoleLoginCard.tsx)
- [RoleWorkspaceShell.tsx](D:/trainup/src/component/common/RoleWorkspaceShell.tsx)
- [Sidebar.tsx](D:/trainup/src/component/common/Sidebar.tsx)
- [ThemeSettingsProvider.tsx](D:/trainup/src/component/common/ThemeSettingsProvider.tsx)
- [UserBox.tsx](D:/trainup/src/component/common/UserBox.tsx)
- [ScriptAudioPlayer.tsx](D:/trainup/src/component/training-workspace/ScriptAudioPlayer.tsx)
- [SlideMediaPreview.tsx](D:/trainup/src/component/training-workspace/SlideMediaPreview.tsx)
- [TrainingFormBuilderModal.tsx](D:/trainup/src/component/training-workspace/TrainingFormBuilderModal.tsx)
- [TrainingWorkspace.tsx](D:/trainup/src/component/training-workspace/TrainingWorkspace.tsx)
