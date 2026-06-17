const crypto = require("crypto");
const Plan = require("../../models/Plan");
const PlanChangeLog = require("../../models/PlanChangeLog");
const Client = require("../../models/Client");
const CreditAuditLog = require("../../models/CreditAuditLog");
const AddonPurchaseLog = require("../../models/AddonPurchaseLog");
const { ok, fail } = require("../../helpers/response");
const { PLAN_CONFIGS } = require("../../helpers/credits");

const actorOf = (req) => req.user?.fullname || req.user?.name || req.user?.email || "Super Admin";

const planView = (row) => ({
  id: row.appId,
  code: row.code,
  name: row.name,
  monthlyPrice: row.monthlyPrice,
  yearlyPrice: row.yearlyPrice,
  credits: row.credits,
  trainingLimit: row.trainingLimit,
  sessionLimit: row.sessionLimit,
  userLimit: row.userLimit,
  validityDays: row.validityDays,
  features: row.features || [],
  active: row.active,
  updatedAt: row.updatedAt,
});

const PLAN_FIELDS = [
  "name", "monthlyPrice", "yearlyPrice", "credits",
  "trainingLimit", "sessionLimit", "userLimit", "validityDays", "features", "active",
];
const pickFields = (body) => {
  const out = {};
  for (const f of PLAN_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  return out;
};

// GET /plans — list DB plans, seeding from PLAN_CONFIGS on first call so the
// panel is never empty (no hardcoded values thereafter).
const list = async (_req, res) => {
  let rows = await Plan.find({}).sort({ monthlyPrice: 1 }).lean();
  if (!rows.length) {
    const seeds = Object.values(PLAN_CONFIGS).map((cfg) => ({
      appId: `plan-${cfg.code.toLowerCase()}-${Date.now()}`,
      code: cfg.code,
      name: cfg.label,
      monthlyPrice: cfg.monthlyPrice,
      yearlyPrice: cfg.monthlyPrice * 10,
      credits: cfg.monthlyCredits,
      trainingLimit: cfg.limits.trainings ?? null,
      sessionLimit: cfg.limits.sessions ?? null,
      userLimit: cfg.limits.users ?? null,
      validityDays: 30,
      features: [],
      active: true,
      createdBy: "system-seed",
    }));
    await Plan.insertMany(seeds);
    rows = await Plan.find({}).sort({ monthlyPrice: 1 }).lean();
  }
  return ok(res, "Plans loaded.", { record: rows.map(planView) });
};

const create = async (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase();
  const name = String(req.body.name || "").trim();
  if (!code || !name) return fail(res, 400, "Plan code and name are required.");
  const appId = `plan-${code.toLowerCase()}-${crypto.randomBytes(3).toString("hex")}`;
  const row = await Plan.create({ appId, code, ...pickFields(req.body), createdBy: actorOf(req) });
  await PlanChangeLog.create({ planId: appId, code, action: "created", previousValues: null, newValues: planView(row), changedBy: actorOf(req) });
  return ok(res, "Plan created.", { plan: planView(row) });
};

const update = async (req, res) => {
  const row = await Plan.findOne({ appId: req.params.id });
  if (!row) return fail(res, 404, "Plan not found.");
  const before = planView(row);
  Object.assign(row, pickFields(req.body), { updatedBy: actorOf(req) });
  await row.save();
  await PlanChangeLog.create({ planId: row.appId, code: row.code, action: "updated", previousValues: before, newValues: planView(row), changedBy: actorOf(req) });
  return ok(res, "Plan updated. Existing subscribers keep their snapshot.", { plan: planView(row) });
};

const setStatus = async (req, res) => {
  const row = await Plan.findOne({ appId: req.params.id });
  if (!row) return fail(res, 404, "Plan not found.");
  const before = planView(row);
  row.active = Boolean(req.body.active);
  row.updatedBy = actorOf(req);
  await row.save();
  await PlanChangeLog.create({
    planId: row.appId, code: row.code, action: row.active ? "activated" : "deactivated",
    previousValues: before, newValues: planView(row), changedBy: actorOf(req),
  });
  return ok(res, `Plan ${row.active ? "activated" : "deactivated"}.`, { plan: planView(row) });
};

const history = async (req, res) => {
  const rows = await PlanChangeLog.find({ planId: req.params.id }).sort({ changedAt: -1 }).lean();
  return ok(res, "Plan change history loaded.", {
    record: rows.map((r) => ({
      id: String(r._id), action: r.action, changedBy: r.changedBy, changedAt: r.changedAt,
      previousValues: r.previousValues, newValues: r.newValues,
    })),
  });
};

// Phase E / Task 5: aggregate billing insights for the super-admin dashboard.
// Phase G: replaced full-collection loads with MongoDB aggregation pipelines.
const billingInsights = async (_req, res) => {
  const [clientsByPlanAgg, planStatusAgg, addonAgg, creditAgg] = await Promise.all([
    Client.aggregate([
      { $group: { _id: { $toUpper: { $ifNull: ["$plan", "FREE"] } }, count: { $sum: 1 } } },
    ]),
    Plan.aggregate([
      { $group: { _id: "$active", count: { $sum: 1 } } },
    ]),
    AddonPurchaseLog.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          revenue: { $sum: { $ifNull: ["$totalCost", 0] } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    CreditAuditLog.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$timestamp" } },
          consumed: { $sum: { $cond: [{ $lt: ["$creditChange", 0] }, { $abs: "$creditChange" }, 0] } },
          purchased: { $sum: { $cond: [{ $gt: ["$creditChange", 0] }, "$creditChange", 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const clientsByPlan = {};
  for (const row of clientsByPlanAgg) clientsByPlan[row._id || "FREE"] = row.count;

  const planStatusMap = new Map(planStatusAgg.map((r) => [r._id, r.count]));
  const activePlans = planStatusMap.get(true) || 0;
  const disabledPlans = planStatusMap.get(false) || 0;

  let totalAddonRevenue = 0;
  let totalAddonPurchases = 0;
  const addonRevenueByMonth = {};
  for (const row of addonAgg) {
    totalAddonRevenue += row.revenue;
    totalAddonPurchases += row.count;
    addonRevenueByMonth[row._id] = row.revenue;
  }

  let creditsConsumed = 0;
  let creditsPurchased = 0;
  const creditsByMonth = {};
  for (const row of creditAgg) {
    creditsConsumed += row.consumed;
    creditsPurchased += row.purchased;
    creditsByMonth[row._id] = { consumed: row.consumed, purchased: row.purchased };
  }

  return ok(res, "Billing insights loaded.", {
    clientsByPlan,
    activePlans,
    disabledPlans,
    totalAddonPurchases,
    totalAddonRevenue: totalAddonRevenue,
    creditsConsumed,
    creditsPurchased,
    addonRevenueByMonth,
    creditsByMonth,
  });
};

module.exports = { list, create, update, setStatus, history, billingInsights };
