import type { RoutePermission } from "./interfaces";
import { AllowedKeys, PermissionKeys } from "./permissions";

export const routePermissions: RoutePermission[] = [
  { path: "/dashboard", key: PermissionKeys.dashboardView, allowed: AllowedKeys.dashboard },
  { path: "/upgrade-billings", key: PermissionKeys.billingView, allowed: AllowedKeys.billing },
  { path: "/upgrade-billings/:checkoutPlan", key: PermissionKeys.billingView, allowed: AllowedKeys.billing },
  { path: "/clients", key: PermissionKeys.clientsView, allowed: AllowedKeys.clients },
  { path: "/clients/:clientId", key: PermissionKeys.clientsView, allowed: AllowedKeys.clients },
  { path: "/staff", key: PermissionKeys.staffView, allowed: AllowedKeys.staff },
  { path: "/users", key: PermissionKeys.usersView, allowed: AllowedKeys.users },
  { path: "/trainees", key: PermissionKeys.traineesView, allowed: AllowedKeys.trainees },
  { path: "/trainees/:traineeId/report", key: PermissionKeys.traineesReport, allowed: AllowedKeys.trainees },
  { path: "/trainees/:traineeId/report/:sessionId", key: PermissionKeys.traineesReport, allowed: AllowedKeys.trainees },
  { path: "/roles", key: PermissionKeys.rolesView, allowed: AllowedKeys.roles },
  { path: "/settings", key: PermissionKeys.settingsView, allowed: AllowedKeys.settings },
  { path: "/email-center", key: PermissionKeys.settingsView, allowed: AllowedKeys.settings },
  { path: "/api-keys", key: PermissionKeys.apiView, allowed: AllowedKeys.api },
  { path: "/avatar-creator", key: PermissionKeys.trainingEdit, allowed: AllowedKeys.trainingWorkspace },
  { path: "/profile", key: PermissionKeys.profileView, allowed: AllowedKeys.profile },
  { path: "/webhooks", key: PermissionKeys.webhooksView, allowed: AllowedKeys.webhooks },
  { path: "/iframe", key: PermissionKeys.iframeView, allowed: AllowedKeys.iframe },
];
