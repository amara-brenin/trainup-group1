const Client = require("../../models/Client");
const User = require("../../models/User");
const ApiKey = require("../../models/ApiKey");
const Training = require("../../models/Training");
const MediaAsset = require("../../models/MediaAsset");
const Setting = require("../../models/Setting");
const Notification = require("../../models/Notification");
const { hashPassword } = require("../../helpers/auth");
const { issuePasswordEmail } = require("../../services/authService");
const {
  createDomainVerificationToken,
  buildWebhookConfigPayload,
  appendWebhookLog,
  sendWebhookTest,
  verifyDomainRecord,
  sendSmtpTestEmail,
} = require("../../helpers/clientDelivery");
const { CREDIT_COSTS, buildClientCreditSnapshot, applyPlanToClient, applyPlanSnapshot, addClientCredits, normalizePlan, isSubscriptionExpired, getSubscriptionExpiry } = require("../../helpers/credits");
const { resolveImageField } = require("../../helpers/imageStorage");
const { notifyRolesInClient, notifySuperAdmins, notifyUserIds } = require("../../helpers/notifications");
const { getEditableRoleDefaults, getRoleDefinitions, getRoleDefinitionById, filterPermissionArrayForRole, buildAllowedFromPermissions } = require("../../helpers/permissions");
const { ok, fail } = require("../../helpers/response");
const { isValidEmail, isValidUrl } = require("../../helpers/validation");
const { buildDefaultTenantAppSettings, getTenantSetting, setTenantSetting, syncClientMetrics } = require("../../helpers/tenant");

const paginate = (records, query) => {
  const limit = Math.max(1, Number(query.limit || 10));
  const pageNo = Math.max(1, Number(query.pageNo || 1));
  const count = records.length;
  const totalPages = Math.max(1, Math.ceil(count / limit));
  const currentPage = Math.min(pageNo, totalPages);
  const startIndex = (currentPage - 1) * limit;

  return {
    count,
    totalPages,
    record: records.slice(startIndex, startIndex + limit),
    pagination: Array.from({ length: totalPages }, (_, index) => index + 1),
  };
};

const buildListFilter = (queryParams) => {
  const filter = {};
  const query = String(queryParams.query || "").trim();
  const status = String(queryParams.status || "all").trim().toLowerCase();
  const plan = String(queryParams.plan || "all").trim().toUpperCase();

  if (query) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: escaped, $options: "i" } },
      { industry: { $regex: escaped, $options: "i" } },
      { csm: { $regex: escaped, $options: "i" } },
      { subdomain: { $regex: escaped, $options: "i" } },
      { domain: { $regex: escaped, $options: "i" } },
    ];
  }
  if (status !== "all") filter.status = status;
  if (plan !== "ALL") filter.plan = plan;
  return filter;
};

const buildListSort = (queryParams) => {
  const sortBy = String(queryParams.sortBy || "name").trim();
  if (sortBy === "industry") return { industry: 1 };
  if (sortBy === "users") return { activeUsers: -1 };
  if (sortBy === "trainings") return { trainings: -1 };
  return { name: 1 };
};

// logoUrl/darkLogoUrl are excluded here on purpose: both are base64 image
// blobs and the list table only ever renders one of them (logoUrl falling
// back to darkLogoUrl — see toClientListRecord's `thumbnailUrl`). Sending
// both duplicated the heaviest field in this response. The edit screen
// (ClientDetail.tsx) fetches the full client via GET /clients/:id and still
// gets both fields there, so editing is unaffected.
const LIST_PROJECTION = {
  appId: 1, name: 1, industry: 1, plan: 1, status: 1,
  monthlyCredits: 1, purchasedCredits: 1, usedCredits: 1, totalCredits: 1,
  // planExpiryDate is required so the list's expiry badge reflects the stored
  // (renewed) expiry instead of falling back to the createdAt+1mo computation.
  planExpiryDate: 1, subscribedPlan: 1, entitlementSnapshotAt: 1,
  activeUsers: 1, trainings: 1, sessions: 1,
  domain: 1, domainStatus: 1, subdomain: 1, joined: 1, csm: 1,
  logo: 1, logoColor: 1, logoBg: 1,
  firstUserName: 1, enterpriseRequests: 1, enterpriseMonthlyCredits: 1,
  enterpriseMonthlyPrice: 1, billingCycle: 1, createdAt: 1,
  thumbnailUrl: { $ifNull: ["$logoUrl", "$darkLogoUrl"] },
};

const toClientListRecord = (client) => ({
  id: client.appId,
  name: client.name,
  industry: client.industry,
  plan: normalizePlan(client.plan),
  status: client.status,
  monthlyCredits: Number(client.monthlyCredits || 0),
  purchasedCredits: Math.max(0, Number(client.purchasedCredits || 0)),
  usedCredits: Math.max(0, Number(client.usedCredits || 0)),
  totalCredits: Number(client.totalCredits || 0),
  planExpired: Boolean(isSubscriptionExpired(client)),
  expiresOn: (() => { const d = getSubscriptionExpiry(client); return d ? d.toISOString() : null; })(),
  billingCycle: client.billingCycle || "monthly",
  activeUsers: client.activeUsers || 0,
  trainings: client.trainings || 0,
  sessions: client.sessions || 0,
  domain: client.domain || "",
  domainStatus: client.domainStatus || "not_configured",
  subdomain: client.subdomain || "",
  joined: client.joined || "",
  csm: client.csm || "",
  logo: client.logo || "",
  logoColor: client.logoColor || "#3e60d5",
  logoBg: client.logoBg || "#ebf2ff",
  thumbnailUrl: client.thumbnailUrl || "",
  firstUserName: client.firstUserName || "",
  enterpriseRequests: Array.isArray(client.enterpriseRequests) ? client.enterpriseRequests : [],
  createdAt: client.createdAt || "",
});

