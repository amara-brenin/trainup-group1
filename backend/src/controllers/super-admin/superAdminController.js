const SuperAdmin = require("../../models/SuperAdmin");
const User = require("../../models/User");
const Notification = require("../../models/Notification");
const { hashPassword } = require("../../helpers/auth");
const { issuePasswordEmail } = require("../../services/authService");
const { notifyUserIds, notifySuperAdmins } = require("../../helpers/notifications");
const { ok, fail } = require("../../helpers/response");
const { isValidEmail, isValidPhone } = require("../../helpers/validation");
const { resolveImageField } = require("../../helpers/imageStorage");

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

const sanitizeSuperAdmin = (user) => ({
  id: user.appId,
  name: user.fullname || user.name || "",
  email: user.email || "",
  phone: user.phone || "",
  status: user.status === "inactive" ? "inactive" : "active",
  image: user.image || "/branding/avatar.png",
  createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : new Date().toISOString(),
});

const validateSuperAdmin = (values, existingUsers, currentId) => {
  const errors = {};

  if (!String(values.name || "").trim()) {
    errors.name = "Name is required.";
  }

  if (!isValidEmail(values.email)) {
    errors.email = "Use a valid email address.";
  }

  if (!String(values.phone || "").trim()) {
    errors.phone = "Mobile is required.";
  } else if (!isValidPhone(values.phone)) {
    errors.phone = "Enter a valid mobile number (digits only).";
  }

  const duplicate = existingUsers.find(
    (user) => String(user.email || "").toLowerCase() === String(values.email || "").trim().toLowerCase() && user.appId !== currentId,
  );

  if (duplicate) {
    errors.email = "Email already exists.";
  }

  return errors;
};

const list = async (req, res) => {
  const query = String(req.query.query || "").trim();
  // Exclude only the sensitive passwordHash. The avatar `image` is kept so the
  // Staff table can render it — avatars are stored as small S3 URLs (see
  // create/update's resolveImageField), so this stays light.
  const SAFE_PROJECTION = { passwordHash: 0 };
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const searchFilter = query
    ? { $or: ["fullname", "name", "email", "phone", "status"].map((field) => ({ [field]: { $regex: escaped, $options: "i" } })) }
    : {};

  const [dedicatedSuperAdmins, legacySuperAdmins] = await Promise.all([
    SuperAdmin.find(searchFilter, SAFE_PROJECTION).sort({ createdAt: -1 }).lean(),
    User.find({ role: "super_admin", ...searchFilter }, SAFE_PROJECTION).sort({ createdAt: -1 }).lean(),
  ]);
  const allSuperAdmins = [...dedicatedSuperAdmins, ...legacySuperAdmins]
    .filter((record, index, list) => list.findIndex((item) => item.appId === record.appId || item.email === record.email) === index)
    .map(sanitizeSuperAdmin);

  return ok(res, "Super admins loaded.", paginate(allSuperAdmins, req.query));
};

const create = async (req, res) => {
  const existingUsers = [
    ...(await User.find({}).lean()),
    ...(await SuperAdmin.find({}).lean()),
  ];
  const errors = validateSuperAdmin(req.body, existingUsers, null);

  if (Object.keys(errors).length) {
    return fail(res, 400, "Please correct the highlighted fields.", errors);
  }

  const appId = `user-super-${Date.now()}`;
  // Storage migration: a base64 avatar upload is pushed to S3 and stored as a
  // URL (light); an existing URL / static path is kept as-is.
  const resolvedImage = (await resolveImageField(req.body.image, "super-admin-avatars")) || "/branding/avatar.png";
  const record = await SuperAdmin.create({
    appId,
    name: String(req.body.name || "").trim(),
    fullname: String(req.body.name || "").trim(),
    email: String(req.body.email || "").trim().toLowerCase(),
    role: "super_admin",
    roleName: "Super Admin",
    permission: [],
    allowed: [],
    useRoleDefaults: true,
    status: req.body.status === "inactive" ? "inactive" : "active",
    lastActive: "Just now",
    isUnreadNotifications: false,
    image: resolvedImage,
    phone: String(req.body.phone || "").trim(),
    title: "Super Admin",
    department: "Platform",
    passwordHash: hashPassword(`pending-super-admin-${appId}`),
    isActivated: false,
    activatedAt: null,
  });

  await issuePasswordEmail({
    req,
    user: record,
    purpose: "set_password",
    forcePlatform: true,
    createdBy: req.user?.appId || "",
  });

  await notifyUserIds([record.appId], {
    title: "Super admin access granted",
    message: "You can now manage platform-wide clients, plans, and administration.",
    category: "users",
    severity: "success",
    link: "/dashboard",
    actorName: req.user?.fullname || req.user?.name || "",
  });

  await notifySuperAdmins(
    {
      title: "New super admin added",
      message: `${record.fullname || record.name} can now access the platform control panel.`,
      category: "users",
      severity: "info",
      link: "/staff",
      actorName: req.user?.fullname || req.user?.name || "",
    },
    { excludeUserId: record.appId },
  );

  return ok(res, "Super admin created successfully.", sanitizeSuperAdmin(record.toObject()));
};

