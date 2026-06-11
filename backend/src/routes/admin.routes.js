const express = require("express");

const authController = require("../controllers/authController");
const commonController = require("../controllers/commonController");
const notificationsController = require("../controllers/notificationsController");
const userController = require("../controllers/userController");
const roleController = require("../controllers/roleController");
const apiKeyController = require("../controllers/apiKeyController");
const workspaceController = require("../controllers/workspaceController");
const mediaController = require("../controllers/mediaController");
const settingsController = require("../controllers/settingsController");
const emailCenterController = require("../controllers/emailCenterController");
const groupSessionController = require("../controllers/groupSessionController");
const { joinLimiter } = require("../middelwares/rateLimit");
const { authTokenAdmin, allowAccess, allowRoles } = require("../middelwares");

const router = express.Router();

router.use(authTokenAdmin);

router.get("/profile", authController.profile);
router.get("/notifications", notificationsController.list);
router.post("/notifications/read", notificationsController.markRead);
router.post("/notifications/read-all", notificationsController.markAllRead);
router.put("/profile", allowAccess("profile.edit", "profile"), authController.updateProfile);
router.get("/dashboard", allowAccess("dashboard.view", "dashboard"), commonController.dashboard);
router.get("/billing/summary", allowAccess("billing.view", "billing"), commonController.getBillingSummary);
router.post("/billing/purchase", allowAccess("billing.manage", "billing"), commonController.purchaseCredits);
router.post("/billing/enterprise-request", allowAccess("billing.view", "billing"), commonController.requestEnterprisePlan);

router.get("/users", allowAccess("users.view", "users"), userController.list);
router.post("/users", allowAccess("users.add", "users"), userController.create);
router.put("/users/:id", allowAccess("users.edit", "users"), userController.update);
router.post("/users/:id/password-email", allowAccess("users.edit", "users"), userController.sendPasswordReset);
router.delete("/users/:id", allowAccess("users.delete", "users"), userController.remove);
router.get("/trainees", allowAccess("trainees.view", "trainees"), userController.listTrainees);
router.get("/trainees/:id/sessions", allowAccess("trainees.report", "trainees"), userController.getTraineeSessions);
router.post("/trainees/:id/sessions/:trainingId/:sessionId/reopen", allowAccess("trainees.edit", "trainees"), userController.reopenTraineeSessionAttempt);
router.post("/trainees", allowAccess("trainees.add", "trainees"), userController.createTrainee);
router.post("/trainees/import", allowAccess("trainees.add", "trainees"), userController.importTrainees);
router.put("/trainees/:id", allowAccess("trainees.edit", "trainees"), userController.updateTrainee);
router.post("/trainees/:id/password-email", allowAccess("trainees.edit", "trainees"), userController.sendPasswordReset);
router.delete("/trainees/:id", allowAccess("trainees.delete", "trainees"), userController.removeTrainee);
router.get("/roles", allowAccess("roles.view", "roles"), roleController.list);
router.post("/roles", allowAccess("roles.edit", "roles"), roleController.create);
router.put("/roles/:id", allowAccess("roles.edit", "roles"), roleController.update);

router.get("/api-keys", allowAccess("api.view", "api"), apiKeyController.list);
router.post("/api-keys", allowAccess("api.generate", "api"), apiKeyController.create);
router.delete("/api-keys/:id", allowAccess("api.revoke", "api"), apiKeyController.revoke);

router.get("/api-config", allowAccess("api.view", "api"), commonController.getApiConfig);
router.put("/api-config", allowAccess("api.config.edit", "api"), commonController.updateApiConfig);
router.get("/webhooks", allowAccess("webhooks.view", "webhooks"), commonController.getWebhooks);
router.put("/webhooks", allowAccess("webhooks.edit", "webhooks"), commonController.updateWebhooks);
router.post("/webhooks/test", allowAccess("webhooks.replay", "webhooks"), commonController.testWebhooks);
router.post("/domains/verify", allowAccess("settings.edit", "settings"), commonController.verifyDomain);
router.post("/smtp/test", allowAccess("settings.edit", "settings"), commonController.testSmtp);
router.get("/iframe", allowAccess("iframe.view", "iframe"), commonController.getIframe);
router.put("/iframe", allowAccess("iframe.edit", "iframe"), commonController.updateIframe);
router.get("/tenant-settings", allowAccess("settings.view", "settings"), settingsController.getSettings);
router.put("/tenant-settings/:section", allowAccess("settings.edit", "settings"), settingsController.updateSettings);
router.get("/email-center", allowAccess("settings.view", "settings"), emailCenterController.getSettings);
router.put("/email-center", allowAccess("settings.edit", "settings"), emailCenterController.updateSettings);

router.get("/training-workspace", allowAccess(undefined, "trainingWorkspace"), workspaceController.list);
router.get("/training-workspace/capacity", allowAccess("training.create", "trainingWorkspace"), workspaceController.capacity);
router.get("/training-workspace/trainees", allowAccess("training.assign", "trainingWorkspace"), workspaceController.listAssignableTrainees);
router.post("/training-workspace/:id/assign", allowAccess("training.assign", "trainingWorkspace"), workspaceController.assignTraining);
router.put("/training-workspace/sync", allowAccess(undefined, "trainingWorkspace"), workspaceController.sync);

// Group Training Hall — session management.
router.post("/training-workspace/:id/group-session", allowRoles("admin", "trainer", "super_admin"), groupSessionController.createGroupSession);
router.get("/group-sessions/:gsId/live", allowRoles("admin", "trainer", "super_admin"), groupSessionController.getLiveSnapshot);
router.get("/group-sessions/:gsId/debug", allowRoles("admin", "trainer", "super_admin"), groupSessionController.debugSnapshot);
router.post("/group-sessions/:gsId/control", allowRoles("admin", "trainer", "super_admin"), groupSessionController.controlGroupSession);
router.get("/group/:gsId/host", allowRoles("admin", "trainer", "super_admin"), groupSessionController.bootstrapHost);
// Trainee join only needs a valid authenticated user (role checked in controller).
router.post("/group/:gsId/join", joinLimiter, groupSessionController.joinGroupSession);

router.post("/media/upload-url", allowAccess(undefined, "trainingWorkspace"), mediaController.createUploadSlot);
router.post(
  "/media/:id/upload",
  allowAccess(undefined, "trainingWorkspace"),
  express.raw({ type: "*/*", limit: "20mb" }),
  mediaController.uploadBinary,
);
router.get("/media/:id/resolve", allowAccess(undefined, "trainingWorkspace"), mediaController.resolve);
router.delete("/media/:id", allowAccess(undefined, "trainingWorkspace"), mediaController.remove);

module.exports = router;
