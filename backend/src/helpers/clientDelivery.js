const crypto = require("crypto");
const dns = require("node:dns/promises");
const nodemailer = require("nodemailer");
const config = require("../config");
const Setting = require("../models/Setting");

const DELIVERY_TIMEOUT_MS = 8000;

const createDomainVerificationToken = () => crypto.randomBytes(12).toString("hex");

const buildWebhookConfigPayload = (client, current = {}) => ({
  ...current,
  url: client?.webhookUrl || current?.url || "",
  // Prefer the per-client signing secret set in Integration settings so the
  // receiver can verify the HMAC signature; fall back to any stored value.
  signingSecret: client?.webhookSigningSecret || current?.signingSecret || "",
  retryAttempts: Number(current?.retryAttempts || 3),
  timeoutSeconds: Number(current?.timeoutSeconds || 10),
  events: Array.isArray(current?.events) ? current.events : [],
  logs: Array.isArray(current?.logs) ? current.logs : [],
});

const appendWebhookLog = (config, entry) => {
  const logs = Array.isArray(config?.logs) ? config.logs : [];
  return [entry, ...logs].slice(0, 20);
};

// Proper HMAC-SHA256 signature over the exact request body so the receiver can
// verify the event genuinely came from TrainUp and was not tampered with.
// Header convention: `x-trainup-signature: sha256=<hex>` + `x-trainup-timestamp`.
const signWebhookBody = (rawBody, secret) =>
  `sha256=${crypto.createHmac("sha256", String(secret || "")).update(String(rawBody)).digest("hex")}`;

const runWithTimeout = async (promiseFactory, timeoutMs = DELIVERY_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

const sendWebhookTest = async (config, client) => {
  const checkedAt = new Date().toISOString();
  const payload = {
    event: "training.completed.test",
    source: "trainup",
    checkedAt,
    clientId: client.appId,
    clientName: client.name,
    domain: client.domain || `${client.subdomain}.trainup.ai`,
    training: {
      id: "demo-training",
      title: "Webhook Test Training",
    },
    learner: {
      id: "demo-learner",
      name: "Demo Learner",
      email: client.firstUserEmail || client.supportEmail || "",
    },
    score: 92,
    status: "completed",
  };

  try {
    const startedAt = Date.now();
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await runWithTimeout(
      (signal) =>
        fetch(String(config.url), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-trainup-signature": signWebhookBody(`${timestamp}.${rawBody}`, config.signingSecret),
            "x-trainup-timestamp": timestamp,
            "x-trainup-event": payload.event,
          },
          body: rawBody,
          signal,
        }),
      Math.max(1000, Number(config.timeoutSeconds || 10) * 1000),
    );
    const latencyMs = Date.now() - startedAt;
    const ok = response.ok;

    return {
      success: ok,
      status: ok ? "success" : "failed",
      message: ok ? `Webhook test delivered successfully to ${config.url}.` : `Webhook endpoint responded with HTTP ${response.status}.`,
      checkedAt,
      details: `Latency ${latencyMs} ms`,
      log: {
        id: `webhook-${Date.now()}`,
        timestamp: checkedAt,
        event: payload.event,
        ssoId: payload.learner.id,
        status: response.status,
        latencyMs,
      },
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      message: error instanceof Error ? error.message : "Webhook test failed.",
      checkedAt,
      details: "No response returned from target endpoint.",
      log: {
        id: `webhook-${Date.now()}`,
        timestamp: checkedAt,
        event: payload.event,
        ssoId: payload.learner.id,
        status: 503,
        latencyMs: null,
      },
    };
  }
};