const update = async (req, res) => {
  const targetUser =
    (await SuperAdmin.findOne({ appId: req.params.id })) ||
    (await User.findOne({ appId: req.params.id, role: "super_admin" }));

  if (!targetUser) {
    return fail(res, 404, "Super admin not found.");
  }

  const existingUsers = [
    ...(await User.find({}).lean()),
    ...(await SuperAdmin.find({}).lean()),
  ];
  const errors = validateSuperAdmin(req.body, existingUsers, targetUser.appId);

  if (Object.keys(errors).length) {
    return fail(res, 400, "Please correct the highlighted fields.", errors);
  }

  targetUser.name = String(req.body.name || "").trim();
  targetUser.fullname = String(req.body.name || "").trim();
  targetUser.email = String(req.body.email || "").trim().toLowerCase();
  targetUser.phone = String(req.body.phone || "").trim();
  targetUser.status = req.body.status === "inactive" ? "inactive" : "active";
  targetUser.image = (await resolveImageField(req.body.image, "super-admin-avatars")) || targetUser.image || "/branding/avatar.png";

  await targetUser.save();
  return ok(res, "Super admin updated successfully.", sanitizeSuperAdmin(targetUser.toObject()));
};

const remove = async (req, res) => {
  const targetUser =
    (await SuperAdmin.findOne({ appId: req.params.id }).lean()) ||
    (await User.findOne({ appId: req.params.id, role: "super_admin" }).lean());

  if (!targetUser) {
    return fail(res, 404, "Super admin not found.");
  }

  if (String(req.user?.appId || "") === String(targetUser.appId || "")) {
    return fail(res, 400, "You cannot remove your own account.");
  }

  const dedicatedCount = await SuperAdmin.countDocuments({});
  const legacyCount = await User.countDocuments({ role: "super_admin" });
  const totalSuperAdmins = dedicatedCount + legacyCount;
  if (totalSuperAdmins <= 1) {
    return fail(res, 400, "At least one super admin account must remain active.");
  }

  await SuperAdmin.deleteOne({ appId: req.params.id });
  await User.deleteOne({ appId: req.params.id, role: "super_admin" });
  await Notification.deleteMany({ userId: req.params.id });
  return ok(res, "Super admin removed successfully.", true);
};

const sendPasswordReset = async (req, res) => {
  const targetUser =
    (await SuperAdmin.findOne({ appId: req.params.id })) ||
    (await User.findOne({ appId: req.params.id, role: "super_admin" }));

  if (!targetUser) {
    return fail(res, 404, "Super admin not found.");
  }

  const result = await issuePasswordEmail({
    req,
    user: targetUser,
    purpose: targetUser.isActivated === false ? "set_password" : "reset_password",
    forcePlatform: true,
    createdBy: req.user?.appId || "",
  });

  if (!result.emailResult.success) {
    return fail(res, 500, "Password email could not be sent.", result.emailResult);
  }

  return ok(res, "Password email sent successfully.", {
    expiresAt: result.expiresAt,
  });
};

module.exports = {
  list,
  create,
  update,
  remove,
  sendPasswordReset,
};
