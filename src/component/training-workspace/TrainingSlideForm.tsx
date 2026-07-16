import { Fragment, useEffect, useMemo, useState } from "react";
import type { TrainingFormConfig, TrainingFormField } from "../../constant/interfaces";
import {
  humanizeTrainingFieldType,
  isChoiceField,
  isContentField,
  isLaunchInputField,
  isMatrixField,
  normalizeTrainingFieldType,
} from "../../helper/trainingForm";
import { sanitizePhoneInput } from "../../helper/validation";

type TrainingSlideFormMode = "preview" | "readonly" | "launch";
export type TrainingSlideFormSubmitResult = {
  values: Record<string, unknown>;
  correctAnswers: number;
  totalQuestions: number;
  score: number | null;
  passed: boolean;
};

type TrainingSlideFormProps = {
  fields: TrainingFormField[];
  formConfig?: TrainingFormConfig;
  mode?: TrainingSlideFormMode;
  className?: string;
  onSubmit?: (result: TrainingSlideFormSubmitResult) => void;
};

const buildInitialValue = (field: TrainingFormField) => {
  const type = normalizeTrainingFieldType(field.type);

  if (type === "checkbox") {
    return [];
  }

  if (type === "toggle") {
    return false;
  }

  if (type === "matrix") {
    return {};
  }

  return "";
};

const getMediaKind = (mimeType?: string) => {
  if (!mimeType) {
    return "image";
  }

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  return "image";
};

const buildInitialValues = (fields: TrainingFormField[]) =>
  fields.reduce<Record<string, unknown>>((current, field) => {
    current[field.id] = buildInitialValue(field);
    return current;
  }, {});

const normalizeComparableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return [...value].map((item) => String(item).trim()).sort();
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((current, [key, entryValue]) => {
        current[key] = normalizeComparableValue(entryValue);
        return current;
      }, {});
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value;
  }

  return String(value ?? "").trim();
};

const getFieldCorrectValue = (field: TrainingFormField) => {
  const type = normalizeTrainingFieldType(field.type);
  const configured = field.correctValue;

  if (configured !== undefined) {
    if (type === "number" || type === "slider" || type === "rating") {
      return Number(configured);
    }

    return configured;
  }

  return type === "toggle" ? true : "";
};

const scoreFieldValue = (field: TrainingFormField, value: unknown) => {
  if (!field.correctAnswer) {
    return null;
  }

  const type = normalizeTrainingFieldType(field.type);
  const expected = getFieldCorrectValue(field);

  if ((type === "text" || type === "textarea") && Array.isArray(expected)) {
    const normalizedValue = String(value ?? "").trim().toLowerCase();
    return expected.every((item) => normalizedValue.includes(String(item).trim().toLowerCase()));
  }

  const normalizedExpected = normalizeComparableValue(expected);
  const normalizedValue = normalizeComparableValue(value);
  return JSON.stringify(normalizedExpected) === JSON.stringify(normalizedValue);
};

const buildSubmitResult = (fields: TrainingFormField[], values: Record<string, unknown>, formConfig?: TrainingFormConfig) => {
  let correctAnswers = 0;
  let totalQuestions = 0;

  fields.forEach((field) => {
    const scoreState = scoreFieldValue(field, values[field.id]);

    if (scoreState === null) {
      return;
    }

    totalQuestions += 1;

    if (scoreState) {
      correctAnswers += 1;
    }
  });

  const score = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : null;
  const passed = !formConfig?.requireCorrect || totalQuestions === 0 || correctAnswers === totalQuestions;

  return {
    values,
    correctAnswers,
    totalQuestions,
    score,
    passed,
  } satisfies TrainingSlideFormSubmitResult;
};

const validateFieldValue = (field: TrainingFormField, value: unknown) => {
  if (!field.required) {
    return "";
  }

  const type = normalizeTrainingFieldType(field.type);

  if (type === "checkbox") {
    return Array.isArray(value) && value.length > 0 ? "" : "Select at least one option.";
  }

  if (type === "toggle") {
    return value ? "" : "This toggle must be enabled.";
  }

  if (type === "matrix") {
    return value && Object.keys(value as Record<string, unknown>).length === (field.options ?? []).length
      ? ""
      : "Complete every row in the matrix.";
  }

  if (type === "fileupload") {
    return value ? "" : "Upload at least one file.";
  }

  if (type === "rating") {
    return value ? "" : "Select a rating.";
  }

  if (type === "slider") {
    return value !== "" && value !== null && value !== undefined ? "" : "Choose a value.";
  }

  return String(value || "").trim() ? "" : "This field is required.";
};

