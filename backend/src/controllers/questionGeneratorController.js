const { createGroqReply, isGroqConfigured } = require("../helpers/groq");
const config = require("../config");
const { ok, fail } = require("../helpers/response");

const normalizeValue = (value) => String(value || "").trim();

const parseJsonValue = (value) => {
  const normalized = normalizeValue(value);

  if (!normalized) {
    return null;
  }

  const fencedMatch = normalized.match(/```json\s*([\s\S]*?)```/i);
  const source = fencedMatch?.[1] || normalized;
  const firstBrace = Math.min(
    ...["[", "{"]
      .map((token) => source.indexOf(token))
      .filter((index) => index >= 0),
  );
  const lastBracket = Math.max(source.lastIndexOf("]"), source.lastIndexOf("}"));

  if (!Number.isFinite(firstBrace) || lastBracket < firstBrace) {
    return null;
  }

  try {
    return JSON.parse(source.slice(firstBrace, lastBracket + 1));
  } catch (_error) {
    return null;
  }
};

const normalizeQuestionType = (value) => {
  const normalized = normalizeValue(value).toLowerCase();

  if (normalized === "objective" || normalized === "multi_select" || normalized === "text_area") {
    return normalized;
  }

  return "subjective";
};

const normalizeDifficulty = (value) => {
  const normalized = normalizeValue(value).toLowerCase();

  if (normalized === "easy" || normalized === "hard") {
    return normalized;
  }

  return "medium";
};

const normalizeTopicTags = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => normalizeValue(item))
    .filter(Boolean);

const splitIntoSentences = (value) =>
  normalizeValue(value)
    .split(/(?<=[.!?])\s+/)
    .map((item) => normalizeValue(item))
    .filter((item) => item.length > 24);

const hasMeaningfulContent = (value) => splitIntoSentences(value).length >= 2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const AUTO_MIN_QUESTIONS_PER_SET = 2;
const AUTO_MAX_QUESTIONS_PER_SET = 3;
const AUTO_MAX_SET_COUNT = 2;

const hashString = (value) =>
  Array.from(normalizeValue(value)).reduce((sum, character, index) => {
    const next = sum + character.charCodeAt(0) * (index + 1);
    return next % 2147483647;
  }, 0);

const normalizeComparableText = (value) =>
  normalizeValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const rotateByOffset = (items, offset) => {
  if (!Array.isArray(items) || !items.length) {
    return Array.isArray(items) ? items : [];
  }

  const normalizedOffset = ((offset % items.length) + items.length) % items.length;

  if (!normalizedOffset) {
    return items;
  }

  return [...items.slice(normalizedOffset), ...items.slice(0, normalizedOffset)];
};

const uniqueWords = (value) =>
  Array.from(
    new Set(
      normalizeValue(value)
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((item) => item.trim())
        .filter((item) => item.length > 4),
    ),
  );

const selectSources = (slides, documents, selectedSourceIds) => {
  const selected = new Set(Array.isArray(selectedSourceIds) ? selectedSourceIds.map((item) => normalizeValue(item)) : []);
  const sources = [];

  if (!selected.size || selected.has("slides")) {
    slides.forEach((slide, index) => {
      const text = [
        `Slide ${index + 1} (${normalizeValue(slide.id)}): ${normalizeValue(slide.title) || "Untitled slide"}`,
        normalizeValue(slide.script),
        normalizeValue(slide.additionalInfo),
        Array.isArray(slide.mediaExtractedText) ? slide.mediaExtractedText.map((item) => normalizeValue(item)).filter(Boolean).join(" ") : "",
        Array.isArray(slide.points) ? slide.points.map((item) => normalizeValue(item)).filter(Boolean).join(". ") : "",
      ]
        .filter(Boolean)
        .join(". ");

      if (text) {
        sources.push({
          id: normalizeValue(slide.id),
          label: normalizeValue(slide.title) || `Slide ${index + 1}`,
          kind: "slide",
          slideIndex: index,
          text,
        });
      }
    });
  }

  documents.forEach((document) => {
    if (!selected.has(normalizeValue(document.id))) {
      return;
    }

    const text = normalizeValue(document.text);

    if (!text) {
      return;
    }

    sources.push({
      id: normalizeValue(document.id),
      label: normalizeValue(document.name) || "Knowledge Document",
      kind: "document",
      text,
    });
  });

  return sources;
};

const ensureQuestionTypeCount = (types, count) => {
  const validTypes = (Array.isArray(types) ? types : [])
    .map((item) => normalizeQuestionType(item))
    .filter(Boolean);
  const fallback = ["objective", "multi_select", "subjective", "text_area"];
  const baseSequence = validTypes.length ? validTypes : fallback;
  const seed = [...baseSequence];

  if (count <= seed.length) {
    return seed.slice(0, count);
  }

  while (seed.length < count) {
    seed.push(baseSequence[seed.length % baseSequence.length]);
  }

  return seed.slice(0, count);
};

const getSourceSentenceCount = (text) => splitIntoSentences(text).length;

const isStrongAssessmentSource = (text) => getSourceSentenceCount(text) >= 4;

