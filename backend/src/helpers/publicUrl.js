const config = require("../config");

// Centralized public-URL builder for the admin SPA's deployment subpath.
//
// The admin frontend is served under PUBLIC_BASE_PATH (e.g. "/trainup-demo"),
// mirroring the frontend VITE_BASE_URL. Backend-generated links (launch links,
// assignment/invite emails, password set/reset links) must include this prefix
// so they resolve under the subpath, not the domain root.
//
// Backward compatible: when PUBLIC_BASE_PATH is unset or "/", `publicBasePath`
// is "" and these helpers are no-ops (root deployments keep working).

// Normalize any base-path value to "" or "/segment" (no trailing slash).
const normalizeBasePath = (value) => {
  let v = String(value || "").trim();
  if (!v || v === "/") return "";
  if (!v.startsWith("/")) v = `/${v}`;
  return v.replace(/\/+$/, "");
};

// Prefix an in-app absolute path with the base path. Slash-safe. `basePath` may
// be passed per-request (e.g. from the admin app's X-App-Base-Path header);
// otherwise the configured PUBLIC_BASE_PATH is used.
const withBasePath = (path = "/", basePath) => {
  const base = basePath !== undefined && basePath !== null ? normalizeBasePath(basePath) : config.publicBasePath;
  const normalizedPath = !path ? "/" : path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}` || "/";
};

// Build a full absolute URL: origin + base path + path. `origin` must be an
// origin only (scheme://host[:port]).
const buildPublicUrl = (origin, path = "/", basePath) => {
  const cleanOrigin = String(origin || "").trim().replace(/\/+$/, "");
  return `${cleanOrigin}${withBasePath(path, basePath)}`;
};

module.exports = { withBasePath, buildPublicUrl, normalizeBasePath };
