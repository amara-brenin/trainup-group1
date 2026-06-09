import AxiosHelper, { isServerApiEnabled } from "./AxiosHelper";
import type {
  TrainingKnowledgeDocument,
  TrainingQuestionCheckpoint,
  TrainingQuestionDifficulty,
  TrainingQuestionGeneratorConfig,
  TrainingQuestionSetRecord,
  TrainingQuestionType,
  TrainingSlideRecord,
} from "../constant/interfaces";

type QuestionGenerationInput = {
  trainingTitle: string;
  slides: TrainingSlideRecord[];
  knowledgeDocuments: TrainingKnowledgeDocument[];
  config: TrainingQuestionGeneratorConfig;
  generationMode?: "overwrite" | "append" | "regenerate_set";
  variationToken?: string;
  previousQuestions?: Array<{
    prompt: string;
    expectedAnswer?: string;
    questionType?: TrainingQuestionType;
    setLabel?: string;
  }>;
  existingSet?: {
    id: string;
    label: string;
    placementMode: TrainingQuestionSetRecord["placementMode"];
    slideId?: string | null;
    slideTitle?: string;
    isMandatory?: boolean;
    sourceSlideIds?: string[];
    sourceRangeLabel?: string;
    sourceIds: string[];
    sourceLabels: string[];
    plannerSummary?: string;
  } | null;
};

type PlannedQuestionSetPayload = {
  id?: string;
  label?: string;
  placementMode?: TrainingQuestionSetRecord["placementMode"];
  slideId?: string | null;
  slideTitle?: string;
  isMandatory?: boolean;
  difficultyLevel?: TrainingQuestionDifficulty;
  topicTags?: string[];
  sourceIds?: string[];
  sourceLabels?: string[];
  sourceSlideIds?: string[];
  sourceRangeLabel?: string;
  plannerSummary?: string;
  generatedQuestionTypes?: TrainingQuestionType[];
  questionCount?: number;
  checkpoints: TrainingQuestionCheckpoint[];
};

type QuestionGenerationResponse = {
  questionSets: PlannedQuestionSetPayload[];
  model?: string;
};

const splitIntoSentences = (value: string) =>
  String(value || "")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 24);

const hasMeaningfulContent = (value: string) => splitIntoSentences(value).length >= 2;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const AUTO_MIN_QUESTIONS_PER_SET = 2;
const AUTO_MAX_QUESTIONS_PER_SET = 3;
const AUTO_MAX_SET_COUNT = 2;

const hashString = (value: string) =>
  Array.from(String(value || "")).reduce((sum, character, index) => {
    const next = sum + character.charCodeAt(0) * (index + 1);
    return next % 2147483647;
  }, 0);

const normalizeComparableText = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const rotateByOffset = <T,>(items: T[], offset: number) => {
  if (!items.length) {
    return items;
  }

  const normalizedOffset = ((offset % items.length) + items.length) % items.length;

  if (!normalizedOffset) {
    return items;
  }

  return [...items.slice(normalizedOffset), ...items.slice(0, normalizedOffset)];
};

