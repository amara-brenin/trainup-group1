import type {
  AdminUser,
  AuthLoginResponse,
  AppSettings,
  ApiConfiguration,
  ApiEnvelope,
  ApiKeyPermission,
  ApiKeyRecord,
  ClientFormValues,
  ClientRecord,
  ClientSettingsSection,
  DashboardSummary,
  IframeConfiguration,
  NotificationPayload,
  NotificationRecord,
  PaginatedResponse,
  RoleDefinitionRecord,
  RolePermissionsPayload,
  SuperAdminFormValues,
  SuperAdminRecord,
  TrainingProctoringReport,
  TrainingSessionRecord,
  TrainingWorkspaceRecord,
  UserFormValues,
  UserRecord,
  WebhookConfiguration,
} from "../constant/interfaces";
import AvatarImage from "../assets/images/avatar.png";
import Favicon from "../assets/images/favicon.png";
import Logo from "../assets/images/logo.png";
import LogoDark from "../assets/images/logo-dark.png";
import {
  buildAllowedFromPermissions,
  fixedRoleDefinitions,
  getFixedRoleDefinition,
  isSamePermissionSet,
  normalizePermissionList,
  permissionModules,
} from "../constant/accessControl";
import { AllowedKeys, PermissionKeys } from "../constant/permissions";
import { DEFAULT_ELEVENLABS_PROVIDER, DEFAULT_ELEVENLABS_VOICE_NAME } from "../constant/tts";
import { sanitizeLaunchNarrationScript } from "./trainingNarration";
import { ensureArray, isValidEmail, isValidUrl } from "./validation";

type MockUserRecord = UserRecord & {
  clientId?: string;
  roleName?: string;
  useRoleDefaults?: boolean;
  phone?: string;
  image?: string;
  isUnreadNotifications?: boolean;
};

type MockNotificationRecord = NotificationRecord & {
  userId: string;
  clientId?: string;
};

type Database = {
  clients: ClientRecord[];
  users: MockUserRecord[];
  apiKeys: ApiKeyRecord[];
  apiConfig: ApiConfiguration;
  webhookConfig: WebhookConfiguration;
  iframeConfig: IframeConfiguration;
  rolePermissions: RoleDefinitionRecord[];
  notifications: MockNotificationRecord[];
};

type Params = Record<string, unknown> | undefined;
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

const DB_KEY = "trainup-admin-db";
const SESSION_KEY = "trainup-admin-session";
const TRAINING_WORKSPACE_KEY = "trainup-training-workspace";
const CREDIT_COSTS = {
  training: 500,
  user: 200,
  session: 100,
} as const;
const PLAN_CONFIG = {
  FREE: {
    code: "FREE",
    monthlyCredits: 2000,
    limits: { trainings: 1, users: 3, sessions: 5 },
    contactSales: false,
  },
  PRO: {
    code: "PRO",
    monthlyCredits: 40000,
    limits: { trainings: 10, users: 50, sessions: 250 },
    contactSales: false,
  },
  ENTERPRISE: {
    code: "ENTERPRISE",
    monthlyCredits: 0,
    limits: { trainings: null, users: null, sessions: null },
    contactSales: true,
  },
} as const;
const mockAskModelName = "mock-module-kb";
const mockTtsVoices = [
  {
    voiceId: "Wh1QG8ICTAxQWHIbW3SS",
    name: DEFAULT_ELEVENLABS_VOICE_NAME,
    category: "premade",
    previewUrl: "",
    gender: "female",
    accent: "",
    age: "",
    description: "",
    isDefault: true,
  },
  {
    voiceId: "trainer-voice-demo",
    name: "Store Mentor",
    category: "premade",
    previewUrl: "",
    gender: "female",
    accent: "",
    age: "",
    description: "",
    isDefault: false,
  },
  {
    voiceId: "reviewer-voice-demo",
    name: "Retail Coach",
    category: "premade",
    previewUrl: "",
    gender: "female",
    accent: "",
    age: "",
    description: "",
    isDefault: false,
  },
];

const getMockTrainingWorkspace = () => {
  if (typeof window === "undefined") {
    return [] as TrainingWorkspaceRecord[];
  }

  try {
    const raw = window.localStorage.getItem(TRAINING_WORKSPACE_KEY);

    if (!raw) {
      return [] as TrainingWorkspaceRecord[];
    }

    const parsed = JSON.parse(raw) as { trainings?: TrainingWorkspaceRecord[] };
    return Array.isArray(parsed.trainings) ? parsed.trainings : [];
  } catch {
    return [] as TrainingWorkspaceRecord[];
  }
};

const setMockTrainingWorkspace = (trainings: TrainingWorkspaceRecord[]) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      TRAINING_WORKSPACE_KEY,
      JSON.stringify({
        trainings: trainings.map((training) => ({
          ...training,
          slides: training.slides.map((slide) => ({
            ...slide,
            narrationAudio: slide.narrationAudio
              ? {
                ...slide.narrationAudio,
                src: "",
              }
              : null,
          })),
          localizedVoiceovers: training.localizedVoiceovers
            ? {
              ...training.localizedVoiceovers,
              languages: training.localizedVoiceovers.languages.map((language) => ({
                ...language,
                apiKey: language.apiKey ? "" : language.apiKey,
                translatedSlides: language.translatedSlides.map((slide) => ({
                  ...slide,
                  narrationAudio: slide.narrationAudio
                    ? {
                      ...slide.narrationAudio,
                      src: "",
                    }
                    : null,
                })),
              })),
            }
            : null,
        })),
      }),
    );
  } catch (error) {
    console.warn("[mockApi] Unable to persist training workspace to localStorage.", error);
  }
};

const getMockTrainingById = (trainingId: string, options?: { preview?: boolean }) => {
  const records = getMockTrainingWorkspace();
  const training = records.find(
    (item) => String(item.id || "").toLowerCase() === String(trainingId || "").toLowerCase(),
  );

  if (!training) {
    return null;
  }

  if (options?.preview) {
    return training;
  }

  return training.status === "approved" ? training : null;
};

const upsertMockTraining = (training: TrainingWorkspaceRecord) => {
  const records = getMockTrainingWorkspace();
  const targetIndex = records.findIndex((item) => item.id === training.id);

  if (targetIndex === -1) {
    records.unshift(training);
  } else {
    records[targetIndex] = training;
  }

  setMockTrainingWorkspace(records);
};

const formatMockTimeSpent = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
};

const getMockViewerName = () => getSession()?.fullname || getSession()?.name || "Learner";
const getMockViewerEmail = () => getSession()?.email?.toLowerCase() || "";
const normalizePlanCode = (plan: string) => {
  const normalized = String(plan || "").trim().toUpperCase();

  if (normalized === "PRO") {
    return "PRO";
  }

  if (normalized === "FREE" || normalized === "STARTER" || normalized === "TRIAL") {
    return "FREE";
  }

  return "ENTERPRISE";
};
const getPlanConfig = (plan: string) => PLAN_CONFIG[normalizePlanCode(plan)];
const hydrateClientCredits = (client: ClientRecord) => {
  const planConfig = getPlanConfig(client.plan);
  const monthlyCredits = Number(client.monthlyCredits ?? planConfig.monthlyCredits);
  const purchasedCredits = Number(client.purchasedCredits ?? 0);
  const usedCredits = Number(client.usedCredits ?? 0);
  const totalCredits = Number(client.totalCredits ?? monthlyCredits + purchasedCredits);

  client.plan = normalizePlanCode(client.plan);
  client.monthlyCredits = monthlyCredits;
  client.purchasedCredits = purchasedCredits;
  client.usedCredits = usedCredits;
  client.totalCredits = totalCredits;
  client.billingCycle = "monthly";
  client.trainingCreditCost = CREDIT_COSTS.training;
  client.userCreditCost = CREDIT_COSTS.user;
  client.sessionCreditCost = CREDIT_COSTS.session;
  client.planLimits = {
    trainings: planConfig.limits.trainings,
    users: planConfig.limits.users,
    sessions: planConfig.limits.sessions,
  };

  return client;
};
const getClientById = (database: Database, clientId?: string | null) =>
  database.clients.find((client) => client.id === String(clientId || "").trim()) || database.clients[0] || null;
const getSessionClient = (database: Database) => getClientById(database, getSession()?.clientId);
const getClientScopedUsers = (database: Database, clientId?: string | null) =>
  database.users.filter((user) => user.role !== "super_admin" && user.clientId === String(clientId || "").trim());
const refreshMockSession = (database: Database) => {
  syncMockUnreadFlags(database);
  const session = getSession();

  if (!session) {
    return;
  }

  const currentUser = database.users.find((item) => item.email.toLowerCase() === session.email.toLowerCase());

  if (currentUser) {
    setSession(toAdminProfile(currentUser, database));
  }
};
const getAvailableCredits = (client: ClientRecord) =>
  Math.max(Number(client.totalCredits ?? 0) - Number(client.usedCredits ?? 0), 0);
const getMockPlanStatus = (client: ClientRecord) =>
  client.status === "inactive" || getAvailableCredits(client) <= 0 ? "expired" : "active";
const getMockBillingDates = () => {
  const startedOn = new Date();
  const expiresOn = new Date(startedOn);
  expiresOn.setMonth(expiresOn.getMonth() + 1);

  return {
    startedOn: startedOn.toISOString(),
    expiresOn: expiresOn.toISOString(),
  };
};
const getMockPlanUsage = (client: ClientRecord) => ({
  trainings: Math.min(Number(client.trainings ?? 0), Number(client.planLimits?.trainings ?? client.trainings ?? 0)),
  users: Math.min(Number(client.activeUsers ?? 0), Number(client.planLimits?.users ?? client.activeUsers ?? 0)),
  sessions: Math.min(Number(client.sessions ?? 0), Number(client.planLimits?.sessions ?? client.sessions ?? 0)),
});
const getUsageLimitError = (client: ClientRecord, resource: keyof NonNullable<ClientRecord["planLimits"]>, nextCount: number) => {
  const planConfig = getPlanConfig(client.plan);
  const limit = client.planLimits?.[resource] ?? planConfig.limits[resource];

  if (limit === null || limit === undefined) {
    return "";
  }

  if (nextCount <= limit) {
    return "";
  }

  const labels = {
    trainings: "training",
    users: "user",
    sessions: "session",
  };

  return `Current ${client.plan} plan allows only ${limit} ${labels[resource]}${limit === 1 ? "" : "s"}.`;
};
const tryConsumeClientCredits = (client: ClientRecord, credits: number) => {
  if (getPlanConfig(client.plan).contactSales) {
    return "";
  }

  if (getAvailableCredits(client) < credits) {
    return `Not enough credits. ${credits} credits required, ${getAvailableCredits(client)} available.`;
  }

  client.usedCredits = Number(client.usedCredits ?? 0) + credits;
  return "";
};
const isMockMultipleAttemptAllowed = (training: TrainingWorkspaceRecord) => training.options?.allowMultipleAttempts !== false;
const hasMockViewerCompletedTraining = (training: TrainingWorkspaceRecord) => {
  const viewerName = getMockViewerName().trim().toLowerCase();
  const viewerEmail = getMockViewerEmail();

  return (training.sessions ?? []).some((session) => {
    const sessionName = String(session.learnerName || "").trim().toLowerCase();
    const sessionEmail = String(session.learnerEmail || "").trim().toLowerCase();

    if (session.mode !== "public" || session.status !== "completed") {
      return false;
    }

    if (viewerEmail && sessionEmail) {
      return sessionEmail === viewerEmail;
    }

    return Boolean(viewerName && sessionName && sessionName === viewerName);
  });
};

const getMockViewerSessionHistory = () => {
  const viewerName = getMockViewerName().trim().toLowerCase();
  const viewerEmail = getMockViewerEmail();

  return getMockTrainingWorkspace().flatMap((record) =>
    (record.sessions ?? [])
      .filter((session) => {
        const sessionName = String(session.learnerName || "").trim().toLowerCase();
        const sessionEmail = String(session.learnerEmail || "").trim().toLowerCase();

        if (viewerEmail && sessionEmail) {
          return sessionEmail === viewerEmail;
        }

        if (viewerName && sessionName) {
          return sessionName === viewerName;
        }

        return false;
      })
      .map((session) => ({
        sessionId: session.id,
        trainingId: record.id,
        trainingTitle: record.title,
        trainingType: record.type,
        trainingAudience: record.audience,
        status: session.status,
        timeSpent: session.timeSpent,
        slidesViewed: session.slidesViewed,
        totalSlides: session.totalSlides,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
      })),
  );
};

const normalizeLaunchScript = (training: TrainingWorkspaceRecord, slide: TrainingWorkspaceRecord["slides"][number], index: number) =>
  sanitizeLaunchNarrationScript({
    script: slide.script,
    trainingTitle: training.title,
    slideTitle: slide.title,
    index,
  });

