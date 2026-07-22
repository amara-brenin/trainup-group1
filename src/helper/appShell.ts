import { AllowedKeys } from "../constant/permissions";
import type { UserRole } from "../constant/interfaces";

export const SUPER_ADMIN_PREFIX = "/super-admin";

export const isSuperAdminRole = (role?: UserRole) => role === "super_admin";

const isSupportedSuperAdminPath = (path: string) =>
  path === "/dashboard" ||
  path === "/clients" ||
  path.startsWith("/clients/") ||
  path === "/staff" ||
  path.startsWith("/staff/") ||
  path === "/upgrade-billing" ||
  path.startsWith("/upgrade-billing/") ||
  path === "/profile";

export const stripSuperAdminPrefix = (path: string) => {
  const normalized = String(path || "").trim();

  if (!normalized.startsWith(SUPER_ADMIN_PREFIX)) {
    return normalized || "/";
  }

  const nextPath = normalized.slice(SUPER_ADMIN_PREFIX.length);
  return nextPath || "/";
};

export const getScopedAppPath = (path: string, role?: UserRole) => {
  const normalized = String(path || "").trim() || "/";
  const basePath = stripSuperAdminPrefix(normalized);

  if (!isSuperAdminRole(role)) {
    return basePath;
  }

  if (basePath === "/" || !isSupportedSuperAdminPath(basePath)) {
    return "/dashboard";
  }

  return basePath;
};

const adminHomeRoutePriority: Array<{ allowed: string; path: string }> = [
  { allowed: AllowedKeys.dashboard, path: "/dashboard" },
  { allowed: AllowedKeys.users, path: "/users" },
  { allowed: AllowedKeys.trainees, path: "/trainees" },
  { allowed: AllowedKeys.roles, path: "/roles" },
  { allowed: AllowedKeys.api, path: "/api-keys" },
  { allowed: AllowedKeys.webhooks, path: "/webhooks" },
  { allowed: AllowedKeys.iframe, path: "/iframe" },
  { allowed: AllowedKeys.clients, path: "/clients" },
];

export const getAdminHomePath = (allowed: string[] = [], role?: UserRole) => {
  const basePath =
    adminHomeRoutePriority.find((item) => allowed.includes(item.allowed))?.path ??
    "/dashboard";

  return getScopedAppPath(basePath, role);
};
