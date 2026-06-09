import { useEffect, useMemo, useState } from "react";
import type { TrainingFieldType, TrainingFormConfig, TrainingFormField, TrainingSlideRecord } from "../../constant/interfaces";
import {
  cloneTrainingFormField,
  getFieldAssetAccept,
  getFieldUploadLabel,
  humanizeTrainingFieldType,
  isChoiceField,
  isMatrixField,
  normalizeTrainingFieldType,
  supportsAccept,
  supportsAssetUpload,
  supportsCorrectAnswer,
  supportsHelpText,
  supportsMaxLength,
  supportsMinMax,
  supportsMultipleFiles,
  supportsPlaceholder,
  supportsRating,
  supportsStep,
} from "../../helper/trainingForm";
import Modal from "../common/Modal";
import TrainingSlideForm from "./TrainingSlideForm";

type FormBuilderTab = "form" | "element";

type Props = {
  show: boolean;
  slide: TrainingSlideRecord | null;
  onClose: () => void;
  onSave: (slideId: string, formFields: TrainingFormField[], formConfig: TrainingFormConfig) => void;
};

type FieldGroup = {
  label: string;
  items: Array<{ type: TrainingFieldType; icon: string; label: string }>;
};

export const defaultFormConfig: TrainingFormConfig = {
  waitForSubmit: false,
  requireCorrect: false,
  limitSubmissions: true,
  submissionLimit: 1,
  onCorrectSlide: "",
  onIncorrectSlide: "",
  timer: "None",
};

const timerOptions = ["None", "30 seconds", "1 minute", "2 minutes", "5 minutes", "10 minutes"];

const fieldGroups: FieldGroup[] = [
  {
    label: "Input Fields",
    items: [
      { type: "text", icon: "bi bi-input-cursor-text", label: "Text Input" },
      { type: "textarea", icon: "bi bi-card-text", label: "Text Area" },
      { type: "number", icon: "bi bi-123", label: "Number" },
      { type: "email", icon: "bi bi-envelope", label: "Email" },
      { type: "phone", icon: "bi bi-telephone", label: "Phone" },
      { type: "date", icon: "bi bi-calendar-event", label: "Date" },
      { type: "time", icon: "bi bi-clock", label: "Time" },
      { type: "url", icon: "bi bi-link-45deg", label: "URL" },
      { type: "password", icon: "bi bi-shield-lock", label: "Password" },
      { type: "drawing", icon: "bi bi-pencil-square", label: "Drawing" },
      { type: "fileupload", icon: "bi bi-folder2-open", label: "File Upload" },
      { type: "recording", icon: "bi bi-mic", label: "Recording" },
    ],
  },
  {
    label: "Selection",
    items: [
      { type: "dropdown", icon: "bi bi-menu-button-wide", label: "Dropdown" },
      { type: "radio", icon: "bi bi-record-circle", label: "Radio" },
      { type: "checkbox", icon: "bi bi-check2-square", label: "Checkbox" },
      { type: "toggle", icon: "bi bi-toggle2-off", label: "Toggle" },
      { type: "rating", icon: "bi bi-star", label: "Rating" },
      { type: "slider", icon: "bi bi-sliders", label: "Slider" },
      { type: "matrix", icon: "bi bi-grid-3x3-gap", label: "Matrix" },
    ],
  },
  {
    label: "Content",
    items: [
      { type: "heading", icon: "bi bi-type-h1", label: "Heading" },
      { type: "subtitle", icon: "bi bi-text-paragraph", label: "Subtitle" },
      { type: "divider", icon: "bi bi-dash-lg", label: "Divider" },
      { type: "spacer", icon: "bi bi-arrows-vertical", label: "Spacer" },
      { type: "media", icon: "bi bi-image", label: "Media" },
      { type: "filedownload", icon: "bi bi-download", label: "File Download" },
    ],
  },
  {
    label: "Actions",
    items: [
      { type: "submit", icon: "bi bi-check2-circle", label: "Submit" },
      { type: "reset", icon: "bi bi-arrow-counterclockwise", label: "Reset" },
    ],
  },
];

