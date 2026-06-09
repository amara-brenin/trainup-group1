const Client = require("../models/Client");

const CREDIT_COSTS = {
  training: 500,
  user: 200,
  session: 100,
};

const PLAN_CONFIGS = {
  FREE: {
    code: "FREE",
    label: "FREE",
    monthlyCredits: 2000,
    monthlyPrice: 1999,
    firstMonthPrice: 0,
    trialDays: 30,
    limits: {
      trainings: 1,
      users: 3,
      sessions: 5,
    },
    contactSales: false,
  },
  PRO: {
    code: "PRO",
    label: "PRO",
    monthlyCredits: 40000,
    monthlyPrice: 5000,
    firstMonthPrice: 5000,
    trialDays: 0,
    limits: {
      trainings: 10,
      users: 50,
      sessions: 250,
    },
    contactSales: false,
  },
  ENTERPRISE: {
    code: "ENTERPRISE",
    label: "ENTERPRISE",
    monthlyCredits: 0,
    monthlyPrice: 0,
    firstMonthPrice: 0,
    trialDays: 0,
    limits: {
      trainings: null,
      users: null,
      sessions: null,
    },
    contactSales: true,
  },
};

const normalizePlan = (plan) => {
  const normalized = String(plan || "").trim().toUpperCase();

  if (normalized === "PRO") {
    return "PRO";
  }

  if (normalized === "FREE" || normalized === "STARTER" || normalized === "TRIAL") {
    return "FREE";
  }

  return "ENTERPRISE";
};

const getPlanConfig = (plan) => PLAN_CONFIGS[normalizePlan(plan)] || PLAN_CONFIGS.FREE;

