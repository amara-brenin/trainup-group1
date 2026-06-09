import type { TrainingFieldType, TrainingFormField } from "../constant/interfaces";

export const normalizeTrainingFieldType = (type: TrainingFieldType): TrainingFieldType => {
  switch (type) {
    case "short_text":
      return "text";
    case "long_text":
      return "textarea";
    case "single_select":
      return "dropdown";
    case "audio":
      return "recording";
    case "video":
      return "media";
    default:
      return type;
  }
};

export const isChoiceField = (type: TrainingFieldType) => {
  const normalized = normalizeTrainingFieldType(type);
  return normalized === "dropdown" || normalized === "radio" || normalized === "checkbox";
};

export const isMatrixField = (type: TrainingFieldType) => normalizeTrainingFieldType(type) === "matrix";

export const isContentField = (type: TrainingFieldType) => {
  const normalized = normalizeTrainingFieldType(type);
  return ["heading", "subtitle", "divider", "spacer"].includes(normalized);
};

export const isLaunchInputField = (type: TrainingFieldType) => {
  const normalized = normalizeTrainingFieldType(type);
  return !["heading", "subtitle", "divider", "spacer", "submit", "reset", "media", "filedownload"].includes(normalized);
};

export const supportsPlaceholder = (type: TrainingFieldType) => {
  const normalized = normalizeTrainingFieldType(type);
  return ![
    "heading",
    "subtitle",
    "divider",
    "spacer",
    "radio",
    "checkbox",
    "toggle",
    "rating",
    "slider",
    "matrix",
    "media",
    "filedownload",
  ].includes(normalized);
};

export const supportsHelpText = (type: TrainingFieldType) => !["divider", "spacer"].includes(normalizeTrainingFieldType(type));

export const supportsMinMax = (type: TrainingFieldType) => {
  const normalized = normalizeTrainingFieldType(type);
  return normalized === "number" || normalized === "slider";
};

export const supportsStep = (type: TrainingFieldType) => normalizeTrainingFieldType(type) === "number";

export const supportsMaxLength = (type: TrainingFieldType) => {
  const normalized = normalizeTrainingFieldType(type);
  return ["text", "textarea", "email", "phone", "url", "password"].includes(normalized);
};

export const supportsMultipleFiles = (type: TrainingFieldType) => normalizeTrainingFieldType(type) === "fileupload";

export const supportsAssetUpload = (type: TrainingFieldType) => {
  const normalized = normalizeTrainingFieldType(type);
  return normalized === "media" || normalized === "filedownload";
};

export const supportsAccept = (type: TrainingFieldType) => {
  const normalized = normalizeTrainingFieldType(type);
  return normalized === "fileupload" || normalized === "media" || normalized === "filedownload";
};

export const supportsRating = (type: TrainingFieldType) => normalizeTrainingFieldType(type) === "rating";

export const supportsCorrectAnswer = (type: TrainingFieldType) => {
  const normalized = normalizeTrainingFieldType(type);
  return ["dropdown", "radio", "checkbox", "toggle", "rating", "slider", "matrix", "number", "text", "textarea", "email", "phone", "url", "date", "time"].includes(
    normalized,
  );
};

export const humanizeTrainingFieldType = (type: TrainingFieldType) =>
  normalizeTrainingFieldType(type)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

export const cloneTrainingFormField = (field: TrainingFormField): TrainingFormField => ({
  ...field,
  type: normalizeTrainingFieldType(field.type),
  options: field.options ? [...field.options] : undefined,
  cols: field.cols ? [...field.cols] : undefined,
  correctValue:
    Array.isArray(field.correctValue)
      ? [...field.correctValue]
      : field.correctValue && typeof field.correctValue === "object"
        ? { ...(field.correctValue as Record<string, string>) }
        : field.correctValue,
});

export const getFieldAssetAccept = (field: TrainingFormField) => {
  const type = normalizeTrainingFieldType(field.type);

  if (type === "media") {
    return field.accept || "image/*,video/*,audio/*";
  }

  if (type === "filedownload") {
    return field.accept || "*";
  }

  return field.accept || "";
};

export const getFieldUploadLabel = (field: TrainingFormField) => {
  const type = normalizeTrainingFieldType(field.type);

  if (type === "media") {
    return field.assetName ? "Replace media" : "Upload media";
  }

  if (type === "filedownload") {
    return field.assetName ? "Replace downloadable file" : "Upload downloadable file";
  }

  return "Upload file";
};
