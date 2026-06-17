const { Schema, model, models } = require("mongoose");

const userSchema = new Schema(
  {
    appId: { type: String, required: true, unique: true, index: true },
    clientId: { type: String, default: "", index: true },
    clientName: { type: String, default: "" },
    name: { type: String, required: true, trim: true },
    fullname: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    role: { type: String, required: true, index: true },
    roleName: { type: String, required: true },
    permission: { type: [String], default: [] },
    allowed: { type: [String], default: [] },
    useRoleDefaults: { type: Boolean, default: true },
    status: { type: String, default: "active" },
    trainings: { type: Number, default: 0 },
    lastActive: { type: String, default: "Today" },
    usedCredits: { type: Number, default: 6380 },
    totalCredits: { type: Number, default: 10000 },
    isUnreadNotifications: { type: Boolean, default: false },
    image: { type: String, default: "/branding/avatar.png" },
    phone: { type: String, default: "" },
    title: { type: String, default: "" },
    department: { type: String, default: "" },
    authProvider: { type: String, default: "password" },
    googleId: { type: String, default: "", index: true },
    googleSubject: { type: String, default: "", index: true },
    passwordHash: { type: String, required: true },
    isActivated: { type: Boolean, default: true, index: true },
    activatedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

userSchema.index({ status: 1 });
userSchema.index({ clientId: 1, role: 1, status: 1 });
userSchema.index({ name: 1 });

module.exports = models.User || model("User", userSchema);