const getRecommendedAutoSetCount = (slideSources, meaningfulSlides) => {
  if (!meaningfulSlides.length) {
    return 0;
  }

  const totalSentenceCount = meaningfulSlides.reduce((sum, source) => sum + getSourceSentenceCount(source.text), 0);
  const strongSlideCount = meaningfulSlides.filter((source) => isStrongAssessmentSource(source.text)).length;
  const slideCount = slideSources.length;

  if (slideCount <= 10) {
    return strongSlideCount >= 3 && totalSentenceCount >= 18 ? 2 : 1;
  }

  return strongSlideCount >= 6 && totalSentenceCount >= 32 ? 2 : 1;
};

const buildAssessmentWindows = (slideSources, setCount) => {
  if (!Array.isArray(slideSources) || !slideSources.length || setCount <= 0) {
    return [];
  }

  if (setCount === 1 || slideSources.length < 6) {
    return [
      {
        start: slideSources[0].slideIndex,
        end: slideSources[slideSources.length - 1].slideIndex,
        slides: slideSources,
      },
    ];
  }

  const midpoint = Math.ceil(slideSources.length / 2);
  const firstHalf = slideSources.slice(0, midpoint);
  const secondHalf = slideSources.slice(midpoint);
  const windows = [firstHalf, secondHalf]
    .filter((group) => group.length && group.some((source) => hasMeaningfulContent(source.text)))
    .map((group) => ({
      start: group[0].slideIndex,
      end: group[group.length - 1].slideIndex,
      slides: group,
    }));

  return windows.length
    ? windows
    : [
        {
          start: slideSources[0].slideIndex,
          end: slideSources[slideSources.length - 1].slideIndex,
          slides: slideSources,
        },
      ];
};

const buildDifficultyInstruction = (difficultyLevel) => {
  if (difficultyLevel === "easy") {
    return "Keep questions direct and foundational. Prefer recall, simple comprehension, and obvious distinctions.";
  }

  if (difficultyLevel === "hard") {
    return "Make questions more applied and nuanced. Prefer realistic scenarios, tricky distinctions, and decision-making under context.";
  }

  return "Keep questions moderately practical. Mix understanding with light real-world application.";
};

const buildPreviousQuestionSet = (questions) =>
  new Set(
    (Array.isArray(questions) ? questions : [])
      .flatMap((question) => [question?.prompt, question?.expectedAnswer])
      .map((item) => normalizeComparableText(item))
      .filter(Boolean),
  );

const filterUniqueSentences = (entries, previousQuestionKeys) => {
  const deduped = Array.from(
    new Map(
      (Array.isArray(entries) ? entries : [])
        .filter((entry) => normalizeComparableText(entry?.sentence))
        .map((entry) => [normalizeComparableText(entry.sentence), entry]),
    ).values(),
  );
  const filtered = deduped.filter((entry) => !previousQuestionKeys.has(normalizeComparableText(entry.sentence)));

  return filtered.length ? filtered : deduped;
};

const buildFallbackPrompt = ({ sentence, sourceLabel, questionType, difficultyLevel, variantIndex = 0 }) => {
  const promptMap = difficultyLevel === "easy"
    ? {
        objective: [
          `Which option best states the main point from ${sourceLabel}?`,
          `Which answer correctly matches the guidance from ${sourceLabel}?`,
          `Which statement is clearly supported by ${sourceLabel}?`,
        ],
        multi_select: [
          `Select all correct takeaways from ${sourceLabel}.`,
          `Choose all points that are directly covered in ${sourceLabel}.`,
          `Pick every valid takeaway mentioned in ${sourceLabel}.`,
        ],
        text_area: [
          `Write a short learner answer based on this guidance: ${sentence}`,
          `Answer briefly using this training point: ${sentence}`,
          `Respond in one or two lines using: ${sentence}`,
        ],
        subjective: [
          `In simple words, explain the key idea from ${sourceLabel}.`,
          `What is the main takeaway from ${sourceLabel}?`,
          `Briefly explain what ${sourceLabel} teaches.`,
        ],
      }
    : difficultyLevel === "hard"
      ? {
          objective: [
            `A learner misunderstands ${sourceLabel}. Which response best corrects them?`,
            `Which option best applies the guidance from ${sourceLabel} in a real scenario?`,
            `Which answer most accurately resolves a tricky case using ${sourceLabel}?`,
          ],
          multi_select: [
            `Select every action that correctly applies ${sourceLabel} in a realistic scenario.`,
            `Choose all responses that stay aligned with the guidance from ${sourceLabel}.`,
            `Pick all valid decisions a learner should make using ${sourceLabel}.`,
          ],
          text_area: [
            `Write a practical scenario-based response using this guidance: ${sentence}`,
            `Draft a learner response that applies this guidance in a tough real-world case: ${sentence}`,
            `Respond as if you are coaching someone through this situation: ${sentence}`,
          ],
          subjective: [
            `Explain how to apply the main idea from ${sourceLabel} in a real learner scenario.`,
            `A learner faces a tricky case. How should they use the guidance from ${sourceLabel}?`,
            `Describe the reasoning a learner should use based on ${sourceLabel}.`,
          ],
        }
      : {
          objective: [
            `Which statement best matches the training guidance from ${sourceLabel}?`,
            `Which option most accurately reflects the guidance from ${sourceLabel}?`,
            `Which answer aligns best with what ${sourceLabel} teaches?`,
          ],
          multi_select: [
            `Select all correct takeaways from ${sourceLabel}.`,
            `Choose every statement that correctly reflects ${sourceLabel}.`,
            `Pick all valid takeaways covered in ${sourceLabel}.`,
          ],
          text_area: [
            `Write a practical response using this training guidance: ${sentence}`,
            `Draft a short real-world response using this guidance: ${sentence}`,
            `Respond with a practical learner answer based on: ${sentence}`,
          ],
          subjective: [
            `In your own words, explain the key idea from ${sourceLabel}.`,
            `Summarize the main takeaway from ${sourceLabel} in your own words.`,
            `Explain the core point from ${sourceLabel} as a learner response.`,
          ],
        };

  const prompts = promptMap[questionType] || promptMap.subjective;
  return prompts[variantIndex % prompts.length];
};