const contains = (value, query) => String(value || "").toLowerCase().includes(String(query || "").trim().toLowerCase());
const applyClientListControls = (records, queryParams) => {
  const query = String(queryParams.query || "").trim();
  const status = String(queryParams.status || "all").trim().toLowerCase();
  const plan = String(queryParams.plan || "all").trim().toUpperCase();
  const sortBy = String(queryParams.sortBy || "name").trim();

  const filtered = records.filter((client) => {
    const matchesQuery = [client.name, client.industry, client.csm, client.subdomain, client.domain]
      .filter(Boolean)
      .some((value) => contains(value, query));
    const matchesStatus = status === "all" || String(client.status || "").toLowerCase() === status;
    const matchesPlan = plan === "ALL" || String(client.plan || "").toUpperCase() === plan;
    return matchesQuery && matchesStatus && matchesPlan;
  });

  return [...filtered].sort((left, right) => {
    if (sortBy === "industry") {
      return String(left.industry || "").localeCompare(String(right.industry || ""));
    }
    if (sortBy === "users") {
      return Number(right.activeUsers || 0) - Number(left.activeUsers || 0);
    }
    if (sortBy === "trainings") {
      return Number(right.trainings || 0) - Number(left.trainings || 0);
    }
    return String(left.name || "").localeCompare(String(right.name || ""));
  });
};

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

const getTenantRoleDefinitions = async (clientId) => getRoleDefinitions(await getTenantSetting(clientId, "rolePermissions", getEditableRoleDefaults()));

const getClientAdminRoleDefinition = async (clientId) => getRoleDefinitionById("admin", await getTenantRoleDefinitions(clientId));

const toClientRecord = async (client) => {
  const adminRole = await getClientAdminRoleDefinition(client.appId);
  const creditSnapshot = buildClientCreditSnapshot(client);
  // Embed the exact billing view the client sees in their Upgrade & Billing
  // page (expiry-aware credits, start/expiry dates, plan usage, purchase
  // history) so the super-admin detail page renders identical dynamic data.
  // Lazy require avoids a load-time circular dependency with commonController.
  const { buildBillingSummaryResponse } = require("../commonController");
  const billing = buildBillingSummaryResponse(client);

  return {
    billing,
    id: client.appId,
    name: client.name,
    industry: client.industry,
    plan: normalizePlan(client.plan),
    monthlyCredits: creditSnapshot.monthlyCredits,
    purchasedCredits: creditSnapshot.purchasedCredits,
    usedCredits: creditSnapshot.usedCredits,
    totalCredits: creditSnapshot.totalCredits,
    billingCycle: creditSnapshot.billingCycle,
    trainingCreditCost: CREDIT_COSTS.training,
    userCreditCost: CREDIT_COSTS.user,
    sessionCreditCost: CREDIT_COSTS.session,
    planLimits: creditSnapshot.planConfig.limits,
    status: client.status,
    domain: client.domain,
    domainStatus: client.domainStatus,
    domainVerificationToken: client.domainVerificationToken || "",
    domainVerificationHost: client.domainVerificationHost || "_trainup-verification",
    domainLastCheckedAt: client.domainLastCheckedAt || "",
    domainLastCheckedResult: client.domainLastCheckedResult || "",
    domainVerifiedAt: client.domainVerifiedAt || "",
    subdomain: client.subdomain,
    activeUsers: client.activeUsers,
    trainings: client.trainings,
    sessions: client.sessions,
    joined: client.joined,
    csm: client.csm,
    logo: client.logo,
    logoColor: client.logoColor,
    logoBg: client.logoBg,
    iframeEnabled: client.iframeEnabled,
    ssoType: client.ssoType,
    ssoStatus: client.ssoStatus,
    ssoProviderType: client.ssoProviderType || "none",
    ssoClientId: client.ssoClientId || "",
    ssoClientSecret: client.ssoClientSecret || "",
    ssoTenantId: client.ssoTenantId || "",
    ssoIssuerUrl: client.ssoIssuerUrl || "",
    ssoEntryPoint: client.ssoEntryPoint || "",
    ssoAudience: client.ssoAudience || "",
    ssoRedirectUri: client.ssoRedirectUri || "",
    ssoButtonLabel: client.ssoButtonLabel || "",
    ssoAllowedDomains: client.ssoAllowedDomains || [],
    ssoAutoProvisionUsers: client.ssoAutoProvisionUsers !== false,
    primaryColor: client.primaryColor,
    secondaryColor: client.secondaryColor,
    supportEmail: client.supportEmail,
    companyPhone: client.companyPhone || "",
    companyAddress: client.companyAddress || "",
    applicationName: client.applicationName || client.name,
    logoUrl: client.logoUrl || "",
    darkLogoUrl: client.darkLogoUrl || "",
    faviconUrl: client.faviconUrl || "",
    allowedOrigins: client.allowedOrigins || [],
    webhookUrl: client.webhookUrl,
    lastWebhookTestAt: client.lastWebhookTestAt || "",
    lastWebhookTestStatus: client.lastWebhookTestStatus || "not_tested",
    lastWebhookTestMessage: client.lastWebhookTestMessage || "",
    apiScope: client.apiScope,
    iframeBaseUrl: client.iframeBaseUrl || "",
    iframeAllowedParentDomains: client.iframeAllowedParentDomains || [],
    emailDeliveryEnabled: Boolean(client.emailDeliveryEnabled),
    smtpHost: client.smtpHost || "",
    smtpPort: Number(client.smtpPort || 587),
    smtpUsername: client.smtpUsername || "",
    smtpPassword: client.smtpPassword || "",
    smtpFromName: client.smtpFromName || "",
    smtpFromEmail: client.smtpFromEmail || "",
    smtpSecure: Boolean(client.smtpSecure),
    smtpTestRecipient: client.smtpTestRecipient || "",
    lastSmtpTestAt: client.lastSmtpTestAt || "",
    lastSmtpTestStatus: client.lastSmtpTestStatus || "not_tested",
    lastSmtpTestMessage: client.lastSmtpTestMessage || "",
    paymentProvider: client.paymentProvider || "razorpay",
    paymentMode: client.paymentMode || "test",
    billingCurrency: client.billingCurrency || "INR",
    razorpayKeyId: client.razorpayKeyId || "",
    razorpayKeySecret: client.razorpayKeySecret || "",
    enterpriseMonthlyPrice: Math.max(0, Number(client.enterpriseMonthlyPrice || 0)),
    enterpriseMonthlyCredits: Math.max(0, Number(client.enterpriseMonthlyCredits || 0)) || 40000,
    enterpriseSupportNotes: client.enterpriseSupportNotes || "",
    enterpriseRequests: Array.isArray(client.enterpriseRequests) ? client.enterpriseRequests : [],
    clientAdminUserId: client.clientAdminUserId || "",
    firstUserName: client.firstUserName || "",
    firstUserEmail: client.firstUserEmail || "",
    clientAdminPermission: adminRole?.permission || [],
  };
};

