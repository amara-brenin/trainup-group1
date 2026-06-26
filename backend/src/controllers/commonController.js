const Client = require("../models/Client");
const CreditAuditLog = require("../models/CreditAuditLog");
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
const { buildXapiStatement, sendXapiStatement } = require("../helpers/xapi");
const crypto = require("crypto");
const {
  CREDIT_COSTS,
  PLAN_CONFIGS,
  applyPlanToClient,
  applyPlanSnapshot,
  resolvePlan,
  buildClientCreditSnapshot,
  createTransactionEntry,
  getFreeTrialMeta,
  getPlanChargeAmount,
  consumeClientCredits,
  getClientEntitlement,
  ensureClientEntitlement,
  ADDON_CREDIT_UNIT,
  ADDON_MONEY_UNIT,
  applyAddonQuota,
} = require("../helpers/credits");
const Plan = require("../models/Plan");
const AddonPurchaseLog = require("../models/AddonPurchaseLog");
const { notifyRolesInClient, notifySuperAdmins } = require("../helpers/notifications");
const { ok, fail } = require("../helpers/response");
const { isValidUrl, ensureArray } = require("../helpers/validation");
const { getTenantClientId, getTenantSetting, setTenantSetting } = require("../helpers/tenant");

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

const CLIENT_HEAVY_EXCLUSION = { logoUrl: 0, darkLogoUrl: 0, faviconUrl: 0, emailSignatureImageUrl: 0 };

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
    // Issue 1: surface expiry explicitly so the dashboard can show the badge /
    // "Plan Expired" / Remaining Credits = 0.
    planExpired: snapshot.planExpired,
    planStatus:
      client.status === "inactive" || snapshot.planExpired || snapshot.availableCredits <= 0
        ? "expired"
        : "active",
    startedOn: billingDates.startedOn,
    expiresOn: snapshot.expiresOn || billingDates.expiresOn,
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
  const clientId = getTenantClientId(req.user);
  const isSuperAdmin = req.user?.role === "super_admin";

  const clientFilter = clientId ? { appId: clientId } : {};
  const userFilter = clientId
    ? { clientId, role: { $ne: "super_admin" } }
    : { role: { $ne: "super_admin" } };
  const trainingFilter = clientId ? { clientId } : {};
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));

  const [
    webhookConfig,
    currentClient,
    clientCount,
    activeClientCount,
    totalUserCount,
    internalUserCount,
    traineeCount,
    trainingCount,
    sessionAgg,
  ] = await Promise.all([
    clientId ? getTenantSetting(clientId, "webhookConfig", {}) : getConfigValue("webhookConfig"),
    clientId ? Client.findOne({ appId: clientId }, CLIENT_HEAVY_EXCLUSION).lean().then((c) => c ? toClientRecord(c) : null) : null,
    isSuperAdmin ? Client.countDocuments() : Promise.resolve(0),
    isSuperAdmin ? Client.countDocuments({ status: "active" }) : Promise.resolve(0),
    User.countDocuments(userFilter),
    User.countDocuments(clientId ? { clientId, role: { $nin: ["super_admin", "trainee"] } } : { role: { $nin: ["super_admin", "trainee"] } }),
    User.countDocuments(clientId ? { clientId, role: "trainee" } : { role: "trainee" }),
    Training.countDocuments(trainingFilter),
    // Optimized: count sessions per-document with $size/$filter instead of
    // $unwind (which explodes one row per embedded session before regrouping).
    // Output keys are identical: totalSessions, activeSessions, completionsToday.
    Training.aggregate([
      { $match: trainingFilter },
      { $project: { sessions: { $ifNull: ["$payload.sessions", []] } } },
      {
        $project: {
          totalSessions: { $size: "$sessions" },
          activeSessions: {
            $size: {
              $filter: {
                input: "$sessions",
                as: "s",
                cond: { $eq: [{ $toLower: { $ifNull: ["$$s.status", ""] } }, "in-progress"] },
              },
            },
          },
          completionsToday: {
            $size: {
              $filter: {
                input: "$sessions",
                as: "s",
                cond: {
                  $and: [
                    { $eq: [{ $toLower: { $ifNull: ["$$s.status", ""] } }, "completed"] },
                    { $gte: [{ $toDate: { $ifNull: ["$$s.completedAt", "1970-01-01"] } }, startOfToday] },
                  ],
                },
              },
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          totalSessions: { $sum: "$totalSessions" },
          activeSessions: { $sum: "$activeSessions" },
          completionsToday: { $sum: "$completionsToday" },
        },
      },
    ]),
  ]);

  const snap = sessionAgg[0] || { totalSessions: 0, activeSessions: 0, completionsToday: 0 };
  const combinedSessions = snap.activeSessions + snap.completionsToday;

  return ok(
    res,
    "Dashboard loaded.",
    buildDashboard({
      clients: isSuperAdmin
        ? [{ length: clientCount, activeCount: activeClientCount }]
        : [],
      currentClient,
      webhookConfig,
      tenantUsers: [],
      trainingRecords: [],
      session: sanitizeUserForClient(req.user),
      counts: {
        clientCount,
        activeClientCount,
        totalUserCount,
        internalUserCount,
        traineeCount,
        trainingCount,
        sessionSnapshot: snap,
        combinedSessions,
      },
    }),
  );
};

const getApiConfig = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const client = clientId ? await Client.findOne({ appId: clientId }, CLIENT_HEAVY_EXCLUSION).lean() : null;
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
  const client = clientId ? await Client.findOne({ appId: clientId }, CLIENT_HEAVY_EXCLUSION).lean() : null;
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

const testXapi = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  if (!clientId) {
    return fail(res, 403, "xAPI testing is available only for tenant admins.");
  }
  const client = await Client.findOne({ appId: clientId });
  if (!client) {
    return fail(res, 404, "Client configuration not found.");
  }
  const endpoint = String(client.xapiLrsEndpoint || "").trim();
  if (!endpoint) {
    return fail(res, 400, "Configure the LRS endpoint URL before testing.");
  }

  const statement = buildXapiStatement({
    baseUrl: client.domain ? `https://${client.domain}` : "https://trainup.ai",
    clientName: client.name,
    training: { id: "demo-training", title: "xAPI Test Training" },
    learner: { id: "demo-learner", name: "Demo Learner", email: client.firstUserEmail || "demo@trainup.ai" },
    session: { score: 90, timeSpentSeconds: 120 },
  });

  const result = await sendXapiStatement(
    { endpoint, clientId: client.xapiClientId, clientSecret: client.xapiClientSecret },
    statement,
  );

  const currentConfig = await getTenantSetting(clientId, "webhookConfig", {});
  await setTenantSetting(clientId, "webhookConfig", {
    ...currentConfig,
    logs: appendWebhookLog(currentConfig, result.log),
  });

  return ok(res, result.message, result);
};