// Deliver a real completion/score event to the customer's configured webhook
// (LMS_INTEGRATION_RESEARCH.md — Method E). Signed with HMAC so the receiver can
// verify authenticity. Returns a log entry mirroring sendWebhookTest.
const sendCompletionWebhook = async (config, client, { event, training, learner, session }) => {
  const occurredAt = new Date().toISOString();
  const payload = {
    event,
    source: "trainup",
    occurredAt,
    clientId: client.appId,
    clientName: client.name,
    domain: client.domain || `${client.subdomain || "app"}.trainup.ai`,
    training: { id: training.id, title: training.title },
    learner: { id: learner.id, name: learner.name, email: learner.email },
    score: session.score ?? null,
    status: session.status || "completed",
    progressPercent: session.progressPercent ?? null,
    timeSpentSeconds: session.timeSpentSeconds ?? null,
    attemptNo: session.attemptNo ?? 1,
    sessionId: session.sessionId || "",
  };

  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));

  try {
    const startedAt = Date.now();
    const response = await runWithTimeout(
      (signal) =>
        fetch(String(config.url), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-trainup-signature": signWebhookBody(`${timestamp}.${rawBody}`, config.signingSecret),
            "x-trainup-timestamp": timestamp,
            "x-trainup-event": payload.event,
          },
          body: rawBody,
          signal,
        }),
      Math.max(1000, Number(config.timeoutSeconds || 10) * 1000),
    );
    const latencyMs = Date.now() - startedAt;
    return {
      success: response.ok,
      status: response.ok ? "success" : "failed",
      message: response.ok
        ? `Result delivered to ${config.url}.`
        : `Webhook endpoint responded with HTTP ${response.status}.`,
      checkedAt: occurredAt,
      log: {
        id: `webhook-${Date.now()}`,
        timestamp: occurredAt,
        event: payload.event,
        ssoId: payload.learner.id,
        status: response.status,
        latencyMs,
      },
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      message: error instanceof Error ? error.message : "Result delivery failed.",
      checkedAt: occurredAt,
      log: {
        id: `webhook-${Date.now()}`,
        timestamp: occurredAt,
        event: payload.event,
        ssoId: payload.learner.id,
        status: 503,
        latencyMs: null,
      },
    };
  }
};

// Fire-and-forget dispatcher used at training-completion points. Loads the
// tenant's webhook config, delivers the event, and records a delivery log.
// Never throws — a webhook problem must not break the learner's completion.
const deliverCompletionWebhook = async ({ clientId, training, learner, session, event = "training.completed" }) => {
  try {
    // Lazy requires avoid a circular dependency (tenant/Client ↔ clientDelivery).
    const Client = require("../models/Client");
    const { getTenantSetting, setTenantSetting } = require("./tenant");

    const client = await Client.findOne({ appId: clientId });
    if (!client) return;

    const stored = await getTenantSetting(clientId, "webhookConfig", {});
    const config = buildWebhookConfigPayload(client, stored);

    if (!config.url) return; // No endpoint configured → nothing to deliver.

    // If the tenant has explicitly chosen an event list, respect it; an empty
    // list means "deliver all" (sensible default so it works out of the box).
    if (Array.isArray(config.events) && config.events.length && !config.events.includes(event)) {
      return;
    }

    const result = await sendCompletionWebhook(config, client, { event, training, learner, session });

    client.lastWebhookTestAt = result.checkedAt;
    client.lastWebhookTestStatus = result.status;
    client.lastWebhookTestMessage = result.message;
    await client.save();
    await setTenantSetting(clientId, "webhookConfig", {
      ...config,
      logs: appendWebhookLog(config, result.log),
    });
  } catch {
    // Swallow — delivery is best-effort and must not affect the response.
  }
};

const verifyDomainRecord = async (domain, token, verificationHost = "_trainup-verification") => {
  const checkedAt = new Date().toISOString();
  const normalizedDomain = String(domain || "").trim().toLowerCase();
  const normalizedHost = String(verificationHost || "_trainup-verification").trim();
  const hostname = normalizedHost ? `${normalizedHost}.${normalizedDomain}` : normalizedDomain;

  if (!normalizedDomain || !token) {
    return {
      success: false,
      status: "failed",
      message: "Domain and verification token are required.",
      checkedAt,
      details: "",
    };
  }

  try {
    const records = await dns.resolveTxt(hostname);
    const flattened = records.map((parts) => parts.join("")).filter(Boolean);
    const expectedValue = `trainup-verify=${token}`;
    const matched = flattened.includes(expectedValue);

    return {
      success: matched,
      status: matched ? "success" : "failed",
      message: matched
        ? `TXT record found on ${hostname}. Domain verified successfully.`
        : `TXT record not found on ${hostname}. Add ${expectedValue} and try again.`,
      checkedAt,
      details: flattened.length ? flattened.join(" | ") : "No TXT records returned.",
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      message: `Could not resolve TXT records for ${hostname}.`,
      checkedAt,
      details: error instanceof Error ? error.message : "DNS lookup failed.",
    };
  }
};

