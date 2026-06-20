const { Schema, model, models } = require("mongoose");

// Append-only audit trail for admin impersonation (Super Admin -> Client Admin,
// Client Admin -> User, and restore). Purely additive: it never touches the
// existing auth flow. Each row also briefly holds a single-use cross-app
// "handoff" so a signed impersonation JWT never travels in a URL.
const impersonationAuditSchema = new Schema(
  {
    appId: { type: String, required: true, unique: true, index: true }, // audit record id
    actorId: { type: String, required: true, index: true }, // who initiated the action (effective identity)
    actorRole: { type: String, default: "" },
    targetId: { type: String, required: true, index: true }, // identity being entered (or returned to)
    targetRole: { type: String, default: "" },
    clientId: { type: String, default: "", index: true },
    action: {
      type: String,
      required: true,
      enum: [
        "SUPER_ADMIN_LOGIN_AS_CLIENT_ADMIN",
        "CLIENT_ADMIN_LOGIN_AS_USER",
        "SUPER_ADMIN_LOGIN_AS_USER",
        "RESTORE_SESSION",
      ],
      index: true,
    },
    rootId: { type: String, default: "" }, // original logged-in actor at the bottom of the chain
    rootRole: { type: String, default: "" },
    level: { type: Number, default: 1 }, // impersonation depth (1 = first hop, 2 = SA->CA->User)
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },

    // Single-use cross-app handoff (keeps the JWT out of the redirect URL).
    handoffCode: { type: String, default: null, index: true },
    handoffToken: { type: String, default: "" }, // the signed impersonation JWT, returned once on exchange
    handoffExpiresAt: { type: Date, default: null },
    handoffConsumedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

impersonationAuditSchema.index({ rootId: 1, startedAt: -1 });
impersonationAuditSchema.index({ clientId: 1, startedAt: -1 });

module.exports = models.ImpersonationAudit || model("ImpersonationAudit", impersonationAuditSchema);
