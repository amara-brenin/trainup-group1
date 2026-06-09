const Client = require("../models/Client");
const Setting = require("../models/Setting");
const Training = require("../models/Training");
const User = require("../models/User");
const config = require("../config");
const { buildDashboard } = require("../helpers/seed");
const {
  buildWebhookConfigPayload,
  appendWebhookLog,
  sendWebhookTest,
  verifyDomainRecord,
  sendSmtpTestEmail,
} = require("../helpers/clientDelivery");
const { sanitizeUserForClient } = require("../helpers/auth");
const {
  CREDIT_COSTS,
  PLAN_CONFIGS,
  applyPlanToClient,
  buildClientCreditSnapshot,
  createTransactionEntry,
  getFreeTrialMeta,
  getPlanChargeAmount,
} = require("../helpers/credits");
const { notifyRolesInClient, notifySuperAdmins } = require("../helpers/notifications");
const { ok, fail } = require("../helpers/response");
const { isValidUrl, ensureArray } = require("../helpers/validation");
const { getTenantClientId, getTenantSetting, setTenantSetting, syncClientMetrics } = require("../helpers/tenant");

const buildMonthlyBillingDates = (client) => {
  const transactions = Array.isArray(client?.creditTransactions) ? client.creditTransactions : [];
  const sourceDate =
    transactions.find((item) => item?.type === "plan_assignment")?.createdAt ||
    client?.createdAt ||
    client?.updatedAt ||
    new Date().toISOString();

  const startedOn = new Date(sourceDate);
  if (Number.isNaN(startedOn.getTime())) {
    const fallback = new Date();
    const expires = new Date(fallback);
    expires.setMonth(expires.getMonth() + 1);
    return {
      startedOn: fallback.toISOString(),
      expiresOn: expires.toISOString(),
    };
  }

  const expiresOn = new Date(startedOn);
  expiresOn.setMonth(expiresOn.getMonth() + 1);

  return {
    startedOn: startedOn.toISOString(),
    expiresOn: expiresOn.toISOString(),
  };
};

const getCountFromReason = (reason) => {
  const match = String(reason || "").match(/^(\d+)/);
  return match ? Math.max(1, Number(match[1])) : 1;
};

const buildPlanUsage = (client, billingDates) => {
  const transactions = Array.isArray(client?.creditTransactions) ? client.creditTransactions : [];
  const start = new Date(billingDates.startedOn || new Date().toISOString());
  const end = new Date(billingDates.expiresOn || new Date().toISOString());

  return transactions.reduce(
    (totals, transaction) => {
      const createdAt = new Date(transaction?.createdAt || "");
      const reason = String(transaction?.reason || transaction?.note || "");

      if (
        transaction?.type !== "debit" ||
        Number.isNaN(createdAt.getTime()) ||
        createdAt < start ||
        createdAt > end
      ) {
        return totals;
      }

      if (reason.includes("training slot")) {
        totals.trainings += getCountFromReason(reason);
      } else if (reason.startsWith("User seat created")) {
        totals.users += 1;
      } else if (reason.startsWith("Training session completed")) {
        totals.sessions += 1;
      }

      return totals;
    },
    {
      trainings: 0,
      users: 0,
      sessions: 0,
    },
  );
};

const getConfigValue = async (key) => {
  const record = await Setting.findOne({ key }).lean();
  return record ? record.value : null;
};

const setConfigValue = async (key, value) => {
  await Setting.updateOne(
    { key },
    {
      $set: {
        key,
        value,
      },
    },
    { upsert: true },
  );
};

const toClientRecord = (client) => ({
  id: client.appId,
  name: client.name,
  industry: client.industry,
  plan: client.plan,
  status: client.status,
  domain: client.domain,
  domainStatus: client.domainStatus,
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
  primaryColor: client.primaryColor,
  secondaryColor: client.secondaryColor,
  supportEmail: client.supportEmail,
  allowedOrigins: client.allowedOrigins || [],
  webhookUrl: client.webhookUrl,
  apiScope: client.apiScope,
});

