import JSZip from "jszip";
import type { TrainingInteractiveHotspot, TrainingSlideMediaSource } from "../constant/interfaces";
import { getAuthToken } from "./authSession";
import { isVideoUrl } from "./interactiveHotspots";
import { getRequestUrl, isServerApiEnabled } from "./runtimeApi";
import { extractOcrTextLines } from "./slideOcr";

const DB_NAME = "trainup-slide-media";
const STORE_NAME = "assets";

type StoredSlideMediaAsset = {
  id: string;
  name: string;
  mimeType: string;
  source: Exclude<TrainingSlideMediaSource, "seed">;
  pageNumber: number | null;
  extractedText: string[];
  blob: Blob;
  createdAt: number;
};

export type SlideMediaImportRecord = {
  id: string;
  name: string;
  mimeType: string;
  source: Exclude<TrainingSlideMediaSource, "seed">;
  pageNumber: number | null;
  extractedText: string[];
  interactiveHotspots?: TrainingInteractiveHotspot[];
};

export type SlideMediaResolvedAsset = SlideMediaImportRecord & {
  url: string;
  revoke: () => void;
};

const isBrowser = typeof window !== "undefined";
const isRemoteMediaEnabled = isServerApiEnabled;

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (!isBrowser || !("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open media database."));
  });

const withStore = async <T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
) => {
  const database = await openDb();

  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);

    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
      database.close();
    };

    handler(store, resolve, reject);
  });
};

