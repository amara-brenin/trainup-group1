const config = require("../config");
const { ok, fail } = require("../helpers/response");
const { findTrainingById, buildTrainingAskContext } = require("./launchController");
const TavusVoicePersona = require("../models/TavusVoicePersona");

const TAVUS_API_BASE = config.tavus.apiBaseUrl;

// Tavus has no per-conversation TTS override — the voice is baked into the
// persona itself. So when a training's selected voice differs from its
// avatar's default, we clone the base persona once (overriding just the tts
// layer) and cache the clone for reuse on every future session with that
// same avatar+voice combination.
const resolveVoiceOverridePersonaId = async (basePersonaId, voiceId) => {
  if (!basePersonaId || !voiceId) {
    return basePersonaId;
  }

  try {
    const cached = await TavusVoicePersona.findOne({ basePersonaId, voiceId }).lean();
    if (cached?.personaId) {
      return cached.personaId;
    }

    const baseRes = await fetch(`${TAVUS_API_BASE}/personas/${basePersonaId}`, {
      headers: { "x-api-key": config.tavus.apiKey },
    });
    const base = await baseRes.json().catch(() => null);

    if (!baseRes.ok || !base) {
      console.error("Failed to fetch base Tavus persona for voice override", base);
      return basePersonaId;
    }

    const createRes = await fetch(`${TAVUS_API_BASE}/personas`, {
      method: "POST",
      headers: {
        "x-api-key": config.tavus.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        persona_name: `${base.persona_name || "Training Avatar"} (voice override)`,
        system_prompt: base.system_prompt,
        pipeline_mode: base.pipeline_mode,
        default_replica_id: base.default_replica_id,
        layers: {
          ...base.layers,
          tts: {
            ...(base.layers?.tts || {}),
            tts_engine: "elevenlabs",
            external_voice_id: voiceId,
            api_key: config.elevenlabs.apiKey,
          },
        },
      }),
    });
    const created = await createRes.json().catch(() => null);

    if (!createRes.ok || !created?.persona_id) {
      console.error("Failed to create voice-override Tavus persona", created);
      return basePersonaId;
    }

    await TavusVoicePersona.create({
      basePersonaId,
      voiceId,
      personaId: created.persona_id,
    }).catch(() => undefined);

    return created.persona_id;
  } catch (error) {
    console.error("Error resolving voice-override Tavus persona:", error);
    return basePersonaId;
  }
};

const createSession = async (req, res) => {
  try {
    if (!config.tavus.apiKey) {
      return fail(res, 500, "Tavus API key is not configured on the server");
    }

    const { replicaId, personaId, voiceId, conversationName, trainingId } = req.body || {};

    if (!replicaId) {
      return fail(res, 400, "replicaId is required");
    }

    const resolvedPersonaId = await resolveVoiceOverridePersonaId(personaId, voiceId);

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
        ...(resolvedPersonaId ? { persona_id: resolvedPersonaId } : {}),
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
