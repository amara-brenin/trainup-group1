const express = require("express");

const clientController = require("../controllers/super-admin/clientController");
const superAdminController = require("../controllers/super-admin/superAdminController");
const planController = require("../controllers/super-admin/planController");
const impersonationController = require("../controllers/impersonationController");
const { authTokenAdmin, allowRoles } = require("../middelwares");

const settingController = require("../controllers/super-admin/settingController");

const router = express.Router();

router.use(authTokenAdmin);
router.use(allowRoles("super_admin"));

router.get("/settings/billing", settingController.getGlobalSettings);
router.put("/settings/billing", settingController.updateGlobalSettings);

// Phase C: dynamic plan management.
router.get("/plans", planController.list);
router.post("/plans", planController.create);
router.put("/plans/:id", planController.update);
router.delete("/plans/:id", planController.remove);
router.patch("/plans/:id/status", planController.setStatus);
router.get("/plans/:id/history", planController.history);
router.get("/billing/insights", planController.billingInsights);

// Enterprise inquiry queue — centralized across all clients (see PlanManagement's
// sibling "Queries" tab), replacing the old per-client display on ClientDetail.
router.get("/enterprise-requests", planController.listEnterpriseRequests);
router.post("/enterprise-requests/:clientId/:requestId/offer", planController.sendEnterpriseOffer);
router.post("/enterprise-requests/:clientId/:requestId/reject", planController.rejectEnterpriseRequest);

router.get("/clients", clientController.list);
router.post("/clients", clientController.create);
router.get("/clients/:id", clientController.getOne);
router.put("/clients/:id", clientController.update);
router.delete("/clients/:id", clientController.remove);
router.put("/clients/:id/settings", clientController.updateSettings);
router.post("/clients/:id/webhook-test", clientController.testWebhook);
router.post("/clients/:id/domain-verify", clientController.verifyDomain);
router.post("/clients/:id/smtp-test", clientController.testSmtp);
router.post("/clients/:id/client-admin/password-email", clientController.sendClientAdminPasswordEmail);
router.get("/super-admins", superAdminController.list);
router.post("/super-admins", superAdminController.create);
router.put("/super-admins/:id", superAdminController.update);
router.post("/super-admins/:id/password-email", superAdminController.sendPasswordReset);
router.delete("/super-admins/:id", superAdminController.remove);

// FEATURE 1: Super Admin → Client Admin impersonation.
router.post("/impersonate/client/:clientId", impersonationController.impersonateClient);

module.exports = router;
