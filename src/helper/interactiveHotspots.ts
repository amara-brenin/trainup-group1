import type { TrainingInteractiveHotspot } from "../constant/interfaces";

const videoExtensions = [".mp4", ".webm", ".ogg", ".mov", ".m4v"];

const normalizeUrl = (value: string) => String(value || "").trim();

export const isVideoUrl = (value: string) => {
  const url = normalizeUrl(value).toLowerCase();

  if (!url) {
    return false;
  }

  return (
    videoExtensions.some((extension) => url.includes(extension)) ||
    url.includes("youtube.com/watch") ||
    url.includes("youtube.com/embed/") ||
    url.includes("youtu.be/") ||
    url.includes("vimeo.com/") ||
    url.includes("loom.com/share/")
  );
};

export const getHotspotTargetLabel = (hotspot: TrainingInteractiveHotspot) =>
  hotspot.label || (hotspot.kind === "video" ? "Play video" : "Open link");

export const getHotspotActionText = (
  hotspot: TrainingInteractiveHotspot,
  indexWithinKind = 0,
  totalWithinKind = 1,
) => {
  const baseLabel = hotspot.kind === "video" ? "Open Video" : "Open Link";
  return totalWithinKind > 1 ? `${baseLabel} ${indexWithinKind + 1}` : baseLabel;
};

export const buildHotspotSummary = (hotspots: TrainingInteractiveHotspot[] = []) => {
  const linkCount = hotspots.filter((hotspot) => hotspot.kind === "link").length;
  const videoCount = hotspots.filter((hotspot) => hotspot.kind === "video").length;

  return { linkCount, videoCount };
};

export type HotspotPresentation =
  | { mode: "iframe"; src: string; openUrl: string }
  | { mode: "html5"; src: string; openUrl: string }
  | { mode: "external"; src: string; openUrl: string };

export const resolveVideoPresentation = (value: string): HotspotPresentation => {
  const url = normalizeUrl(value);
  const lowerUrl = url.toLowerCase();

  if (!url) {
    return { mode: "external", src: "", openUrl: "" };
  }

  if (videoExtensions.some((extension) => lowerUrl.includes(extension))) {
    return { mode: "html5", src: url, openUrl: url };
  }

  const youTubeMatch =
    url.match(/youtube\.com\/watch\?v=([^&]+)/i) ||
    url.match(/youtu\.be\/([^?&]+)/i) ||
    url.match(/youtube\.com\/embed\/([^?&]+)/i);

  if (youTubeMatch?.[1]) {
    return {
      mode: "iframe",
      src: `https://www.youtube.com/embed/${youTubeMatch[1]}?rel=0&modestbranding=1`,
      openUrl: url,
    };
  }

  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/i);
  if (vimeoMatch?.[1]) {
    return {
      mode: "iframe",
      src: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
      openUrl: url,
    };
  }

  const loomMatch = url.match(/loom\.com\/share\/([a-z0-9]+)/i);
  if (loomMatch?.[1]) {
    return {
      mode: "iframe",
      src: `https://www.loom.com/embed/${loomMatch[1]}`,
      openUrl: url,
    };
  }

  return { mode: "external", src: url, openUrl: url };
};

export const resolveHotspotPresentation = (hotspot: TrainingInteractiveHotspot): HotspotPresentation => {
  const url = normalizeUrl(hotspot.url);

  if (hotspot.kind === "video") {
    return resolveVideoPresentation(url);
  }

  if (/^https?:\/\//i.test(url)) {
    return {
      mode: "iframe",
      src: url,
      openUrl: url,
    };
  }

  return {
    mode: "external",
    src: url,
    openUrl: url,
  };
};

export const getHotspotHostLabel = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch (_error) {
    return "";
  }
};
