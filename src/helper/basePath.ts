// Centralized base-path handling for the admin app.
//
// The admin build is deployed under a subpath (e.g. "/trainup-demo/"), set via
// VITE_BASE_URL → Vite `base` → import.meta.env.BASE_URL. React Router's
// `basename` already makes <Link>/<NavLink>/navigate("/x") base-path aware, so
// those need no changes. This helper is for the cases that BYPASS the router —
// building absolute URLs for window.open / QR codes / external links / new tabs.
//
// Safe when BASE_URL is "/" (local dev): basePath becomes "" and no extra slash
// is added, so paths stay "/route" with no leading "//".

const RAW_BASE = import.meta.env.BASE_URL || "/";

// "" for root, otherwise "/trainup-demo" (no trailing slash).
export const basePath = RAW_BASE === "/" ? "" : RAW_BASE.replace(/\/+$/, "");

// Prefix an in-app absolute path with the base path. withBase("/group/x") ->
// "/group/x" (root) or "/trainup-demo/group/x" (subpath). Never produces "//".
export const withBase = (path = "/"): string => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${normalized}` || "/";
};

// Full absolute URL (origin + base + path) for window.open / QR / sharing.
export const withOrigin = (path = "/"): string => {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${withBase(path)}`;
};
