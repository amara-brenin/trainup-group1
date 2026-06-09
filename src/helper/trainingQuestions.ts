import type {
  TrainingFormField,
  TrainingQuestionCheckpoint,
  TrainingQuestionGeneratorConfig,
} from "../constant/interfaces";

export const defaultTrainingQuestionGeneratorConfig: TrainingQuestionGeneratorConfig = {
  totalQuestions: 0,
  customPrompt: "",
  difficultyLevel: "medium",
  topicTags: [],
  selectedSourceIds: ["slides"],
  activeSetId: null,
  lastGeneratedAt: null,
  generationMode: "ai_planned_v2",
  minimumQuestionsPerSet: 3,
  maximumQuestionsPerSet: 5,
  preferredQuestionTypes: ["objective", "multi_select", "subjective"],
};

export const buildTrainingQuestionField = (
  checkpoint: TrainingQuestionCheckpoint,
  options?: { showExpectedAnswer?: boolean },
): TrainingFormField => {
  const type =
    checkpoint.questionType === "objective"
      ? "radio"
      : checkpoint.questionType === "multi_select"
        ? "checkbox"
        : "textarea";

  return {
    id: checkpoint.id,
    type,
    label: checkpoint.prompt,
    required: true,
    placeholder:
      checkpoint.questionType === "objective"
        ? "Select the best answer"
        : checkpoint.questionType === "multi_select"
          ? "Select all that apply"
          : "Enter your answer",
    options: checkpoint.options.length ? checkpoint.options : undefined,
    helpText: options?.showExpectedAnswer && checkpoint.expectedAnswer ? `Expected answer: ${checkpoint.expectedAnswer}` : "",
    correctAnswer: true,
    correctValue:
      checkpoint.questionType === "objective"
        ? checkpoint.expectedAnswer
        : checkpoint.questionType === "multi_select"
          ? checkpoint.options.filter((option) => checkpoint.keywordMatches.includes(option))
          : checkpoint.keywordMatches.length
            ? checkpoint.keywordMatches
            : checkpoint.expectedAnswer,
    maxLength: checkpoint.questionType === "text_area" || checkpoint.questionType === "subjective" ? 600 : undefined,
  };
};

export const humanizeTrainingQuestionType = (value: TrainingQuestionCheckpoint["questionType"]) => {
  switch (value) {
    case "objective":
      return "MCQ";
    case "multi_select":
      return "Multi-select";
    case "text_area":
      return "Text Area";
    default:
      return "Subjective";
  }
};