const getBillingAmount = (credits) => Math.max(99, Math.round(Number(credits || 0) * 0.5));

const buildDemoBillingTransactions = (client) => [
  {
    ...createTransactionEntry("plan_purchase", PLAN_CONFIGS.FREE.monthlyCredits, "Free plan activated"),
    amount: 0,
    currency: client.billingCurrency || "INR",
    status: "captured",
    invoiceId: "INV-DEMO-FREE-001",
    orderId: "order_demo_free_001",
    receipt: "rcpt_demo_free_001",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString(),
    reason: "Free plan trial activated",
    planCode: "FREE",
  },
  {
    ...createTransactionEntry("plan_purchase", PLAN_CONFIGS.PRO.monthlyCredits, "Pro plan upgraded"),
    amount: PLAN_CONFIGS.PRO.monthlyPrice,
    currency: client.billingCurrency || "INR",
    status: "captured",
    invoiceId: "INV-DEMO-PRO-001",
    orderId: "order_demo_pro_001",
    receipt: "rcpt_demo_pro_001",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    reason: "Pro plan purchased in sandbox mode",
    planCode: "PRO",
  },
];

const buildPlanCatalog = (client) =>
  Object.values(PLAN_CONFIGS).map((plan) => ({
    code: plan.code,
    label: plan.label,
    monthlyCredits:
      plan.code === "ENTERPRISE"
        ? Math.max(0, Number(client?.enterpriseMonthlyCredits || 0)) || PLAN_CONFIGS.PRO.monthlyCredits
        : plan.monthlyCredits,
    limits: plan.limits,
    contactSales: plan.contactSales,
    monthlyPrice:
      plan.code === "ENTERPRISE" ? Math.max(0, Number(client?.enterpriseMonthlyPrice || 0)) : plan.monthlyPrice,
    firstMonthPrice: plan.firstMonthPrice,
    trialDays: plan.trialDays,
  }));

const buildBillingSummaryResponse = (client, metrics = null) => {
  const snapshot = buildClientCreditSnapshot(client);
  const billingDates = buildMonthlyBillingDates(client);
  const storedUsage = buildPlanUsage(client, billingDates);
  const planUsage = {
    trainings: Number(metrics?.trainings ?? client.trainings ?? storedUsage.trainings ?? 0),
    users: Number(metrics?.activeUsers ?? client.activeUsers ?? storedUsage.users ?? 0),
    sessions: Number(metrics?.sessions ?? client.sessions ?? storedUsage.sessions ?? 0),
  };
  const freeTrial = getFreeTrialMeta(client);

  return {
    currentPlan: snapshot.plan,
    billingCycle: snapshot.billingCycle,
    planStatus: client.status === "inactive" || snapshot.availableCredits <= 0 ? "expired" : "active",
    startedOn: billingDates.startedOn,
    expiresOn: billingDates.expiresOn,
    planUsage,
    activeUsers: planUsage.users,
    trainings: planUsage.trainings,
    sessions: planUsage.sessions,
    usedCredits: snapshot.usedCredits,
    totalCredits: snapshot.totalCredits,
    availableCredits: snapshot.availableCredits,
    monthlyCredits: snapshot.monthlyCredits,
    purchasedCredits: snapshot.purchasedCredits,
    costPerTraining: CREDIT_COSTS.training,
    costPerUser: CREDIT_COSTS.user,
    costPerSession: CREDIT_COSTS.session,
    paymentProvider: client.paymentProvider || "razorpay",
    paymentMode: client.paymentMode || "test",
    billingCurrency: client.billingCurrency || "INR",
    razorpayKeyId: client.razorpayKeyId || "",
    gatewayReady: Boolean(client.razorpayKeyId && client.razorpayKeySecret),
    planLimits: snapshot.planConfig.limits,
    planPrice: getPlanChargeAmount(client, snapshot.plan),
    freeTrialActive: freeTrial.active,
    freeTrialEndsOn: freeTrial.endsAt,
    enterpriseMonthlyPrice: Math.max(0, Number(client.enterpriseMonthlyPrice || 0)),
    enterpriseMonthlyCredits: Math.max(0, Number(client.enterpriseMonthlyCredits || 0)) || PLAN_CONFIGS.PRO.monthlyCredits,
    pendingEnterpriseRequests: Array.isArray(client.enterpriseRequests)
      ? client.enterpriseRequests.filter((item) => item?.status === "pending").length
      : 0,
    planCatalog: buildPlanCatalog(client),
    recentTransactions:
      Array.isArray(client.creditTransactions) && client.creditTransactions.length
        ? client.creditTransactions.slice(0, 8)
        : buildDemoBillingTransactions(client),
  };
};

