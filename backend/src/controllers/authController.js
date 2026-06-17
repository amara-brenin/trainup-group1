const crypto = require("crypto");
const User = require("../models/User");
const Client = require("../models/Client");
const Setting = require("../models/Setting");
const Training = require("../models/Training");
const SuperAdmin = require("../models/SuperAdmin");
const {
  getBearerToken,
  getRoleAccess,
  hashPassword,
  signAuthToken,
  sanitizeUserForClient,
  verifyAuthToken,
  verifyPassword,
} = require("../helpers/auth");
const { getRoleDefinitions } = require("../helpers/permissions");
const {
  findSuperAdminByAppId,
  findSuperAdminByEmail,
  resolveSuperAdminAccess,
} = require("../helpers/superAdminAuth");
const config = require("../config");
const { ok, fail } = require("../helpers/response");
const { buildDefaultTenantAppSettings, buildPlatformAppSettings, findClientByHostname, getRequestHostname, getTenantClientId, getTenantSetting } = require("../helpers/tenant");
const { isValidEmail } = require("../helpers/validation");
const { resolveImageField } = require("../helpers/imageStorage");
const {
  completePasswordToken,
  issuePasswordEmail,
  validatePasswordToken,
} = require("../services/authService");
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveRoleDefinitions = async (user) => {
  const roleSetting = user?.clientId
    ? await getTenantSetting(user.clientId, "rolePermissions")
    : (await Setting.findOne({ key: "rolePermissions" }).lean())?.value;
  return getRoleDefinitions(roleSetting);
};

// Only usedCredits/totalCredits/plan are read off this client by callers below —
// exclude the large base64 logo/favicon fields so they aren't fetched here.
const CLIENT_PROFILE_EXCLUSION = { logoUrl: 0, darkLogoUrl: 0, faviconUrl: 0, emailSignatureImageUrl: 0 };

const resolveClientForUser = async (user) => {
  const clientId = getTenantClientId(user);

  if (!clientId) {
    return null;
  }

  return Client.findOne({ appId: clientId }, CLIENT_PROFILE_EXCLUSION).lean();
};

const settings = async (req, res) => {
  const requestHostname = getRequestHostname(req);
  const defaultSettings = buildPlatformAppSettings(requestHostname);
  const token = getBearerToken(req);

  if (!token) {
    const publicClient = await findClientByHostname(requestHostname);
    if (publicClient) {
      return ok(res, "Settings loaded.", buildDefaultTenantAppSettings(publicClient));
    }

    return ok(res, "Settings loaded.", defaultSettings);
  }

  const payload = verifyAuthToken(token);
  if (!payload?.sub) {
    return ok(res, "Settings loaded.", defaultSettings);
  }

  // Only used below to resolve clientId — the avatar image is never rendered
  // from this lookup, so skip pulling it over the wire.
  const user =
    payload.role === "super_admin"
      ? await findSuperAdminByAppId(payload.sub, { excludeImage: true })
      : await User.findOne({ appId: payload.sub }, { image: 0 }).lean();
  const clientId = getTenantClientId(user);

  if (!user || !clientId) {
    const publicClient = await findClientByHostname(requestHostname);
    if (publicClient) {
      return ok(res, "Settings loaded.", buildDefaultTenantAppSettings(publicClient));
    }

    return ok(res, "Settings loaded.", defaultSettings);
  }

  const tenantAppSettings = await getTenantSetting(clientId, "appSettings");
  const client = await Client.findOne({ appId: clientId }).lean();
  return ok(res, "Settings loaded.", {
    ...defaultSettings,
    ...(client ? buildDefaultTenantAppSettings(client) : {}),
    ...tenantAppSettings,
  });
};