const applyClientAdminRolePermissions = async (clientId, nextPermission) => {
  const roleDefinitions = await getTenantRoleDefinitions(clientId);
  const filteredPermission = filterPermissionArrayForRole("admin", nextPermission);
  const nextRoles = roleDefinitions.map((role) =>
    role.id === "admin"
      ? {
          ...role,
          permission: filteredPermission,
        }
      : role,
  );

  await setTenantSetting(clientId, "rolePermissions", nextRoles);

  const nextAllowed = buildAllowedFromPermissions(filteredPermission);
  await User.updateMany(
    { clientId, role: "admin", $or: [{ useRoleDefaults: { $exists: false } }, { useRoleDefaults: true }] },
    {
      $set: {
        permission: filteredPermission,
        allowed: nextAllowed,
        useRoleDefaults: true,
      },
    },
  );

  return filteredPermission;
};

const validateClient = async (values, currentId, currentUserId = "") => {
  const errors = {};

  if (!String(values.name || "").trim()) {
    errors.name = "Client name is required.";
  }
  if (!String(values.industry || "").trim()) {
    errors.industry = "Industry is required.";
  }
  if (!String(values.csm || "").trim()) {
    errors.csm = "Customer success manager is required.";
  }
  if (!String(values.subdomain || "").trim()) {
    errors.subdomain = "Subdomain is required.";
  } else {
    const subdomainFilter = { subdomain: { $regex: `^${String(values.subdomain).trim()}$`, $options: "i" } };
    if (currentId) subdomainFilter.appId = { $ne: currentId };
    const duplicateSubdomain = await Client.findOne(subdomainFilter).lean();
    if (duplicateSubdomain) {
      errors.subdomain = "Subdomain already exists.";
    }
  }

  if (values.domain && !String(values.domain).includes(".")) {
    errors.domain = "Use a valid domain.";
  }

  if (!String(values.firstUserName || "").trim()) {
    errors.firstUserName = "First client admin name is required.";
  }

  if (!isValidEmail(values.firstUserEmail)) {
    errors.firstUserEmail = "Use a valid client admin email.";
  } else {
    const emailFilter = { email: String(values.firstUserEmail).trim().toLowerCase() };
    if (currentUserId) emailFilter.appId = { $ne: currentUserId };
    const duplicateEmail = await User.findOne(emailFilter).lean();
    if (duplicateEmail) {
      errors.firstUserEmail = "Email already exists.";
    }
  }

  if (!currentId && (!Array.isArray(values.clientAdminPermission) || values.clientAdminPermission.length === 0)) {
    errors.clientAdminPermission = "Select at least one client admin permission.";
  }

  if (values.supportEmail && !isValidEmail(values.supportEmail)) {
    errors.supportEmail = "Use a valid support email.";
  }

  if (values.smtpFromEmail && !isValidEmail(values.smtpFromEmail)) {
    errors.smtpFromEmail = "Use a valid SMTP sender email.";
  }

  if (values.webhookUrl && !isValidUrl(values.webhookUrl)) {
    errors.webhookUrl = "Use a valid webhook URL.";
  }

  if (values.iframeBaseUrl && !isValidUrl(values.iframeBaseUrl)) {
    errors.iframeBaseUrl = "Use a valid iframe base URL.";
  }

  return errors;
};