const buildFallbackCheckpoint = ({
  setId,
  setLabel,
  questionType,
  index,
  sentence,
  fallbackSentence,
  sourceId,
  sourceLabel,
  placementMode,
  placementSlideId,
  difficultyLevel,
  topicTags,
  originSlideId,
  originSlideTitle,
  variantIndex,
}) => {
  const prompt = buildFallbackPrompt({
    sentence,
    sourceLabel,
    questionType,
    difficultyLevel,
    variantIndex,
  });

  if (questionType === "objective") {
    return {
      id: `question-${Date.now()}-${index}`,
      title: `Knowledge Check ${index + 1}`,
      prompt,
      questionType,
      options: [sentence, `${fallbackSentence} 1`, `${fallbackSentence} 2`, `${fallbackSentence} 3`].slice(0, 4),
      expectedAnswer: sentence,
      keywordMatches: [sentence],
      placementMode,
      placementSlideId,
      triggerType: "placement",
      reviewStatus: "draft",
      generatedBy: "ai",
      manualEdits: false,
      difficultyLevel,
      topicFocus: topicTags.join(", "),
      topicTags,
      generationSetId: setId,
      generationSetLabel: setLabel,
      originSlideId,
      originSlideTitle,
      sourceIds: [sourceId],
      sourceLabels: [sourceLabel],
    };
  }

  if (questionType === "multi_select") {
    const correctOptions = [sentence, fallbackSentence].filter((item, itemIndex, array) => array.indexOf(item) === itemIndex);

    return {
      id: `question-${Date.now()}-${index}`,
      title: `Knowledge Check ${index + 1}`,
      prompt,
      questionType,
      options: [...correctOptions, `Incorrect statement about ${sourceLabel}`, `Another incorrect statement about ${sourceLabel}`].slice(0, 4),
      expectedAnswer: correctOptions.join(" | "),
      keywordMatches: correctOptions,
      placementMode,
      placementSlideId,
      triggerType: "placement",
      reviewStatus: "draft",
      generatedBy: "ai",
      manualEdits: false,
      difficultyLevel,
      topicFocus: topicTags.join(", "),
      topicTags,
      generationSetId: setId,
      generationSetLabel: setLabel,
      originSlideId,
      originSlideTitle,
      sourceIds: [sourceId],
      sourceLabels: [sourceLabel],
    };
  }

  return {
    id: `question-${Date.now()}-${index}`,
    title: `Knowledge Check ${index + 1}`,
    prompt,
    questionType,
    options: [],
    expectedAnswer: sentence,
    keywordMatches: uniqueWords(sentence).slice(0, 4),
    placementMode,
    placementSlideId,
    triggerType: "placement",
    reviewStatus: "draft",
    generatedBy: "ai",
    manualEdits: false,
    difficultyLevel,
    topicFocus: topicTags.join(", "),
    topicTags,
    generationSetId: setId,
    generationSetLabel: setLabel,
    originSlideId,
    originSlideTitle,
    sourceIds: [sourceId],
    sourceLabels: [sourceLabel],
  };
};

