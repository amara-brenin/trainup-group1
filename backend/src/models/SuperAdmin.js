const { Schema, model, models } = require("mongoose");

const superAdminSchema = new Schema(
  {
    appId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    fullname: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    role: { type: String, default: "super_admin", index: true },
    roleName: { type: String, default: "Super Admin" },
    permission: { type: [String], default: [] },
    allowed: { type: [String], default: [] },
    useRoleDefaults: { type: Boolean, default: true },
    status: { type: String, default: "active" },
    lastActive: { type: String, default: "Today" },
    isUnreadNotifications: { type: Boolean, default: false },
    image: { type: String, default: "/branding/avatar.png" },
    phone: { type: String, default: "" },
    title: { type: String, default: "Super Admin" },
    department: { type: String, default: "Platform" },
    passwordHash: { type: String, required: true },
    isActivated: { type: Boolean, default: true, index: true },
    activatedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

module.exports = models.SuperAdmin || model("SuperAdmin", superAdminSchema);
