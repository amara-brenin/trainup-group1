const User = require("../models/User");
const Client = require("../models/Client");
const { ok, fail } = require("../helpers/response");
const { findSuperAdminByAppId } = require("../helpers/superAdminAuth");
const {
  signImpersonationToken,
  createImpersonationSession,
  consumeHandoff,
  closeAudit,
  logRestore,
  newAuditId,
} = require("../helpers/impersonation");

const activeUser = (user) => user && user.status !== "inactive" && user.isActivated !== false;

// ── FEATURE 1: Super Admin → Client Admin ────────────────────────────────────
// POST /api-v1/super-admin/impersonate/client/:clientId
// Route is already guarded by authTokenAdmin + allowRoles("super_admin"), so
// req.user here is always a genuine (non-impersonated) Super Admin.
const impersonateClient = async (req, res) => {
  const superAdmin = req.user;
  const clientId = String(req.params.clientId || "").trim();

  const client = await Client.findOne({ appId: clientId }).lean();
  if (!client) return fail(res, 404, "Client not found.");

  const clientAdmin =
    (client.clientAdminUserId
      ? await User.findOne({ appId: client.clientAdminUserId }).lean()
      : null) ||
    (await User.findOne({ clientId: client.appId, role: "admin" }).sort({ createdAt: 1 }).lean());

  if (!clientAdmin) return fail(res, 404, "This client has no admin user to impersonate.");
  if (!activeUser(clientAdmin)) return fail(res, 409, "The client admin account is not active.");

  const auditId = newAuditId();
  const imp = {
    rootId: superAdmin.appId,
    rootRole: "super_admin",
    stack: [{ appId: superAdmin.appId, role: "super_admin", clientId: "" }],
    level: 1,
    auditId,
  };
  const token = signImpersonationToken({
    target: { appId: clientAdmin.appId, role: clientAdmin.role, email: clientAdmin.email, clientId: clientAdmin.clientId },
    imp,
  });
  const { handoffCode } = await createImpersonationSession({
    req,
    token,
    auditAppId: auditId,
    action: "SUPER_ADMIN_LOGIN_AS_CLIENT_ADMIN",
    actorId: superAdmin.appId,
    actorRole: "super_admin",
    targetId: clientAdmin.appId,
    targetRole: clientAdmin.role,
    clientId: clientAdmin.clientId,
    rootId: superAdmin.appId,
    rootRole: "super_admin",
    level: 1,
  });

  return ok(res, "Impersonation session created.", {
    handoffCode,
    targetRole: clientAdmin.role,
    targetName: clientAdmin.name || clientAdmin.fullname || clientAdmin.email,
    targetClientId: clientAdmin.clientId,
  });
};

// ── FEATURE 2: Client Admin → User ───────────────────────────────────────────
// POST /api-v1/users/impersonate/:userId
// Callable by a real Client Admin, OR a Super Admin currently impersonating a
// Client Admin (effective role "admin", level 1, rootRole super_admin).
const impersonateUser = async (req, res) => {
  const actor = req.user; // effective identity (genuine admin or SA-as-CA)
  const imp = req.impersonation || null;

  if (actor.role !== "admin") {
    return fail(res, 403, "Only a client admin can access a user's panel.");
  }
  // Security: depth + chain shape. Allowed starting points are a genuine client
  // admin (no active impersonation) or a Super Admin already in as a client
  // admin. Anything else (e.g. a CA impersonating another CA) is rejected.
  const currentLevel = imp?.level || 0;
  const startedBySuperAdminAsClientAdmin = currentLevel === 1 && imp?.rootRole === "super_admin";
  if (currentLevel !== 0 && !startedBySuperAdminAsClientAdmin) {
    return fail(res, 403, "Impersonation chain is not allowed beyond Super Admin → Client Admin → User.");
  }

  const userId = String(req.params.userId || "").trim();
  const target = await User.findOne({ appId: userId }).lean();
  if (!target) return fail(res, 404, "User not found.");
  if (target.appId === actor.appId) return fail(res, 400, "You cannot impersonate yourself.");
  if (target.role === "super_admin") return fail(res, 403, "Super Admin accounts cannot be impersonated here.");
  // A client admin (or SA-as-CA) may only enter a non-admin user's panel.
  // Client Admin → Client Admin is not allowed.
  if (target.role === "admin") return fail(res, 403, "Another client admin cannot be impersonated here.");
  if (String(target.clientId) !== String(actor.clientId)) {
    return fail(res, 403, "You can only access users that belong to your client.");
  }
  if (!activeUser(target)) return fail(res, 409, "The target user account is not active.");

  const rootId = imp?.rootId || actor.appId;
  const rootRole = imp?.rootRole || actor.role;
  const stack = [
    ...(imp?.stack || []),
    { appId: actor.appId, role: actor.role, clientId: actor.clientId || "" },
  ];
  const level = stack.length;
  const action = rootRole === "super_admin" ? "SUPER_ADMIN_LOGIN_AS_USER" : "CLIENT_ADMIN_LOGIN_AS_USER";

  const auditId = newAuditId();
  const token = signImpersonationToken({
    target: { appId: target.appId, role: target.role, email: target.email, clientId: target.clientId },
    imp: { rootId, rootRole, stack, level, auditId },
  });
  const { handoffCode } = await createImpersonationSession({
    req,
    token,
    auditAppId: auditId,
    action,
    actorId: actor.appId,
    actorRole: actor.role,
    targetId: target.appId,
    targetRole: target.role,
    clientId: target.clientId,
    rootId,
    rootRole,
    level,
  });

  return ok(res, "Impersonation session created.", {
    handoffCode,
    targetRole: target.role,
    targetName: target.name || target.fullname || target.email,
    targetClientId: target.clientId,
  });
};