const dashboard = async (req, res) => {
  const clientRecords = (await Client.find({}).sort({ appId: 1 }).lean()).map(toClientRecord);
  const clientId = getTenantClientId(req.user);
  const webhookConfig = clientId ? await getTenantSetting(clientId, "webhookConfig", {}) : await getConfigValue("webhookConfig");
  const currentClient = clientId ? clientRecords.find((client) => client.id === clientId) || null : null;
  const [tenantUsers, trainingRecords] = await Promise.all([
    clientId
      ? User.find({ clientId, role: { $ne: "super_admin" } }).lean()
      : User.find({ role: { $ne: "super_admin" } }).lean(),
    clientId
      ? Training.find({ clientId }).lean()
      : Training.find({}).lean(),
  ]);
  return ok(
    res,
    "Dashboard loaded.",
    buildDashboard({
      clients: clientRecords,
      currentClient,
      webhookConfig,
      tenantUsers: tenantUsers.map((user) => sanitizeUserForClient(user)),
      trainingRecords,
      session: sanitizeUserForClient(req.user),
    }),
  );
};

const getApiConfig = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const client = clientId ? await Client.findOne({ appId: clientId }).lean() : null;
  const data = clientId
    ? await getTenantSetting(clientId, "apiConfig", {
        baseUrl: client?.iframeBaseUrl || "",
        rateLimitPerMinute: 1000,
        tokenExpiryHours: 24,
        corsAllowedOrigins: client?.allowedOrigins || [],
        endpoints: [],
      })
    : await getConfigValue("apiConfig");
  return ok(res, "API configuration loaded.", data);
};

const updateApiConfig = async (req, res) => {
  if (!isValidUrl(req.body.baseUrl)) {
    return fail(res, 400, "Please correct the highlighted fields.", {
      baseUrl: "Use a valid API base URL.",
    });
  }

  const clientId = getTenantClientId(req.user);
  const current = clientId ? (await getTenantSetting(clientId, "apiConfig", {})) || {} : (await getConfigValue("apiConfig")) || {};
  const nextValue = {
    baseUrl: String(req.body.baseUrl),
    rateLimitPerMinute: Number(req.body.rateLimitPerMinute || 0),
    tokenExpiryHours: Number(req.body.tokenExpiryHours || 0),
    corsAllowedOrigins: ensureArray(req.body.corsAllowedOrigins),
    endpoints: current.endpoints || [],
  };

  if (clientId) {
    await setTenantSetting(clientId, "apiConfig", nextValue);
    await Client.updateOne(
      { appId: clientId },
      {
        $set: {
          allowedOrigins: nextValue.corsAllowedOrigins,
          apiScope: current.apiScope || "",
        },
      },
    );
  } else {
    await setConfigValue("apiConfig", nextValue);
  }
  return ok(res, "API configuration updated successfully.", nextValue);
};

const getWebhooks = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const client = clientId ? await Client.findOne({ appId: clientId }).lean() : null;
  const data = clientId
    ? buildWebhookConfigPayload(client, await getTenantSetting(clientId, "webhookConfig", (await getConfigValue("webhookConfig")) || {}))
    : await getConfigValue("webhookConfig");
  return ok(res, "Webhook configuration loaded.", data);
};

