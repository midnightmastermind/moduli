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
const boxHeight = (line) => {
  const b = line?.bbox;
  return b ? Math.max(0, b.y1 - b.y0) : 0;
};
const height = (line) => {
  const row = Number(line?.rowAttributes?.rowHeight);
  if (row > 0) return row;
  return boxHeight(line);
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

// PARAGRAPHS FROM THE PAGE'S OWN GAPS. tesseract groups lines by position and gets both directions wrong: it
// puts a title, prose and the next sub-heading into ONE paragraph, and it splits one sentence across two
// paragraphs ("...sciences," / "arts, and religions." with a 3px gap between them). So lines are judged
// against the page's own rhythm: the median gap between lines and the median line height.
const SIZE_JUMP = 1.25;
const BOX_CORROBORATES = 1.15;
const GAP_FACTOR = 1.6;      // a gap > 1.6 x the page's median line gap ...
const GAP_MIN_HEIGHTS = 0.6; // ... and > 0.6 x the median line height is a paragraph break
const SHORT_LINE = 0.7;      // a sentence-ending line shorter than 70% of the block's median width ends a paragraph

const OPEN_Q = /^["“‘]/;
const CLOSE_Q = /["”’]$/;
const DASH_LEAD = /^[—–-]\s*/;

const lineOf = (l) => ({
  text: clean(l.text), h: height(l), bh: boxHeight(l),
  x0: l.bbox?.x0, x1: l.bbox?.x1, y0: l.bbox?.y0, y1: l.bbox?.y1,
});
const width = (l) => (l.x0 != null && l.x1 != null ? l.x1 - l.x0 : 0);

/** The lines of one block, in reading order, each tagged with the tesseract paragraph it came from. */
function blockLines(block, keepPara) {
  const out = [];
  (block?.paragraphs || []).forEach((p, pi) => {
    const lines = (p.lines || []).map(lineOf).filter((l) => l.text);
    if (!lines.length) return;
    if (!keepPara(p, lines)) return;
    for (const l of lines) out.push({ ...l, pi, confidence: p.confidence ?? null });
  });
  return out;
}

function pageRhythm(blocks) {
  const gaps = [];
  const heights = [];
  for (const b of blocks) {
    for (const p of b?.paragraphs || []) {
      const ls = (p.lines || []).map(lineOf).filter((l) => l.text);
      ls.forEach((l, i) => {
        if (l.h > 0) heights.push(l.h);
        const prev = ls[i - 1];
        if (prev && l.y0 != null && prev.y1 != null) gaps.push(Math.max(0, l.y0 - prev.y1));
      });
    }
  }
  gaps.sort((a, b) => a - b);
  const m = Math.floor(gaps.length / 2);
  const g = !gaps.length ? 0 : gaps.length % 2 ? gaps[m] : (gaps[m - 1] + gaps[m]) / 2;
  return { gap: g, height: median(heights) };
}

const startsCapital = (t) => /^["“‘(]?[A-Z]/.test(t);
const startsLower = (t) => /^[a-z]/.test(t);

function splitBlock(lines, rhythm) {
  if (!lines.length) return [];
  const medW = median(lines.map(width));
  const charW = median(lines.map((l) => (width(l) > 0 ? width(l) / Math.max(1, l.text.length) : 0)));
  const gapLimit = Math.max(GAP_FACTOR * rhythm.gap, GAP_MIN_HEIGHTS * rhythm.height);
  const runs = [];
  let run = [];
  for (const l of lines) {
    const prev = run[run.length - 1];
    if (prev) {
      const ratio = l.h > 0 && prev.h > 0 ? Math.max(l.h, prev.h) / Math.min(l.h, prev.h) : 1;
      const gap = l.y0 != null && prev.y1 != null ? l.y0 - prev.y1 : 0;
      const sameLeft = l.x0 != null && prev.x0 != null && Math.abs(l.x0 - prev.x0) <= Math.max(charW, 1);
      // tesseract's rowHeight is sometimes simply wrong for one line (14.5px on a line whose box is 19px among
      // 20px neighbours, on the Gnosis card), so a size jump needs the boxes to bear it out a little too.
      const boxRatio = l.bh > 0 && prev.bh > 0 ? Math.max(l.bh, prev.bh) / Math.min(l.bh, prev.bh) : 1;
      const sizeJump = ratio >= SIZE_JUMP && boxRatio >= BOX_CORROBORATES;
      const bigGap = gapLimit > 0 && gap > gapLimit;
      let split;
      if (prev.pi !== l.pi) {
        // tesseract's own boundary stands, unless it cut one sentence in two: the line above runs on
        // (no full stop, no colon), the next starts lower case, and only ordinary line spacing lies between.
        split = sizeJump || bigGap || !startsLower(l.text) || /[.?!:]["”’]?$/.test(prev.text);
      } else {
        split = sizeJump || bigGap;
        if (!split && startsCapital(l.text) && sameLeft) {
          // A line that closes a thought, then a capital at the block's left edge: the next paragraph.
          // A colon is stronger than a full stop ("can refer to:" then the things), so width is not asked.
          if (/:$/.test(prev.text)) split = true;
          else if (/[.?!]["”’]?$/.test(prev.text) && medW > 0 && width(prev) < SHORT_LINE * medW) split = true;
        }
      }
      if (split) { runs.push(run); run = []; }
    }
    run.push(l);
  }
  if (run.length) runs.push(run);
  return runs;
}

// Opening quote ... closing quote, or lines centred on the text column.
function isQuoteRun(run, extent) {
  const text = joinLines(run.map((l) => l.text));
  if (OPEN_Q.test(text) && (CLOSE_Q.test(text) || splitAttribution(text).attribution)) return true;
  // Centred lines (a lone centred line is just a title, so it takes two).
  if (run.length < 2 || !extent || extent.w <= 0) return false;
  return run.every((l) => {
    if (l.x0 == null || l.x1 == null) return false;
    const left = l.x0 - extent.x0;
    const right = extent.x1 - l.x1;
    return left > 0.1 * extent.w && right > 0.1 * extent.w && Math.abs(left - right) <= 0.15 * extent.w;
  });
}

// "“I know! | don't need to believe.” C. G. Jung" -> the quote and "C. G. Jung".
const NAME = /(?:[A-Z][\w'’.-]*\.?)(?:\s+[A-Z][\w'’.-]*\.?){0,4}/;
const TRAILING_ATTRIBUTION = new RegExp(`^(.*?[”"’])\\s*[—–-]?\\s*(${NAME.source})$`);
function splitAttribution(text) {
  const m = TRAILING_ATTRIBUTION.exec(text);
  if (m && OPEN_Q.test(m[1])) return { quote: m[1], attribution: m[2] };
  return { quote: text, attribution: null };
}
const asAttribution = (text) => {
  const t = text.trim();
  const words = t.split(/\s+/);
  if (!t || words.length > 6) return null;
  if (DASH_LEAD.test(t)) return t.replace(DASH_LEAD, "").trim() || null;
  return new RegExp(`^${NAME.source}$`).test(t) ? t : null;
};

/**
 * The paragraphs tesseract found, regrouped by the page's own gaps, each classified:
 *   { lines, h, confidence, kind: "heading"|"para"|"list"|"quote", level?, attribution? }
 */
export function ocrParagraphs(page) {
  const blocks = page?.blocks || [];
  const rhythm = pageRhythm(blocks);
  const keepPara = (p, lines) => {
    const alnum = lines.map((l) => l.text).join("").replace(/[^A-Za-z0-9]/g, "").length;
    // Noise: a speck read as a character or two, with no confidence behind it.
    return !(alnum < 2 && (p.confidence ?? 100) < 60);
  };
  const paragraphs = [];
  const bodyHs = [];
  for (const block of blocks) {
    const lines = blockLines(block, keepPara);
    const runs = splitBlock(lines, rhythm);
    let ext = null;
    const xs = lines.filter((l) => l.x0 != null && l.x1 != null);
    if (xs.length) ext = { x0: Math.min(...xs.map((l) => l.x0)), x1: Math.max(...xs.map((l) => l.x1)) };
    if (ext) ext.w = ext.x1 - ext.x0;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const para = { lines: run, h: median(run.map((l) => l.h)), confidence: run[0].confidence, kind: "para" };
      if (BULLET.test(run[0].text)) para.kind = "list";
      else if (run.length <= 6 && isQuoteRun(run, ext)) {
        para.kind = "quote";
        const { attribution } = splitAttribution(joinLines(run.map((l) => l.text)));
        if (attribution) para.attribution = attribution;
        else if (runs[i + 1] && runs[i + 1].length === 1 && asAttribution(runs[i + 1][0].text)) {
          para.attribution = asAttribution(runs[i + 1][0].text);
          i++;
        }
      }
      paragraphs.push(para);
      bodyHs.push(...run.map((l) => l.h));
    }
  }
  const body = median(bodyHs);
  for (const p of paragraphs) {
    if (p.kind !== "para" || body <= 0 || p.lines.length > 3) continue;
    const text = joinLines(p.lines.map((l) => l.text));
    const words = text.split(" ").length;
    const ratio = p.h / body;
    const shouty = words <= 8 && /[A-Z]/.test(text) && text === text.toUpperCase();
    if (ratio >= 1.6) { p.kind = "heading"; p.level = 1; }
    else if (ratio >= 1.25) { p.kind = "heading"; p.level = 2; }
    else if (p.lines.length === 1 && words <= 8 && (shouty || /:$/.test(text))) { p.kind = "heading"; p.level = 3; }
  }
  return { paragraphs };
}

/** The only rule-level character fix: a standalone `|` between word characters or spaces is a capital I. */
export function fixOcrCharacters(text) {
  return String(text ?? "").replace(/(?<=\s)\|(?=\s)/g, "I");
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
  let paras = ocrParagraphs(page).paragraphs;
  if (!paras.length) paras = paragraphsFromText(page?.text).map((p) => ({ ...p, kind: "para" }));
  if (!paras.length) return "";
  const out = [];
  let prevWasList = false;
  const textOf = (ls) => fixOcrCharacters(joinLines(ls));
  for (const p of paras) {
    const texts = p.lines.map((l) => fixOcrCharacters(l.text));
    // Lists: a paragraph whose lines start with bullets is a list, one item per bullet; a wrapped
    // continuation line joins the item above it.
    if (p.kind === "list" || BULLET.test(texts[0])) {
      // tesseract often gives each bullet its own paragraph; consecutive ones are ONE list. Magic only:
      // Reader's single textblock reads a single newline as a space, so there each item keeps its own line.
      if (mode === "magic" && prevWasList && out[out.length - 1] === "") out.pop();
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
        if (mode !== "magic") out.push("");
      }
      out.push("");
      continue;
    }
    prevWasList = false;
    const text = textOf(texts);
    if (p.kind === "quote") {
      const { quote } = splitAttribution(text);
      out.push(`> ${quote}`);
      if (p.attribution) out.push(`> — ${fixOcrCharacters(p.attribution)}`);
      out.push("");
      continue;
    }
    if (mode === "magic" && p.kind === "heading") {
      out.push(`${"#".repeat(p.level)} ${p.level === 3 ? text.replace(/:$/, "") : text}`, "");
      continue;
    }
    out.push(escapeLead(text), "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
