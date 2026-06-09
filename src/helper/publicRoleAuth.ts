import { getFixedRoleDefinition } from "../constant/accessControl";
import type { AdminUser } from "../constant/interfaces";

export type PublicRole = "trainer" | "reviewer" | "employee";

export type PublicRoleSession = {
  role: PublicRole;
  clientId?: string;
  clientName?: string;
  identifier: string;
  name: string;
  roleLabel: string;
  email?: string;
  image?: string;
  currentPlan?: string;
  usedCredits?: number;
  totalCredits?: number;
  lastPath?: string;
  dept?: string;
  permission?: string[];
  allowed?: string[];
};

export const publicRoleHomePaths: Record<PublicRole, string> = {
  trainer: "/trainer",
  reviewer: "/reviewer",
  employee: "/employee-sso",
};

const storageKey = (role: PublicRole) => `trainup-public-role-${role}`;

export const getPublicRoleHomePath = (role: PublicRole) => publicRoleHomePaths[role];

const normalizePublicRolePath = (role: PublicRole, path?: string) => {
  const normalized = String(path || "").trim();

  if (!normalized || !normalized.startsWith("/")) {
    return "";
  }

  if (normalized === "/login" || normalized.startsWith("/login?")) {
    return "";
  }

  if (role !== "employee" && !normalized.startsWith(`/${role}`)) {
    return "";
  }

  if (role === "employee" && !normalized.startsWith("/employee-sso")) {
    return "";
  }

  return normalized;
};

export const getPublicRoleSession = (role: PublicRole) => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(storageKey(role));

  if (!raw) {
    return null;
  }

  const session = JSON.parse(raw) as PublicRoleSession;
  const roleDefaults = role === "employee" ? null : getFixedRoleDefinition(role);

  if (roleDefaults && (!session.permission || !session.allowed)) {
    return {
      ...session,
      permission: session.permission ?? roleDefaults.permission,
      allowed: session.allowed ?? roleDefaults.allowed,
    };
  }

  return session;
};

export const setPublicRoleSession = (role: PublicRole, session: PublicRoleSession) => {
  if (typeof window === "undefined") {
    return;
  }

  const existingSession = getPublicRoleSession(role);
  const normalizedLastPath =
    normalizePublicRolePath(role, session.lastPath) ||
    normalizePublicRolePath(role, existingSession?.lastPath) ||
    getPublicRoleHomePath(role);

  window.sessionStorage.setItem(
    storageKey(role),
    JSON.stringify({
      ...existingSession,
      ...session,
      lastPath: normalizedLastPath,
    }),
  );
};

export const buildPublicRoleSessionFromAdmin = (
  role: Extract<PublicRole, "trainer" | "reviewer">,
  user: AdminUser,
  existingSession?: PublicRoleSession | null,
): PublicRoleSession => ({
  ...existingSession,
  role,
  clientId: user.clientId,
  clientName: user.clientName,
  identifier: user.email,
  name: user.fullname || user.name,
  roleLabel: user.roleName,
  email: user.email,
  image: user.image,
  currentPlan: user.currentPlan,
  usedCredits: user.usedCredits,
  totalCredits: user.totalCredits,
  permission: user.permission,
  allowed: user.allowed,
});

export const setPublicRoleLastPath = (role: PublicRole, path: string) => {
  const session = getPublicRoleSession(role);

  if (!session) {
    return;
  }

  const normalizedPath = normalizePublicRolePath(role, path);

  if (!normalizedPath || normalizedPath === session.lastPath) {
    return;
  }

  setPublicRoleSession(role, {
    ...session,
    lastPath: normalizedPath,
  });
};

export const getPublicRoleRedirectPath = (role: PublicRole, session?: PublicRoleSession | null) => {
  const activeSession = session ?? getPublicRoleSession(role);
  return normalizePublicRolePath(role, activeSession?.lastPath) || getPublicRoleHomePath(role);
};

export const clearPublicRoleSession = (role: PublicRole) => {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(storageKey(role));
};

export const clearAllPublicRoleSessions = () => {
  (Object.keys(publicRoleHomePaths) as PublicRole[]).forEach((role) => {
    clearPublicRoleSession(role);
  });
};

export const getActivePublicRoleSession = () => {
  const roles = Object.keys(publicRoleHomePaths) as PublicRole[];

  for (const role of roles) {
    const session = getPublicRoleSession(role);
    if (session) {
      return {
        role,
        session,
        redirectTo: getPublicRoleRedirectPath(role, session),
      };
    }
  }

  return null;
};
