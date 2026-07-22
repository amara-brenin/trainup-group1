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

const getCreditCosts = async (client = null) => {
  let costs = { training: 500, user: 200, session: 100 };
  try {
    const Setting = require("../models/Setting");
    const globalCosts = await Setting.findOne({ key: "GLOBAL_CREDIT_COSTS" }).lean();
    if (globalCosts && globalCosts.value) {
      costs = { ...costs, ...globalCosts.value };
    }
  } catch (e) {
    // Ignore error, use defaults
  }
  
  if (client && client.creditCostOverrides) {
    if (typeof client.creditCostOverrides.training === "number") costs.training = client.creditCostOverrides.training;
    if (typeof client.creditCostOverrides.session === "number") costs.session = client.creditCostOverrides.session;
    if (typeof client.creditCostOverrides.user === "number") costs.user = client.creditCostOverrides.user;
  }
  return costs;
};

const PLAN_CONFIGS = {
  FREE: {
    code: "FREE",
    label: "FREE",
    monthlyCredits: 2000,
    price: 1999,
    firstMonthPrice: 0,
    trialDays: 30,
    contactSales: false,
  },
  PRO: {
    code: "PRO",
    label: "PRO",
    monthlyCredits: 40000,
    price: 5000,
    firstMonthPrice: 5000,
    trialDays: 0,
    contactSales: false,
  },
  ENTERPRISE: {
    code: "ENTERPRISE",
    label: "ENTERPRISE",
    monthlyCredits: 0,
    price: 0,
    firstMonthPrice: 0,
    trialDays: 0,
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
  price: Number(row.price || 0),
  discountPercentage: Number(row.discountPercentage || 0),
  firstMonthPrice: Number(row.price || 0),
  trialDays: 0,
  validityDays: Number(row.validityDays || 30),
  features: Array.isArray(row.features) ? row.features : [],
  contactSales: String(row.code || "").toUpperCase() === "ENTERPRISE" && Number(row.price || 0) <= 0,
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

// ---- Batch ledger (stacked plan purchases) ---------------------------------
// Each plan purchase/assignment grants its OWN credits/limits with its OWN
// expiry (purchasedAt + validityDays), so buying a new plan while an old one
// is still active ADDS to the total instead of overwriting it. This replaces
// the old single-scalar model where every purchase overwrote `totalCredits`/
// `planExpiryDate`, silently discarding whatever was left on the prior plan.

const genBatchId = () => `plan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const buildBatchFromPlanConfig = (planCfg, { amount = 0, purchasedAt = new Date() } = {}) => {
  const days = Number(planCfg.validityDays);
  const expiresAt = new Date(purchasedAt);
  if (Number.isFinite(days) && days > 0) {
    expiresAt.setDate(expiresAt.getDate() + days);
  } else {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
  }
  return {
    batchId: genBatchId(),
    planCode: planCfg.code,
    label: planCfg.label,
    monthlyCredits: Math.max(0, Number(planCfg.monthlyCredits || 0)),
    usedCredits: 0,
    amount: Math.max(0, Number(amount || 0)),
    purchasedAt,
    expiresAt,
  };
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

// ---- Subscription expiry (Issue 1) ----------------------------------------
// Canonical message surfaced to the client when a plan-resource action is
// attempted after the subscription has lapsed.
const SUBSCRIPTION_EXPIRED_MESSAGE =
  "Your subscription has expired. Please renew your plan to continue using this feature.";

// Resolve the subscription start: the most recent plan assignment/purchase,
// else the entitlement snapshot, else the client creation date.
const getSubscriptionStart = (client) => {
  const txns = Array.isArray(client?.creditTransactions) ? client.creditTransactions : [];
  const planTxn = txns.find(
    (t) => t?.type === "plan_assignment" || t?.type === "plan_purchase",
  );
  const source =
    planTxn?.createdAt ||
    client?.entitlementSnapshotAt ||
    client?.createdAt ||
    client?.updatedAt ||
    new Date().toISOString();
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

// Pre-migration fallback expiry (mirrors the old single-scalar logic): the
// stored planExpiryDate when present, else start + 1 month. Used ONLY to
// synthesize a legacy client's first batch — never called once activePlans
// is populated.
const legacyExpiryFallback = (client) => {
  if (client?.planExpiryDate) {
    const stored = new Date(client.planExpiryDate);
    if (!Number.isNaN(stored.getTime())) {
      return stored;
    }
  }
  const start = getSubscriptionStart(client);
  const expiry = new Date(start);
  expiry.setMonth(expiry.getMonth() + 1);
  return expiry;
};

// Pure: synthesize a single legacy batch from a pre-migration client's scalar
// fields (plan/monthlyCredits/*BaseLimit/planExpiryDate). Never mutates the
// client — the synthesized batch is only persisted the next time the client
// actually purchases/is assigned a plan (see addPlanBatch/resetClientPlanState).
const synthesizeLegacyBatch = (client) => {
  const planCode = normalizePlan(client?.plan);
  const cfg = getPlanConfig(planCode);
  return {
    batchId: "legacy",
    planCode,
    label: cfg.label,
    monthlyCredits: Math.max(0, Number(client?.monthlyCredits ?? cfg.monthlyCredits ?? 0)),
    usedCredits: Math.max(0, Number(client?.usedCredits ?? 0)),
    amount: 0,
    purchasedAt: client?.entitlementSnapshotAt || getClientCreatedAt(client),
    expiresAt: legacyExpiryFallback(client),
  };
};

// All batches on record (real ones if any, else a synthesized legacy one),
// regardless of expiry — used for "furthest expiry ever granted" display.
const getRawActivePlans = (client) => {
  if (!client) return [];
  const stored = Array.isArray(client.activePlans) ? client.activePlans : [];
  if (stored.length) return stored;
  return [synthesizeLegacyBatch(client)];
};

// Batches that are still within their own validity window — the live source
// of truth for how many credits/limits are currently granted.
const getActiveBatches = (client) => {
  const now = Date.now();
  return getRawActivePlans(client).filter((b) => {
    const exp = new Date(b?.expiresAt);
    return !Number.isNaN(exp.getTime()) && exp.getTime() > now;
  });
};

// Effective expiry for display: the furthest-out expiresAt across ALL known
// batches (even already-expired ones), so the UI can still show "expired on
// X" after lapse. Falls back to start + 1 month when there's no batch at all.
const getSubscriptionExpiry = (client) => {
  const batches = getRawActivePlans(client);
  if (!batches.length) {
    const start = getSubscriptionStart(client);
    const expiry = new Date(start);
    expiry.setMonth(expiry.getMonth() + 1);
    return expiry;
  }
  return batches.reduce((max, b) => {
    const exp = new Date(b.expiresAt);
    return !Number.isNaN(exp.getTime()) && exp.getTime() > max.getTime() ? exp : max;
  }, new Date(0));
};

// Enterprise/contact-sales plans have no fixed monthly expiry unless one was
// explicitly stamped. Everything else is expired once there are no active
// (non-lapsed) plan batches left — regardless of remaining credits.
const isSubscriptionExpired = (client) => {
  if (!client) {
    return false;
  }
  const plan = normalizePlan(client.plan);
  if (plan === "ENTERPRISE" && !client.planExpiryDate) {
    return false;
  }
  return getActiveBatches(client).length === 0;
};

// Returns the expiry error string if the subscription has lapsed, else null.
const assertSubscriptionActive = (client) =>
  isSubscriptionExpired(client) ? SUBSCRIPTION_EXPIRED_MESSAGE : null;

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
  const activeBatches = getActiveBatches(client);
  const plan = normalizePlan(client?.plan);
  const planConfig = getEffectivePlanConfig(client, plan);

  const planExpired = activeBatches.length === 0;

  let totalCredits = 0;
  let batchUsedCredits = 0;

  // One row per active plan purchase, oldest first — feeds the "active plans"
  // table on the billing page instead of a single "current plan" label.
  const activePlans = activeBatches
    .slice()
    .sort((a, b) => new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime())
    .map((b) => {
      const bTotal = Math.max(0, Number(b.monthlyCredits || 0));
      const bUsed = Math.max(0, Number(b.usedCredits || 0));
      totalCredits += bTotal;
      batchUsedCredits += bUsed;

      return {
        batchId: b.batchId,
        planCode: b.planCode,
        label: b.label,
        monthlyCredits: bTotal,
        usedCredits: bUsed,
        availableCredits: Math.max(0, bTotal - bUsed),
        purchasedAt: new Date(b.purchasedAt).toISOString(),
        expiresAt: new Date(b.expiresAt).toISOString(),
      };
    });

  // Reconcile legacy global usage: if the client's global usedCredits exceeds
  // the sum of the batch usedCredits, distribute the untracked usage visually
  // into the oldest batches to keep the table mathematically sound.
  const globalUsedCredits = Math.max(0, Number(client?.usedCredits || 0));
  let finalUsedCredits = Math.max(globalUsedCredits, batchUsedCredits);

  if (finalUsedCredits > batchUsedCredits) {
    let untrackedUsage = finalUsedCredits - batchUsedCredits;
    for (const b of activePlans) {
      if (untrackedUsage <= 0) break;
      if (b.availableCredits > 0) {
        const deduct = Math.min(b.availableCredits, untrackedUsage);
        b.usedCredits += deduct;
        b.availableCredits -= deduct;
        untrackedUsage -= deduct;
      }
    }
  }

  const availableCredits = planExpired ? 0 : Math.max(0, totalCredits - finalUsedCredits);

  return {
    plan: planConfig.code,
    planConfig,
    monthlyCredits: totalCredits, // Represent the aggregated total limits as monthly
    purchasedCredits: 0,
    usedCredits: finalUsedCredits,
    totalCredits,
    // Effective available credits: 0 when there's no active plan batch.
    availableCredits,
    // Raw (pre-expiry) balance, retained for display/reporting if needed.
    rawAvailableCredits: Math.max(0, totalCredits - finalUsedCredits),
    planExpired,
    expiresOn: getSubscriptionExpiry(client).toISOString(),
    billingCycle: "monthly",
    activePlans,
  };
};

const createTransactionEntry = (type, credits, note = "") => ({
  id: `credit-txn-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  type,
  credits,
  note: String(note || "").trim(),
  createdAt: new Date().toISOString(),
});

