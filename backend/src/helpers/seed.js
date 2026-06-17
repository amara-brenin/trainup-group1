const { hashPassword, getRoleAccess, sanitizeUserForClient } = require("./auth");
const { getEditableRoleDefaults } = require("./permissions");
const {
  DEFAULT_CLIENT_ID,
  buildDefaultTenantAppSettings,
  buildPlatformAppSettings,
  getTenantSetting,
  migrateExistingRecordsToClient,
  setTenantSetting,
  syncClientMetrics,
} = require("./tenant");
const User = require("../models/User");
const SuperAdmin = require("../models/SuperAdmin");
const Client = require("../models/Client");
const ApiKey = require("../models/ApiKey");
const Setting = require("../models/Setting");

const appSettings = {
  application_name: "Samsung LMS",
  logo: "/branding/logo.png",
  dark_logo: "/branding/logo-dark.png",
  favicon: "/branding/favicon.png",
  email: "support@samsung.com",
  copyright: `© ${new Date().getFullYear()} Samsung LMS. All rights reserved.`,
  phone: "+91 1800 120 9999",
  path: "/dashboard",
};

const buildDefaultClientSeed = () => ({
  appId: DEFAULT_CLIENT_ID,
  name: "Samsung Retail India",
  industry: "Retail Operations",
  plan: "ENTERPRISE",
  status: "active",
  domain: "learning.samsungretail.in",
  domainStatus: "verified",
  subdomain: "retail-india",
  activeUsers: 0,
  trainings: 0,
  sessions: 0,
  joined: "Jan 2024",
  csm: "Riya Kapoor",
  logo: "SR",
  logoColor: "#3e60d5",
  logoBg: "#ebf2ff",
  iframeEnabled: true,
  ssoType: "Samsung IAM",
  ssoStatus: "connected",
  primaryColor: "#1428a0",
  secondaryColor: "#3e60d5",
  supportEmail: "retail-training@samsung.com",
  companyPhone: "+91 1800 120 9999",
  companyAddress: "Samsung Retail India, Bengaluru",
  applicationName: "Samsung LMS",
  logoUrl: "/branding/logo.png",
  darkLogoUrl: "/branding/logo-dark.png",
  faviconUrl: "/branding/favicon.png",
  allowedOrigins: ["https://retail.samsung.com", "https://retail-ops.samsung.com"],
  webhookUrl: "https://retail.samsung.com/api/lms/webhook",
  apiScope: "Session sync, completion reports, catalog access",
  iframeBaseUrl: "https://lms.samsung.com/train/",
  iframeAllowedParentDomains: ["samsung-internal.com", "samsung-portal.com", "samsung-hr.net"],
  smtpHost: "smtp.samsung.com",
  smtpPort: 587,
  smtpUsername: "noreply@samsung.com",
  smtpPassword: "",
  smtpFromName: "Samsung LMS",
  smtpFromEmail: "training@samsung.com",
  smtpSecure: false,
  clientAdminUserId: "user-006",
  firstUserName: "Ritika Singh",
  firstUserEmail: "admin@samsung.com",
});

const seedClients = () => [buildDefaultClientSeed()];

const seedSuperAdmins = () => {
  const roleAccess = getRoleAccess("super_admin");

  return [
    {
      appId: "user-000",
      name: "Bharat Goyal",
      fullname: "Bharat Goyal",
      email: "dev@brenin.co",
      role: "super_admin",
      roleName: roleAccess.roleName,
      permission: roleAccess.permission,
      allowed: roleAccess.allowed,
      useRoleDefaults: true,
      status: "active",
      lastActive: "Today",
      isUnreadNotifications: false,
      image: "/branding/avatar.png",
      phone: "",
      title: "Super Admin",
      department: "Platform",
      passwordHash: hashPassword("123456789aA@"),
    },
  ];
};

