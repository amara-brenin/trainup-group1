const permissionCatalog = [
  {
    id: "dashboard",
    label: "Admin Dashboard",
    description: "Access to the admin dashboard and summary cards.",
    allowedKey: "dashboard",
    permissions: [
      {
        key: "dashboard.view",
        label: "View dashboard",
        description: "Open the admin dashboard and read high-level stats.",
      },
    ],
  },
  {
    id: "billing",
    label: "Upgrade & Billings",
    description: "Subscription usage, credit wallet, and top-up actions.",
    allowedKey: "billing",
    permissions: [
      {
        key: "billing.view",
        label: "View billing",
        description: "Open the upgrade and billing workspace.",
      },
      {
        key: "billing.manage",
        label: "Manage billing",
        description: "Buy credits and trigger billing actions.",
      },
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
    id: "staff",
    label: "Staff Management",
    description: "Add, edit, and manage platform staff members.",
    allowedKey: "staff",
    permissions: [
      { key: "staff.view", label: "View staff", description: "Open the staff list and details." },
      { key: "staff.add", label: "Add staff", description: "Create a new platform staff member." },
      { key: "staff.edit", label: "Edit staff", description: "Update existing staff details and access." },
      { key: "staff.delete", label: "Delete staff", description: "Remove a staff member from the platform." },
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
      { key: "settings.view", label: "View settings", description: "Open the tenant settings page." },
      { key: "settings.edit", label: "Edit settings", description: "Update tenant settings sections." },
    ],
  },
  {
    id: "profile",
    label: "Profile",
    description: "Personal profile and account information.",
    allowedKey: "profile",
    permissions: [
      { key: "profile.view", label: "View profile", description: "Open the profile page." },
      { key: "profile.edit", label: "Edit profile", description: "Update own profile details." },
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

const isSuperAdminRole = (role) => String(role || "").trim() === "super_admin";

const filterPermissionCatalogForRole = (role, catalog = permissionCatalog) =>
  isSuperAdminRole(role)
    ? catalog.filter((moduleItem) => moduleItem.id === "dashboard" || moduleItem.id === "clients" || moduleItem.id === "staff")
    : catalog.filter((moduleItem) => moduleItem.id !== "clients" && moduleItem.id !== "staff");

const systemRoleDefinitions = [
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
  },
  {
    id: "trainee",
    name: "Trainee",
    roleName: "Trainee",
    description: "Learner who attends approved trainings from a shared launch link.",
    status: "active",
    createdAt: "2026-04-11T00:00:00.000Z",
    isSystem: true,
    permission: ["profile.view", "profile.edit"],
  },
];

const superAdminDefinition = {
  id: "super_admin",
  name: "Super Admin",
  roleName: "Super Admin",
  description: "Platform owner with white-label and client management access.",
  status: "active",
  createdAt: "2024-01-01T00:00:00.000Z",
  isSystem: true,
  permission: [
    "dashboard.view",
    "clients.view",
    "clients.add",
    "clients.edit",
    "clients.delete",
    "staff.view",
    "staff.add",
    "staff.edit",
    "staff.delete",
  ],
};

const knownPermissionKeys = new Set(
  permissionCatalog.flatMap((moduleItem) => moduleItem.permissions.map((permission) => permission.key)),
);

const normalizePermissionArray = (permission = []) =>
  Array.from(
    new Set(
      (Array.isArray(permission) ? permission : [])
        .map((item) => String(item || "").trim())
        .filter((item) => knownPermissionKeys.has(item)),
    ),
  );

const filterPermissionArrayForRole = (role, permission = []) => {
  const visibleKeys = new Set(
    filterPermissionCatalogForRole(role).flatMap((moduleItem) => moduleItem.permissions.map((item) => item.key)),
  );

  return normalizePermissionArray(permission).filter((item) => visibleKeys.has(item));
};

const getGrantablePermissionSet = (requester = {}) => {
  const role = requester?.role;

  if (isSuperAdminRole(role)) {
    return new Set(
      filterPermissionCatalogForRole(role).flatMap((moduleItem) => moduleItem.permissions.map((item) => item.key)),
    );
  }

  const roleVisibleKeys = new Set(
    filterPermissionCatalogForRole(role).flatMap((moduleItem) => moduleItem.permissions.map((item) => item.key)),
  );

  return new Set(normalizePermissionArray(requester?.permission).filter((item) => roleVisibleKeys.has(item)));
};

const filterPermissionCatalogForRequester = (requester = {}, catalog = permissionCatalog) => {
  const roleCatalog = filterPermissionCatalogForRole(requester?.role, catalog);

  if (isSuperAdminRole(requester?.role)) {
    return roleCatalog;
  }

  const grantableKeys = getGrantablePermissionSet(requester);
  return roleCatalog
    .map((moduleItem) => ({
      ...moduleItem,
      permissions: moduleItem.permissions.filter((permission) => grantableKeys.has(permission.key)),
    }))
    .filter((moduleItem) => moduleItem.permissions.length);
};

const filterPermissionArrayForRequester = (requester = {}, permission = []) => {
  const grantableKeys = getGrantablePermissionSet(requester);
  return normalizePermissionArray(permission).filter((item) => grantableKeys.has(item));
};

const getUnauthorizedPermissionKeys = (requester = {}, permission = []) => {
  const grantableKeys = getGrantablePermissionSet(requester);
  return normalizePermissionArray(permission).filter((item) => !grantableKeys.has(item));
};

const buildAllowedFromPermissions = (permission = []) => {
  const normalized = normalizePermissionArray(permission);

  return permissionCatalog
    .filter((moduleItem) => moduleItem.permissions.some((item) => normalized.includes(item.key)))
    .map((moduleItem) => moduleItem.allowedKey);
};

const normalizeRoleStatus = (status) => (String(status || "").trim().toLowerCase() === "inactive" ? "inactive" : "active");

const slugifyRoleId = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const withDerivedAllowed = (definition) => {
  const permission = normalizePermissionArray(definition.permission);

  return {
    ...definition,
    name: String(definition.name || definition.roleName || "Role").trim() || "Role",
    roleName: String(definition.roleName || definition.name || "Role").trim() || "Role",
    description: String(definition.description || "").trim(),
    status: normalizeRoleStatus(definition.status),
    createdAt: String(definition.createdAt || new Date().toISOString()),
    isSystem: Boolean(definition.isSystem),
    permission,
    allowed: buildAllowedFromPermissions(permission),
  };
};

const getEditableRoleDefaults = () => systemRoleDefinitions.map((definition) => withDerivedAllowed(definition));

const roleMapFromValue = (value) => {
  const map = {};

  if (Array.isArray(value)) {
    value.forEach((definition) => {
      if (definition?.id) {
        map[String(definition.id)] = definition;
      }
    });
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, definition]) => {
      if (definition) {
        map[key] = definition;
      }
    });
  }

  return map;
};