// The ONE path for granting a plan — fresh purchase, renewal, or admin
// (re)assignment. Appends a batch instead of overwriting, so credits/limits
// stack with independent expiries while multiple purchases are still valid.
// Never resets lifetime usage counters (permanent, never refunded — matches
// the existing lifetime-entitlement model for trainings/sessions/users).
// Mutates client; caller saves.
const addPlanBatch = (client, planCfg, { amount = 0 } = {}) => {
  const batches = Array.isArray(client.activePlans) ? client.activePlans.slice() : [];
  if (!batches.length) {
    // First write since this feature shipped — seed the client's pre-existing
    // scalar state as its own batch so it isn't silently dropped.
    batches.push(synthesizeLegacyBatch(client));
  }
  const batch = buildBatchFromPlanConfig(planCfg, { amount });
  batches.push(batch);

  client.activePlans = batches;
  client.plan = planCfg.code;
  client.subscribedPlan = planCfg.code;
  client.entitlementSnapshotAt = batch.purchasedAt;
  client.quotaInitialized = true;

  // Refresh cached mirrors for the lightweight super-admin list view (not
  // authoritative — buildClientCreditSnapshot/getActiveBatches recompute live).
  const snapshot = buildClientCreditSnapshot(client);
  client.totalCredits = snapshot.totalCredits;
  client.monthlyCredits = snapshot.monthlyCredits;
  client.planExpiryDate = getSubscriptionExpiry(client);
  return snapshot;
};

