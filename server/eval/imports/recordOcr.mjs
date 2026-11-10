// Usage: node eval/imports/recordOcr.mjs <caseDir>
// Runs tesseract.js on <caseDir>/source.jpg (same options as client/src/helpers/ocr.js) and writes ocr.json.
import { createWorker } from "tesseract.js";
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: recordOcr.mjs <caseDir>"); process.exit(1); }
const src = ["source.jpg", "source.png"].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
if (!src) { console.error("no source.jpg/png in", dir); process.exit(1); }
const worker = await createWorker("eng");
try {
  const { data } = await worker.recognize(src, {}, { text: true, blocks: true });
  fs.writeFileSync(path.join(dir, "ocr.json"), JSON.stringify({ text: (data.text || "").trim(), blocks: data.blocks || null }));
  console.log("wrote", path.join(dir, "ocr.json"));
} finally {
  await worker.terminate();
}
