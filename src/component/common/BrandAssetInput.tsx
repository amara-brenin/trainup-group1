import { useId, useState, type ChangeEvent } from "react";
import { fileToDataUrl } from "../../helper/brandingAssets";

type BrandAssetInputProps = {
  id: string;
  label: string;
  value: string;
  error?: string;
  accept?: string;
  previewSize?: number;
  onChange: (value: string) => void;
  onErrorClear?: () => void;
};

const BrandAssetInput = ({
  id,
  label,
  value,
  error = "",
  accept = "image/*",
  previewSize = 56,
  onChange,
  onErrorClear,
}: BrandAssetInputProps) => {
  const inputId = useId();
  const [previewError, setPreviewError] = useState("");

  const handleValueChange = (nextValue: string) => {
    setPreviewError("");
    onErrorClear?.();
    onChange(nextValue);
  };

  const handleFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      handleValueChange(dataUrl);
    } catch (fileError) {
      setPreviewError(fileError instanceof Error ? fileError.message : "Unable to use the selected image.");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="brand-asset-field">
      <label htmlFor={id} className="form-label">{label}</label>
      <div className="brand-asset-input-row">
        <div className="brand-asset-picker">
          <label htmlFor={inputId} className="btn btn-outline-secondary btn-sm mb-0">
            Choose from device
          </label>
          <input
            id={inputId}
            type="file"
            accept={accept}
            className="d-none"
            onChange={(event) => void handleFileSelect(event)}
          />
          {value ? (
            <div
              className="brand-asset-preview"
              style={{ width: previewSize, height: previewSize }}
            >
              <img
                src={value}
                alt={label}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                onError={() => setPreviewError(`${label} preview failed to load.`)}
              />
            </div>
          ) : (
            <div className="brand-asset-preview is-empty" style={{ width: previewSize, height: previewSize }}>
              <i className="ri-image-line" aria-hidden="true" />
            </div>
          )}
        </div>
        <textarea
          id={id}
          value={value}
          rows={2}
          className={`form-control ${error ? "is-invalid" : ""}`}
          onChange={(event) => handleValueChange(event.target.value)}
          placeholder={`Paste ${label.toLowerCase()} URL or data URL`}
        />
      </div>
      {error ? <small className="text-danger d-block mt-1">{error}</small> : null}

      {previewError ? <small className="text-danger d-block mt-1">{previewError}</small> : null}
      {!error && !previewError ? (
        <small className="field-hover-help text-body-secondary d-block mt-1">
          If this asset cannot be loaded, save will be blocked and an error message will appear.
        </small>
      ) : null}
    </div>
  );
};

export default BrandAssetInput;
