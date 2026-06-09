const crypto = require("crypto");
const AuthToken = require("../models/AuthToken");
const Client = require("../models/Client");
const SuperAdmin = require("../models/SuperAdmin");
const User = require("../models/User");
const config = require("../config");
const { hashPassword } = require("../helpers/auth");
const { sendAccountActionEmail } = require("../helpers/clientDelivery");

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

const resolveBaseUrl = (req) => {
  if (config.frontendBaseUrl) {
    return config.frontendBaseUrl;
  }

  const origin = String(req?.headers?.origin || "").trim();
  if (origin) {
    return origin.replace(/\/+$/, "");
  }

  const referer = String(req?.headers?.referer || "").trim();
  if (referer) {
    try {
      const parsed = new URL(referer);
      return parsed.origin;
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
  const fallbackBaseUrl = resolveBaseUrl(req);
  const baseUrl = user?.role === "super_admin"
    ? (config.superAdminAppUrl || config.frontendBaseUrl || fallbackBaseUrl)
    : (config.adminAppUrl || withoutConsolePath(config.frontendBaseUrl || fallbackBaseUrl));
  const path = purpose === "reset_password" ? "/reset-password" : "/set-password";
  return `${String(baseUrl || "").replace(/\/+$/, "")}${path}?token=${encodeURIComponent(token)}`;
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