const login = async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "").trim();
  const superAdmin = await findSuperAdminByEmail(email);
  const user = superAdmin || (await User.findOne({ email }).lean());
  const isSuperAdmin = user?.role === "super_admin";
  const roleDefinitions = isSuperAdmin ? [] : await resolveRoleDefinitions(user);
  const client = isSuperAdmin ? null : await resolveClientForUser(user);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return fail(res, 401, "Invalid email or password.", {
      email: "",
      password: "Use valid internal Trainup credentials.",
    });
  }

  if (!isSuperAdmin) {
    const requestHostname = getRequestHostname(req);
    const domainClient = await findClientByHostname(requestHostname);
    
    if (domainClient && domainClient.appId !== user.clientId) {
      return fail(res, 403, "You cannot log in to this company's portal. Please use your company's portal.", {
        email: "Invalid portal access.",
      });
    }
  }

  if (user.status === "inactive") {
    return fail(res, 403, "This account is inactive. Contact your administrator.", {
      email: "Account is inactive.",
    });
  }

  if (user.isActivated === false) {
    return fail(res, 403, "Please activate your account from the Set Password email before signing in.", {
      email: "Account is not activated.",
    });
  }

  const token = signAuthToken({
    sub: user.appId,
    role: user.role,
    email: user.email,
    clientId: user.clientId || "",
  });

  if (isSuperAdmin) {
    await SuperAdmin.updateOne({ appId: user.appId }, { $set: { lastActive: "Today" } });
  } else {
    await User.updateOne({ appId: user.appId }, { $set: { lastActive: "Today" } });
  }

  return ok(res, "Login successful.", {
    token,
    user: sanitizeUserForClient(user, roleDefinitions, client),
  });
};

const verifyGoogleCredential = async (credential) => {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
  );

  if (!response.ok) {
    throw new Error("Google could not verify this sign-in credential.");
  }

  const payload = await response.json();
  const email = String(payload.email || "").trim().toLowerCase();
  const clientId = String(payload.aud || "").trim();
  const emailVerified = String(payload.email_verified || "").trim() === "true";
  const domain = email.split("@")[1] || "";

  if (!email || !emailVerified) {
    throw new Error("Google did not return a verified email address.");
  }

  if (config.google.clientId && clientId !== config.google.clientId) {
    throw new Error("This Google sign-in credential does not match the configured client.");
  }

  if (config.google.allowedDomains.length && !config.google.allowedDomains.includes(domain)) {
    throw new Error("This Google account domain is not allowed for trainee access.");
  }

  return {
    sub: String(payload.sub || "").trim(),
    email,
    name: String(payload.name || email.split("@")[0] || "Trainee").trim(),
    picture: String(payload.picture || "").trim(),
  };
};

const googleLogin = async (req, res) => {
  const credential = String(req.body.credential || "").trim();
  const trainingId = String(req.body.trainingId || "").trim();

  if (!credential) {
    return fail(res, 400, "Google credential is required.");
  }

  try {
    const googleProfile = await verifyGoogleCredential(credential);
    let user =
      (await User.findOne({ googleSubject: googleProfile.sub }).lean()) ||
      (await User.findOne({ email: googleProfile.email }).lean());

    if (user && user.role !== "trainee") {
      return fail(res, 403, "Only trainee accounts can use Google sign-in for training launch.");
    }

    let clientId = String(user?.clientId || "").trim();
    let clientName = String(user?.clientName || "").trim();

    if (!clientId && trainingId) {
      const training = await Training.findOne({
        appId: { $regex: `^${escapeRegex(trainingId)}$`, $options: "i" },
      }).lean();
      clientId = String(training?.clientId || "").trim();
    }

    if (!clientId) {
      return fail(res, 400, "A training context is required to create a trainee Google session.");
    }

    if (user) {
      await User.updateOne(
        { appId: user.appId },
        {
          $set: {
            name: googleProfile.name || user.name,
            fullname: googleProfile.name || user.fullname || user.name,
            email: googleProfile.email,
            image: googleProfile.picture || user.image || "/branding/avatar.png",
            authProvider: "google",
            googleSubject: googleProfile.sub,
            lastActive: "Today",
          },
        },
      );

      user = await User.findOne({ appId: user.appId }).lean();
      clientName = String(user?.clientName || clientName).trim();
    } else {
      const roleDefinitions = await resolveRoleDefinitions({ clientId });
      const traineeAccess = getRoleAccess("trainee", roleDefinitions);
      const appId = `user-google-${crypto.randomUUID()}`;

      user = await User.create({
        appId,
        clientId,
        clientName,
        name: googleProfile.name,
        fullname: googleProfile.name,
        email: googleProfile.email,
        role: "trainee",
        roleName: traineeAccess.roleName,
        permission: traineeAccess.permission,
        allowed: traineeAccess.allowed,
        useRoleDefaults: true,
        status: "active",
        trainings: 0,
        lastActive: "Today",
        image: googleProfile.picture || "/branding/avatar.png",
        title: "Trainee",
        department: "Learner",
        authProvider: "google",
        googleSubject: googleProfile.sub,
        passwordHash: hashPassword(crypto.randomUUID()),
      });

      user = await User.findOne({ appId }).lean();
    }

    const roleDefinitions = await resolveRoleDefinitions(user);
    const client = await resolveClientForUser(user);
    const token = signAuthToken({
      sub: user.appId,
      role: user.role,
      email: user.email,
      clientId: user.clientId || "",
    });

    return ok(res, "Google sign-in successful.", {
      token,
      user: sanitizeUserForClient(user, roleDefinitions, client),
    });
  } catch (error) {
    return fail(res, 401, error instanceof Error ? error.message : "Google sign-in failed.");
  }
};

