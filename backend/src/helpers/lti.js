const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const Client = require("../models/Client");
const { getToolKeypair } = require("./ltiKeys");

// LTI 1.3 core protocol helpers (LMS_INTEGRATION_RESEARCH.md — Method B).
// TrainUp is the Tool; the customer's LMS is the Platform.

const CLAIM = {
  messageType: "https://purl.imsglobal.org/spec/lti/claim/message_type",
  version: "https://purl.imsglobal.org/spec/lti/claim/version",
  deploymentId: "https://purl.imsglobal.org/spec/lti/claim/deployment_id",
  targetLinkUri: "https://purl.imsglobal.org/spec/lti/claim/target_link_uri",
  resourceLink: "https://purl.imsglobal.org/spec/lti/claim/resource_link",
  custom: "https://purl.imsglobal.org/spec/lti/claim/custom",
  roles: "https://purl.imsglobal.org/spec/lti/claim/roles",
  ags: "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint",
  // Deep Linking 1.3
  dlSettings: "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings",
  dlContentItems: "https://purl.imsglobal.org/spec/lti-dl/claim/content_items",
  dlData: "https://purl.imsglobal.org/spec/lti-dl/claim/data",
};

// ---- short-lived OIDC state/nonce store (single-instance, in-memory) ----
const stateStore = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;
const putState = (state, data) => {
  stateStore.set(state, { ...data, exp: Date.now() + STATE_TTL_MS });
};
const takeState = (state) => {
  const entry = stateStore.get(state);
  if (!entry) return null;
  stateStore.delete(state);
  if (entry.exp < Date.now()) return null;
  return entry;
};

// Resolve which tenant a launch belongs to by its registered LTI client_id.
const findClientByRegistration = async (clientId, iss) => {
  const normalized = String(clientId || "").trim();
  if (!normalized) return null;
  const candidates = await Client.find({ ltiClientId: normalized }).lean();
  if (candidates.length <= 1) return candidates[0] || null;
  // Disambiguate multiple registrations sharing a client_id by issuer host.
  const issHost = (() => { try { return new URL(iss).host; } catch { return ""; } })();
  return (
    candidates.find((c) => issHost && (c.ltiPlatformKeysetUrl || "").includes(issHost)) || candidates[0]
  );
};

// ---- platform JWKS (cached briefly) ----
const jwksCache = new Map();
const fetchPlatformJwks = async (keysetUrl) => {
  const cached = jwksCache.get(keysetUrl);
  if (cached && cached.exp > Date.now()) return cached.keys;
  const res = await fetch(keysetUrl);
  if (!res.ok) throw new Error(`JWKS fetch failed (HTTP ${res.status}).`);
  const body = await res.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(keysetUrl, { keys, exp: Date.now() + 5 * 60 * 1000 });
  return keys;
};

// Verify a platform-signed id_token (RS256) against the platform JWKS and the
// tenant's registration. Returns the decoded claims.
const verifyPlatformToken = async (idToken, client) => {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header?.kid) throw new Error("id_token missing key id.");

  const keys = await fetchPlatformJwks(client.ltiPlatformKeysetUrl);
  const jwk = keys.find((k) => k.kid === decoded.header.kid);
  if (!jwk) throw new Error("No matching platform key for id_token.");

  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  return jwt.verify(idToken, publicKey, {
    algorithms: ["RS256"],
    audience: client.ltiClientId,
  });
};

// ---- AGS (Assignment & Grade Services): push a score to the LMS gradebook ----

// Mint a client_credentials access token from the platform using a private_key_jwt
// assertion signed with the Tool's key.
const getAgsAccessToken = async (client, scopes) => {
  const { privateKeyPem, kid } = await getToolKeypair();
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: client.ltiClientId,
      sub: client.ltiClientId,
      aud: client.ltiAccessTokenUrl,
      iat: now,
      exp: now + 300,
      jti: crypto.randomBytes(16).toString("hex"),
    },
    privateKeyPem,
    { algorithm: "RS256", keyid: kid },
  );

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
    scope: scopes.join(" "),
  });

  const res = await fetch(client.ltiAccessTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`AGS token request failed (HTTP ${res.status}).`);
  const body = await res.json();
  if (!body.access_token) throw new Error("AGS token response missing access_token.");
  return body.access_token;
};

