import type {
  PermissionModuleDefinition,
  RoleDefinitionRecord,
  UserRole,
} from "./interfaces";

const isSuperAdminRole = (role: UserRole) => role === "super_admin";

export const permissionModules: PermissionModuleDefinition[] = [
  {
    id: "dashboard",
    label: "Admin Dashboard",
    description: "Access to the admin dashboard and summary cards.",
    allowedKey: "dashboard",
    permissions: [{ key: "dashboard.view", label: "View dashboard", description: "Open the admin dashboard and read high-level stats." }],
  },
  {
    id: "billing",
    label: "Upgrade & Billings",
    description: "Subscription usage, credit wallet, and top-up actions.",
    allowedKey: "billing",
    permissions: [
      { key: "billing.view", label: "View billing", description: "Open the upgrade and billing workspace." },
      { key: "billing.manage", label: "Manage billing", description: "Buy credits and trigger billing actions." },
    ],
  },
  {
    id: "clients",
    label: "Client Management",
    description: "White-label clients, domains, and branding.",
    allowedKey: "clients",
    permissions: [
      { key: "clients.view", label: "View clients", description: "Open the clients list and details." },
      { key: "clients.add", label: "Add clients", description: "Create a new client account." },
      { key: "clients.edit", label: "Edit clients", description: "Update existing client settings." },
      { key: "clients.delete", label: "Delete clients", description: "Remove a client account." },
    ],
  },
  {
    id: "users",
    label: "User Management",
    description: "Invite and manage internal panel users.",
    allowedKey: "users",
    permissions: [
      { key: "users.view", label: "View users", description: "Open the users list." },
      { key: "users.add", label: "Add users", description: "Invite a new user." },
      { key: "users.edit", label: "Edit users", description: "Update user details and permissions." },
      { key: "users.delete", label: "Delete users", description: "Remove a user." },
    ],
  },
  {
    id: "trainees",
    label: "Trainee Management",
    description: "Create trainees, import learners, and open trainee reports.",
    allowedKey: "trainees",
    permissions: [
      { key: "trainees.view", label: "View trainees", description: "Open the trainee list." },
      { key: "trainees.add", label: "Add trainees", description: "Add trainees manually or import them by CSV." },
      { key: "trainees.edit", label: "Edit trainees", description: "Update trainee profile and status." },
      { key: "trainees.delete", label: "Delete trainees", description: "Remove trainees from the tenant." },
      { key: "trainees.report", label: "View trainee reports", description: "Open trainee session reports." },
    ],
  },
  {
    id: "roles",
    label: "Roles & Permissions",
    description: "Manage fixed role defaults for internal users.",
    allowedKey: "roles",
    permissions: [
      { key: "roles.view", label: "View roles", description: "Open the role permissions page." },
      { key: "roles.edit", label: "Edit roles", description: "Update default permissions for fixed roles." },
    ],
  },
  {
    id: "api",
    label: "API & Keys",
    description: "API keys and integration configuration.",
    allowedKey: "api",
    permissions: [
      { key: "api.view", label: "View API keys", description: "Open the API key management page." },
      { key: "api.generate", label: "Generate keys", description: "Create a new API key." },
      { key: "api.revoke", label: "Revoke keys", description: "Revoke an existing API key." },
      { key: "api.config.edit", label: "Edit API config", description: "Update base URL, limits, and CORS." },
    ],
  },
  {
    id: "webhooks",
    label: "Webhooks",
    description: "Webhook delivery and retry settings.",
    allowedKey: "webhooks",
    permissions: [
      { key: "webhooks.view", label: "View webhooks", description: "Open webhook configuration." },
      { key: "webhooks.edit", label: "Edit webhooks", description: "Change webhook settings." },
      { key: "webhooks.replay", label: "Replay events", description: "Replay webhook events." },
    ],
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "In-app notifications, unread badges, and updates feed.",
    allowedKey: "notifications",
    permissions: [
      { key: "notifications.view", label: "View notifications", description: "Open the notifications dropdown and read updates." },
    ],
  },
  {
    id: "iframe",
    label: "iFrame",
    description: "Embedded training settings and allowed parents.",
    allowedKey: "iframe",
    permissions: [
      { key: "iframe.view", label: "View iFrame settings", description: "Open the iFrame settings page." },
      { key: "iframe.edit", label: "Edit iFrame settings", description: "Update allowed domains and embed settings." },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    description: "Tenant-wide company, white-label, SMTP, and integration settings.",
    allowedKey: "settings",
    permissions: [
      { key: "settings.view", label: "View settings", description: "Open the settings page." },
      { key: "settings.edit", label: "Edit settings", description: "Update tenant settings." },
    ],
  },
  {
    id: "profile",
    label: "Profile",
    description: "Personal account and profile information.",
    allowedKey: "profile",
    permissions: [
      { key: "profile.view", label: "View profile", description: "Open the profile page." },
      { key: "profile.edit", label: "Edit profile", description: "Update your own profile." },
    ],
  },
  {
    id: "trainingWorkspace",
    label: "Training Workspace",
    description: "Trainer and reviewer workflow permissions.",
    allowedKey: "trainingWorkspace",
    permissions: [
      { key: "training.dashboard.view", label: "View workspace dashboard", description: "Open the trainer or reviewer dashboard." },
      { key: "training.library.view", label: "View training library", description: "Open the training library table." },
      { key: "training.create", label: "Create training", description: "Create a new training." },
      { key: "training.edit", label: "Edit training", description: "Edit training content and slides." },
      { key: "training.assign", label: "Assign training", description: "Assign approved trainings to trainees." },
      { key: "training.review", label: "Review training", description: "Open review mode for submitted trainings." },
      { key: "training.comment", label: "Comment on slides", description: "Add slide-level comments or replies." },
      { key: "training.resolve", label: "Resolve reviewer comments", description: "Mark reviewer comments as resolved." },
      { key: "training.submit", label: "Submit for review", description: "Send a training back into review." },
      { key: "training.request_changes", label: "Request changes", description: "Send a training back to the trainer." },
      { key: "training.approve", label: "Approve training", description: "Approve a reviewed training." },
    ],
  },
];

export const filterPermissionModulesForRole = (
  modules: PermissionModuleDefinition[],
  role: UserRole,
) =>
  isSuperAdminRole(role)
    ? modules.filter((moduleItem) => moduleItem.id === "dashboard" || moduleItem.id === "clients")
    : modules.filter((moduleItem) => moduleItem.id !== "clients");

export const filterPermissionModulesForUser = (
  modules: PermissionModuleDefinition[],
  role: UserRole,
  permission: string[],
) => {
  const roleModules = filterPermissionModulesForRole(modules, role);

  if (isSuperAdminRole(role)) {
    return roleModules;
  }

  const grantableKeys = new Set(normalizePermissionList(permission));
  return roleModules
    .map((moduleItem) => ({
      ...moduleItem,
      permissions: moduleItem.permissions.filter((item) => grantableKeys.has(item.key)),
    }))
    .filter((moduleItem) => moduleItem.permissions.length);
};

export const fixedRoleDefinitions: RoleDefinitionRecord[] = [
  {
    id: "admin",
    name: "Admin",
    roleName: "Client Admin",
    description: "Client admin who manages internal users and integrations.",
    status: "active",
    createdAt: "2024-12-31T00:00:00.000Z",
    isSystem: true,
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
  },
  {
    id: "trainer",
    name: "Trainer",
    roleName: "Content Trainer",
    description: "Creates and updates trainings based on reviewer feedback.",
    status: "active",
    createdAt: "2025-05-17T00:00:00.000Z",
    isSystem: true,
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
    },
  {
    id: "reviewer",
    name: "Reviewer",
    roleName: "Reviewer",
    description: "Reviews submitted trainings, comments on slides, and approves publishing.",
    status: "active",
    createdAt: "2026-01-09T00:00:00.000Z",
    isSystem: true,
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
    },
  ];

const getKnownPermissionKeys = () =>
  new Set(permissionModules.flatMap((moduleItem) => moduleItem.permissions.map((permission) => permission.key)));

export const normalizePermissionList = (permission: string[]) => {
  const known = getKnownPermissionKeys();

  return Array.from(new Set(permission.filter((item) => known.has(item))));
};

export const buildAllowedFromPermissions = (permission: string[]) => {
  const normalized = normalizePermissionList(permission);

  return permissionModules
    .filter((moduleItem) => moduleItem.permissions.some((item) => normalized.includes(item.key)))
    .map((moduleItem) => moduleItem.allowedKey);
};

export const getFixedRoleDefinition = (role: UserRole) =>
  fixedRoleDefinitions.find((definition) => definition.id === role) ?? null;

export const isSamePermissionSet = (left: string[], right: string[]) =>
  JSON.stringify([...normalizePermissionList(left)].sort()) === JSON.stringify([...normalizePermissionList(right)].sort());