// ── FEATURE 3: Return flow ───────────────────────────────────────────────────
// POST /api-v1/auth/restore-session
// Pops one identity off the impersonation stack. Returning to the original
// (bottom of the stack) issues a normal session token; returning to an
// intermediate Client Admin (SA→CA→User case) issues a fresh impersonation token.
const restoreSession = async (req, res) => {
  const imp = req.impersonation || null;
  if (!imp || !Array.isArray(imp.stack) || !imp.stack.length) {
    return fail(res, 400, "This session is not impersonated.");
  }

  const parent = imp.stack[imp.stack.length - 1];
  const remaining = imp.stack.slice(0, -1);

  // Load the identity we are returning to and confirm it is still valid.
  let parentRecord;
  if (parent.role === "super_admin") {
    parentRecord = await findSuperAdminByAppId(parent.appId, { excludeImage: true });
  } else {
    parentRecord = await User.findOne({ appId: parent.appId }).lean();
  }
  if (!parentRecord || !activeUser(parentRecord)) {
    return fail(res, 401, "The original session is no longer available. Please sign in again.");
  }

  // Close the current impersonation audit.
  await closeAudit(imp.auditId);

  const parentTarget = {
    appId: parentRecord.appId,
    role: parentRecord.role,
    email: parentRecord.email,
    clientId: parentRecord.clientId || "",
  };

  // Returning to the bottom of the stack → restore the original (non-impersonated)
  // session with a fresh normal token. Returning to an intermediate Client Admin
  // (the SA→CA→User case) → a fresh impersonation token. Either way the new token
  // is carried cross-app via a single-use handoff (the root may be the Super
  // Admin app, which has its own token storage).
  let token;
  let auditAppId;
  let action;
  if (!remaining.length) {
    const { signAuthToken } = require("../helpers/auth");
    token = signAuthToken({
      sub: parentRecord.appId,
      role: parentRecord.role,
      email: parentRecord.email,
      clientId: parentRecord.clientId || "",
    });
    action = "RESTORE_SESSION";
  } else {
    auditAppId = newAuditId();
    token = signImpersonationToken({
      target: parentTarget,
      imp: { rootId: imp.rootId, rootRole: imp.rootRole, stack: remaining, level: remaining.length, auditId: auditAppId },
    });
    action = imp.rootRole === "super_admin" ? "SUPER_ADMIN_LOGIN_AS_CLIENT_ADMIN" : "CLIENT_ADMIN_LOGIN_AS_USER";
  }

  const { handoffCode } = await createImpersonationSession({
    req,
    token,
    auditAppId,
    action,
    actorId: req.user.appId,
    actorRole: req.user.role,
    targetId: parentRecord.appId,
    targetRole: parentRecord.role,
    clientId: parentRecord.clientId || "",
    rootId: imp.rootId,
    rootRole: imp.rootRole,
    level: remaining.length,
    endedAt: remaining.length ? null : new Date(),
  });

  // Always record the return event in the audit trail.
  await logRestore({
    req,
    actorId: req.user.appId,
    actorRole: req.user.role,
    targetId: parent.appId,
    targetRole: parent.role,
    clientId: parent.clientId || "",
    rootId: imp.rootId,
    rootRole: imp.rootRole,
    level: imp.level,
  });

  return ok(res, "Session restored.", {
    handoffCode,
    targetRole: parentRecord.role,
    targetName: parentRecord.name || parentRecord.fullname || parentRecord.email,
    targetClientId: parentRecord.clientId || "",
  });
};

// Cross-app handoff exchange (public — the target app has no token yet).
// POST /api-v1/auth/impersonation/exchange  { code }
const exchangeHandoff = async (req, res) => {
  const code = String(req.body.code || "").trim();
  const result = await consumeHandoff(code);
  if (!result) {
    return fail(res, 400, "This impersonation link is invalid or has expired.");
  }
  return ok(res, "Session ready.", { token: result.token });
};

module.exports = {
  impersonateClient,
  impersonateUser,
  restoreSession,
  exchangeHandoff,
};
