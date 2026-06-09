const Client = require("../models/Client");
const User = require("../models/User");
const { createDomainVerificationToken, buildWebhookConfigPayload } = require("../helpers/clientDelivery");
const { ok, fail } = require("../helpers/response");
const { buildDefaultTenantAppSettings, buildTenantSettingsPayload, getTenantClientId, setTenantSetting } = require("../helpers/tenant");
const { isValidEmail, isValidUrl } = require("../helpers/validation");

const parseList = (value) =>
  Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : String(value || "")
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);

const applyDomainConfiguration = (client, domainValue) => {
  const nextDomain = String(domainValue || "").trim().toLowerCase();
  const domainChanged = nextDomain !== String(client.domain || "").trim().toLowerCase();

  client.domain = nextDomain;

  if (!nextDomain) {
    client.domainStatus = "not_configured";
    client.domainVerificationToken = "";
    client.domainLastCheckedAt = "";
    client.domainLastCheckedResult = "";
    client.domainVerifiedAt = "";
    return;
  }

  if (domainChanged || !client.domainVerificationToken) {
    client.domainVerificationToken = createDomainVerificationToken();
    client.domainVerifiedAt = "";
  }

  client.domainVerificationHost = client.domainVerificationHost || "_trainup-verification";
  client.domainStatus = "pending";
  client.domainLastCheckedResult = `Add TXT ${client.domainVerificationHost}.${nextDomain} => trainup-verify=${client.domainVerificationToken}`;
};

const getSettings = async (req, res) => {
  const clientId = getTenantClientId(req.user);

  if (!clientId) {
    return fail(res, 400, "Tenant settings are not available for this account.");
  }

  const client = await Client.findOne({ appId: clientId }).lean();

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  return ok(res, "Tenant settings loaded.", await buildTenantSettingsPayload(client));
};

const updateCompanySettings = async (client, values) => {
  const errors = {};
  const nextName = String(values.name || "").trim();
  const nextIndustry = String(values.industry || "").trim();
  const nextSupportEmail = String(values.supportEmail || "").trim();

  if (!nextName) {
    errors.name = "Company name is required.";
  }

  if (!nextIndustry) {
    errors.industry = "Industry is required.";
  }

  if (!isValidEmail(nextSupportEmail)) {
    errors.supportEmail = "Use a valid support email.";
  }

  if (Object.keys(errors).length) {
    return { errors };
  }

  client.name = nextName;
  client.industry = nextIndustry;
  client.supportEmail = nextSupportEmail;
  client.companyPhone = String(values.companyPhone || "").trim();
  client.companyAddress = String(values.companyAddress || "").trim();
  client.status = String(values.status || client.status || "active").trim().toLowerCase();
  client.csm = String(values.csm || client.csm || "").trim();
  client.logo = nextName
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  await User.updateMany(
    { clientId: client.appId, role: { $ne: "super_admin" } },
    {
      $set: {
        clientName: nextName,
      },
    },
  );

  return { errors: null };
};

const updateWhitelabelSettings = async (client, values) => {
  client.applicationName = String(values.applicationName || "").trim() || client.name;
  client.primaryColor = String(values.primaryColor || client.primaryColor).trim();
  client.secondaryColor = String(values.secondaryColor || client.secondaryColor).trim();
  client.logoUrl = String(values.logoUrl || "").trim();
  client.darkLogoUrl = String(values.darkLogoUrl || "").trim();
  client.faviconUrl = String(values.faviconUrl || "").trim();
  return { errors: null };
};