const buildAssetId = () => `slide-media-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const blobFromCanvas = (canvas: HTMLCanvasElement, mimeType: string) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("Unable to generate image data from the PDF page."));
    }, mimeType);
  });

const saveAssetBlob = async (input: {
  blob: Blob;
  name: string;
  mimeType: string;
  source: Exclude<TrainingSlideMediaSource, "seed">;
  pageNumber?: number | null;
  extractedText?: string[];
  interactiveHotspots?: TrainingInteractiveHotspot[];
}) => {
  const id = buildAssetId();
  const record: StoredSlideMediaAsset = {
    id,
    name: input.name,
    mimeType: input.mimeType,
    source: input.source,
    pageNumber: input.pageNumber ?? null,
    extractedText: input.extractedText ?? [],
    blob: input.blob,
    createdAt: Date.now(),
  };

  await withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Failed to save the media asset."));
  });

  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    source: record.source,
    pageNumber: record.pageNumber,
    extractedText: input.extractedText ?? [],
    interactiveHotspots: input.interactiveHotspots ?? [],
  } satisfies SlideMediaImportRecord;
};

const getAuthHeaders = (): Record<string, string> => {
  const token = getAuthToken();

  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
};

const requestRemoteUploadSlot = async (input: {
  fileName: string;
  mimeType: string;
  source: Exclude<TrainingSlideMediaSource, "seed">;
  pageNumber?: number | null;
  extractedText?: string[];
  interactiveHotspots?: TrainingInteractiveHotspot[];
  originalFile?: boolean;
}) => {
  const response = await fetch(getRequestUrl("/media/upload-url"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as {
    status: boolean;
    message: string;
    data: { assetId: string; uploadUrl: string };
  };

  if (!response.ok || !payload.status) {
    throw new Error(payload.message || "Unable to prepare upload.");
  }

  return payload.data;
};

const readErrorMessage = async (response: Response, fallbackMessage: string) => {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { message?: string };
    return payload.message || fallbackMessage;
  }

  const text = await response.text();
  return text || fallbackMessage;
};

const uploadBlobToRemote = async (input: {
  blob: Blob;
  fileName: string;
  mimeType: string;
  source: Exclude<TrainingSlideMediaSource, "seed">;
  pageNumber?: number | null;
  extractedText?: string[];
  interactiveHotspots?: TrainingInteractiveHotspot[];
  originalFile?: boolean;
}) => {
  const slot = await requestRemoteUploadSlot({
    fileName: input.fileName,
    mimeType: input.mimeType,
    source: input.source,
    pageNumber: input.pageNumber,
    extractedText: input.extractedText,
    interactiveHotspots: input.interactiveHotspots,
    originalFile: input.originalFile,
  });

  const uploadResponse = await fetch(getRequestUrl(`/media/${slot.assetId}/upload`), {
    method: "POST",
    headers: {
      "Content-Type": input.mimeType,
      ...getAuthHeaders(),
    },
    body: input.blob,
  });

  if (!uploadResponse.ok) {
    throw new Error(await readErrorMessage(uploadResponse, "Unable to upload media to remote storage."));
  }

  return {
    id: slot.assetId,
    name: input.fileName,
    mimeType: input.mimeType,
    source: input.source,
    pageNumber: input.pageNumber ?? null,
    extractedText: input.extractedText ?? [],
    interactiveHotspots: input.interactiveHotspots ?? [],
  } satisfies SlideMediaImportRecord;
};

const fileBaseName = (name: string) => name.replace(/\.[^.]+$/, "").trim();

const normalizeTextLines = (lines: string[]) =>
  Array.from(
    new Set(
      lines
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter((line) => line.length > 0),
    ),
  ).slice(0, 12);

const mergeExtractedText = (...groups: Array<string[] | undefined>) =>
  normalizeTextLines(groups.flatMap((group) => group ?? []));

const clampPercent = (value: number) => Math.min(Math.max(value, 0), 100);

const normalizeHotspotLabel = (url: string, annotationLabel: string, kind: TrainingInteractiveHotspot["kind"]) => {
  const normalizedLabel = String(annotationLabel || "").trim();

  if (normalizedLabel) {
    return normalizedLabel;
  }

  if (kind === "video") {
    return "Play video";
  }

  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    return host ? `Open ${host}` : "Open link";
  } catch (_error) {
    return "Open link";
  }
};

const extractPdfHotspots = async (page: any, viewport: any) => {
  const annotations = await page.getAnnotations();

  return annotations
    .map((annotation: any, index: number) => {
      const url = String(annotation.url || annotation.unsafeUrl || "").trim();

      if (!url || !/^https?:\/\//i.test(url)) {
        return null;
      }

      const kind: TrainingInteractiveHotspot["kind"] = isVideoUrl(url) ? "video" : "link";
      const viewportRect = viewport.convertToViewportRectangle(annotation.rect || [0, 0, 0, 0]);
      const left = Math.min(viewportRect[0], viewportRect[2]);
      const top = Math.min(viewportRect[1], viewportRect[3]);
      const width = Math.abs(viewportRect[2] - viewportRect[0]);
      const height = Math.abs(viewportRect[3] - viewportRect[1]);

      if (width < 8 || height < 8) {
        return null;
      }

      return {
        id: `hotspot-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        label: normalizeHotspotLabel(url, String(annotation.title || annotation.contents || "").trim(), kind),
        url,
        leftPct: clampPercent((left / viewport.width) * 100),
        topPct: clampPercent((top / viewport.height) * 100),
        widthPct: clampPercent((width / viewport.width) * 100),
        heightPct: clampPercent((height / viewport.height) * 100),
      } satisfies TrainingInteractiveHotspot;
    })
    .filter((hotspot: TrainingInteractiveHotspot | null): hotspot is TrainingInteractiveHotspot => Boolean(hotspot));
};

const renderTextSlidePreview = async (input: { title: string; points: string[]; footer: string }) => {
  const canvas = window.document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to prepare the slide preview canvas.");
  }

  context.fillStyle = "#eef4ff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "#cfe0ff";
  context.fillRect(0, canvas.height - 14, canvas.width, 14);

  context.fillStyle = "#3176ea";
  context.font = "bold 46px Arial";
  context.fillText(input.title, 72, 120, 1140);

  context.fillStyle = "#4b5563";
  context.font = "30px Arial";
  input.points.slice(0, 5).forEach((point, index) => {
    const y = 200 + index * 72;
    context.beginPath();
    context.fillStyle = "#3b82f6";
    context.arc(95, y - 10, 7, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#5f6b7a";
    context.fillText(point, 120, y, 1080);
  });

  context.fillStyle = "#8b95a3";
  context.font = "24px Arial";
  context.fillText(input.footer, 72, 660, 1140);

  return blobFromCanvas(canvas, "image/png");
};

