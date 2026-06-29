const Client = require("../models/Client");
const User = require("../models/User");
const Training = require("../models/Training");
const ApiKey = require("../models/ApiKey");
const MediaAsset = require("../models/MediaAsset");
const Setting = require("../models/Setting");
const { ensureArray } = require("./validation");

const DEFAULT_CLIENT_ID = "client-001";

const isSuperAdminHostname = (hostname) => {
  const normalized = normalizeHostname(hostname);

  return (
    normalized === "trainup-superadmin.vercel.app" ||
    normalized.startsWith("trainup-superadmin-") ||
    normalized === "localhost" ||
    normalized === "127.0.0.1"
  );
};

const buildPlatformAppSettings = (hostname = "") => ({
  application_name: isSuperAdminHostname(hostname) ? "Brenin Inc." : "Trainup",
  logo: "/branding/logo.png",
  dark_logo: "/branding/logo-dark.png",
  favicon: "/branding/favicon.png",
  email: "support@trainup.ai",
  copyright: `© ${new Date().getFullYear()} Trainup. All rights reserved.`,
  phone: "+91 1800 120 9999",
  path: "/dashboard",
});

const toTenantSettingKey = (clientId, key) => `client:${clientId}:${key}`;

const getTenantSetting = async (clientId, key, fallback = null) => {
  if (!clientId) {
    return fallback;
  }

  const record = await Setting.findOne({ key: toTenantSettingKey(clientId, key) }).lean();
  return record ? record.value : fallback;
};

const setTenantSetting = async (clientId, key, value) => {
  await Setting.findOneAndUpdate(
    { key: toTenantSettingKey(clientId, key) },
    {
      key: toTenantSettingKey(clientId, key),
      value,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );
};

const getTenantClientId = (user) => {
  if (!user || user.role === "super_admin") {
    return "";
  }

  return String(user.clientId || "").trim();
};

const isTenantScopedUser = (user) => Boolean(getTenantClientId(user));

const getAccessibleClientIds = (user) => {
  const clientId = getTenantClientId(user);
  return clientId ? [clientId] : [];
};

const normalizeHostname = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/:\d+$/, "")
    .replace(/\/.*$/, "");

const getRequestHostname = (req) => {
  const originHeader = req.headers.origin || req.headers.referer || "";
  const originHost = normalizeHostname(Array.isArray(originHeader) ? originHeader[0] : originHeader);

  if (originHost && originHost !== "localhost" && originHost !== "127.0.0.1") {
    return originHost;
  }

  const forwardedHost = req.headers["x-forwarded-host"];
  const hostHeader = normalizeHostname(Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost || req.headers.host || "");

  return hostHeader;
};

const isDefaultAppHostname = (hostname) => {
  const normalized = normalizeHostname(hostname);

  if (!normalized) {
    return true;
  }

  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "trainup-gamma.vercel.app" ||
    normalized === "trainup-superadmin.vercel.app" ||
    normalized.startsWith("trainup-") ||
    normalized.startsWith("trainup-superadmin-")
  );
};

const findClientByHostname = async (hostname) => {
  const normalized = normalizeHostname(hostname);

  if (!normalized || isDefaultAppHostname(normalized)) {
    return null;
  }

  const exactDomainMatch = await Client.findOne({ domain: normalized }).lean();
  if (exactDomainMatch) {
    return exactDomainMatch;
  }

  const subdomain = normalized.split(".")[0];
  if (!subdomain) {
    return null;
  }

  return Client.findOne({ subdomain }).lean();
};

const buildTenantQuery = (user, extra = {}) => {
  const clientId = getTenantClientId(user);
  return clientId ? { ...extra, clientId } : extra;
};