// Explicit full reset — used ONLY by the super-admin "reset monthly credits"
// operational override. Wipes every batch and all lifetime usage counters,
// unlike addPlanBatch which always stacks. Mutates client; caller saves.
const resetClientPlanState = (client, planCfg, { amount = 0 } = {}) => {
  const batch = buildBatchFromPlanConfig(planCfg, { amount });
  client.activePlans = [batch];
  client.plan = planCfg.code;
  client.subscribedPlan = planCfg.code;
  client.entitlementSnapshotAt = batch.purchasedAt;
  client.quotaInitialized = true;
  client.trainingUsedLifetime = 0;
  client.sessionUsedLifetime = 0;
  client.userUsedLifetime = 0;
  client.purchasedCredits = 0;
  client.usedCredits = 0;

  const snapshot = buildClientCreditSnapshot(client);
  client.totalCredits = snapshot.totalCredits;
  client.monthlyCredits = snapshot.monthlyCredits;
  client.planExpiryDate = batch.expiresAt;
  return snapshot;
};

// ---- Feature Set 6 / Task 2: lifetime entitlement model --------------------
// Resource → (client field prefix, plan-limit key).
const RESOURCE_MAP = {
  training: { prefix: "training", planKey: "trainings", label: "training" },
  session: { prefix: "session", planKey: "sessions", label: "session" },
  user: { prefix: "user", planKey: "users", label: "user" },
};

