// helpers/pdfPages.js
//
// Render a PDF's pages to images, one at a time.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
// `helpers/ocr.runOcr` is tesseract.js, and tesseract CANNOT read a PDF — hand
// it one and it fails with "Error attempting to read image." (measured against
// a real one-page PDF on 2026-08-08, which is why the OCR intake shape was
// pulled off PDFs entirely). pdf.js is already a dependency and already renders
// pages to a canvas for the artifact viewer, so the missing piece was never the
// OCR engine: it was turning a page into something the engine can see.
//
// ── ONE PAGE AT A TIME, DELIBERATELY ────────────────────────────────────────
// The callback is AWAITED per page and each canvas is released before the next
// is drawn. Building an array of page images first would hold every page of a
// long document in memory at OCR resolution simultaneously — and the caller
// wants to report progress per page anyway, which an array cannot do.
//
// ── SCALE IS AN OCR DECISION, NOT A DISPLAY ONE ─────────────────────────────
// pdf.js viewport scale 1 is 72 DPI, which tesseract reads badly. 2.5 puts it
// near 180 DPI — the range OCR actually wants — at the cost of a bigger canvas.
// The artifact VIEWER uses 1.2 because a human is reading it; do not share that
// number, the two have different jobs.

export const PDF_OCR_SCALE = 2.5;

/** Is this file something `eachPdfPageImage` can read? */
export function isPdfFile(file) {
  return /^application\/pdf$/i.test(file?.type || "") || /\.pdf$/i.test(file?.name || "");
}

let _pdfjs = null;
async function loadPdfjs() {
  if (_pdfjs) return _pdfjs;
  const mod = await import("pdfjs-dist");
  try {
    // v4+ needs an explicit worker URL; Vite's `?url` emits the right asset.
    // Same dance as ArtifactContent — if it fails, pdf.js parses inline, which
    // is slower but still correct, so this is not fatal.
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
    mod.GlobalWorkerOptions.workerSrc = workerUrl;
  } catch { /* inline fallback */ }
  _pdfjs = mod;
  return mod;
}

/**
 * Render each page and hand it to `onPage(dataUrl, pageNo, total)`, awaited.
 *
 * @returns {Promise<{ pages: number, total: number, truncated: boolean }>}
 *          `pages` is how many were actually rendered.
 */
export async function eachPdfPageImage(file, onPage, { scale = PDF_OCR_SCALE, maxPages = 50 } = {}) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const total = doc.numPages;
  // The user asked for every page. The cap is a floor under a pathological
  // document, not a policy — 50 pages of OCR is already minutes — and it is
  // REPORTED rather than silently applied, the same contract
  // `splitToChecklistItems` has with its item cap.
  const limit = Math.min(total, maxPages);
  try {
    for (let n = 1; n <= limit; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
        await onPage(canvas.toDataURL("image/png"), n, limit);
      } finally {
        // Let the bitmap go before the next page is drawn.
        canvas.width = 0; canvas.height = 0;
        try { page.cleanup(); } catch { /* older builds */ }
      }
    }
  } finally {
    try { await doc.destroy(); } catch { /* ignore */ }
  }
  return { pages: limit, total, truncated: limit < total };
}