const list = async (req, res) => {
  const filter = buildListFilter(req.query);
  const sort = buildListSort(req.query);
  const limit = Math.max(1, Number(req.query.limit || 10));
  const pageNo = Math.max(1, Number(req.query.pageNo || 1));
  const skip = (pageNo - 1) * limit;

  const [clients, count] = await Promise.all([
    Client.aggregate([
      { $match: filter },
      { $sort: sort },
      { $skip: skip },
      { $limit: limit },
      { $project: LIST_PROJECTION },
    ]),
    Client.countDocuments(filter),
  ]);

  const totalPages = Math.max(1, Math.ceil(count / limit));
  return ok(res, "Clients loaded.", {
    count,
    totalPages,
    record: clients.map(toClientListRecord),
    pagination: Array.from({ length: totalPages }, (_, i) => i + 1),
  });
};

const create = async (req, res) => {
  const errors = await validateClient(req.body, null, "");

  if (Object.keys(errors).length) {
    return fail(res, 400, "Please correct the highlighted fields.", errors);
  }

  const clientId = `client-${Date.now()}`;
  const name = String(req.body.name).trim();
  // Storage migration: base64 logo/dark-logo/favicon input is uploaded to S3
  // and replaced with the resulting URL; an existing URL passes through unchanged.
  const [resolvedLogoUrl, resolvedDarkLogoUrl, resolvedFaviconUrl] = await Promise.all([
    resolveImageField(req.body.logoUrl, "client-logos"),
    resolveImageField(req.body.darkLogoUrl, "client-dark-logos"),
    resolveImageField(req.body.faviconUrl, "client-favicons"),
  ]);
  const client = new Client({
    appId: clientId,
    name,
    industry: String(req.body.industry).trim(),
    plan: normalizePlan(req.body.plan || "FREE"),
    status: req.body.status || "trial",
    csm: String(req.body.csm).trim(),
    activeUsers: 0,
    trainings: 0,
    sessions: 0,
    subdomain: String(req.body.subdomain).trim(),
    domain: "",
    domainStatus: "not_configured",
    joined: new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(new Date()),
    logo: name
      .split(" ")
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase(),
    logoColor: "#3e60d5",
    logoBg: "#ebf2ff",
    iframeEnabled: Boolean(req.body.iframeEnabled ?? true),
    ssoType: String(req.body.ssoType || "Trainup IAM").trim(),
    ssoStatus: req.body.ssoType && req.body.ssoType !== "None" ? "connected" : "not_configured",
    ssoProviderType: String(req.body.ssoProviderType || "none").trim().toLowerCase(),
    ssoClientId: String(req.body.ssoClientId || "").trim(),
    ssoClientSecret: String(req.body.ssoClientSecret || "").trim(),
    ssoTenantId: String(req.body.ssoTenantId || "").trim(),
    ssoIssuerUrl: String(req.body.ssoIssuerUrl || "").trim(),
    ssoEntryPoint: String(req.body.ssoEntryPoint || "").trim(),
    ssoAudience: String(req.body.ssoAudience || "").trim(),
    ssoRedirectUri: String(req.body.ssoRedirectUri || "").trim(),
    ssoButtonLabel: String(req.body.ssoButtonLabel || "").trim(),
    ssoAllowedDomains: parseList(req.body.ssoAllowedDomains),
    ssoAutoProvisionUsers: Boolean(req.body.ssoAutoProvisionUsers ?? true),
    primaryColor: String(req.body.primaryColor || "#1428a0"),
    secondaryColor: String(req.body.secondaryColor || "#3e60d5"),
    supportEmail: String(req.body.supportEmail || req.body.firstUserEmail || "").trim(),
    companyPhone: String(req.body.companyPhone || "").trim(),
    companyAddress: String(req.body.companyAddress || "").trim(),
    applicationName: String(req.body.applicationName || name).trim(),
    logoUrl: resolvedLogoUrl,
    darkLogoUrl: resolvedDarkLogoUrl,
    faviconUrl: resolvedFaviconUrl,
    allowedOrigins: parseList(req.body.allowedOrigins),
    webhookUrl: String(req.body.webhookUrl || "").trim(),
    lastWebhookTestStatus: "not_tested",
    apiScope: String(req.body.apiScope || "").trim(),
    iframeBaseUrl: String(req.body.iframeBaseUrl || "").trim(),
    iframeAllowedParentDomains: parseList(req.body.iframeAllowedParentDomains),
    emailDeliveryEnabled: Boolean(req.body.emailDeliveryEnabled),
    smtpHost: String(req.body.smtpHost || "").trim(),
    smtpPort: Number(req.body.smtpPort || 587),
    smtpUsername: String(req.body.smtpUsername || "").trim(),
    smtpPassword: String(req.body.smtpPassword || "").trim(),
    smtpFromName: String(req.body.smtpFromName || "").trim(),
    smtpFromEmail: String(req.body.smtpFromEmail || "").trim(),
    smtpSecure: Boolean(req.body.smtpSecure),
    smtpTestRecipient: String(req.body.smtpTestRecipient || "").trim(),
    lastSmtpTestStatus: "not_tested",
    paymentProvider: String(req.body.paymentProvider || "razorpay").trim().toLowerCase(),
    paymentMode: "test",
    billingCurrency: String(req.body.billingCurrency || "INR").trim().toUpperCase(),
    razorpayKeyId: String(req.body.razorpayKeyId || "").trim(),
    razorpayKeySecret: String(req.body.razorpayKeySecret || "").trim(),
    enterpriseMonthlyPrice: Math.max(0, Number(req.body.enterpriseMonthlyPrice || 0)),
    enterpriseMonthlyCredits: Math.max(0, Number(req.body.enterpriseMonthlyCredits || 0)),
    enterpriseSupportNotes: "",
    enterpriseRequests: [],
    firstUserName: String(req.body.firstUserName || "").trim(),
    firstUserEmail: String(req.body.firstUserEmail || "").trim().toLowerCase(),
  });
  applyDomainConfiguration(client, req.body.domain);
  applyPlanToClient(client, req.body.plan, { resetUsage: true, resetPurchasedCredits: true });
  await applyPlanSnapshot(client, req.body.plan); // Phase C: freeze entitlement from DB plan
  await client.save();

  const tenantRoleDefaults = getEditableRoleDefaults();
  const adminDefaults = getRoleDefinitionById("admin", tenantRoleDefaults);
  const clientAdminPermission = filterPermissionArrayForRole("admin", req.body.clientAdminPermission || adminDefaults?.permission || []);
  const nextRoles = tenantRoleDefaults.map((role) =>
    role.id === "admin"
      ? {
          ...role,
          permission: clientAdminPermission,
          allowed: buildAllowedFromPermissions(clientAdminPermission),
        }
      : role,
  );

  await Promise.all([
    setTenantSetting(client.appId, "rolePermissions", nextRoles),
    setTenantSetting(client.appId, "appSettings", buildDefaultTenantAppSettings(client.toObject())),
    setTenantSetting(client.appId, "apiConfig", {
      baseUrl: client.iframeBaseUrl || "",
      rateLimitPerMinute: 1000,
      tokenExpiryHours: 24,
      corsAllowedOrigins: client.allowedOrigins,
      endpoints: [],
    }),
    setTenantSetting(client.appId, "webhookConfig", buildWebhookConfigPayload(client)),
    setTenantSetting(client.appId, "iframeConfig", {
      baseUrl: client.iframeBaseUrl || "",
      defaultWidth: "100%",
      height: 680,
      allowedParentDomains: client.iframeAllowedParentDomains,
      ssoParameterName: "sso",
      allowFullscreen: true,
      autoResize: true,
      blockRightClick: false,
    }),
  ]);

  const adminRole = getRoleDefinitionById("admin", nextRoles);
  const adminUserId = `user-${Date.now()}`;
  const adminUser = await User.create({
    appId: adminUserId,
    clientId: client.appId,
    clientName: client.name,
    name: client.firstUserName,
    fullname: client.firstUserName,
    email: client.firstUserEmail,
    role: "admin",
    roleName: adminRole.roleName,
    permission: adminRole.permission,
    allowed: adminRole.allowed,
    useRoleDefaults: true,
    status: "active",
    trainings: 0,
    lastActive: "Just now",
    usedCredits: 0,
    totalCredits: buildClientCreditSnapshot(client).totalCredits,
    isUnreadNotifications: false,
    image: "/branding/avatar.png",
    phone: client.companyPhone || "",
    title: "Client Admin",
    department: "Operations",
    passwordHash: hashPassword(`pending-client-admin-${adminUserId}`),
    isActivated: false,
    activatedAt: null,
  });

  client.clientAdminUserId = adminUser.appId;
  await client.save();
  await syncClientMetrics(client.appId);
  await issuePasswordEmail({
    req,
    user: adminUser,
    purpose: "set_password",
    forcePlatform: true,
    createdBy: req.user?.appId || "",
  });

  await Promise.all([
    notifyUserIds([adminUser.appId], {
      title: "Client admin account ready",
      message: `${client.name} has been onboarded and your admin access is ready.`,
      category: "clients",
      severity: "success",
      link: "/dashboard",
      actorName: req.user?.fullname || req.user?.name || "",
      metadata: {
        clientId: client.appId,
      },
    }),
    notifySuperAdmins(
      {
        title: "New client created",
        message: `${client.name} was onboarded on the ${normalizePlan(client.plan)} plan.`,
        category: "clients",
        severity: "info",
        link: `/clients/${client.appId}`,
        actorName: req.user?.fullname || req.user?.name || "",
        metadata: {
          clientId: client.appId,
        },
      },
      { excludeUserId: req.user?.appId },
    ),
  ]);

  return ok(res, "Client created successfully.", await toClientRecord(client.toObject()));
};

