// helpers/bookText.js
//
// The text of a file, for OPERATIONS (user, 2026-10-15: "make sure that the magic view and access of
// files, reading files, etc. can be used in operations. i want to be able to add daily reflections and
// other day to day reflection books to the daypage for that day").
//
//   readFileText({ src, kind, from, to, page })  ->  { text, found }
//
// `kind` "pdf" reads through pdf.js, page by page (helpers/bookEngine.pdfTextToMarkdown); "ebook"
// (epub / mobi / azw / azw3) through foliate-js, section by section, headings kept as `#` lines. The
// whole text of a file is read ONCE per session and cached — a year of daily pages is one read.
//
// `from` / `to` cut a passage out of it: plain text (case-insensitive) or a `/regex/flags` (default
// flags `im`, so `^` is a line start). The passage runs from the `from` match up to (not including)
// the next `to` match after it, or to `maxChars`. With neither, `page` picks one page (pdf) or
// section (e-book), 1-based; with nothing at all, the whole text.
//
// Runs in the PAGE only (pdf.js and foliate need a browser): READ_FILE is a page action, so the load
// sweep's worker never takes an operation that uses it (helpers/opSweepCore).
import { pdfTextToMarkdown } from "./bookEngine";

const cache = new Map(); // `${kind}|${src}` -> Promise<string[]> (one entry per page / section)

export function __resetBookTextCache() { cache.clear(); }

/** `/x/i` → RegExp; anything else → a case-insensitive literal match. */
export function toPattern(spec, defaultFlags = "im") {
  if (spec instanceof RegExp) return spec;
  if (typeof spec !== "string" || !spec.trim()) return null;
  const m = spec.match(/^\/(.+)\/([a-z]*)$/s);
  if (m) {
    try { return new RegExp(m[1], m[2] || defaultFlags); } catch { return null; }
  }
  return new RegExp(spec.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/** The passage between `from` and the next `to`. `found` is false when `from` matched nothing. */
export function slicePassage(text, { from, to, maxChars = 20000 } = {}) {
  const src = String(text || "");
  const fromRe = toPattern(from);
  if (!fromRe) return { text: src.slice(0, maxChars), found: !!src };
  const m = fromRe.exec(src);
  if (!m) return { text: "", found: false };
  const start = m.index;
  const after = start + m[0].length;
  let end = Math.min(src.length, start + maxChars);
  const toRe = toPattern(to);
  if (toRe) {
    const rest = src.slice(after);
    const t = (toRe.global ? new RegExp(toRe.source, toRe.flags.replace("g", "")) : toRe).exec(rest);
    if (t) end = Math.min(end, after + t.index);
  }
  return { text: src.slice(start, end).trim(), found: true };
}

async function pdfPages(src) {
  const pdfjs = await import("pdfjs-dist");
  try {
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  } catch { /* falls back to inline parsing */ }
  const doc = await pdfjs.getDocument({ url: src }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    pages.push(pdfTextToMarkdown(await page.getTextContent()));
  }
  try { doc.destroy(); } catch { /* ignore */ }
  return pages;
}

const BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre";
/** One section's document as markdown-ish text: headings as `#` lines, every other block a paragraph. */
export function sectionToText(doc) {
  const body = doc?.body || doc?.documentElement;
  if (!body) return "";
  const out = [];
  for (const el of body.querySelectorAll(BLOCKS)) {
    if (el.parentElement?.closest?.(BLOCKS)) continue; // a <p> inside an <li> is read with the <li>
    // A <br> is a line break, not nothing: textContent would glue "October 15th<br>GIVE…" into one word.
    for (const br of el.querySelectorAll?.("br") || []) br.replaceWith(" ");
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const h = /^h([1-6])$/i.exec(el.tagName);
    out.push(h ? `${"#".repeat(Number(h[1]))} ${t}` : el.tagName === "LI" ? `- ${t}` : t);
  }
  return out.join("\n\n");
}

async function ebookSections(src) {
  const res = await fetch(src, { credentials: "include" });
  if (!res.ok) throw new Error(`the file could not be fetched (${res.status})`);
  const blob = await res.blob();
  const { makeBook } = await import("foliate-js/view.js");
  const book = await makeBook(new File([blob], "book"));
  const out = [];
  for (const section of book.sections || []) {
    if (typeof section.createDocument !== "function") { out.push(""); continue; }
    try { out.push(sectionToText(await section.createDocument())); } catch { out.push(""); }
  }
  return out;
}

export function filePages({ src, kind }) {
  const key = `${kind}|${src}`;
  if (!cache.has(key)) {
    const p = kind === "pdf" ? pdfPages(src) : kind === "ebook" ? ebookSections(src) : Promise.reject(new Error(`cannot read a ${kind || "file"} as text`));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key);
}

export async function readFileText({ src, kind, from = null, to = null, page = null, maxChars = 20000 }) {
  if (!src) throw new Error("no file to read");
  const pages = await filePages({ src, kind });
  if (!from && Number.isFinite(Number(page)) && Number(page) >= 1) {
    const t = pages[Number(page) - 1] || "";
    return { text: t.slice(0, maxChars), found: !!t };
  }
  return slicePassage(pages.join("\n\n"), { from, to, maxChars });
}
