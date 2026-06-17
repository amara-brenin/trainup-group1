const Client = require("../models/Client");
const { ok, fail } = require("../helpers/response");
const { getTenantClientId } = require("../helpers/tenant");
const { resolveImageField } = require("../helpers/imageStorage");

const defaults = {
  setPasswordSubject: "Set your password",
  setPasswordTemplate:
    '<p>Hello {name},</p><p>Your account has been created. Set your password to activate access.</p><p><a href="{actionUrl}">Set your password</a></p><p>This secure link expires in {expiryMinutes} minutes and can only be used once.</p>',
  resetPasswordSubject: "Reset your password",
  resetPasswordTemplate:
    '<p>Hello {name},</p><p>We received a request to reset your password.</p><p><a href="{actionUrl}">Reset your password</a></p><p>This secure link expires in {expiryMinutes} minutes and can only be used once.</p>',
  signatureHtml: "",
  signatureImageUrl: "",
};

const toPayload = (client) => ({
  setPasswordSubject: client.emailSetPasswordSubject || defaults.setPasswordSubject,
  setPasswordTemplate: client.emailSetPasswordTemplate || defaults.setPasswordTemplate,
  resetPasswordSubject: client.emailResetPasswordSubject || defaults.resetPasswordSubject,
  resetPasswordTemplate: client.emailResetPasswordTemplate || defaults.resetPasswordTemplate,
  signatureHtml: client.emailSignatureHtml || "",
  signatureImageUrl: client.emailSignatureImageUrl || "",
});

const getSettings = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const client = clientId ? await Client.findOne({ appId: clientId }).lean() : null;

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  return ok(res, "Email center loaded.", toPayload(client));
};

const updateSettings = async (req, res) => {
  const clientId = getTenantClientId(req.user);
  const client = clientId ? await Client.findOne({ appId: clientId }) : null;

  if (!client) {
    return fail(res, 404, "Client not found.");
  }

  const values = req.body || {};
  const errors = {};
  const next = {
    setPasswordSubject: String(values.setPasswordSubject || "").trim(),
    setPasswordTemplate: String(values.setPasswordTemplate || "").trim(),
    resetPasswordSubject: String(values.resetPasswordSubject || "").trim(),
    resetPasswordTemplate: String(values.resetPasswordTemplate || "").trim(),
    signatureHtml: String(values.signatureHtml || "").trim(),
    signatureImageUrl: String(values.signatureImageUrl || "").trim(),
  };

  if (!next.setPasswordSubject) {
    errors.setPasswordSubject = "Subject is required.";
  }
  if (!next.setPasswordTemplate) {
    errors.setPasswordTemplate = "Template is required.";
  }
  if (!next.resetPasswordSubject) {
    errors.resetPasswordSubject = "Subject is required.";
  }
  if (!next.resetPasswordTemplate) {
    errors.resetPasswordTemplate = "Template is required.";
  }

  if (Object.keys(errors).length) {
    return fail(res, 400, "Please correct the highlighted fields.", errors);
  }

  client.emailSetPasswordSubject = next.setPasswordSubject;
  client.emailSetPasswordTemplate = next.setPasswordTemplate;
  client.emailResetPasswordSubject = next.resetPasswordSubject;
  client.emailResetPasswordTemplate = next.resetPasswordTemplate;
  client.emailSignatureHtml = next.signatureHtml;
  // Storage migration: base64 input is uploaded to S3 and replaced with the
  // resulting URL; an existing URL passes through unchanged.
  client.emailSignatureImageUrl = await resolveImageField(next.signatureImageUrl, "client-email-signatures");
  await client.save();

  return ok(res, "Email template saved.", toPayload(client.toObject()));
};

module.exports = {
  getSettings,
  updateSettings,
};