const getOne = async (req, res) => {
  const client = await Client.findOne({ appId: req.params.id }).lean();

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  return ok(res, "Client loaded.", await toClientRecord(client));
};

const update = async (req, res) => {
  const client = await Client.findOne({ appId: req.params.id });

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  const errors = await validateClient(
    {
      ...req.body,
      firstUserName: req.body.firstUserName || client.firstUserName,
      firstUserEmail: req.body.firstUserEmail || client.firstUserEmail,
    },
    client.appId,
    client.clientAdminUserId,
  );

  if (Object.keys(errors).length) {
    return fail(res, 400, "Please correct the highlighted fields.", errors);
  }

  const name = String(req.body.name || client.name).trim();
  client.name = name;
  client.industry = String(req.body.industry || client.industry).trim();
  if (req.body.plan) {
    const nextPlan = normalizePlan(req.body.plan);
    if (nextPlan !== normalizePlan(client.plan)) {
      applyPlanToClient(client, nextPlan, {
        resetUsage: false,
        resetPurchasedCredits: false,
        carryAvailableCredits: true,
      });
      await applyPlanSnapshot(client, nextPlan); // Phase C: re-snapshot on plan change
    }
    client.plan = nextPlan;
  }
  client.status = req.body.status || client.status;
  client.csm = String(req.body.csm || client.csm).trim();
  client.subdomain = String(req.body.subdomain || client.subdomain).trim();
  applyDomainConfiguration(client, req.body.domain || client.domain);
  client.logo = name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  await client.save();
  await User.updateMany(
    { clientId: client.appId, role: { $ne: "super_admin" } },
    {
      $set: {
        clientName: client.name,
      },
    },
  );
  await syncClientMetrics(client.appId);
  return ok(res, "Client updated successfully.", await toClientRecord(client.toObject()));
};