const readFileAsDataUrl = (file: File) =>
  new Promise<{ assetUrl: string; assetName: string; assetMimeType: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        assetUrl: String(reader.result || ""),
        assetName: file.name,
        assetMimeType: file.type || "application/octet-stream",
      });
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });

const buildDefaultField = (type: TrainingFieldType, index: number): TrainingFormField => {
  const normalized = normalizeTrainingFieldType(type);
  const defaults: Record<string, Omit<TrainingFormField, "id" | "type">> = {
    text: { label: "Text Input", required: true, placeholder: "Enter text...", helpText: "Help text goes here", maxLength: 120 },
    textarea: { label: "Text Area", required: false, placeholder: "Enter text...", helpText: "", maxLength: 300 },
    number: { label: "Number", required: false, placeholder: "Enter a number", helpText: "", min: 0, max: 100, step: 1 },
    email: { label: "Email", required: false, placeholder: "Enter email..." },
    phone: { label: "Phone", required: false, placeholder: "Enter phone..." },
    date: { label: "Date", required: false },
    time: { label: "Time", required: false },
    url: { label: "URL", required: false, placeholder: "https://" },
    password: { label: "Password", required: false, placeholder: "Enter password..." },
    drawing: { label: "Drawing", required: false, helpText: "Learners can sketch or sign inside the slide." },
    fileupload: { label: "File Upload", required: false, accept: ".pdf,.ppt,.pptx,.png,.jpg,.jpeg", allowMultiple: false },
    recording: { label: "Recording", required: false, helpText: "Learners can record audio directly on this slide." },
    dropdown: { label: "Dropdown", required: false, options: ["Option 1", "Option 2", "Option 3"] },
    radio: { label: "Radio", required: false, options: ["Option 1", "Option 2", "Option 3"] },
    checkbox: { label: "Checkboxes", required: false, options: ["Option 1", "Option 2", "Option 3"] },
    toggle: { label: "Toggle", required: false, helpText: "Useful for yes/no confirmations." },
    rating: { label: "Rating", required: false, maxRating: 5 },
    slider: { label: "Slider", required: false, min: 0, max: 100, step: 1 },
    matrix: { label: "Matrix", required: false, options: ["Row 1", "Row 2"], cols: ["Col 1", "Col 2"] },
    calculated: { label: "Calculated", required: false, placeholder: "Auto-calculated" },
    heading: { label: "Heading", required: false },
    subtitle: { label: "Subtitle", required: false },
    divider: { label: "Divider", required: false },
    spacer: { label: "Spacer", required: false },
    media: { label: "Media", required: false, helpText: "Show an image, video, or audio block inside this slide.", accept: "image/*,video/*,audio/*" },
    filedownload: { label: "File Download", required: false, placeholder: "Download file", helpText: "Let the learner download a file from this slide.", accept: "*" },
    submit: { label: "Submit", required: false, placeholder: "Submit Form" },
    reset: { label: "Reset", required: false, placeholder: "Reset Form" },
  };

  return { id: `field-${Date.now()}-${index}`, type: normalized, tableCol: false, uniqueVal: false, correctAnswer: false, ...defaults[normalized] };
};

const updateList = (items: string[] | undefined, updater: (current: string[]) => string[]) => updater([...(items ?? [])]);
const toggleListValue = (items: string[] | undefined, value: string, enabled: boolean) => {
  const next = [...(items ?? [])];

  if (enabled) {
    return next.includes(value) ? next : [...next, value];
  }

  return next.filter((item) => item !== value);
};

