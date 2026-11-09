// Import eval runner.  node eval/imports/run.mjs [--baseline] [--check] [--only <case>] [--with-ollama]
// Needs no network and no OCR engine: image cases replay the recorded ocr.json, HTML cases read source.html.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreCase, compareToBaseline } from "./score.js";
import { runImport } from "../../services/importPipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.join(here, "cases");
const baselinePath = path.join(here, "baseline.json");

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const withOllama = flag("--with-ollama"); // Task 7 hooks in here

const read = (p, d = null) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : d);

/** The source a case describes. An image case replays its recorded OCR instead of running tesseract. */
function sourceFor(dir) {
  const ocr = path.join(dir, "ocr.json");
  if (fs.existsSync(ocr)) {
    const img = ["source.jpg", "source.png"].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f)) || path.join(dir, "source.jpg");
    return { source: { kind: "image", filePath: img, imageOccurrenceId: "eval-image" }, page: JSON.parse(read(ocr)) };
  }
  const html = read(path.join(dir, "source.html"));
  if (html != null) return { source: { kind: "html", html, url: (read(path.join(dir, "url.txt"), "") || "").trim() } };
  const txt = read(path.join(dir, "source.txt"));
  if (txt != null) return { source: { kind: "text", text: txt } };
  throw new Error(`no source in ${dir}`);
}

/** The import under test: the one pipeline, planned and never written. */
async function actualFor(dir, _expectedMeta, _opts) {
  const { source, page } = sourceFor(dir);
  const out = await runImport({ source, userId: "eval", gridId: null, dryRun: true }, {
    ocrImage: async () => page,
    fetchPageHtml: async () => { throw new Error("eval runs offline"); },
  });
  return { md: out.markdown, meta: out.meta };
}

const names = fs.readdirSync(casesDir).filter((n) => fs.statSync(path.join(casesDir, n)).isDirectory()).sort();
const results = {};
for (const name of names) {
  if (only && only !== name) continue;
  const dir = path.join(casesDir, name);
  const expectedMd = read(path.join(dir, "expected.md"), "");
  const expectedMeta = JSON.parse(read(path.join(dir, "expected.json"), "{}"));
  const actual = await actualFor(dir, expectedMeta, { withOllama });
  let actualMd = actual.md;
  const warnings = [];
  if (expectedMeta.cutAfter) {
    const i = actualMd.indexOf(expectedMeta.cutAfter);
    if (i >= 0) actualMd = actualMd.slice(0, i + expectedMeta.cutAfter.length);
    else warnings.push(`cutAfter marker not found in output: ${JSON.stringify(expectedMeta.cutAfter)}`);
  }
  results[name] = { ...scoreCase({ expectedMd, expectedMeta, actualMd, actualMeta: actual.meta }), warnings };
}

const PARTS = ["paragraphs", "headings", "quotes", "title", "imageKept", "board", "chars"];
const round = (v) => (v === undefined ? "-" : Math.round(v * 1000) / 1000);
const rows = {};
for (const [n, r] of Object.entries(results)) {
  rows[n] = { total: round(r.total), ...Object.fromEntries(PARTS.map((p) => [p, round(r.parts[p])])) };
}
console.table(rows);

for (const [n, r] of Object.entries(results)) for (const w of r.warnings) console.warn(`WARNING ${n}: ${w}`);
if (flag("--baseline")) {
  const out = {};
  for (const [n, r] of Object.entries(results)) out[n] = { total: round(r.total), parts: r.parts };
  fs.writeFileSync(baselinePath, JSON.stringify(out, null, 2) + "\n");
  console.log("wrote", baselinePath);
}
if (flag("--check")) {
  const { ok, problems } = compareToBaseline(results, JSON.parse(read(baselinePath, "{}")), { only });
  for (const p of problems) console.error(`REGRESSION ${p}`);
  if (!ok) process.exit(1);
}