const buildDefaultTenantAppSettings = (client) => ({
  application_name: client.applicationName || client.name || "Trainup",
  logo: client.logoUrl || "/branding/logo.png",
  dark_logo: client.darkLogoUrl || "/branding/logo-dark.png",
  favicon: client.faviconUrl || "/branding/favicon.png",
  primaryColor: client.primaryColor || "#2563eb",
  secondaryColor: client.secondaryColor || "#475569",
  accentColor: client.secondaryColor || "#14b8a6",
  gradientFrom: client.primaryColor || "#2563eb",
  gradientTo: client.secondaryColor || "#14b8a6",
  email: client.supportEmail || "support@samsung.com",
  copyright: `© ${new Date().getFullYear()} ${client.applicationName || client.name || "Trainup"}. All rights reserved.`,
  phone: client.companyPhone || "+91 1800 120 9999",
  path: "/dashboard",
});

const buildTenantSettingsPayload = async (client) => ({
  company: {
    name: client.name,
    industry: client.industry,
    supportEmail: client.supportEmail || "",
    companyPhone: client.companyPhone || "",
    companyAddress: client.companyAddress || "",
    status: client.status,
    csm: client.csm,
  },
  whitelabel: {
    applicationName: client.applicationName || client.name,
    primaryColor: client.primaryColor,
    secondaryColor: client.secondaryColor,
    logoUrl: client.logoUrl || "",
    darkLogoUrl: client.darkLogoUrl || "",
    faviconUrl: client.faviconUrl || "",
  },
  integrations: {
    ssoType: client.ssoType || "None",
    ssoStatus: client.ssoStatus || "not_configured",
    ssoProviderType: client.ssoProviderType || "none",
    ssoClientId: client.ssoClientId || "",
    ssoClientSecret: client.ssoClientSecret || "",
    ssoTenantId: client.ssoTenantId || "",
    ssoIssuerUrl: client.ssoIssuerUrl || "",
    ssoEntryPoint: client.ssoEntryPoint || "",
    ssoAudience: client.ssoAudience || "",
    ssoRedirectUri: client.ssoRedirectUri || "",
    ssoButtonLabel: client.ssoButtonLabel || "",
    ssoAllowedDomains: ensureArray(client.ssoAllowedDomains),
    ssoAutoProvisionUsers: client.ssoAutoProvisionUsers !== false,
    webhookUrl: client.webhookUrl || "",
    webhookSigningSecret: client.webhookSigningSecret || "",
    lastWebhookTestAt: client.lastWebhookTestAt || "",
    lastWebhookTestStatus: client.lastWebhookTestStatus || "not_tested",
    lastWebhookTestMessage: client.lastWebhookTestMessage || "",
    apiScope: client.apiScope || "",
    allowedOrigins: ensureArray(client.allowedOrigins),
    iframeEnabled: Boolean(client.iframeEnabled),
    iframeBaseUrl: client.iframeBaseUrl || "",
    iframeAllowedParentDomains: ensureArray(client.iframeAllowedParentDomains),
    domain: client.domain || "",
    subdomain: client.subdomain || "",
    domainStatus: client.domainStatus || "not_configured",
    domainVerificationToken: client.domainVerificationToken || "",
    domainVerificationHost: client.domainVerificationHost || "_trainup-verification",
    domainLastCheckedAt: client.domainLastCheckedAt || "",
    domainLastCheckedResult: client.domainLastCheckedResult || "",
    domainVerifiedAt: client.domainVerifiedAt || "",
    // LMS Integration (LMS_INTEGRATION_RESEARCH.md)
    ltiClientId: client.ltiClientId || "",
    ltiDeploymentId: client.ltiDeploymentId || "",
    ltiPlatformKeysetUrl: client.ltiPlatformKeysetUrl || "",
    ltiAccessTokenUrl: client.ltiAccessTokenUrl || "",
    ltiOidcAuthUrl: client.ltiOidcAuthUrl || "",
    scormEnabled: client.scormEnabled !== false,
    xapiEnabled: Boolean(client.xapiEnabled),
    xapiLrsEndpoint: client.xapiLrsEndpoint || "",
    xapiClientId: client.xapiClientId || "",
    xapiClientSecret: client.xapiClientSecret || "",
  },
  smtp: {
    emailDeliveryEnabled: Boolean(client.emailDeliveryEnabled),
    host: client.smtpHost || "",
    port: Number(client.smtpPort || 587),
    username: client.smtpUsername || "",
    password: client.smtpPassword || "",
    fromName: client.smtpFromName || "",
    fromEmail: client.smtpFromEmail || "",
    secure: Boolean(client.smtpSecure),
    testRecipient: client.smtpTestRecipient || "",
    lastTestAt: client.lastSmtpTestAt || "",
    lastTestStatus: client.lastSmtpTestStatus || "not_tested",
    lastTestMessage: client.lastSmtpTestMessage || "",
    trainingAssignmentSubject:
      client.smtpTrainingAssignmentSubject || "Training assigned: {trainingTitle}",
    trainingAssignmentTemplate:
      client.smtpTrainingAssignmentTemplate ||
      "<p>Hello {candidateName},</p><p>A training has been assigned to you.</p><p><strong>{trainingTitle}</strong></p><p>{trainingAudience}</p><p><a href=\"{trainingLink}\">Open training</a></p><p>{clientName}</p>",
  },
  emailCenter: {
    setPasswordSubject: client.emailSetPasswordSubject || "Set your password",
    setPasswordTemplate:
      client.emailSetPasswordTemplate ||
      "<p>Hello {name},</p><p>Your account has been created. Set your password to activate access.</p><p><a href=\"{actionUrl}\">Set your password</a></p><p>This secure link expires in {expiryMinutes} minutes and can only be used once.</p>",
    resetPasswordSubject: client.emailResetPasswordSubject || "Reset your password",
    resetPasswordTemplate:
      client.emailResetPasswordTemplate ||
      "<p>Hello {name},</p><p>We received a request to reset your password.</p><p><a href=\"{actionUrl}\">Reset your password</a></p><p>This secure link expires in {expiryMinutes} minutes and can only be used once.</p>",
    signatureHtml: client.emailSignatureHtml || "",
    signatureImageUrl: client.emailSignatureImageUrl || "",
  },
});