const TrainingFormBuilderModal = ({ show, slide, onClose, onSave }: Props) => {
  const [draftFields, setDraftFields] = useState<TrainingFormField[]>([]);
  const [formConfig, setFormConfig] = useState<TrainingFormConfig>(defaultFormConfig);
  const [activeTab, setActiveTab] = useState<FormBuilderTab>("form");
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [assetUploadState, setAssetUploadState] = useState<"idle" | "uploading">("idle");

  useEffect(() => {
    if (!slide) {
      setDraftFields([]);
      setFormConfig(defaultFormConfig);
      setSelectedFieldId(null);
      setActiveTab("form");
      return;
    }

    setDraftFields(slide.formFields.map(cloneTrainingFormField));
    setFormConfig(slide.formConfig ? { ...defaultFormConfig, ...slide.formConfig } : defaultFormConfig);
    setSelectedFieldId(slide.formFields[0]?.id ?? null);
    setActiveTab("form");
  }, [slide]);

  const selectedField = useMemo(() => draftFields.find((field) => field.id === selectedFieldId) ?? null, [draftFields, selectedFieldId]);

  const updateSelectedField = (updater: (field: TrainingFormField) => TrainingFormField) => {
    if (!selectedFieldId) {
      return;
    }
    setDraftFields((current) => current.map((field) => (field.id === selectedFieldId ? updater(field) : field)));
  };

  const addField = (type: TrainingFieldType) => {
    setDraftFields((current) => {
      const nextField = buildDefaultField(type, current.length);
      setSelectedFieldId(nextField.id);
      setActiveTab("element");
      return [...current, nextField];
    });
  };

  const moveField = (fieldId: string, direction: -1 | 1) => {
    setDraftFields((current) => {
      const currentIndex = current.findIndex((field) => field.id === fieldId);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const nextFields = [...current];
      [nextFields[currentIndex], nextFields[nextIndex]] = [nextFields[nextIndex], nextFields[currentIndex]];
      return nextFields;
    });
  };

  const duplicateField = (fieldId: string) => {
    setDraftFields((current) => {
      const source = current.find((field) => field.id === fieldId);
      if (!source) {
        return current;
      }
      const duplicate = { ...cloneTrainingFormField(source), id: `field-${Date.now()}-${current.length}`, label: `${source.label} Copy` };
      setSelectedFieldId(duplicate.id);
      return [...current, duplicate];
    });
  };

  const deleteField = (fieldId: string) => {
    setDraftFields((current) => {
      const next = current.filter((field) => field.id !== fieldId);
      setSelectedFieldId(next[0]?.id ?? null);
      return next;
    });
  };

  const updateChoiceOption = (index: number, nextValue: string) =>
    updateSelectedField((current) => ({
      ...current,
      options: updateList(current.options, (items) => items.map((item, itemIndex) => (itemIndex === index ? nextValue : item))),
    }));

  const addChoiceOption = () =>
    updateSelectedField((current) => ({
      ...current,
      options: [...(current.options ?? []), `Option ${(current.options?.length ?? 0) + 1}`],
    }));

  const removeChoiceOption = (index: number) =>
    updateSelectedField((current) => ({
      ...current,
      options: updateList(current.options, (items) => items.filter((_, itemIndex) => itemIndex !== index)),
    }));

  const updateMatrixValue = (kind: "options" | "cols", index: number, nextValue: string) =>
    updateSelectedField((current) => ({
      ...current,
      [kind]: updateList(current[kind], (items) => items.map((item, itemIndex) => (itemIndex === index ? nextValue : item))),
    }));

  const addMatrixValue = (kind: "options" | "cols") =>
    updateSelectedField((current) => ({
      ...current,
      [kind]: [...(current[kind] ?? []), `${kind === "options" ? "Row" : "Column"} ${((current[kind] as string[] | undefined)?.length ?? 0) + 1}`],
    }));

  const removeMatrixValue = (kind: "options" | "cols", index: number) =>
    updateSelectedField((current) => ({
      ...current,
      [kind]: updateList(current[kind], (items) => items.filter((_, itemIndex) => itemIndex !== index)),
    }));

  const handleAssetUpload = async (file: File | null) => {
    if (!file) {
      return;
    }
    setAssetUploadState("uploading");
    try {
      const asset = await readFileAsDataUrl(file);
      updateSelectedField((current) => ({ ...current, ...asset }));
    } finally {
      setAssetUploadState("idle");
    }
  };

  const updateCorrectMatrixValue = (row: string, value: string) =>
    updateSelectedField((current) => ({
      ...current,
      correctValue: {
        ...((current.correctValue as Record<string, string>) ?? {}),
        [row]: value,
      },
    }));

  return (
    <Modal show={show} title={slide ? `${slide.title || "Slide"} - Form Builder` : "Form Builder"} onClose={onClose} size="xl" centered>
      {slide ? (
        <div className="training-form-builder-shell">
          <div className="training-form-builder-body">
            <aside className="training-form-builder-library">
              <div className="training-form-builder-pane-title">Elements</div>
              {fieldGroups.map((group) => (
                <div key={group.label} className="training-form-builder-group">
                  <div className="training-form-builder-group-label">{group.label}</div>
                  {group.items.map((item) => (
                    <button key={item.type} type="button" className="training-form-builder-library-item" onClick={() => addField(item.type)}>
                      <i className={item.icon} aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              ))}
            </aside>

            <section className="training-form-builder-preview-shell">
              <div className="training-form-builder-toolbar">
                <div className="training-form-builder-pane-title">Preview</div>
                <button type="button" className="btn btn-link btn-sm text-decoration-none" onClick={() => { setDraftFields([]); setSelectedFieldId(null); }}>
                  Clear All
                </button>
              </div>
              <div className="training-form-builder-preview">
                {draftFields.length ? (
                  <div className="training-form-builder-preview-stack">
                    {draftFields.map((field, index) => (
                      <button
                        key={field.id}
                        type="button"
                        className={`training-form-preview-card ${selectedFieldId === field.id ? "is-selected" : ""}`}
                        onClick={() => { setSelectedFieldId(field.id); setActiveTab("element"); }}
                      >
                        <div className="training-form-preview-tools">
                          <button type="button" className="btn btn-light btn-sm" onClick={(event) => { event.stopPropagation(); moveField(field.id, -1); }}><i className="bi bi-arrow-up" /></button>
                          <button type="button" className="btn btn-light btn-sm" onClick={(event) => { event.stopPropagation(); moveField(field.id, 1); }}><i className="bi bi-arrow-down" /></button>
                          <button type="button" className="btn btn-light btn-sm" onClick={(event) => { event.stopPropagation(); duplicateField(field.id); }}><i className="bi bi-copy" /></button>
                          <button type="button" className="btn btn-light btn-sm text-danger" onClick={(event) => { event.stopPropagation(); deleteField(field.id); }}><i className="bi bi-x-lg" /></button>
                        </div>
                        <TrainingSlideForm fields={[field]} mode="preview" />
                        <div className="training-form-preview-meta">Element {index + 1} | {humanizeTrainingFieldType(field.type)}</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="training-form-builder-empty">
                    <i className="bi bi-ui-checks-grid" aria-hidden="true" />
                    <div>Click elements on the left to add fields to this slide.</div>
                  </div>
                )}
              </div>
            </section>

            <aside className="training-form-builder-properties">
              <div className="training-form-builder-tabs">
                <button type="button" className={`training-form-builder-tab ${activeTab === "form" ? "is-active" : ""}`} onClick={() => setActiveTab("form")}>Form Properties</button>
                <button type="button" className={`training-form-builder-tab ${activeTab === "element" ? "is-active" : ""}`} onClick={() => setActiveTab("element")}>Element Properties</button>
              </div>
              <div className="training-form-builder-properties-body">
                {activeTab === "form" ? (
                  <div className="d-grid gap-3">
                    <label className="training-option-item py-0 border-0">
                      <input type="checkbox" checked={formConfig.waitForSubmit} onChange={(event) => setFormConfig((current) => ({ ...current, waitForSubmit: event.target.checked, requireCorrect: event.target.checked ? current.requireCorrect : false }))} />
                      <span><strong>Wait for form submission before advancing</strong><small>Keep learners on this slide until the form is submitted.</small></span>
                    </label>
                    <label className="training-option-item py-0 border-0">
                      <input type="checkbox" checked={formConfig.requireCorrect} disabled={!formConfig.waitForSubmit} onChange={(event) => setFormConfig((current) => ({ ...current, requireCorrect: event.target.checked }))} />
                      <span><strong>Require correct submission</strong><small>Enable only when the learner must answer correctly.</small></span>
                    </label>
                    <label className="training-option-item py-0 border-0">
                      <input type="checkbox" checked={formConfig.limitSubmissions} onChange={(event) => setFormConfig((current) => ({ ...current, limitSubmissions: event.target.checked }))} />
                      <span><strong>Limit submissions</strong><small>Restrict how many times the learner can submit this form.</small></span>
                    </label>
                    {formConfig.limitSubmissions ? (
                      <div>
                        <label className="form-label small">Submission Limit</label>
                        <input type="number" min={1} className="form-control" value={formConfig.submissionLimit} onChange={(event) => setFormConfig((current) => ({ ...current, submissionLimit: Math.max(1, Number(event.target.value) || 1) }))} />
                      </div>
                    ) : null}
                    <div>
                      <label className="form-label small">On correct submission, go to slide</label>
                      <input className="form-control" value={formConfig.onCorrectSlide} onChange={(event) => setFormConfig((current) => ({ ...current, onCorrectSlide: event.target.value }))} placeholder="e.g. 5 or +2" />
                    </div>
                    <div>
                      <label className="form-label small">On incorrect submission, go to slide</label>
                      <input className="form-control" value={formConfig.onIncorrectSlide} onChange={(event) => setFormConfig((current) => ({ ...current, onIncorrectSlide: event.target.value }))} placeholder="e.g. 3 or -1" />
                    </div>
                    <div>
                      <label className="form-label small">Timer</label>
                      <select className="form-select" value={formConfig.timer} onChange={(event) => setFormConfig((current) => ({ ...current, timer: event.target.value }))}>
                        {timerOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </div>
                  </div>
                ) : selectedField ? (
                  <div className="d-grid gap-3">
                    <div className="training-form-property-card">
                      <label className="form-label small">Label</label>
                      <input className="form-control" value={selectedField.label} onChange={(event) => updateSelectedField((current) => ({ ...current, label: event.target.value }))} />
                    </div>
                    {supportsPlaceholder(selectedField.type) ? (
                      <div className="training-form-property-card">
                        <label className="form-label small">{["submit", "reset"].includes(normalizeTrainingFieldType(selectedField.type)) ? "Button Text" : "Placeholder"}</label>
                        <input className="form-control" value={selectedField.placeholder ?? ""} onChange={(event) => updateSelectedField((current) => ({ ...current, placeholder: event.target.value }))} />
                      </div>
                    ) : null}
                    {supportsHelpText(selectedField.type) ? (
                      <div className="training-form-property-card">
                        <label className="form-label small">Help Text</label>
                        <input className="form-control" value={selectedField.helpText ?? ""} onChange={(event) => updateSelectedField((current) => ({ ...current, helpText: event.target.value }))} />
                      </div>
                    ) : null}
                    {supportsMaxLength(selectedField.type) ? (
                      <div className="training-form-property-card">
                        <label className="form-label small">Maximum Characters</label>
                        <input type="number" min={1} className="form-control" value={selectedField.maxLength ?? ""} onChange={(event) => updateSelectedField((current) => ({ ...current, maxLength: event.target.value ? Math.max(1, Number(event.target.value) || 1) : undefined }))} />
                      </div>
                    ) : null}
                    {supportsMinMax(selectedField.type) ? (
                      <div className="training-form-property-card">
                        <div className="row g-3">
                          <div className="col-6">
                            <label className="form-label small">Minimum</label>
                            <input type="number" className="form-control" value={selectedField.min ?? 0} onChange={(event) => updateSelectedField((current) => ({ ...current, min: Number(event.target.value) || 0 }))} />
                          </div>
                          <div className="col-6">
                            <label className="form-label small">Maximum</label>
                            <input type="number" className="form-control" value={selectedField.max ?? 100} onChange={(event) => updateSelectedField((current) => ({ ...current, max: Number(event.target.value) || 100 }))} />
                          </div>
                        </div>
                        {supportsStep(selectedField.type) ? (
                          <div className="mt-3">
                            <label className="form-label small">Step</label>
                            <input type="number" min={1} className="form-control" value={selectedField.step ?? 1} onChange={(event) => updateSelectedField((current) => ({ ...current, step: Math.max(1, Number(event.target.value) || 1) }))} />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {supportsRating(selectedField.type) ? (
                      <div className="training-form-property-card">
                        <label className="form-label small">Max Rating</label>
                        <input type="number" min={1} className="form-control" value={selectedField.maxRating ?? 5} onChange={(event) => updateSelectedField((current) => ({ ...current, maxRating: Math.max(1, Number(event.target.value) || 5) }))} />
                      </div>
                    ) : null}
                    {isChoiceField(selectedField.type) ? (
                      <div className="training-form-property-card">
                        <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                          <label className="form-label small mb-0">Options</label>
                          <button type="button" className="btn btn-sm btn-light" onClick={addChoiceOption}>Add Option</button>
                        </div>
                        <div className="d-grid gap-2">
                          {(selectedField.options ?? []).map((option, index) => (
                            <div key={`${selectedField.id}-option-${index}`} className="training-form-option-row">
                              <input className="form-control" value={option} onChange={(event) => updateChoiceOption(index, event.target.value)} />
                              <button type="button" className="btn btn-light text-danger" onClick={() => removeChoiceOption(index)}><i className="bi bi-x-lg" /></button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {isMatrixField(selectedField.type) ? (
                      <div className="training-form-property-card d-grid gap-3">
                        <div>
                          <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                            <label className="form-label small mb-0">Rows</label>
                            <button type="button" className="btn btn-sm btn-light" onClick={() => addMatrixValue("options")}>Add Row</button>
                          </div>
                          <div className="d-grid gap-2">
                            {(selectedField.options ?? []).map((row, index) => (
                              <div key={`${selectedField.id}-row-${index}`} className="training-form-option-row">
                                <input className="form-control" value={row} onChange={(event) => updateMatrixValue("options", index, event.target.value)} />
                                <button type="button" className="btn btn-light text-danger" onClick={() => removeMatrixValue("options", index)}><i className="bi bi-x-lg" /></button>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                            <label className="form-label small mb-0">Columns</label>
                            <button type="button" className="btn btn-sm btn-light" onClick={() => addMatrixValue("cols")}>Add Column</button>
                          </div>
                          <div className="d-grid gap-2">
                            {(selectedField.cols ?? []).map((column, index) => (
                              <div key={`${selectedField.id}-column-${index}`} className="training-form-option-row">
                                <input className="form-control" value={column} onChange={(event) => updateMatrixValue("cols", index, event.target.value)} />
                                <button type="button" className="btn btn-light text-danger" onClick={() => removeMatrixValue("cols", index)}><i className="bi bi-x-lg" /></button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {supportsAccept(selectedField.type) ? (
                      <div className="training-form-property-card">
                        <label className="form-label small">Accepted File Types</label>
                        <input className="form-control" value={selectedField.accept ?? ""} placeholder={getFieldAssetAccept(selectedField)} onChange={(event) => updateSelectedField((current) => ({ ...current, accept: event.target.value }))} />
                        <div className="small text-body-secondary mt-1">Use MIME patterns like <code>image/*</code> or extensions like <code>.pdf</code>.</div>
                      </div>
                    ) : null}
                    {supportsMultipleFiles(selectedField.type) ? (
                      <label className="training-option-item py-0 border-0">
                        <input type="checkbox" checked={Boolean(selectedField.allowMultiple)} onChange={(event) => updateSelectedField((current) => ({ ...current, allowMultiple: event.target.checked }))} />
                        <span><strong>Allow multiple files</strong><small>Let learners upload more than one file.</small></span>
                      </label>
                    ) : null}
                    {supportsAssetUpload(selectedField.type) ? (
                      <div className="training-form-property-card">
                        <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                          <label className="form-label small mb-0">{getFieldUploadLabel(selectedField)}</label>
                          {selectedField.assetName ? <span className="small text-body-secondary">{selectedField.assetName}</span> : null}
                        </div>
                        <input type="file" className="form-control" accept={getFieldAssetAccept(selectedField)} onChange={(event) => { void handleAssetUpload(event.target.files?.[0] || null); event.currentTarget.value = ""; }} />
                        <div className="small text-body-secondary mt-2">{assetUploadState === "uploading" ? "Uploading asset..." : "This uploaded asset will appear inside the launch slide form."}</div>
                        {selectedField.assetUrl ? (
                          <div className="training-form-upload-preview mt-3">
                            {selectedField.assetMimeType?.startsWith("image/") ? <img src={selectedField.assetUrl} alt={selectedField.label || "Uploaded asset"} /> : <div className="training-slide-form-placeholder">{selectedField.assetName || "Attached asset ready"}</div>}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <label className="training-option-item py-0 border-0">
                      <input type="checkbox" checked={Boolean(selectedField.required)} onChange={(event) => updateSelectedField((current) => ({ ...current, required: event.target.checked }))} />
                      <span><strong>Required</strong><small>Force the learner to complete this field.</small></span>
                    </label>
                    <label className="training-option-item py-0 border-0">
                      <input type="checkbox" checked={Boolean(selectedField.tableCol)} onChange={(event) => updateSelectedField((current) => ({ ...current, tableCol: event.target.checked }))} />
                      <span><strong>Show in submissions table</strong><small>Include this field in submission tables.</small></span>
                    </label>
                    <label className="training-option-item py-0 border-0">
                      <input type="checkbox" checked={Boolean(selectedField.uniqueVal)} onChange={(event) => updateSelectedField((current) => ({ ...current, uniqueVal: event.target.checked }))} />
                      <span><strong>Unique values only</strong><small>Prevent duplicate submission values.</small></span>
                    </label>
                    {supportsCorrectAnswer(selectedField.type) ? (
                      <label className="training-option-item py-0 border-0">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedField.correctAnswer)}
                          onChange={(event) =>
                            updateSelectedField((current) => ({
                              ...current,
                              correctAnswer: event.target.checked,
                              correctValue: event.target.checked
                                ? current.correctValue ??
                                  (normalizeTrainingFieldType(current.type) === "toggle"
                                    ? true
                                    : normalizeTrainingFieldType(current.type) === "checkbox"
                                      ? []
                                      : normalizeTrainingFieldType(current.type) === "matrix"
                                        ? {}
                                        : "")
                                : undefined,
                            }))
                          }
                        />
                        <span><strong>Use in correctness scoring</strong><small>Flag this field for scoring logic.</small></span>
                      </label>
                    ) : null}
                    {supportsCorrectAnswer(selectedField.type) && selectedField.correctAnswer ? (
                      <div className="training-form-property-card d-grid gap-3">
                        <div className="fw-semibold small text-uppercase text-body-secondary">Correct Answer</div>
                        {["text", "textarea", "email", "phone", "url", "date", "time"].includes(normalizeTrainingFieldType(selectedField.type)) ? (
                          <input
                            className="form-control"
                            value={String(selectedField.correctValue ?? "")}
                            onChange={(event) =>
                              updateSelectedField((current) => ({ ...current, correctValue: event.target.value }))
                            }
                            placeholder="Enter the correct answer"
                          />
                        ) : null}
                        {["number", "slider", "rating"].includes(normalizeTrainingFieldType(selectedField.type)) ? (
                          <input
                            type="number"
                            className="form-control"
                            value={
                              typeof selectedField.correctValue === "number" ||
                              typeof selectedField.correctValue === "string"
                                ? selectedField.correctValue
                                : ""
                            }
                            onChange={(event) =>
                              updateSelectedField((current) => ({
                                ...current,
                                correctValue: event.target.value === "" ? "" : Number(event.target.value),
                              }))
                            }
                            placeholder="Enter the correct numeric value"
                          />
                        ) : null}
                        {["dropdown", "radio"].includes(normalizeTrainingFieldType(selectedField.type)) ? (
                          <select
                            className="form-select"
                            value={String(selectedField.correctValue ?? "")}
                            onChange={(event) =>
                              updateSelectedField((current) => ({ ...current, correctValue: event.target.value }))
                            }
                          >
                            <option value="">Select the correct option</option>
                            {(selectedField.options ?? []).map((option) => (
                              <option key={`${selectedField.id}-correct-${option}`} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {normalizeTrainingFieldType(selectedField.type) === "checkbox" ? (
                          <div className="d-grid gap-2">
                            {(selectedField.options ?? []).map((option) => {
                              const selectedValues = Array.isArray(selectedField.correctValue)
                                ? selectedField.correctValue.map(String)
                                : [];

                              return (
                                <label key={`${selectedField.id}-correct-checkbox-${option}`} className="form-check">
                                  <input
                                    className="form-check-input"
                                    type="checkbox"
                                    checked={selectedValues.includes(option)}
                                    onChange={(event) =>
                                      updateSelectedField((current) => ({
                                        ...current,
                                        correctValue: toggleListValue(
                                          Array.isArray(current.correctValue)
                                            ? current.correctValue.map(String)
                                            : [],
                                          option,
                                          event.target.checked,
                                        ),
                                      }))
                                    }
                                  />
                                  <span className="form-check-label">{option}</span>
                                </label>
                              );
                            })}
                          </div>
                        ) : null}
                        {normalizeTrainingFieldType(selectedField.type) === "toggle" ? (
                          <select
                            className="form-select"
                            value={String(selectedField.correctValue ?? true)}
                            onChange={(event) =>
                              updateSelectedField((current) => ({
                                ...current,
                                correctValue: event.target.value === "true",
                              }))
                            }
                          >
                            <option value="true">Enabled</option>
                            <option value="false">Disabled</option>
                          </select>
                        ) : null}
                        {normalizeTrainingFieldType(selectedField.type) === "matrix" ? (
                          <div className="d-grid gap-2">
                            {(selectedField.options ?? []).map((row) => (
                              <div key={`${selectedField.id}-correct-row-${row}`} className="row g-2 align-items-center">
                                <div className="col-5 small fw-semibold">{row}</div>
                                <div className="col-7">
                                  <select
                                    className="form-select"
                                    value={String((selectedField.correctValue as Record<string, string> | undefined)?.[row] ?? "")}
                                    onChange={(event) => updateCorrectMatrixValue(row, event.target.value)}
                                  >
                                    <option value="">Select column</option>
                                    {(selectedField.cols ?? []).map((column) => (
                                      <option key={`${selectedField.id}-correct-col-${row}-${column}`} value={column}>
                                        {column}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="training-form-builder-empty compact">
                    <i className="bi bi-cursor" aria-hidden="true" />
                    <div>Select an element in the preview to edit its properties.</div>
                  </div>
                )}
              </div>
            </aside>
          </div>

          <div className="training-form-builder-footer">
            <button type="button" className="btn btn-light" disabled={!selectedField} onClick={() => selectedField && deleteField(selectedField.id)}>Delete</button>
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => onSave(slide.id, draftFields, formConfig)}>Save Form</button>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
};

export default TrainingFormBuilderModal;
