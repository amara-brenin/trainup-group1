const crypto = require("crypto");
const Plan = require("../../models/Plan");
const PlanChangeLog = require("../../models/PlanChangeLog");
const Client = require("../../models/Client");
const CreditAuditLog = require("../../models/CreditAuditLog");
const AddonPurchaseLog = require("../../models/AddonPurchaseLog");
const { ok, fail } = require("../../helpers/response");
const { PLAN_CONFIGS } = require("../../helpers/credits");
const { notifyRolesInClient } = require("../../helpers/notifications");

const actorOf = (req) => req.user?.fullname || req.user?.name || req.user?.email || "Super Admin";

const planView = (row) => ({
  id: row.appId,
  code: row.code,
  name: row.name,
  price: row.price,
  discountPercentage: row.discountPercentage,
  credits: row.credits,
  validityDays: row.validityDays,
  features: row.features || [],
  active: row.active,
  updatedAt: row.updatedAt,
});

const PLAN_FIELDS = [
  "name", "price", "discountPercentage", "credits",
  "validityDays", "features", "active",
];
const pickFields = (body) => {
  const out = {};
  for (const f of PLAN_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  return out;
};

// GET /plans — list DB plans, seeding from PLAN_CONFIGS on first call so the
// panel is never empty (no hardcoded values thereafter).
const list = async (_req, res) => {
  let rows = await Plan.find({}).sort({ price: 1 }).lean();
  if (!rows.length) {
    const seeds = Object.values(PLAN_CONFIGS).map((cfg) => ({
      appId: `plan-${cfg.code.toLowerCase()}-${Date.now()}`,
      code: cfg.code,
      name: cfg.label === "ENTERPRISE" ? "Enterprise" : cfg.label,
      price: cfg.price,
      discountPercentage: 0,
      credits: cfg.monthlyCredits,
      validityDays: 30,
      features: cfg.label === "ENTERPRISE" ? [
        "Custom pricing and credit allocation",
        "Dedicated onboarding support",
        "Priority enterprise support",
        "Assigned manually by super admin after discussion"
      ] : [],
      active: true,
      createdBy: "system-seed",
    }));
    await Plan.insertMany(seeds);
    rows = await Plan.find({}).sort({ price: 1 }).lean();
  } else {
    // Check if ENTERPRISE plan is missing and auto-create it
    const hasEnterprise = rows.some((r) => r.code === "ENTERPRISE");
    if (!hasEnterprise) {
      const enterpriseSeed = {
        appId: `plan-enterprise-${Date.now()}`,
        code: "ENTERPRISE",
        name: "Enterprise",
        price: 0,
        discountPercentage: 0,
        credits: 0,
        validityDays: 30,
        features: [
          "Custom pricing and credit allocation",
          "Dedicated onboarding support",
          "Priority enterprise support",
          "Assigned manually by super admin after discussion"
        ],
        active: true,
        createdBy: "system-seed",
      };
      await Plan.create(enterpriseSeed);
      rows = await Plan.find({}).sort({ price: 1 }).lean();
    }
  }
  return ok(res, "Plans loaded.", { record: rows.map(planView) });
};

// The Enterprise tier is priced per-client via the Queries/custom-offer flow
// (see enterprise request accept/pay endpoints), not a fixed catalog price —
// so its code is reserved: only one row may ever hold it, and that row's
// name/price stay editable (see update() below).
const RESERVED_PLAN_CODE = "ENTERPRISE";

const create = async (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase();
  const name = String(req.body.name || "").trim();
  if (!code || !name) return fail(res, 400, "Plan code and name are required.");

  if (code === RESERVED_PLAN_CODE) {
    const existing = await Plan.findOne({ code: RESERVED_PLAN_CODE });
    if (existing) return fail(res, 400, "An Enterprise plan already exists and cannot be duplicated.");
  }

  const appId = `plan-${code.toLowerCase()}-${crypto.randomBytes(3).toString("hex")}`;
  const row = await Plan.create({ appId, code, ...pickFields(req.body), createdBy: actorOf(req) });
  await PlanChangeLog.create({ planId: appId, code, action: "created", previousValues: null, newValues: planView(row), changedBy: actorOf(req) });
  return ok(res, "Plan created.", { plan: planView(row) });
};

const update = async (req, res) => {
  const row = await Plan.findOne({ appId: req.params.id });
  if (!row) return fail(res, 404, "Plan not found.");
  const before = planView(row);
  const fields = pickFields(req.body);

  // Enterprise details can now be fully changed by the super admin from the dashboard.
  Object.assign(row, fields, { updatedBy: actorOf(req) });
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

// DELETE /plans/:id — hard-delete the plan row. Existing subscribers aren't
// pinned to it by reference (Client.plan just stores the code string), so
// resolvePlan() safely falls back to the hardcoded PLAN_CONFIGS afterward —
// same as what already happens for a plan whose code doesn't match any DB
// row. The change log entry is kept for audit history even after deletion.
const remove = async (req, res) => {
  const row = await Plan.findOne({ appId: req.params.id });
  if (!row) return fail(res, 404, "Plan not found.");

  if (row.code === RESERVED_PLAN_CODE) {
    return fail(res, 400, "The Enterprise plan cannot be deleted.");
  }

  const before = planView(row);
  await Plan.deleteOne({ appId: req.params.id });
  await PlanChangeLog.create({ planId: row.appId, code: row.code, action: "deleted", previousValues: before, newValues: null, changedBy: actorOf(req) });
  return ok(res, "Plan deleted.", { id: row.appId });
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

// GET /enterprise-requests — flatten every client's enterpriseRequests array
// into rows for the super-admin "Queries" tab. Centralizes what used to be
// shown piecemeal on each client's own Billing tab (see ClientDetail.tsx).
const listEnterpriseRequests = async (_req, res) => {
  const clients = await Client.find(
    { "enterpriseRequests.0": { $exists: true } },
    { appId: 1, name: 1, enterpriseRequests: 1 },
  ).lean();

  const rows = [];
  for (const client of clients) {
    for (const request of client.enterpriseRequests || []) {
      rows.push({
        clientId: client.appId,
        clientName: client.name,
        requestId: request.id,
        requestedAt: request.requestedAt,
        requestedByName: request.requestedByName,
        requestedByEmail: request.requestedByEmail,
        message: request.message || "",
        approxUsers: request.approxUsers ?? null,
        approxTrainings: request.approxTrainings ?? null,
        approxSessions: request.approxSessions ?? null,
        approxBudget: request.approxBudget ?? null,
        status: request.status,
        offerPrice: request.offerPrice ?? null,
        offerCredits: request.offerCredits ?? null,
        offerValidityDays: request.offerValidityDays ?? null,
        rejectReason: request.rejectReason || "",
        resolvedAt: request.resolvedAt || null,
      });
    }
  }

  rows.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());

  return ok(res, "Enterprise requests loaded.", { record: rows });
};

// POST /enterprise-requests/:clientId/:requestId/offer — super admin sets a
// custom price/credits/validity and sends it to the client as a payable
// offer. Credits are NOT granted yet — that only happens once the client
// "pays" (see commonController.payEnterpriseOffer), mirroring the same
// confirm-then-purchase pattern used for the regular plan checkout.
const sendEnterpriseOffer = async (req, res) => {
  const client = await Client.findOne({ appId: req.params.clientId });
  if (!client) return fail(res, 404, "Client not found.");

  const requests = Array.isArray(client.enterpriseRequests) ? client.enterpriseRequests : [];
  const request = requests.find((item) => item.id === req.params.requestId);
  if (!request) return fail(res, 404, "Enterprise request not found.");
  if (request.status !== "pending") return fail(res, 400, `This request is already ${request.status}.`);

  const price = Math.max(0, Number(req.body.price || 0));
  const credits = Math.max(0, Number(req.body.credits || 0));
  const validityDays = Math.max(1, Number(req.body.validityDays || 30));
  if (!credits) return fail(res, 400, "Enter the custom credits to grant.");

  request.status = "offer_sent";
  request.offerPrice = price;
  request.offerCredits = credits;
  request.offerValidityDays = validityDays;
  request.offeredAt = new Date().toISOString();
  request.offeredBy = actorOf(req);

  client.markModified("enterpriseRequests");
  await client.save();

  await notifyRolesInClient({
    clientId: client.appId,
    roles: ["admin"],
    payload: {
      title: "Your Enterprise offer is ready",
      message: price
        ? `Custom Enterprise offer: ${credits.toLocaleString()} credits for ${price.toLocaleString()}. Review and pay to activate.`
        : `Custom Enterprise offer: ${credits.toLocaleString()} credits. Review and confirm to activate.`,
      category: "billing",
      severity: "success",
      link: "/upgrade-billings",
      actorName: actorOf(req),
    },
  });

  return ok(res, "Offer sent to the client.", { clientId: client.appId, requestId: request.id });
};

// POST /enterprise-requests/:clientId/:requestId/reject
const rejectEnterpriseRequest = async (req, res) => {
  const client = await Client.findOne({ appId: req.params.clientId });
  if (!client) return fail(res, 404, "Client not found.");

  const requests = Array.isArray(client.enterpriseRequests) ? client.enterpriseRequests : [];
  const request = requests.find((item) => item.id === req.params.requestId);
  if (!request) return fail(res, 404, "Enterprise request not found.");
  if (request.status !== "pending" && request.status !== "offer_sent") {
    return fail(res, 400, `This request is already ${request.status}.`);
  }

  request.status = "rejected";
  request.rejectReason = String(req.body.reason || "").trim();
  request.resolvedAt = new Date().toISOString();

  client.markModified("enterpriseRequests");
  await client.save();

  await notifyRolesInClient({
    clientId: client.appId,
    roles: ["admin"],
    payload: {
      title: "Enterprise request declined",
      message: request.rejectReason || "Your enterprise pricing request could not be approved at this time.",
      category: "billing",
      severity: "warning",
      link: "/upgrade-billings",
      actorName: actorOf(req),
    },
  });

  return ok(res, "Request declined.", { clientId: client.appId, requestId: request.id });
};

module.exports = {
  list, create, update, remove, setStatus, history, billingInsights,
  listEnterpriseRequests, sendEnterpriseOffer, rejectEnterpriseRequest,
};
