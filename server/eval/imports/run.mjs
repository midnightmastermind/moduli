// Import eval runner.  node eval/imports/run.mjs [--baseline] [--check] [--only <case>] [--with-ollama]
// Needs no network and no OCR engine: image cases replay the recorded ocr.json, HTML cases read source.html.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreCase, compareToBaseline } from "./score.js";
import { runImport } from "../../services/importPipeline.js";
import { cleanupWithOllama, acceptCleanup } from "../../services/importEnrich.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.join(here, "cases");
const baselinePath = path.join(here, "baseline.json");

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
// --with-ollama: also runs the Task 7 clean-up on each case (the real OLLAMA_URL) and scores both.
const withOllama = flag("--with-ollama");

const read = (p, d = null) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : d);

// --add-correction <id>: a stored ImportCorrection (Task 8) becomes a new case directory, so a fix you made by
// hand joins the test set. Needs the database (run with --env-file=.env). A link's page is fetched once and
// saved; a text import's source is the text as it arrived. An image import is refused: its OCR is not stored.
if (args.includes("--add-correction")) {
  const cid = args[args.indexOf("--add-correction") + 1];
  const { default: mongoose } = await import("mongoose");
  const { default: ImportCorrection } = await import("../../models/ImportCorrection.js");
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const c = await ImportCorrection.findById(cid).lean().catch(() => null);
  if (!c) { console.error(`no correction ${cid}`); await mongoose.disconnect(); process.exit(1); }
  if (c.kind === "image") { console.error("an image correction cannot be a case: its OCR is not stored"); await mongoose.disconnect(); process.exit(1); }
  const dir = path.join(casesDir, `corr-${String(c._id).slice(-8)}`);
  fs.mkdirSync(dir, { recursive: true });
  if (c.sourceUrl) {
    const { fetchPageHtml } = await import("../../utils/safeFetchUrl.js");
    const r = await fetchPageHtml(c.sourceUrl);
    if (!r?.ok) { console.error(`could not fetch ${c.sourceUrl}: ${r?.reason}`); await mongoose.disconnect(); process.exit(1); }
    fs.writeFileSync(path.join(dir, "source.html"), r.html);
    fs.writeFileSync(path.join(dir, "url.txt"), c.sourceUrl + "\n");
  } else {
    fs.writeFileSync(path.join(dir, "source.txt"), c.before);
  }
  fs.writeFileSync(path.join(dir, "expected.md"), c.after + "\n");
  fs.writeFileSync(path.join(dir, "expected.json"), JSON.stringify({ fromCorrection: String(c._id) }, null, 2) + "\n");
  console.log("wrote", dir, "— review expected.md, then run --baseline");
  await mongoose.disconnect();
  process.exit(0);
}

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
async function actualFor(dir, _expectedMeta, opts) {
  const { source, page } = sourceFor(dir);
  const out = await runImport({ source, userId: "eval", gridId: null, dryRun: true }, {
    ocrImage: async () => page,
    fetchPageHtml: async () => { throw new Error("eval runs offline"); },
  });
  if (!opts?.withOllama) return { md: out.markdown, meta: out.meta };
  // What the background clean-up would write: the model's answer when acceptCleanup passes, else the rules result.
  const t0 = Date.now();
  const answer = await cleanupWithOllama({ markdown: out.markdown, kind: out.meta?.source?.kind });
  const verdict = answer ? acceptCleanup(out.markdown, answer) : { ok: false, reason: "ollama" };
  return { md: out.markdown, meta: out.meta,
    cleaned: { md: verdict.ok ? answer : out.markdown, ms: Date.now() - t0, ok: verdict.ok, reason: verdict.reason || null } };
}

const names = fs.readdirSync(casesDir).filter((n) => fs.statSync(path.join(casesDir, n)).isDirectory()).sort();
const results = {};
const cleanedResults = {};
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
  if (actual.cleaned) {
    let cmd = actual.cleaned.md;
    if (expectedMeta.cutAfter) { const i = cmd.indexOf(expectedMeta.cutAfter); if (i >= 0) cmd = cmd.slice(0, i + expectedMeta.cutAfter.length); }
    cleanedResults[name] = { ...scoreCase({ expectedMd, expectedMeta, actualMd: cmd, actualMeta: actual.meta }), ...actual.cleaned };
  }
}
if (withOllama) {
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const cmp = {};
  let rulesSum = 0, aiSum = 0, drops = 0;
  for (const [n, c] of Object.entries(cleanedResults)) {
    rulesSum += results[n].total; aiSum += c.total;
    if (c.total < results[n].total) drops++;
    cmp[n] = { rules: r3(results[n].total), withOllama: r3(c.total), ms: c.ms, accepted: c.ok, reason: c.reason || "" };
  }
  console.log("rules-only vs with-ollama:");
  console.table(cmp);
  console.log(`totals: rules ${r3(rulesSum)} · with-ollama ${r3(aiSum)} · cases that dropped ${drops}` +
    ` -> ${aiSum >= rulesSum && !drops ? "clean-up may ship (IMPORT_AI_CLEANUP=1)" : "leave IMPORT_AI_CLEANUP unset"}`);
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