const getIframe = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const client = clientId ? await Client.findOne({ appId: clientId }, CLIENT_HEAVY_EXCLUSION).lean() : null;
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

  // Metrics (activeUsers/trainings/sessions) are kept current incrementally —
  // every user/training mutation already calls syncClientMetrics(clientId).
  // Recomputing them here on every page load required a full, unprojected
  // Training.find({clientId}) read; read the already-synced values off the
  // client document instead (buildBillingSummaryResponse already falls back
  // to client.trainings/activeUsers/sessions when no metrics are passed).
  const client = await Client.findOne({ appId: clientId }, CLIENT_HEAVY_EXCLUSION).lean();

  if (!client) {
    return fail(res, 404, "Client billing profile not found.");
  }

  return ok(res, "Billing summary loaded.", buildBillingSummaryResponse(client));
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
    // Phase C: freeze the entitlement snapshot from the (DB) plan at purchase
    // time so future plan edits never change this subscriber's limits/credits.
    // Renewal/new billing cycle → reset lifetime usage so full quota is restored.
    await applyPlanSnapshot(client, planCode, { resetLifetime: true });

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

  // Task 3: audit the purchase (this branch adds credits directly, not via the
  // addClientCredits helper, so log it explicitly here).
  await CreditAuditLog.create({
    clientId,
    actionType: "credit_purchase",
    entityType: "credit",
    entityId: orderId,
    creditChange: credits,
    balanceBefore: snapshot.availableCredits,
    balanceAfter: buildClientCreditSnapshot(client).availableCredits,
    performedBy: req.user?.fullname || req.user?.name || req.user?.email || "",
    reason: `Purchased ${credits} credits`,
    reference: invoiceId,
  }).catch(() => undefined);

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

