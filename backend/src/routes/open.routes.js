const express = require("express");

const authController = require("../controllers/authController");
const commonController = require("../controllers/commonController");
const launchController = require("../controllers/launchController");
const narrationController = require("../controllers/narrationController");
const questionGeneratorController = require("../controllers/questionGeneratorController");
const ttsController = require("../controllers/ttsController");
const groupSessionController = require("../controllers/groupSessionController");
const { resolveLimiter, askLimiter } = require("../middelwares/rateLimit");

const router = express.Router();

router.get("/settings", authController.settings);
router.get("/health", commonController.health);
router.get("/tts/voices", ttsController.listVoices);
router.post("/tts/verify", ttsController.verifyApiKey);
router.post("/auth/login", authController.login);
router.post("/auth/google", authController.googleLogin);
router.post("/auth/logout", authController.logout);
router.get("/auth/password-token", authController.validateToken);
router.post("/auth/set-password", authController.setPassword);
router.post("/auth/forgot-password", authController.forgotPassword);
router.post("/auth/reset-password", authController.resetPassword);
router.post("/tts", ttsController.generate);
router.post("/narration", narrationController.generateNarration);
router.post("/question-generator", questionGeneratorController.buildQuestions);
router.get("/launch/trainings/:id/branding", launchController.getTrainingBranding);
router.get("/launch/trainings/:id", launchController.getTraining);
router.post("/launch/trainings/:id/session", launchController.upsertLaunchSession);
router.post("/launch/trainings/:id/ask", launchController.askQuestion);
router.post("/trulience", launchController.handleTrulienceEvent);

// Group Training Hall — public surfaces (token-scoped, no admin auth).
router.get("/group/:joinToken/resolve", resolveLimiter, groupSessionController.resolveJoin);
router.post("/group/:gsId/ask", askLimiter, groupSessionController.askGroupQuestion);

module.exports = router;
