const crypto = require("crypto");
const Training = require("../models/Training");
const config = require("../config");
const { ok, fail } = require("../helpers/response");
const { getToolJwks } = require("../helpers/ltiKeys");
const { signLaunchToken } = require("../helpers/launchToken");
const { buildPublicUrl } = require("../helpers/publicUrl");
const {
  CLAIM,
  putState,
  takeState,
  findClientByRegistration,
  verifyPlatformToken,
  buildDeepLinkingResponse,
} = require("../helpers/lti");

const jwt = require("jsonwebtoken");
const normalizeValue = (value) => String(value || "").trim();
const escapeHtml = (value) =>
  String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Public JWKS — the platform fetches this to verify the Tool's signed requests.
const jwks = async (_req, res) => {
  return res.status(200).json(await getToolJwks());
};

const toolBaseUrl = (req) => `${req.protocol}://${req.get("host")}${config.apiPrefix}`;
const frontendBaseUrl = (req, client) =>
  (client?.domain ? `https://${client.domain}` : "") ||
  config.frontendBaseUrl ||
  `${req.protocol}://${req.get("host")}`;

// OIDC 3rd-party login initiation. The platform calls this first; we bounce the
// browser back to the platform's auth endpoint with state + nonce.
const login = async (req, res) => {
  const src = req.method === "POST" ? req.body : req.query;
  const clientId = normalizeValue(src.client_id);
  const iss = normalizeValue(src.iss);
  const loginHint = normalizeValue(src.login_hint);
  const messageHint = normalizeValue(src.lti_message_hint);
  const targetLinkUri = normalizeValue(src.target_link_uri);

  const client = await findClientByRegistration(clientId, iss);
  if (!client || !client.ltiOidcAuthUrl) {
    return fail(res, 400, "Unknown or unconfigured LTI registration.");
  }

  const state = crypto.randomBytes(16).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");
  putState(state, { nonce, clientId, iss, targetLinkUri });

  const params = new URLSearchParams({
    scope: "openid",
    response_type: "id_token",
    response_mode: "form_post",
    prompt: "none",
    client_id: clientId,
    redirect_uri: `${toolBaseUrl(req)}/lti/launch`,
    login_hint: loginHint,
    state,
    nonce,
  });
  if (messageHint) params.set("lti_message_hint", messageHint);

  return res.redirect(`${client.ltiOidcAuthUrl}?${params.toString()}`);
};

// Resource-link launch. The platform POSTs a signed id_token; we verify it and
// open the training as that learner, carrying the AGS context for grade passback.
const launch = async (req, res) => {
  const idToken = normalizeValue(req.body.id_token);
  const state = normalizeValue(req.body.state);
  if (!idToken || !state) {
    return fail(res, 400, "Missing id_token or state.");
  }

  const entry = takeState(state);
  if (!entry) {
    return fail(res, 400, "Invalid or expired launch state.");
  }

  const header = jwt.decode(idToken, { complete: true });
  const audClaim = header?.payload?.aud;
  const aud = Array.isArray(audClaim) ? audClaim[0] : audClaim;
  const client = await findClientByRegistration(aud || entry.clientId, header?.payload?.iss);
  if (!client) {
    return fail(res, 400, "Unknown LTI registration for this launch.");
  }

  let claims;
  try {
    claims = await verifyPlatformToken(idToken, client);
  } catch (error) {
    return fail(res, 401, error instanceof Error ? error.message : "id_token verification failed.");
  }

  if (claims.nonce !== entry.nonce) {
    return fail(res, 401, "Launch nonce mismatch.");
  }
  if (normalizeValue(claims[CLAIM.version]) !== "1.3.0") {
    return fail(res, 400, "Unsupported LTI version.");
  }
  const deployment = normalizeValue(claims[CLAIM.deploymentId]);
  if (client.ltiDeploymentId && deployment && deployment !== client.ltiDeploymentId) {
    return fail(res, 401, "Deployment id mismatch.");
  }

  const messageType = normalizeValue(claims[CLAIM.messageType]);
  // Deep Linking: the instructor is picking content → show the content picker.
  if (messageType === "LtiDeepLinkingRequest") {
    const dlSettings = claims[CLAIM.dlSettings] || {};
    const dlt = jwt.sign(
      {
        c: client.appId,
        iss: normalizeValue(claims.iss),
        dep: deployment,
        ru: normalizeValue(dlSettings.deep_link_return_url),
        data: dlSettings.data || "",
      },
      config.authSecret,
      { expiresIn: "15m" },
    );
    return res.redirect(`${toolBaseUrl(req)}/lti/deep-link/select?dlt=${encodeURIComponent(dlt)}`);
  }
  if (messageType !== "LtiResourceLinkRequest") {
    return fail(res, 400, "Unsupported LTI message type.");
  }

  // Which training? Prefer a custom parameter, fall back to target_link_uri ?training=.
  const custom = claims[CLAIM.custom] || {};
  let trainingId = normalizeValue(custom.trainingid || custom.training_id);
  if (!trainingId) {
    try {
      trainingId = new URL(claims[CLAIM.targetLinkUri] || entry.targetLinkUri).searchParams.get("training") || "";
    } catch {
      trainingId = "";
    }
  }
  trainingId = normalizeValue(trainingId);
  if (!trainingId) {
    return fail(res, 400, "Launch did not specify which training to open (set custom parameter 'trainingid').");
  }

  const training = await Training.findOne({ appId: trainingId, clientId: client.appId }).lean();
  if (!training || normalizeValue(training.payload?.status) !== "approved") {
    return fail(res, 404, "Training not found or not approved for this LMS registration.");
  }

  // AGS context (if the platform offered grade services) → carried in the token
  // so completion can post the score to the gradebook.
  const agsClaim = claims[CLAIM.ags];
  const ags = agsClaim?.lineitem
    ? { lineitem: agsClaim.lineitem, scopes: agsClaim.scope || [], userId: normalizeValue(claims.sub) }
    : null;

  const token = signLaunchToken({
    trainingId: training.appId,
    clientId: client.appId,
    learnerId: normalizeValue(claims.sub),
    learnerName: normalizeValue(claims.name) || normalizeValue(claims.given_name),
    learnerEmail: normalizeValue(claims.email),
    expiresInMinutes: 60 * 12,
    ags,
  });

  // For automated tests, allow returning the resolved launch as JSON.
  if (normalizeValue(req.query.format) === "json" || normalizeValue(req.body.format) === "json") {
    return ok(res, "LTI launch verified.", {
      trainingId: training.appId,
      launchUrl: `${frontendBaseUrl(req, client)}/secure-launch/${token}`,
      learner: { id: claims.sub, name: claims.name, email: claims.email },
      ags,
    });
  }

  return res.redirect(buildPublicUrl(frontendBaseUrl(req, client), `/secure-launch/${token}`));
};

