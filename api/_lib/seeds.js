import { hashPassword, getRoleAccess, sanitizeUserForClient } from "./auth.js";

export const appSettings = {
  application_name: "Trainup",
  logo: "/branding/logo.png",
  dark_logo: "/branding/logo-dark.png",
  favicon: "/branding/favicon.png",
  email: "support@samsung.com",
  copyright: `© ${new Date().getFullYear()} Trainup. All rights reserved.`,
  phone: "+91 1800 120 9999",
  path: "/dashboard",
};

export const seedClients = () => [
  {
    appId: "client-001",
    name: "Samsung Retail India",
    industry: "Retail Operations",
    plan: "Enterprise",
    status: "active",
    domain: "learning.samsungretail.in",
    domainStatus: "verified",
    subdomain: "retail-india",
    activeUsers: 284,
    trainings: 34,
    sessions: 1240,
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
    allowedOrigins: ["https://retail.samsung.com", "https://retail-ops.samsung.com"],
    webhookUrl: "https://retail.samsung.com/api/lms/webhook",
    apiScope: "Session sync, completion reports, catalog access",
  },
  {
    appId: "client-002",
    name: "Samsung Service Academy",
    industry: "Service Training",
    plan: "Pro",
    status: "active",
    domain: "academy.samsungservice.com",
    domainStatus: "verified",
    subdomain: "service-academy",
    activeUsers: 162,
    trainings: 19,
    sessions: 712,
    joined: "Apr 2024",
    csm: "Karthik Rao",
    logo: "SA",
    logoColor: "#0f766e",
    logoBg: "#dbfffb",
    iframeEnabled: true,
    ssoType: "Azure AD",
    ssoStatus: "connected",
    primaryColor: "#0f766e",
    secondaryColor: "#16a7e9",
    supportEmail: "service-academy@samsung.com",
    allowedOrigins: ["https://service.samsung.com"],
    webhookUrl: "https://service.samsung.com/webhooks/training",
    apiScope: "Course publish, assessments, completion reports",
  },
  {
    appId: "client-003",
    name: "Samsung Experience Stores",
    industry: "Store Enablement",
    plan: "Starter",
    status: "trial",
    domain: "",
    domainStatus: "pending",
    subdomain: "experience-stores",
    activeUsers: 74,
    trainings: 8,
    sessions: 226,
    joined: "Feb 2026",
    csm: "Megha Verma",
    logo: "ES",
    logoColor: "#7c3aed",
    logoBg: "#f3e8ff",
    iframeEnabled: false,
    ssoType: "None",
    ssoStatus: "not_configured",
    primaryColor: "#7c3aed",
    secondaryColor: "#3e60d5",
    supportEmail: "experience-stores@samsung.com",
    allowedOrigins: ["https://experience.samsung.com"],
    webhookUrl: "https://experience.samsung.com/training/webhook",
    apiScope: "Catalog access only",
  },
];

export const seedUsers = () => {
  const buildUser = (config) => {
    const roleAccess = getRoleAccess(config.role);

    return {
      appId: config.appId,
      name: config.name,
      fullname: config.name,
      email: config.email,
      role: config.role,
      status: config.status ?? "active",
      trainings: config.trainings ?? 0,
      lastActive: config.lastActive ?? "Today",
      roleName: roleAccess.roleName,
      permission: roleAccess.permission,
      allowed: roleAccess.allowed,
      usedCredits: 6380,
      totalCredits: 10000,
      isUnreadNotifications: true,
      image: "/branding/avatar.png",
      passwordHash: hashPassword(config.password),
    };
  };

  return [
    buildUser({
      appId: "user-000",
      name: "Aditi Nair",
      email: "superadmin@samsung.com",
      role: "super_admin",
      password: "superadmin123",
      trainings: 0,
    }),
    buildUser({
      appId: "user-001",
      name: "Rohan Mehta",
      email: "trainer@samsung.com",
      role: "trainer",
      password: "trainer123",
      trainings: 12,
    }),
    buildUser({
      appId: "user-002",
      name: "Priya Sharma",
      email: "priya@samsung.com",
      role: "trainer",
      password: "trainer123",
      trainings: 9,
      lastActive: "Yesterday",
    }),
    buildUser({
      appId: "user-003",
      name: "Anjali Verma",
      email: "anjali@samsung.com",
      role: "trainer",
      password: "trainer123",
      trainings: 6,
      lastActive: "2 days ago",
    }),
    buildUser({
      appId: "user-004",
      name: "Ankit Kumar",
      email: "reviewer@samsung.com",
      role: "reviewer",
      password: "reviewer123",
      trainings: 0,
    }),
    buildUser({
      appId: "user-005",
      name: "Neha Gupta",
      email: "neha@samsung.com",
      role: "reviewer",
      password: "reviewer123",
      trainings: 0,
      lastActive: "Yesterday",
    }),
    buildUser({
      appId: "user-006",
      name: "Ritika Singh",
      email: "admin@samsung.com",
      role: "admin",
      password: "admin123",
      trainings: 0,
    }),
    buildUser({
      appId: "user-007",
      name: "Aarav Patel",
      email: "trainee@samsung.com",
      role: "trainee",
      password: "trainee123",
      trainings: 0,
      lastActive: "Today",
    }),
  ];
};