let pdfRuntimePromise: Promise<typeof import("pdfjs-dist")> | null = null;

const loadPdfRuntime = async () => {
  if (!pdfRuntimePromise) {
    pdfRuntimePromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfRuntime, workerModule]) => {
      pdfRuntime.GlobalWorkerOptions.workerSrc = workerModule.default;
      return pdfRuntime;
    });
  }

  return pdfRuntimePromise;
};

export const storeImageFile = async (file: File) => {
  const extractedText = await extractOcrTextLines(file).catch(() => []);

  if (isRemoteMediaEnabled) {
    return uploadBlobToRemote({
      blob: file,
      fileName: file.name,
      mimeType: file.type || "image/png",
      source: "image",
      extractedText,
      interactiveHotspots: [],
    });
  }

  return saveAssetBlob({
    blob: file,
    name: file.name,
    mimeType: file.type || "image/png",
    source: "image",
    extractedText,
    interactiveHotspots: [],
  });
};

export const extractPdfPagesToImages = async (file: File) => {
  if (isRemoteMediaEnabled) {
    await uploadBlobToRemote({
      blob: file,
      fileName: file.name,
      mimeType: file.type || "application/pdf",
      source: "pdf_page",
      originalFile: true,
    });
  }

  const pdfRuntime = await loadPdfRuntime();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdfDocument = await pdfRuntime.getDocument({ data: bytes }).promise;
  const assets: SlideMediaImportRecord[] = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = window.document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Unable to prepare the PDF page canvas.");
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      canvas,
      viewport,
    }).promise;

    const textContent = await page.getTextContent();
    const pdfTextLines = normalizeTextLines(
      textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter((value): value is string => Boolean(value)),
    );

    const blob = await blobFromCanvas(canvas, "image/png");
    // Only fall back to (expensive) OCR when pdf.js produced no usable embedded
    // text. Text-based PDFs skip OCR entirely; scanned/image PDFs still OCR.
    const ocrTextLines =
      pdfTextLines.length >= 3 ? [] : await extractOcrTextLines(blob).catch(() => []);
    const extractedText = mergeExtractedText(pdfTextLines, ocrTextLines);
    const interactiveHotspots = await extractPdfHotspots(page, viewport);
    const asset = isRemoteMediaEnabled
      ? await uploadBlobToRemote({
        blob,
        fileName: `${fileBaseName(file.name)}-page-${pageNumber}.png`,
        mimeType: "image/png",
        source: "pdf_page",
        pageNumber,
        extractedText,
        interactiveHotspots,
      })
      : await saveAssetBlob({
        blob,
        name: `${fileBaseName(file.name)}-page-${pageNumber}.png`,
        mimeType: "image/png",
        source: "pdf_page",
        pageNumber,
        extractedText,
        interactiveHotspots,
      });

    assets.push(asset);
  }

  return assets;
};

const decodeXmlValue = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const extractSlideTextFromXml = (xml: string) => {
  const matches = Array.from(xml.matchAll(/<a:t[^>]*>(.*?)<\/a:t>/g));
  return normalizeTextLines(matches.map((match) => decodeXmlValue(match[1] ?? "")));
};