const buildMockLaunchPayload = (training: TrainingWorkspaceRecord, preview: boolean) => ({
  id: training.id,
  title: training.title,
  type: training.type,
  audience: training.audience,
  trainer: training.trainer,
  status: training.status,
  isPublished: Boolean(training.isPublished),
  publishedOn: training.publishedOn ?? null,
  trainingMode: training.trainingMode ?? "avatar",
  avatarName: training.avatarName,
  avatarId: training.avatarId,
  ttsProvider: training.ttsProvider,
  voiceName: training.voiceName,
  voiceId: training.voiceId,
  questionButtonLabel: training.questionButtonLabel,
  presenterNotes: training.presenterNotes,
  previewSlideId: training.previewSlideId ?? null,
  previewThumbnailAssetId: training.previewThumbnailAssetId ?? null,
  previewThumbnailAssetName: training.previewThumbnailAssetName ?? null,
  previewThumbnailUrl: "",
  durationMins: training.durationMins,
  options: training.options,
  theme: training.theme,
  avatarEngine: training.avatarEngine ?? null,
  localizedVoiceovers: training.localizedVoiceovers ?? null,
  branding: {
    application_name: training.branding?.applicationName || "Trainup",
    companyName: training.branding?.companyName || "Trainup Retail India",
    email: training.branding?.supportEmail || "support@samsung.com",
    logo: training.branding?.logoUrl || "",
    logoUrl: training.branding?.logoUrl || "",
    favicon: training.branding?.faviconUrl || "",
    faviconUrl: training.branding?.faviconUrl || "",
    loaderTitle: training.branding?.loaderTitle || "Preparing Training",
    loaderCaption:
      training.branding?.loaderCaption || "Camera verification and session checks are in progress.",
  },
  launchMode: preview ? "preview" : "public",
  viewerName: getMockViewerName(),
  sessions: training.sessions ?? [],
  learnerSessionHistory: getMockViewerSessionHistory(),
  slides: training.slides.map((slide, index) => ({
    id: slide.id,
    order: index,
    title: slide.title,
    script: slide.script,
    mediaUrl: "",
    mediaName: slide.mediaName,
    settings: slide.settings,
    formFields: slide.formFields,
    formConfig: slide.formConfig,
    additionalInfo: slide.additionalInfo,
    narrationAudio: slide.narrationAudio ?? null,
  })),
  questionCheckpoints: training.questionCheckpoints ?? [],
  questionSets: training.questionSets ?? [],
});

const buildMockKnowledgeBaseEntries = (training: TrainingWorkspaceRecord) =>
  training.slides
    .map((slide, index) => {
      const summary = [
        slide.title,
        normalizeLaunchScript(training, slide, index),
        slide.additionalInfo,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(". ");

      return {
        slideId: slide.id,
        summary,
      };
    })
    .filter((item) => item.summary);

const tokenizeMockQuestion = (value: string) =>
  String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);

const truncateMockWords = (value: string, count: number) => {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);

  if (words.length <= count) {
    return words.join(" ");
  }

  return `${words.slice(0, count).join(" ")}...`;
};

const buildMockAskReply = (training: TrainingWorkspaceRecord, question: string) => {
  const entries = buildMockKnowledgeBaseEntries(training);
  const tokens = tokenizeMockQuestion(question);

  if (!entries.length) {
    return "I can only answer from this module, and there is no approved module content available yet.";
  }

  const rankedEntry =
    entries
      .map((entry) => ({
        ...entry,
        score: tokens.reduce((total, token) => total + (entry.summary.toLowerCase().includes(token) ? 1 : 0), 0),
      }))
      .sort((left, right) => right.score - left.score)[0] ?? null;

  if (rankedEntry?.score) {
    return `According to this module, ${truncateMockWords(rankedEntry.summary, 40)}`;
  }

  return `I can only answer from this module. It covers: ${truncateMockWords(
    entries.map((entry) => entry.summary).join(" "),
    36,
  )}`;
};

const getSuperAdminAccess = () => ({
  roleName: "Super Admin",
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
  allowed: ["dashboard", "clients", "staff"],
});

const cloneRoleDefinition = (definition: RoleDefinitionRecord): RoleDefinitionRecord => ({
  ...definition,
  permission: normalizePermissionList(definition.permission),
  allowed: buildAllowedFromPermissions(definition.permission),
});

const ensureMockAdminBillingPermissions = (roleDefinitions: RoleDefinitionRecord[]) => {
  let changed = false;

  const value = roleDefinitions.map((definition) => {
    if (definition.id !== "admin") {
      return definition;
    }

    const permission = normalizePermissionList(definition.permission);
    const nextPermission = [...permission];

    if (!nextPermission.includes("billing.view")) {
      nextPermission.push("billing.view");
      changed = true;
    }

    if (!nextPermission.includes("billing.manage")) {
      nextPermission.push("billing.manage");
      changed = true;
    }

    return {
      ...definition,
      permission: nextPermission,
      allowed: buildAllowedFromPermissions(nextPermission),
    };
  });

  return {
    changed,
    value,
  };
};

const ensureMockNotificationPermissions = (roleDefinitions: RoleDefinitionRecord[]) => {
  let changed = false;
  const roleIds = new Set(["admin", "trainer", "reviewer"]);

  const value = roleDefinitions.map((definition) => {
    if (!roleIds.has(definition.id)) {
      return definition;
    }

    const permission = normalizePermissionList(definition.permission);
    const nextPermission = [...permission];
    const nextAllowed = Array.isArray(definition.allowed) ? [...definition.allowed] : [];

    if (!nextPermission.includes("notifications.view")) {
      nextPermission.push("notifications.view");
      changed = true;
    }

    if (!nextAllowed.includes("notifications")) {
      nextAllowed.push("notifications");
      changed = true;
    }

    return {
      ...definition,
      permission: nextPermission,
      allowed: nextAllowed,
    };
  });

  return {
    changed,
    value,
  };
};

const getMockRoleDefinitions = (database: Database) =>
  (database.rolePermissions?.length ? database.rolePermissions : fixedRoleDefinitions).map(cloneRoleDefinition);

const getMockRoleDefinition = (role: MockUserRecord["role"], database: Database) =>
  getMockRoleDefinitions(database).find((definition) => definition.id === role) ?? null;

const getUnreadNotificationCount = (database: Database, userId: string) =>
  database.notifications.filter((item) => item.userId === userId && !item.readAt).length;

