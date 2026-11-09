// Import eval runner.  node eval/imports/run.mjs [--baseline] [--check] [--only <case>] [--with-ollama]
// Needs no network and no OCR engine: image cases replay the recorded ocr.json, HTML cases read source.html.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreCase } from "./score.js";
import { readerFromHtml } from "../../utils/readerExtract.js";
import { ocrToMarkdown } from "../../../client/src/helpers/ocrLayout.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.join(here, "cases");
const baselinePath = path.join(here, "baseline.json");

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const withOllama = flag("--with-ollama"); // Task 7 hooks in here

const read = (p, d = null) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : d);

function htmlTitle(html) {
  const t = (html.match(/<title>([^<]*)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
  return t.split(/\s+[|–—-]\s+/)[0].replace(/\s*\([^)]*\)\s*$/, "").trim();
}
const imagesIn = (md) => [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);

/** The import under test, run on one case. Task 3 replaces this with `runImport` in dry-run mode. */
async function actualFor(dir, expectedMeta, _opts) {
  if (fs.existsSync(path.join(dir, "ocr.json"))) {
    const md = ocrToMarkdown(JSON.parse(read(path.join(dir, "ocr.json"))), { mode: "magic" });
    const title = md.match(/^#\s+(.+)$/m)?.[1] || "";
    return { md, meta: { title, images: [] } };
  }
  const html = read(path.join(dir, "source.html"));
  if (html != null) {
    const title = htmlTitle(html);
    const { markdown } = readerFromHtml(html, expectedMeta.type === "wikipedia" ? title : "");
    return { md: markdown, meta: { title, images: imagesIn(markdown) } };
  }
  const txt = read(path.join(dir, "source.txt"));
  if (txt != null) return { md: txt, meta: { title: "", images: [] } };
  throw new Error(`no source in ${dir}`);
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
  if (expectedMeta.cutAfter) {
    const i = actualMd.indexOf(expectedMeta.cutAfter);
    if (i >= 0) actualMd = actualMd.slice(0, i + expectedMeta.cutAfter.length);
  }
  results[name] = scoreCase({ expectedMd, expectedMeta, actualMd, actualMeta: actual.meta });
}

const PARTS = ["paragraphs", "headings", "quotes", "title", "imageKept", "board", "chars"];
const round = (v) => (v === undefined ? "-" : Math.round(v * 1000) / 1000);
const rows = {};
for (const [n, r] of Object.entries(results)) {
  rows[n] = { total: round(r.total), ...Object.fromEntries(PARTS.map((p) => [p, round(r.parts[p])])) };
}
console.table(rows);

if (flag("--baseline")) {
  const out = {};
  for (const [n, r] of Object.entries(results)) out[n] = { total: round(r.total), parts: r.parts };
  fs.writeFileSync(baselinePath, JSON.stringify(out, null, 2) + "\n");
  console.log("wrote", baselinePath);
}
if (flag("--check")) {
  const base = JSON.parse(read(baselinePath, "{}"));
  const bad = Object.entries(results).filter(([n, r]) => base[n] && r.total < base[n].total - 0.001);
  for (const [n, r] of bad) console.error(`REGRESSION ${n}: ${round(r.total)} < baseline ${base[n].total}`);
  if (bad.length) process.exit(1);
}