export const extractPptxSlidesToImages = async (file: File) => {
  if (isRemoteMediaEnabled) {
    await uploadBlobToRemote({
      blob: file,
      fileName: file.name,
      mimeType: file.type || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      source: "ppt_slide",
      originalFile: true,
    });
  }

  const zip = await JSZip.loadAsync(file);
  const slideEntries = Object.keys(zip.files)
    .filter((key) => /^ppt\/slides\/slide\d+\.xml$/i.test(key))
    .sort((left, right) => {
      const leftNo = Number(left.match(/slide(\d+)\.xml/i)?.[1] ?? "0");
      const rightNo = Number(right.match(/slide(\d+)\.xml/i)?.[1] ?? "0");
      return leftNo - rightNo;
    });

  if (!slideEntries.length) {
    throw new Error("No slides were found in this PPTX file.");
  }

  const assets: SlideMediaImportRecord[] = [];

  for (let index = 0; index < slideEntries.length; index += 1) {
    const entryName = slideEntries[index];
    const xml = await zip.file(entryName)?.async("string");

    if (!xml) {
      continue;
    }

    const xmlExtractedText = extractSlideTextFromXml(xml);
    const title = xmlExtractedText[0] || `${fileBaseName(file.name)} - Slide ${index + 1}`;
    const points = xmlExtractedText.slice(1, 5);
    const previewBlob = await renderTextSlidePreview({
      title,
      points: points.length ? points : ["Preview generated from the uploaded PPTX slide."],
      footer: `${file.name} • Slide ${index + 1}`,
    });
    // PPTX slide text already comes straight from the parsed slide XML
    // (xmlExtractedText above). Running OCR on a preview image generated from
    // that same XML was pure redundant work, so it is removed.
    const extractedText = xmlExtractedText;

    const asset = isRemoteMediaEnabled
      ? await uploadBlobToRemote({
        blob: previewBlob,
        fileName: `${fileBaseName(file.name)}-slide-${index + 1}.png`,
        mimeType: "image/png",
        source: "ppt_slide",
        pageNumber: index + 1,
        extractedText,
        interactiveHotspots: [],
      })
      : await saveAssetBlob({
        blob: previewBlob,
        name: `${fileBaseName(file.name)}-slide-${index + 1}.png`,
        mimeType: "image/png",
        source: "ppt_slide",
        pageNumber: index + 1,
        extractedText,
        interactiveHotspots: [],
      });

    assets.push(asset);
  }

  return assets;
};

export const resolveSlideMediaAsset = async (assetId: string) => {
  if (isRemoteMediaEnabled) {
    const response = await fetch(getRequestUrl(`/media/${assetId}/resolve`), {
      headers: getAuthHeaders(),
    });
    const payload = (await response.json()) as {
      status: boolean;
      message: string;
      data: {
        id: string;
        name: string;
        mimeType: string;
        source: Exclude<TrainingSlideMediaSource, "seed">;
        pageNumber: number | null;
        extractedText: string[];
        interactiveHotspots?: TrainingInteractiveHotspot[];
        url: string;
      };
    };

    if (!response.ok || !payload.status) {
      return null;
    }

    return {
      ...payload.data,
      revoke: () => undefined,
    } satisfies SlideMediaResolvedAsset;
  }

  const record = await withStore<StoredSlideMediaAsset | null>("readonly", (store, resolve, reject) => {
    const request = store.get(assetId);
    request.onsuccess = () => resolve((request.result as StoredSlideMediaAsset | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Failed to read the media asset."));
  });

  if (!record) {
    return null;
  }

  const url = URL.createObjectURL(record.blob);

  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    source: record.source,
    pageNumber: record.pageNumber,
    extractedText: record.extractedText ?? [],
    url,
    revoke: () => URL.revokeObjectURL(url),
  } satisfies SlideMediaResolvedAsset;
};

export const removeSlideMediaAsset = async (assetId: string) => {
  if (isRemoteMediaEnabled) {
    const response = await fetch(getRequestUrl(`/media/${assetId}`), {
      method: "DELETE",
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Failed to delete the media asset.");
    }

    return;
  }

  await withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.delete(assetId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Failed to delete the media asset."));
  });
};
