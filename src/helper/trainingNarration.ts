const normalizeLine = (value: string) => value.replace(/\s+/g, " ").trim();

const splitIntoUniqueLines = (lines: string[]) =>
  Array.from(
    new Set(
      lines
        .map(normalizeLine)
        .filter(Boolean),
    ),
  );

const truncateWords = (value: string, maxWords: number) => {
  const words = normalizeLine(value).split(" ").filter(Boolean);

  if (words.length <= maxWords) {
    return words.join(" ");
  }

  return `${words.slice(0, maxWords).join(" ")}...`;
};

const getPromptWordLimit = (prompt: string) => {
  const rangeMatch = prompt.match(/(\d+)\s*[-–]\s*(\d+)\s*words?/i);

  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);

    if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) {
      return Math.round((min + max) / 2);
    }
  }

  const singleMatch = prompt.match(/(\d+)\s*words?/i);

  if (singleMatch) {
    const count = Number(singleMatch[1]);
    return Number.isFinite(count) && count > 0 ? count : 28;
  }

  return 28;
};

const buildPromptStyleSuffix = (prompt: string) => {
  const normalized = prompt.toLowerCase();
  const styles: string[] = [];

  if (normalized.includes("motivating")) {
    styles.push("Keep the tone encouraging.");
  }

  if (normalized.includes("practical")) {
    styles.push("Focus on field-ready takeaways.");
  }

  if (normalized.includes("professional")) {
    styles.push("Keep the delivery polished and professional.");
  }

  return styles.join(" ");
};

export const normalizeNarrationSource = (lines?: string[]) => splitIntoUniqueLines(lines ?? []);

const buildFallbackNarration = (slideTitle: string) =>
  `This slide explains ${slideTitle} and highlights the key point the learner should retain before moving ahead.`;

export const buildNarrationFromPrompt = ({
  prompt,
  trainingTitle: _trainingTitle,
  slideTitle,
  extractedText,
  index,
}: {
  prompt: string;
  trainingTitle: string;
  slideTitle: string;
  extractedText?: string[];
  index: number;
}) => {
  const sourceLines = normalizeNarrationSource(extractedText);
  const promptWordLimit = getPromptWordLimit(prompt);
  const promptSuffix = buildPromptStyleSuffix(prompt);
  const title = normalizeLine(slideTitle) || `Slide ${index + 1}`;

  if (!sourceLines.length) {
    return truncateWords([buildFallbackNarration(title), promptSuffix].filter(Boolean).join(" "), promptWordLimit);
  }

  const headline = sourceLines[0];
  const supporting = sourceLines.slice(1).join(" ");
  const narrative = [headline, supporting].filter(Boolean).join(". ");

  return truncateWords([narrative, promptSuffix].filter(Boolean).join(" "), promptWordLimit);
};

export const sanitizeLaunchNarrationScript = ({
  script,
  trainingTitle: _trainingTitle,
  slideTitle: _slideTitle,
  index: _index,
}: {
  script: string;
  trainingTitle: string;
  slideTitle: string;
  index: number;
}) => {
  const normalizedScript = normalizeLine(script);
  return normalizedScript;
};

export const buildSlidePointsFromSource = (slideTitle: string, extractedText?: string[]) => {
  const normalizedLines = normalizeNarrationSource(extractedText);

  if (normalizedLines.length > 1) {
    return normalizedLines.slice(1, 5);
  }

  if (normalizedLines.length === 1) {
    return [
      normalizedLines[0],
      `${slideTitle} key takeaway`,
      "Reinforce the learner action for this slide",
    ];
  }

  return [slideTitle, "Key field takeaway", "How to present this visual to the learner"];
};
