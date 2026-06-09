const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { buildRoleAccess, resolveUserAccess } = require("./permissions");

const TOKEN_EXPIRY = "7d";

const hashPassword = (password) => {
  if (!String(password || "").trim()) {
    throw new Error("Password is required.");
  }

  return bcrypt.hashSync(String(password), 12);
};

const hashLegacyPassword = (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

const verifyPassword = (password, storedValue) => {
  if (String(storedValue || "").startsWith("$2")) {
    return bcrypt.compareSync(String(password || ""), String(storedValue || ""));
  }

  const [salt, hash] = String(storedValue || "").split(":");

  if (!salt || !hash) {
    return false;
  }

  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
};

const signAuthToken = (payload) =>
  jwt.sign(payload, config.authSecret, {
    expiresIn: TOKEN_EXPIRY,
  });

const verifyAuthToken = (token) => {
  try {
    return jwt.verify(token, config.authSecret);
  } catch (_error) {
    return null;
  }
};

const getBearerToken = (req) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader || !String(authHeader).startsWith("Bearer ")) {
    return "";
  }

  return String(authHeader).slice(7).trim();
};

const getRoleAccess = (role, storedDefinitions) => buildRoleAccess(role, storedDefinitions);

const sanitizeUserForClient = (user, storedDefinitions, client = null) => {
  const roleAccess = resolveUserAccess(user, storedDefinitions);
  const isSuperAdmin = user?.role === "super_admin";
  const usedCredits = isSuperAdmin ? 0 : Number(client?.usedCredits ?? user.usedCredits ?? 0);
  const totalCredits = isSuperAdmin ? 0 : Number(client?.totalCredits ?? user.totalCredits ?? 0);
  const currentPlan = client?.plan || "FREE";

  return {
    _id: user.appId,
    clientId: user.clientId || "",
    clientName: user.clientName || "",
    name: user.name,
    fullname: user.fullname || user.name,
    email: user.email,
    phone: user.phone || "",
    title: user.title || "",
    department: user.department || "",
    role: user.role,
    roleName: roleAccess.roleName,
    currentPlan,
    permission: roleAccess.permission,
    allowed: roleAccess.allowed,
    image: user.image || "/branding/avatar.png",
    usedCredits,
    totalCredits,
    isUnreadNotifications: Boolean(user.isUnreadNotifications ?? false),
  };
};

module.exports = {
  hashPassword,
  hashLegacyPassword,
  verifyPassword,
  signAuthToken,
  verifyAuthToken,
  getBearerToken,
  getRoleAccess,
  sanitizeUserForClient,
};