const seedUsers = (client) => {
  const buildUser = (config) => {
    const roleAccess = getRoleAccess(config.role);
    return {
      appId: config.appId,
      clientId: client.appId,
      clientName: client.name,
      name: config.name,
      fullname: config.name,
      email: config.email,
      role: config.role,
      status: config.status || "active",
      trainings: config.trainings || 0,
      lastActive: config.lastActive || "Today",
      roleName: roleAccess.roleName,
      permission: roleAccess.permission,
      allowed: roleAccess.allowed,
      useRoleDefaults: true,
      usedCredits: 6380,
      totalCredits: 10000,
      isUnreadNotifications: false,
      image: "/branding/avatar.png",
      phone: config.phone || "",
      title: config.title || "",
      department: config.department || "",
      passwordHash: hashPassword(config.password),
    };
  };

  return [
    buildUser({ appId: "user-001", name: "Rohan Mehta", email: "trainer@samsung.com", role: "trainer", password: "trainer123", trainings: 12, department: "Retail Training", title: "Trainer" }),
    buildUser({ appId: "user-002", name: "Priya Sharma", email: "priya@samsung.com", role: "trainer", password: "trainer123", trainings: 9, lastActive: "Yesterday", department: "Retail Training", title: "Trainer" }),
    buildUser({ appId: "user-003", name: "Anjali Verma", email: "anjali@samsung.com", role: "trainer", password: "trainer123", trainings: 6, lastActive: "2 days ago", department: "Retail Training", title: "Trainer" }),
    buildUser({ appId: "user-004", name: "Ankit Kumar", email: "reviewer@samsung.com", role: "reviewer", password: "reviewer123", department: "Learning QA", title: "Reviewer" }),
    buildUser({ appId: "user-005", name: "Neha Gupta", email: "neha@samsung.com", role: "reviewer", password: "reviewer123", lastActive: "Yesterday", department: "Learning QA", title: "Reviewer" }),
    buildUser({ appId: "user-006", name: "Ritika Singh", email: "admin@samsung.com", role: "admin", password: "admin123", department: "Operations", title: "Client Admin" }),
    buildUser({ appId: "user-007", name: "Aarav Patel", email: "trainee@samsung.com", role: "trainee", password: "trainee123", department: "Retail Stores", title: "Trainee" }),
  ];
};

const seedApiKeys = (clientId) => [
  {
    appId: "key-001",
    clientId,
    name: "Retail Reporting",
    key: "sk_live_retail_reporting_34as2dwe893a",
    permission: "Read Only",
    createdAtLabel: "2026-02-11",
    lastUsed: "Today, 10:24",
    callsToday: 1240,
    status: "active",
  },
  {
    appId: "key-002",
    clientId,
    name: "Session Sync",
    key: "sk_live_session_sync_1j9smd2k3l9as",
    permission: "Read / Write",
    createdAtLabel: "2026-01-22",
    lastUsed: "Today, 09:51",
    callsToday: 843,
    status: "active",
  },
  {
    appId: "key-003",
    clientId,
    name: "Store Pilot",
    key: "sk_live_store_pilot_x9a9s0dm23pk1",
    permission: "Read Only",
    createdAtLabel: "2026-03-06",
    lastUsed: "Yesterday, 19:40",
    callsToday: 206,
    status: "active",
  },
];

const ensureAdminBillingPermissions = (roleDefinitions = []) => {
  if (!Array.isArray(roleDefinitions)) {
    return {
      changed: false,
      value: roleDefinitions,
    };
  }

  let changed = false;
  const value = roleDefinitions.map((role) => {
    if (role?.id !== "admin") {
      return role;
    }

    const permission = Array.isArray(role.permission) ? [...role.permission] : [];
    const allowed = Array.isArray(role.allowed) ? [...role.allowed] : [];

    if (!permission.includes("billing.view")) {
      permission.push("billing.view");
      changed = true;
    }

    if (!permission.includes("billing.manage")) {
      permission.push("billing.manage");
      changed = true;
    }

    if (!allowed.includes("billing")) {
      allowed.push("billing");
      changed = true;
    }

    return {
      ...role,
      permission,
      allowed,
    };
  });

  return {
    changed,
    value,
  };
};

