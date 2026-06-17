import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { setDemoSession, clearDemoSession } from "../../helper/authSession";
import { getRequestUrl, isServerApiEnabled } from "../../helper/runtimeApi";
import type { ApiEnvelope } from "../../constant/interfaces";
import DefaultBrandLogo from "../../assets/images/logo.png";

type ResolveResponse = {
  trainingId: string;
  title: string;
  branding?: {
    application_name?: string;
    logo?: string;
    logoUrl?: string;
    dark_logo?: string;
    darkLogoUrl?: string;
    loaderTitle?: string;
    loaderCaption?: string;
  };
};

const DemoTrainingLaunch = () => {
  const { demoToken = "" } = useParams();
  const navigate = useNavigate();
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [resolved, setResolved] = useState<ResolveResponse | null>(null);

  const resolve = useCallback(async () => {
    if (!demoToken) {
      setErrorMessage("Invalid demo link.");
      setIsLoading(false);
      return;
    }
    try {
      const response = await axios.get<ApiEnvelope<ResolveResponse>>(
        getRequestUrl(`/demo/${demoToken}/resolve`),
        { validateStatus: () => true },
      );
      if (!response.data.status) {
        throw new Error(response.data.message || "Demo training not found.");
      }
      setResolved(response.data.data);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Unable to load demo training.");
    } finally {
      setIsLoading(false);
    }
  }, [demoToken]);

  useEffect(() => {
    clearDemoSession();
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
    if (!name || !email) return;

    if (!resolved) return;
    setIsSubmitting(true);

    setDemoSession({
      demoToken,
      trainingId: resolved.trainingId,
      guestName: name,
      guestEmail: email,
    });

    navigate(`/slideshows/${resolved.trainingId}`, { replace: true });
  };

  const logoUrl =
    resolved?.branding?.logoUrl ||
    resolved?.branding?.logo ||
    resolved?.branding?.darkLogoUrl ||
    resolved?.branding?.dark_logo ||
    DefaultBrandLogo;

  const appName =
    resolved?.branding?.application_name || "Training Demo";

  if (isLoading) {
    return (
      <div className="d-flex align-items-center justify-content-center vh-100 bg-light">
        <div className="text-center">
          <div className="spinner-border text-primary mb-3" role="status" />
          <div className="text-body-secondary">Loading demo...</div>
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="d-flex align-items-center justify-content-center vh-100 bg-light">
        <div className="text-center">
          <i className="bi bi-exclamation-circle fs-1 text-danger d-block mb-3" />
          <h5>Demo Unavailable</h5>
          <p className="text-body-secondary">{errorMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="d-flex align-items-center justify-content-center vh-100 bg-light">
      <div className="card shadow-sm" style={{ maxWidth: 440, width: "100%" }}>
        <div className="card-body p-4">
          <div className="text-center mb-4">
            <img
              src={logoUrl}
              alt={appName}
              style={{ maxHeight: 48, maxWidth: 180 }}
              className="mb-2"
            />
            <h5 className="mb-1">{resolved?.title || "Training Demo"}</h5>
            <p className="text-body-secondary small mb-0">
              Enter your details to start the demo training.
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label htmlFor="demo-name" className="form-label">
                Full Name
              </label>
              <input
                id="demo-name"
                type="text"
                className="form-control"
                required
                placeholder="Enter your full name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <div className="mb-3">
              <label htmlFor="demo-email" className="form-label">
                Email Address
              </label>
              <input
                id="demo-email"
                type="email"
                className="form-control"
                required
                placeholder="Enter your email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary w-100"
              disabled={isSubmitting || !guestName.trim() || !guestEmail.trim()}
            >
              {isSubmitting ? "Starting..." : "Start Demo Training"}
            </button>
          </form>

          <div className="text-center mt-3">
            <small className="text-body-secondary">
              No account required. Your session will be recorded as a guest demo.
            </small>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DemoTrainingLaunch;