const logout = async (_req, res) => ok(res, "Logged out successfully.", true);

const validateToken = async (req, res) => {
  const token = String(req.query.token || req.body.token || "").trim();
  const purpose = String(req.query.purpose || req.body.purpose || "").trim();

  if (!token) {
    return fail(res, 400, "Token is required.");
  }

  const result = await validatePasswordToken(token, purpose);
  if (!result.ok) {
    return fail(res, 400, result.message);
  }

  return ok(res, "Token is valid.", {
    email: result.user.email,
    name: result.user.name || result.user.fullname || "",
    purpose: result.record.purpose,
    expiresAt: result.record.expiresAt,
  });
};

const setPassword = async (req, res) => {
  const token = String(req.body.token || "").trim();
  const password = String(req.body.password || "").trim();
  const confirmPassword = String(req.body.confirmPassword || "").trim();

  if (!token) {
    return fail(res, 400, "Token is required.");
  }

  if (password.length < 6) {
    return fail(res, 400, "Please correct the highlighted fields.", {
      password: "Password must be at least 6 characters.",
    });
  }

  if (password !== confirmPassword) {
    return fail(res, 400, "Please correct the highlighted fields.", {
      confirmPassword: "Passwords must match.",
    });
  }

  const result = await completePasswordToken({ token, purpose: "set_password", password });
  if (!result.ok) {
    return fail(res, 400, result.message);
  }

  return ok(res, "Password set successfully. You can now sign in.", true);
};

const forgotPassword = async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();

  if (!isValidEmail(email)) {
    return fail(res, 400, "Please correct the highlighted fields.", {
      email: "Use a valid email address.",
    });
  }

  const user = (await User.findOne({ email })) || (await SuperAdmin.findOne({ email }));
  if (!user) {
    return fail(res, 404, "Email not registered.", {
      email: "Email not registered.",
    });
  }

  const result = await issuePasswordEmail({
    req,
    user,
    purpose: "reset_password",
    forcePlatform: user.role === "super_admin",
    createdBy: "forgot-password",
  });

  if (!result.emailResult.success) {
    return fail(res, 500, "Reset password email could not be sent.", result.emailResult);
  }

  return ok(res, "Password reset email sent.", {
    expiresAt: result.expiresAt,
  });
};

const resetPassword = async (req, res) => {
  const token = String(req.body.token || "").trim();
  const password = String(req.body.password || "").trim();
  const confirmPassword = String(req.body.confirmPassword || "").trim();

  if (password.length < 6) {
    return fail(res, 400, "Please correct the highlighted fields.", {
      password: "Password must be at least 6 characters.",
    });
  }

  if (password !== confirmPassword) {
    return fail(res, 400, "Please correct the highlighted fields.", {
      confirmPassword: "Passwords must match.",
    });
  }

  const result = await completePasswordToken({ token, purpose: "reset_password", password });
  if (!result.ok) {
    return fail(res, 400, result.message);
  }

  return ok(res, "Password reset successfully. You can now sign in.", true);
};
const profile = async (req, res) => {
  const roleDefinitions =
    req.user?.role === "super_admin" ? [] : await resolveRoleDefinitions(req.user);
  const client = req.user?.role === "super_admin" ? null : await resolveClientForUser(req.user);
  // req.user (from the auth middleware) excludes the avatar image for
  // performance — this is the one place that legitimately renders it, so
  // fetch just that single field here instead.
  const imageRecord =
    req.user?.role === "super_admin"
      ? await SuperAdmin.findOne({ appId: req.user.appId }, { image: 1 }).lean()
      : await User.findOne({ appId: req.user.appId }, { image: 1 }).lean();
  const userWithImage = { ...req.user, image: imageRecord?.image };
  return ok(res, "Profile loaded.", sanitizeUserForClient(userWithImage, roleDefinitions, client));
};