const ensureDefaultNotificationPermissions = (roleDefinitions = []) => {
  if (!Array.isArray(roleDefinitions)) {
    return {
      changed: false,
      value: roleDefinitions,
    };
  }

  const roleIds = new Set(["admin", "trainer", "reviewer"]);
  let changed = false;

  const value = roleDefinitions.map((role) => {
    if (!roleIds.has(role?.id)) {
      return role;
    }

    const permission = Array.isArray(role.permission) ? [...role.permission] : [];
    const allowed = Array.isArray(role.allowed) ? [...role.allowed] : [];

    if (!permission.includes("notifications.view")) {
      permission.push("notifications.view");
      changed = true;
    }

    if (!allowed.includes("notifications")) {
      allowed.push("notifications");
      changed = true;
    }

    return {
      ...role,
      permission,
      allowed,
    };
  });

  return {
    changed,
    value,
  };
};

const ensureMissingSeedUsers = async (client) => {
  const seededUsers = seedUsers(client);

  for (const seededUser of seededUsers) {
    const existingUser = await User.findOne({ email: seededUser.email }).lean();

    if (existingUser) {
      continue;
    }

    await User.create(seededUser);
  }
};

const ensureSeedSuperAdmins = async () => {
  const seededSuperAdmins = seedSuperAdmins();

  for (const seededSuperAdmin of seededSuperAdmins) {
    const existingDedicatedSuperAdmin =
      (await SuperAdmin.findOne({ appId: seededSuperAdmin.appId })) ||
      (await SuperAdmin.findOne({ email: seededSuperAdmin.email }));

    if (existingDedicatedSuperAdmin) {
      const updatePayload = {
        $set: {
          name: seededSuperAdmin.name,
          fullname: seededSuperAdmin.fullname,
          role: "super_admin",
          roleName: seededSuperAdmin.roleName,
          permission: seededSuperAdmin.permission,
          allowed: seededSuperAdmin.allowed,
          useRoleDefaults: true,
          title: seededSuperAdmin.title,
          department: seededSuperAdmin.department,
        },
        $setOnInsert: {
          passwordHash: seededSuperAdmin.passwordHash,
          status: seededSuperAdmin.status,
          image: seededSuperAdmin.image,
          phone: seededSuperAdmin.phone,
          lastActive: seededSuperAdmin.lastActive,
          isUnreadNotifications: seededSuperAdmin.isUnreadNotifications,
        },
      };

      await SuperAdmin.updateOne({ _id: existingDedicatedSuperAdmin._id }, updatePayload);
      continue;
    }

    const legacySuperAdmin =
      (await User.findOne({ appId: seededSuperAdmin.appId, role: "super_admin" }).lean()) ||
      (await User.findOne({ email: seededSuperAdmin.email, role: "super_admin" }).lean());

    if (legacySuperAdmin) {
      await SuperAdmin.updateOne(
        { appId: seededSuperAdmin.appId },
        {
          $set: {
            name: legacySuperAdmin.name || seededSuperAdmin.name,
            fullname: legacySuperAdmin.fullname || legacySuperAdmin.name || seededSuperAdmin.fullname,
            email: legacySuperAdmin.email || seededSuperAdmin.email,
            role: "super_admin",
            roleName: legacySuperAdmin.roleName || seededSuperAdmin.roleName,
            permission: Array.isArray(legacySuperAdmin.permission) && legacySuperAdmin.permission.length ? legacySuperAdmin.permission : seededSuperAdmin.permission,
            allowed: Array.isArray(legacySuperAdmin.allowed) && legacySuperAdmin.allowed.length ? legacySuperAdmin.allowed : seededSuperAdmin.allowed,
            useRoleDefaults: legacySuperAdmin.useRoleDefaults !== false,
            status: legacySuperAdmin.status || seededSuperAdmin.status,
            lastActive: legacySuperAdmin.lastActive || seededSuperAdmin.lastActive,
            isUnreadNotifications: Boolean(legacySuperAdmin.isUnreadNotifications),
            image: legacySuperAdmin.image || seededSuperAdmin.image,
            phone: legacySuperAdmin.phone || seededSuperAdmin.phone,
            title: legacySuperAdmin.title || seededSuperAdmin.title,
            department: legacySuperAdmin.department || seededSuperAdmin.department,
            passwordHash: legacySuperAdmin.passwordHash || seededSuperAdmin.passwordHash,
          },
        },
        { upsert: true },
      );
      continue;
    }

    await SuperAdmin.updateOne(
      { appId: seededSuperAdmin.appId },
      {
        $set: seededSuperAdmin,
      },
      { upsert: true },
    );
  }
};

