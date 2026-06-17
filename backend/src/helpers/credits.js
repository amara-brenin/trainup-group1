const Client = require("../models/Client");
const CreditAuditLog = require("../models/CreditAuditLog");

// Task 3: best-effort audit write. NEVER throws into the credit flow — a logging
// failure must not block a legitimate credit change.
const recordCreditAudit = async (entry) => {
  try {
    await CreditAuditLog.create({
      clientId: entry.clientId,
      actionType: entry.actionType || "",
      entityType: entry.entityType || "",
      entityId: entry.entityId || "",
      creditChange: Number(entry.creditChange || 0),
      balanceBefore: Number(entry.balanceBefore || 0),
      balanceAfter: Number(entry.balanceAfter || 0),
      performedBy: entry.performedBy || "",
      reason: entry.reason || "",
      reference: entry.reference || "",
    });
  } catch (_e) { /* audit logging is non-fatal */ }
};

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

// Phase C: map a DB Plan row to the in-memory plan-config shape used everywhere.
const planRowToConfig = (row) => ({
  code: String(row.code || "").toUpperCase(),
  label: row.name || row.code,
  monthlyCredits: Number(row.credits || 0),
  monthlyPrice: Number(row.monthlyPrice || 0),
  yearlyPrice: Number(row.yearlyPrice || 0),
  firstMonthPrice: Number(row.monthlyPrice || 0),
  trialDays: 0,
  validityDays: Number(row.validityDays || 30),
  features: Array.isArray(row.features) ? row.features : [],
  limits: {
    trainings: row.trainingLimit ?? null,
    users: row.userLimit ?? null,
    sessions: row.sessionLimit ?? null,
  },
  contactSales: String(row.code || "").toUpperCase() === "ENTERPRISE" && Number(row.monthlyPrice || 0) <= 0,
});

// Phase C: resolve a plan from the DB (active row) and fall back to the hardcoded
// PLAN_CONFIGS when no row exists — zero breakage if the Plan collection is empty.
const resolvePlan = async (plan) => {
  const normalized = normalizePlan(plan);
  try {
    const Plan = require("../models/Plan");
    const row = await Plan.findOne({ code: normalized, active: true }).lean();
    if (row) return planRowToConfig(row);
  } catch (_e) { /* DB unavailable → fall back */ }
  return PLAN_CONFIGS[normalized] || PLAN_CONFIGS.FREE;
};

// Phase C: freeze the entitlement snapshot on the client from the (DB) plan at
// purchase/upgrade time. Future plan edits NEVER touch these frozen base limits.
// Does NOT reset lifetime usage (permanent per Task 2). Mutates client; caller saves.
const applyPlanSnapshot = async (client, planCode) => {
  const cfg = await resolvePlan(planCode);
  client.subscribedPlan = cfg.code;
  client.trainingBaseLimit = cfg.limits.trainings ?? null;
  client.sessionBaseLimit = cfg.limits.sessions ?? null;
  client.userBaseLimit = cfg.limits.users ?? null;
  client.creditBaseLimit = cfg.monthlyCredits;
  // Credits are also DB-plan-driven + frozen here (purchased credits preserved).
  client.monthlyCredits = cfg.monthlyCredits;
  client.totalCredits = cfg.monthlyCredits + Math.max(0, Number(client.purchasedCredits || 0));
  client.entitlementSnapshotAt = new Date();
  client.quotaInitialized = true; // snapshot is now the authoritative base
  return cfg;
};

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

// ---- Feature Set 6 / Task 2: lifetime entitlement model --------------------
// Resource → (client field prefix, plan-limit key).
const RESOURCE_MAP = {
  training: { prefix: "training", planKey: "trainings", label: "training" },
  session: { prefix: "session", planKey: "sessions", label: "session" },
  user: { prefix: "user", planKey: "users", label: "user" },
};

// Effective entitlement per resource, read from client fields (NOT PLAN_CONFIGS
// directly — Plan-snapshot compatible). base `null` ⇒ unlimited. Falls back to
// the plan limit when the client's base hasn't been initialized yet.
const getClientEntitlement = (client) => {
  const { planConfig } = buildClientCreditSnapshot(client);
  const out = {};
  for (const [resource, { prefix, planKey }] of Object.entries(RESOURCE_MAP)) {
    const rawBase = client?.[`${prefix}BaseLimit`];
    const base = rawBase === null || rawBase === undefined ? planConfig.limits[planKey] : Number(rawBase);
    const purchased = Math.max(0, Number(client?.[`${prefix}PurchasedLimit`] || 0));
    const usedLifetime = Math.max(0, Number(client?.[`${prefix}UsedLifetime`] || 0));
    const unlimited = base === null || base === undefined;
    const limit = unlimited ? null : Number(base) + purchased;
    out[resource] = {
      base: unlimited ? null : Number(base),
      purchased,
      limit,
      usedLifetime,
      remaining: unlimited ? null : Math.max(0, limit - usedLifetime),
      unlimited,
    };
  }
  return out;
};

