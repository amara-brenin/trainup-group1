import { useEffect, useState } from "react";
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
  const isActive = Boolean(impersonation?.active);

  // The banner is fixed at the very top (z-index 4000). The app topbar is
  // sticky at top:0 (z-index 1000), so while scrolling it would slide UNDER the
  // banner and hide the hamburger/logo. Tag <html> so CSS can offset the
  // sticky topbar below the banner for the whole impersonated session.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("impersonation-active", isActive);
    return () => root.classList.remove("impersonation-active");
  }, [isActive]);

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
      <div className="impersonation-spacer" aria-hidden />
      <div className="impersonation-banner" role="status">
        <span className="impersonation-banner-tag">
          <i className="ri-spy-line" />
          <span className="impersonation-banner-tag-text">Impersonation Mode</span>
        </span>
        <span className="impersonation-banner-user">
          <span className="impersonation-banner-user-label">Logged in as {roleLabel}:</span>{" "}
          <strong>{displayName}</strong>
        </span>
        <button
          type="button"
          className="impersonation-banner-return"
          onClick={() => void handleReturn()}
          disabled={returning}
        >
          <i className="ri-arrow-go-back-line" />
          <span className="impersonation-banner-return-text">
            {returning ? "Returning…" : impersonation.returnLabel || "Return to Admin"}
          </span>
        </button>
      </div>
    </>
  );
};

export default ImpersonationBanner;
