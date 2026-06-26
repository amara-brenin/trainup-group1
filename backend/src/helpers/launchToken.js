const crypto = require("crypto");
const config = require("../config");

// ---------------------------------------------------------------------------
// Signed external launch tokens (LMS_INTEGRATION_RESEARCH.md — Method A / E).
//
// A stateless, HMAC-signed, expiring token that encodes which training a learner
// may open inside an external LMS (web link or iframe), plus their identity.
// Mirrors the demo-token + impersonation-handoff patterns, but the token itself
// is the authorization — no DB row required.
//
// Format:  base64url(JSON payload) "." base64url(HMAC-SHA256 of the payload)
// Secret:  config.authSecret (per-deployment).
// ---------------------------------------------------------------------------

const SECRET = config.authSecret;

const base64url = (input) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromBase64url = (input) => {
  const padded = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
};

const sign = (encodedPayload) =>
  base64url(crypto.createHmac("sha256", SECRET).update(encodedPayload).digest());

// Build a signed launch token. `expiresInMinutes` defaults to 7 days — long
// enough for an LMS to keep the link usable, short enough to bound exposure.
const signLaunchToken = ({
  trainingId,
  clientId = "",
  learnerId = "",
  learnerName = "",
  learnerEmail = "",
  expiresInMinutes = 60 * 24 * 7,
}) => {
  const normalizedTrainingId = String(trainingId || "").trim();
  if (!normalizedTrainingId) {
    throw new Error("trainingId is required to sign a launch token.");
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    t: normalizedTrainingId,
    c: String(clientId || "").trim(),
    lid: String(learnerId || "").trim(),
    ln: String(learnerName || "").trim(),
    le: String(learnerEmail || "").trim(),
    iat: issuedAt,
    exp: issuedAt + Math.max(1, Math.round(Number(expiresInMinutes) || 0)) * 60,
    n: crypto.randomBytes(8).toString("hex"),
  };

  const encodedPayload = base64url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
};

// Verify a launch token. Returns a normalized identity object or null when the
// token is malformed, tampered with, or expired.
const verifyLaunchToken = (token) => {
  const raw = String(token || "").trim();
  if (!raw || !raw.includes(".")) {
    return null;
  }

  const [encodedPayload, providedSignature] = raw.split(".");
  if (!encodedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);
  const expectedBuf = Buffer.from(expectedSignature);
  const providedBuf = Buffer.from(providedSignature);
  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64url(encodedPayload).toString("utf8"));
  } catch {
    return null;
  }

  if (!payload || !payload.t) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) {
    return null;
  }

  return {
    trainingId: String(payload.t || ""),
    clientId: String(payload.c || ""),
    learnerId: String(payload.lid || ""),
    learnerName: String(payload.ln || ""),
    learnerEmail: String(payload.le || ""),
    issuedAt: payload.iat || null,
    expiresAt: payload.exp || null,
  };
};

module.exports = { signLaunchToken, verifyLaunchToken };
