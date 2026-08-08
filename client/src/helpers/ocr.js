// helpers/ocr.js
//
// The lazy OCR runner, extracted from ArtifactContent so INTAKE can reach it
// too. tesseract.js is ~3.5MB, so it is dynamic-imported on first use and the
// initial bundle stays unaffected for anyone who never OCRs anything.
//
// It returns PLAIN TEXT and nothing else. What that text becomes — one
// textblock (the artifact viewer's button) or one checklist item per line
// (intake's photo-of-a-list shape) — is the caller's decision, and keeping that
// out of here is what let the second caller exist without a second OCR path.

export async function runOcr(imageUrl, onProgress) {
  const mod = await import("tesseract.js");
  const createWorker = mod.createWorker || mod.default?.createWorker;
  if (!createWorker) throw new Error("tesseract.js loaded without createWorker");
  const worker = await createWorker("eng", undefined, {
    logger: (m) => onProgress?.(m),
  });
  try {
    const { data } = await worker.recognize(imageUrl);
    return (data?.text || "").trim();
  } finally {
    await worker.terminate();
  }
}

