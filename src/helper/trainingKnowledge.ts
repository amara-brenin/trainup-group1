import type { TrainingKnowledgeDocument, TrainingKnowledgeDocumentType } from "../constant/interfaces";
import { extractOcrTextLines } from "./slideOcr";

const truncateDocumentText = (value: string, maxLength = 20000) => {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength).trim();
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

const resolveDocumentType = (file: File): TrainingKnowledgeDocumentType => {
  const lowerName = file.name.toLowerCase();

  if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
    return "pdf";
  }

  if (lowerName.endsWith(".md")) {
    return "markdown";
  }

  return "text";
};

const extractPdfText = async (file: File) => {
  const pdfRuntime = await loadPdfRuntime();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdfDocument = await pdfRuntime.getDocument({ data: bytes }).promise;
  const lines: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();
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

    textContent.items.forEach((item) => {
      if ("str" in item && String(item.str || "").trim()) {
        lines.push(String(item.str).trim());
      }
    });

    const ocrTextLines = await new Promise<string[]>((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          resolve([]);
          return;
        }

        try {
          resolve(await extractOcrTextLines(blob));
        } catch (error) {
          reject(error);
        }
      }, "image/png");
    }).catch(() => []);

    ocrTextLines.forEach((line) => {
      if (String(line || "").trim()) {
        lines.push(String(line).trim());
      }
    });
  }

  return truncateDocumentText(Array.from(new Set(lines)).join(" "));
};

export const extractKnowledgeDocument = async (file: File): Promise<TrainingKnowledgeDocument> => {
  const type = resolveDocumentType(file);
  const text =
    type === "pdf"
      ? await extractPdfText(file)
      : truncateDocumentText(await file.text());

  if (!text) {
    throw new Error(`No readable text was found in ${file.name}.`);
  }

  return {
    id: `knowledge-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    type,
    text,
    uploadedAt: new Date().toISOString(),
    selectedByDefault: true,
  };
};
