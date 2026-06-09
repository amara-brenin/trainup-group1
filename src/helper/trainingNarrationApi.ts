import AxiosHelper, { isServerApiEnabled } from "./AxiosHelper";
import { buildNarrationFromPrompt } from "./trainingNarration";

type NarrationRequest = {
  prompt: string;
  trainingTitle: string;
  slideTitle: string;
  extractedText?: string[];
  index: number;
};

type NarrationResponse = {
  script: string;
  model: string;
  usedOcr: boolean;
};

type TranslationRequest = {
  trainingTitle: string;
  slideTitle: string;
  script: string;
  targetLanguage: string;
  targetLocale: string;
};

export const generatePromptDrivenNarration = async (input: NarrationRequest) => {
  if (!isServerApiEnabled) {
    return buildNarrationFromPrompt(input);
  }

  const response = await AxiosHelper.postData<NarrationResponse, Omit<NarrationRequest, "index">>("/narration", {
    prompt: input.prompt,
    trainingTitle: input.trainingTitle,
    slideTitle: input.slideTitle,
    extractedText: input.extractedText ?? [],
  });

  if (!response.data.status) {
    return buildNarrationFromPrompt(input);
  }

  return response.data.data.script || buildNarrationFromPrompt(input);
};

export const translateSlideNarration = async (input: TranslationRequest) => {
  const fallbackScript = input.script.trim();

  if (!fallbackScript) {
    return "";
  }

  if (!isServerApiEnabled) {
    return `${fallbackScript}\n\n[${input.targetLanguage}]`;
  }

  const response = await AxiosHelper.postData<{ script: string }, TranslationRequest>("/narration", input);

  if (!response.data.status) {
    throw new Error(response.data.message || "Unable to translate narration.");
  }

  return String(response.data.data.script || fallbackScript).trim();
};