const updateIntegrationSettings = async (client, values) => {
  const errors = {};
  const webhookUrl = String(values.webhookUrl || "").trim();
  const iframeBaseUrl = String(values.iframeBaseUrl || "").trim();
  const domain = String(values.domain || "").trim();

  if (webhookUrl && !isValidUrl(webhookUrl)) {
    errors.webhookUrl = "Use a valid webhook URL.";
  }

  if (iframeBaseUrl && !isValidUrl(iframeBaseUrl)) {
    errors.iframeBaseUrl = "Use a valid iframe base URL.";
  }

  if (domain && !domain.includes(".")) {
    errors.domain = "Use a valid domain.";
  }

  if (Object.keys(errors).length) {
    return { errors };
  }

  client.ssoType = String(values.ssoType || client.ssoType || "None").trim();
  client.ssoProviderType = String(values.ssoProviderType || client.ssoProviderType || "none").trim().toLowerCase();
  client.ssoStatus = client.ssoType && client.ssoType !== "None" ? "connected" : "not_configured";
  client.ssoClientId = String(values.ssoClientId || "").trim();
  client.ssoClientSecret = String(values.ssoClientSecret || "").trim();
  client.ssoTenantId = String(values.ssoTenantId || "").trim();
  client.ssoIssuerUrl = String(values.ssoIssuerUrl || "").trim();
  client.ssoEntryPoint = String(values.ssoEntryPoint || "").trim();
  client.ssoAudience = String(values.ssoAudience || "").trim();
  client.ssoRedirectUri = String(values.ssoRedirectUri || "").trim();
  client.ssoButtonLabel = String(values.ssoButtonLabel || "").trim();
  client.ssoAllowedDomains = parseList(values.ssoAllowedDomains);
  client.ssoAutoProvisionUsers = Boolean(values.ssoAutoProvisionUsers ?? true);
  client.webhookUrl = webhookUrl;
  client.apiScope = String(values.apiScope || "").trim();
  client.allowedOrigins = parseList(values.allowedOrigins);
  client.iframeEnabled = Boolean(values.iframeEnabled);
  client.iframeBaseUrl = iframeBaseUrl;
  client.iframeAllowedParentDomains = parseList(values.iframeAllowedParentDomains);
  client.lastWebhookTestStatus = client.lastWebhookTestStatus || "not_tested";
  client.subdomain = String(values.subdomain || client.subdomain || "").trim();
  applyDomainConfiguration(client, domain);

  return { errors: null };
};

const updateSmtpSettings = async (client, values) => {
  const errors = {};
  const fromEmail = String(values.fromEmail || "").trim();

  if (fromEmail && !isValidEmail(fromEmail)) {
    errors.fromEmail = "Use a valid email address.";
  }

  if (Object.keys(errors).length) {
    return { errors };
  }

  client.smtpHost = String(values.host || "").trim();
  client.smtpPort = Number(values.port || 587);
  client.smtpUsername = String(values.username || "").trim();
  client.smtpPassword = String(values.password || "").trim();
  client.smtpFromName = String(values.fromName || "").trim();
  client.smtpFromEmail = fromEmail;
  client.smtpSecure = Boolean(values.secure);
  client.emailDeliveryEnabled = Boolean(values.emailDeliveryEnabled);
  client.smtpTestRecipient = String(values.testRecipient || "").trim();
  client.smtpTrainingAssignmentSubject = String(
    values.trainingAssignmentSubject || "",
  ).trim();
  client.smtpTrainingAssignmentTemplate = String(
    values.trainingAssignmentTemplate || "",
  ).trim();

  return { errors: null };
};

const updateSettings = async (req, res) => {
  const clientId = getTenantClientId(req.user);

  if (!clientId) {
    return fail(res, 400, "Tenant settings are not available for this account.");
  }

  const client = await Client.findOne({ appId: clientId });

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  const section = String(req.params.section || "").trim().toLowerCase();
  let outcome = { errors: null };

  if (section === "company") {
    outcome = await updateCompanySettings(client, req.body);
  } else if (section === "whitelabel") {
    outcome = await updateWhitelabelSettings(client, req.body);
  } else if (section === "integrations") {
    outcome = await updateIntegrationSettings(client, req.body);
  } else if (section === "smtp") {
    outcome = await updateSmtpSettings(client, req.body);
  } else {
    return fail(res, 400, "Unknown settings section.");
  }

  if (outcome.errors) {
    return fail(res, 400, "Please correct the highlighted fields.", outcome.errors);
  }

  await client.save();
  await Promise.all([
    setTenantSetting(client.appId, "appSettings", buildDefaultTenantAppSettings(client.toObject())),
    setTenantSetting(client.appId, "apiConfig", {
      baseUrl: client.iframeBaseUrl || "",
      rateLimitPerMinute: 1000,
      tokenExpiryHours: 24,
      corsAllowedOrigins: parseList(client.allowedOrigins),
      endpoints: [],
    }),
    setTenantSetting(client.appId, "webhookConfig", buildWebhookConfigPayload(client)),
    setTenantSetting(client.appId, "iframeConfig", {
      baseUrl: client.iframeBaseUrl || "",
      defaultWidth: "100%",
      height: 680,
      allowedParentDomains: parseList(client.iframeAllowedParentDomains),
      ssoParameterName: "sso",
      allowFullscreen: true,
      autoResize: true,
      blockRightClick: false,
    }),
  ]);
  return ok(res, "Settings updated successfully.", await buildTenantSettingsPayload(client.toObject()));
};

module.exports = {
  getSettings,
  updateSettings,
};
