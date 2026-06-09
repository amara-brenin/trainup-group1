import type { MenuItem } from "./interfaces";
import { AllowedKeys, PermissionKeys } from "./permissions";

export const adminMenu: MenuItem[] = [
  {
    label: "Dashboard",
    link: "/dashboard",
    icon: "ri-layout-grid-line",
    permission_key: PermissionKeys.dashboardView,
    allowed_key: AllowedKeys.dashboard,
  },
  {
    label: "Clients",
    link: "/clients",
    icon: "ri-building-4-line",
    permission_key: PermissionKeys.clientsView,
    allowed_key: AllowedKeys.clients,
  },
  {
    label: "Staff",
    link: "/staff",
    icon: "ri-user-star-line",
    superAdminOnly: true,
  },
  {
    label: "Users",
    link: "/users",
    icon: "ri-team-line",
    permission_key: PermissionKeys.usersView,
    allowed_key: AllowedKeys.users,
  },
  {
    label: "Trainees",
    link: "/trainees",
    icon: "ri-user-follow-line",
    permission_key: PermissionKeys.traineesView,
    allowed_key: AllowedKeys.trainees,
  },
  {
    label: "Roles",
    link: "/roles",
    icon: "ri-shield-keyhole-line",
    permission_key: PermissionKeys.rolesView,
    allowed_key: AllowedKeys.roles,
  },
  {
    label: "Integrations",
    icon: "ri-plug-line",
    children: [
      {
        label: "API Keys",
        link: "/api-keys",
        icon: "ri-key-line",
        permission_key: PermissionKeys.apiView,
        allowed_key: AllowedKeys.api,
      },
      {
        label: "Webhooks",
        link: "/webhooks",
        icon: "ri-git-branch-line",
        permission_key: PermissionKeys.webhooksView,
        allowed_key: AllowedKeys.webhooks,
      },
      {
        label: "iFrame",
        link: "/iframe",
        icon: "ri-window-line",
        permission_key: PermissionKeys.iframeView,
        allowed_key: AllowedKeys.iframe,
      },
    ],
  },
];
