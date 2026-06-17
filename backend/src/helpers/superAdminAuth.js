const SuperAdmin = require("../models/SuperAdmin");
const User = require("../models/User");
const { permissionCatalog, normalizePermissionArray } = require("./permissions");

const superAdminPermission = normalizePermissionArray(
  permissionCatalog.flatMap((moduleItem) => moduleItem.permissions.map((item) => item.key)),
);

const superAdminAllowed = permissionCatalog.map((moduleItem) => moduleItem.allowedKey);

const toSuperAdminProfile = (record) => {
  if (!record) {
    return null;
  }

  return {
    appId: record.appId,
    clientId: "",
    clientName: "",
    name: record.name,
    fullname: record.fullname || record.name,
    email: record.email,
    phone: record.phone || "",
    title: record.title || "Super Admin",
    department: record.department || "Platform",
    role: "super_admin",
    roleName: record.roleName || "Super Admin",
    permission: superAdminPermission,
    allowed: superAdminAllowed,
    useRoleDefaults: true,
    status: record.status === "inactive" ? "inactive" : "active",
    lastActive: record.lastActive || "Today",
    isUnreadNotifications: Boolean(record.isUnreadNotifications),
    image: record.image || "/branding/avatar.png",
    passwordHash: record.passwordHash,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
};

const findSuperAdminByEmail = async (email) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  const superAdmin = await SuperAdmin.findOne({ email: normalizedEmail }).lean();
  if (superAdmin) {
    return toSuperAdminProfile(superAdmin);
  }

  const legacyUser = await User.findOne({ email: normalizedEmail, role: "super_admin" }).lean();
  return toSuperAdminProfile(legacyUser);
};

const findSuperAdminByAppId = async (appId, options = {}) => {
  const normalizedAppId = String(appId || "").trim();
  if (!normalizedAppId) {
    return null;
  }

  // When excludeImage is set (the per-request auth-resolution path), skip
  // pulling the large base64 `image` field over the wire on every request.
  const projection = options.excludeImage ? { image: 0 } : null;

  const superAdmin = await SuperAdmin.findOne({ appId: normalizedAppId }, projection).lean();
  if (superAdmin) {
    return toSuperAdminProfile(superAdmin);
  }

  const legacyUser = await User.findOne({ appId: normalizedAppId, role: "super_admin" }, projection).lean();
  return toSuperAdminProfile(legacyUser);
};

const resolveSuperAdminAccess = async (record) => {
  return {
    roleName: record?.roleName || "Super Admin",
    permission: superAdminPermission,
    allowed: superAdminAllowed,
  };
};

module.exports = {
  findSuperAdminByEmail,
  findSuperAdminByAppId,
  resolveSuperAdminAccess,
  toSuperAdminProfile,
  superAdminPermission,
  superAdminAllowed,
};