const buildMockNotification = (
  userId: string,
  payload: Partial<NotificationRecord> & { title: string; message: string },
  clientId = "",
): MockNotificationRecord => ({
  id: `notification-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  userId,
  clientId,
  title: payload.title,
  message: payload.message,
  category: payload.category ?? "system",
  severity: payload.severity ?? "info",
  link: payload.link ?? "/dashboard",
  createdAt: payload.createdAt ?? new Date().toISOString(),
  readAt: payload.readAt ?? "",
  actorName: payload.actorName ?? "",
  isRead: Boolean(payload.readAt),
});

const pushMockNotifications = (
  database: Database,
  userIds: string[],
  payload: Partial<NotificationRecord> & { title: string; message: string },
  clientId = "",
) => {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  for (const userId of uniqueIds) {
    database.notifications.unshift(buildMockNotification(userId, payload, clientId));
  }

  database.notifications = database.notifications.slice(0, 200);
};

const syncMockUnreadFlags = (database: Database) => {
  database.users = database.users.map((user) => ({
    ...user,
    isUnreadNotifications: getUnreadNotificationCount(database, user.id) > 0,
  }));
};

const resolveMockUserAccess = (user: MockUserRecord, database: Database) => {
  if (user.role === "super_admin") {
    return getSuperAdminAccess();
  }

  const roleDefinition = getMockRoleDefinition(user.role, database);
  const defaultPermission = roleDefinition?.permission ?? [];
  const useRoleDefaults = user.useRoleDefaults !== false;

  if (useRoleDefaults) {
    return {
      roleName: roleDefinition?.roleName ?? "User",
      permission: [...defaultPermission],
      allowed: [...(roleDefinition?.allowed ?? [])],
    };
  }

  const permission = normalizePermissionList(user.permission ?? []);

  return {
    roleName: user.roleName ?? roleDefinition?.roleName ?? "User",
    permission,
    allowed: buildAllowedFromPermissions(permission),
  };
};

const toAdminProfile = (user: MockUserRecord, database: Database): AdminUser => {
  const access = resolveMockUserAccess(user, database);
  const client = getClientById(database, user.clientId);

  return {
    _id: user.id,
    clientId: user.role === "super_admin" ? "" : client?.id ?? "",
    clientName: user.role === "super_admin" ? "" : client?.name ?? "",
    currentPlan: client?.plan ?? "FREE",
    name: user.name,
    fullname: user.name,
    email: user.email,
    phone: "",
    title: "",
    department: "",
    role: user.role,
    roleName: access.roleName,
    permission: access.permission,
    allowed: access.allowed,
    image: AvatarImage,
    usedCredits: user.role === "super_admin" ? 0 : Number(client?.usedCredits ?? 0),
    totalCredits: user.role === "super_admin" ? 0 : Number(client?.totalCredits ?? 0),
    isUnreadNotifications: getUnreadNotificationCount(database, user.id) > 0,
  };
};

const appSettings: AppSettings = {
  application_name: "Trainup",
  logo: Logo,
  dark_logo: LogoDark,
  favicon: Favicon,
  primaryColor: "#2563eb",
  secondaryColor: "#475569",
  accentColor: "#14b8a6",
  gradientFrom: "#2563eb",
  gradientTo: "#14b8a6",
  email: "support@trainup.ai",
  copyright: `© ${new Date().getFullYear()} Trainup. All rights reserved.`,
  phone: "+91 1800 120 9999",
  path: "/dashboard",
};

const buildClientAppSettings = (client: ClientRecord | null): AppSettings => ({
  ...appSettings,
  application_name: client?.applicationName || client?.name || appSettings.application_name,
  logo: client?.logoUrl || appSettings.logo,
  dark_logo: client?.darkLogoUrl || client?.logoUrl || appSettings.dark_logo,
  favicon: client?.faviconUrl || appSettings.favicon,
  primaryColor: client?.primaryColor || appSettings.primaryColor,
  secondaryColor: client?.secondaryColor || appSettings.secondaryColor,
  accentColor: client?.secondaryColor || appSettings.accentColor,
  gradientFrom: client?.primaryColor || appSettings.gradientFrom,
  gradientTo: client?.secondaryColor || appSettings.gradientTo,
  email: client?.supportEmail || appSettings.email,
  copyright: `Â© ${new Date().getFullYear()} ${client?.applicationName || client?.name || "Trainup"}. All rights reserved.`,
});

const seedClients = (): ClientRecord[] => [
  hydrateClientCredits({
    id: "client-001",
    name: "Trainup Retail India",
    industry: "Retail Operations",
    plan: "ENTERPRISE",
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
    ssoType: "Trainup IAM",
    ssoStatus: "connected",
    supportEmail: "retail-training@samsung.com",
    allowedOrigins: ["https://retail.samsung.com", "https://retail-ops.samsung.com"],
    webhookUrl: "https://retail.samsung.com/api/lms/webhook",
    apiScope: "Session sync, completion reports, catalog access",
  }),
  hydrateClientCredits({
    id: "client-002",
    name: "Trainup Service Academy",
    industry: "Service Training",
    plan: "PRO",
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
    supportEmail: "service-academy@samsung.com",
    allowedOrigins: ["https://service.samsung.com"],
    webhookUrl: "https://service.samsung.com/webhooks/training",
    apiScope: "Course publish, assessments, completion reports",
  }),
  hydrateClientCredits({
    id: "client-003",
    name: "Trainup Experience Stores",
    industry: "Store Enablement",
    plan: "FREE",
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
    supportEmail: "experience-stores@samsung.com",
    allowedOrigins: ["https://experience.samsung.com"],
    webhookUrl: "https://experience.samsung.com/training/webhook",
    apiScope: "Catalog access only",
  }),
];

const seedUsers = (): MockUserRecord[] => {
  const buildRoleUser = (
    id: string,
    name: string,
    email: string,
    role: Exclude<UserRecord["role"], "super_admin">,
    trainings: number,
    lastActive: string,
    clientId = "client-001",
  ): MockUserRecord => {
    const roleDefinition = getFixedRoleDefinition(role);

    return {
      id,
      name,
      email,
      role,
      roleName: roleDefinition?.roleName ?? role,
      status: "active",
      trainings,
      lastActive,
      permission: [...(roleDefinition?.permission ?? [])],
      allowed: [...(roleDefinition?.allowed ?? [])],
      permissionSource: "role",
      clientId,
      useRoleDefaults: true,
    };
  };

  return [
    {
      id: "user-000",
      name: "Aditi Nair",
      email: "superadmin@samsung.com",
      role: "super_admin",
      roleName: "Super Admin",
      status: "active",
      trainings: 0,
      lastActive: "Today",
      permission: [...getSuperAdminAccess().permission],
      allowed: [...getSuperAdminAccess().allowed],
      permissionSource: "role",
      clientId: "",
      useRoleDefaults: true,
    },
    buildRoleUser("user-001", "Rohan Mehta", "trainer@samsung.com", "trainer", 12, "Today"),
    buildRoleUser("user-002", "Priya Sharma", "priya@samsung.com", "trainer", 9, "Yesterday"),
    buildRoleUser("user-003", "Anjali Verma", "anjali@samsung.com", "trainer", 6, "2 days ago"),
    buildRoleUser("user-004", "Ankit Kumar", "reviewer@samsung.com", "reviewer", 0, "Today"),
    buildRoleUser("user-005", "Neha Gupta", "neha@samsung.com", "reviewer", 0, "Yesterday"),
    buildRoleUser("user-006", "Ritika Singh", "admin@samsung.com", "admin", 0, "Today"),
    {
      id: "user-101",
      name: "Aarav Patel",
      email: "aarav.patel@samsung.com",
      role: "trainee",
      roleName: "Trainee",
      status: "active",
      trainings: 5,
      lastActive: "Today",
      permission: [],
      allowed: [],
      permissionSource: "role",
      clientId: "client-001",
      useRoleDefaults: false,
    },
    {
      id: "user-102",
      name: "Ishita Rao",
      email: "ishita.rao@samsung.com",
      role: "trainee",
      roleName: "Trainee",
      status: "active",
      trainings: 3,
      lastActive: "Yesterday",
      permission: [],
      allowed: [],
      permissionSource: "role",
      clientId: "client-001",
      useRoleDefaults: false,
    },
    {
      id: "user-103",
      name: "Kunal Shah",
      email: "kunal.shah@samsung.com",
      role: "trainee",
      roleName: "Trainee",
      status: "inactive",
      trainings: 1,
      lastActive: "5 days ago",
      permission: [],
      allowed: [],
      permissionSource: "role",
      clientId: "client-001",
      useRoleDefaults: false,
    },
    {
      id: "user-104",
      name: "Meera Joshi",
      email: "meera.joshi@samsung.com",
      role: "trainee",
      roleName: "Trainee",
      status: "active",
      trainings: 4,
      lastActive: "Today",
      permission: [],
      allowed: [],
      permissionSource: "role",
      clientId: "client-001",
      useRoleDefaults: false,
    },
  ];
};

const seedNotifications = (users: MockUserRecord[], clients: ClientRecord[]): MockNotificationRecord[] => {
  const superAdmin = users.find((user) => user.role === "super_admin");
  const clientAdmin = users.find((user) => user.role === "admin");
  const trainer = users.find((user) => user.role === "trainer");
  const reviewer = users.find((user) => user.role === "reviewer");
  const primaryClient = clients[0];
  const records: MockNotificationRecord[] = [];

  if (superAdmin) {
    records.push(
      buildMockNotification(
        superAdmin.id,
        {
          title: "New enterprise request",
          message: `${primaryClient?.name || "A client"} requested enterprise pricing support.`,
          category: "billing",
          severity: "warning",
          link: primaryClient ? `/clients/${primaryClient.id}` : "/clients",
          createdAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
        },
      ),
    );
  }

  if (clientAdmin && primaryClient) {
    records.push(
      buildMockNotification(
        clientAdmin.id,
        {
          title: "Plan updated",
          message: `${primaryClient.name} is now on the ${primaryClient.plan} plan.`,
          category: "billing",
          severity: "success",
          link: "/upgrade-billings",
          createdAt: new Date(Date.now() - 1000 * 60 * 80).toISOString(),
        },
        primaryClient.id,
      ),
    );
  }

  if (trainer && primaryClient) {
    records.push(
      buildMockNotification(
        trainer.id,
        {
          title: "Changes requested",
          message: "Retail Floor Safety Protocol needs updates before approval.",
          category: "review",
          severity: "warning",
          link: "/dashboard",
          createdAt: new Date(Date.now() - 1000 * 60 * 140).toISOString(),
        },
        primaryClient.id,
      ),
    );
  }

  if (reviewer && primaryClient) {
    records.push(
      buildMockNotification(
        reviewer.id,
        {
          title: "Training submitted for review",
          message: "Galaxy S25 Sales Mastery is ready for reviewer action.",
          category: "training",
          severity: "info",
          link: "/dashboard",
          createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
        },
        primaryClient.id,
      ),
    );
  }

  return records;
};

const seedApiKeys = (): ApiKeyRecord[] => [
  {
    id: "key-001",
    name: "Retail Reporting",
    key: "sk_live_retail_reporting_34as2dwe893a",
    permission: "Read Only",
    createdAt: "2026-02-11",
    lastUsed: "Today, 10:24",
    callsToday: 1240,
    status: "active",
  },
  {
    id: "key-002",
    name: "Session Sync",
    key: "sk_live_session_sync_1j9smd2k3l9as",
    permission: "Read / Write",
    createdAt: "2026-01-22",
    lastUsed: "Today, 09:51",
    callsToday: 843,
    status: "active",
  },
  {
    id: "key-003",
    name: "Store Pilot",
    key: "sk_live_store_pilot_x9a9s0dm23pk1",
    permission: "Read Only",
    createdAt: "2026-03-06",
    lastUsed: "Yesterday, 19:40",
    callsToday: 206,
    status: "active",
  },
];

const seedDatabase = (): Database => {
  const clients = seedClients();
  const users = seedUsers();

  return {
    clients,
    users,
    apiKeys: seedApiKeys(),
    apiConfig: {
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
    },
    webhookConfig: {
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
    },
    iframeConfig: {
      baseUrl: "https://lms.samsung.com/train/",
      defaultWidth: "100%",
      height: 680,
      allowedParentDomains: ["samsung-internal.com", "samsung-portal.com", "samsung-hr.net"],
      ssoParameterName: "sso",
      allowFullscreen: true,
      autoResize: true,
      blockRightClick: false,
    },
    rolePermissions: fixedRoleDefinitions.map(cloneRoleDefinition),
    notifications: seedNotifications(users, clients),
  };
};

const migrateDatabase = (database: Database) => {
  let changed = false;
  const seededUsers = seedUsers();

  const syncSeedUser = (seedUser: MockUserRecord) => {
    const existingUser = database.users.find(
      (user) => user.email.toLowerCase() === seedUser.email.toLowerCase(),
    );

    if (!existingUser) {
      database.users.unshift(seedUser);
      changed = true;
      return;
    }

    if (existingUser.name !== seedUser.name) {
      existingUser.name = seedUser.name;
      changed = true;
    }

    if (existingUser.role !== seedUser.role) {
      existingUser.role = seedUser.role;
      changed = true;
    }
  };

  seededUsers
    .filter((user) => user.email === "superadmin@samsung.com" || user.email === "admin@samsung.com")
    .forEach(syncSeedUser);

  if (!database.users.some((user) => user.role === "trainee")) {
    seededUsers
      .filter((user) => user.role === "trainee")
      .forEach((user) => {
        database.users.push(user);
        changed = true;
      });
  }

  if (!database.rolePermissions?.length) {
    database.rolePermissions = fixedRoleDefinitions.map(cloneRoleDefinition);
    changed = true;
  } else {
    const syncedBillingRoles = ensureMockAdminBillingPermissions(database.rolePermissions);
    const syncedRoles = ensureMockNotificationPermissions(syncedBillingRoles.value);

    if (syncedBillingRoles.changed || syncedRoles.changed) {
      database.rolePermissions = syncedRoles.value;
      changed = true;
    }
  }

  database.clients = database.clients.map((client) => {
    const before = JSON.stringify(client);
    const hydrated = hydrateClientCredits(client);

    if (JSON.stringify(hydrated) !== before) {
      changed = true;
    }

    return hydrated;
  });

  database.users = database.users.map((user) => {
    const access = resolveMockUserAccess(user, database);
    const permissionSource = user.useRoleDefaults === false ? "custom" : "role";

    if (
      user.roleName === access.roleName &&
      isSamePermissionSet(user.permission ?? [], access.permission) &&
      JSON.stringify([...(user.allowed ?? [])].sort()) === JSON.stringify([...access.allowed].sort()) &&
      user.permissionSource === permissionSource
    ) {
      return user;
    }

    changed = true;

    return {
      ...user,
      roleName: access.roleName,
      permission: access.permission,
      allowed: access.allowed,
      permissionSource,
    };
  });

  if (!Array.isArray(database.notifications)) {
    database.notifications = seedNotifications(database.users, database.clients);
    changed = true;
  } else {
    database.notifications = database.notifications.map((notification) => ({
      ...notification,
      isRead: Boolean(notification.readAt),
    }));
  }

  syncMockUnreadFlags(database);

  if (changed) {
    setDatabase(database);
  }

  return database;
};

const sleep = (ms = 180) => new Promise((resolve) => window.setTimeout(resolve, ms));

const getDatabase = (): Database => {
  const raw = window.localStorage.getItem(DB_KEY);

  if (!raw) {
    const seeded = seedDatabase();
    window.localStorage.setItem(DB_KEY, JSON.stringify(seeded));
    return seeded;
  }

  return migrateDatabase(JSON.parse(raw) as Database);
};

const setDatabase = (database: Database) => {
  window.localStorage.setItem(DB_KEY, JSON.stringify(database));
};

const getSession = () => {
  const raw = window.localStorage.getItem(SESSION_KEY);

  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw) as AdminUser;
  const database = getDatabase();
  const user = database.users.find((item) => item.email.toLowerCase() === parsed.email.toLowerCase());
  const canonicalProfile = user ? toAdminProfile(user, database) : null;

  if (!canonicalProfile) {
    return parsed;
  }

  if (JSON.stringify(parsed) !== JSON.stringify(canonicalProfile)) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(canonicalProfile));
  }

  return canonicalProfile;
};

const setSession = (user: AdminUser | null) => {
  if (!user) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }

  const database = getDatabase();
  const userRecord = database.users.find((item) => item.email.toLowerCase() === user.email.toLowerCase());
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(userRecord ? toAdminProfile(userRecord, database) : user));
};

const paginate = <T,>(records: T[], params: Params): PaginatedResponse<T> => {
  const limit = Number(params?.limit ?? 10);
  const pageNo = Number(params?.pageNo ?? 1);
  const count = records.length;
  const totalPages = Math.max(1, Math.ceil(count / limit));
  const currentPage = Math.min(pageNo, totalPages);
  const start = (currentPage - 1) * limit;
  const pagination = Array.from({ length: totalPages }, (_, index) => index + 1);

  return {
    count,
    totalPages,
    pagination,
    record: records.slice(start, start + limit),
  };
};

const ok = async <T,>(message: string, data: T): Promise<{ data: ApiEnvelope<T> }> => {
  await sleep();
  return { data: { status: true, message, data } };
};

const fail = async <T,>(message: string, data: T): Promise<{ data: ApiEnvelope<T> }> => {
  await sleep();
  return { data: { status: false, message, data } };
};

const contains = (source: string, query: string) =>
  source.toLowerCase().includes(query.toLowerCase());

const normalizeMockValue = (value: unknown) => String(value ?? "").trim();

const isMockSessionForTrainee = (session: TrainingSessionRecord, trainee: MockUserRecord) => {
  const traineeEmail = normalizeMockValue(trainee.email).toLowerCase();
  const traineeName = normalizeMockValue(trainee.name).toLowerCase();
  const sessionEmail = normalizeMockValue(session.learnerEmail || session.ssoId).toLowerCase();
  const sessionName = normalizeMockValue(session.learnerName).toLowerCase();

  return Boolean((traineeEmail && sessionEmail && traineeEmail === sessionEmail) || (traineeName && sessionName && traineeName === sessionName));
};

const getMockAssignedTrainingCount = (trainee: MockUserRecord) =>
  getMockTrainingWorkspace().filter((training) =>
    (training.sessions ?? []).some((session) => isMockSessionForTrainee(session, trainee)),
  ).length;

const isSameMockCalendarDay = (date: Date, reference: Date) =>
  date.getFullYear() === reference.getFullYear() &&
  date.getMonth() === reference.getMonth() &&
  date.getDate() === reference.getDate();

const getMockSessionSnapshot = (records: TrainingWorkspaceRecord[]) => {
  const now = new Date();
  let activeSessions = 0;
  let completionsToday = 0;
  let totalSessions = 0;

  records.forEach((training) => {
    const sessions = training.sessions ?? [];
    totalSessions += sessions.length;

    sessions.forEach((session) => {
      const status = String(session.status || "").trim().toLowerCase();
      const completedAt = new Date(session.completedAt || "");

      if (status === "in-progress") {
        activeSessions += 1;
      }

      if (status === "completed" && !Number.isNaN(completedAt.getTime()) && isSameMockCalendarDay(completedAt, now)) {
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

const buildDashboard = (database: Database, session: AdminUser | null): DashboardSummary => {
  const totalUsers = database.users.filter((user) => user.role !== "super_admin").length;
  const totalTrainings = database.clients.reduce((sum, client) => sum + Number(client.trainings || 0), 0);
  const totalSessions = database.clients.reduce((sum, client) => sum + Number(client.sessions || 0), 0);
  const activeClients = database.clients.filter((client) => client.status === "active").length;
  const isSuperAdmin = session?.role === "super_admin";
  const currentClient = getSessionClient(database);
  const clientScopedUsers = getClientScopedUsers(database, currentClient?.id).filter((user) => user.status === "active");
  const clientTeamCount = clientScopedUsers.filter((user) => user.role !== "trainee").length;
  const traineeCount = clientScopedUsers.filter((user) => user.role === "trainee").length;
  const sessionSnapshot = getMockSessionSnapshot(getMockTrainingWorkspace());

  return {
    kpis: isSuperAdmin
      ? [
        {
          label: "Total Clients",
          value: String(database.clients.length),
          icon: "bi bi-buildings",
          color: "#3e60d5",
          subtle: "#ebf2ff",
          hint: `${activeClients} active accounts`,
        },
        {
          label: "Total Sessions",
          value: String(totalSessions || sessionSnapshot.totalSessions),
          icon: "bi bi-play-circle",
          color: "#a020f0",
          subtle: "#f4e1ff",
          hint: "Learner training attempts recorded overall",
        },
        {
          label: "Total Trainings",
          value: String(totalTrainings),
          icon: "bi bi-journal-richtext",
          color: "#47ad77",
          subtle: "#e6faf3",
          hint: "Training modules created across all clients",
        },
        {
          label: "Total User",
          value: String(totalUsers),
          icon: "bi bi-people",
          color: "#16a7e9",
          subtle: "#e6f6fd",
          hint: "Users added across all clients",
        },
      ]
      : [
        {
          label: "Company Access",
          value: String(clientTeamCount),
          icon: "bi bi-person-badge",
          color: "#3e60d5",
          subtle: "#ebf2ff",
          hint: "Trainers, reviewers, and client admins with panel access",
        },
        {
          label: "Total Trainings",
          value: String(currentClient?.trainings ?? 0),
          icon: "bi bi-journal-richtext",
          color: "#a020f0",
          subtle: "#f4e1ff",
          hint: "Created or published trainings available for this client",
        },
        {
          label: "Training Sessions",
          value: String(currentClient?.sessions ?? sessionSnapshot.activeSessions),
          icon: "bi bi-play-circle",
          color: "#47ad77",
          subtle: "#e6faf3",
          hint: "Total learner attendance sessions recorded",
        },
        {
          label: "Total Trainees",
          value: String(traineeCount),
          icon: "bi bi-people",
          color: "#16a7e9",
          subtle: "#e6f6fd",
          hint: "Learner profiles available for training assignment",
        },
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
    recentWebhookEvents: database.webhookConfig.logs.slice(0, 4),
    quickActions: isSuperAdmin
      ? [
        {
          title: "Manage Clients",
          description: "Handle white-label setup, branding, and client-level onboarding.",
          icon: "bi bi-buildings",
          route: "/clients",
          color: "#3e60d5",
          subtle: "#ebf2ff",
          permissionKey: PermissionKeys.clientsView,
          allowedKey: AllowedKeys.clients,
        },
        {
          title: "Manage Staff",
          description: "Add, edit, and manage platform staff members.",
          icon: "bi bi-people",
          route: "/staff",
          color: "#ffc35a",
          subtle: "#fff8e6",
          permissionKey: PermissionKeys.staffView,
          allowedKey: AllowedKeys.staff,
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
          permissionKey: PermissionKeys.apiView,
          allowedKey: AllowedKeys.api,
        },
        {
          title: "Test Webhook",
          description: "Dispatch a sample completion event to the connected endpoint.",
          icon: "bi bi-broadcast",
          route: "/webhooks",
          color: "#a020f0",
          subtle: "#f4e1ff",
          permissionKey: PermissionKeys.webhooksView,
          allowedKey: AllowedKeys.webhooks,
        },
        {
          title: "Update iFrame Domains",
          description: "Whitelist a new parent domain before rollout.",
          icon: "bi bi-window-sidebar",
          route: "/iframe",
          color: "#47ad77",
          subtle: "#e6faf3",
          permissionKey: PermissionKeys.iframeView,
          allowedKey: AllowedKeys.iframe,
        },
        {
          title: "Manage Users",
          description: "Invite trainers, reviewers, and client admins.",
          icon: "bi bi-people",
          route: "/users",
          color: "#ffc35a",
          subtle: "#fff8e6",
          permissionKey: PermissionKeys.usersView,
          allowedKey: AllowedKeys.users,
        },
      ],
  };
};

const validateClient = (
  values: ClientFormValues,
  database: Database,
  currentId?: string,
) => {
  const errors: Record<string, string> = {};

  if (!values.name.trim()) errors.name = "Client name is required.";
  if (!values.industry.trim()) errors.industry = "Industry is required.";
  if (!values.csm.trim()) errors.csm = "Customer success manager is required.";
  if (!values.subdomain.trim()) {
    errors.subdomain = "Subdomain is required.";
  } else if (
    database.clients.some(
      (client) =>
        client.subdomain.toLowerCase() === values.subdomain.toLowerCase() &&
        client.id !== currentId,
    )
  ) {
    errors.subdomain = "Subdomain already exists.";
  }

  if (values.domain && !values.domain.includes(".")) {
    errors.domain = "Use a valid domain.";
  }

  return errors;
};

const validateUser = (values: UserFormValues, database: Database, currentId?: string) => {
  const errors: Record<string, string> = {};

  if (!values.name.trim()) errors.name = "Name is required.";
  if (!isValidEmail(values.email)) errors.email = "Use a valid email address.";
  if (!currentId && !values.password.trim()) {
    errors.password = "Password is required.";
  } else if (values.password.trim() && values.password.trim().length < 6) {
    errors.password = "Password must be at least 6 characters.";
  }

  if (
    database.users.some(
      (user) =>
        user.email.toLowerCase() === values.email.toLowerCase() && user.id !== currentId,
    )
  ) {
    errors.email = "Email already exists.";
  }

  if (!normalizePermissionList(values.permission).length) {
    errors.permission = "Select at least one permission.";
  }

  return errors;
};

const validateApiKey = (values: { name: string }) => {
  const errors: Record<string, string> = {};

  if (!values.name.trim()) {
    errors.name = "Key name is required.";
  }

  return errors;
};

const parseSegments = (url: string) => url.split("?")[0].split("/").filter(Boolean);

const createApiKey = (name: string) =>
  `sk_live_${name.toLowerCase().replace(/\s+/g, "_")}_${Math.random()
    .toString(36)
    .slice(2, 16)}`;

const isSuperAdminSession = () => getSession()?.role === "super_admin";

const updateClientSection = (
  client: ClientRecord,
  section: ClientSettingsSection,
  values: Record<string, unknown>,
) => {
  if (section === "domain") {
    client.domain = String(values.domain ?? client.domain);
    client.subdomain = String(values.subdomain ?? client.subdomain);
    client.domainStatus = values.domain ? "verified" : "not_configured";
    client.iframeEnabled = Boolean(values.iframeEnabled ?? client.iframeEnabled);
  }

  if (section === "whitelabel") {
    client.applicationName = String(values.applicationName ?? client.applicationName ?? client.name);
    client.primaryColor = String(values.primaryColor ?? client.primaryColor ?? "#1428a0");
    client.secondaryColor = String(values.secondaryColor ?? client.secondaryColor ?? "#3e60d5");
    client.logoUrl = String(values.logoUrl ?? client.logoUrl ?? "");
    client.darkLogoUrl = String(values.darkLogoUrl ?? client.darkLogoUrl ?? "");
    client.faviconUrl = String(values.faviconUrl ?? client.faviconUrl ?? "");
    client.supportEmail = String(values.supportEmail ?? client.supportEmail);
  }

  if (section === "integrations") {
    client.ssoType = String(values.ssoType ?? client.ssoType);
    client.ssoStatus = values.ssoType ? "connected" : "not_configured";
    client.webhookUrl = String(values.webhookUrl ?? client.webhookUrl);
    client.apiScope = String(values.apiScope ?? client.apiScope);
    client.allowedOrigins = ensureArray(values.allowedOrigins as string);
  }
};

const buildTenantSettingsPayload = (client: ClientRecord) => ({
  company: {
    name: client.name,
    industry: client.industry,
    supportEmail: client.supportEmail,
    companyPhone: client.companyPhone ?? "",
    companyAddress: client.companyAddress ?? "",
    status: client.status,
    csm: client.csm,
  },
  whitelabel: {
    applicationName: client.applicationName ?? client.name,
    primaryColor: client.primaryColor ?? "#1428a0",
    secondaryColor: client.secondaryColor ?? "#3e60d5",
    logoUrl: client.logoUrl ?? "",
    darkLogoUrl: client.darkLogoUrl ?? "",
    faviconUrl: client.faviconUrl ?? "",
  },
  integrations: {
    ssoType: client.ssoType,
    ssoStatus: client.ssoStatus,
    webhookUrl: client.webhookUrl,
    apiScope: client.apiScope,
    allowedOrigins: client.allowedOrigins,
    iframeEnabled: client.iframeEnabled,
    iframeBaseUrl: client.iframeBaseUrl ?? "",
    iframeAllowedParentDomains: client.iframeAllowedParentDomains ?? [],
    domain: client.domain,
    subdomain: client.subdomain,
  },
  smtp: {
    emailDeliveryEnabled: client.emailDeliveryEnabled ?? false,
    host: client.smtpHost ?? "",
    port: client.smtpPort ?? 587,
    username: client.smtpUsername ?? "",
    password: client.smtpPassword ?? "",
    fromName: client.smtpFromName ?? "",
    fromEmail: client.smtpFromEmail ?? "",
    secure: client.smtpSecure ?? false,
    testRecipient: client.smtpTestRecipient ?? "",
    lastTestAt: client.lastSmtpTestAt ?? "",
    lastTestStatus: client.lastSmtpTestStatus ?? "not_tested",
    lastTestMessage: client.lastSmtpTestMessage ?? "",
    trainingAssignmentSubject: client.smtpTrainingAssignmentSubject ?? "Training assigned: {trainingTitle}",
    trainingAssignmentTemplate:
      client.smtpTrainingAssignmentTemplate ??
      "<p>Hello {candidateName},</p><p>A training has been assigned to you.</p><p><strong>{trainingTitle}</strong></p><p>{trainingAudience}</p><p><a href=\"{trainingLink}\">Open training</a></p><p>{clientName}</p>",
  },
});

export const mockRequest = async (
  method: HttpMethod,
  url: string,
  payload?: Record<string, unknown>,
  params?: Params,
) => {
  const database = getDatabase();
  const segments = parseSegments(url);

  if (method === "GET" && url === "/profile") {
    const session = getSession();
    return session ? ok("Profile loaded.", session) : fail("Unauthorized.", {} as AdminUser);
  }

  if (method === "GET" && url === "/notifications") {
    const session = getSession();

    if (!session) {
      return fail("Unauthorized.", { unreadCount: 0, notifications: [] } as NotificationPayload);
    }

    const notifications = database.notifications
      .filter((item) => item.userId === session._id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Number(params?.limit ?? 10))
      .map((item) => ({
        ...item,
        isRead: Boolean(item.readAt),
      }));

    return ok("Notifications loaded.", {
      unreadCount: getUnreadNotificationCount(database, session._id),
      notifications,
    } satisfies NotificationPayload);
  }

  if (method === "POST" && url === "/notifications/read") {
    const session = getSession();

    if (!session) {
      return fail("Unauthorized.", { unreadCount: 0, notifications: [] } as NotificationPayload);
    }

    const ids = ensureArray(payload?.ids as string[]);
    database.notifications = database.notifications.map((item) =>
      item.userId === session._id && ids.includes(item.id)
        ? { ...item, readAt: item.readAt || new Date().toISOString(), isRead: true }
        : item,
    );
    syncMockUnreadFlags(database);
    setDatabase(database);
    refreshMockSession(database);

    const notifications = database.notifications
      .filter((item) => item.userId === session._id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Number(payload?.limit ?? 10));

    return ok("Notifications updated.", {
      unreadCount: getUnreadNotificationCount(database, session._id),
      notifications,
    } satisfies NotificationPayload);
  }

  if (method === "POST" && url === "/notifications/read-all") {
    const session = getSession();

    if (!session) {
      return fail("Unauthorized.", { unreadCount: 0, notifications: [] } as NotificationPayload);
    }

    database.notifications = database.notifications.map((item) =>
      item.userId === session._id
        ? { ...item, readAt: item.readAt || new Date().toISOString(), isRead: true }
        : item,
    );
    syncMockUnreadFlags(database);
    setDatabase(database);
    refreshMockSession(database);

    const notifications = database.notifications
      .filter((item) => item.userId === session._id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Number(payload?.limit ?? 10));

    return ok("All notifications marked as read.", {
      unreadCount: 0,
      notifications,
    } satisfies NotificationPayload);
  }

  if (method === "PUT" && url === "/profile") {
    const session = getSession();

    if (!session) {
      return fail("Unauthorized.", {} as AdminUser);
    }

    session.name = String(payload?.name ?? session.name);
    session.fullname = session.name;
    session.email = String(payload?.email ?? session.email);
    session.phone = String(payload?.phone ?? session.phone);
    session.title = String(payload?.title ?? session.title);
    session.department = String(payload?.department ?? session.department);
    session.image = String(payload?.image ?? session.image);
    setSession(session);
    return ok("Profile updated successfully.", session);
  }

  if (method === "GET" && url === "/settings") {
    return ok("Settings loaded.", buildClientAppSettings(getSessionClient(database)));
  }

  if (method === "GET" && url === "/tenant-settings") {
    const client = database.clients[0];
    return ok("Tenant settings loaded.", buildTenantSettingsPayload(client));
  }

  if (method === "GET" && url === "/tts/voices") {
    return ok("ElevenLabs voices loaded successfully.", {
      provider: DEFAULT_ELEVENLABS_PROVIDER,
      defaultVoiceId: mockTtsVoices[0].voiceId,
      defaultVoiceName: mockTtsVoices[0].name,
      voices: mockTtsVoices,
    });
  }

  if (method === "POST" && url === "/tts/verify") {
    const apiKey = String(payload?.apiKey ?? "").trim();

    if (!apiKey) {
      return fail("ElevenLabs API key is required.", {});
    }

    return ok("ElevenLabs API key verified successfully.", {
      provider: DEFAULT_ELEVENLABS_PROVIDER,
      defaultVoiceId: mockTtsVoices[0].voiceId,
      defaultVoiceName: mockTtsVoices[0].name,
      voices: mockTtsVoices,
    });
  }

  if (method === "POST" && url === "/narration") {
    const script = String(payload?.script ?? "").trim();
    const targetLanguage = String(payload?.targetLanguage ?? "").trim();
    const slideTitle = String(payload?.slideTitle ?? "").trim();
    const prompt = String(payload?.prompt ?? "").trim();

    if (script && targetLanguage) {
      return ok("Narration translated successfully.", {
        script: `${script}\n\n[${targetLanguage}]`,
        model: "mock-translate",
        usedOcr: false,
      });
    }

    return ok("Narration generated successfully.", {
      script: prompt || slideTitle || "Mock narration generated from slide content.",
      model: "mock-narration",
      usedOcr: false,
    });
  }

  if (method === "GET" && segments[0] === "launch" && segments[1] === "trainings" && segments[2]) {
    const preview = ["1", "true", "preview"].includes(String(params?.preview ?? "").toLowerCase());
    const training = getMockTrainingById(segments[2], { preview });

    if (!training) {
      return fail(preview ? "Preview training launch was not found." : "Approved training launch was not found.", {});
    }

    if (!preview && !isMockMultipleAttemptAllowed(training) && hasMockViewerCompletedTraining(training)) {
      return fail("You have already completed this training. Multiple attempts are not allowed for this session.", {});
    }

    return ok(
      `${preview ? "Preview" : "Approved"} training launch loaded successfully.`,
      buildMockLaunchPayload(training, preview),
    );
  }

  if (method === "POST" && segments[0] === "launch" && segments[1] === "trainings" && segments[2] && segments[3] === "session") {
    const preview = Boolean(payload?.preview);
    const training = getMockTrainingById(segments[2], { preview });
    const client = getSessionClient(database);

    if (!training) {
      return fail("Training launch was not found.", {});
    }

    if (!preview && !isMockMultipleAttemptAllowed(training) && hasMockViewerCompletedTraining(training)) {
      return fail("You have already completed this training. Multiple attempts are not allowed for this session.", {});
    }

    const action = String(payload?.action ?? "progress").trim().toLowerCase();
    const totalSlides = Math.max(1, Number(payload?.totalSlides ?? training.slides.length ?? 1));
    const slidesViewed = Math.min(Math.max(Number(payload?.slidesViewed ?? 0), 0), totalSlides);
    const correctAnswers = Number(payload?.correctAnswers ?? 0);
    const totalQuestions = Number(payload?.totalQuestions ?? 0);
    const explicitScore = payload?.score;
    const score =
      explicitScore === null || explicitScore === undefined || explicitScore === ""
        ? totalQuestions > 0
          ? Math.round((correctAnswers / Math.max(totalQuestions, 1)) * 100)
          : null
        : Number(explicitScore);
    const proctoringReport =
      payload?.proctoringReport &&
        typeof payload.proctoringReport === "object"
        ? (payload.proctoringReport as TrainingProctoringReport)
        : null;
    const sessionId = String(payload?.sessionId ?? "").trim() || `launch-session-${Date.now()}`;
    const viewedSlideIds = Array.from(
      new Set(
        (Array.isArray(payload?.viewedSlideIds) ? payload.viewedSlideIds : [])
          .map((item) => String(item || "").trim())
          .filter(Boolean),
      ),
    );
    const askHistory = Array.isArray(payload?.askHistory)
      ? payload.askHistory
        .map((entry) => ({
          question: String((entry as { question?: string })?.question || "").trim(),
          answer: String((entry as { answer?: string })?.answer || "").trim(),
          askedAt:
            String((entry as { askedAt?: string })?.askedAt || "").trim() ||
            new Date().toISOString(),
        }))
        .filter((entry) => entry.question && entry.answer)
      : [];
    const existingSessions = Array.isArray(training.sessions) ? [...training.sessions] : [];
    const existingSessionIndex = existingSessions.findIndex((session) => session.id === sessionId);
    const existingSession = existingSessionIndex >= 0 ? existingSessions[existingSessionIndex] : null;
    const isNewCompletedSession =
      !preview && action === "complete" && existingSession?.status !== "completed";

    if (client && isNewCompletedSession) {
      const usageError = getUsageLimitError(client, "sessions", Number(client.sessions ?? 0) + 1);

      if (usageError) {
        return fail(usageError, {});
      }

      const creditError = tryConsumeClientCredits(client, CREDIT_COSTS.session);

      if (creditError) {
        return fail(creditError, {});
      }
    }

    const nextSession = {
      id: sessionId,
      ssoId: existingSession?.ssoId || `${preview ? "Preview" : "Launch"}:${sessionId.slice(-8)}`,
      learnerName: existingSession?.learnerName || getMockViewerName(),
      learnerEmail: existingSession?.learnerEmail || "",
      status: action === "complete" ? "completed" : "in-progress",
      timeSpent: formatMockTimeSpent(Number(payload?.timeSpentSeconds ?? 0)),
      slidesViewed,
      totalSlides,
      viewedSlideIds,
      score,
      startedAt:
        existingSession?.startedAt ||
        String(payload?.startedAt ?? "").trim() ||
        new Date().toISOString(),
      completedAt: action === "complete" ? new Date().toISOString() : existingSession?.completedAt ?? null,
      correctAnswers,
      totalQuestions,
      progressPercent: Math.round((slidesViewed / totalSlides) * 100),
      mode: preview ? "preview" : "public",
      askHistory: askHistory.length
        ? askHistory
        : Array.isArray(existingSession?.askHistory)
          ? existingSession.askHistory
          : [],
      proctoringReport: proctoringReport ?? existingSession?.proctoringReport ?? null,
    } satisfies TrainingWorkspaceRecord["sessions"][number];

    if (existingSessionIndex === -1) {
      existingSessions.unshift(nextSession);
    } else {
      existingSessions[existingSessionIndex] = nextSession;
    }

    upsertMockTraining({
      ...training,
      sessions: existingSessions,
      lastActivity: "Today",
    });
    if (client && isNewCompletedSession) {
      client.sessions = Number(client.sessions ?? 0) + 1;
      pushMockNotifications(
        database,
        database.users
          .filter((user) => user.clientId === client.id && (user.role === "admin" || (user.role === "trainer" && user.name === training.trainer)))
          .map((user) => user.id),
        {
          title: "Training completed",
          message: `${nextSession.learnerName || "A learner"} completed ${training.title}.`,
          category: "training",
          severity: "success",
          link: "/dashboard",
        },
        client.id,
      );
      setDatabase(database);
      refreshMockSession(database);
    }

    return ok("Training session updated successfully.", {
      sessionId,
      session: nextSession,
    });
  }

  if (method === "POST" && segments[0] === "launch" && segments[1] === "trainings" && segments[2] && segments[3] === "ask") {
    const preview = Boolean(payload?.preview);
    const training = getMockTrainingById(segments[2], { preview });

    if (!training) {
      return fail("Training launch was not found.", {});
    }

    if (!preview && !isMockMultipleAttemptAllowed(training) && hasMockViewerCompletedTraining(training)) {
      return fail("You have already completed this training. Multiple attempts are not allowed for this session.", {});
    }

    const message = String(payload?.message ?? "").trim();

    if (!message) {
      return fail("Question is required.", {});
    }

    const reply = buildMockAskReply(training, message);
    const sessionId = String(payload?.sessionId ?? "").trim();

    if (sessionId) {
      const sessions = Array.isArray(training.sessions) ? [...training.sessions] : [];
      const sessionIndex = sessions.findIndex((session) => session.id === sessionId);

      if (sessionIndex >= 0) {
        sessions[sessionIndex] = {
          ...sessions[sessionIndex],
          askHistory: [
            ...(Array.isArray(sessions[sessionIndex].askHistory) ? sessions[sessionIndex].askHistory : []),
            {
              question: message,
              answer: reply,
              askedAt: new Date().toISOString(),
            },
          ],
        };

        upsertMockTraining({
          ...training,
          sessions,
          lastActivity: "Today",
        });
      }
    }

    return ok("Launch question answered successfully.", {
      reply,
      model: mockAskModelName,
    });
  }

  if (method === "PUT" && segments[0] === "tenant-settings" && segments.length === 2) {
    const section = String(segments[1] || "").trim().toLowerCase();
    const client = database.clients[0];

    if (client && section === "smtp") {
      client.emailDeliveryEnabled = Boolean(payload?.emailDeliveryEnabled);
      client.smtpHost = String(payload?.host ?? "");
      client.smtpPort = Number(payload?.port ?? 587);
      client.smtpUsername = String(payload?.username ?? "");
      client.smtpPassword = String(payload?.password ?? "");
      client.smtpFromName = String(payload?.fromName ?? "");
      client.smtpFromEmail = String(payload?.fromEmail ?? "");
      client.smtpSecure = Boolean(payload?.secure);
      client.smtpTestRecipient = String(payload?.testRecipient ?? "");
      client.smtpTrainingAssignmentSubject = String(payload?.trainingAssignmentSubject ?? "");
      client.smtpTrainingAssignmentTemplate = String(payload?.trainingAssignmentTemplate ?? "");
      setDatabase(database);
    }

    return ok("Settings updated successfully.", buildTenantSettingsPayload(database.clients[0]));
  }

  if (method === "POST" && url === "/auth/login") {
    const email = String(payload?.email ?? "").trim().toLowerCase();
    const password = String(payload?.password ?? "").trim();
    const localCredentialMap: Record<string, string> = {
      "superadmin@samsung.com": "superadmin123",
      "admin@samsung.com": "admin123",
      "trainer@samsung.com": "trainer123",
      "reviewer@samsung.com": "reviewer123",
      "trainee@samsung.com": "trainee123",
    };
    const user = database.users.find((item) => item.email.toLowerCase() === email);

    if (user && localCredentialMap[email] === password) {
      const profile = toAdminProfile(user, database);
      setSession(profile);
      return ok<AuthLoginResponse>("Login successful.", {
        token: `mock-${user.role}-token`,
        user: profile,
      });
    }

    return fail("Invalid email or password.", {
      email: "",
      password:
        "Use a valid workspace email and password.",
    });
  }

  if (method === "POST" && url === "/auth/google") {
    const trainingId = String(payload?.trainingId ?? "").trim().toLowerCase();
    const relatedTraining = getMockTrainingById(trainingId, { preview: true });
    const email = "trainee@samsung.com";
    const user = database.users.find((item) => item.email.toLowerCase() === email);

    if (!relatedTraining || !user) {
      return fail("Google sign-in is unavailable for this training.", {});
    }

    const profile = toAdminProfile(user, database);
    return ok<AuthLoginResponse>("Google sign-in successful.", {
      token: "mock-google-trainee-token",
      user: profile,
    });
  }

  if (method === "POST" && url === "/auth/logout") {
    setSession(null);
    return ok("Logged out successfully.", true);
  }

  if (method === "GET" && url === "/dashboard") {
    return ok("Dashboard loaded.", buildDashboard(database, getSession()));
  }

  if (method === "GET" && url === "/billing/summary") {
    const client = getSessionClient(database);

    if (!client) {
      return fail("Billing summary is available only for tenant admins.", {});
    }

    const billingDates = getMockBillingDates();
    return ok("Billing summary loaded.", {
      currentPlan: client.plan,
      billingCycle: client.billingCycle || "monthly",
      planStatus: getMockPlanStatus(client),
      startedOn: billingDates.startedOn,
      expiresOn: billingDates.expiresOn,
      planUsage: getMockPlanUsage(client),
      activeUsers: Number(client.activeUsers ?? 0),
      trainings: Number(client.trainings ?? 0),
      sessions: Number(client.sessions ?? 0),
      usedCredits: client.usedCredits ?? 0,
      totalCredits: client.totalCredits ?? 0,
      availableCredits: getAvailableCredits(client),
      monthlyCredits: client.monthlyCredits ?? 0,
      purchasedCredits: client.purchasedCredits ?? 0,
      costPerTraining: CREDIT_COSTS.training,
      costPerUser: CREDIT_COSTS.user,
      costPerSession: CREDIT_COSTS.session,
      planLimits: client.planLimits ?? getPlanConfig(client.plan).limits,
      planCatalog: Object.values(PLAN_CONFIG),
      recentTransactions: [],
    });
  }

  if (method === "POST" && url === "/billing/purchase") {
    const client = getSessionClient(database);
    const session = getSession();

    if (!client || !session) {
      return fail("Billing summary is available only for tenant admins.", {});
    }

    const planCode = String(payload?.planCode ?? "").trim().toUpperCase();
    const credits = Math.max(0, Number(payload?.credits ?? 0));

    if (planCode) {
      client.plan = planCode as ClientRecord["plan"];
      const planConfig = getPlanConfig(client.plan);
      client.monthlyCredits = planConfig.monthlyCredits;
      client.totalCredits = Number(client.monthlyCredits ?? 0) + Number(client.purchasedCredits ?? 0);
      hydrateClientCredits(client);
      pushMockNotifications(
        database,
        database.users
          .filter((user) => user.clientId === client.id && ["admin", "trainer", "reviewer"].includes(user.role))
          .map((user) => user.id),
        {
          title: "Plan updated",
          message: `${client.plan} plan checkout completed successfully for your company.`,
          category: "billing",
          severity: "success",
          link: "/upgrade-billings",
          actorName: session.fullname || session.name,
        },
        client.id,
      );
      setDatabase(database);
      refreshMockSession(database);

      const billingDates = getMockBillingDates();
      return ok("Razorpay sandbox checkout completed successfully.", {
        currentPlan: client.plan,
        billingCycle: client.billingCycle || "monthly",
        planStatus: getMockPlanStatus(client),
        startedOn: billingDates.startedOn,
        expiresOn: billingDates.expiresOn,
        planUsage: getMockPlanUsage(client),
        activeUsers: Number(client.activeUsers ?? 0),
        trainings: Number(client.trainings ?? 0),
        sessions: Number(client.sessions ?? 0),
        usedCredits: client.usedCredits ?? 0,
        totalCredits: client.totalCredits ?? 0,
        availableCredits: getAvailableCredits(client),
        monthlyCredits: client.monthlyCredits ?? 0,
        purchasedCredits: client.purchasedCredits ?? 0,
        costPerTraining: CREDIT_COSTS.training,
        costPerUser: CREDIT_COSTS.user,
        costPerSession: CREDIT_COSTS.session,
        planLimits: client.planLimits ?? getPlanConfig(client.plan).limits,
        planCatalog: Object.values(PLAN_CONFIG),
        recentTransactions: [],
      });
    }

    if (!credits) {
      return fail("Select a valid credit pack.", {});
    }

    client.purchasedCredits = Number(client.purchasedCredits ?? 0) + credits;
    client.totalCredits = Number(client.totalCredits ?? 0) + credits;
    hydrateClientCredits(client);
    pushMockNotifications(database, [session._id], {
      title: "Credits purchased",
      message: `${credits.toLocaleString()} credits were added through sandbox checkout.`,
      category: "billing",
      severity: "success",
      link: "/upgrade-billings",
      actorName: session.fullname || session.name,
    }, client.id);
    setDatabase(database);
    refreshMockSession(database);

    const billingDates = getMockBillingDates();
    return ok("Test credit purchase completed successfully.", {
      currentPlan: client.plan,
      billingCycle: client.billingCycle || "monthly",
      planStatus: getMockPlanStatus(client),
      startedOn: billingDates.startedOn,
      expiresOn: billingDates.expiresOn,
      planUsage: getMockPlanUsage(client),
      activeUsers: Number(client.activeUsers ?? 0),
      trainings: Number(client.trainings ?? 0),
      sessions: Number(client.sessions ?? 0),
      usedCredits: client.usedCredits ?? 0,
      totalCredits: client.totalCredits ?? 0,
      availableCredits: getAvailableCredits(client),
      monthlyCredits: client.monthlyCredits ?? 0,
      purchasedCredits: client.purchasedCredits ?? 0,
      costPerTraining: CREDIT_COSTS.training,
      costPerUser: CREDIT_COSTS.user,
      costPerSession: CREDIT_COSTS.session,
      planLimits: client.planLimits ?? getPlanConfig(client.plan).limits,
      planCatalog: Object.values(PLAN_CONFIG),
      recentTransactions: [],
    });
  }

  if (method === "POST" && url === "/billing/enterprise-request") {
    const client = getSessionClient(database);
    const session = getSession();
    const message = String(payload?.message ?? "").trim();

    if (!client || !session) {
      return fail("Billing summary is available only for tenant admins.", {});
    }

    if (!message) {
      return fail("Please add your support request details.", {
        message: "Support query is required.",
      });
    }

    client.enterpriseRequests = [
      {
        id: `enterprise-request-${Date.now()}`,
        requestedAt: new Date().toISOString(),
        requestedByName: session.fullname || session.name,
        requestedByEmail: session.email,
        message,
        status: "pending",
      },
      ...(client.enterpriseRequests ?? []),
    ].slice(0, 10);

    pushMockNotifications(database, [session._id], {
      title: "Enterprise request submitted",
      message: "Your custom pricing query has been shared with the platform team.",
      category: "billing",
      severity: "info",
      link: "/upgrade-billings",
      actorName: session.fullname || session.name,
    }, client.id);
    pushMockNotifications(
      database,
      database.users.filter((user) => user.role === "super_admin").map((user) => user.id),
      {
        title: "Enterprise upgrade request",
        message: `${client.name} requested enterprise pricing support.`,
        category: "billing",
        severity: "warning",
        link: `/clients/${client.id}`,
        actorName: session.fullname || session.name,
      },
    );
    setDatabase(database);
    refreshMockSession(database);

    const billingDates = getMockBillingDates();
    return ok("Enterprise support query submitted successfully.", {
      currentPlan: client.plan,
      billingCycle: client.billingCycle || "monthly",
      planStatus: getMockPlanStatus(client),
      startedOn: billingDates.startedOn,
      expiresOn: billingDates.expiresOn,
      planUsage: getMockPlanUsage(client),
      activeUsers: Number(client.activeUsers ?? 0),
      trainings: Number(client.trainings ?? 0),
      sessions: Number(client.sessions ?? 0),
      usedCredits: client.usedCredits ?? 0,
      totalCredits: client.totalCredits ?? 0,
      availableCredits: getAvailableCredits(client),
      monthlyCredits: client.monthlyCredits ?? 0,
      purchasedCredits: client.purchasedCredits ?? 0,
      costPerTraining: CREDIT_COSTS.training,
      costPerUser: CREDIT_COSTS.user,
      costPerSession: CREDIT_COSTS.session,
      planLimits: client.planLimits ?? getPlanConfig(client.plan).limits,
      planCatalog: Object.values(PLAN_CONFIG),
      recentTransactions: [],
    });
  }

  if (method === "GET" && url === "/clients") {
    const query = String(params?.query ?? "").trim();
    const filtered = database.clients.filter((client) =>
      [client.name, client.industry, client.csm, client.subdomain, client.domain]
        .filter(Boolean)
        .some((value) => contains(value, query)),
    );

    return ok("Clients loaded.", paginate(filtered, params));
  }

  if (method === "GET" && segments[0] === "clients" && segments.length === 2) {
    const client = database.clients.find((item) => item.id === segments[1]);
    return client
      ? ok("Client loaded.", client)
      : fail("Client not found.", {} as ClientRecord);
  }

  if (method === "POST" && url === "/clients") {
    const values = payload as unknown as ClientFormValues;
    const errors = validateClient(values, database);

    if (Object.keys(errors).length > 0) {
      return fail("Please correct the highlighted fields.", errors);
    }

    const newClient: ClientRecord = {
      id: `client-${Date.now()}`,
      name: values.name.trim(),
      industry: values.industry.trim(),
      plan: normalizePlanCode(values.plan),
      status: values.status,
      csm: values.csm.trim(),
      activeUsers: Number(values.activeUsers),
      trainings: Number(values.trainings),
      sessions: Number(values.sessions),
      subdomain: values.subdomain.trim(),
      domain: values.domain.trim(),
      domainStatus: values.domain ? "verified" : "not_configured",
      joined: "Apr 2026",
      logo: values.name
        .split(" ")
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase(),
      logoColor: "#3e60d5",
      logoBg: "#ebf2ff",
      iframeEnabled: true,
      ssoType: "Trainup IAM",
      ssoStatus: "connected",
      supportEmail: "training@samsung.com",
      allowedOrigins: [],
      webhookUrl: "",
      apiScope: "Session sync",
    };

    hydrateClientCredits(newClient);

    database.clients.unshift(newClient);
    pushMockNotifications(
      database,
      database.users.filter((user) => user.role === "super_admin").map((user) => user.id),
      {
        title: "New client created",
        message: `${newClient.name} was onboarded on the ${newClient.plan} plan.`,
        category: "clients",
        severity: "info",
        link: `/clients/${newClient.id}`,
        actorName: getSession()?.fullname || getSession()?.name || "",
      },
    );
    setDatabase(database);
    return ok("Client created successfully.", newClient);
  }

  if (method === "PUT" && segments[0] === "clients" && segments.length === 2) {
    const client = database.clients.find((item) => item.id === segments[1]);
    const values = payload as unknown as ClientFormValues;

    if (!client) {
      return fail("Client not found.", {} as ClientRecord);
    }

    const errors = validateClient(values, database, client.id);

    if (Object.keys(errors).length > 0) {
      return fail("Please correct the highlighted fields.", errors);
    }

    client.name = values.name.trim();
    client.industry = values.industry.trim();
    client.plan = normalizePlanCode(values.plan);
    client.status = values.status;
    client.csm = values.csm.trim();
    client.activeUsers = Number(values.activeUsers);
    client.trainings = Number(values.trainings);
    client.sessions = Number(values.sessions);
    client.subdomain = values.subdomain.trim();
    client.domain = values.domain.trim();
    client.domainStatus = values.domain ? "verified" : "not_configured";
    client.logo = values.name
      .split(" ")
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
    hydrateClientCredits(client);
    setDatabase(database);

    return ok("Client updated successfully.", client);
  }

  if (method === "PUT" && segments[0] === "clients" && segments[2] === "settings") {
    const client = database.clients.find((item) => item.id === segments[1]);

    if (!client) {
      return fail("Client not found.", {} as ClientRecord);
    }

    const section = String(payload?.section ?? "") as ClientSettingsSection;
    const values = (payload?.values ?? {}) as Record<string, unknown>;

    if (section === "whitelabel" && values.supportEmail && !isValidEmail(String(values.supportEmail ?? ""))) {
      return fail("Please correct the highlighted fields.", {
        supportEmail: "Use a valid support email.",
      });
    }

    if (section === "integrations") {
      const webhookUrl = String(values.webhookUrl ?? "");
      if (webhookUrl && !isValidUrl(webhookUrl)) {
        return fail("Please correct the highlighted fields.", {
          webhookUrl: "Use a valid webhook URL.",
        });
      }
    }

    updateClientSection(client, section, values);
    if (section === "billing") {
      client.plan = normalizePlanCode(String(values.plan ?? client.plan));
      const planConfig = getPlanConfig(client.plan);
      client.monthlyCredits = planConfig.monthlyCredits;
      if (Number(values.extraCredits ?? 0) > 0) {
        client.purchasedCredits = Number(client.purchasedCredits ?? 0) + Number(values.extraCredits ?? 0);
      }
      client.totalCredits = Number(client.monthlyCredits ?? 0) + Number(client.purchasedCredits ?? 0);
      hydrateClientCredits(client);
    }
    setDatabase(database);
    refreshMockSession(database);
    return ok("Client settings updated successfully.", client);
  }

  if (method === "DELETE" && segments[0] === "clients" && segments.length === 2) {
    database.clients = database.clients.filter((item) => item.id !== segments[1]);
    setDatabase(database);
    return ok("Client deleted successfully.", true);
  }

  if (method === "GET" && url === "/users") {
    const query = String(params?.query ?? "").trim();
    const filtered = database.users.filter((user) =>
      user.role !== "super_admin" &&
      user.role !== "trainee" &&
      [user.name, user.email, user.role, user.status].some((value) => contains(value, query)),
    ).map((user) => {
      const access = resolveMockUserAccess(user, database);
      return {
        ...user,
        roleName: access.roleName,
        permission: access.permission,
        allowed: access.allowed,
        permissionSource: user.useRoleDefaults === false ? "custom" : "role",
      };
    });

    return ok("Users loaded.", paginate(filtered, params));
  }

  if (method === "GET" && url === "/trainees") {
    const query = String(params?.query ?? "").trim();
    const client = getSessionClient(database);
    const filtered = getClientScopedUsers(database, client?.id)
      .filter((user) => user.role === "trainee")
      .filter((user) => [user.name, user.email, user.status].some((value) => contains(value, query)))
      .map((user) => ({
        ...user,
        trainings: getMockAssignedTrainingCount(user),
        roleName: "Trainee",
        permission: [],
        allowed: [],
      }));

    return ok("Trainees loaded.", paginate(filtered, params));
  }

  if (method === "GET" && url === "/training-workspace/trainees") {
    const query = String(params?.query ?? "").trim();
    const client = getSessionClient(database);
    const filtered = getClientScopedUsers(database, client?.id)
      .filter((user) => user.role === "trainee" && user.status === "active")
      .filter((user) => [user.name, user.email, user.status].some((value) => contains(value, query)))
      .map((user) => ({
        ...user,
        roleName: "Trainee",
        permission: [],
        allowed: [],
      }));

    return ok("Trainees loaded.", paginate(filtered, params));
  }

  if (method === "GET" && segments[0] === "trainees" && segments[2] === "sessions") {
    const client = getSessionClient(database);
    const trainee = getClientScopedUsers(database, client?.id).find((user) => user.id === segments[1] && user.role === "trainee");

    if (!trainee) {
      return fail("Trainee not found.", {});
    }

    const sessions = getMockTrainingWorkspace()
      .flatMap((training) =>
        (Array.isArray(training.sessions) ? training.sessions : [])
          .filter((session) => {
            return isMockSessionForTrainee(session, trainee);
          })
          .map((session) => ({
            ...session,
            trainingId: training.id,
            trainingTitle: training.title,
            trainingType: training.type,
            trainingAudience: training.audience,
          })),
      )
      .sort((left, right) => new Date(String(right.startedAt || right.completedAt || 0)).getTime() - new Date(String(left.startedAt || left.completedAt || 0)).getTime());

    const scoreRecords = sessions.filter((session) => typeof session.score === "number");

    return ok("Trainee sessions loaded.", {
      trainee: {
        ...trainee,
        roleName: "Trainee",
        permission: [],
        allowed: [],
      },
      sessions,
      summary: {
        totalSessions: sessions.length,
        completedSessions: sessions.filter((session) => String(session.status).toLowerCase() === "completed").length,
        inProgressSessions: sessions.filter((session) => String(session.status).toLowerCase() === "in-progress").length,
        notStartedSessions: sessions.filter((session) => String(session.status).toLowerCase() === "not-started").length,
        averageScore: scoreRecords.length
          ? Math.round(scoreRecords.reduce((sum, session) => sum + Number(session.score || 0), 0) / scoreRecords.length)
          : null,
      },
    });
  }

  if (method === "POST" && segments[0] === "training-workspace" && segments[2] === "assign") {
    const training = getMockTrainingWorkspace().find((item) => item.id === segments[1]);

    if (!training) {
      return fail("Training not found.", {});
    }

    const traineeIds = Array.isArray(payload?.traineeIds) ? payload.traineeIds.map((item) => String(item).trim()).filter(Boolean) : [];

    if (!traineeIds.length) {
      return fail("Select at least one trainee.", {});
    }

    const client = getSessionClient(database);
    const trainees = getClientScopedUsers(database, client?.id).filter((user) => traineeIds.includes(user.id) && user.role === "trainee" && user.status === "active");
    const existingSessionKeys = new Set((training.sessions ?? []).map((session) => `${session.learnerEmail || session.ssoId}`.toLowerCase()));
    const newSessions: TrainingSessionRecord[] = trainees
      .filter((trainee) => !existingSessionKeys.has(trainee.email.toLowerCase()))
      .map((trainee) => ({
        id: `assigned-${training.id}-${trainee.id}`,
        ssoId: trainee.email,
        learnerName: trainee.name,
        learnerEmail: trainee.email,
        status: "not-started",
        timeSpent: "0m 00s",
        slidesViewed: 0,
        totalSlides: training.slides.length,
        viewedSlideIds: [],
        score: null,
        startedAt: null,
        completedAt: null,
        correctAnswers: 0,
        totalQuestions: training.questionCheckpoints?.length ?? 0,
        progressPercent: 0,
        mode: "public",
        askHistory: [],
        proctoringReport: null,
      }));

    if (!newSessions.length) {
      return fail("Selected trainees are already assigned.", {});
    }

    const nextTrainings = getMockTrainingWorkspace().map((item) =>
      item.id === training.id
        ? {
          ...item,
          sessions: [...(item.sessions ?? []), ...newSessions],
          lastActivity: "Today",
        }
        : item,
    );
    setMockTrainingWorkspace(nextTrainings);
    return ok("Training assigned successfully.", {
      training: nextTrainings.find((item) => item.id === training.id),
      emailResult: {
        success: true,
        message: `Training assigned to ${newSessions.length} trainee${newSessions.length === 1 ? "" : "s"}.`,
      },
    });
  }

  if (method === "GET" && url === "/super-admins") {
    if (!isSuperAdminSession()) {
      return fail("Only a super admin can access this page.", paginate([], params));
    }

    const query = String(params?.query ?? "").trim();
    const filtered = database.users
      .filter((user) => user.role === "super_admin")
      .filter((user) => [user.name, user.email, user.phone ?? "", user.status].some((value) => contains(value, query)))
      .map(
        (user): SuperAdminRecord => ({
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone ?? "",
          status: user.status,
          image: user.image ?? AvatarImage,
          createdAt: user.lastActive || new Date().toISOString(),
        }),
      );

    return ok("Super admins loaded.", paginate(filtered, params));
  }

  if (method === "GET" && url === "/roles") {
    return ok<RolePermissionsPayload>("Roles loaded.", {
      roles: getMockRoleDefinitions(database).filter((role) => role.id !== "trainee"),
      modules: permissionModules,
    });
  }

  if (method === "PUT" && segments[0] === "roles" && segments.length === 2) {
    const targetRole = database.rolePermissions.find((item) => item.id === segments[1]);

    if (!targetRole) {
      return fail("Role not found.", {} as RolePermissionsPayload);
    }

    const hasPermissionPayload = Array.isArray(payload?.permission);
    const hasMetadataPayload =
      Object.prototype.hasOwnProperty.call(payload || {}, "name") ||
      Object.prototype.hasOwnProperty.call(payload || {}, "description") ||
      Object.prototype.hasOwnProperty.call(payload || {}, "status");

    if (!hasPermissionPayload && !hasMetadataPayload) {
      return fail("No role changes were provided.", {} as RolePermissionsPayload);
    }

    const nextName = String(payload?.name ?? targetRole.name ?? targetRole.roleName ?? "").trim();
    const nextDescription = String(payload?.description ?? targetRole.description ?? "").trim();
    const nextStatus = String(payload?.status ?? targetRole.status ?? "active").trim().toLowerCase() === "inactive" ? "inactive" : "active";

    if (hasMetadataPayload && !nextName) {
      return fail("Role name is required.", {
        name: "Enter a role name.",
      });
    }

    if (hasMetadataPayload && !nextDescription) {
      return fail("Description is required.", {
        description: "Enter a short role description.",
      });
    }

    const permission = hasPermissionPayload
      ? normalizePermissionList(ensureArray(payload?.permission as string[]))
      : targetRole.permission;

    if (hasPermissionPayload && !permission.length) {
      return fail("Select at least one permission.", {
        permission: "Choose at least one permission for this role.",
      });
    }

    targetRole.name = nextName;
    targetRole.roleName = nextName;
    targetRole.description = nextDescription;
    targetRole.status = nextStatus;
    targetRole.permission = permission;
    targetRole.allowed = buildAllowedFromPermissions(permission);
    setDatabase(migrateDatabase(database));

    const successMessage = hasMetadataPayload && !hasPermissionPayload
      ? "Role details updated successfully."
      : hasMetadataPayload
        ? "Role updated successfully."
        : "Role permissions updated successfully.";

    return ok<RolePermissionsPayload>(successMessage, {
      roles: getMockRoleDefinitions(database),
      modules: permissionModules,
    });
  }

  if (method === "POST" && url === "/users") {
    const values = payload as unknown as UserFormValues;
    const client = getSessionClient(database);

    if (values.role === "super_admin" && !isSuperAdminSession()) {
      return fail("Only a super admin can create another super admin.", {
        role: "Super admin access can only be assigned by a super admin.",
      });
    }

    const errors = validateUser(values, database);

    if (Object.keys(errors).length > 0) {
      return fail("Please correct the highlighted fields.", errors);
    }

    if (client) {
      const usageError = getUsageLimitError(
        client,
        "users",
        database.users.filter(
          (user) =>
            user.role !== "super_admin" &&
            user.clientId === client.id &&
            user.status === "active",
        ).length + (values.status === "inactive" ? 0 : 1),
      );

      if (usageError) {
        return fail(usageError, {});
      }

      const creditError = tryConsumeClientCredits(client, CREDIT_COSTS.user);

      if (creditError) {
        return fail(creditError, {});
      }
    }

    const record: MockUserRecord = {
      id: `user-${Date.now()}`,
      name: values.name.trim(),
      email: values.email.trim(),
      role: values.role,
      roleName: values.role === "super_admin" ? "Super Admin" : getMockRoleDefinition(values.role, database)?.roleName ?? values.role,
      status: values.status,
      trainings: 0,
      lastActive: "Just now",
      clientId: client?.id ?? "",
      permission: normalizePermissionList(values.permission),
      allowed: buildAllowedFromPermissions(values.permission),
      permissionSource: "role",
    };

    if (values.role !== "super_admin") {
      const roleDefaults = getMockRoleDefinition(values.role, database);
      const normalizedPermission = normalizePermissionList(values.permission);
      record.permission = normalizedPermission.length ? normalizedPermission : roleDefaults?.permission ?? [];
      record.allowed = buildAllowedFromPermissions(record.permission);
      record.permissionSource = isSamePermissionSet(record.permission, roleDefaults?.permission ?? []) ? "role" : "custom";
    }

    database.users.unshift({
      ...record,
      roleName: record.roleName,
      useRoleDefaults: record.permissionSource !== "custom",
    });
    pushMockNotifications(database, [record.id], {
      title: "Welcome to your workspace",
      message: `${record.roleName} access has been assigned to your account.`,
      category: "users",
      severity: "success",
      link: "/dashboard",
      actorName: getSession()?.fullname || getSession()?.name || "",
    }, record.clientId);
    if (client && values.status !== "inactive") {
      client.activeUsers = Number(client.activeUsers ?? 0) + 1;
    }
    setDatabase(database);
    refreshMockSession(database);
    return ok("User invited successfully.", record);
  }

  if (method === "POST" && url === "/trainees") {
    const values = payload as {
      name: string;
      email: string;
      status: "active" | "inactive";
      password: string;
    };
    const client = getSessionClient(database);
    const errors: Record<string, string> = {};

    if (!values.name.trim()) {
      errors.name = "Name is required.";
    }

    if (!isValidEmail(values.email)) {
      errors.email = "Use a valid email address.";
    } else if (database.users.some((user) => user.email.toLowerCase() === values.email.trim().toLowerCase())) {
      errors.email = "Email already exists.";
    }

    if (!values.password.trim()) {
      errors.password = "Password is required.";
    } else if (values.password.trim().length < 6) {
      errors.password = "Password must be at least 6 characters.";
    }

    if (Object.keys(errors).length > 0) {
      return fail("Please correct the highlighted fields.", errors);
    }

    if (client) {
      const usageError = getUsageLimitError(
        client,
        "users",
        getClientScopedUsers(database, client.id).filter((user) => user.status === "active").length + (values.status === "inactive" ? 0 : 1),
      );

      if (usageError) {
        return fail(usageError, {});
      }

      const creditError = tryConsumeClientCredits(client, CREDIT_COSTS.user);

      if (creditError) {
        return fail(creditError, {});
      }
    }

    const record: MockUserRecord = {
      id: `user-${Date.now()}`,
      name: values.name.trim(),
      email: values.email.trim().toLowerCase(),
      role: "trainee",
      roleName: "Trainee",
      status: values.status,
      trainings: 0,
      lastActive: "Just now",
      clientId: client?.id ?? "",
      permission: [],
      allowed: [],
      permissionSource: "role",
      useRoleDefaults: false,
    };

    database.users.unshift(record);
    if (client && values.status !== "inactive") {
      client.activeUsers = Number(client.activeUsers ?? 0) + 1;
    }
    setDatabase(database);
    refreshMockSession(database);
    return ok("Trainee added successfully.", record);
  }

  if (method === "POST" && url === "/trainees/import") {
    const rows = Array.isArray(payload?.rows)
      ? (payload.rows as Array<{ name: string; email: string; status: "active" | "inactive"; password: string }>)
      : [];
    const client = getSessionClient(database);

    if (!rows.length) {
      return fail("Upload at least one valid CSV row.", paginate([], params));
    }

    const created: MockUserRecord[] = [];

    for (const row of rows) {
      if (!row.name?.trim() || !isValidEmail(row.email) || !row.password?.trim() || row.password.trim().length < 6) {
        continue;
      }

      if (database.users.some((user) => user.email.toLowerCase() === row.email.trim().toLowerCase())) {
        continue;
      }

      created.push({
        id: `user-${Date.now()}-${created.length}`,
        name: row.name.trim(),
        email: row.email.trim().toLowerCase(),
        role: "trainee",
        roleName: "Trainee",
        status: row.status === "inactive" ? "inactive" : "active",
        trainings: 0,
        lastActive: "Just now",
        clientId: client?.id ?? "",
        permission: [],
        allowed: [],
        permissionSource: "role",
        useRoleDefaults: false,
      });
    }

    if (!created.length) {
      return fail("No valid trainee rows were found in the CSV.", paginate([], params));
    }

    database.users.unshift(...created);
    if (client) {
      client.activeUsers = Number(client.activeUsers ?? 0) + created.filter((user) => user.status === "active").length;
    }
    setDatabase(database);
    refreshMockSession(database);
    return ok("Trainees imported successfully.", paginate(created, { limit: created.length, pageNo: 1 }));
  }

  if (method === "POST" && url === "/super-admins") {
    if (!isSuperAdminSession()) {
      return fail("Only a super admin can create another super admin.", {});
    }

    const values = payload as unknown as SuperAdminFormValues;
    const errors: Record<string, string> = {};

    if (!values.name.trim()) {
      errors.name = "Name is required.";
    }

    if (!isValidEmail(values.email)) {
      errors.email = "Use a valid email address.";
    } else if (database.users.some((user) => user.email.toLowerCase() === values.email.trim().toLowerCase())) {
      errors.email = "Email already exists.";
    }

    if (!values.phone.trim()) {
      errors.phone = "Mobile is required.";
    }

    if (!values.password.trim()) {
      errors.password = "Password is required.";
    } else if (values.password.trim().length < 6) {
      errors.password = "Password must be at least 6 characters.";
    }

    if (Object.keys(errors).length > 0) {
      return fail("Please correct the highlighted fields.", errors);
    }

    const record: MockUserRecord = {
      id: `user-${Date.now()}`,
      name: values.name.trim(),
      email: values.email.trim().toLowerCase(),
      role: "super_admin",
      roleName: "Super Admin",
      status: values.status,
      trainings: 0,
      lastActive: new Date().toISOString(),
      clientId: "",
      phone: values.phone.trim(),
      image: values.image || AvatarImage,
      permission: [],
      allowed: [],
      permissionSource: "role",
      useRoleDefaults: true,
    };

    database.users.unshift(record);
    pushMockNotifications(database, [record.id], {
      title: "Super admin access granted",
      message: "You can now manage platform-wide clients, plans, and administration.",
      category: "users",
      severity: "success",
      link: "/dashboard",
      actorName: getSession()?.fullname || getSession()?.name || "",
    });
    setDatabase(database);
    return ok("Super admin created successfully.", {
      id: record.id,
      name: record.name,
      email: record.email,
      phone: record.phone ?? "",
      status: record.status,
      image: record.image ?? AvatarImage,
      createdAt: record.lastActive,
    } satisfies SuperAdminRecord);
  }

  if (method === "PUT" && segments[0] === "users" && segments.length === 2) {
    const user = database.users.find((item) => item.id === segments[1]);

    if (!user) {
      return fail("User not found.", {} as UserRecord);
    }

    const values = payload as unknown as UserFormValues;

    if ((user.role === "super_admin" || values.role === "super_admin") && !isSuperAdminSession()) {
      return fail("Only a super admin can update super admin access.", {
        role: "Super admin access can only be changed by a super admin.",
      });
    }

    const errors = validateUser(values, database, user.id);

    if (Object.keys(errors).length > 0) {
      return fail("Please correct the highlighted fields.", errors);
    }

    user.name = values.name.trim();
    user.email = values.email.trim();
    user.role = values.role;
    user.roleName = values.role === "super_admin" ? "Super Admin" : getMockRoleDefinition(values.role, database)?.roleName ?? values.role;
    user.status = values.status;
    user.permission = normalizePermissionList(values.permission);
    user.allowed = buildAllowedFromPermissions(user.permission);
    user.permissionSource = "custom";

    if (values.role !== "super_admin") {
      const roleDefaults = getMockRoleDefinition(values.role, database);
      user.permission = user.permission.length ? user.permission : roleDefaults?.permission ?? [];
      user.allowed = buildAllowedFromPermissions(user.permission);
      user.permissionSource = isSamePermissionSet(user.permission, roleDefaults?.permission ?? []) ? "role" : "custom";
      user.useRoleDefaults = user.permissionSource !== "custom";
    }

    setDatabase(database);
    return ok("User updated successfully.", user);
  }

  if (method === "PUT" && segments[0] === "trainees" && segments.length === 2) {
    const user = database.users.find((item) => item.id === segments[1] && item.role === "trainee");
    const values = payload as {
      name: string;
      email: string;
      status: "active" | "inactive";
      password?: string;
    };

    if (!user) {
      return fail("Trainee not found.", {} as UserRecord);
    }

    const errors: Record<string, string> = {};

    if (!values.name.trim()) {
      errors.name = "Name is required.";
    }

    if (!isValidEmail(values.email)) {
      errors.email = "Use a valid email address.";
    } else if (
      database.users.some((item) => item.id !== user.id && item.email.toLowerCase() === values.email.trim().toLowerCase())
    ) {
      errors.email = "Email already exists.";
    }

    if (values.password?.trim() && values.password.trim().length < 6) {
      errors.password = "Password must be at least 6 characters.";
    }

    if (Object.keys(errors).length > 0) {
      return fail("Please correct the highlighted fields.", errors);
    }

    const client = getClientById(database, user.clientId);
    if (client && user.status !== values.status) {
      client.activeUsers = Math.max(0, Number(client.activeUsers ?? 0) + (values.status === "active" ? 1 : -1));
    }

    user.name = values.name.trim();
    user.email = values.email.trim().toLowerCase();
    user.status = values.status;
    user.lastActive = "Just now";
    setDatabase(database);
    refreshMockSession(database);
    return ok("Trainee updated successfully.", user);
  }

  if (method === "PUT" && segments[0] === "super-admins" && segments.length === 2) {
    if (!isSuperAdminSession()) {
      return fail("Only a super admin can update super admin access.", {});
    }

    const user = database.users.find((item) => item.id === segments[1] && item.role === "super_admin");

    if (!user) {
      return fail("Super admin not found.", {} as SuperAdminRecord);
    }

    const values = payload as unknown as SuperAdminFormValues;
    const errors: Record<string, string> = {};

    if (!values.name.trim()) {
      errors.name = "Name is required.";
    }

    if (!isValidEmail(values.email)) {
      errors.email = "Use a valid email address.";
    } else if (
      database.users.some((item) => item.id !== user.id && item.email.toLowerCase() === values.email.trim().toLowerCase())
    ) {
      errors.email = "Email already exists.";
    }

    if (!values.phone.trim()) {
      errors.phone = "Mobile is required.";
    }

    if (values.password.trim() && values.password.trim().length < 6) {
      errors.password = "Password must be at least 6 characters.";
    }

    if (Object.keys(errors).length > 0) {
      return fail("Please correct the highlighted fields.", errors);
    }

    user.name = values.name.trim();
    user.email = values.email.trim().toLowerCase();
    user.phone = values.phone.trim();
    user.status = values.status;
    user.image = values.image || user.image || AvatarImage;
    setDatabase(database);
    refreshMockSession(database);

    return ok("Super admin updated successfully.", {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone ?? "",
      status: user.status,
      image: user.image ?? AvatarImage,
      createdAt: user.lastActive || new Date().toISOString(),
    } satisfies SuperAdminRecord);
  }

  if (method === "DELETE" && segments[0] === "users" && segments.length === 2) {
    const user = database.users.find((item) => item.id === segments[1]);

    if (!user) {
      return fail("User not found.", false);
    }

    if (user.role === "super_admin" && !isSuperAdminSession()) {
      return fail("Only a super admin can remove another super admin.", false);
    }

    const client = getSessionClient(database);
    if (client && user.status === "active" && user.role !== "super_admin") {
      client.activeUsers = Math.max(0, Number(client.activeUsers ?? 0) - 1);
    }
    database.users = database.users.filter((item) => item.id !== segments[1]);
    setDatabase(database);
    refreshMockSession(database);
    return ok("User removed successfully.", true);
  }

  if (method === "DELETE" && segments[0] === "trainees" && segments.length === 2) {
    const user = database.users.find((item) => item.id === segments[1] && item.role === "trainee");

    if (!user) {
      return fail("Trainee not found.", false);
    }

    const client = getClientById(database, user.clientId);
    if (client && user.status === "active") {
      client.activeUsers = Math.max(0, Number(client.activeUsers ?? 0) - 1);
    }

    database.users = database.users.filter((item) => item.id !== user.id);
    setDatabase(database);
    refreshMockSession(database);
    return ok("Trainee removed successfully.", true);
  }

  if (method === "DELETE" && segments[0] === "super-admins" && segments.length === 2) {
    if (!isSuperAdminSession()) {
      return fail("Only a super admin can remove another super admin.", false);
    }

    const user = database.users.find((item) => item.id === segments[1] && item.role === "super_admin");

    if (!user) {
      return fail("Super admin not found.", false);
    }

    if (getSession()?._id === user.id) {
      return fail("You cannot remove your own account.", false);
    }

    if (database.users.filter((item) => item.role === "super_admin").length <= 1) {
      return fail("At least one super admin account must remain active.", false);
    }

    database.users = database.users.filter((item) => item.id !== segments[1]);
    setDatabase(database);
    return ok("Super admin removed successfully.", true);
  }

  if (method === "GET" && url === "/api-keys") {
    const query = String(params?.query ?? "").trim();
    const active = database.apiKeys.filter((item) => item.status === "active");
    const filtered = active.filter((key) =>
      [key.name, key.permission, key.lastUsed].some((value) => contains(value, query)),
    );
    return ok("API keys loaded.", paginate(filtered, params));
  }

  if (method === "POST" && url === "/api-keys") {
    const name = String(payload?.name ?? "");
    const permission = String(payload?.permission ?? "Read Only") as ApiKeyPermission;
    const errors = validateApiKey({ name });

    if (Object.keys(errors).length > 0) {
      return fail("Please correct the highlighted fields.", errors);
    }

    const record: ApiKeyRecord = {
      id: `key-${Date.now()}`,
      name,
      key: createApiKey(name),
      permission,
      createdAt: new Date().toISOString().slice(0, 10),
      lastUsed: "Never",
      callsToday: 0,
      status: "active",
    };

    database.apiKeys.unshift(record);
    setDatabase(database);
    return ok("API key generated successfully.", record);
  }

  if (method === "DELETE" && segments[0] === "api-keys" && segments.length === 2) {
    const key = database.apiKeys.find((item) => item.id === segments[1]);

    if (!key) {
      return fail("API key not found.", false);
    }

    key.status = "revoked";
    setDatabase(database);
    return ok("API key revoked successfully.", true);
  }

  if (method === "GET" && url === "/api-config") {
    return ok("API configuration loaded.", database.apiConfig);
  }

  if (method === "PUT" && url === "/api-config") {
    const baseUrl = String(payload?.baseUrl ?? "");

    if (!isValidUrl(baseUrl)) {
      return fail("Please correct the highlighted fields.", {
        baseUrl: "Use a valid API base URL.",
      });
    }

    database.apiConfig.baseUrl = baseUrl;
    database.apiConfig.rateLimitPerMinute = Number(payload?.rateLimitPerMinute ?? 0);
    database.apiConfig.tokenExpiryHours = Number(payload?.tokenExpiryHours ?? 0);
    database.apiConfig.corsAllowedOrigins = ensureArray(payload?.corsAllowedOrigins as string);
    setDatabase(database);
    return ok("API configuration updated successfully.", database.apiConfig);
  }

  if (method === "GET" && url === "/webhooks") {
    return ok("Webhook configuration loaded.", database.webhookConfig);
  }

  if (method === "PUT" && url === "/webhooks") {
    const webhookUrl = String(payload?.url ?? "");

    if (!isValidUrl(webhookUrl)) {
      return fail("Please correct the highlighted fields.", {
        url: "Use a valid webhook URL.",
      });
    }

    database.webhookConfig.url = webhookUrl;
    database.webhookConfig.signingSecret = String(payload?.signingSecret ?? database.webhookConfig.signingSecret);
    database.webhookConfig.retryAttempts = Number(payload?.retryAttempts ?? 0);
    database.webhookConfig.timeoutSeconds = Number(payload?.timeoutSeconds ?? 0);
    database.webhookConfig.events = (payload?.events as WebhookConfiguration["events"]) ?? [];
    setDatabase(database);
    return ok("Webhook configuration updated successfully.", database.webhookConfig);
  }

  if (method === "GET" && url === "/iframe") {
    return ok("iFrame configuration loaded.", database.iframeConfig);
  }

  if (method === "PUT" && url === "/iframe") {
    const baseUrl = String(payload?.baseUrl ?? "");

    if (!isValidUrl(baseUrl)) {
      return fail("Please correct the highlighted fields.", {
        baseUrl: "Use a valid embed URL.",
      });
    }

    database.iframeConfig = {
      baseUrl,
      defaultWidth: String(payload?.defaultWidth ?? "100%"),
      height: Number(payload?.height ?? 0),
      allowedParentDomains: ensureArray(payload?.allowedParentDomains as string),
      ssoParameterName: String(payload?.ssoParameterName ?? "sso"),
      allowFullscreen: Boolean(payload?.allowFullscreen),
      autoResize: Boolean(payload?.autoResize),
      blockRightClick: Boolean(payload?.blockRightClick),
    };
    setDatabase(database);
    return ok("iFrame settings updated successfully.", database.iframeConfig);
  }

  return fail("The requested mock endpoint is not implemented.", {});
};
