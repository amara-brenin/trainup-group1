const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");
const ImpersonationAudit = require("../models/ImpersonationAudit");

// Impersonation tokens are short-lived (2h) and clearly marked with an `imp`
// claim. They are ordinary signed JWTs verified by the same authTokenAdmin
// middleware, so the existing auth flow is untouched.
const IMPERSONATION_TOKEN_EXPIRY = "2h";
const HANDOFF_TTL_MS = 60 * 1000; // single-use cross-app code lives 60s
const MAX_DEPTH = 2; // Super Admin -> Client Admin -> User. No deeper.

const newId = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const newAuditId = () => newId("imp");

// Sign a JWT that authenticates as `target` while carrying the impersonation
// chain in `imp`. Same shape as a normal auth token plus the `imp` claim.
const signImpersonationToken = ({ target, imp }) =>
  jwt.sign(
    {
      sub: target.appId,
      role: target.role,
      email: target.email || "",
      clientId: target.clientId || "",
      imp,
    },
    config.authSecret,
    { expiresIn: IMPERSONATION_TOKEN_EXPIRY },
  );

const getRequestMeta = (req) => ({
  ipAddress: String(
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      "",
  ).slice(0, 80),
  userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
});

// Create the audit row + a single-use handoff for the signed token.
const createImpersonationSession = async ({
  req,
  token,
  action,
  actorId,
  actorRole,
  targetId,
  targetRole,
  clientId,
  rootId,
  rootRole,
  level,
  auditAppId,
  endedAt = null,
}) => {
  const meta = getRequestMeta(req);
  const handoffCode = crypto.randomBytes(32).toString("hex");
  const audit = await ImpersonationAudit.create({
    appId: auditAppId || newId("imp"),
    actorId,
    actorRole,
    targetId,
    targetRole,
    clientId: clientId || "",
    action,
    rootId,
    rootRole,
    level,
    startedAt: new Date(),
    endedAt,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    handoffCode,
    handoffToken: token,
    handoffExpiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
    handoffConsumedAt: null,
  });
  return { audit, handoffCode };
};

// Exchange a one-time handoff code for the signed impersonation JWT. Single use,
// time-bound; the token is wiped from the row after it is handed out.
const consumeHandoff = async (code) => {
  const normalized = String(code || "").trim();
  if (!normalized) return null;

  const audit = await ImpersonationAudit.findOne({ handoffCode: normalized });
  if (!audit) return null;
  if (audit.handoffConsumedAt) return null;
  if (!audit.handoffExpiresAt || audit.handoffExpiresAt.getTime() < Date.now()) return null;

  const token = audit.handoffToken;
  audit.handoffConsumedAt = new Date();
  audit.handoffToken = "";
  audit.handoffCode = null;
  await audit.save();

  return { token, audit };
};

const closeAudit = async (auditId) => {
  if (!auditId) return;
  await ImpersonationAudit.updateOne(
    { appId: auditId, endedAt: null },
    { $set: { endedAt: new Date() } },
  );
};

const logRestore = async ({ req, actorId, actorRole, targetId, targetRole, clientId, rootId, rootRole, level }) => {
  const meta = getRequestMeta(req);
  await ImpersonationAudit.create({
    appId: newId("imp"),
    actorId,
    actorRole,
    targetId,
    targetRole,
    clientId: clientId || "",
    action: "RESTORE_SESSION",
    rootId,
    rootRole,
    level,
    startedAt: new Date(),
    endedAt: new Date(),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
};

// Build the display context the frontend banner needs from a token `imp` claim.
const buildImpersonationContext = (imp, currentUser) => {
  if (!imp || !Array.isArray(imp.stack) || !imp.stack.length) return null;
  const parent = imp.stack[imp.stack.length - 1];
  return {
    active: true,
    level: imp.level || imp.stack.length,
    rootRole: imp.rootRole || "",
    currentName: currentUser?.name || currentUser?.fullname || "",
    currentRole: currentUser?.role || "",
    returnToRole: parent?.role || "",
    returnLabel: parent?.role === "super_admin" ? "Return to Super Admin" : "Return to Admin",
  };
};

module.exports = {
  IMPERSONATION_TOKEN_EXPIRY,
  MAX_DEPTH,
  newAuditId,
  signImpersonationToken,
  createImpersonationSession,
  consumeHandoff,
  closeAudit,
  logRestore,
  buildImpersonationContext,
  getRequestMeta,
};