// The scores resource is "<lineitem>/scores" with any query string preserved.
const buildScoresUrl = (lineitem) => {
  const [path, query] = String(lineitem || "").split("?");
  return `${path.replace(/\/+$/, "")}/scores${query ? `?${query}` : ""}`;
};

const AGS_SCORE_SCOPE = "https://purl.imsglobal.org/spec/lti-ags/scope/score";

// Post a score (0..100) for a learner to the LMS gradebook via AGS.
const postAgsScore = async (client, ags, { userId, score }) => {
  if (!ags?.lineitem || !client.ltiAccessTokenUrl) {
    return { success: false, message: "Missing AGS line item or token endpoint." };
  }
  const scopes = Array.isArray(ags.scopes) && ags.scopes.includes(AGS_SCORE_SCOPE)
    ? [AGS_SCORE_SCOPE]
    : [AGS_SCORE_SCOPE];

  const token = await getAgsAccessToken(client, scopes);
  const numericScore = typeof score === "number" && !Number.isNaN(score) ? score : 0;

  const res = await fetch(buildScoresUrl(ags.lineitem), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.ims.lis.v1.score+json",
    },
    body: JSON.stringify({
      userId,
      scoreGiven: numericScore,
      scoreMaximum: 100,
      activityProgress: "Completed",
      gradingProgress: "FullyGraded",
      timestamp: new Date().toISOString(),
    }),
  });

  return {
    success: res.ok,
    status: res.status,
    message: res.ok ? "Score posted to LMS gradebook." : `AGS score post failed (HTTP ${res.status}).`,
  };
};

// Build a signed Deep Linking response JWT (signed with the Tool key) that the
// browser auto-POSTs back to the platform's return URL. Carries the chosen
// training(s) as ltiResourceLink content items so the LMS stores the activity.
const buildDeepLinkingResponse = async ({ client, platformIss, deployment, contentItems, data }) => {
  const { privateKeyPem, kid } = await getToolKeypair();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: client.ltiClientId,
    aud: platformIss,
    iat: now,
    exp: now + 600,
    nonce: crypto.randomBytes(16).toString("hex"),
    [CLAIM.messageType]: "LtiDeepLinkingResponse",
    [CLAIM.version]: "1.3.0",
    [CLAIM.deploymentId]: deployment,
    [CLAIM.dlContentItems]: contentItems,
  };
  if (data) payload[CLAIM.dlData] = data;
  return jwt.sign(payload, privateKeyPem, { algorithm: "RS256", keyid: kid });
};

// Fire-and-forget grade passback used at completion. Loads the tenant, posts the
// score to the gradebook, and records a delivery log. Never throws.
const deliverLtiGrade = async ({ clientId, ags, score }) => {
  try {
    if (!ags?.lineitem || !ags?.userId) return;
    const { getTenantSetting, setTenantSetting } = require("./tenant");
    const { appendWebhookLog } = require("./clientDelivery");

    const client = await Client.findOne({ appId: clientId });
    if (!client || !client.ltiAccessTokenUrl) return;

    let result;
    try {
      result = await postAgsScore(client, ags, { userId: ags.userId, score });
    } catch (error) {
      result = { success: false, status: 503, message: error instanceof Error ? error.message : "AGS failed." };
    }

    const stored = await getTenantSetting(clientId, "webhookConfig", {});
    await setTenantSetting(clientId, "webhookConfig", {
      ...stored,
      logs: appendWebhookLog(stored, {
        id: `lti-${Date.now()}`,
        timestamp: new Date().toISOString(),
        event: "lti.score",
        ssoId: ags.userId,
        status: result.status || (result.success ? 200 : 503),
        latencyMs: null,
      }),
    });
  } catch {
    // best-effort; never affect the learner's completion
  }
};

module.exports = {
  CLAIM,
  putState,
  takeState,
  findClientByRegistration,
  verifyPlatformToken,
  buildDeepLinkingResponse,
  postAgsScore,
  deliverLtiGrade,
  getAgsAccessToken,
  buildScoresUrl,
  AGS_SCORE_SCOPE,
};