const updateWebhooks = async (req, res) => {
  if (!isValidUrl(req.body.url)) {
    return fail(res, 400, "Please correct the highlighted fields.", {
      url: "Use a valid webhook URL.",
    });
  }

  const clientId = getTenantClientId(req.user);
  if (clientId) {
    const currentConfig = await getTenantSetting(clientId, "webhookConfig", {});
    const nextConfig = {
      ...buildWebhookConfigPayload({ webhookUrl: req.body.url }, currentConfig),
      ...req.body,
      logs: Array.isArray(currentConfig?.logs) ? currentConfig.logs : [],
    };
    await setTenantSetting(clientId, "webhookConfig", nextConfig);
    await Client.updateOne(
      { appId: clientId },
      {
        $set: {
          webhookUrl: String(req.body.url || ""),
        },
      },
    );
    return ok(res, "Webhook configuration updated successfully.", nextConfig);
  } else {
    await setConfigValue("webhookConfig", req.body);
  }
  return ok(res, "Webhook configuration updated successfully.", req.body);
};

const testWebhooks = async (req, res) => {
  const clientId = getTenantClientId(req.user);

  if (!clientId) {
    return fail(res, 403, "Webhook testing is available only for tenant admins.");
  }

  const client = await Client.findOne({ appId: clientId });

  if (!client) {
    return fail(res, 404, "Client configuration not found.");
  }

  const currentConfig = buildWebhookConfigPayload(
    client,
    await getTenantSetting(clientId, "webhookConfig", (await getConfigValue("webhookConfig")) || {}),
  );

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
  await setTenantSetting(clientId, "webhookConfig", nextConfig);

  await notifyRolesInClient({
    clientId,
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
    ...result,
    configuration: nextConfig,
  });
};

const getIframe = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const client = clientId ? await Client.findOne({ appId: clientId }).lean() : null;
  const data = clientId
    ? await getTenantSetting(clientId, "iframeConfig", {
        baseUrl: client?.iframeBaseUrl || "",
        defaultWidth: "100%",
        height: 680,
        allowedParentDomains: client?.iframeAllowedParentDomains || [],
        ssoParameterName: "sso",
        allowFullscreen: true,
        autoResize: true,
        blockRightClick: false,
      })
    : await getConfigValue("iframeConfig");
  return ok(res, "iFrame configuration loaded.", data);
};

const updateIframe = async (req, res) => {
  if (!isValidUrl(req.body.baseUrl)) {
    return fail(res, 400, "Please correct the highlighted fields.", {
      baseUrl: "Use a valid embed URL.",
    });
  }

  const nextValue = {
    baseUrl: String(req.body.baseUrl),
    defaultWidth: String(req.body.defaultWidth || "100%"),
    height: Number(req.body.height || 0),
    allowedParentDomains: ensureArray(req.body.allowedParentDomains),
    ssoParameterName: String(req.body.ssoParameterName || "sso"),
    allowFullscreen: Boolean(req.body.allowFullscreen),
    autoResize: Boolean(req.body.autoResize),
    blockRightClick: Boolean(req.body.blockRightClick),
  };

  const clientId = getTenantClientId(req.user);
  if (clientId) {
    await setTenantSetting(clientId, "iframeConfig", nextValue);
    await Client.updateOne(
      { appId: clientId },
      {
        $set: {
          iframeBaseUrl: nextValue.baseUrl,
          iframeAllowedParentDomains: nextValue.allowedParentDomains,
          iframeEnabled: true,
        },
      },
    );
  } else {
    await setConfigValue("iframeConfig", nextValue);
  }
  return ok(res, "iFrame settings updated successfully.", nextValue);
};

const health = async (_req, res) =>
  ok(res, "Backend health loaded.", {
    status: "ok",
    service: "trainup-backend",
    apiPrefix: config.apiPrefix,
  });

