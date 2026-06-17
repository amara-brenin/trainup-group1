const config = require("../config");
const { ok, fail } = require("../helpers/response");
const { createGroqReply, isGroqConfigured } = require("../helpers/groq");

const normalizeValue = (value) => String(value || "").trim();

const generateNarration = async (req, res) => {
  const prompt = normalizeValue(req.body.prompt);
  const trainingTitle = normalizeValue(req.body.trainingTitle);
  const slideTitle = normalizeValue(req.body.slideTitle);
  const script = normalizeValue(req.body.script);
  const targetLanguage = normalizeValue(req.body.targetLanguage);
  const targetLocale = normalizeValue(req.body.targetLocale);
  const extractedText = Array.isArray(req.body.extractedText)
    ? req.body.extractedText.map((line) => normalizeValue(line)).filter(Boolean)
    : [];

  if (script && targetLanguage) {
    if (!isGroqConfigured()) {
      return fail(res, 503, "Groq is not configured on this deployment.");
    }

    try {
      const reply = await createGroqReply({
        systemPrompt:
          "You translate Trainup training narration into the requested language. Preserve meaning, keep it concise and natural for voiceover, and return spoken text only with no bullets or markup.",
        context: [
          trainingTitle ? `Training title: ${trainingTitle}` : "",
          slideTitle ? `Slide title: ${slideTitle}` : "",
          `Target language: ${targetLanguage}`,
          targetLocale ? `Target locale: ${targetLocale}` : "",
          `Source narration:\n${script}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        message: "Translate this narration for learner playback.",
        temperature: 0.2,
        maxTokens: 320,
      });

      return ok(res, "Narration translated successfully.", {
        script: reply,
        model: config.groq.model,
        usedOcr: false,
      });
    } catch (error) {
      return fail(res, 502, error instanceof Error ? error.message : "Unable to translate narration.");
    }
  }

  if (!prompt) {
    return fail(res, 400, "Narration prompt is required.");
  }

  if (!isGroqConfigured()) {
    return fail(res, 503, "Groq is not configured on this deployment.");
  }

  try {
    const reply = await createGroqReply({
      systemPrompt:
        "You generate concise slide narration for Trainup training slides. Use only the OCR slide content and the prompt instructions. Return plain spoken text only, with no bullets or markup.",
      context: [
        trainingTitle ? `Training title: ${trainingTitle}` : "",
        slideTitle ? `Slide title: ${slideTitle}` : "",
        extractedText.length ? `OCR text:\n${extractedText.join("\n")}` : "OCR text is unavailable for this slide.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      message: prompt,
      temperature: 0.2,
      maxTokens: 220,
    });

    return ok(res, "Narration generated successfully.", {
      script: reply,
      model: config.groq.model,
      usedOcr: extractedText.length > 0,
    });
  } catch (error) {
    return fail(res, 502, error instanceof Error ? error.message : "Unable to generate narration.");
  }
};

module.exports = {
  generateNarration,
};