const getRoleDefinitions = (value) => {
  const storedMap = roleMapFromValue(value);
  const defaults = getEditableRoleDefaults();
  const mergedDefaults = defaults.map((definition) => {
    const stored = storedMap[definition.id];

    if (!stored) {
      return definition;
    }

    return withDerivedAllowed({
      id: definition.id,
      name: stored.name ?? stored.roleName ?? definition.name,
      roleName: stored.roleName ?? stored.name ?? definition.roleName,
      description: stored.description ?? definition.description,
      status: stored.status ?? definition.status,
      createdAt: stored.createdAt || definition.createdAt,
      isSystem: true,
      permission: stored.permission ?? definition.permission,
    });
  });

  const defaultIds = new Set(defaults.map((definition) => definition.id));
  const customRoles = Object.entries(storedMap)
    .filter(([roleId]) => roleId !== "super_admin" && !defaultIds.has(roleId))
    .map(([roleId, definition]) =>
      withDerivedAllowed({
        ...definition,
        id: roleId,
        createdAt: definition.createdAt || new Date().toISOString(),
        isSystem: false,
      }),
    );

  return [...mergedDefaults, ...customRoles];
};

const getRoleDefinitionById = (role, storedDefinitions) => {
  if (role === "super_admin") {
    return withDerivedAllowed(superAdminDefinition);
  }

  return getRoleDefinitions(storedDefinitions).find((definition) => definition.id === role) || null;
};

const buildRoleAccess = (role, storedDefinitions) => {
  const roleDefinition = getRoleDefinitionById(role, storedDefinitions);

  if (!roleDefinition) {
    return {
      roleName: "User",
      permission: [],
      allowed: [],
    };
  }

  return {
    roleName: roleDefinition.roleName,
    permission: roleDefinition.permission,
    allowed: roleDefinition.allowed,
  };
};

const resolveUserAccess = (user, storedDefinitions) => {
  if (user?.role === "super_admin") {
    const permission = normalizePermissionArray(
      permissionCatalog.flatMap((moduleItem) => moduleItem.permissions.map((item) => item.key)),
    );

    return {
      roleName: user.roleName || superAdminDefinition.roleName,
      permission,
      allowed: permissionCatalog.map((moduleItem) => moduleItem.allowedKey),
    };
  }

  const roleAccess = buildRoleAccess(user.role, storedDefinitions);

  if (user.useRoleDefaults !== false) {
    return roleAccess;
  }

  const customPermission = normalizePermissionArray(user.permission);
  return {
    roleName: user.roleName || roleAccess.roleName,
    permission: customPermission,
    allowed: buildAllowedFromPermissions(customPermission),
  };
};

const areSamePermissions = (left, right) => {
  const normalizedLeft = normalizePermissionArray(left).sort();
  const normalizedRight = normalizePermissionArray(right).sort();

  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
};

module.exports = {
  permissionCatalog,
  filterPermissionCatalogForRole,
  filterPermissionArrayForRole,
  filterPermissionCatalogForRequester,
  filterPermissionArrayForRequester,
  getUnauthorizedPermissionKeys,
  getEditableRoleDefaults,
  getRoleDefinitions,
  getRoleDefinitionById,
  buildRoleAccess,
  resolveUserAccess,
  normalizePermissionArray,
  buildAllowedFromPermissions,
  areSamePermissions,
  slugifyRoleId,
};