export const seedApiKeys = () => [
  {
    appId: "key-001",
    name: "Retail Reporting",
    key: "sk_live_retail_reporting_34as2dwe893a",
    permission: "Read Only",
    createdAt: "2026-02-11",
    lastUsed: "Today, 10:24",
    callsToday: 1240,
    status: "active",
  },
  {
    appId: "key-002",
    name: "Session Sync",
    key: "sk_live_session_sync_1j9smd2k3l9as",
    permission: "Read / Write",
    createdAt: "2026-01-22",
    lastUsed: "Today, 09:51",
    callsToday: 843,
    status: "active",
  },
  {
    appId: "key-003",
    name: "Store Pilot",
    key: "sk_live_store_pilot_x9a9s0dm23pk1",
    permission: "Read Only",
    createdAt: "2026-03-06",
    lastUsed: "Yesterday, 19:40",
    callsToday: 206,
    status: "active",
  },
];

export const apiConfiguration = {
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

export const webhookConfiguration = {
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

export const iframeConfiguration = {
  baseUrl: "https://lms.samsung.com/train/",
  defaultWidth: "100%",
  height: 680,
  allowedParentDomains: ["samsung-internal.com", "samsung-portal.com", "samsung-hr.net"],
  ssoParameterName: "sso",
  allowFullscreen: true,
  autoResize: true,
  blockRightClick: false,
};

export const buildDashboard = ({ clients, webhookConfig, session, users = [], trainingRecords = [] }) => {
  const totalUsers = users.length || clients.reduce((sum, client) => sum + client.activeUsers, 0);
  const totalSessions = clients.reduce((sum, client) => sum + client.sessions, 0);
  const platformTrainingCount = trainingRecords.length || clients.reduce((sum, client) => sum + client.trainings, 0);
  const activeClients = clients.filter((client) => client.status === "active").length;
  const isSuperAdmin = session?.role === "super_admin";
  const companyAccess = "6";
  const clientTrainingCount = clients[0] ? String(clients[0].trainings || 0) : "0";
  const totalTrainees = "1";
  const trainingSessions = String(Math.round(totalSessions / 8) + 184);

  return {
    kpis: isSuperAdmin
      ? [
        { label: "Total Clients", value: String(clients.length), icon: "bi bi-buildings", color: "#3e60d5", subtle: "#ebf2ff", hint: `${activeClients} active accounts` },
        { label: "Total Sessions", value: String(totalSessions), icon: "bi bi-play-circle", color: "#a020f0", subtle: "#f4e1ff", hint: "Learner training attempts recorded overall" },
        { label: "Total Trainings", value: String(platformTrainingCount), icon: "bi bi-journal-richtext", color: "#47ad77", subtle: "#e6faf3", hint: "Training modules created across all clients" },
        { label: "Total User", value: String(totalUsers), icon: "bi bi-people", color: "#16a7e9", subtle: "#e6f6fd", hint: "Users added across all clients" },
      ]
      : [
        { label: "Company Access", value: companyAccess, icon: "bi bi-person-badge", color: "#16a7e9", subtle: "#e6f6fd", hint: "Trainers, reviewers, and client admins with access" },
        { label: "Total Trainings", value: clientTrainingCount, icon: "bi bi-journal-richtext", color: "#3e60d5", subtle: "#ebf2ff", hint: "Created learning modules in this workspace" },
        { label: "Training Sessions", value: trainingSessions, icon: "bi bi-play-circle", color: "#a020f0", subtle: "#f4e1ff", hint: "Started and completed learner sessions" },
        { label: "Total Trainees", value: totalTrainees, icon: "bi bi-mortarboard", color: "#47ad77", subtle: "#e6faf3", hint: "Learner profiles available for assignment" },
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
    recentWebhookEvents: webhookConfig.logs.slice(0, 4),
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

export const ensureSeedData = async ({ users, clients, apiKeys, configs }) => {
  const hasUsers = await users.countDocuments();

  if (!hasUsers) {
    await users.insertMany(seedUsers());
  }

  const hasClients = await clients.countDocuments();

  if (!hasClients) {
    await clients.insertMany(seedClients());
  }

  const hasApiKeys = await apiKeys.countDocuments();

  if (!hasApiKeys) {
    await apiKeys.insertMany(seedApiKeys());
  }

  const configCount = await configs.countDocuments();

  if (!configCount) {
    await configs.insertMany([
      { key: "settings", value: appSettings },
      { key: "apiConfig", value: apiConfiguration },
      { key: "webhookConfig", value: webhookConfiguration },
      { key: "iframeConfig", value: iframeConfiguration },
    ]);
  }
};

export const sanitizeUserRecord = (user) => ({
  id: user.appId,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  trainings: Number(user.trainings ?? 0),
  lastActive: user.lastActive || "Today",
});

export const buildLoginResponse = (user, token) => ({
  token,
  user: sanitizeUserForClient(user),
});
