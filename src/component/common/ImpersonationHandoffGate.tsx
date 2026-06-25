import { useEffect, useState, type ReactNode } from "react";
import { Loader } from "./Loader";
import { setAuthToken, setLastAppRoute } from "../../helper/authSession";
import { exchangeImpersonationCode } from "../../helper/impersonationApi";

// When the browser lands with `?imp=<code>` (an impersonation/restore handoff),
// exchange the one-time code for the session token, store it, strip the param,
// THEN render the app so the normal auth bootstrap runs as the new identity.
const readCode = () =>
  typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("imp") || "";

// Decode (without verifying) the role from a JWT so we can land the new identity
// on its correct home shell. The server still verifies the token on every call.
const decodeRole = (token: string): string => {
  try {
    const part = token.split(".")[1];
    const json = JSON.parse(decodeURIComponent(escape(window.atob(part.replace(/-/g, "+").replace(/_/g, "/")))));
    return String(json.role || "");
  } catch {
    return "";
  }
};

// Different roles live in different shells (trainer/reviewer use their own
// public-route workspaces, admins use the dashboard). Route accordingly.
const homeForRole = (role: string): string => {
  const base = import.meta.env.BASE_URL || "/";
  const path = role === "trainer" ? "trainer" : role === "reviewer" ? "reviewer" : "";
  return `${base}${path}`.replace(/\/{2,}/g, "/");
};

const ImpersonationHandoffGate = ({ children }: { children: ReactNode }) => {
  const [ready, setReady] = useState(() => !readCode());

  useEffect(() => {
    const code = readCode();
    if (!code) return;

    let cancelled = false;
    (async () => {
      let token: string | null = null;
      try {
        token = await exchangeImpersonationCode(code);
        if (token) {
          setAuthToken(token);
          // Same-origin apps share sessionStorage, so the previous identity's
          // last route (e.g. a Super Admin's "/clients") would otherwise be
          // restored for the new identity and trip the "Permission required"
          // guard. Clear it so the new identity lands on its own role home.
          setLastAppRoute("");
        }
      } catch {
        // Invalid/expired code — fall through; the app will route to login.
      }

      if (token) {
        // Land the new identity on its correct home shell (full load drops the
        // ?imp param and mounts the right layout for trainer/reviewer/admin).
        window.location.replace(homeForRole(decodeRole(token)));
        return; // navigation in progress; do not render here
      }

      // Failed exchange: strip the code and render (app will route to login).
      const params = new URLSearchParams(window.location.search);
      params.delete("imp");
      const query = params.toString();
      const clean = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", clean);
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return ready ? <>{children}</> : <Loader />;
};

export default ImpersonationHandoffGate;