const buildLocalPlan = ({ slides, documents, configPayload, existingSet, previousQuestions, variationToken }) => {
  const sources = selectSources(slides, documents, configPayload.selectedSourceIds);
  const slideSources = sources.filter((source) => source.kind === "slide");
  const documentSources = sources.filter((source) => source.kind === "document");
  const topicTags = normalizeTopicTags(configPayload.topicTags);
  const difficultyLevel = normalizeDifficulty(configPayload.difficultyLevel);
  const previousQuestionKeys = buildPreviousQuestionSet(previousQuestions);
  const variationOffset = hashString(
    variationToken || `${normalizeValue(configPayload.customPrompt)}-${new Date().toISOString()}`,
  );
  const allowExtendedCount = Boolean(existingSet);
  const minQuestions = allowExtendedCount
    ? Math.min(10, Math.max(1, Number(configPayload.minimumQuestionsPerSet || 1)))
    : Math.min(AUTO_MAX_QUESTIONS_PER_SET, Math.max(AUTO_MIN_QUESTIONS_PER_SET, Number(configPayload.minimumQuestionsPerSet || AUTO_MIN_QUESTIONS_PER_SET)));
  const maxQuestions = allowExtendedCount
    ? Math.min(10, Math.max(minQuestions, Number(configPayload.maximumQuestionsPerSet || 10)))
    : Math.min(AUTO_MAX_QUESTIONS_PER_SET, Math.max(minQuestions, Number(configPayload.maximumQuestionsPerSet || AUTO_MAX_QUESTIONS_PER_SET)));

  const buildSet = ({
    setId,
    label,
    placementMode,
    slideId,
    slideTitle,
    sourceSlideIds,
    sourceRangeLabel,
    plannerSummary,
    sourceIds,
    sourceLabels,
    questionTypes,
  }) => {
    const candidateSources = [
      ...slideSources.filter((source) => sourceSlideIds.includes(source.id)),
      ...documentSources.slice(0, 2),
    ];
    const sentencePool = candidateSources.flatMap((source) =>
      splitIntoSentences(source.text).slice(0, 3).map((sentence) => ({
        sentence,
        sourceId: source.id,
        sourceLabel: source.label,
      })),
    );
    const usableSentencePool = rotateByOffset(
      filterUniqueSentences(sentencePool, previousQuestionKeys),
      variationOffset + hashString(setId),
    );

    if (!usableSentencePool.length) {
      return null;
    }

    const checkpoints = questionTypes.map((questionType, index) => {
      const currentSentence = usableSentencePool[index % usableSentencePool.length];
      const fallbackSentence = usableSentencePool[(index + 1) % usableSentencePool.length]?.sentence || currentSentence.sentence;

      return buildFallbackCheckpoint({
        setId,
        setLabel: label,
        questionType,
        index,
        sentence: currentSentence.sentence,
        fallbackSentence,
        sourceId: currentSentence.sourceId,
        sourceLabel: currentSentence.sourceLabel,
        placementMode,
        placementSlideId: placementMode === "end_of_training" ? null : slideId,
        difficultyLevel,
        topicTags,
        originSlideId: slideId || null,
        originSlideTitle: slideTitle || "",
        variantIndex: variationOffset + index,
      });
    });

    return {
      id: setId,
      label,
      placementMode,
      slideId: slideId || null,
      slideTitle: slideTitle || "",
      difficultyLevel,
      topicTags,
      sourceIds,
      sourceLabels,
      sourceSlideIds,
      sourceRangeLabel,
      plannerSummary,
      generatedQuestionTypes: questionTypes,
      questionCount: checkpoints.length,
      checkpoints,
    };
  };

  if (existingSet && normalizeValue(existingSet.id)) {
    const questionCount = Math.min(
      maxQuestions,
      Math.max(minQuestions, Number(existingSet.questionCount || minQuestions)),
    );
    const questionTypes = ensureQuestionTypeCount(configPayload.preferredQuestionTypes, questionCount);

    return [
      buildSet({
        setId: normalizeValue(existingSet.id),
        label: normalizeValue(existingSet.label) || "Question Set",
        placementMode: normalizeValue(existingSet.placementMode) === "end_of_training" ? "end_of_training" : "after_slide",
        slideId: normalizeValue(existingSet.slideId) || null,
        slideTitle: normalizeValue(existingSet.slideTitle),
        sourceSlideIds: Array.isArray(existingSet.sourceSlideIds) ? existingSet.sourceSlideIds.map((item) => normalizeValue(item)).filter(Boolean) : [],
        sourceRangeLabel: normalizeValue(existingSet.sourceRangeLabel),
        plannerSummary: normalizeValue(existingSet.plannerSummary) || "Regenerated from the same assessment checkpoint.",
        sourceIds: Array.isArray(existingSet.sourceIds) ? existingSet.sourceIds.map((item) => normalizeValue(item)).filter(Boolean) : [],
        sourceLabels: Array.isArray(existingSet.sourceLabels) ? existingSet.sourceLabels.map((item) => normalizeValue(item)).filter(Boolean) : [],
        questionTypes,
      }),
    ].filter(Boolean);
  }

  const sets = [];
  const meaningfulSlides = slideSources.filter((source) => hasMeaningfulContent(source.text));
  const maxSetCount = Math.min(
    AUTO_MAX_SET_COUNT,
    getRecommendedAutoSetCount(slideSources, meaningfulSlides),
  );
  const candidateWindows = buildAssessmentWindows(meaningfulSlides, maxSetCount);

  candidateWindows.forEach((window, setIndex) => {
    const sourceSlice = window.slides.filter((source) => hasMeaningfulContent(source.text));
    const targetSlide = sourceSlice[sourceSlice.length - 1];

    if (!targetSlide) {
      return;
    }

    const readableSlice = sourceSlice;

    if (readableSlice.length < 2) {
      return;
    }

    const questionCount = clamp(
      readableSlice.some((source) => isStrongAssessmentSource(source.text)) ? 3 : 2,
      minQuestions,
      maxQuestions,
    );
    const questionTypes = ensureQuestionTypeCount(configPayload.preferredQuestionTypes, questionCount);
    const set = buildSet({
      setId: `question-set-${Date.now()}-${sets.length}`,
      label: `Question Set ${sets.length + 1}`,
      placementMode: targetSlide.slideIndex >= slideSources[slideSources.length - 1].slideIndex ? "end_of_training" : "after_slide",
      slideId: targetSlide.slideIndex >= slideSources[slideSources.length - 1].slideIndex ? null : targetSlide.id,
      slideTitle: targetSlide.slideIndex >= slideSources[slideSources.length - 1].slideIndex ? "" : targetSlide.label,
      sourceSlideIds: readableSlice.map((source) => source.id),
      sourceRangeLabel: readableSlice.length > 1 ? `Slides ${window.start + 1}-${targetSlide.slideIndex + 1}` : `Slide ${targetSlide.slideIndex + 1}`,
      plannerSummary: `Brief attention-check after slides ${window.start + 1}-${targetSlide.slideIndex + 1} using the strongest concepts from this section.`,
      sourceIds: [...new Set([...readableSlice.map((source) => source.id), ...documentSources.slice(0, 2).map((source) => source.id)])],
      sourceLabels: [...new Set([...readableSlice.map((source) => source.label), ...documentSources.slice(0, 2).map((source) => source.label)])],
      questionTypes,
    });

    if (set) {
      sets.push(set);
    }
  });

  if (!sets.length && slideSources.length) {
    const fallbackSlide =
      [...slideSources].reverse().find((source) => hasMeaningfulContent(source.text)) ||
      slideSources[slideSources.length - 1];
    const fallbackSentences = splitIntoSentences(fallbackSlide.text);

    if (fallbackSentences.length >= AUTO_MIN_QUESTIONS_PER_SET) {
      const questionTypes = ensureQuestionTypeCount(
        configPayload.preferredQuestionTypes,
        clamp(isStrongAssessmentSource(fallbackSlide.text) ? 3 : 2, minQuestions, maxQuestions),
      );
      const set = buildSet({
        setId: `question-set-${Date.now()}-fallback`,
        label: "Question Set 1",
        placementMode: fallbackSlide.slideIndex >= slideSources.length - 1 ? "end_of_training" : "after_slide",
        slideId: fallbackSlide.slideIndex >= slideSources.length - 1 ? null : fallbackSlide.id,
        slideTitle: fallbackSlide.slideIndex >= slideSources.length - 1 ? "" : fallbackSlide.label,
        sourceSlideIds: [fallbackSlide.id],
        sourceRangeLabel: `Slide ${fallbackSlide.slideIndex + 1}`,
        plannerSummary: "Fallback attention-check created from the strongest available slide content.",
        sourceIds: [fallbackSlide.id],
        sourceLabels: [fallbackSlide.label],
        questionTypes,
      });

      if (set) {
        sets.push(set);
      }
    }
  }

  return sets;
};