const apiConfiguration = {
  baseUrl: "https://api.samsung-lms.com/v1",
  rateLimitPerMinute: 1000,
  tokenExpiryHours: 24,
  corsAllowedOrigins: ["https://retail.samsung.com", "https://service.samsung.com"],
  endpoints: [
    { method: "GET", path: "/trainings", description: "List all published trainings", badgeClass: "badge-blue" },
    { method: "GET", path: "/training/{id}", description: "Get training details and slides", badgeClass: "badge-blue" },
    { method: "POST", path: "/session", description: "Start employee training session", badgeClass: "badge-green" },
    { method: "GET", path: "/session/{uid}/status", description: "Check completion status by SSO id", badgeClass: "badge-yellow" },
    { method: "GET", path: "/reports/{id}", description: "Fetch training completion report", badgeClass: "badge-purple" },
  ],
};

const webhookConfiguration = {
  url: "https://retail.samsung.com/api/lms/webhook",
  signingSecret: "whsec_samsung_demo_signature",
  retryAttempts: 3,
  timeoutSeconds: 10,
  events: [
    { key: "training.started", description: "Employee starts a training module", enabled: true },
    { key: "training.completed", description: "Employee completes a training module", enabled: true },
    { key: "quiz.passed", description: "Employee passes the quiz", enabled: true },
    { key: "quiz.failed", description: "Employee fails the quiz", enabled: true },
    { key: "slide.viewed", description: "Track each viewed slide", enabled: false },
    { key: "session.timeout", description: "Session timed out because of inactivity", enabled: false },
  ],
  logs: [
    { id: "log-001", timestamp: "2026-03-31 10:14:22", event: "training.completed", ssoId: "SAM-1042", status: 200, latencyMs: 48 },
    { id: "log-002", timestamp: "2026-03-31 10:02:11", event: "training.started", ssoId: "SAM-1042", status: 200, latencyMs: 51 },
    { id: "log-003", timestamp: "2026-03-31 09:58:44", event: "quiz.passed", ssoId: "SAM-2318", status: 200, latencyMs: 62 },
    { id: "log-004", timestamp: "2026-03-30 14:15:00", event: "training.completed", ssoId: "SAM-0891", status: 503, latencyMs: null },
  ],
};

const iframeConfiguration = {
  baseUrl: "https://lms.samsung.com/train/",
  defaultWidth: "100%",
  height: 680,
  allowedParentDomains: ["samsung-internal.com", "samsung-portal.com", "samsung-hr.net"],
  ssoParameterName: "sso",
  allowFullscreen: true,
  autoResize: true,
  blockRightClick: false,
};

const isSameCalendarDay = (date, reference) =>
  date.getFullYear() === reference.getFullYear() &&
  date.getMonth() === reference.getMonth() &&
  date.getDate() === reference.getDate();

