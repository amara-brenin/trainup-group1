import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { setDemoSession, clearDemoSession } from "../../helper/authSession";
import { getRequestUrl, isServerApiEnabled } from "../../helper/runtimeApi";
import type { ApiEnvelope } from "../../constant/interfaces";
import DefaultBrandLogo from "../../assets/images/logo.png";

// Signed external launch landing page (LMS_INTEGRATION_RESEARCH.md — Method A/E).
// The LMS embeds /secure-launch/:launchToken as a web link or iframe. We resolve
// the signed token, then start the existing player in demo mode — the backend's
// findTrainingByDemoToken accepts the signed token, so no new player is needed.

type ResolveResponse = {
  trainingId: string;
  title: string;
  learnerName?: string;
  learnerEmail?: string;
  branding?: {
    application_name?: string;
    logo?: string;
    logoUrl?: string;
    dark_logo?: string;
    darkLogoUrl?: string;
  };
};

const SecureTrainingLaunch = () => {
  const { launchToken = "" } = useParams();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [resolved, setResolved] = useState<ResolveResponse | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");

  const start = useCallback(
    (training: ResolveResponse, name: string, email: string) => {
      clearDemoSession();
      setDemoSession({
        demoToken: launchToken,
        trainingId: training.trainingId,
        guestName: name,
        guestEmail: email,
      });
      navigate(`/slideshows/${training.trainingId}`, { replace: true });
    },
    [launchToken, navigate],
  );

  const resolve = useCallback(async () => {
    if (!launchToken) {
      setErrorMessage("Invalid launch link.");
      setIsLoading(false);
      return;
    }
    try {
      const response = await axios.get<ApiEnvelope<ResolveResponse>>(
        getRequestUrl(`/launch/secure/${launchToken}/resolve`),
        { validateStatus: () => true },
      );
      if (!response.data.status) {
        throw new Error(response.data.message || "This launch link is invalid or has expired.");
      }
      const data = response.data.data;
      setResolved(data);
      // Per-learner link: identity is baked into the signed token → auto-start.
      if (data.learnerName && data.learnerEmail) {
        start(data, data.learnerName, data.learnerEmail);
        return;
      }
      // SCORM/embed: identity passed via query (?ln=&le=) by the LMS wrapper →
      // auto-start without a form.
      const params = new URLSearchParams(window.location.search);
      const qName = (params.get("ln") || "").trim();
      const qEmail = (params.get("le") || "").trim();
      if (qName && qEmail) {
        start(data, qName, qEmail);
        return;
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Unable to load training.");
    } finally {
      setIsLoading(false);
    }
  }, [launchToken, start]);

  useEffect(() => {
    if (isServerApiEnabled) {
      void resolve();
    } else {
      setErrorMessage("Server API is not available.");
      setIsLoading(false);
    }
  }, [resolve]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const name = guestName.trim();
    const email = guestEmail.trim();
    if (!name || !email || !resolved) return;
    start(resolved, name, email);
  };

  const logoUrl =
    resolved?.branding?.logoUrl ||
    resolved?.branding?.logo ||
    resolved?.branding?.darkLogoUrl ||
    resolved?.branding?.dark_logo ||
    DefaultBrandLogo;
  const appName = resolved?.branding?.application_name || "Training";

  if (isLoading) {
    return (
      <div className="d-flex align-items-center justify-content-center vh-100 bg-light">
        <div className="text-center">
          <div className="spinner-border text-primary mb-3" role="status" />
          <div className="text-body-secondary">Loading training...</div>
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="d-flex align-items-center justify-content-center vh-100 bg-light">
        <div className="text-center">
          <i className="bi bi-exclamation-circle fs-1 text-danger d-block mb-3" />
          <h5>Launch Unavailable</h5>
          <p className="text-body-secondary">{errorMessage}</p>
        </div>
      </div>
    );
  }

  // Anonymous link (no learner baked in) → collect identity before starting.
  return (
    <main className="auth-shell-centered" style={{ minHeight: "100vh" }}>
      <div className="auth-card auth-card-focused">
        <div className="auth-card-body">
          <div className="auth-card-brand">
            <img src={logoUrl} alt={appName} className="auth-brand-logo" />
          </div>
          <div className="text-center mb-4">
            <h2>{resolved?.title || "Training"}</h2>
            <p className="mb-0">Enter your details to start the training.</p>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label htmlFor="secure-name" className="form-label">Full Name</label>
              <input
                id="secure-name"
                type="text"
                className="form-control"
                required
                placeholder="Enter your full name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
              />
            </div>
            <div className="mb-3">
              <label htmlFor="secure-email" className="form-label">Email Address</label>
              <input
                id="secure-email"
                type="email"
                className="form-control"
                required
                placeholder="Enter your email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
              />
            </div>
            <div className="d-grid">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!guestName.trim() || !guestEmail.trim()}
              >
                Start Training
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
};

export default SecureTrainingLaunch;
