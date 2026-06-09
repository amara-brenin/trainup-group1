const normalizeLine = (value: string) => value.replace(/\s+/g, " ").trim();

type TesseractWorker = {
  recognize: (image: Blob | string) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<void>;
};

let workerPromise: Promise<TesseractWorker> | null = null;

const getWorker = async () => {
  if (!workerPromise) {
    workerPromise = import("tesseract.js").then(async ({ createWorker }) => {
      const worker = (await createWorker("eng")) as unknown as TesseractWorker;
      return worker;
    });
  }

  return workerPromise;
};

export const extractOcrTextLines = async (image: Blob | string) => {
  const worker = await getWorker();
  const result = await worker.recognize(image);

  return Array.from(
    new Set(
      String(result.data?.text || "")
        .split(/\r?\n/g)
        .map(normalizeLine)
        .filter((line) => line.length > 2),
    ),
  ).slice(0, 12);
};
