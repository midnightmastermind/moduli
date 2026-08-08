// helpers/checklistFromText.js
//
// Text (typed, dropped, or OCR'd off a photo) → one checklist item per line.
//
// The intake plan calls the photo case "the highest-value thing in this whole
// document for a habit tracker": OCR already runs and already mints a textblock
// from an image, so splitting that blob into ITEMS instead of one paragraph is a
// small delta that turns a phone photo of a handwritten grocery list into a
// working checklist.
//
// ── WHY THE SPLIT IS THE PART WORTH TESTING ────────────────────────────────
//
// `text.split("\n")` is not the feature. A photo of handwriting OCRs into a mix
// of real items and debris — stray marks read as `.` or `|`, the ruled lines of
// a notepad, a header like "GROCERIES", checkbox glyphs, bullets in four
// different characters. Minting an instance per raw line produces a checklist
// the user has to clean up by hand, which is worse than the textblock they got
// before.
//
// So this file is a series of REFUSALS, and each one is a test.
//
// It is deliberately NOT smart: no spell-check, no merging wrapped lines, no
// guessing that "2 lb" belongs to the line below. Those need to know what the
// list is ABOUT, and being wrong there silently rewrites what the user wrote.
// Dropping obvious debris is safe; rewriting content is not.

// Bullets and checkbox glyphs, in the forms OCR actually produces.
// `[x]`/`[ ]` and `- [x]` are markdown; •◦○●▪·— are what a printed or
// handwritten bullet gets read as; `1.` / `1)` are numbered lists.
const LEADING_MARK = /^\s*(?:[-*+•◦○●▪·—–]\s*)?(?:\[\s*([xX✓✔])?\s*\]\s*)?(?:\d{1,3}[.)]\s+)?/;

// A line that is nothing but punctuation, rule marks, or a single stray
// character. Handwriting scans produce these constantly.
const DEBRIS = /^[\s\W_]*$/;

/** Cap on items from one blob. A bad scan can produce hundreds of junk lines. */
export const MAX_CHECKLIST_ITEMS = 100;

/**
 * @returns {{ items: Array<{label: string, checked: boolean}>, skipped: number, truncated: boolean }}
 *
 * `skipped` and `truncated` are returned rather than swallowed so the caller can
 * SAY what happened. A silent drop of half a shopping list is the kind of thing
 * that makes someone stop trusting the feature.
 */
export function splitToChecklistItems(text) {
  const raw = typeof text === "string" ? text : "";
  const lines = raw.split(/\r?\n/);

  const items = [];
  let skipped = 0;
  let truncated = false;

  for (const line of lines) {
    if (items.length >= MAX_CHECKLIST_ITEMS) { truncated = true; break; }

    const mark = LEADING_MARK.exec(line);
    const checked = !!(mark && mark[1]);
    let label = line.slice(mark ? mark[0].length : 0);

    // Collapse internal runs of whitespace — OCR spaces words unevenly and a
    // label with a five-space gap looks broken in a row.
    label = label.replace(/\s+/g, " ").trim();

    if (!label) continue;                 // blank line — not debris, just empty
    if (DEBRIS.test(label)) { skipped++; continue; }
    // A single character is a stray mark far more often than an item. Two is
    // the shortest real thing on a grocery list ("Ox", "AA").
    if (label.length < 2) { skipped++; continue; }

    items.push({ label, checked });
  }

  return { items, skipped, truncated };
}
