import type { UserRole } from "../constant/interfaces";

export type AppVariant = "admin" | "superadmin";

const normalizeUrl = (value: string, fallback: string) =>
  String(value || fallback).trim().replace(/\/+$/, "");

export const appVariant: AppVariant =
  import.meta.env.VITE_APP_VARIANT === "superadmin" ? "superadmin" : "admin";

export const isSuperAdminApp = appVariant === "superadmin";
export const isAdminApp = appVariant === "admin";

const getOrigin = () => typeof window !== "undefined" ? window.location.origin : "https://trainup.brenin.co";
const basePrefix = import.meta.env.VITE_BASE_URL || "/trainup-demo/";

export const adminAppUrl = normalizeUrl(
  import.meta.env.VITE_ADMIN_APP_URL,
  `${getOrigin()}${basePrefix}`,
);

export const superAdminAppUrl = normalizeUrl(
  import.meta.env.VITE_SUPERADMIN_APP_URL,
  `${getOrigin()}${basePrefix}admin-console/`,
);

export const isRoleAllowedInCurrentApp = (role?: UserRole) => {
  if (isSuperAdminApp) {
    return role === "super_admin";
  }

  return role !== "super_admin";
};

export const getRequiredAppLabelForRole = (role?: UserRole) =>
  role === "super_admin" ? "Super Admin app" : "Admin app";

export const getRequiredAppUrlForRole = (role?: UserRole) =>
  role === "super_admin" ? superAdminAppUrl : adminAppUrl;
