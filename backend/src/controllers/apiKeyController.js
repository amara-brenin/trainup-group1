const ApiKey = require("../models/ApiKey");
const { ok, fail } = require("../helpers/response");
const { getTenantClientId } = require("../helpers/tenant");

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

const contains = (value, query) => String(value || "").toLowerCase().includes(String(query || "").trim().toLowerCase());
const applyApiKeyListControls = (records, queryParams) => {
  const query = String(queryParams.query || "").trim();
  const permission = String(queryParams.permission || "all").trim();
  const sortBy = String(queryParams.sortBy || "created").trim();

  const filtered = records.filter((record) => {
    const matchesQuery = [record.name, record.permission, record.lastUsed].some((value) => contains(value, query));
    const matchesPermission = permission === "all" || record.permission === permission;
    return matchesQuery && matchesPermission;
  });

  return [...filtered].sort((left, right) => {
    if (sortBy === "name") {
      return String(left.name || "").localeCompare(String(right.name || ""));
    }
    if (sortBy === "permission") {
      return String(left.permission || "").localeCompare(String(right.permission || "")) || String(left.name || "").localeCompare(String(right.name || ""));
    }
    if (sortBy === "calls") {
      return Number(right.callsToday || 0) - Number(left.callsToday || 0);
    }
    return String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
  });
};
const createApiKey = (name) =>
  `sk_live_${String(name).toLowerCase().replace(/\s+/g, "_")}_${Math.random().toString(36).slice(2, 16)}`;

const toApiKeyRecord = (key) => ({
  id: key.appId,
  name: key.name,
  key: key.key,
  permission: key.permission,
  createdAt: key.createdAtLabel,
  lastUsed: key.lastUsed,
  callsToday: key.callsToday,
  status: key.status,
});

const list = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const allKeys = (await ApiKey.find({ clientId, status: "active" }).sort({ createdAt: -1 }).lean()).map(toApiKeyRecord);
  const filtered = applyApiKeyListControls(allKeys, req.query);
  return ok(res, "API keys loaded.", paginate(filtered, req.query));
};

const create = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  if (!String(req.body.name || "").trim()) {
    return fail(res, 400, "Please correct the highlighted fields.", {
      name: "Key name is required.",
    });
  }

  const record = await ApiKey.create({
    appId: `key-${Date.now()}`,
    clientId,
    name: String(req.body.name).trim(),
    key: createApiKey(req.body.name),
    permission: req.body.permission || "Read Only",
    createdAtLabel: new Date().toISOString().slice(0, 10),
    lastUsed: "Never",
    callsToday: 0,
    status: "active",
  });

  return ok(res, "API key generated successfully.", toApiKeyRecord(record.toObject()));
};

const revoke = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const record = await ApiKey.findOne({ appId: req.params.id, clientId });

  if (!record) {
    return fail(res, 404, "API key not found.");
  }

  record.status = "revoked";
  await record.save();
  return ok(res, "API key revoked successfully.", true);
};

module.exports = {
  list,
  create,
  revoke,
};