const syncClientMetrics = async (clientId) => {
  if (!clientId) {
    return null;
  }

  const [activeUsers, trainings, trainingRecords] = await Promise.all([
    User.countDocuments({ clientId, role: { $ne: "super_admin" }, status: "active" }),
    Training.countDocuments({ clientId }),
    Training.find({ clientId }).lean(),
  ]);

  const sessions = trainingRecords.reduce((count, item) => {
    const sessionList = Array.isArray(item.payload?.sessions) ? item.payload.sessions : [];
    return count + sessionList.length;
  }, 0);

  await Client.updateOne(
    { appId: clientId },
    {
      $set: {
        activeUsers,
        trainings,
        sessions,
      },
    },
  );

  return { activeUsers, trainings, sessions };
};

const migrateExistingRecordsToClient = async (clientId, clientName) => {
  await Promise.all([
    User.updateMany(
      { role: { $ne: "super_admin" }, $or: [{ clientId: { $exists: false } }, { clientId: "" }] },
      {
        $set: {
          clientId,
          clientName,
        },
      },
    ),
    ApiKey.updateMany(
      { $or: [{ clientId: { $exists: false } }, { clientId: "" }] },
      {
        $set: {
          clientId,
        },
      },
    ),
    Training.updateMany(
      { $or: [{ clientId: { $exists: false } }, { clientId: "" }] },
      {
        $set: {
          clientId,
        },
      },
    ),
    MediaAsset.updateMany(
      { $or: [{ clientId: { $exists: false } }, { clientId: "" }] },
      {
        $set: {
          clientId,
        },
      },
    ),
  ]);
};

module.exports = {
  DEFAULT_CLIENT_ID,
  buildPlatformAppSettings,
  toTenantSettingKey,
  getTenantSetting,
  setTenantSetting,
  getRequestHostname,
  findClientByHostname,
  getTenantClientId,
  getAccessibleClientIds,
  isTenantScopedUser,
  buildTenantQuery,
  buildDefaultTenantAppSettings,
  buildTenantSettingsPayload,
  syncClientMetrics,
  migrateExistingRecordsToClient,
};