const hasClientSmtp = (client) =>
  Boolean(client?.emailDeliveryEnabled && client?.smtpHost && client?.smtpFromEmail);

const hasPlatformSmtp = () =>
  Boolean(config.platformEmail.enabled && config.platformEmail.host && config.platformEmail.fromEmail);

const getPlatformEmailSender = () => ({
  name: config.platformEmail.fromName || "Brenin Trainup",
  email: config.platformEmail.fromEmail,
});

const buildSmtpTransporter = (client) =>
  nodemailer.createTransport({
    host: String(client.smtpHost || "").trim(),
    port: Number(client.smtpPort || 587),
    secure: Boolean(client.smtpSecure),
    auth:
      client.smtpUsername && client.smtpPassword
        ? {
            user: String(client.smtpUsername || "").trim(),
            pass: String(client.smtpPassword || "").trim(),
          }
        : undefined,
  });

const buildPlatformSmtpTransporter = () =>
  nodemailer.createTransport({
    host: config.platformEmail.host,
    port: config.platformEmail.port,
    secure: Boolean(config.platformEmail.secure),
    auth:
      config.platformEmail.username && config.platformEmail.password
        ? {
            user: config.platformEmail.username,
            pass: config.platformEmail.password,
          }
        : undefined,
  });

const resolveMailDeliveryChannel = (client, options = {}) => {
  const forcePlatform = Boolean(options.forcePlatform);

  if (!forcePlatform && hasClientSmtp(client)) {
    return {
      source: "client",
      transporter: buildSmtpTransporter(client),
      fromName: client.smtpFromName || client.name,
      fromEmail: client.smtpFromEmail,
    };
  }

  if (hasPlatformSmtp()) {
    const sender = getPlatformEmailSender();
    return {
      source: "platform",
      transporter: buildPlatformSmtpTransporter(),
      fromName: sender.name,
      fromEmail: sender.email,
    };
  }

  return null;
};

const DEFAULT_ASSIGNMENT_SUBJECT = "Start your training: {trainingTitle}";
const DEFAULT_ASSIGNMENT_TEMPLATE =
  "<p>Hello {candidateName},</p><p>A training has been assigned to you.</p><p><strong>{trainingTitle}</strong></p><p>{trainingAudience}</p><p><a href=\"{trainingLink}\">Start your training</a></p><p>{clientName}</p>";

const DEFAULT_SET_PASSWORD_SUBJECT = "Set your password";
const DEFAULT_RESET_PASSWORD_SUBJECT = "Reset your password";

const DEFAULT_SET_PASSWORD_TEMPLATE =
  "<p>Hello {name},</p><p>Your account has been created. Set your password to activate access.</p><p><a href=\"{actionUrl}\">Set your password</a></p><p>This secure link expires in {expiryMinutes} minutes and can only be used once.</p>";
const DEFAULT_RESET_PASSWORD_TEMPLATE =
  "<p>Hello {name},</p><p>We received a request to reset your password.</p><p><a href=\"{actionUrl}\">Reset your password</a></p><p>This secure link expires in {expiryMinutes} minutes and can only be used once.</p>";

const getPlatformEmailSettings = async () => {
  const record = await Setting.findOne({ key: "platformEmailSettings" }).lean();
  return {
    setPasswordSubject: DEFAULT_SET_PASSWORD_SUBJECT,
    setPasswordTemplate: DEFAULT_SET_PASSWORD_TEMPLATE,
    resetPasswordSubject: DEFAULT_RESET_PASSWORD_SUBJECT,
    resetPasswordTemplate: DEFAULT_RESET_PASSWORD_TEMPLATE,
    signatureHtml: "",
    signatureImageUrl: "",
    ...(record?.value || {}),
  };
};

