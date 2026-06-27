const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const run = promisify(execFile);

// Server-side PPTX → faithful slide images (LMS_INTEGRATION_RESEARCH.md §5 /
// slide import). Browsers can't render PPTX, so we convert it the same way
// PowerPoint visuals are preserved: LibreOffice headless renders PPTX → PDF,
// then poppler's pdftoppm rasterises each page to PNG (and pdftotext pulls the
// text per page for AI narration/questions).
//
// Requires on the host (Ubuntu/AWS VPS):
//   sudo apt-get install -y libreoffice poppler-utils
//
// If those binaries are missing, throws an error with code "TOOLS_MISSING" so
// the caller can fall back gracefully.

const TOOLS_MISSING = "TOOLS_MISSING";
const CONVERT_TIMEOUT_MS = 300000;

// Try `libreoffice` then `soffice` (both ship with the suite).
const runLibreOffice = async (args, cwd) => {
  for (const bin of ["libreoffice", "soffice"]) {
    try {
      return await run(bin, args, { cwd, timeout: CONVERT_TIMEOUT_MS, maxBuffer: 1024 * 1024 * 64 });
    } catch (error) {
      if (error && error.code === "ENOENT") continue; // try next binary name
      throw error;
    }
  }
  const err = new Error("LibreOffice is not installed on the server.");
  err.code = TOOLS_MISSING;
  throw err;
};

const runPoppler = async (bin, args) => {
  try {
    return await run(bin, args, { timeout: CONVERT_TIMEOUT_MS, maxBuffer: 1024 * 1024 * 64 });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      const err = new Error("poppler-utils (pdftoppm/pdftotext) is not installed on the server.");
      err.code = TOOLS_MISSING;
      throw err;
    }
    throw error;
  }
};

// Convert a PPTX buffer to an ordered list of slide images + per-page text.
// Returns: [{ pageNumber, png: Buffer, text: string[] }]
const convertPptxToSlideImages = async (pptxBuffer, originalName = "deck.pptx") => {
  const workDir = path.join(os.tmpdir(), `pptx-${crypto.randomUUID()}`);
  const profileDir = path.join(workDir, "loprofile"); // unique → concurrency-safe
  await fs.mkdir(workDir, { recursive: true });
  const inputPath = path.join(workDir, "input.pptx");

  try {
    await fs.writeFile(inputPath, pptxBuffer);

    // 1) PPTX → PDF (unique user profile so parallel conversions don't clash)
    await runLibreOffice(
      [
        "--headless",
        "--norestore",
        `-env:UserInstallation=file://${profileDir.replace(/\\/g, "/")}`,
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        inputPath,
      ],
      workDir,
    );

    const pdfPath = path.join(workDir, "input.pdf");
    await fs.access(pdfPath); // throws if conversion produced nothing

    // 2) PDF → one PNG per page. Lower DPI for large files to avoid OOM.
    const pdfStat = await fs.stat(pdfPath);
    const pdfSizeMb = pdfStat.size / (1024 * 1024);
    const dpi = pdfSizeMb > 50 ? "72" : pdfSizeMb > 20 ? "100" : "150";
    await runPoppler("pdftoppm", ["-png", "-r", dpi, pdfPath, path.join(workDir, "slide")]);

    // 3) PDF → per-page text (form-feed \f separates pages)
    let pageTexts = [];
    try {
      const { stdout } = await runPoppler("pdftotext", ["-layout", pdfPath, "-"]);
      pageTexts = String(stdout || "").split("\f");
    } catch {
      pageTexts = []; // text is best-effort; images are the important part
    }

    // Collect + numerically sort the page PNGs (pdftoppm: slide-1.png, slide-2.png…)
    const files = (await fs.readdir(workDir))
      .filter((f) => /^slide-?\d+\.png$/i.test(f))
      .sort((a, b) => Number(a.match(/(\d+)\.png$/i)[1]) - Number(b.match(/(\d+)\.png$/i)[1]));

    if (!files.length) {
      throw new Error("No slides were produced from the PPTX.");
    }

    const slides = [];
    for (let i = 0; i < files.length; i += 1) {
      const png = await fs.readFile(path.join(workDir, files[i]));
      const text = String(pageTexts[i] || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      slides.push({ pageNumber: i + 1, png, text });
    }
    return slides;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};

module.exports = { convertPptxToSlideImages, TOOLS_MISSING };
