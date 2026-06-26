import { useState } from "react";
import AxiosHelper from "../../helper/AxiosHelper";

// LMS_INTEGRATION_RESEARCH.md (Method A/E): generate a signed, expiring launch
// link an admin can paste into their LMS as a web link / iframe activity. The
// backend mints an HMAC-signed token; the resulting URL opens the live player.

type LaunchUrlResponse = {
  trainingId: string;
  token: string;
  launchUrl: string;
  expiresInMinutes: number;
};

const LmsLaunchLinkGenerator = ({ trainingId }: { trainingId: string }) => {
  const [learnerName, setLearnerName] = useState("");
  const [learnerEmail, setLearnerEmail] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [launchUrl, setLaunchUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    if (!trainingId) {
      setError("Save and approve this training first to generate a launch link.");
      return;
    }
    setIsGenerating(true);
    setError("");
    setCopied(false);
    try {
      const { data } = await AxiosHelper.postData<LaunchUrlResponse, Record<string, string>>(
        `/training-workspace/${trainingId}/launch-url`,
        {
          learnerName: learnerName.trim(),
          learnerEmail: learnerEmail.trim(),
        },
      );
      if (!data.status || !data.data) {
        throw new Error(data.message || "Could not generate launch link.");
      }
      setLaunchUrl(data.data.launchUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not generate launch link.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="mt-4 pt-3 border-top">
      <label className="form-label fw-semibold">
        <i className="ri-links-line me-1" />LMS / Embed launch link
      </label>
      <div className="form-text mb-2">
        Generate a signed, expiring link to embed this training in any LMS (web link or iframe).
        Leave learner fields blank for a generic link that asks each learner for their details.
      </div>
      <div className="row g-2 mb-2">
        <div className="col-12 col-md-6">
          <input
            type="text"
            className="form-control form-control-sm"
            placeholder="Learner name (optional)"
            value={learnerName}
            onChange={(e) => setLearnerName(e.target.value)}
          />
        </div>
        <div className="col-12 col-md-6">
          <input
            type="email"
            className="form-control form-control-sm"
            placeholder="Learner email (optional)"
            value={learnerEmail}
            onChange={(e) => setLearnerEmail(e.target.value)}
          />
        </div>
      </div>
      <button
        type="button"
        className="btn btn-outline-primary btn-sm"
        onClick={() => void handleGenerate()}
        disabled={isGenerating}
      >
        {isGenerating ? "Generating..." : "Generate launch link"}
      </button>

      {error ? <div className="text-danger small mt-2">{error}</div> : null}

      {launchUrl ? (
        <div className="mt-2">
          <div className="input-group">
            <input type="text" className="form-control form-control-sm bg-light" readOnly value={launchUrl} />
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => {
                void navigator.clipboard.writeText(launchUrl);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="form-text">Default validity 7 days. Generate again to issue a fresh link.</div>
        </div>
      ) : null}
    </div>
  );
};

export default LmsLaunchLinkGenerator;
