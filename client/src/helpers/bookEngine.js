// helpers/bookEngine.js
//
// The pure half of the book reader (modules/BookReader.jsx): which engine opens a file, whether a
// Kindle file is DRM-locked, a PDF page's text as markdown, the visible part of an e-book page as
// HTML, and the reading position as it is stored on the book's module (`meta.readingPosition`).
//
// No DOM work beyond a Range the caller hands in, so all of it is testable without a browser.

/** "ebook" (foliate-js: epub / mobi / azw / azw3), "pdf" (pdf.js) or null (not a book file). */
export function bookEngineFor(kind) {
  if (kind === "ebook") return "ebook";
  if (kind === "pdf") return "pdf";
  return null;
}

const readU16 = (b, o) => (b[o] << 8) | b[o + 1];
const readU32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/**
 * Whether a MOBI-family file (mobi / azw / azw3) is DRM-locked, read from its header.
 *
 *   PDB header   bytes 60..68 = "BOOKMOBI", 76..78 = record count, then 8 bytes per record whose
 *                first 4 are the record's offset
 *   record 0     the PalmDOC header; bytes 12..14 are its encryption field (0 = none,
 *                1 = old Mobipocket, 2 = Mobipocket/Kindle DRM)
 *
 * `bytes` is the start of the file (a Uint8Array or ArrayBuffer) — it needs to reach record 0's
 * offset + 14, which for a real book is a few hundred bytes. Returns "locked", "open", or
 * "not-mobi" (an EPUB, a PDF, or a file too short to tell).
 */
export function mobiDrmStatus(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  if (b.length < 86) return "not-mobi";
  const magic = String.fromCharCode(...b.slice(60, 68));
  if (magic !== "BOOKMOBI") return "not-mobi";
  const numRecords = readU16(b, 76);
  if (numRecords < 1) return "not-mobi";
  const rec0 = readU32(b, 78);
  if (rec0 + 14 > b.length) return "not-mobi";
  return readU16(b, rec0 + 12) === 0 ? "open" : "locked";
}

/**
 * A PDF page's text (pdf.js `getTextContent()`) as markdown paragraphs. pdf.js hands the page back
 * as positioned runs; `hasEOL` marks the end of a visual line. A line that ends a sentence and is
 * followed by a gap reads as a paragraph break; otherwise lines are joined with a space, so a
 * paragraph that wraps across lines comes back as one paragraph.
 */
export function pdfTextToMarkdown(textContent) {
  const items = Array.isArray(textContent?.items) ? textContent.items : [];
  const lines = [];
  let cur = "";
  let lastY = null;
  let lastH = 0;
  const gaps = [];
  for (const it of items) {
    if (typeof it?.str !== "string") continue;
    const y = Array.isArray(it.transform) ? it.transform[5] : null;
    cur += it.str;
    if (it.hasEOL) {
      lines.push({ text: cur.trim(), y: y ?? lastY, h: it.height || lastH });
      cur = "";
    }
    if (y != null) lastY = y;
    if (it.height) lastH = it.height;
  }
  if (cur.trim()) lines.push({ text: cur.trim(), y: lastY, h: lastH });
  const kept = lines.filter((l) => l.text);
  for (let i = 1; i < kept.length; i++) {
    const a = kept[i - 1], c = kept[i];
    gaps.push(a.y != null && c.y != null ? Math.abs(a.y - c.y) : null);
  }
  const known = gaps.filter((g) => g != null).sort((x, y) => x - y);
  const typical = known.length ? known[Math.floor(known.length / 2)] : null;
  const paras = [];
  let para = "";
  kept.forEach((l, i) => {
    para = para ? `${para.endsWith("-") ? para.slice(0, -1) : `${para} `}${l.text}` : l.text;
    const gap = gaps[i];
    const wide = gap != null && typical != null && gap > typical * 1.4;
    if (i === kept.length - 1 || wide) { paras.push(para); para = ""; }
  });
  return paras.join("\n\n");
}

/** The visible part of an e-book page (a DOM Range from foliate's `relocate` event) as HTML. */
export function rangeToHtml(range) {
  if (!range || typeof range.cloneContents !== "function") return "";
  const frag = range.cloneContents();
  const doc = range.startContainer?.ownerDocument || document;
  const div = doc.createElement("div");
  div.appendChild(frag);
  return div.innerHTML.trim();
}

/** Strip tags to see whether a page holds any words at all (a cover page is often just an image). */
export function htmlHasText(html) {
  return typeof html === "string" && /\S/.test(html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " "));
}

/** The position as stored: `{ cfi, fraction, at }` for an e-book, `{ page, fraction, at }` for a PDF. */
export function makeReadingPosition({ cfi, page, fraction, now = Date.now() }) {
  const pos = { at: new Date(now).toISOString() };
  if (cfi) pos.cfi = cfi;
  if (Number.isFinite(page)) pos.page = page;
  if (Number.isFinite(fraction)) pos.fraction = Math.max(0, Math.min(1, fraction));
  return pos;
}

/** Whether two positions name the same place (so an unchanged one is not written again). */
export function samePosition(a, b) {
  if (!a || !b) return false;
  return (a.cfi || null) === (b.cfi || null) && (a.page ?? null) === (b.page ?? null);
}

/** "Book title — p. 12" / "Book title — 34%", the label of a saved page. */
export function positionLabel(title, pos) {
  const t = title || "Book";
  if (Number.isFinite(pos?.page)) return `${t} — p. ${pos.page}`;
  if (Number.isFinite(pos?.fraction)) return `${t} — ${Math.round(pos.fraction * 100)}%`;
  return t;
}
