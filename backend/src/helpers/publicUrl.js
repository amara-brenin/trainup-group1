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

// Prefix an in-app absolute path with the base path. Slash-safe: never produces
// "//" and never drops a needed "/".
const withBasePath = (path = "/") => {
  const base = config.publicBasePath; // "" or "/trainup-demo"
  const normalizedPath = !path ? "/" : path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}` || "/";
};

// Build a full absolute URL: origin + base path + path. `origin` must be an
// origin only (scheme://host[:port]); any trailing slash is trimmed so we don't
// create a double slash before the base path.
const buildPublicUrl = (origin, path = "/") => {
  const cleanOrigin = String(origin || "").trim().replace(/\/+$/, "");
  return `${cleanOrigin}${withBasePath(path)}`;
};

module.exports = { withBasePath, buildPublicUrl };