const remove = async (req, res) => {
  const client = await Client.findOne({ appId: req.params.id }).lean();

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  await Promise.all([
    Client.deleteOne({ appId: req.params.id }),
    User.deleteMany({ clientId: req.params.id }),
    Notification.deleteMany({ $or: [{ clientId: req.params.id }, { userId: client.clientAdminUserId || "__none__" }] }),
    ApiKey.deleteMany({ clientId: req.params.id }),
    Training.deleteMany({ clientId: req.params.id }),
    MediaAsset.deleteMany({ clientId: req.params.id }),
    Setting.deleteMany({ key: new RegExp(`^client:${req.params.id}:`) }),
  ]);

  return ok(res, "Client deleted successfully.", true);
};

const updateSettings = async (req, res) => {
  const client = await Client.findOne({ appId: req.params.id });

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  const section = String(req.body.section || "").trim();
  const values = req.body.values || {};

  if (section === "company") {
    const errors = {};

    if (!String(values.name || "").trim()) {
      errors.name = "Company name is required.";
    }
    if (!String(values.industry || "").trim()) {
      errors.industry = "Industry is required.";
    }
    if (!isValidEmail(values.supportEmail)) {
      errors.supportEmail = "Use a valid support email.";
    }

    if (Object.keys(errors).length) {
      return fail(res, 400, "Please correct the highlighted fields.", errors);
    }

    client.name = String(values.name || "").trim();
    client.industry = String(values.industry || "").trim();
    client.supportEmail = String(values.supportEmail || "").trim();
    client.companyPhone = String(values.companyPhone || "").trim();
    client.companyAddress = String(values.companyAddress || "").trim();
    client.status = String(values.status || client.status).trim().toLowerCase();
    client.csm = String(values.csm || client.csm).trim();
    client.logo = client.name
      .split(" ")
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();

    await User.updateMany(
      { clientId: client.appId, role: { $ne: "super_admin" } },
      {
        $set: {
          clientName: client.name,
        },
      },
    );
  } else if (section === "domain") {
    if (values.domain && !String(values.domain).includes(".")) {
      return fail(res, 400, "Please correct the highlighted fields.", {
        domain: "Use a valid domain.",
      });
    }

    applyDomainConfiguration(client, values.domain);
    client.subdomain = String(values.subdomain || client.subdomain).trim();
    client.iframeEnabled = Boolean(values.iframeEnabled ?? client.iframeEnabled);
  } else if (section === "whitelabel") {
    client.applicationName = String(values.applicationName || client.name).trim();
    client.primaryColor = String(values.primaryColor || client.primaryColor).trim();
    client.secondaryColor = String(values.secondaryColor || client.secondaryColor).trim();
    // Storage migration: base64 input is uploaded to S3 and replaced with the
    // resulting URL; an existing URL passes through unchanged.
    client.logoUrl = await resolveImageField(values.logoUrl, "client-logos");
    client.darkLogoUrl = await resolveImageField(values.darkLogoUrl, "client-dark-logos");
    client.faviconUrl = await resolveImageField(values.faviconUrl, "client-favicons");
  } else if (section === "integrations") {
    if (values.webhookUrl && !isValidUrl(values.webhookUrl)) {
      return fail(res, 400, "Please correct the highlighted fields.", {
        webhookUrl: "Use a valid webhook URL.",
      });
    }

    client.ssoType = String(values.ssoType || client.ssoType).trim();
    client.ssoStatus = values.ssoType && values.ssoType !== "None" ? "connected" : "not_configured";
    client.ssoProviderType = String(values.ssoProviderType || client.ssoProviderType || "none").trim().toLowerCase();
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
    client.allowedOrigins = parseList(values.allowedOrigins);
    client.webhookUrl = String(values.webhookUrl || "").trim();
    client.apiScope = String(values.apiScope || "").trim();
    client.iframeEnabled = Boolean(values.iframeEnabled ?? client.iframeEnabled);
    client.iframeBaseUrl = String(values.iframeBaseUrl || "").trim();
    client.iframeAllowedParentDomains = parseList(values.iframeAllowedParentDomains);
  } else if (section === "smtp") {
    if (values.smtpFromEmail && !isValidEmail(values.smtpFromEmail)) {
      return fail(res, 400, "Please correct the highlighted fields.", {
        smtpFromEmail: "Use a valid email address.",
      });
    }

    client.smtpHost = String(values.smtpHost || "").trim();
    client.smtpPort = Number(values.smtpPort || 587);
    client.smtpUsername = String(values.smtpUsername || "").trim();
    client.smtpPassword = String(values.smtpPassword || "").trim();
    client.smtpFromName = String(values.smtpFromName || "").trim();
    client.smtpFromEmail = String(values.smtpFromEmail || "").trim();
    client.smtpSecure = Boolean(values.smtpSecure);
    client.emailDeliveryEnabled = Boolean(values.emailDeliveryEnabled);
    client.smtpTestRecipient = String(values.smtpTestRecipient || "").trim();
  } else if (section === "clientAdmin") {
    const clientAdminUser = await User.findOne({ appId: client.clientAdminUserId, clientId: client.appId });

    if (!clientAdminUser) {
      return fail(res, 404, "Client admin user not found.");
    }

    if (!String(values.firstUserName || "").trim()) {
      return fail(res, 400, "Please correct the highlighted fields.", {
        firstUserName: "Client admin name is required.",
      });
    }

    if (!isValidEmail(values.firstUserEmail)) {
      return fail(res, 400, "Please correct the highlighted fields.", {
        firstUserEmail: "Use a valid email address.",
      });
    }

    const duplicate = await User.findOne({
      email: String(values.firstUserEmail || "").trim().toLowerCase(),
      appId: { $ne: clientAdminUser.appId },
    }).lean();

    if (duplicate) {
      return fail(res, 400, "Please correct the highlighted fields.", {
        firstUserEmail: "Email already exists.",
      });
    }

    const nextPermission = await applyClientAdminRolePermissions(client.appId, values.clientAdminPermission || []);
    client.firstUserName = String(values.firstUserName || "").trim();
    client.firstUserEmail = String(values.firstUserEmail || "").trim().toLowerCase();

    clientAdminUser.name = client.firstUserName;
    clientAdminUser.fullname = client.firstUserName;
    clientAdminUser.email = client.firstUserEmail;
    clientAdminUser.permission = nextPermission;
    clientAdminUser.allowed = buildAllowedFromPermissions(nextPermission);
    clientAdminUser.useRoleDefaults = true;

    await clientAdminUser.save();
  } else if (section === "billing") {
    const previousPlan = normalizePlan(client.plan);
    const previousTotalCredits = Number(client.totalCredits || 0);
    const nextPlan = normalizePlan(values.plan || client.plan);
    const shouldResetToPlanCredits = Boolean(values.resetMonthlyCredits);
    client.paymentProvider = String(values.paymentProvider || client.paymentProvider || "razorpay").trim().toLowerCase();
    client.paymentMode = "test";
    client.billingCurrency = String(values.billingCurrency || client.billingCurrency || "INR").trim().toUpperCase();
    client.razorpayKeyId = String(values.razorpayKeyId || "").trim();
    client.razorpayKeySecret = String(values.razorpayKeySecret || "").trim();
    client.enterpriseMonthlyPrice = Math.max(0, Number(values.enterpriseMonthlyPrice || client.enterpriseMonthlyPrice || 0));
    client.enterpriseMonthlyCredits = Math.max(0, Number(values.enterpriseMonthlyCredits || client.enterpriseMonthlyCredits || 0));
    client.enterpriseSupportNotes = String(values.enterpriseSupportNotes || client.enterpriseSupportNotes || "").trim();

    if (nextPlan !== normalizePlan(client.plan) || shouldResetToPlanCredits) {
      applyPlanToClient(client, nextPlan, {
        resetUsage: false,
        resetPurchasedCredits: false,
        carryAvailableCredits: nextPlan !== previousPlan && !shouldResetToPlanCredits,
      });
      // A same-plan "reset monthly credits" is a renewal/new billing cycle →
      // reset lifetime counters (full quota again). A plan CHANGE (upgrade/
      // downgrade) preserves usage so a downgrade can't grant new creates.
      const isSamePlanRenewal = shouldResetToPlanCredits && nextPlan === previousPlan;
      await applyPlanSnapshot(client, nextPlan, { resetLifetime: isSamePlanRenewal });
    }

    if (nextPlan === "ENTERPRISE" && Array.isArray(client.enterpriseRequests)) {
      client.enterpriseRequests = client.enterpriseRequests.map((request) =>
        request?.status === "pending"
          ? {
              ...request,
              status: "assigned",
              resolvedAt: new Date().toISOString(),
            }
          : request,
      );
    }

    const extraCredits = Math.max(0, Number(values.extraCredits || 0));
    await client.save();

    if (extraCredits > 0) {
      const purchaseResult = await addClientCredits({
        clientId: client.appId,
        credits: extraCredits,
        note: "Manual super admin credit allocation",
      });
      await notifyRolesInClient({
        clientId: client.appId,
        roles: ["admin"],
        payload: {
          title: "Credits allocated",
          message: `${extraCredits.toLocaleString()} credits were added by super admin.`,
          category: "billing",
          severity: "success",
          link: "/upgrade-billings",
          actorName: req.user?.fullname || req.user?.name || "",
        },
      });
      await syncClientMetrics(client.appId);
      return ok(res, "Client settings updated successfully.", await toClientRecord(purchaseResult.client.toObject()));
    }

    const currentPlan = normalizePlan(client.plan);
    const currentTotalCredits = Number(client.totalCredits || 0);
    if (currentPlan !== previousPlan || currentTotalCredits !== previousTotalCredits) {
      await notifyRolesInClient({
        clientId: client.appId,
        roles: ["admin"],
        payload: {
          title: "Billing updated",
          message:
            currentPlan !== previousPlan
              ? `Your company plan is now ${currentPlan}.`
              : `Available company credits were updated to ${currentTotalCredits.toLocaleString()}.`,
          category: "billing",
          severity: "info",
          link: "/upgrade-billings",
          actorName: req.user?.fullname || req.user?.name || "",
        },
      });
    }
  } else {
    return fail(res, 400, "Unknown client settings section.");
  }

  await client.save();
  await Promise.all([
    setTenantSetting(client.appId, "appSettings", buildDefaultTenantAppSettings(client.toObject())),
    setTenantSetting(client.appId, "apiConfig", {
      baseUrl: client.iframeBaseUrl || "",
      rateLimitPerMinute: 1000,
      tokenExpiryHours: 24,
      corsAllowedOrigins: client.allowedOrigins,
      endpoints: [],
    }),
    setTenantSetting(client.appId, "webhookConfig", buildWebhookConfigPayload(client, await getTenantSetting(client.appId, "webhookConfig", {}))),
    setTenantSetting(client.appId, "iframeConfig", {
      baseUrl: client.iframeBaseUrl || "",
      defaultWidth: "100%",
      height: 680,
      allowedParentDomains: client.iframeAllowedParentDomains,
      ssoParameterName: "sso",
      allowFullscreen: true,
      autoResize: true,
      blockRightClick: false,
    }),
  ]);
  await syncClientMetrics(client.appId);
  return ok(res, "Client settings updated successfully.", await toClientRecord(client.toObject()));
};