// One-time backfill: set base from the current plan and usedLifetime = MAX(current
// real count, existing) so nobody is retroactively over/under counted. Mutates +
// saves the client. `counts` = { training, session, user } current real counts.
const ensureClientEntitlement = async (client, counts = {}) => {
  if (client.quotaInitialized) return client;
  const { planConfig } = buildClientCreditSnapshot(client);
  for (const [resource, { prefix, planKey }] of Object.entries(RESOURCE_MAP)) {
    const planLimit = planConfig.limits[planKey]; // may be null (unlimited)
    if (client[`${prefix}BaseLimit`] === null || client[`${prefix}BaseLimit`] === undefined) {
      client[`${prefix}BaseLimit`] = planLimit === null || planLimit === undefined ? null : Number(planLimit);
    }
    const current = Math.max(0, Number(counts[resource] || 0));
    client[`${prefix}UsedLifetime`] = Math.max(Number(client[`${prefix}UsedLifetime`] || 0), current);
  }
  client.quotaInitialized = true;
  await client.save();
  return client;
};

// Returns an error string if consuming `addCount` of `resource` would exceed the
// lifetime entitlement, else null. Unlimited always passes.
// Phase D: add-on capacity pricing (per slot). Credits per slot + money per slot.
const ADDON_CREDIT_UNIT = Object.freeze({ training: 200, session: 20, user: 5 });
const ADDON_MONEY_UNIT = Object.freeze({ training: 500, session: 50, user: 20 }); // major currency units (e.g. INR)

// Phase D: increase a client's PURCHASED quota bucket. Never touches the base
// snapshot, so existing entitlements are unaffected; effective = base + purchased.
const applyAddonQuota = (client, resource, quantity) => {
  const field = `${resource}PurchasedLimit`;
  client[field] = Math.max(0, Number(client[field] || 0)) + Math.max(0, Number(quantity || 0));
  return client[field];
};

const assertLifetimeQuota = (client, resource, addCount = 1) => {
  const ent = getClientEntitlement(client)[resource];
  if (!ent || ent.unlimited) return null;
  if (ent.usedLifetime + addCount <= ent.limit) return null;
  const label = RESOURCE_MAP[resource]?.label || resource;
  return `Your plan allows ${ent.limit} ${label}${ent.limit === 1 ? "" : "s"} (lifetime). ${ent.usedLifetime} already used. Upgrade your plan or buy additional ${label} capacity.`;
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

const consumeClientCredits = async ({
  clientId, credits, reason,
  // Task 3 (optional, backward-compatible): richer audit context.
  actionType, entityType, entityId, performedBy, reference,
}) => {
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
  const balanceBefore = snapshot.availableCredits;
  client.usedCredits = snapshot.usedCredits + credits;
  client.totalCredits = snapshot.totalCredits;
  client.monthlyCredits = snapshot.monthlyCredits;
  client.purchasedCredits = snapshot.purchasedCredits;
  client.billingCycle = "monthly";
  client.creditTransactions = Array.isArray(client.creditTransactions) ? client.creditTransactions : [];
  client.creditTransactions.unshift(createTransactionEntry("debit", credits, reason));
  client.creditTransactions = client.creditTransactions.slice(0, 25);
  await client.save();

  const after = buildClientCreditSnapshot(client);
  await recordCreditAudit({
    clientId, actionType: actionType || "debit", entityType: entityType || "credit", entityId,
    creditChange: -Math.abs(credits), balanceBefore, balanceAfter: after.availableCredits,
    performedBy, reason, reference,
  });

  return {
    ok: true,
    client,
    snapshot: after,
  };
};

const addClientCredits = async ({
  clientId, credits, note,
  // Task 3 (optional, backward-compatible): richer audit context.
  actionType, entityType, entityId, performedBy, reference,
}) => {
  const client = await Client.findOne({ appId: clientId });

  if (!client) {
    throw new Error("Client not found for credit purchase.");
  }

  const snapshot = buildClientCreditSnapshot(client);
  const balanceBefore = snapshot.availableCredits;
  client.purchasedCredits = snapshot.purchasedCredits + credits;
  client.totalCredits = snapshot.totalCredits + credits;
  client.monthlyCredits = snapshot.monthlyCredits;
  client.usedCredits = snapshot.usedCredits;
  client.billingCycle = "monthly";
  client.creditTransactions = Array.isArray(client.creditTransactions) ? client.creditTransactions : [];
  client.creditTransactions.unshift(createTransactionEntry("credit_purchase", credits, note || "Credit purchase"));
  client.creditTransactions = client.creditTransactions.slice(0, 25);
  await client.save();

  const after = buildClientCreditSnapshot(client);
  await recordCreditAudit({
    clientId, actionType: actionType || "credit_purchase", entityType: entityType || "credit", entityId,
    creditChange: Math.abs(credits), balanceBefore, balanceAfter: after.availableCredits,
    performedBy, reason: note || "Credit purchase", reference,
  });

  return {
    client,
    snapshot: after,
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
  recordCreditAudit,
  getClientEntitlement,
  ensureClientEntitlement,
  assertLifetimeQuota,
  resolvePlan,
  planRowToConfig,
  applyPlanSnapshot,
  ADDON_CREDIT_UNIT,
  ADDON_MONEY_UNIT,
  applyAddonQuota,
};