const getBillingSummary = async (req, res) => {
  const clientId = getTenantClientId(req.user);

  if (!clientId) {
    return fail(res, 403, "Billing summary is available only for tenant admins.");
  }

  const metrics = await syncClientMetrics(clientId);
  const client = await Client.findOne({ appId: clientId }).lean();

  if (!client) {
    return fail(res, 404, "Client billing profile not found.");
  }

  return ok(res, "Billing summary loaded.", buildBillingSummaryResponse(client, metrics));
};

const purchaseCredits = async (req, res) => {
  const clientId = getTenantClientId(req.user);

  if (!clientId) {
    return fail(res, 403, "Credit purchase is available only for tenant admins.");
  }

  const client = await Client.findOne({ appId: clientId });

  if (!client) {
    return fail(res, 404, "Client billing profile not found.");
  }

  if (String(client.paymentMode || "test") !== "test") {
    return fail(res, 400, "Live billing is disabled in this environment. Switch the client back to test mode first.");
  }

  const planCode = String(req.body.planCode || "").trim().toUpperCase();
  const credits = Math.max(0, Number(req.body.credits || 0));
  const billingType = planCode ? "plan" : "credits";
  const snapshot = buildClientCreditSnapshot(client);
  const createdAt = new Date().toISOString();
  const orderId = `order_test_${Date.now()}`;
  const invoiceId = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
  const receipt = `rcpt_${client.appId}_${Date.now()}`;
  client.creditTransactions = Array.isArray(client.creditTransactions) ? client.creditTransactions : [];

  if (billingType === "plan") {
    if (!planCode || !["FREE", "PRO"].includes(planCode)) {
      return fail(res, 400, "Only Free and Pro plans can be checked out directly.");
    }

    const amount = getPlanChargeAmount(client, planCode);
    const nextSnapshot = applyPlanToClient(client, planCode, {
      resetUsage: false,
      resetPurchasedCredits: false,
      carryAvailableCredits: true,
    });

    client.creditTransactions.unshift({
      ...createTransactionEntry("plan_purchase", nextSnapshot.monthlyCredits, "Razorpay test plan checkout approved"),
      amount,
      currency: client.billingCurrency || "INR",
      status: "captured",
      invoiceId,
      orderId,
      receipt,
      createdAt,
      reason:
        planCode === "FREE" && getFreeTrialMeta(client).active
          ? "Free plan trial activated in sandbox mode"
          : `${planCode} plan purchased in sandbox mode`,
      planCode,
    });
    client.creditTransactions = client.creditTransactions.slice(0, 25);
    await client.save();

    await notifyRolesInClient({
      clientId,
      roles: ["admin", "trainer", "reviewer"],
      payload: {
        title: "Plan updated",
        message: `${planCode} plan checkout completed successfully for your company.`,
        category: "billing",
        severity: "success",
        link: "/upgrade-billings",
        actorName: req.user?.fullname || req.user?.name || "",
      },
    });

    return ok(res, "Razorpay sandbox checkout completed successfully.", buildBillingSummaryResponse(client));
  }

  if (!credits) {
    return fail(res, 400, "Select a valid credit pack.");
  }

  const amount = getBillingAmount(credits);
  client.purchasedCredits = snapshot.purchasedCredits + credits;
  client.totalCredits = snapshot.totalCredits + credits;
  client.monthlyCredits = snapshot.monthlyCredits;
  client.usedCredits = snapshot.usedCredits;
  client.billingCycle = "monthly";
  client.creditTransactions.unshift({
    ...createTransactionEntry("credit_purchase", credits, "Razorpay test checkout approved"),
    amount,
    currency: client.billingCurrency || "INR",
    status: "captured",
    invoiceId,
    orderId,
    receipt,
    createdAt,
    reason: `Purchased ${credits} credits in sandbox mode`,
  });
  client.creditTransactions = client.creditTransactions.slice(0, 25);
  await client.save();

  await notifyRolesInClient({
    clientId,
    roles: ["admin"],
    payload: {
      title: "Credits purchased",
      message: `${credits.toLocaleString()} credits were added through sandbox checkout.`,
      category: "billing",
      severity: "success",
      link: "/upgrade-billings",
      actorName: req.user?.fullname || req.user?.name || "",
    },
  });

  return ok(res, "Razorpay sandbox purchase completed successfully.", buildBillingSummaryResponse(client));
};