// Phase C: plan catalog for the Upgrade & Billing cards — DB-driven, falls back
// to PLAN_CONFIGS when the Plan collection is empty (no hardcoded values once seeded).
const getBillingPlans = async (_req, res) => {
  let rows = await Plan.find({ active: true }).sort({ monthlyPrice: 1 }).lean();
  if (!rows.length) {
    rows = Object.values(PLAN_CONFIGS).map((cfg) => ({
      code: cfg.code, name: cfg.label, monthlyPrice: cfg.monthlyPrice, yearlyPrice: cfg.monthlyPrice * 10,
      credits: cfg.monthlyCredits, trainingLimit: cfg.limits.trainings ?? null,
      sessionLimit: cfg.limits.sessions ?? null, userLimit: cfg.limits.users ?? null,
      features: [],
    }));
  }
  return ok(res, "Plans loaded.", {
    record: rows.map((r) => ({
      code: r.code, name: r.name, monthlyPrice: r.monthlyPrice, yearlyPrice: r.yearlyPrice,
      credits: r.credits, trainingLimit: r.trainingLimit, sessionLimit: r.sessionLimit,
      userLimit: r.userLimit, features: r.features || [],
    })),
  });
};

// Phase D: usage panel shape from the entitlement (base + purchased − used).
const usageView = (client) => {
  const ent = getClientEntitlement(client);
  const r = (k) => ({
    limit: ent[k].unlimited ? null : ent[k].limit,
    used: ent[k].usedLifetime,
    remaining: ent[k].unlimited ? null : ent[k].remaining,
    unlimited: ent[k].unlimited,
    purchased: ent[k].purchased,
  });
  return { training: r("training"), session: r("session"), user: r("user") };
};

const ADDON_TYPES = ["training", "session", "user"];