const updateProfile = async (req, res) => {
  const nextName = String(req.body.name || "").trim();
  const nextEmail = String(req.body.email || "").trim().toLowerCase();
  const nextPhone = String(req.body.phone || "").trim();
  const nextTitle = String(req.body.title || "").trim();
  const nextDepartment = String(req.body.department || "").trim();
  const currentPassword = String(req.body.currentPassword || "").trim();
  const newPassword = String(req.body.newPassword || "").trim();
  const confirmPassword = String(req.body.confirmPassword || "").trim();
  // req.user no longer carries `image` (excluded in the auth middleware for
  // performance) — fetch the current value directly only when no new image
  // was submitted, instead of relying on the stale/absent req.user.image.
  let nextImage;
  if (Object.prototype.hasOwnProperty.call(req.body, "image")) {
    nextImage = String(req.body.image || "").trim();
  } else {
    const existingImage =
      req.user.role === "super_admin"
        ? await SuperAdmin.findOne({ appId: req.user.appId }, { image: 1 }).lean()
        : await User.findOne({ appId: req.user.appId }, { image: 1 }).lean();
    nextImage = String(existingImage?.image || "").trim();
  }
  // Storage migration: base64 input is uploaded to S3 and replaced with the
  // resulting URL; an existing URL (or no image) passes through unchanged.
  nextImage = await resolveImageField(
    nextImage,
    req.user.role === "super_admin" ? "super-admin-avatars" : "avatars",
  );
  const shouldUpdatePassword = Boolean(newPassword || confirmPassword);

  const errors = {};

  if (!nextName) {
    errors.name = "Name is required.";
  }

  if (!isValidEmail(nextEmail)) {
    errors.email = "Use a valid email address.";
  } else {
    const duplicate = await User.findOne({
      email: nextEmail,
      appId: { $ne: req.user.appId },
    }).lean();

    if (duplicate) {
      errors.email = "Email already exists.";
    }
  }

  if (Object.keys(errors).length) {
    return fail(res, 400, "Please correct the highlighted fields.", errors);
  }

  if (shouldUpdatePassword) {
    if (!currentPassword) {
      errors.currentPassword = "Current password is required.";
    } else if (!verifyPassword(currentPassword, req.user.passwordHash)) {
      errors.currentPassword = "Current password is incorrect.";
    }

    if (!newPassword) {
      errors.newPassword = "New password is required.";
    } else if (newPassword.length < 6) {
      errors.newPassword = "Password must be at least 6 characters.";
    }

    if (newPassword !== confirmPassword) {
      errors.confirmPassword = "Passwords must match.";
    }
  }

  if (Object.keys(errors).length) {
    return fail(res, 400, "Please correct the highlighted fields.", errors);
  }

  const nextProfileValues = {
    name: nextName,
    fullname: nextName,
    email: nextEmail,
    phone: nextPhone,
    title: nextTitle,
    department: nextDepartment,
    image: nextImage,
    ...(shouldUpdatePassword ? { passwordHash: hashPassword(newPassword) } : {}),
  };

  if (req.user.role === "super_admin") {
    await SuperAdmin.updateOne(
      { appId: req.user.appId },
      {
        $set: nextProfileValues,
      },
    );
  } else {
    await User.updateOne(
      { appId: req.user.appId },
      {
        $set: nextProfileValues,
      },
    );
  }

  const updatedUser =
    req.user.role === "super_admin"
      ? await findSuperAdminByAppId(req.user.appId)
      : await User.findOne({ appId: req.user.appId }).lean();
  const roleDefinitions =
    updatedUser?.role === "super_admin"
      ? []
      : await resolveRoleDefinitions(updatedUser);
  const client = updatedUser?.role === "super_admin" ? null : await resolveClientForUser(updatedUser);
  return ok(res, "Profile updated successfully.", sanitizeUserForClient(updatedUser, roleDefinitions, client));
};

module.exports = {
  settings,
  login,
  googleLogin,
  logout,
  validateToken,
  setPassword,
  forgotPassword,
  resetPassword,
  profile,
  updateProfile,
};