const testWebhook = async (req, res) => {
  const client = await Client.findOne({ appId: req.params.id });

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  const currentConfig = buildWebhookConfigPayload(client, await getTenantSetting(client.appId, "webhookConfig", {}));

  if (!currentConfig.url || !isValidUrl(currentConfig.url)) {
    return fail(res, 400, "Configure a valid webhook URL before testing.");
  }

  const result = await sendWebhookTest(currentConfig, client);
  const nextConfig = {
    ...currentConfig,
    logs: appendWebhookLog(currentConfig, result.log),
  };

  client.lastWebhookTestAt = result.checkedAt;
  client.lastWebhookTestStatus = result.status;
  client.lastWebhookTestMessage = result.message;
  await client.save();
  await setTenantSetting(client.appId, "webhookConfig", nextConfig);

  await notifyRolesInClient({
    clientId: client.appId,
    roles: ["admin"],
    payload: {
      title: result.status === "success" ? "Webhook test passed" : "Webhook test failed",
      message: result.message,
      category: "integrations",
      severity: result.status === "success" ? "success" : "warning",
      link: "/webhooks",
      actorName: req.user?.fullname || req.user?.name || "",
    },
  });

  return ok(res, result.message, {
    client: await toClientRecord(client.toObject()),
    result,
    configuration: nextConfig,
  });
};