const buildSessionSnapshot = (trainingRecords = []) => {
  const now = new Date();
  let activeSessions = 0;
  let completionsToday = 0;
  let totalSessions = 0;

  trainingRecords.forEach((training) => {
    const sessions = Array.isArray(training?.payload?.sessions) ? training.payload.sessions : [];
    totalSessions += sessions.length;

    sessions.forEach((session) => {
      const status = String(session?.status || "").trim().toLowerCase();
      const completedAt = new Date(session?.completedAt || "");

      if (status === "in-progress") {
        activeSessions += 1;
      }

      if (status === "completed" && !Number.isNaN(completedAt.getTime()) && isSameCalendarDay(completedAt, now)) {
        completionsToday += 1;
      }
    });
  });

  return {
    activeSessions,
    completionsToday,
    totalSessions,
  };
};

const buildDashboard = ({ clients, currentClient, webhookConfig, session, tenantUsers = [], trainingRecords = [], counts }) => {
  const isSuperAdmin = session.role === "super_admin";
  const currentTenant = currentClient || null;

  const c = counts || {};
  const activeClients = c.activeClientCount ?? clients.filter((client) => client.status === "active").length;
  const clientCount = c.clientCount ?? clients.length;
  const totalUsers = c.totalUserCount ?? tenantUsers.length;
  const totalTrainingCount = c.trainingCount ?? trainingRecords.length;
  const tenantUserCount = c.internalUserCount ?? (tenantUsers.filter((u) => u.role !== "trainee").length || Number(currentTenant?.activeUsers || 0));
  const traineeCount = c.traineeCount ?? tenantUsers.filter((u) => u.role === "trainee").length;
  const tenantTrainingCount = totalTrainingCount;
  const sessionSnapshot = c.sessionSnapshot || buildSessionSnapshot(trainingRecords);
  const combinedSessions = c.combinedSessions ?? (sessionSnapshot.activeSessions + sessionSnapshot.completionsToday);

  return {
    kpis: isSuperAdmin
      ? [
        { label: "Total Clients", value: String(clientCount), icon: "bi bi-buildings", color: "#3e60d5", subtle: "#ebf2ff", hint: `${activeClients} active accounts` },
        { label: "Total Sessions", value: String(sessionSnapshot.totalSessions), icon: "bi bi-play-circle", color: "#a020f0", subtle: "#f4e1ff", hint: "Learner training attempts recorded overall" },
        { label: "Total Trainings", value: String(totalTrainingCount), icon: "bi bi-journal-richtext", color: "#47ad77", subtle: "#e6faf3", hint: "Training modules created across all clients" },
        { label: "Total User", value: String(totalUsers), icon: "bi bi-people", color: "#16a7e9", subtle: "#e6f6fd", hint: "Users added across all clients" },
      ]
      : [
        { label: "Company Access", value: String(tenantUserCount), icon: "bi bi-person-badge", color: "#16a7e9", subtle: "#e6f6fd", hint: `${currentTenant?.name || "Client"} internal team access` },
        { label: "Total Trainings", value: String(tenantTrainingCount), icon: "bi bi-journal-richtext", color: "#3e60d5", subtle: "#ebf2ff", hint: "Created learning modules in this workspace" },
        { label: "Training Sessions", value: String(combinedSessions), icon: "bi bi-play-circle", color: "#a020f0", subtle: "#f4e1ff", hint: "Started and completed learner sessions" },
        { label: "Total Trainees", value: String(traineeCount), icon: "bi bi-mortarboard", color: "#47ad77", subtle: "#e6faf3", hint: "Learner profiles available for assignment" },
      ],
    apiUsage: [
      { endpoint: "GET /session/*/status", calls: 2104, percentage: 49 },
      { endpoint: "GET /trainings", calls: 988, percentage: 23 },
      { endpoint: "POST /session", calls: 741, percentage: 17 },
      { endpoint: "GET /reports/*", calls: 454, percentage: 11 },
    ],
    integrationHealth: [
      { name: "REST API", uptime: "99.97%", latency: "48ms avg" },
      { name: "Webhooks", uptime: "99.36%", latency: "51ms avg" },
      { name: "iFrame Embed", uptime: "100%", latency: "12ms avg" },
      { name: "SSO Auth", uptime: "99.91%", latency: "62ms avg" },
    ],
    recentWebhookEvents: Array.isArray(webhookConfig?.logs) ? webhookConfig.logs.slice(0, 4) : [],
    quickActions: isSuperAdmin
      ? [
        {
          title: "Manage Clients",
          description: "Handle white-label setup, branding, and client-level onboarding.",
          icon: "bi bi-buildings",
          route: "/clients",
          color: "#3e60d5",
          subtle: "#ebf2ff",
          permissionKey: "clients.view",
          allowedKey: "clients",
        },
        {
          title: "Manage Staff",
          description: "Add, edit, and manage platform staff members.",
          icon: "bi bi-people",
          route: "/staff",
          color: "#ffc35a",
          subtle: "#fff8e6",
          permissionKey: "staff.view",
          allowedKey: "staff",
        },
      ]
      : [
        {
          title: "Rotate API Keys",
          description: "Generate a fresh integration key for connected systems.",
          icon: "bi bi-key",
          route: "/api-keys",
          color: "#3e60d5",
          subtle: "#ebf2ff",
          permissionKey: "api.view",
          allowedKey: "api",
        },
        {
          title: "Test Webhook",
          description: "Dispatch a sample completion event to the connected endpoint.",
          icon: "bi bi-broadcast",
          route: "/webhooks",
          color: "#a020f0",
          subtle: "#f4e1ff",
          permissionKey: "webhooks.view",
          allowedKey: "webhooks",
        },
        {
          title: "Update iFrame Domains",
          description: "Whitelist a new parent domain before rollout.",
          icon: "bi bi-window-sidebar",
          route: "/iframe",
          color: "#47ad77",
          subtle: "#e6faf3",
          permissionKey: "iframe.view",
          allowedKey: "iframe",
        },
        {
          title: "Workspace Settings",
          description: "Update company, white-label, SMTP, and integration defaults.",
          icon: "bi bi-sliders",
          route: "/settings",
          color: "#3e60d5",
          subtle: "#ebf2ff",
          permissionKey: "settings.view",
          allowedKey: "settings",
        },
        {
          title: "Manage Users",
          description: "Invite trainers, reviewers, and client admins.",
          icon: "bi bi-people",
          route: "/users",
          color: "#ffc35a",
          subtle: "#fff8e6",
          permissionKey: "users.view",
          allowedKey: "users",
        },
      ],
  };
};

