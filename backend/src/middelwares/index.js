const authTokenAdmin = require("./authTokenAdmin");
const errorHandler = require("./errorHandler");
const { fail } = require("../helpers/response");

const allowRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return fail(res, 403, "You do not have permission to access this resource.");
  }

  return next();
};

const allowAccess = (permissionKey, allowedKey) => (req, res, next) => {
  const permission = req.access?.permission || [];
  const allowed = req.access?.allowed || [];

  const hasAccess =
    (!permissionKey || permission.includes(permissionKey)) &&
    (!allowedKey || allowed.includes(allowedKey));

  if (!hasAccess) {
    return fail(res, 403, "You do not have permission to access this resource.");
  }

  return next();
};

module.exports = {
  authTokenAdmin,
  errorHandler,
  allowRoles,
  allowAccess,
};