const renderMediaAsset = (field: TrainingFormField) => {
  if (!field.assetUrl) {
    return <div className="training-slide-form-placeholder">No media uploaded for this block.</div>;
  }

  const kind = getMediaKind(field.assetMimeType);

  if (kind === "video") {
    return (
      <video className="training-slide-form-media" controls preload="metadata">
        <source src={field.assetUrl} type={field.assetMimeType || "video/mp4"} />
      </video>
    );
  }

  if (kind === "audio") {
    return (
      <audio className="w-100" controls preload="metadata">
        <source src={field.assetUrl} type={field.assetMimeType || "audio/mpeg"} />
      </audio>
    );
  }

  return <img className="training-slide-form-media" src={field.assetUrl} alt={field.label || field.assetName || "Uploaded media"} />;
};

const TrainingSlideForm = ({
  fields,
  formConfig,
  mode = "preview",
  className = "",
  onSubmit,
}: TrainingSlideFormProps) => {
  const [values, setValues] = useState<Record<string, unknown>>(() => buildInitialValues(fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const interactive = mode === "launch";
  const hasInputFields = useMemo(() => fields.some((field) => isLaunchInputField(field.type)), [fields]);

  useEffect(() => {
    setValues(buildInitialValues(fields));
    setErrors({});
    setSubmitted(false);
  }, [fields]);

  const updateValue = (fieldId: string, nextValue: unknown) => {
    setValues((current) => ({ ...current, [fieldId]: nextValue }));
    setErrors((current) => {
      if (!current[fieldId]) {
        return current;
      }

      const nextErrors = { ...current };
      delete nextErrors[fieldId];
      return nextErrors;
    });
  };

  const handleSubmit = () => {
    const nextErrors = fields.reduce<Record<string, string>>((current, field) => {
      if (!isLaunchInputField(field.type)) {
        return current;
      }

      const error = validateFieldValue(field, values[field.id]);

      if (error) {
        current[field.id] = error;
      }

      return current;
    }, {});

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length) {
      return;
    }

    const result = buildSubmitResult(fields, values, formConfig);

    if (!result.passed) {
      setErrors((current) => ({
        ...current,
        __form: "Correct answers are required before continuing.",
      }));
      setSubmitted(false);
      return;
    }

    setSubmitted(true);
    setErrors((current) => {
      const nextErrors = { ...current };
      delete nextErrors.__form;
      return nextErrors;
    });
    onSubmit?.(result);
  };

  const resetValues = () => {
    setValues(buildInitialValues(fields));
    setErrors({});
    setSubmitted(false);
  };

  if (!fields.length) {
    return (
      <div className={`training-slide-form-shell ${className}`.trim()}>
        <div className="training-slide-form-empty">No form fields have been configured for this slide.</div>
      </div>
    );
  }

  return (
    <div className={`training-slide-form-shell ${className}`.trim()}>
      <div className={`training-slide-form ${mode === "launch" ? "is-launch" : "is-preview"}`}>
        {fields.map((field) => {
          const type = normalizeTrainingFieldType(field.type);
          const value = values[field.id];
          const error = errors[field.id];
          const requiredMark = field.required ? <span className="text-danger ms-1">*</span> : null;

          if (type === "heading") {
            return (
              <div key={field.id} className="training-slide-form-heading">
                {field.label || "Heading"}
              </div>
            );
          }

          if (type === "subtitle") {
            return (
              <div key={field.id} className="training-slide-form-subtitle">
                {field.label || "Subtitle"}
              </div>
            );
          }

          if (type === "divider") {
            return <hr key={field.id} className="training-slide-form-divider" />;
          }

          if (type === "spacer") {
            return <div key={field.id} style={{ height: "1rem" }} />;
          }

          if (type === "media") {
            return (
              <div key={field.id} className="training-slide-form-field">
                <div className="training-slide-form-label-row">
                  <label className="training-slide-form-label">
                    {field.label || "Media"}
                    {requiredMark}
                  </label>
                </div>
                <div className="training-slide-form-media-card">{renderMediaAsset(field)}</div>
                {field.helpText ? <div className="training-slide-form-help">{field.helpText}</div> : null}
              </div>
            );
          }

          if (type === "filedownload") {
            return (
              <div key={field.id} className="training-slide-form-field">
                <div className="training-slide-form-label-row">
                  <label className="training-slide-form-label">{field.label || "File Download"}</label>
                </div>
                {field.assetUrl ? (
                  <a
                    className="btn btn-light"
                    href={field.assetUrl}
                    download={field.assetName || "download"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {field.placeholder || field.assetName || "Download file"}
                  </a>
                ) : (
                  <div className="training-slide-form-placeholder">No download file attached.</div>
                )}
                {field.helpText ? <div className="training-slide-form-help">{field.helpText}</div> : null}
              </div>
            );
          }

          return (
            <div key={field.id} className="training-slide-form-field">
              <div className="training-slide-form-label-row">
                <label className="training-slide-form-label">
                  {field.label || humanizeTrainingFieldType(field.type)}
                  {requiredMark}
                </label>
              </div>

              {type === "textarea" ? (
                <textarea
                  className={`form-control ${error ? "is-invalid" : ""}`}
                  rows={4}
                  disabled={!interactive}
                  placeholder={field.placeholder || "Enter text..."}
                  value={String(value || "")}
                  maxLength={field.maxLength}
                  onChange={(event) => updateValue(field.id, event.target.value)}
                />
              ) : null}

              {type === "dropdown" ? (
                <select
                  className={`form-select ${error ? "is-invalid" : ""}`}
                  disabled={!interactive}
                  value={String(value || "")}
                  onChange={(event) => updateValue(field.id, event.target.value)}
                >
                  <option value="">{field.placeholder || "Select an option"}</option>
                  {(field.options ?? []).map((option, index) => (
                    <option key={`${field.id}-option-${index}`} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : null}

              {type === "radio" ? (
                <div className="training-slide-form-choice-list">
                  {(field.options ?? []).map((option, index) => (
                    <label key={`${field.id}-radio-${index}`} className="form-check">
                      <input
                        className="form-check-input"
                        type="radio"
                        name={field.id}
                        disabled={!interactive}
                        checked={String(value || "") === option}
                        onChange={() => updateValue(field.id, option)}
                      />
                      <span className="form-check-label">{option}</span>
                    </label>
                  ))}
                </div>
              ) : null}

              {type === "checkbox" ? (
                <div className="training-slide-form-choice-list">
                  {(field.options ?? []).map((option, index) => {
                    const checkedValues = Array.isArray(value) ? value : [];
                    const isChecked = checkedValues.includes(option);

                    return (
                      <label key={`${field.id}-checkbox-${index}`} className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          disabled={!interactive}
                          checked={isChecked}
                          onChange={(event) => {
                            const nextValues = event.target.checked
                              ? [...checkedValues, option]
                              : checkedValues.filter((item) => item !== option);
                            updateValue(field.id, nextValues);
                          }}
                        />
                        <span className="form-check-label">{option}</span>
                      </label>
                    );
                  })}
                </div>
              ) : null}

              {type === "toggle" ? (
                <div className="form-check form-switch">
                  <input
                    className={`form-check-input ${error ? "is-invalid" : ""}`}
                    type="checkbox"
                    disabled={!interactive}
                    checked={Boolean(value)}
                    onChange={(event) => updateValue(field.id, event.target.checked)}
                  />
                </div>
              ) : null}

              {type === "rating" ? (
                <div className="training-slide-form-rating">
                  {Array.from({ length: field.maxRating ?? 5 }).map((_, index) => {
                    const isActive = Number(value || 0) >= index + 1;

                    return (
                      <button
                        key={`${field.id}-star-${index}`}
                        type="button"
                        className={`training-slide-form-star ${isActive ? "is-active" : ""}`}
                        disabled={!interactive}
                        onClick={() => updateValue(field.id, index + 1)}
                      >
                        <i className={`bi ${isActive ? "bi-star-fill" : "bi-star"}`} />
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {type === "slider" ? (
                <div className="training-slide-form-slider">
                  <input
                    type="range"
                    className="form-range"
                    disabled={!interactive}
                    min={field.min ?? 0}
                    max={field.max ?? 100}
                    value={Number(value || field.min || 0)}
                    onChange={(event) => updateValue(field.id, Number(event.target.value))}
                  />
                  <div className="training-slide-form-slider-value">{String(value || field.min || 0)}</div>
                </div>
              ) : null}

              {type === "matrix" ? (
                <div className="training-slide-form-matrix">
                  <div className="training-slide-form-matrix-header" />
                  {(field.cols ?? []).map((column, index) => (
                    <div key={`${field.id}-col-${index}`} className="training-slide-form-matrix-heading">
                      {column}
                    </div>
                  ))}
                  {(field.options ?? []).map((row, rowIndex) => (
                    <Fragment key={`${field.id}-matrix-row-${rowIndex}`}>
                      <div key={`${field.id}-row-label-${rowIndex}`} className="training-slide-form-matrix-label">
                        {row}
                      </div>
                      {(field.cols ?? []).map((column, columnIndex) => {
                        const rowValues = (value as Record<string, string>) || {};
                        const selectedColumn = rowValues[row] || "";

                        return (
                          <label
                            key={`${field.id}-matrix-${rowIndex}-${columnIndex}`}
                            className="training-slide-form-matrix-cell"
                          >
                            <input
                              type="radio"
                              name={`${field.id}-${row}`}
                              disabled={!interactive}
                              checked={selectedColumn === column}
                              onChange={() =>
                                updateValue(field.id, {
                                  ...rowValues,
                                  [row]: column,
                                })
                              }
                            />
                          </label>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              ) : null}

              {type === "fileupload" ? (
                <input
                  type="file"
                  className={`form-control ${error ? "is-invalid" : ""}`}
                  disabled={!interactive}
                  accept={field.accept || ""}
                  multiple={Boolean(field.allowMultiple)}
                  onChange={(event) =>
                    updateValue(
                      field.id,
                      field.allowMultiple ? Array.from(event.target.files || []) : event.target.files?.[0] || "",
                    )
                  }
                />
              ) : null}

              {type === "recording" || type === "drawing" ? (
                <div className="training-slide-form-placeholder">
                  {interactive
                    ? `${humanizeTrainingFieldType(field.type)} input will appear here during runtime.`
                    : `${humanizeTrainingFieldType(field.type)} preview`}
                </div>
              ) : null}

              {type === "calculated" ? (
                <input className="form-control" value={field.placeholder || "Auto-calculated"} readOnly disabled />
              ) : null}

              {!isChoiceField(field.type) &&
              !isMatrixField(field.type) &&
              !["textarea", "toggle", "rating", "slider", "fileupload", "recording", "drawing", "calculated"].includes(type) &&
              !isContentField(field.type) ? (
                <input
                  type={
                    type === "number"
                      ? "number"
                      : type === "email"
                        ? "email"
                        : type === "phone"
                          ? "tel"
                          : type === "date"
                            ? "date"
                            : type === "time"
                              ? "time"
                              : type === "url"
                                ? "url"
                                : type === "password"
                                  ? "password"
                                  : "text"
                  }
                  className={`form-control ${error ? "is-invalid" : ""}`}
                  disabled={!interactive}
                  placeholder={field.placeholder || "Enter value..."}
                  value={String(value || "")}
                  min={field.min}
                  max={field.max}
                  step={type === "number" ? field.step || 1 : undefined}
                  maxLength={field.maxLength}
                  onChange={(event) =>
                    updateValue(field.id, type === "phone" ? sanitizePhoneInput(event.target.value) : event.target.value)
                  }
                />
              ) : null}

              {field.helpText ? <div className="training-slide-form-help">{field.helpText}</div> : null}
              {error ? <div className="training-slide-form-error">{error}</div> : null}
            </div>
          );
        })}

        {interactive && hasInputFields ? (
          <div className="training-slide-form-actions">
            <button type="button" className="btn btn-light" onClick={resetValues}>
              Reset
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSubmit}>
              {submitted ? "Submitted" : formConfig?.waitForSubmit ? "Submit & Continue" : "Submit Form"}
            </button>
          </div>
        ) : null}

        {interactive && submitted ? (
          <div className="training-slide-form-submitted">
            Form submitted for this slide.
          </div>
        ) : null}
        {interactive && errors.__form ? <div className="training-slide-form-error">{errors.__form}</div> : null}
      </div>
    </div>
  );
};

export default TrainingSlideForm;