const sanitizeUserRecord = (user) => ({
  id: user.appId,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  trainings: Number(user.trainings || 0),
  lastActive: user.lastActive || "Today",
});

const buildLoginResponse = (user, token) => ({
  token,
  user: sanitizeUserForClient(user),
});

let seedPromise = null;

const ensureSeedData = async () => {
  if (!seedPromise) {
    seedPromise = (async () => {
      const [userCount, _superAdminCount, clientCount, apiKeyCount, settingCount] = await Promise.all([
        User.countDocuments(),
        SuperAdmin.countDocuments(),
        Client.countDocuments(),
        ApiKey.countDocuments(),
        Setting.countDocuments(),
      ]);

      const defaultClientSeed = buildDefaultClientSeed();

      if (!userCount) {
        await User.insertMany(seedUsers(defaultClientSeed));
      }

      await ensureSeedSuperAdmins();

      if (!clientCount) {
        await Client.insertMany(seedClients());
      }

      if (!apiKeyCount) {
        await ApiKey.insertMany(seedApiKeys(defaultClientSeed.appId));
      }

      if (!settingCount) {
        await Setting.insertMany([
          { key: "settings", value: appSettings },
          { key: "apiConfig", value: apiConfiguration },
          { key: "webhookConfig", value: webhookConfiguration },
          { key: "iframeConfig", value: iframeConfiguration },
          { key: "rolePermissions", value: getEditableRoleDefaults() },
        ]);
      } else {
        const rolePermissionSetting = await Setting.findOne({ key: "rolePermissions" }).lean();

        if (!rolePermissionSetting) {
          await Setting.create({
            key: "rolePermissions",
            value: getEditableRoleDefaults(),
          });
        } else {
          const syncedBillingRoles = ensureAdminBillingPermissions(rolePermissionSetting.value);
          const syncedGlobalRoles = ensureDefaultNotificationPermissions(syncedBillingRoles.value);

          if (syncedBillingRoles.changed || syncedGlobalRoles.changed) {
            await Setting.updateOne(
              { key: "rolePermissions" },
              {
                $set: {
                  value: syncedGlobalRoles.value,
                },
              },
            );
          }
        }
      }

      let defaultClient =
        (await Client.findOne({ appId: DEFAULT_CLIENT_ID })) ||
        (await Client.findOne({}).sort({ createdAt: 1 })) ||
        (await Client.create(defaultClientSeed));

      await migrateExistingRecordsToClient(defaultClient.appId, defaultClient.name);

      const globalRoleSetting = await Setting.findOne({ key: "rolePermissions" }).lean();
      const globalApiConfig = await Setting.findOne({ key: "apiConfig" }).lean();
      const globalWebhookConfig = await Setting.findOne({ key: "webhookConfig" }).lean();
      const globalIframeConfig = await Setting.findOne({ key: "iframeConfig" }).lean();

      const allClients = await Client.find({}).lean();

      for (const client of allClients) {
        const [tenantRolePermissions, tenantApiConfig, tenantWebhookConfig, tenantIframeConfig, tenantAppSettings] = await Promise.all([
          getTenantSetting(client.appId, "rolePermissions"),
          getTenantSetting(client.appId, "apiConfig"),
          getTenantSetting(client.appId, "webhookConfig"),
          getTenantSetting(client.appId, "iframeConfig"),
          getTenantSetting(client.appId, "appSettings"),
        ]);

        await Promise.all([
          tenantRolePermissions ? Promise.resolve() : setTenantSetting(client.appId, "rolePermissions", globalRoleSetting?.value || getEditableRoleDefaults()),
          tenantApiConfig ? Promise.resolve() : setTenantSetting(client.appId, "apiConfig", globalApiConfig?.value || apiConfiguration),
          tenantWebhookConfig ? Promise.resolve() : setTenantSetting(client.appId, "webhookConfig", globalWebhookConfig?.value || webhookConfiguration),
          tenantIframeConfig ? Promise.resolve() : setTenantSetting(client.appId, "iframeConfig", globalIframeConfig?.value || iframeConfiguration),
          tenantAppSettings ? Promise.resolve() : setTenantSetting(client.appId, "appSettings", buildDefaultTenantAppSettings(client)),
        ]);

        if (tenantRolePermissions) {
          const syncedBillingRoles = ensureAdminBillingPermissions(tenantRolePermissions);
          const syncedTenantRoles = ensureDefaultNotificationPermissions(syncedBillingRoles.value);

          if (syncedBillingRoles.changed || syncedTenantRoles.changed) {
            await setTenantSetting(client.appId, "rolePermissions", syncedTenantRoles.value);
          }
        }

        await syncClientMetrics(client.appId);
      }

      defaultClient = (await Client.findOne({ appId: defaultClient.appId }).lean()) || defaultClient;
      await ensureMissingSeedUsers(defaultClient);
      await User.updateMany(
        { clientId: defaultClient.appId, role: { $ne: "super_admin" } },
        {
          $set: {
            clientName: defaultClient.name,
          },
        },
      );
    })();
  }

  return seedPromise;
};

module.exports = {
  appSettings,
  buildDashboard,
  buildLoginResponse,
  ensureSeedData,
  seedSuperAdmins,
  sanitizeUserRecord,
};
