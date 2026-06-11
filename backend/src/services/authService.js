const crypto = require("crypto");
const AuthToken = require("../models/AuthToken");
const Client = require("../models/Client");
const SuperAdmin = require("../models/SuperAdmin");
const User = require("../models/User");
const config = require("../config");
const { hashPassword } = require("../helpers/auth");
const { sendAccountActionEmail } = require("../helpers/clientDelivery");
const { buildPublicUrl } = require("../helpers/publicUrl");

const TOKEN_TTL_MINUTES = 30;

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

const createRawToken = () => crypto.randomBytes(32).toString("base64url");

const getUserModelName = (user) => (user?.role === "super_admin" ? "SuperAdmin" : "User");

const findTokenUser = async (record) => {
  if (!record) {
    return null;
  }

  return record.userModel === "SuperAdmin"
    ? SuperAdmin.findOne({ appId: record.userId })
    : User.findOne({ appId: record.userId });
};

const findClientForUser = async (user) => {
  const clientId = String(user?.clientId || "").trim();
  return clientId ? Client.findOne({ appId: clientId }) : null;
};

// The bare request origin (scheme://host), no configured base/app URL.
const resolveRequestOrigin = (req) => {
  const origin = String(req?.headers?.origin || "").trim();
  if (origin) {
    return origin.replace(/\/+$/, "");
  }

  const referer = String(req?.headers?.referer || "").trim();
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // Fall back to forwarded host below when the referer is malformed.
    }
  }

  const protocol = req?.headers?.["x-forwarded-proto"] || req?.protocol || "http";
  const host = req?.headers?.["x-forwarded-host"] || req?.headers?.host || "";
  return host ? `${protocol}://${host}` : "";
};

const withoutConsolePath = (value) => String(value || "").trim().replace(/\/console\/?$/i, "").replace(/\/+$/, "");

const buildActionUrl = (req, purpose, token, user) => {
  const path = purpose === "reset_password" ? "/reset-password" : "/set-password";
  const query = `?token=${encodeURIComponent(token)}`;

  // Explicitly configured app URLs already include the deployment subpath →
  // use them as-is (do not prepend PUBLIC_BASE_PATH, which would double it).
  const configured = user?.role === "super_admin"
    ? (config.superAdminAppUrl || config.frontendBaseUrl)
    : (config.adminAppUrl || withoutConsolePath(config.frontendBaseUrl));
  if (configured) {
    return `${String(configured).replace(/\/+$/, "")}${path}${query}`;
  }

  // Fallback to the bare request origin → prepend the admin base path. Prefer
  // the per-request X-App-Base-Path header, else PUBLIC_BASE_PATH.
  const headerBase = req?.headers?.["x-app-base-path"];
  return `${buildPublicUrl(resolveRequestOrigin(req), path, headerBase)}${query}`;
};

const createAuthToken = async ({ user, purpose, createdBy = "" }) => {
  const rawToken = createRawToken();
  const tokenHash = hashToken(rawToken);
  const userModel = getUserModelName(user);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  await AuthToken.updateMany(
    {
      userId: user.appId,
      userModel,
      purpose,
      usedAt: null,
    },
    { $set: { usedAt: new Date() } },
  );

  await AuthToken.create({
    tokenHash,
    purpose,
    userId: user.appId,
    userModel,
    clientId: user.clientId || "",
    expiresAt,
    createdBy,
  });

  return { rawToken, expiresAt };
};

const issuePasswordEmail = async ({ req, user, purpose, forcePlatform = false, createdBy = "" }) => {
  const { rawToken, expiresAt } = await createAuthToken({ user, purpose, createdBy });
  const client = await findClientForUser(user);
  const actionUrl = buildActionUrl(req, purpose, rawToken, user);
  const emailResult = await sendAccountActionEmail({
    client,
    user,
    actionUrl,
    purpose,
    forcePlatform: forcePlatform || user.role === "super_admin",
  });

  return {
    expiresAt,
    actionUrl,
    emailResult,
  };
};

const validatePasswordToken = async (token, expectedPurpose = "") => {
  const record = await AuthToken.findOne({ tokenHash: hashToken(token) });

  if (!record || record.usedAt) {
    return { ok: false, message: "This link is invalid or has already been used." };
  }

  if (expectedPurpose && record.purpose !== expectedPurpose) {
    return { ok: false, message: "This link is not valid for this action." };
  }

  if (record.expiresAt.getTime() < Date.now()) {
    return { ok: false, message: "This link has expired. Request a new one." };
  }

  const user = await findTokenUser(record);
  if (!user) {
    return { ok: false, message: "This account no longer exists." };
  }

  return { ok: true, record, user };
};

const completePasswordToken = async ({ token, purpose, password }) => {
  const result = await validatePasswordToken(token, purpose);

  if (!result.ok) {
    return result;
  }

  result.user.passwordHash = hashPassword(password);
  result.user.isActivated = true;
  result.user.activatedAt = new Date();
  result.user.authProvider = result.user.authProvider || "password";
  result.record.usedAt = new Date();

  await Promise.all([result.user.save(), result.record.save()]);
  return { ok: true, user: result.user };
};

module.exports = {
  TOKEN_TTL_MINUTES,
  completePasswordToken,
  issuePasswordEmail,
  validatePasswordToken,
};
