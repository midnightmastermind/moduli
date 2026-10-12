// helpers/ocrLayout.js
//
// OCR READER and OCR MAGIC (user, 2026-10-12): an image gets the same two text views a web page has in the
// browser — Reader (the words as one textblock) and Magic (a doc of nested containers and textblocks, like
// the Wikipedia import). Both go through the SAME planner the browser uses (`import_plan`, shape reader /
// magic), so this file only has to turn what tesseract SAW into markdown. PURE.
//
// tesseract's page is blocks → paragraphs → lines, each with a pixel box. Plain `data.text` loses two
// things a reader needs: where a paragraph ends (it breaks every visual line) and which lines are
// headings. Magic recovers headings from LINE HEIGHT — a line clearly taller than the body text is a
// heading — and lists from leading bullets. Reader keeps paragraphs and drops the line breaks inside them.

const BULLET = /^\s*([•·▪◦‣⁃●○■□*-]|\(?\d{1,2}[.)])\s+/;
const NUMBERED = /^\s*\(?(\d{1,2})[.)]\s+/;

// A line's SIZE is tesseract's rowHeight (the font's row, ascenders to descenders), not its bounding box:
// the box of a line with no descenders is ~25% shorter ("near the boat house." 18px vs 23px on the same
// 24px type), which reads as a size change. The box is the fallback when rowHeight is missing.
const height = (line) => {
  const row = Number(line?.rowAttributes?.rowHeight);
  if (row > 0) return row;
  const b = line?.bbox;
  const h = b ? b.y1 - b.y0 : 0;
  return h > 0 ? h : 0;
};
const median = (xs) => {
  const s = xs.filter((x) => x > 0).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();
// A line that starts with markdown syntax OCR happened to read ("# 1", "> quote", "| a |") stays text.
const escapeLead = (t) => t.replace(/^([#>|])/, "\\$1");

/** Join a paragraph's lines into prose: a word hyphenated across a line break is mended. */
export function joinLines(lines) {
  let out = "";
  for (const raw of lines) {
    const l = clean(raw);
    if (!l) continue;
    if (!out) out = l;
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(l)) out = out.slice(0, -1) + l;
    else out = `${out} ${l}`;
  }
  return out;
}

// tesseract groups lines into paragraphs by position, and it happily puts a big title, the prose under it
// and the next sub-heading into ONE paragraph (measured on a plain picnic flyer). A change of line height,
// or a gap wider than a line, is the layout saying "new block" — so a paragraph is split there.
const SIZE_JUMP = 1.25;
const GAP_LINES = 1.2;
function splitAtLayoutBreaks(lines) {
  const runs = [];
  let run = [];
  for (const l of lines) {
    const prev = run[run.length - 1];
    if (prev) {
      const ratio = l.h > 0 && prev.h > 0 ? Math.max(l.h, prev.h) / Math.min(l.h, prev.h) : 1;
      const gap = l.y0 != null && prev.y1 != null ? l.y0 - prev.y1 : 0;
      // Against the TALLER line: a line with no descenders ("near the boat house.") is short, and measuring
      // against it reads ordinary line spacing as a paragraph gap.
      const unit = Math.max(l.h || 0, prev.h || 0);
      if (ratio >= SIZE_JUMP || (unit > 0 && gap > unit * GAP_LINES)) { runs.push(run); run = []; }
    }
    run.push(l);
  }
  if (run.length) runs.push(run);
  return runs;
}

/** The paragraphs tesseract found, flattened and split at layout breaks, with what Magic needs to classify them. */
export function ocrParagraphs(page) {
  const out = [];
  for (const block of page?.blocks || []) {
    for (const p of block?.paragraphs || []) {
      const lines = (p.lines || []).map((l) => ({ text: clean(l.text), h: height(l), y0: l.bbox?.y0, y1: l.bbox?.y1 })).filter((l) => l.text);
      if (!lines.length) continue;
      const alnum = lines.map((l) => l.text).join("").replace(/[^A-Za-z0-9]/g, "").length;
      // Noise: a speck read as a character or two, with no confidence behind it.
      if (alnum < 2 && (p.confidence ?? 100) < 60) continue;
      for (const run of splitAtLayoutBreaks(lines)) {
        out.push({ lines: run, h: median(run.map((l) => l.h)), confidence: p.confidence ?? null });
      }
    }
  }
  return out;
}

/** Fallback when tesseract returned no layout: paragraphs are separated by blank lines in its text. */
const paragraphsFromText = (text) => String(text || "").split(/\n\s*\n/)
  .map((chunk) => ({ lines: chunk.split("\n").map((t) => ({ text: clean(t), h: 0 })).filter((l) => l.text), h: 0 }))
  .filter((p) => p.lines.length);

/**
 * PURE. Markdown for an OCR result.
 *   mode "reader" — paragraphs of prose (bullets kept as their own lines); the planner makes ONE textblock.
 *   mode "magic"  — the same, plus headings by line height and lists by bullets; the planner makes a tree.
 * `page` is tesseract's `data` ({ text, blocks }).
 */
export function ocrToMarkdown(page, { mode = "reader" } = {}) {
  let paras = ocrParagraphs(page);
  if (!paras.length) paras = paragraphsFromText(page?.text);
  if (!paras.length) return "";
  const body = median(paras.flatMap((p) => p.lines.map((l) => l.h)));
  const out = [];
  let prevWasList = false;
  for (const p of paras) {
    const texts = p.lines.map((l) => l.text);
    // Lists: a paragraph whose lines start with bullets is a list, one item per bullet; a wrapped
    // continuation line joins the item above it.
    if (BULLET.test(texts[0])) {
      // tesseract often gives each bullet its own paragraph; consecutive ones are ONE list.
      if (prevWasList && out[out.length - 1] === "") out.pop();
      prevWasList = true;
      const items = [];
      for (const t of texts) {
        if (BULLET.test(t) || !items.length) items.push([t]);
        else items[items.length - 1].push(t);
      }
      for (const it of items) {
        const first = it[0];
        const num = NUMBERED.exec(first);
        const text = joinLines([first.replace(BULLET, ""), ...it.slice(1)]);
        out.push(mode === "magic" ? `${num ? `${num[1]}.` : "-"} ${escapeLead(text)}` : escapeLead(`${num ? `${num[1]}.` : "•"} ${text}`));
      }
      out.push("");
      continue;
    }
    prevWasList = false;
    const text = joinLines(texts);
    if (mode === "magic" && body > 0 && p.lines.length <= 3) {
      const ratio = p.h / body;
      const words = text.split(" ").length;
      const shouty = words <= 8 && /[A-Z]/.test(text) && text === text.toUpperCase();
      if (ratio >= 1.6) { out.push(`# ${text}`, ""); continue; }
      if (ratio >= 1.25) { out.push(`## ${text}`, ""); continue; }
      if (p.lines.length === 1 && words <= 8 && (shouty || /:$/.test(text))) { out.push(`### ${text.replace(/:$/, "")}`, ""); continue; }
    }
    out.push(escapeLead(text), "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