// Deep Linking content picker — instructor chooses a training from a list.
const selectContent = async (req, res) => {
  let dl;
  try {
    dl = jwt.verify(normalizeValue(req.query.dlt), config.authSecret);
  } catch {
    return fail(res, 400, "Invalid or expired content-picker session.");
  }

  const trainings = await Training.find(
    { clientId: dl.c, "payload.status": "approved" },
    { appId: 1, "payload.title": 1 },
  ).lean();

  const rows = trainings
    .map(
      (tr) => `
        <label class="item">
          <input type="radio" name="trainingId" value="${escapeHtml(tr.appId)}" required />
          <span>${escapeHtml(tr.payload?.title || tr.appId)}</span>
        </label>`,
    )
    .join("");

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Select a TrainUp training</title>
<style>
  body{font-family:Arial,sans-serif;margin:0;background:#f6f7f9;color:#1f2937}
  .wrap{max-width:640px;margin:0 auto;padding:24px}
  h1{font-size:18px}
  .item{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px;cursor:pointer}
  .item:hover{border-color:#6366f1}
  button{background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:14px;cursor:pointer;margin-top:12px}
  .empty{padding:16px;background:#fff;border-radius:10px;border:1px solid #e5e7eb}
</style></head><body><div class="wrap">
  <h1>Add a TrainUp training</h1>
  ${trainings.length ? `<form method="POST" action="${toolBaseUrl(req)}/lti/deep-link/return">
    <input type="hidden" name="dlt" value="${escapeHtml(req.query.dlt)}" />
    ${rows}
    <button type="submit">Add to course</button>
  </form>` : `<div class="empty">No approved trainings available to add yet.</div>`}
</div></body></html>`;

  return res.status(200).send(html);
};

// Deep Linking return — build the signed response and auto-POST it to the LMS.
const returnContent = async (req, res) => {
  let dl;
  try {
    dl = jwt.verify(normalizeValue(req.body.dlt), config.authSecret);
  } catch {
    return fail(res, 400, "Invalid or expired content-picker session.");
  }

  const trainingId = normalizeValue(req.body.trainingId);
  const training = await Training.findOne({ appId: trainingId, clientId: dl.c }).lean();
  if (!training || normalizeValue(training.payload?.status) !== "approved") {
    return fail(res, 404, "Selected training is not available.");
  }

  const client = await require("../models/Client").findOne({ appId: dl.c }).lean();
  if (!client) return fail(res, 404, "Tenant not found.");

  const contentItems = [
    {
      type: "ltiResourceLink",
      title: normalizeValue(training.payload?.title) || "Training",
      url: `${toolBaseUrl(req)}/lti/launch`,
      custom: { trainingid: training.appId },
    },
  ];

  const responseJwt = await buildDeepLinkingResponse({
    client,
    platformIss: dl.iss,
    deployment: dl.dep,
    contentItems,
    data: dl.data,
  });

  // Auto-submitting form posts the signed JWT back to the platform.
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head>
<body onload="document.forms[0].submit()">
  <form method="POST" action="${escapeHtml(dl.ru)}">
    <input type="hidden" name="JWT" value="${escapeHtml(responseJwt)}" />
    <noscript><button type="submit">Return to your LMS</button></noscript>
  </form>
</body></html>`;

  return res.status(200).send(html);
};

module.exports = { jwks, login, launch, selectContent, returnContent };
