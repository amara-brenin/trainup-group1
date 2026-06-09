import crypto from "crypto";

const TOKEN_EXPIRY_SECONDS = 60 * 60 * 24 * 7;
const authSecret = process.env.AUTH_SECRET || "trainup-insecure-dev-auth-secret";

const base64UrlEncode = (value) =>
  Buffer.from(typeof value === "string" ? value : JSON.stringify(value))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const base64UrlDecode = (value) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
};

const createSignature = (value) =>
  crypto.createHmac("sha256", authSecret).update(value).digest("base64url");

export const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

export const verifyPassword = (password, storedValue) => {
  const [salt, hash] = String(storedValue ?? "").split(":");

  if (!salt || !hash) {
    return false;
  }

  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
};

export const signAuthToken = (payload) => {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + TOKEN_EXPIRY_SECONDS,
  };
  const encodedHeader = base64UrlEncode(header);
  const encodedBody = base64UrlEncode(body);
  const signature = createSignature(`${encodedHeader}.${encodedBody}`);
  return `${encodedHeader}.${encodedBody}.${signature}`;
};

export const verifyAuthToken = (token) => {
  const [encodedHeader, encodedBody, signature] = String(token ?? "").split(".");

  if (!encodedHeader || !encodedBody || !signature) {
    return null;
  }

  const expectedSignature = createSignature(`${encodedHeader}.${encodedBody}`);

  if (signature !== expectedSignature) {
    return null;
  }

  const payload = JSON.parse(base64UrlDecode(encodedBody));

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
};

export const getBearerToken = (req) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader || !String(authHeader).startsWith("Bearer ")) {
    return "";
  }

  return String(authHeader).slice(7).trim();
};

export const getRoleAccess = (role) => {
  switch (role) {
    case "super_admin":
      return {
        roleName: "Super Admin",
        permission: [
          "dashboard.view",
          "clients.view",
          "clients.add",
          "clients.edit",
          "clients.delete",
          "profile.view",
          "profile.edit",
        ],
        allowed: ["dashboard", "clients", "profile"],
      };
    case "admin":
      return {
        roleName: "Client Admin",
        permission: [
          "dashboard.view",
          "billing.view",
          "billing.manage",
          "users.view",
          "users.add",
          "users.edit",
          "users.delete",
          "trainees.view",
          "trainees.add",
          "trainees.edit",
          "trainees.delete",
          "trainees.report",
          "roles.view",
          "roles.edit",
          "api.view",
          "api.generate",
          "api.revoke",
          "api.config.edit",
          "webhooks.view",
          "webhooks.edit",
          "webhooks.replay",
          "notifications.view",
          "iframe.view",
          "iframe.edit",
          "settings.view",
          "settings.edit",
          "profile.view",
          "profile.edit",
        ],
        allowed: ["dashboard", "billing", "users", "trainees", "roles", "api", "webhooks", "notifications", "iframe", "settings", "profile"],
      };
    case "trainer":
      return {
        roleName: "Content Trainer",
        permission: [
          "notifications.view",
          "training.dashboard.view",
          "training.library.view",
          "training.create",
          "training.edit",
          "training.assign",
          "training.comment",
          "training.resolve",
          "training.submit",
          "profile.view",
          "profile.edit",
        ],
        allowed: ["trainingWorkspace", "notifications", "profile"],
      };
    case "reviewer":
      return {
        roleName: "Reviewer",
        permission: [
          "notifications.view",
          "training.dashboard.view",
          "training.library.view",
          "training.review",
          "training.comment",
          "training.request_changes",
          "training.approve",
          "profile.view",
          "profile.edit",
        ],
        allowed: ["trainingWorkspace", "notifications", "profile"],
      };
    default:
      return {
        roleName: "User",
        permission: [],
        allowed: [],
      };
  }
};

export const sanitizeUserForClient = (user) => {
  const { roleName, permission, allowed } = getRoleAccess(user.role);

  return {
    _id: user.appId,
    name: user.name,
    fullname: user.fullname || user.name,
    email: user.email,
    role: user.role,
    roleName: user.roleName || roleName,
    permission: Array.isArray(user.permission) ? user.permission : permission,
    allowed: Array.isArray(user.allowed) ? user.allowed : allowed,
    phone: user.phone || "",
    title: user.title || "",
    department: user.department || "",
    image: user.image || "/branding/avatar.png",
    usedCredits: Number(user.usedCredits ?? 6380),
    totalCredits: Number(user.totalCredits ?? 10000),
    isUnreadNotifications: Boolean(user.isUnreadNotifications ?? true),
  };
};
