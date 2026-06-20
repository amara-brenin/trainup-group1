import AxiosHelper from "./AxiosHelper";
import { adminAppUrl, superAdminAppUrl } from "./appVariant";

// Backend returns a single-use cross-app handoff code (never the JWT itself).
// The target app exchanges that code for the impersonation token on load.
type ImpersonationStartResult = {
  handoffCode: string;
  targetRole: string;
  targetName: string;
  targetClientId: string;
};

// Send the browser to the app that owns the target identity, carrying only the
// opaque one-time code. Works whether the two apps share an origin or not.
const redirectToHandoff = (targetRole: string, code: string) => {
  const base = targetRole === "super_admin" ? superAdminAppUrl : adminAppUrl;
  // The target app is served under a base path (e.g. the super-admin app at
  // "/console/"). Keep the trailing slash on that base BEFORE the query, or the
  // dev/static server reports a base-URL mismatch (".../console?imp" vs the
  // required ".../console/?imp"). Building via URL() guarantees this.
  const url = new URL(base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("imp", code);
  window.location.href = url.toString();
};

const start = async (url: string) => {
  const res = await AxiosHelper.postData<ImpersonationStartResult, Record<string, never>>(url, {});
  if (!res.data.status || !res.data.data?.handoffCode) {
    throw new Error(res.data.message || "Could not start the impersonation session.");
  }
  redirectToHandoff(res.data.data.targetRole, res.data.data.handoffCode);
};

// FEATURE 1: Super Admin → Client Admin.
// Note: the super-admin router is mounted at the API root (same as /clients,
// /super-admins), so the path has NO "/super-admin" prefix.
export const impersonateClientAdmin = (clientId: string) =>
  start(`/impersonate/client/${encodeURIComponent(clientId)}`);

// FEATURE 2: Client Admin (or SA-as-CA) → User.
export const impersonateUser = (userId: string) =>
  start(`/users/impersonate/${encodeURIComponent(userId)}`);

// FEATURE 3: Return flow (pops one level off the impersonation stack).
export const restoreImpersonationSession = () => start(`/auth/restore-session`);

// Exchange a one-time handoff code (read from ?imp=) for the session token.
export const exchangeImpersonationCode = async (code: string): Promise<string | null> => {
  const res = await AxiosHelper.postData<{ token: string }, { code: string }>(
    "/auth/impersonation/exchange",
    { code },
  );
  if (!res.data.status || !res.data.data?.token) {
    return null;
  }
  return res.data.data.token;
};