// POST /billing/addons/purchase
//  credits:  { type, quantity, purchaseMethod:"credits", idempotencyKey }
//  razorpay: { type, quantity, purchaseMethod:"razorpay", action:"create-order" }
//            { ..., action:"verify", razorpay_order_id, razorpay_payment_id, razorpay_signature }
const purchaseAddon = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const client = await Client.findOne({ appId: clientId });
  if (!client) return fail(res, 404, "Client not found.");

  const type = String(req.body.type || "").toLowerCase();
  if (!ADDON_TYPES.includes(type)) return fail(res, 400, "Invalid add-on type.");
  const quantity = Math.max(0, Math.floor(Number(req.body.quantity || 0)));
  if (!quantity) return fail(res, 400, "Quantity must be greater than zero.");
  const method = String(req.body.purchaseMethod || "credits").toLowerCase();
  const performedBy = req.user?.fullname || req.user?.name || req.user?.email || "";

  if (!client.quotaInitialized) {
    const publishedCount = await Training.countDocuments({ clientId, "payload.status": "approved" });
    await ensureClientEntitlement(client, {
      training: publishedCount, session: Number(client.sessions || 0), user: Number(client.activeUsers || 0),
    });
  }

  if (method === "credits") {
    const idempotencyKey = String(req.body.idempotencyKey || "").trim();
    if (idempotencyKey) {
      const existing = await AddonPurchaseLog.findOne({ idempotencyKey }).lean();
      if (existing) {
        const freshClient = await Client.findOne({ appId: clientId });
        return ok(res, `Added +${existing.quantity} ${existing.type} capacity using credits.`, { usage: usageView(freshClient || client) });
      }
    }

    const unit = ADDON_CREDIT_UNIT[type];
    const total = unit * quantity;
    const result = await consumeClientCredits({
      clientId, credits: total, reason: `Add-on: +${quantity} ${type} capacity`,
      actionType: "addon_purchase", entityType: type, performedBy,
    });
    if (!result.ok) return fail(res, 400, result.message);
    const fresh = await Client.findOne({ appId: clientId });
    applyAddonQuota(fresh, type, quantity);
    await fresh.save();
    await AddonPurchaseLog.create({
      appId: `addon-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      clientId, type, quantity, purchaseMethod: "credits", unitCost: unit, totalCost: total,
      currency: "credits", status: "completed", performedBy,
      idempotencyKey: idempotencyKey || "",
    });
    return ok(res, `Added +${quantity} ${type} capacity using credits.`, { usage: usageView(fresh) });
  }

  if (method !== "razorpay") return fail(res, 400, "Unsupported purchase method.");

  const keyId = String(client.razorpayKeyId || "").trim();
  const keySecret = String(client.razorpayKeySecret || "").trim();
  if (!keyId || !keySecret) {
    return ok(res, "Razorpay is not configured for this account.", { razorpayConfigured: false });
  }
  const unit = ADDON_MONEY_UNIT[type];
  const total = unit * quantity;
  const currency = client.billingCurrency || "INR";
  const action = String(req.body.action || "create-order");

  if (action === "create-order") {
    try {
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
      const r = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: total * 100, currency,
          receipt: `addon_${type}_${Date.now()}`,
          notes: { type, quantity: String(quantity), clientId },
        }),
      });
      if (!r.ok) return fail(res, 502, "Could not create the Razorpay order.");
      const order = await r.json();
      return ok(res, "Razorpay order created.", {
        razorpayConfigured: true,
        order: { id: order.id, amount: order.amount, currency: order.currency, keyId },
      });
    } catch (_e) {
      return fail(res, 502, "Razorpay order creation failed.");
    }
  }

  if (action === "verify") {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return fail(res, 400, "Missing Razorpay verification fields.");
    }

    const alreadyProcessed = await AddonPurchaseLog.findOne({ orderId: razorpay_order_id }).lean();
    if (alreadyProcessed) {
      return ok(res, `Added +${alreadyProcessed.quantity} ${alreadyProcessed.type} capacity via Razorpay.`, { usage: usageView(client) });
    }

    const expected = crypto.createHmac("sha256", keySecret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
    if (expected !== razorpay_signature) return fail(res, 400, "Payment signature verification failed.");

    let rzpOrder;
    try {
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
      const r = await fetch(`https://api.razorpay.com/v1/orders/${razorpay_order_id}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!r.ok) return fail(res, 502, "Could not fetch the Razorpay order for verification.");
      rzpOrder = await r.json();
    } catch (_e) {
      return fail(res, 502, "Razorpay order fetch failed during verification.");
    }

    if (String(rzpOrder.notes?.clientId || "") !== clientId) {
      return fail(res, 403, "Order does not belong to this account.");
    }
    const orderType = String(rzpOrder.notes?.type || "").toLowerCase();
    const orderQty = Math.max(0, Math.floor(Number(rzpOrder.notes?.quantity || 0)));
    if (orderType !== type || orderQty !== quantity) {
      return fail(res, 400, "Order type/quantity does not match the request.");
    }
    const expectedAmount = ADDON_MONEY_UNIT[orderType] * orderQty * 100;
    if (Number(rzpOrder.amount) !== expectedAmount) {
      return fail(res, 400, "Order amount mismatch.");
    }

    applyAddonQuota(client, orderType, orderQty);
    await client.save();
    await AddonPurchaseLog.create({
      appId: `addon-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      clientId, type: orderType, quantity: orderQty, purchaseMethod: "razorpay",
      unitCost: ADDON_MONEY_UNIT[orderType], totalCost: ADDON_MONEY_UNIT[orderType] * orderQty,
      currency, orderId: razorpay_order_id, paymentId: razorpay_payment_id, status: "captured", performedBy,
    });
    return ok(res, `Added +${orderQty} ${orderType} capacity via Razorpay.`, { usage: usageView(client) });
  }

  return fail(res, 400, "Unknown add-on action.");
};

// GET /billing/addons/history — history + current usage + pricing (one call).
const getAddonHistory = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  let client = await Client.findOne({ appId: clientId }, CLIENT_HEAVY_EXCLUSION).lean();
  if (!client) return fail(res, 404, "Client not found.");
  if (!client.quotaInitialized) {
    const fullClient = await Client.findOne({ appId: clientId });
    const publishedCount = await Training.countDocuments({ clientId, "payload.status": "approved" });
    await ensureClientEntitlement(fullClient, {
      training: publishedCount, session: Number(fullClient.sessions || 0), user: Number(fullClient.activeUsers || 0),
    });
    client = fullClient.toObject();
  }
  const pageNo = Math.max(1, Number(req.query.pageNo) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const skip = (pageNo - 1) * limit;
  const addonFilter = { clientId };
  const [rows, total] = await Promise.all([
    AddonPurchaseLog.find(addonFilter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AddonPurchaseLog.countDocuments(addonFilter),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return ok(res, "Add-on history loaded.", {
    record: rows.map((r) => ({
      id: r.appId, type: r.type, quantity: r.quantity, purchaseMethod: r.purchaseMethod,
      unitCost: r.unitCost, totalCost: r.totalCost, currency: r.currency,
      status: r.status, performedBy: r.performedBy, createdAt: r.createdAt,
    })),
    count: total,
    totalPages,
    pagination: Array.from({ length: totalPages }, (_, i) => i + 1),
    usage: usageView(client),
    pricing: { creditUnit: ADDON_CREDIT_UNIT, moneyUnit: ADDON_MONEY_UNIT },
    razorpayConfigured: Boolean(String(client.razorpayKeyId || "").trim() && String(client.razorpayKeySecret || "").trim()),
  });
};

// Task 3: paginated credit audit trail for the Upgrade & Billing page.
// Phase E / Task 6: added date range, actionType, performedBy filters.
const getCreditHistory = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const pageNo = Math.max(1, Number(req.query.pageNo) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const filter = { clientId };
  if (req.query.dateFrom || req.query.dateTo) {
    filter.timestamp = {};
    if (req.query.dateFrom) filter.timestamp.$gte = new Date(req.query.dateFrom);
    if (req.query.dateTo) filter.timestamp.$lte = new Date(req.query.dateTo);
  }
  if (req.query.actionType) filter.actionType = String(req.query.actionType);
  if (req.query.performedBy) filter.performedBy = { $regex: String(req.query.performedBy), $options: "i" };
  const [record, total] = await Promise.all([
    CreditAuditLog.find(filter)
      .sort({ timestamp: -1, _id: -1 })
      .skip((pageNo - 1) * limit)
      .limit(limit)
      .lean(),
    CreditAuditLog.countDocuments(filter),
  ]);
  return ok(res, "Credit history loaded.", {
    record: record.map((r) => ({
      id: String(r._id),
      timestamp: r.timestamp,
      actionType: r.actionType,
      entityType: r.entityType,
      entityId: r.entityId,
      creditChange: r.creditChange,
      balanceBefore: r.balanceBefore,
      balanceAfter: r.balanceAfter,
      performedBy: r.performedBy,
      reason: r.reason,
      reference: r.reference,
    })),
    total,
    pageNo,
    limit,
  });
};

module.exports = {
  dashboard,
  getApiConfig,
  updateApiConfig,
  getWebhooks,
  updateWebhooks,
  testWebhooks,
  testXapi,
  getIframe,
  updateIframe,
  health,
  getBillingSummary,
  getBillingPlans,
  getCreditHistory,
  purchaseAddon,
  getAddonHistory,
  purchaseCredits,
  requestEnterprisePlan,
  testSmtp,
  verifyDomain,
  buildBillingSummaryResponse,
};
