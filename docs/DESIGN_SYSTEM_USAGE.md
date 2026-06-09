# Samsung LMS Design System

Source of truth:
- [design-system.css](D:/trainup/src/assets/css/design-system.css)

This file does not redesign the product. It standardizes the active UI already present in the project and exposes it as reusable tokens and recipe classes for future modules.

## What It Extracts

### Colors
- Primary: `--ds-color-primary` from the active admin theme blue
- Secondary: `--ds-color-secondary`
- Background/page: `--ds-color-background`
- Surface/card: `--ds-color-surface`
- Text: `--ds-color-text`, `--ds-color-text-strong`, `--ds-color-text-muted`
- Accent/status: `--ds-color-accent`, `--ds-color-success`, `--ds-color-warning`, `--ds-color-danger`
- Border: `--ds-color-border`

### Typography
- Base font family: `--ds-font-family-base` (`Figtree`, inherited from the current theme)
- Mono font family: `--ds-font-family-mono`
- Standard size scale: `--ds-font-size-xs` through `--ds-font-size-4xl`
- Standard weights: regular, semibold, bold, extrabold
- Standard line heights: tight, base, relaxed

### Spacing and Grid
- Spacing scale: `--ds-space-1` to `--ds-space-7`
- Grid gutter scale: `--ds-grid-gutter`, `--ds-grid-gutter-tight`, `--ds-grid-gutter-loose`
- Container widths extracted from the current Bootstrap-based shell

## Reusable Recipe Classes

Use these for new modules instead of hardcoding values:

- Layout:
  - `.ds-shell-wrapper`
  - `.ds-shell-topbar`
  - `.ds-shell-sidebar`
  - `.ds-shell-content`
  - `.ds-page-container`
  - `.ds-page-intro`

- Spacing:
  - `.ds-stack-sm`
  - `.ds-stack-md`
  - `.ds-stack-lg`
  - `.ds-grid-2`
  - `.ds-grid-3`

- Surfaces:
  - `.ds-surface-card`
  - `.ds-card-hover`

- Buttons:
  - `.ds-button`
  - `.ds-button-primary`
  - `.ds-button-light`
  - `.ds-button-outline`

- Forms:
  - `.ds-input`

- Tables:
  - `.ds-table-wrap`
  - `.ds-table`
  - `.ds-table-sticky-last`
  - `.ds-action-trigger`
  - `.ds-action-menu`

- Modal and text helpers:
  - `.ds-modal-surface`
  - `.ds-label-caps`
  - `.ds-meta-text`
  - `.ds-code-text`

- Icons:
  - `.ds-icon`
  - `.ds-icon-sm`
  - `.ds-icon-md`
  - `.ds-icon-lg`
  - `.ds-icon-xl`

## Existing Project Conventions

Follow the naming system already in the codebase:

- `admin-*`: admin dashboards, CRUD pages, settings blocks
- `training-*`: trainer/reviewer builders, review flows, slide editors
- `employee-*`: employee SSO and training access
- `action-dropdown-*`: action-cell buttons and menus
- `ds-*`: global reusable design-system layer

Component file naming remains PascalCase, for example:
- `Navbar.tsx`
- `Sidebar.tsx`
- `TrainingWorkspace.tsx`

## Layout Structure To Reuse

The standard shell already used in the project is:

`wrapper` → `Navbar` → `Sidebar` → `content-page` → `content` → `container-fluid` → `BreadCrumb` → page content → `Footer`

Future protected modules should stay inside that same shell structure instead of creating a second layout system.

## Icon Rules

- Use `ri-*` Remix icons for shell, topbar, sidebar, and large navigation actions.
- Use `bi-*` Bootstrap icons for inline actions, CRUD affordances, tables, and form helpers.
- Keep icon color inherited from text color unless the surrounding status color intentionally changes it.

## Usage Rule

For future modules:
- use `var(--ds-...)` tokens instead of hardcoded hex, spacing, radius, or shadow values
- use the `ds-*` recipe classes where possible
- only fall back to module prefixes like `admin-*` or `training-*` when a pattern is truly domain-specific
- do not introduce a parallel theme file or alternate spacing/color system
