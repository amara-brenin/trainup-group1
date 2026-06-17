const User = require("../models/User");
const Setting = require("../models/Setting");
const { verifyAuthToken, getBearerToken } = require("../helpers/auth");
const { getRoleDefinitions, resolveUserAccess } = require("../helpers/permissions");
const { findSuperAdminByAppId, resolveSuperAdminAccess } = require("../helpers/superAdminAuth");
const { fail } = require("../helpers/response");
const { getTenantSetting } = require("../helpers/tenant");

const authTokenAdmin = async (req, res, next) => {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return fail(res, 401, "Unauthorized.");
    }

    const payload = verifyAuthToken(token);

    if (!payload || !payload.sub) {
      return fail(res, 401, "Unauthorized.");
    }

    // Auth/permission resolution only needs identity + role/tenant fields —
    // exclude the large base64 `image` field so it isn't dragged from the DB
    // on every authenticated request. Endpoints that actually render the
    // avatar (e.g. /profile) fetch it explicitly with a targeted query.
    const user =
      payload.role === "super_admin"
        ? await findSuperAdminByAppId(payload.sub, { excludeImage: true })
        : await User.findOne({ appId: payload.sub }, { image: 0 }).lean();

    if (!user) {
      return fail(res, 401, "Unauthorized.");
    }

    if (user.status === "inactive" || user.isActivated === false) {
      return fail(res, 403, "Account is not active.");
    }

    req.user = user;
    if (user.role === "super_admin") {
      req.access = await resolveSuperAdminAccess(user);
      return next();
    }

    const roleSetting = user.clientId
      ? await getTenantSetting(user.clientId, "rolePermissions")
      : (await Setting.findOne({ key: "rolePermissions" }).lean())?.value;
    req.access = resolveUserAccess(user, getRoleDefinitions(roleSetting));
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = authTokenAdmin;