const requestEnterprisePlan = async (req, res) => {
  const clientId = getTenantClientId(req.user);

  if (!clientId) {
    return fail(res, 403, "Enterprise upgrade request is available only for tenant admins.");
  }

  const client = await Client.findOne({ appId: clientId });

  if (!client) {
    return fail(res, 404, "Client billing profile not found.");
  }

  const message = String(req.body.message || "").trim();

  if (!message) {
    return fail(res, 400, "Please add your support request details.", {
      message: "Support query is required.",
    });
  }

  client.enterpriseRequests = Array.isArray(client.enterpriseRequests) ? client.enterpriseRequests : [];
  client.enterpriseRequests.unshift({
    id: `enterprise-request-${Date.now()}`,
    requestedAt: new Date().toISOString(),
    requestedByName: req.user.fullname || req.user.name,
    requestedByEmail: req.user.email,
    message,
    status: "pending",
  });
  client.enterpriseRequests = client.enterpriseRequests.slice(0, 25);
  await client.save();

  await Promise.all([
    notifyRolesInClient({
      clientId,
      roles: ["admin"],
      payload: {
        title: "Enterprise request submitted",
        message: "Your custom pricing query has been shared with the platform team.",
        category: "billing",
        severity: "info",
        link: "/upgrade-billings",
        actorName: req.user?.fullname || req.user?.name || "",
      },
    }),
    notifySuperAdmins({
      title: "Enterprise upgrade request",
      message: `${client.name} requested enterprise pricing support.`,
      category: "billing",
      severity: "warning",
      link: `/clients/${client.appId}`,
      actorName: req.user?.fullname || req.user?.name || "",
      metadata: {
        clientId: client.appId,
      },
    }),
  ]);

  return ok(res, "Enterprise support query submitted successfully.", buildBillingSummaryResponse(client));
};

const testSmtp = async (req, res) => {
  const clientId = getTenantClientId(req.user);

  if (!clientId) {
    return fail(res, 403, "SMTP testing is available only for tenant admins.");
  }

  const client = await Client.findOne({ appId: clientId });

  if (!client) {
    return fail(res, 404, "Client configuration not found.");
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
    clientId,
    roles: ["admin"],
    payload: {
      title: result.status === "success" ? "SMTP test sent" : "SMTP test failed",
      message: result.message,
      category: "settings",
      severity: result.status === "success" ? "success" : "warning",
      link: "/settings",
      actorName: req.user?.fullname || req.user?.name || "",
    },
  });

  return ok(res, result.message, result);
};

const verifyDomain = async (req, res) => {
  const clientId = getTenantClientId(req.user);

  if (!clientId) {
    return fail(res, 403, "Domain verification is available only for tenant admins.");
  }

  const client = await Client.findOne({ appId: clientId });

  if (!client) {
    return fail(res, 404, "Client configuration not found.");
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
    clientId,
    roles: ["admin"],
    payload: {
      title: result.success ? "Domain verified" : "Domain verification pending",
      message: result.message,
      category: "settings",
      severity: result.success ? "success" : "warning",
      link: "/settings",
      actorName: req.user?.fullname || req.user?.name || "",
    },
  });

  return ok(res, result.message, result);
};

module.exports = {
  dashboard,
  getApiConfig,
  updateApiConfig,
  getWebhooks,
  updateWebhooks,
  testWebhooks,
  getIframe,
  updateIframe,
  health,
  getBillingSummary,
  purchaseCredits,
  requestEnterprisePlan,
  testSmtp,
  verifyDomain,
};
