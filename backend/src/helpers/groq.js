const config = require("../config");

const normalizeValue = (value) => String(value || "").trim();

const isGroqConfigured = () => Boolean(normalizeValue(config.groq.apiKey));

const createGroqMessages = ({ systemPrompt, context, history, message }) => {
  const messages = [];

  if (systemPrompt) {
    messages.push({
      role: "system",
      content: systemPrompt,
    });
  }

  if (context) {
    messages.push({
      role: "system",
      content: context,
    });
  }

  (Array.isArray(history) ? history : []).forEach((entry) => {
    if (!entry || !normalizeValue(entry.role) || !normalizeValue(entry.content)) {
      return;
    }

    messages.push({
      role: entry.role === "assistant" ? "assistant" : "user",
      content: normalizeValue(entry.content),
    });
  });

  messages.push({
    role: "user",
    content: normalizeValue(message),
  });

  return messages;
};

const createGroqReply = async ({ systemPrompt, context, history = [], message, temperature = 0.35, maxTokens = 700 }) => {
  if (!isGroqConfigured()) {
    throw new Error("Groq is not configured on this deployment.");
  }

  const response = await fetch(`${config.groq.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.groq.apiKey}`,
    },
    body: JSON.stringify({
      model: config.groq.model,
      temperature,
      max_tokens: maxTokens,
      messages: createGroqMessages({
        systemPrompt,
        context,
        history,
        message,
      }),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Groq response generation failed.");
  }

  const payload = await response.json();
  return normalizeValue(payload?.choices?.[0]?.message?.content);
};

module.exports = {
  createGroqReply,
  isGroqConfigured,
};
