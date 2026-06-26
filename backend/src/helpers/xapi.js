// xAPI (Experience API / "Tin Can") statement emitter — LMS_INTEGRATION_RESEARCH.md
// Method D. On a training completion we send a learning "statement" to the
// customer's configured LRS (Learning Record Store). Builds on the same
// completion hook as the result webhook, but speaks the xAPI 1.0.3 protocol so
// LRS-capable LMSs / analytics tools (Veracity, Learning Locker, Watershed…)
// record the rich event.

const XAPI_VERSION = "1.0.3";

const runWithTimeout = async (promiseFactory, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

// The statements resource is the LRS endpoint + "statements". Accept either a
// bare endpoint ("https://lrs/xapi") or one already ending in /statements.
const buildStatementsUrl = (endpoint) => {
  const base = String(endpoint || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  return /\/statements$/i.test(base) ? base : `${base}/statements`;
};

// Build a valid xAPI 1.0.3 completion statement.
const buildXapiStatement = ({ baseUrl, clientName, training, learner, session }) => {
  const root = String(baseUrl || "https://trainup.ai").replace(/\/+$/, "");
  const score = typeof session.score === "number" && !Number.isNaN(session.score) ? session.score : null;
  const result = { completion: true };
  if (score !== null) {
    result.success = score >= 50; // simple pass threshold; LRS can re-interpret
    result.score = { scaled: Math.max(0, Math.min(1, score / 100)), raw: score, min: 0, max: 100 };
  }
  if (typeof session.timeSpentSeconds === "number" && session.timeSpentSeconds > 0) {
    result.duration = `PT${Math.round(session.timeSpentSeconds)}S`;
  }

  const actor = learner.email
    ? { objectType: "Agent", name: learner.name || learner.email, mbox: `mailto:${learner.email}` }
    : {
        objectType: "Agent",
        name: learner.name || "Learner",
        account: { homePage: root, name: learner.id || learner.name || "learner" },
      };

  return {
    actor,
    verb: {
      id: "http://adlnet.gov/expapi/verbs/completed",
      display: { "en-US": "completed" },
    },
    object: {
      objectType: "Activity",
      id: `${root}/trainings/${training.id}`,
      definition: {
        name: { "en-US": training.title || "Training" },
        type: "http://adlnet.gov/expapi/activities/course",
      },
    },
    result,
    context: {
      platform: "TrainUp",
      extensions: { "https://trainup.ai/xapi/ext/clientName": clientName || "" },
    },
    timestamp: new Date().toISOString(),
  };
};

// POST a statement to the LRS. Basic auth from the configured key/secret.
const sendXapiStatement = async (config, statement) => {
  const url = buildStatementsUrl(config.endpoint);
  const checkedAt = new Date().toISOString();
  const auth = config.clientId || config.clientSecret
    ? `Basic ${Buffer.from(`${config.clientId || ""}:${config.clientSecret || ""}`).toString("base64")}`
    : "";

  try {
    const startedAt = Date.now();
    const response = await runWithTimeout((signal) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Experience-API-Version": XAPI_VERSION,
          ...(auth ? { Authorization: auth } : {}),
        },
        body: JSON.stringify(statement),
        signal,
      }),
    );
    const latencyMs = Date.now() - startedAt;
    return {
      success: response.ok,
      status: response.ok ? "success" : "failed",
      message: response.ok ? `xAPI statement sent to ${url}.` : `LRS responded with HTTP ${response.status}.`,
      checkedAt,
      log: {
        id: `xapi-${Date.now()}`,
        timestamp: checkedAt,
        event: "xapi.completed",
        ssoId: statement.actor?.mbox || statement.actor?.account?.name || "",
        status: response.status,
        latencyMs,
      },
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      message: error instanceof Error ? error.message : "xAPI delivery failed.",
      checkedAt,
      log: {
        id: `xapi-${Date.now()}`,
        timestamp: checkedAt,
        event: "xapi.completed",
        ssoId: statement.actor?.mbox || "",
        status: 503,
        latencyMs: null,
      },
    };
  }
};

// Fire-and-forget dispatcher used at completion. Loads the tenant's xAPI config,
// sends the statement if enabled, and records a delivery log. Never throws.
const deliverXapiStatement = async ({ clientId, training, learner, session }) => {
  try {
    const Client = require("../models/Client");
    const { getTenantSetting, setTenantSetting } = require("./tenant");
    const { appendWebhookLog } = require("./clientDelivery");

    const client = await Client.findOne({ appId: clientId });
    if (!client || !client.xapiEnabled) return;

    const endpoint = String(client.xapiLrsEndpoint || "").trim();
    if (!endpoint) return;

    const statement = buildXapiStatement({
      baseUrl: client.domain ? `https://${client.domain}` : "https://trainup.ai",
      clientName: client.name,
      training,
      learner,
      session,
    });

    const result = await sendXapiStatement(
      { endpoint, clientId: client.xapiClientId, clientSecret: client.xapiClientSecret },
      statement,
    );

    // Surface alongside webhook deliveries so the admin sees one delivery log.
    const stored = await getTenantSetting(clientId, "webhookConfig", {});
    await setTenantSetting(clientId, "webhookConfig", {
      ...stored,
      logs: appendWebhookLog(stored, result.log),
    });
  } catch {
    // best-effort; never affect the learner's completion
  }
};

module.exports = { buildXapiStatement, sendXapiStatement, deliverXapiStatement, buildStatementsUrl };