const buildPlannerPrompt = ({ title, slides, documents, configPayload, existingSet, previousQuestions, generationMode, variationToken }) => {
  const topicTags = normalizeTopicTags(configPayload?.topicTags);
  const preferredTypes = ensureQuestionTypeCount(configPayload?.preferredQuestionTypes, 3);
  const previousQuestionSummary = (Array.isArray(previousQuestions) ? previousQuestions : [])
    .slice(0, 12)
    .map((question, index) => `- Existing ${index + 1}: ${normalizeValue(question?.prompt)} | answer=${normalizeValue(question?.expectedAnswer)}`)
    .join("\n");

  return [
    "You design Trainup training knowledge-check sets.",
    "Return valid JSON only. No markdown.",
    "Return an object with key questionSets.",
    "questionSets must be an array of 1 or more objects.",
    "Each object must include: label, placementMode, slideId, slideTitle, sourceSlideIds, sourceRangeLabel, plannerSummary, difficultyLevel, generatedQuestionTypes, questionCount.",
    "placementMode should usually be after_slide, and only use end_of_training when the checkpoint belongs at the module end.",
    "Do not create checkpoints too early before the learner has enough context.",
    "This is a lightweight attentiveness check, not a full exam.",
    "Create at most 2 question sets total for the whole training.",
    "For decks around 10 slides or fewer, usually create only 1 question set. Use 2 only when the content is clearly split into two strong sections.",
    "Even for larger decks, do not scale sets linearly by slide count. Usually keep it to 1 set, and only use 2 if there are two clearly strong sections.",
    "Do not create one question set per slide.",
    generationMode === "append"
      ? "Generate net-new question sets that add fresh assessments. Do not repeat or lightly paraphrase the previous draft."
      : "If previous generated questions exist, avoid repeating or lightly paraphrasing them.",
    existingSet ? "The selected set may have between 1 and 10 questions." : "Each new auto-generated set should usually have only 2 or 3 questions.",
    `Training title: ${normalizeValue(title)}`,
    `Default difficulty: ${normalizeDifficulty(configPayload?.difficultyLevel)}`,
    buildDifficultyInstruction(normalizeDifficulty(configPayload?.difficultyLevel)),
    `Question count bounds: ${
      existingSet
        ? Math.max(1, Number(configPayload?.minimumQuestionsPerSet || 1))
        : Math.max(3, Number(configPayload?.minimumQuestionsPerSet || 3))
    } to ${
      existingSet
        ? Math.min(10, Math.max(1, Number(configPayload?.maximumQuestionsPerSet || 10)))
        : Math.min(5, Math.max(3, Number(configPayload?.maximumQuestionsPerSet || 5)))
    }`,
    topicTags.length ? `Topic tags: ${topicTags.join(", ")}` : "",
    `Preferred question types: ${preferredTypes.join(", ")}`,
    variationToken ? `Variation token: ${normalizeValue(variationToken)}` : "",
    configPayload?.customPrompt ? `Custom instructions: ${normalizeValue(configPayload.customPrompt)}` : "",
    previousQuestionSummary ? `Avoid these existing questions:\n${previousQuestionSummary}` : "",
    "Slides in order:",
    slides
      .map((slide, index) =>
        [
          `- Slide ${index + 1}`,
          `id=${normalizeValue(slide.id)}`,
          `title=${normalizeValue(slide.title) || "Untitled slide"}`,
          `content=${[
            normalizeValue(slide.script),
            normalizeValue(slide.additionalInfo),
            Array.isArray(slide.mediaExtractedText) ? slide.mediaExtractedText.map((item) => normalizeValue(item)).filter(Boolean).join(" ") : "",
            Array.isArray(slide.points) ? slide.points.map((item) => normalizeValue(item)).filter(Boolean).join(". ") : "",
          ]
            .filter(Boolean)
            .join(". ")}`,
        ].join(" | "),
      )
      .join("\n"),
    documents.length
      ? [
          "Knowledge documents:",
          documents
            .map((document) => `- ${normalizeValue(document.id)} | ${normalizeValue(document.name)} | ${normalizeValue(document.text).slice(0, 2400)}`)
            .join("\n"),
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

const buildQuestionPrompt = ({ title, setPlan, sources, configPayload, existingSet, previousQuestions, generationMode, variationToken }) => {
  const topicTags = normalizeTopicTags(configPayload?.topicTags);
  const previousQuestionSummary = (Array.isArray(previousQuestions) ? previousQuestions : [])
    .slice(0, 12)
    .map((question, index) => `- Existing ${index + 1}: ${normalizeValue(question?.prompt)} | answer=${normalizeValue(question?.expectedAnswer)}`)
    .join("\n");

  return [
    "You generate Trainup training assessment questions.",
    "Return valid JSON only. No markdown, no commentary.",
    "Return an array of objects with keys: title, prompt, questionType, options, expectedAnswer, keywordMatches, sourceId.",
    "questionType must be one of subjective, objective, multi_select, text_area.",
    "For objective questions provide exactly 4 options and expectedAnswer must equal one option.",
    "For multi_select questions provide 4 options and keywordMatches must contain the correct options.",
    "For subjective and text_area questions provide a concise expectedAnswer and 2 to 4 keywordMatches.",
    "This is a lightweight attentiveness check, not a full exam.",
    "Keep the set compact and useful. Use only 2 or 3 strong questions unless explicitly regenerating a custom longer set.",
    "Do not ask the same concept as separate questions in different question types.",
    "Do not repeat or lightly paraphrase any previous generated question or answer.",
    "Avoid random or trivial questions. Prefer core practical takeaways and learner-relevant checks.",
    `Training title: ${normalizeValue(title)}`,
    `Set label: ${normalizeValue(setPlan.label)}`,
    `Planner summary: ${normalizeValue(setPlan.plannerSummary)}`,
    `Difficulty: ${normalizeDifficulty(setPlan.difficultyLevel || configPayload?.difficultyLevel)}`,
    buildDifficultyInstruction(normalizeDifficulty(setPlan.difficultyLevel || configPayload?.difficultyLevel)),
    topicTags.length ? `Topic tags: ${topicTags.join(", ")}` : "",
    generationMode === "append" ? "This run appends fresh sets to an existing draft, so every question must feel new." : "",
    variationToken ? `Variation token: ${normalizeValue(variationToken)}` : "",
    configPayload?.customPrompt ? `Custom instructions: ${normalizeValue(configPayload.customPrompt)}` : "",
    `Required question order: ${ensureQuestionTypeCount(
      setPlan.generatedQuestionTypes,
      existingSet ? Math.max(1, Number(setPlan.questionCount || 1)) : Math.max(3, Number(setPlan.questionCount || 3)),
    ).join(", ")}`,
    previousQuestionSummary ? `Avoid these existing questions:\n${previousQuestionSummary}` : "",
    "Knowledge sources:",
    sources.map((source) => `- ${source.id}: ${source.label}\n${source.text}`).join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
};

const buildQuestions = async (req, res) => {
  const title = normalizeValue(req.body.trainingTitle);
  const slides = Array.isArray(req.body.slides) ? req.body.slides : [];
  const documents = Array.isArray(req.body.knowledgeDocuments) ? req.body.knowledgeDocuments : [];
  const configPayload = req.body.config || {};
  const existingSet = req.body.existingSet && typeof req.body.existingSet === "object" ? req.body.existingSet : null;
  const previousQuestions = Array.isArray(req.body.previousQuestions) ? req.body.previousQuestions : [];
  const generationMode = normalizeValue(req.body.generationMode) || "overwrite";
  const variationToken = normalizeValue(req.body.variationToken) || new Date().toISOString();

  if (!slides.length && !documents.length) {
    return fail(res, 400, "At least one slide or knowledge document is required.");
  }

  const sources = selectSources(slides, documents, configPayload.selectedSourceIds);

  if (!sources.length) {
    return fail(res, 400, "At least one knowledge source is required.");
  }

  if (!isGroqConfigured()) {
    return ok(res, "Training question sets generated successfully.", {
      questionSets: buildLocalPlan({ slides, documents, configPayload, existingSet, previousQuestions, variationToken }),
      model: "local-fallback",
    });
  }

  try {
    let plannedSets = [];

    if (existingSet && normalizeValue(existingSet.id)) {
      plannedSets = buildLocalPlan({ slides, documents, configPayload, existingSet, previousQuestions, variationToken });
    } else {
      const plannerReply = await createGroqReply({
        systemPrompt: "You are a structured assessment planner for Trainup training modules. Return strict JSON only.",
        context: buildPlannerPrompt({
          title,
          slides,
          documents,
          configPayload,
          existingSet,
          previousQuestions,
          generationMode,
          variationToken,
        }),
        message: "Plan the question sets now.",
        temperature: 0.2,
        maxTokens: 2000,
      });

      const plannerParsed = parseJsonValue(plannerReply);
      plannedSets = Array.isArray(plannerParsed?.questionSets) ? plannerParsed.questionSets : [];

      if (!plannedSets.length) {
        plannedSets = buildLocalPlan({ slides, documents, configPayload, existingSet: null, previousQuestions, variationToken });
      }
    }

    const normalizedSets = plannedSets
      .map((setPlan, setIndex) => {
        const sourceIds = Array.isArray(setPlan.sourceIds)
          ? setPlan.sourceIds.map((item) => normalizeValue(item)).filter(Boolean)
          : Array.isArray(setPlan.sourceSlideIds)
            ? setPlan.sourceSlideIds.map((item) => normalizeValue(item)).filter(Boolean)
            : [];
        const filteredSources = sources.filter((source) => sourceIds.includes(source.id));
        const effectiveSources = filteredSources.length ? filteredSources : sources.slice(0, 4);
        const questionCount = existingSet
          ? Math.min(10, Math.max(1, Number(setPlan.questionCount || configPayload.maximumQuestionsPerSet || configPayload.minimumQuestionsPerSet || 1)))
          : Math.min(5, Math.max(3, Number(setPlan.questionCount || configPayload.minimumQuestionsPerSet || 3)));
        const questionTypes = ensureQuestionTypeCount(setPlan.generatedQuestionTypes || configPayload.preferredQuestionTypes, questionCount);

        return {
          id: normalizeValue(setPlan.id) || `question-set-${Date.now()}-${setIndex}`,
          label: normalizeValue(setPlan.label) || `Question Set ${setIndex + 1}`,
          placementMode: normalizeValue(setPlan.placementMode) === "end_of_training" ? "end_of_training" : "after_slide",
          slideId: normalizeValue(setPlan.slideId) || null,
          slideTitle: normalizeValue(setPlan.slideTitle),
          difficultyLevel: normalizeDifficulty(setPlan.difficultyLevel || configPayload.difficultyLevel),
          topicTags: normalizeTopicTags(setPlan.topicTags || configPayload.topicTags),
          sourceIds: effectiveSources.map((source) => source.id),
          sourceLabels: effectiveSources.map((source) => source.label),
          sourceSlideIds: Array.isArray(setPlan.sourceSlideIds) ? setPlan.sourceSlideIds.map((item) => normalizeValue(item)).filter(Boolean) : [],
          sourceRangeLabel: normalizeValue(setPlan.sourceRangeLabel),
          plannerSummary: normalizeValue(setPlan.plannerSummary),
          generatedQuestionTypes: questionTypes,
          questionCount,
          effectiveSources,
        };
      })
      .filter((item) => item.effectiveSources.length);

    const questionSets = [];

    for (let index = 0; index < normalizedSets.length; index += 1) {
      const setPlan = normalizedSets[index];
      const questionReply = await createGroqReply({
        systemPrompt: "You are a structured question generator for Trainup training content. Only use the provided module sources. Return strict JSON.",
        context: buildQuestionPrompt({
          title,
          setPlan,
          sources: setPlan.effectiveSources,
          configPayload,
          existingSet,
          previousQuestions,
          generationMode,
          variationToken,
        }),
        message: "Generate the requested training questions now.",
        temperature: 0.55,
        maxTokens: 1800,
      });

      const parsedQuestions = parseJsonValue(questionReply);
      const normalizedQuestions = Array.isArray(parsedQuestions) ? parsedQuestions : [];

      const checkpoints = normalizedQuestions.length
        ? normalizedQuestions.slice(0, setPlan.questionCount).map((question, questionIndex) => {
            const sourceId = normalizeValue(question.sourceId) || setPlan.effectiveSources[0].id;
            const source = setPlan.effectiveSources.find((item) => item.id === sourceId) || setPlan.effectiveSources[0];
            const expectedQuestionType =
              setPlan.generatedQuestionTypes[questionIndex] || normalizeQuestionType(question.questionType);
            const fallbackSentence =
              splitIntoSentences(source.text)[questionIndex % Math.max(splitIntoSentences(source.text).length, 1)] ||
              normalizeValue(question.expectedAnswer) ||
              "Apply the training guidance in a learner-facing scenario.";
            const fallbackCheckpoint = buildFallbackCheckpoint({
              setId: setPlan.id,
              setLabel: setPlan.label,
              questionType: expectedQuestionType,
              index: questionIndex,
              sentence: normalizeValue(question.expectedAnswer) || fallbackSentence,
              fallbackSentence,
              sourceId: source.id,
              sourceLabel: source.label,
              placementMode: setPlan.placementMode,
              placementSlideId: setPlan.placementMode === "end_of_training" ? null : setPlan.slideId,
              difficultyLevel: setPlan.difficultyLevel,
              topicTags: setPlan.topicTags,
              originSlideId: setPlan.slideId || null,
              originSlideTitle: setPlan.slideTitle || "",
              variantIndex: hashString(`${variationToken}-${setPlan.id}-${questionIndex}`),
            });
            const normalizedOptions = Array.isArray(question.options)
              ? question.options.map((item) => normalizeValue(item)).filter(Boolean)
              : [];
            const normalizedKeywordMatches = Array.isArray(question.keywordMatches)
              ? question.keywordMatches.map((item) => normalizeValue(item)).filter(Boolean)
              : [];
            const normalizedExpectedAnswer = normalizeValue(question.expectedAnswer);
            const normalizedPrompt = normalizeValue(question.prompt) || fallbackCheckpoint.prompt;
            const normalizedTitle = normalizeValue(question.title) || `Knowledge Check ${questionIndex + 1}`;
            const hasValidChoiceOptions =
              expectedQuestionType === "objective"
                ? normalizedOptions.length >= 4 && normalizedExpectedAnswer && normalizedOptions.includes(normalizedExpectedAnswer)
                : expectedQuestionType === "multi_select"
                  ? normalizedOptions.length >= 4 && normalizedKeywordMatches.length > 0
                  : true;

            if (!hasValidChoiceOptions) {
              return {
                ...fallbackCheckpoint,
                title: normalizedTitle,
                prompt: normalizedPrompt,
              };
            }

            return {
              id: `question-${Date.now()}-${questionIndex}`,
              title: normalizedTitle,
              prompt: normalizedPrompt,
              questionType: expectedQuestionType,
              options: expectedQuestionType === "objective" || expectedQuestionType === "multi_select" ? normalizedOptions.slice(0, 4) : [],
              expectedAnswer: normalizedExpectedAnswer || fallbackCheckpoint.expectedAnswer,
              keywordMatches:
                expectedQuestionType === "objective" || expectedQuestionType === "multi_select"
                  ? normalizedKeywordMatches
                  : normalizedKeywordMatches.length
                    ? normalizedKeywordMatches
                    : fallbackCheckpoint.keywordMatches,
              placementMode: setPlan.placementMode,
              placementSlideId: setPlan.placementMode === "end_of_training" ? null : setPlan.slideId,
              triggerType: "placement",
              reviewStatus: "draft",
              generatedBy: "ai",
              manualEdits: false,
              difficultyLevel: setPlan.difficultyLevel,
              topicFocus: setPlan.topicTags.join(", "),
              topicTags: setPlan.topicTags,
              generationSetId: setPlan.id,
              generationSetLabel: setPlan.label,
              originSlideId: setPlan.slideId || null,
              originSlideTitle: setPlan.slideTitle || "",
              sourceIds: [source.id],
              sourceLabels: [source.label],
            };
          })
        : buildLocalPlan({
            slides,
            documents,
            configPayload: {
              ...configPayload,
              difficultyLevel: setPlan.difficultyLevel,
              preferredQuestionTypes: setPlan.generatedQuestionTypes,
            },
            existingSet: {
              ...setPlan,
              questionCount: setPlan.questionCount,
            },
          })[0]?.checkpoints || [];

      questionSets.push({
        id: setPlan.id,
        label: setPlan.label,
        placementMode: setPlan.placementMode,
        slideId: setPlan.slideId,
        slideTitle: setPlan.slideTitle,
        difficultyLevel: setPlan.difficultyLevel,
        topicTags: setPlan.topicTags,
        sourceIds: setPlan.sourceIds,
        sourceLabels: setPlan.sourceLabels,
        sourceSlideIds: setPlan.sourceSlideIds,
        sourceRangeLabel: setPlan.sourceRangeLabel,
        plannerSummary: setPlan.plannerSummary,
        generatedQuestionTypes: setPlan.generatedQuestionTypes,
        questionCount: checkpoints.length,
        checkpoints,
      });
    }

    return ok(res, "Training question sets generated successfully.", {
      questionSets,
      model: config.groq.model,
    });
  } catch (error) {
    return ok(res, "Training question sets generated successfully.", {
      questionSets: buildLocalPlan({ slides, documents, configPayload, existingSet, previousQuestions, variationToken }),
      model: "local-fallback",
    });
  }
};

module.exports = {
  buildQuestions,
};
