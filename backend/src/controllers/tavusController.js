const config = require("../config");
const { ok, fail } = require("../helpers/response");
const { findTrainingById, buildTrainingAskContext } = require("./launchController");

const TAVUS_API_BASE = config.tavus.apiBaseUrl;

const createSession = async (req, res) => {
  try {
    if (!config.tavus.apiKey) {
      return fail(res, 500, "Tavus API key is not configured on the server");
    }

    const { replicaId, personaId, conversationName, trainingId } = req.body || {};

    if (!replicaId) {
      return fail(res, 400, "replicaId is required");
    }

    // Grounds Tavus's own native (fast, low-latency) conversation in this
    // training's Ask Assistant Prompt + knowledge base, scoped per-conversation
    // via conversational_context — never written back onto the shared
    // persona, so other trainings using the same avatar are unaffected.
    let conversationalContext;
    if (trainingId) {
      const training = await findTrainingById(trainingId);
      if (training) {
        const { systemPrompt, knowledgeBase } = buildTrainingAskContext(training);
        conversationalContext = [systemPrompt, knowledgeBase].filter(Boolean).join("\n\n");
      }
    }

    const fetchRes = await fetch(`${TAVUS_API_BASE}/conversations`, {
      method: "POST",
      headers: {
        "x-api-key": config.tavus.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        replica_id: replicaId,
        ...(personaId ? { persona_id: personaId } : {}),
        conversation_name: conversationName || "TrainUp Training Session",
        ...(conversationalContext ? { conversational_context: conversationalContext } : {}),
        properties: {
          enable_recording: false,
        },
      }),
    });

    const data = await fetchRes.json().catch(() => null);

    if (!fetchRes.ok || !data) {
      return fail(res, fetchRes.status || 500, data?.message || "Failed to create Tavus conversation", data || {});
    }

    return ok(res, "Tavus session created", {
      conversationId: data.conversation_id,
      conversationUrl: data.conversation_url,
      status: data.status,
    });
  } catch (error) {
    console.error("Error creating Tavus session:", error);
    return fail(res, 500, "Internal Server Error");
  }
};

const endSession = async (req, res) => {
  try {
    if (!config.tavus.apiKey) {
      return fail(res, 500, "Tavus API key is not configured on the server");
    }

    const { conversationId } = req.params;

    if (!conversationId) {
      return fail(res, 400, "conversationId is required");
    }

    const fetchRes = await fetch(`${TAVUS_API_BASE}/conversations/${conversationId}/end`, {
      method: "POST",
      headers: {
        "x-api-key": config.tavus.apiKey,
      },
    });

    if (!fetchRes.ok && fetchRes.status !== 404) {
      const data = await fetchRes.json().catch(() => null);
      return fail(res, fetchRes.status, data?.message || "Failed to end Tavus conversation", data || {});
    }

    return ok(res, "Tavus session ended", {});
  } catch (error) {
    console.error("Error ending Tavus session:", error);
    return fail(res, 500, "Internal Server Error");
  }
};

module.exports = {
  createSession,
  endSession,
};