const appendEmailSignature = (html, settings) => {
  const signatureImage = settings.signatureImageUrl
    ? `<p><img src="${settings.signatureImageUrl}" alt="Email signature" style="max-width: 220px; height: auto;" /></p>`
    : "";
  const signatureHtml = settings.signatureHtml ? `<div>${settings.signatureHtml}</div>` : "";
  return `${html}${signatureHtml || signatureImage ? `<hr />${signatureHtml}${signatureImage}` : ""}`;
};

const getClientAccountEmailSettings = (client, platformSettings) => ({
  setPasswordSubject: client?.emailSetPasswordSubject || platformSettings.setPasswordSubject,
  setPasswordTemplate: client?.emailSetPasswordTemplate || platformSettings.setPasswordTemplate,
  resetPasswordSubject: client?.emailResetPasswordSubject || platformSettings.resetPasswordSubject,
  resetPasswordTemplate: client?.emailResetPasswordTemplate || platformSettings.resetPasswordTemplate,
  signatureHtml: client?.emailSignatureHtml || platformSettings.signatureHtml || "",
  signatureImageUrl: client?.emailSignatureImageUrl || platformSettings.signatureImageUrl || "",
});

const renderEmailTemplate = (template, replacements) =>
  String(template || "").replace(/\{([a-zA-Z0-9]+)\}/g, (_, key) =>
    replacements[key] !== undefined && replacements[key] !== null
      ? String(replacements[key])
      : "",
  );