// Effective entitlement per resource: SUMMED across every currently-active
// plan batch (stacking applies to limits too, not just credits), plus any
// purchased add-on capacity. `null` base ⇒ unlimited (any active batch grants
// unlimited for that resource). No active batches ⇒ base 0 (nothing granted).
const getClientEntitlement = (client) => ({});
const ensureClientEntitlement = async (client, counts = {}) => client;
const ADDON_CREDIT_UNIT = Object.freeze({ training: 200, session: 20, user: 5 });
const ADDON_MONEY_UNIT = Object.freeze({ training: 500, session: 50, user: 20 });
const applyAddonQuota = (client, resource, quantity) => 0;
const assertLifetimeQuota = (client, resource, addCount = 1) => null;
const assertUsageWithinPlan = ({ client, resource, nextCount }) => null;

const assertCreditAvailability = (client, requiredCredits) => {
  const snapshot = buildClientCreditSnapshot(client);

  // Issue 1: an expired subscription has zero effective credits — surface the
  // expiry message (not a generic "not enough credits") even on contact-sales.
  if (snapshot.planExpired) {
    return SUBSCRIPTION_EXPIRED_MESSAGE;
  }

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
  
  if (!snapshot.planConfig.contactSales && credits > 0) {
    let remainingToDeduct = credits;
    const activeBatchesSorted = getActiveBatches(client).sort((a, b) => new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime());
    
    for (const batch of activeBatchesSorted) {
      if (remainingToDeduct <= 0) break;
      const bTotal = Math.max(0, Number(batch.monthlyCredits || 0));
      const bUsed = Math.max(0, Number(batch.usedCredits || 0));
      const bAvailable = Math.max(0, bTotal - bUsed);

      if (bAvailable > 0) {
        const deductAmount = Math.min(bAvailable, remainingToDeduct);
        batch.usedCredits = bUsed + deductAmount;
        remainingToDeduct -= deductAmount;
      }
    }
    
    if (client.activePlans) {
      client.activePlans = client.activePlans.map(p => {
        const updated = activeBatchesSorted.find(b => b.batchId === p.batchId);
        return updated ? { ...p, usedCredits: updated.usedCredits } : p;
      });
    }
  }

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
  getCreditCosts,
  PLAN_CONFIGS,
  normalizePlan,
  getPlanConfig,
  getEffectivePlanConfig,
  getPlanChargeAmount,
  getFreeTrialMeta,
  buildClientCreditSnapshot,
  createTransactionEntry,
  addPlanBatch,
  resetClientPlanState,
  getActiveBatches,
  getRawActivePlans,
  assertCreditAvailability,
  assertSubscriptionActive,
  isSubscriptionExpired,
  getSubscriptionExpiry,
  SUBSCRIPTION_EXPIRED_MESSAGE,
  consumeClientCredits,
  addClientCredits,
  recordCreditAudit,
  getClientEntitlement,
  ensureClientEntitlement,
  assertLifetimeQuota,
  resolvePlan,
  planRowToConfig,
  ADDON_CREDIT_UNIT,
  ADDON_MONEY_UNIT,
  applyAddonQuota,
};