const getClientCreatedAt = (client) => {
  const sourceDate = client?.createdAt || client?.updatedAt || new Date().toISOString();
  const parsed = new Date(sourceDate);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const getFreeTrialMeta = (client) => {
  const plan = normalizePlan(client?.plan);

  if (plan !== "FREE") {
    return {
      active: false,
      trialDays: PLAN_CONFIGS.FREE.trialDays,
      startedAt: null,
      endsAt: null,
    };
  }

  const startedAt = getClientCreatedAt(client);
  const endsAt = new Date(startedAt);
  endsAt.setDate(endsAt.getDate() + PLAN_CONFIGS.FREE.trialDays);
  const active = endsAt.getTime() > Date.now();

  return {
    active,
    trialDays: PLAN_CONFIGS.FREE.trialDays,
    startedAt: startedAt.toISOString(),
    endsAt: endsAt.toISOString(),
  };
};

const getEffectivePlanConfig = (client, plan) => {
  const normalizedPlan = normalizePlan(plan);
  const baseConfig = getPlanConfig(normalizedPlan);

  if (normalizedPlan !== "ENTERPRISE") {
    return baseConfig;
  }

  const customMonthlyCredits = Math.max(0, Number(client?.enterpriseMonthlyCredits || 0));
  const customMonthlyPrice = Math.max(0, Number(client?.enterpriseMonthlyPrice || 0));

  return {
    ...baseConfig,
    monthlyCredits: customMonthlyCredits || PLAN_CONFIGS.PRO.monthlyCredits,
    monthlyPrice: customMonthlyPrice,
    firstMonthPrice: customMonthlyPrice,
  };
};

const getPlanChargeAmount = (client, plan) => {
  const normalizedPlan = normalizePlan(plan);
  const planConfig = getEffectivePlanConfig(client, normalizedPlan);

  if (normalizedPlan === "FREE") {
    return getFreeTrialMeta(client).active ? planConfig.firstMonthPrice : planConfig.monthlyPrice;
  }

  return planConfig.monthlyPrice;
};

const buildClientCreditSnapshot = (client) => {
  const plan = normalizePlan(client?.plan);
  const planConfig = getEffectivePlanConfig(client, plan);
  const shouldFallbackEnterpriseCredits =
    plan === "ENTERPRISE" &&
    Number(client?.enterpriseMonthlyCredits || 0) <= 0 &&
    Number(client?.monthlyCredits || 0) <= 0;
  const monthlyCredits =
    Number.isFinite(Number(client?.monthlyCredits)) &&
    Number(client?.monthlyCredits) >= 0 &&
    !shouldFallbackEnterpriseCredits
      ? Number(client.monthlyCredits)
      : planConfig.monthlyCredits;
  const purchasedCredits = Math.max(0, Number(client?.purchasedCredits || 0));
  const usedCredits = Math.max(0, Number(client?.usedCredits || 0));
  const totalCredits =
    Number.isFinite(Number(client?.totalCredits)) &&
    Number(client?.totalCredits) >= 0 &&
    !(shouldFallbackEnterpriseCredits && Number(client?.totalCredits || 0) <= 0)
      ? Number(client.totalCredits)
      : monthlyCredits + purchasedCredits;

  return {
    plan: planConfig.code,
    planConfig,
    monthlyCredits,
    purchasedCredits,
    usedCredits,
    totalCredits,
    availableCredits: Math.max(totalCredits - usedCredits, 0),
    billingCycle: "monthly",
  };
};

const createTransactionEntry = (type, credits, note = "") => ({
  id: `credit-txn-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  type,
  credits,
  note: String(note || "").trim(),
  createdAt: new Date().toISOString(),
});

const applyPlanToClient = (client, plan, options = {}) => {
  const normalizedPlan = normalizePlan(plan);
  const planConfig = getEffectivePlanConfig(client, normalizedPlan);
  const currentSnapshot = buildClientCreditSnapshot(client);
  const preservedPurchasedCredits = options.resetPurchasedCredits ? 0 : currentSnapshot.purchasedCredits;
  const preservedUsedCredits = options.resetUsage ? 0 : currentSnapshot.usedCredits;
  const carriedAvailableCredits = options.carryAvailableCredits
    ? Math.max(0, currentSnapshot.availableCredits - preservedPurchasedCredits)
    : 0;

  client.plan = normalizedPlan;
  client.monthlyCredits = planConfig.monthlyCredits;
  client.purchasedCredits = preservedPurchasedCredits + carriedAvailableCredits;
  client.usedCredits = preservedUsedCredits;
  client.totalCredits = planConfig.monthlyCredits + preservedPurchasedCredits + carriedAvailableCredits;
  client.billingCycle = "monthly";
  client.creditTransactions = Array.isArray(client.creditTransactions) ? client.creditTransactions : [];

  client.creditTransactions.unshift(
    createTransactionEntry(
      "plan_assignment",
      planConfig.monthlyCredits,
      `Plan set to ${planConfig.label}`,
    ),
  );
  client.creditTransactions = client.creditTransactions.slice(0, 25);

  return buildClientCreditSnapshot(client);
};

const assertUsageWithinPlan = ({ client, resource, nextCount }) => {
  const { planConfig } = buildClientCreditSnapshot(client);
  const limit = planConfig.limits[resource];

  if (limit === null || limit === undefined) {
    return null;
  }

  if (nextCount <= limit) {
    return null;
  }

  const labels = {
    trainings: "training",
    users: "user",
    sessions: "session",
  };

  return `Current ${planConfig.label} plan allows only ${limit} ${labels[resource]}${limit === 1 ? "" : "s"}. Upgrade plan or buy a custom enterprise allocation.`;
};

const assertCreditAvailability = (client, requiredCredits) => {
  const snapshot = buildClientCreditSnapshot(client);

  if (snapshot.planConfig.contactSales) {
    return null;
  }

  if (snapshot.availableCredits >= requiredCredits) {
    return null;
  }

  return `Not enough credits. ${requiredCredits} credits required, ${snapshot.availableCredits} available.`;
};

const consumeClientCredits = async ({ clientId, credits, reason }) => {
  const client = await Client.findOne({ appId: clientId });

  if (!client) {
    throw new Error("Client not found for credit deduction.");
  }

  const creditError = assertCreditAvailability(client, credits);

  if (creditError) {
    return {
      ok: false,
      message: creditError,
      client,
    };
  }

  const snapshot = buildClientCreditSnapshot(client);
  client.usedCredits = snapshot.usedCredits + credits;
  client.totalCredits = snapshot.totalCredits;
  client.monthlyCredits = snapshot.monthlyCredits;
  client.purchasedCredits = snapshot.purchasedCredits;
  client.billingCycle = "monthly";
  client.creditTransactions = Array.isArray(client.creditTransactions) ? client.creditTransactions : [];
  client.creditTransactions.unshift(createTransactionEntry("debit", credits, reason));
  client.creditTransactions = client.creditTransactions.slice(0, 25);
  await client.save();

  return {
    ok: true,
    client,
    snapshot: buildClientCreditSnapshot(client),
  };
};

const addClientCredits = async ({ clientId, credits, note }) => {
  const client = await Client.findOne({ appId: clientId });

  if (!client) {
    throw new Error("Client not found for credit purchase.");
  }

  const snapshot = buildClientCreditSnapshot(client);
  client.purchasedCredits = snapshot.purchasedCredits + credits;
  client.totalCredits = snapshot.totalCredits + credits;
  client.monthlyCredits = snapshot.monthlyCredits;
  client.usedCredits = snapshot.usedCredits;
  client.billingCycle = "monthly";
  client.creditTransactions = Array.isArray(client.creditTransactions) ? client.creditTransactions : [];
  client.creditTransactions.unshift(createTransactionEntry("credit_purchase", credits, note || "Dummy gateway purchase"));
  client.creditTransactions = client.creditTransactions.slice(0, 25);
  await client.save();

  return {
    client,
    snapshot: buildClientCreditSnapshot(client),
  };
};

module.exports = {
  CREDIT_COSTS,
  PLAN_CONFIGS,
  normalizePlan,
  getPlanConfig,
  getEffectivePlanConfig,
  getPlanChargeAmount,
  getFreeTrialMeta,
  buildClientCreditSnapshot,
  createTransactionEntry,
  applyPlanToClient,
  assertUsageWithinPlan,
  assertCreditAvailability,
  consumeClientCredits,
  addClientCredits,
};
