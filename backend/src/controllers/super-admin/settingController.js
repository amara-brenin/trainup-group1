const Setting = require("../../models/Setting");
const { ok, fail } = require("../../helpers/response");

const getGlobalSettings = async (req, res) => {
  const globalCosts = await Setting.findOne({ key: "GLOBAL_CREDIT_COSTS" }).lean();
  return ok(res, "Global settings loaded.", {
    creditCosts: globalCosts?.value || { training: 500, session: 100, user: 200 },
  });
};

const updateGlobalSettings = async (req, res) => {
  const { creditCosts } = req.body;
  if (!creditCosts) {
    return fail(res, 400, "Credit costs configuration is required.");
  }

  await Setting.findOneAndUpdate(
    { key: "GLOBAL_CREDIT_COSTS" },
    { value: creditCosts },
    { upsert: true, new: true }
  );

  return ok(res, "Global settings updated.");
};

module.exports = {
  getGlobalSettings,
  updateGlobalSettings,
};
