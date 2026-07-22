const express = require("express");
const config = require("../config");

const authController = require("../controllers/authController");
const commonController = require("../controllers/commonController");
const notificationsController = require("../controllers/notificationsController");
const userController = require("../controllers/userController");
const impersonationController = require("../controllers/impersonationController");
const roleController = require("../controllers/roleController");
const apiKeyController = require("../controllers/apiKeyController");
const workspaceController = require("../controllers/workspaceController");
const mediaController = require("../controllers/mediaController");
const settingsController = require("../controllers/settingsController");
const emailCenterController = require("../controllers/emailCenterController");
const groupSessionController = require("../controllers/groupSessionController");
const launchController = require("../controllers/launchController");
const { joinLimiter } = require("../middelwares/rateLimit");
const { authTokenAdmin, allowAccess, allowRoles } = require("../middelwares");

const router = express.Router();

router.use(authTokenAdmin);

router.get("/profile", authController.profile);
// FEATURE 3: return flow — available to ANY impersonated session (incl. a
// trainee with no module permissions), so no allowAccess guard here.
router.post("/auth/restore-session", impersonationController.restoreSession);
router.get("/notifications", notificationsController.list);
router.post("/notifications/read", notificationsController.markRead);
router.post("/notifications/read-all", notificationsController.markAllRead);
router.put("/profile", allowAccess("profile.edit", "profile"), authController.updateProfile);
router.get("/dashboard", allowAccess("dashboard.view", "dashboard"), commonController.dashboard);
router.get("/billing/summary", allowAccess("billing.view", "billing"), commonController.getBillingSummary);
router.get("/billing/credit-history", allowAccess("billing.view", "billing"), commonController.getCreditHistory);
router.get("/billing/plans", allowAccess("billing.view", "billing"), commonController.getBillingPlans);
router.post("/billing/addons/purchase", allowAccess("billing.manage", "billing"), commonController.purchaseAddon);
router.get("/billing/addons/history", allowAccess("billing.view", "billing"), commonController.getAddonHistory);
router.post("/billing/purchase", allowAccess("billing.manage", "billing"), commonController.purchaseCredits);
router.post("/billing/enterprise-request", allowAccess("billing.view", "billing"), commonController.requestEnterprisePlan);

router.get("/users", allowAccess("users.view", "users"), userController.list);
router.post("/users", allowAccess("users.add", "users"), userController.create);
router.put("/users/:id", allowAccess("users.edit", "users"), userController.update);
router.post("/users/:id/password-email", allowAccess("users.edit", "users"), userController.sendPasswordReset);
router.delete("/users/:id", allowAccess("users.delete", "users"), userController.remove);
// FEATURE 2: Client Admin (or SA-as-CA) → User impersonation.
router.post("/users/impersonate/:userId", allowAccess("users.view", "users"), impersonationController.impersonateUser);
router.get("/trainee/dashboard", allowRoles("trainee"), userController.getDashboardSessions);
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
// Webhook config + delivery logs live under the Integrations (settings) tab.
router.get("/webhooks", allowAccess("settings.view", "settings"), commonController.getWebhooks);
router.put("/webhooks", allowAccess("webhooks.edit", "webhooks"), commonController.updateWebhooks);
// Webhook config now lives under the Integrations (settings) tab, so align the
// test action with settings edit — whoever can save the webhook URL can test it.
router.post("/webhooks/test", allowAccess("settings.edit", "settings"), commonController.testWebhooks);
// LMS_INTEGRATION_RESEARCH.md (Method D): send a test xAPI statement to the LRS.
router.post("/xapi/test", allowAccess("settings.edit", "settings"), commonController.testXapi);
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
router.get("/training-workspace/:id", allowAccess(undefined, "trainingWorkspace"), workspaceController.getOne);
router.post("/training-workspace/:id/assign", allowAccess("training.assign", "trainingWorkspace"), workspaceController.assignTraining);
// LMS_INTEGRATION_RESEARCH.md (Method A/E): mint a signed external launch link.
// Open to any authenticated tenant user (authTokenAdmin already applied above);
// real authorization is in the controller — the training must belong to the
// caller's client AND be approved. This avoids 403s from tenant-customized
// module permissions (e.g. reviewer roles) while staying tenant-safe.
router.post("/training-workspace/:id/launch-url", launchController.createSecureLaunchUrl);
// LMS_INTEGRATION_RESEARCH.md (Method C): download a SCORM 1.2 dispatch package.
router.get("/training-workspace/:id/scorm-package", launchController.downloadScormPackage);
router.put("/training-workspace/sync", allowAccess(undefined, "trainingWorkspace"), workspaceController.sync);

// Group Training Hall — session management.
router.post("/training-workspace/:id/group-session", allowRoles("admin", "trainer", "super_admin"), groupSessionController.createGroupSession);
router.get("/training-workspace/:trainingId/group-report", allowRoles("admin", "trainer", "super_admin"), groupSessionController.getTrainingGroupReport);
router.get("/training/:trainingId/analytics", allowRoles("admin", "trainer", "super_admin"), groupSessionController.getTrainingAnalytics);
router.get("/group-sessions/:gsId/live", allowRoles("admin", "trainer", "super_admin"), groupSessionController.getLiveSnapshot);
router.get("/group-sessions/:gsId/report", allowRoles("admin", "trainer", "super_admin"), groupSessionController.getConsolidatedReport);
router.get("/group-sessions/:gsId/debug", allowRoles("admin", "trainer", "super_admin"), groupSessionController.debugSnapshot);
router.post("/group-sessions/:gsId/control", allowRoles("admin", "trainer", "super_admin"), groupSessionController.controlGroupSession);
router.get("/group/:gsId/host", allowRoles("admin", "trainer", "super_admin"), groupSessionController.bootstrapHost);
// Trainee join only needs a valid authenticated user (role checked in controller).
router.post("/group/:gsId/join", joinLimiter, groupSessionController.joinGroupSession);

router.post("/media/upload-url", allowAccess(undefined, "trainingWorkspace"), mediaController.createUploadSlot);
router.post(
  "/media/:id/upload",
  allowAccess(undefined, "trainingWorkspace"),
  // Match the allowed upload size (config.limits.maxUploadSizeMb, 50MB) plus a
  // small margin so raw .pptx/.pdf files aren't rejected by the body parser
  // before the controller's friendly size check runs. (Was 20mb → broke PPTX.)
  express.raw({ type: "*/*", limit: `${config.limits.maxUploadSizeMb + 5}mb` }),
  mediaController.uploadBinary,
);
// Server-side PPTX → slide images (LibreOffice + poppler). Raw .pptx body.
router.post(
  "/media/pptx-import",
  allowAccess(undefined, "trainingWorkspace"),
  express.raw({ type: "*/*", limit: `${config.limits.maxUploadSizeMb + 5}mb` }),
  mediaController.importPptx,
);
router.get("/media/:id/resolve", allowAccess(undefined, "trainingWorkspace"), mediaController.resolve);
router.delete("/media/:id", allowAccess(undefined, "trainingWorkspace"), mediaController.remove);

module.exports = router;