const verifyDomain = async (req, res) => {
  const client = await Client.findOne({ appId: req.params.id });

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  if (!client.domain) {
    return fail(res, 400, "Add a custom domain before running verification.");
  }

  const result = await verifyDomainRecord(client.domain, client.domainVerificationToken, client.domainVerificationHost);
  client.domainLastCheckedAt = result.checkedAt;
  client.domainLastCheckedResult = result.details || result.message;
  client.domainStatus = result.success ? "verified" : "pending";
  client.domainVerifiedAt = result.success ? result.checkedAt : client.domainVerifiedAt || "";
  await client.save();

  await notifyRolesInClient({
    clientId: client.appId,
    roles: ["admin"],
    payload: {
      title: result.success ? "Domain verified" : "Domain verification pending",
      message: result.message,
      category: "settings",
      severity: result.success ? "success" : "warning",
      link: `/clients/${client.appId}`,
      actorName: req.user?.fullname || req.user?.name || "",
    },
  });

  return ok(res, result.message, {
    client: await toClientRecord(client.toObject()),
    result,
  });
};

const testSmtp = async (req, res) => {
  const client = await Client.findOne({ appId: req.params.id });

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  const recipient = String(req.body.recipient || client.smtpTestRecipient || client.firstUserEmail || "").trim();

  if (!recipient) {
    return fail(res, 400, "Add a test recipient email before sending SMTP test mail.", {
      recipient: "Test recipient is required.",
    });
  }

  const result = await sendSmtpTestEmail(client, recipient);
  client.smtpTestRecipient = recipient;
  client.lastSmtpTestAt = result.checkedAt;
  client.lastSmtpTestStatus = result.status;
  client.lastSmtpTestMessage = result.message;
  await client.save();

  await notifyRolesInClient({
    clientId: client.appId,
    roles: ["admin"],
    payload: {
      title: result.status === "success" ? "SMTP test sent" : "SMTP test failed",
      message: result.message,
      category: "settings",
      severity: result.status === "success" ? "success" : "warning",
      link: `/clients/${client.appId}`,
      actorName: req.user?.fullname || req.user?.name || "",
    },
  });

  return ok(res, result.message, {
    client: await toClientRecord(client.toObject()),
    result,
  });
};

const sendClientAdminPasswordEmail = async (req, res) => {
  const client = await Client.findOne({ appId: req.params.id });

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  const clientAdminUser = await User.findOne({ appId: client.clientAdminUserId, clientId: client.appId });

  if (!clientAdminUser) {
    return fail(res, 404, "Client admin user not found.");
  }

  const result = await issuePasswordEmail({
    req,
    user: clientAdminUser,
    purpose: clientAdminUser.isActivated === false ? "set_password" : "reset_password",
    forcePlatform: true,
    createdBy: req.user?.appId || "",
  });

  if (!result.emailResult.success) {
    return fail(res, 500, "Client admin password email could not be sent.", result.emailResult);
  }

  return ok(res, "Client admin password email sent successfully.", {
    expiresAt: result.expiresAt,
    email: clientAdminUser.email,
  });
};

module.exports = {
  list,
  create,
  getOne,
  update,
  remove,
  updateSettings,
  testWebhook,
  verifyDomain,
  testSmtp,
  sendClientAdminPasswordEmail,
};
