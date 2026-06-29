const crypto = require("crypto");
const Setting = require("../models/Setting");

// LTI 1.3 (LMS_INTEGRATION_RESEARCH.md — Method B): the Tool's own RSA keypair.
// Used to sign service calls to the platform (AGS token requests, deep-linking
// responses) and exposed as a public JWKS so the platform can verify them.
// Generated once and persisted in the Setting collection; reused thereafter.

const SETTING_KEY = "ltiToolKeypair";

let cached = null;

const generateKeypair = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = crypto.randomBytes(8).toString("hex");
  return {
    kid,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicJwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" },
  };
};

// Get-or-create the Tool keypair (cached in-process after first load).
const getToolKeypair = async () => {
  if (cached) return cached;
  const existing = await Setting.findOne({ key: SETTING_KEY }).lean();
  if (existing?.value?.privateKeyPem) {
    cached = existing.value;
    return cached;
  }
  const generated = generateKeypair();
  await Setting.updateOne({ key: SETTING_KEY }, { $set: { value: generated } }, { upsert: true });
  cached = generated;
  return cached;
};

// Public JWKS document for the /lti/jwks endpoint.
const getToolJwks = async () => {
  const { publicJwk } = await getToolKeypair();
  return { keys: [publicJwk] };
};

module.exports = { getToolKeypair, getToolJwks };
