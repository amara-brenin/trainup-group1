import { useEffect, useState } from "react";
import type { TrainingInteractiveHotspot, TrainingSlideRecord } from "../../constant/interfaces";
import {
  buildHotspotSummary,
  getHotspotActionText,
  getHotspotTargetLabel,
  resolveHotspotPresentation,
  type HotspotPresentation,
} from "../../helper/interactiveHotspots";
import { resolveSlideMediaAsset } from "../../helper/slideMediaStore";

type SlideMediaPreviewProps = {
  slide: TrainingSlideRecord;
  accentColor: string;
  showLink?: boolean;
  className?: string;
  fallbackNote?: string;
  hideBadge?: boolean;
  removeLabel?: string;
  onRemove?: () => void;
  onUpload?: () => void;
  uploadLabel?: string;
  onRestore?: () => void;
  showRestore?: boolean;
};

type ResolvedState = {
  status: "idle" | "loading" | "ready" | "missing";
  url: string;
  name: string;
};

type ActiveHotspotState = {
  hotspot: TrainingInteractiveHotspot;
  presentation: HotspotPresentation;
} | null;

const initialState: ResolvedState = {
  status: "idle",
  url: "",
  name: "",
};

const SlideMediaPreview = ({
  slide,
  accentColor,
  showLink = false,
  className = "",
  fallbackNote = "Upload an image or import a PDF page to preview this slide.",
  hideBadge = false,
  removeLabel = "Remove media",
  onRemove,
  onUpload,
  uploadLabel = "Upload slide media",
  onRestore,
  showRestore = false,
}: SlideMediaPreviewProps) => {
  const [resolved, setResolved] = useState<ResolvedState>(initialState);
  const [activeHotspot, setActiveHotspot] = useState<ActiveHotspotState>(null);
  const interactiveHotspots = slide.interactiveHotspots ?? [];
  const hotspotSummary = buildHotspotSummary(slide.interactiveHotspots ?? []);

  const openHotspot = (hotspot: TrainingInteractiveHotspot) => {
    if (hotspot.kind === "link") {
      window.open(hotspot.url, "_blank", "noopener,noreferrer");
      return;
    }

    const presentation = resolveHotspotPresentation(hotspot);

    if (presentation.mode === "external") {
      window.open(presentation.openUrl, "_blank", "noopener,noreferrer");
      return;
    }

    setActiveHotspot({
      hotspot,
      presentation,
    });
  };

  useEffect(() => {
    let active = true;
    let revoke: (() => void) | undefined;

    if (!slide.mediaAssetId) {
      setResolved(initialState);
      return () => undefined;
    }

    setResolved((current) => ({ ...current, status: "loading" }));

    void resolveSlideMediaAsset(slide.mediaAssetId)
      .then((asset) => {
        if (!active) {
          asset?.revoke();
          return;
        }

        if (!asset) {
          setResolved({
            status: "missing",
            url: "",
            name: slide.mediaName,
          });
          return;
        }

        revoke = asset.revoke;
        setResolved({
          status: "ready",
          url: asset.url,
          name: asset.name,
        });
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setResolved({
          status: "missing",
          url: "",
          name: slide.mediaName,
        });
      });

    return () => {
      active = false;
      revoke?.();
    };
  }, [slide.mediaAssetId, slide.mediaName]);

  return (
    <div className={`training-slide-media ${className}`.trim()}>
      <div className="training-slide-media-stage">
        {resolved.status === "ready" && resolved.url ? (
          <div className="training-slide-media-frame">
            {onRemove ? (
              <button
                type="button"
                className="training-slide-media-remove"
                onClick={onRemove}
                aria-label={removeLabel}
              >
                <i className="bi bi-x-lg" aria-hidden="true" />
              </button>
            ) : null}
            <img src={resolved.url} alt={slide.title} className="training-slide-media-image" />
            {interactiveHotspots.length ? (
              <div className="training-hotspot-rail" aria-label="Slide actions">
                {interactiveHotspots.map((hotspot, index) => {
                  const kindCount = interactiveHotspots.filter((item) => item.kind === hotspot.kind).length;
                  const kindIndex = interactiveHotspots
                    .slice(0, index + 1)
                    .filter((item) => item.kind === hotspot.kind).length - 1;

                  return (
                    <button
                      key={hotspot.id}
                      type="button"
                      className={`training-hotspot-action-button training-hotspot-action-button-${hotspot.kind}`}
                      onClick={() => openHotspot(hotspot)}
                      aria-label={getHotspotTargetLabel(hotspot)}
                      title={getHotspotTargetLabel(hotspot)}
                    >
                      <span className="training-hotspot-action-button-icon" aria-hidden="true">
                        <i className={`bi ${hotspot.kind === "video" ? "bi-play-circle" : "bi-link-45deg"}`} aria-hidden="true" />
                      </span>
                      <span className="training-hotspot-action-button-text">
                        {getHotspotActionText(hotspot, kindIndex, kindCount)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="training-slide-media-fallback" style={{ borderColor: `${accentColor}35` }}>
            {!hideBadge ? (
              <div className="training-slide-media-fallback-badge" style={{ backgroundColor: `${accentColor}15`, color: accentColor }}>
                {slide.mediaSource === "pdf_page" && slide.mediaPageNumber
                  ? `PDF Page ${slide.mediaPageNumber}`
                  : slide.mediaSource === "ppt_slide" && slide.mediaPageNumber
                    ? `PPT Slide ${slide.mediaPageNumber}`
                    : "Background Media"}
              </div>
            ) : null}
            <div>
              <div className="fw-semibold mb-2" style={{ color: accentColor }}>
                {slide.title}
              </div>
              <div className="small text-body-secondary">
                {resolved.status === "loading"
                  ? "Preparing preview..."
                  : resolved.status === "missing"
                    ? "Stored media could not be found. Re-upload this slide image."
                    : fallbackNote}
              </div>
            </div>

            {onUpload ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={onUpload}>
                {uploadLabel}
              </button>
            ) : null}

            {showRestore && onRestore ? (
              <button type="button" className="btn btn-light btn-sm" onClick={onRestore}>
                Restore previous media
              </button>
            ) : null}
          </div>
        )}
      </div>

      {showLink ? (
        <div className="training-slide-link-row">
          <input
            className="form-control form-control-sm"
            readOnly
            value={resolved.url || resolved.name || slide.mediaName || "No media linked"}
          />
          {resolved.url ? (
            <a
              href={resolved.url}
              className="btn btn-sm btn-light"
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${slide.title} media`}
            >
              <i className="bi bi-box-arrow-up-right" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}

      {hotspotSummary.linkCount || hotspotSummary.videoCount ? (
        <div className="training-hotspot-summary">
          {hotspotSummary.linkCount ? (
            <span className="training-hotspot-summary-pill">
              <i className="bi bi-link-45deg" aria-hidden="true" /> {hotspotSummary.linkCount} link{hotspotSummary.linkCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {hotspotSummary.videoCount ? (
            <span className="training-hotspot-summary-pill">
              <i className="bi bi-play-circle" aria-hidden="true" /> {hotspotSummary.videoCount} video{hotspotSummary.videoCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      ) : null}

      {activeHotspot ? (
        <div className="training-media-modal-backdrop" role="dialog" aria-modal="true" onClick={() => setActiveHotspot(null)}>
          <div className="training-media-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="training-media-modal-body">
              <button
                type="button"
                className="training-media-modal-close"
                aria-label="Close media preview"
                onClick={() => setActiveHotspot(null)}
              >
                <i className="bi bi-x-lg" aria-hidden="true" />
              </button>
              {activeHotspot.presentation.mode === "iframe" ? (
                <iframe
                  src={activeHotspot.presentation.src}
                  title={activeHotspot.hotspot.label}
                  className={`training-media-modal-frame${activeHotspot.hotspot.kind === "link" ? " is-link" : ""}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <video
                  src={activeHotspot.presentation.src}
                  className="training-media-modal-video"
                  controls
                  autoPlay
                  playsInline
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default SlideMediaPreview;
