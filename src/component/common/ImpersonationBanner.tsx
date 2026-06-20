import { useState } from "react";
import { toast } from "react-toastify";
import { useAppSelector } from "../../app/hooks";
import { restoreImpersonationSession } from "../../helper/impersonationApi";

// Persistent, always-visible banner shown whenever the current session is an
// impersonation. Reads context from the auth slice (populated by /profile).
const ImpersonationBanner = () => {
  const impersonation = useAppSelector((state) => state.admin.impersonation);
  const name = useAppSelector((state) => state.admin.name);
  const role = useAppSelector((state) => state.admin.role);
  const [returning, setReturning] = useState(false);

  if (!impersonation?.active) {
    return null;
  }

  const roleLabel = (impersonation.currentRole || role || "user").replace(/_/g, " ");
  const displayName = impersonation.currentName || name || "this account";

  const handleReturn = async () => {
    setReturning(true);
    try {
      await restoreImpersonationSession();
      // restoreImpersonationSession redirects on success.
    } catch (error) {
      setReturning(false);
      toast.error(error instanceof Error ? error.message : "Could not return to your admin session.");
    }
  };

  return (
    <>
      {/* Spacer keeps the fixed banner from covering the app's topbar. */}
      <div style={{ height: 44 }} aria-hidden />
      <div
        role="status"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 44,
          zIndex: 4000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: "0 16px",
          background: "linear-gradient(90deg, #b45309, #d97706)",
          color: "#fff",
          fontSize: 13.5,
          fontWeight: 600,
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
          <i className="ri-spy-line" /> Impersonation Mode
        </span>
        <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
          Logged in as {roleLabel}: <strong>{displayName}</strong>
        </span>
        <button
          type="button"
          onClick={() => void handleReturn()}
          disabled={returning}
          style={{
            border: "1px solid rgba(255,255,255,0.7)",
            background: "rgba(255,255,255,0.12)",
            color: "#fff",
            borderRadius: 6,
            padding: "4px 12px",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: returning ? "default" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <i className="ri-arrow-go-back-line" />
          {returning ? "Returning…" : impersonation.returnLabel || "Return to Admin"}
        </button>
      </div>
    </>
  );
};

export default ImpersonationBanner;