const htmlToPlainText = (value) =>
  String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const replaceLocalPasswordLinks = (html, actionUrl) =>
  String(html || "").replace(
    /https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/(?:reset-password|set-password)\?token=[^"'\s<]+/gi,
    actionUrl,
  );

const sendSmtpTestEmail = async (client, recipient) => {
  const checkedAt = new Date().toISOString();

  if (!client.emailDeliveryEnabled) {
    return {
      success: false,
      status: "failed",
      message: "Email delivery is disabled for this client.",
      checkedAt,
      details: "Enable email delivery first.",
    };
  }

  if (!client.smtpHost || !client.smtpFromEmail) {
    return {
      success: false,
      status: "failed",
      message: "SMTP host and sender email are required before sending a test mail.",
      checkedAt,
      details: "",
    };
  }

  const transporter = buildSmtpTransporter(client);

  try {
    await transporter.verify();
    await transporter.sendMail({
      from: `"${client.smtpFromName || client.name}" <${client.smtpFromEmail}>`,
      to: recipient,
      subject: `${client.name} training email setup test`,
      text: `This is a test email from ${client.name}. SMTP configuration is working.`,
      html: `<p>This is a test email from <strong>${client.name}</strong>.</p><p>SMTP configuration is working.</p>`,
    });

    return {
      success: true,
      status: "success",
      message: `Test email sent successfully to ${recipient}.`,
      checkedAt,
      details: "SMTP connection verified and message accepted by relay.",
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      message: error instanceof Error ? error.message : "SMTP test failed.",
      checkedAt,
      details: "Check SMTP host, port, username, password, and relay restrictions.",
    };
  }
};

const sendTrainingAssignmentEmails = async (client, recipients, training, launchUrl) => {
  const checkedAt = new Date().toISOString();
  const channel = resolveMailDeliveryChannel(client);

  if (!channel) {
    return {
      success: false,
      status: "failed",
      message: "No SMTP delivery channel is configured.",
      checkedAt,
      details: "Add client SMTP details or configure Brenin SMTP fallback.",
      sentCount: 0,
      failedRecipients: recipients.map((item) => item.email),
    };
  }

  try {
    await channel.transporter.verify();

    const sendResults = await Promise.allSettled(
      recipients.map((recipient) => {
        const replacements = {
          candidateName: recipient.name || "Learner",
          trainingTitle: training.title || "Training",
          trainingAudience: training.audience ? `Audience: ${training.audience}` : "",
          trainingLink: launchUrl,
          clientName: client.name,
        };
        const html = renderEmailTemplate(
          client.smtpTrainingAssignmentTemplate || DEFAULT_ASSIGNMENT_TEMPLATE,
          replacements,
        );
        const text = htmlToPlainText(html);
        const subject = renderEmailTemplate(
          client.smtpTrainingAssignmentSubject || DEFAULT_ASSIGNMENT_SUBJECT,
          replacements,
        );

        return channel.transporter.sendMail({
          from: `"${channel.fromName}" <${channel.fromEmail}>`,
          to: recipient.email,
          subject,
          text,
          html,
        });
      }),
    );

    const failedRecipients = sendResults
      .map((result, index) => (result.status === "rejected" ? recipients[index]?.email : ""))
      .filter(Boolean);
    const sentCount = sendResults.length - failedRecipients.length;

    return {
      success: failedRecipients.length === 0,
      status: failedRecipients.length === 0 ? "success" : "failed",
      message:
        failedRecipients.length === 0
          ? `Training invite email sent to ${sentCount} trainee${sentCount === 1 ? "" : "s"} via ${channel.source === "client" ? "client SMTP" : "Brenin SMTP"}.`
          : `Training assigned, but ${failedRecipients.length} email${failedRecipients.length === 1 ? "" : "s"} failed.`,
      checkedAt,
      details: failedRecipients.length ? `Failed: ${failedRecipients.join(", ")}` : "SMTP connection verified and messages accepted by relay.",
      sentCount,
      failedRecipients,
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      message: error instanceof Error ? error.message : "Training invite email failed.",
      checkedAt,
      details: "Check SMTP host, port, username, password, and relay restrictions.",
      sentCount: 0,
      failedRecipients: recipients.map((item) => item.email),
    };
  }
};

const sendAccountActionEmail = async ({ client, user, actionUrl, purpose, forcePlatform = false }) => {
  const checkedAt = new Date().toISOString();
  const channel = resolveMailDeliveryChannel(client, { forcePlatform });
  const platformSettings = await getPlatformEmailSettings();
  const settings = forcePlatform
    ? platformSettings
    : getClientAccountEmailSettings(client, platformSettings);

  if (!channel) {
    return {
      success: false,
      status: "failed",
      message: "No SMTP delivery channel is configured.",
      checkedAt,
      details: "Add client SMTP details or configure Brenin SMTP fallback.",
      deliverySource: "none",
    };
  }

  const isReset = purpose === "reset_password";
  const replacements = {
    name: user.name || user.fullname || "there",
    email: user.email,
    actionUrl,
    clientName: client?.name || channel.fromName,
    expiryMinutes: "30",
  };
  const subject = renderEmailTemplate(
    isReset ? settings.resetPasswordSubject : settings.setPasswordSubject,
    replacements,
  );
  const html = replaceLocalPasswordLinks(appendEmailSignature(renderEmailTemplate(
    isReset ? settings.resetPasswordTemplate : settings.setPasswordTemplate,
    replacements,
  ), settings), actionUrl);

  try {
    await channel.transporter.verify();
    await channel.transporter.sendMail({
      from: `"${channel.fromName}" <${channel.fromEmail}>`,
      to: user.email,
      subject,
      text: htmlToPlainText(html),
      html,
    });

    return {
      success: true,
      status: "success",
      message: `${subject} email sent via ${channel.source === "client" ? "client SMTP" : "Brenin SMTP"}.`,
      checkedAt,
      details: "SMTP connection verified and message accepted by relay.",
      deliverySource: channel.source,
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      message: error instanceof Error ? error.message : `${subject} email failed.`,
      checkedAt,
      details: "Check SMTP host, port, username, password, and relay restrictions.",
      deliverySource: channel.source,
    };
  }
};

module.exports = {
  createDomainVerificationToken,
  buildWebhookConfigPayload,
  appendWebhookLog,
  sendWebhookTest,
  signWebhookBody,
  sendCompletionWebhook,
  deliverCompletionWebhook,
  verifyDomainRecord,
  sendSmtpTestEmail,
  sendTrainingAssignmentEmails,
  sendAccountActionEmail,
  getPlatformEmailSettings,
};
