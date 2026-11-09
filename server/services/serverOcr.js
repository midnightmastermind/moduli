// services/serverOcr.js
//
// OCR on the server, for imports no tab is open for (an Auto image share). Same engine and options as
// the client (client/src/helpers/ocr.js: tesseract.js, "eng", { text: true, blocks: true }), so the page
// it returns is the shape utils/ocrLayout.ocrToMarkdown already reads and the two cannot disagree.
//
// ONE worker, created on first use and reused: a worker loads ~10 MB of language data, and an import
// burst would pay that per image. Recognitions are queued on it one at a time (a tesseract worker runs
// one job at a time anyway). A worker that throws is dropped so the next call starts a fresh one.
//
// Node 22 note: tesseract.js 7 pulls wasm-feature-detect, whose 1.10 uses `import.source` and crashes
// Node 22; server/package.json pins it to 1.8.0 through "overrides".

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Where tesseract keeps its downloaded language data (~5 MB). Its default is the process's cwd, which put
// eng.traineddata loose in server/; server/cache/ is gitignored.
const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cache", "tesseract");

let workerPromise = null;
let queue = Promise.resolve();

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const mod = await import("tesseract.js");
      const createWorker = mod.createWorker || mod.default?.createWorker;
      if (!createWorker) throw new Error("tesseract.js loaded without createWorker");
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      return createWorker("eng", 1, { cachePath: CACHE_DIR });
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

/** OCR one image file. @returns {Promise<{ text: string, blocks: object[]|null }>} */
export function ocrImage(filePath) {
  const run = queue.then(async () => {
    const worker = await getWorker();
    try {
      const { data } = await worker.recognize(filePath, {}, { text: true, blocks: true });
      return { text: (data?.text || "").trim(), blocks: data?.blocks || null };
    } catch (err) {
      workerPromise = null;
      try { await worker.terminate(); } catch { /* already gone */ }
      throw err;
    }
  });
  queue = run.catch(() => {});
  return run;
}

/** Stop the shared worker (tests, shutdown). */
export async function terminateOcr() {
  const w = workerPromise;
  workerPromise = null;
  if (w) { try { await (await w).terminate(); } catch { /* ignore */ } }
}