const uniqueWords = (value: string) =>
  Array.from(
    new Set(
      String(value || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((item) => item.trim())
        .filter((item) => item.length > 4),
    ),
  );

const buildSelectedSources = ({ slides, knowledgeDocuments, config }: QuestionGenerationInput) => {
  const selectedIds = new Set(config.selectedSourceIds);
  const slideSources = slides.map((slide, index) => ({
    id: slide.id,
    name: slide.title || `Slide ${index + 1}`,
    kind: "slide" as const,
    index,
    text: [
      slide.title,
      slide.script,
      slide.additionalInfo,
      (slide.mediaExtractedText ?? []).join(" "),
      (slide.points ?? []).join(". "),
    ]
      .filter(Boolean)
      .join(". "),
  }));

  const sources: Array<{
    id: string;
    name: string;
    kind: "slide" | "document";
    index?: number;
    text: string;
  }> = [];

  if (!selectedIds.size || selectedIds.has("slides")) {
    sources.push(...slideSources.filter((item) => String(item.text || "").trim()));
  }

  knowledgeDocuments.forEach((document) => {
    if (!selectedIds.has(document.id)) {
      return;
    }

    sources.push({
      id: document.id,
      name: document.name,
      kind: "document",
      text: document.text,
    });
  });

  return sources;
};

const normalizeQuestionTypePreference = (types?: TrainingQuestionType[]) => {
  const validTypes: TrainingQuestionType[] = ["objective", "multi_select", "subjective", "text_area"];

  return (types ?? []).filter((type): type is TrainingQuestionType => validTypes.includes(type));
};

const ensureQuestionTypeCount = (
  types: TrainingQuestionType[] | undefined,
  count: number,
): TrainingQuestionType[] => {
  const preferred = normalizeQuestionTypePreference(types);
  const fallback: TrainingQuestionType[] = ["objective", "multi_select", "subjective", "text_area"];
  const baseSequence = preferred.length ? preferred : fallback;
  const sequence = [...baseSequence];

  if (count <= sequence.length) {
    return sequence.slice(0, count);
  }

  while (sequence.length < count) {
    sequence.push(baseSequence[sequence.length % baseSequence.length]);
  }

  return sequence.slice(0, count);
};

const buildPlacementLabel = (startIndex: number, endIndex: number) =>
  startIndex === endIndex ? `Slide ${endIndex + 1}` : `Slides ${startIndex + 1}-${endIndex + 1}`;

const getSourceSentenceCount = (text: string) => splitIntoSentences(text).length;

const isStrongAssessmentSource = (text: string) => getSourceSentenceCount(text) >= 4;

const getRecommendedAutoSetCount = (
  slideSources: Array<{ text: string }>,
  meaningfulSlides: Array<{ text: string }>,
) => {
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

const buildAssessmentWindows = <
  T extends {
    index: number;
    text: string;
  },
>(
  slideSources: T[],
  setCount: number,
) => {
  if (!slideSources.length || setCount <= 0) {
    return [] as Array<{ start: number; end: number; slides: T[] }>;
  }

  if (setCount === 1 || slideSources.length < 6) {
    return [
      {
        start: slideSources[0].index,
        end: slideSources[slideSources.length - 1].index,
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
      start: group[0].index,
      end: group[group.length - 1].index,
      slides: group,
    }));

  return windows.length ? windows : [
    {
      start: slideSources[0].index,
      end: slideSources[slideSources.length - 1].index,
      slides: slideSources,
    },
  ];
};

const buildDifficultyAwareQuestionPrompts = (
  sourceLabel: string,
  sentence: string,
  difficultyLevel: TrainingQuestionDifficulty,
): Record<TrainingQuestionType, string[]> => {
  if (difficultyLevel === "easy") {
    return {
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
    };
  }

  if (difficultyLevel === "hard") {
    return {
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
    };
  }

  return {
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
};

const buildQuestionPrompt = (
  sentence: string,
  sourceLabel: string,
  questionType: TrainingQuestionType,
  difficultyLevel: TrainingQuestionDifficulty,
  variantIndex = 0,
) => {
  const questionPrompts = buildDifficultyAwareQuestionPrompts(sourceLabel, sentence, difficultyLevel);

  const prompts = questionPrompts[questionType];
  return prompts[variantIndex % prompts.length];
};

const buildPreviousQuestionSet = (previousQuestions?: QuestionGenerationInput["previousQuestions"]) =>
  new Set(
    (previousQuestions ?? [])
      .flatMap((question) => [question.prompt, question.expectedAnswer ?? ""])
      .map((item) => normalizeComparableText(item))
      .filter(Boolean),
  );

const filterUniqueSentences = <
  T extends {
    sentence: string;
  },
>(
  items: T[],
  previousQuestionKeys: Set<string>,
) => {
  const deduped = Array.from(
    new Map(items.map((entry) => [normalizeComparableText(entry.sentence), entry])).values(),
  ).filter((entry) => normalizeComparableText(entry.sentence));

  const filtered = deduped.filter((entry) => !previousQuestionKeys.has(normalizeComparableText(entry.sentence)));

  return filtered.length ? filtered : deduped;
};

const buildQuestionPromptLegacy = (
  sentence: string,
  sourceLabel: string,
  questionType: TrainingQuestionType,
  difficultyLevel: TrainingQuestionDifficulty,
  variantIndex = 0,
) => {
  if (questionType === "objective") {
    return buildQuestionPrompt(sentence, sourceLabel, questionType, difficultyLevel, variantIndex);
  }

  if (questionType === "multi_select") {
    return buildQuestionPrompt(sentence, sourceLabel, questionType, difficultyLevel, variantIndex);
  }

  if (questionType === "text_area") {
    return buildQuestionPrompt(sentence, sourceLabel, questionType, difficultyLevel, variantIndex);
  }

  return buildQuestionPrompt(sentence, sourceLabel, questionType, difficultyLevel, variantIndex);
};

const buildCheckpoint = ({
  index,
  questionType,
  sentence,
  fallbackSentence,
  sourceId,
  sourceLabel,
  placementMode,
  placementSlideId,
  difficultyLevel,
  topicTags,
  setId,
  setLabel,
  originSlideId,
  originSlideTitle,
  variantIndex,
}: {
  index: number;
  questionType: TrainingQuestionType;
  sentence: string;
  fallbackSentence: string;
  sourceId: string;
  sourceLabel: string;
  placementMode: TrainingQuestionSetRecord["placementMode"];
  placementSlideId?: string | null;
  difficultyLevel: TrainingQuestionDifficulty;
  topicTags: string[];
  setId: string;
  setLabel: string;
  originSlideId?: string | null;
  originSlideTitle?: string;
  variantIndex?: number;
}): TrainingQuestionCheckpoint => {
  const keywords = uniqueWords(sentence).slice(0, 4);
  const baseId = `question-${Date.now()}-${index}`;

  if (questionType === "objective") {
    const distractors = Array.from({ length: 3 }, (_, distractorIndex) =>
      `${fallbackSentence} ${distractorIndex + 1}`.trim(),
    ).slice(0, 3);
    const options = [sentence, ...distractors].slice(0, 4);

    return {
      id: baseId,
      title: `Knowledge Check ${index + 1}`,
      prompt: buildQuestionPromptLegacy(sentence, sourceLabel, questionType, difficultyLevel, variantIndex),
      questionType,
      options,
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
      topicTags: [...topicTags],
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
    const distractors = [
      `Incorrect statement about ${sourceLabel}`,
      `Another incorrect statement about ${sourceLabel}`,
    ];

    return {
      id: baseId,
      title: `Knowledge Check ${index + 1}`,
      prompt: buildQuestionPromptLegacy(sentence, sourceLabel, questionType, difficultyLevel, variantIndex),
      questionType,
      options: [...correctOptions, ...distractors].slice(0, 4),
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
      topicTags: [...topicTags],
      generationSetId: setId,
      generationSetLabel: setLabel,
      originSlideId,
      originSlideTitle,
      sourceIds: [sourceId],
      sourceLabels: [sourceLabel],
    };
  }

  return {
    id: baseId,
    title: `Knowledge Check ${index + 1}`,
    prompt: buildQuestionPromptLegacy(sentence, sourceLabel, questionType, difficultyLevel, variantIndex),
    questionType,
    options: [],
    expectedAnswer: sentence,
    keywordMatches: keywords.length ? keywords : uniqueWords(fallbackSentence).slice(0, 3),
    placementMode,
    placementSlideId,
    triggerType: "placement",
    reviewStatus: "draft",
    generatedBy: "ai",
    manualEdits: false,
    difficultyLevel,
    topicFocus: topicTags.join(", "),
    topicTags: [...topicTags],
    generationSetId: setId,
    generationSetLabel: setLabel,
    originSlideId,
    originSlideTitle,
    sourceIds: [sourceId],
    sourceLabels: [sourceLabel],
  };
};

const planLocalQuestionSets = (input: QuestionGenerationInput): PlannedQuestionSetPayload[] => {
  const sources = buildSelectedSources(input);
  const slideSources = sources.filter((source): source is typeof source & { kind: "slide"; index: number } => source.kind === "slide" && typeof source.index === "number");
  const documentSources = sources.filter((source) => source.kind === "document");
  const normalizedTopicTags = Array.from(new Set(input.config.topicTags.map((tag) => String(tag || "").trim()).filter(Boolean)));
  const previousQuestionKeys = buildPreviousQuestionSet(input.previousQuestions);
  const variationOffset = hashString(
    input.variationToken ||
      `${input.trainingTitle}-${input.generationMode || "overwrite"}-${new Date().toISOString()}`,
  );
  const allowExtendedCount = Boolean(input.existingSet);
  const minQuestions = allowExtendedCount
    ? Math.min(10, Math.max(1, Number(input.config.minimumQuestionsPerSet || 1)))
    : Math.min(AUTO_MAX_QUESTIONS_PER_SET, Math.max(AUTO_MIN_QUESTIONS_PER_SET, Number(input.config.minimumQuestionsPerSet || AUTO_MIN_QUESTIONS_PER_SET)));
  const maxQuestions = allowExtendedCount
    ? Math.min(10, Math.max(minQuestions, Number(input.config.maximumQuestionsPerSet || 10)))
    : Math.min(AUTO_MAX_QUESTIONS_PER_SET, Math.max(minQuestions, Number(input.config.maximumQuestionsPerSet || AUTO_MAX_QUESTIONS_PER_SET)));

  if (input.existingSet) {
    const requestedCount = Number(input.config.maximumQuestionsPerSet || input.config.minimumQuestionsPerSet || minQuestions);
    const existingCount = Math.min(maxQuestions, Math.max(minQuestions, requestedCount));
    const questionTypes = ensureQuestionTypeCount(input.config.preferredQuestionTypes, existingCount);
    const sentencePool = [
      ...slideSources
        .filter((source) => input.existingSet?.sourceSlideIds?.includes(source.id))
        .flatMap((source) =>
          splitIntoSentences(source.text).map((sentence) => ({
            sourceId: source.id,
            sourceLabel: source.name,
            sentence,
          })),
        ),
      ...documentSources.flatMap((source) =>
        splitIntoSentences(source.text).slice(0, 4).map((sentence) => ({
          sourceId: source.id,
          sourceLabel: source.name,
          sentence,
        })),
      ),
    ].filter((item) => item.sentence);
    const filteredSentencePool = rotateByOffset(
      filterUniqueSentences(sentencePool, previousQuestionKeys),
      variationOffset,
    );

    const fallback = filteredSentencePool[0] ?? sentencePool[0] ?? {
      sourceId: input.existingSet.sourceIds[0] || "slides",
      sourceLabel: input.existingSet.sourceLabels[0] || "Training Slides",
      sentence: "Review the module guidance and apply it in the learner scenario.",
    };

    return [
      {
        id: input.existingSet.id,
        label: input.existingSet.label,
        placementMode: input.existingSet.placementMode,
        slideId: input.existingSet.slideId ?? null,
        slideTitle: input.existingSet.slideTitle || "",
        isMandatory: input.existingSet.isMandatory ?? true,
        difficultyLevel: input.config.difficultyLevel,
        topicTags: normalizedTopicTags,
        sourceIds: [...input.existingSet.sourceIds],
        sourceLabels: [...input.existingSet.sourceLabels],
        sourceSlideIds: [...(input.existingSet.sourceSlideIds ?? [])],
        sourceRangeLabel: input.existingSet.sourceRangeLabel || "",
        plannerSummary: input.existingSet.plannerSummary || "Regenerated from the same assessment checkpoint.",
        generatedQuestionTypes: questionTypes,
        questionCount: questionTypes.length,
        checkpoints: questionTypes.map((questionType, index) => {
          const currentSentence = filteredSentencePool[index % Math.max(filteredSentencePool.length, 1)] ?? fallback;
          const fallbackSentence =
            filteredSentencePool[(index + 1) % Math.max(filteredSentencePool.length, 1)]?.sentence ?? fallback.sentence;

          return buildCheckpoint({
            index,
            questionType,
            sentence: currentSentence.sentence,
            fallbackSentence,
            sourceId: currentSentence.sourceId,
            sourceLabel: currentSentence.sourceLabel,
            placementMode: input.existingSet?.placementMode ?? "after_slide",
            placementSlideId: input.existingSet?.placementMode === "end_of_training" ? null : input.existingSet?.slideId ?? null,
            difficultyLevel: input.config.difficultyLevel,
            topicTags: normalizedTopicTags,
            setId: input.existingSet?.id ?? `question-set-${Date.now()}`,
            setLabel: input.existingSet?.label ?? "Question Set",
            originSlideId: input.existingSet?.slideId ?? null,
            originSlideTitle: input.existingSet?.slideTitle || "",
            variantIndex: variationOffset + index,
          });
        }),
      },
    ];
  }

  const plannedSets: PlannedQuestionSetPayload[] = [];
  const meaningfulSlides = slideSources.filter((source) => hasMeaningfulContent(source.text));
  const maxSetCount = Math.min(
    AUTO_MAX_SET_COUNT,
    getRecommendedAutoSetCount(slideSources, meaningfulSlides),
  );
  const candidateWindows = buildAssessmentWindows(meaningfulSlides, maxSetCount);

  candidateWindows.forEach((window, setIndex) => {
    const windowSources = window.slides.filter((source) => hasMeaningfulContent(source.text));

    if (windowSources.length < 2) {
      return;
    }

    const targetSlide = windowSources[windowSources.length - 1];

    if (!targetSlide) {
      return;
    }

    const sentencePool = [
      ...windowSources.flatMap((source) =>
        splitIntoSentences(source.text).slice(0, 3).map((sentence) => ({
          sourceId: source.id,
          sourceLabel: source.name,
          sentence,
        })),
      ),
      ...documentSources.slice(0, 2).flatMap((source) =>
        splitIntoSentences(source.text).slice(0, 2).map((sentence) => ({
          sourceId: source.id,
          sourceLabel: source.name,
          sentence,
        })),
      ),
    ];

    const uniqueSentencePool = rotateByOffset(
      filterUniqueSentences(sentencePool, previousQuestionKeys),
      variationOffset + setIndex,
    );

    if (uniqueSentencePool.length < AUTO_MIN_QUESTIONS_PER_SET) {
      return;
    }

    const questionCount = clamp(
      uniqueSentencePool.length >= 8 || windowSources.some((source) => isStrongAssessmentSource(source.text)) ? 3 : 2,
      minQuestions,
      maxQuestions,
    );
    const questionTypes = ensureQuestionTypeCount(input.config.preferredQuestionTypes, questionCount);
    const setId = `question-set-${Date.now()}-${plannedSets.length}`;
    const sourceIds = Array.from(new Set([...windowSources.map((source) => source.id), ...documentSources.slice(0, 2).map((source) => source.id)]));
    const sourceLabels = Array.from(new Set([...windowSources.map((source) => source.name), ...documentSources.slice(0, 2).map((source) => source.name)]));
    const plannerSummary = `Brief attention-check after ${buildPlacementLabel(window.start, targetSlide.index)} using the strongest concepts from this section.`;
    const sourceRangeLabel = buildPlacementLabel(window.start, targetSlide.index);

    plannedSets.push({
      id: setId,
      label: `Question Set ${plannedSets.length + 1}`,
      placementMode: targetSlide.index >= slideSources[slideSources.length - 1].index ? "end_of_training" : "after_slide",
      slideId: targetSlide.index >= slideSources[slideSources.length - 1].index ? null : targetSlide.id,
      slideTitle: targetSlide.index >= slideSources[slideSources.length - 1].index ? "" : targetSlide.name,
      isMandatory: true,
      difficultyLevel: input.config.difficultyLevel,
      topicTags: normalizedTopicTags,
      sourceIds,
      sourceLabels,
      sourceSlideIds: windowSources.map((source) => source.id),
      sourceRangeLabel,
      plannerSummary,
      generatedQuestionTypes: questionTypes,
      questionCount,
      checkpoints: questionTypes.map((questionType, checkpointIndex) => {
        const currentSentence = uniqueSentencePool[checkpointIndex % uniqueSentencePool.length];
        const fallbackSentence = uniqueSentencePool[(checkpointIndex + 1) % uniqueSentencePool.length]?.sentence ?? currentSentence.sentence;

        return buildCheckpoint({
          index: checkpointIndex,
          questionType,
          sentence: currentSentence.sentence,
          fallbackSentence,
          sourceId: currentSentence.sourceId,
          sourceLabel: currentSentence.sourceLabel,
          placementMode: targetSlide.index >= slideSources[slideSources.length - 1].index ? "end_of_training" : "after_slide",
          placementSlideId: targetSlide.index >= slideSources[slideSources.length - 1].index ? null : targetSlide.id,
          difficultyLevel: input.config.difficultyLevel,
          topicTags: normalizedTopicTags,
          setId,
          setLabel: `Question Set ${plannedSets.length + 1}`,
          originSlideId: targetSlide.id,
          originSlideTitle: targetSlide.name,
          variantIndex: variationOffset + setIndex + checkpointIndex,
        });
      }),
    });
  });

  if (!plannedSets.length && slideSources.length) {
    const fallbackSlide =
      [...slideSources].reverse().find((source) => hasMeaningfulContent(source.text)) ??
      slideSources[slideSources.length - 1];
    const fallbackSentences = splitIntoSentences(fallbackSlide.text);

    if (fallbackSentences.length >= AUTO_MIN_QUESTIONS_PER_SET) {
      const rotatedFallbackSentences = rotateByOffset(
        fallbackSentences.filter((sentence) => !previousQuestionKeys.has(normalizeComparableText(sentence))),
        variationOffset,
      );
      const usableFallbackSentences = rotatedFallbackSentences.length ? rotatedFallbackSentences : fallbackSentences;
      const questionTypes = ensureQuestionTypeCount(
        input.config.preferredQuestionTypes,
        clamp(isStrongAssessmentSource(fallbackSlide.text) ? 3 : 2, minQuestions, maxQuestions),
      );
      const setId = `question-set-${Date.now()}-fallback`;

      plannedSets.push({
        id: setId,
        label: "Question Set 1",
        placementMode: fallbackSlide.index >= slideSources.length - 1 ? "end_of_training" : "after_slide",
        slideId: fallbackSlide.index >= slideSources.length - 1 ? null : fallbackSlide.id,
        slideTitle: fallbackSlide.index >= slideSources.length - 1 ? "" : fallbackSlide.name,
        isMandatory: true,
        difficultyLevel: input.config.difficultyLevel,
        topicTags: normalizedTopicTags,
        sourceIds: [fallbackSlide.id],
        sourceLabels: [fallbackSlide.name],
        sourceSlideIds: [fallbackSlide.id],
        sourceRangeLabel: buildPlacementLabel(fallbackSlide.index, fallbackSlide.index),
        plannerSummary: "Fallback attention-check created from the strongest available slide content.",
        generatedQuestionTypes: questionTypes,
        questionCount: questionTypes.length,
        checkpoints: questionTypes.map((questionType, checkpointIndex) =>
          buildCheckpoint({
            index: checkpointIndex,
            questionType,
            sentence: usableFallbackSentences[checkpointIndex % usableFallbackSentences.length],
            fallbackSentence:
              usableFallbackSentences[(checkpointIndex + 1) % usableFallbackSentences.length] ?? usableFallbackSentences[0],
            sourceId: fallbackSlide.id,
            sourceLabel: fallbackSlide.name,
            placementMode: fallbackSlide.index >= slideSources.length - 1 ? "end_of_training" : "after_slide",
            placementSlideId: fallbackSlide.index >= slideSources.length - 1 ? null : fallbackSlide.id,
            difficultyLevel: input.config.difficultyLevel,
            topicTags: normalizedTopicTags,
            setId,
            setLabel: "Question Set 1",
            originSlideId: fallbackSlide.id,
            originSlideTitle: fallbackSlide.name,
            variantIndex: variationOffset + checkpointIndex,
          }),
        ),
      });
    }
  }

  return plannedSets;
};

export const generateTrainingQuestions = async (input: QuestionGenerationInput) => {
  if (!isServerApiEnabled) {
    return planLocalQuestionSets(input);
  }

  try {
    const response = await AxiosHelper.postData<QuestionGenerationResponse, QuestionGenerationInput>(
      "/question-generator",
      input,
    );

    if (response.data.status && Array.isArray(response.data.data.questionSets)) {
      return response.data.data.questionSets;
    }
  } catch {
    // Fall back to deterministic local generation below.
  }

  return planLocalQuestionSets(input);
};
