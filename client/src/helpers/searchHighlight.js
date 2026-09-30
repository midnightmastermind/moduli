// helpers/searchHighlight.js
//
// WHICH PART OF A RESULT MATCHED. The search list marks the matched text so a
// row explains itself — and it was marking only the FIRST WORD: the component
// derived `firstTerm = query.split(/\s+/)[0]`, so typing "A Guide" lit up the
// bare "A" on every row (user, 2026-09-30: "the 'A' is only highlighted").
//
// THE PHRASE WINS WHEN IT IS THERE. "A Guide" against "A Guide to Recognizing
// Your Saints" is ONE run, not two words that happen to be adjacent — and it is
// also what keeps a one-letter term from lighting up every "a" in the label.
// Only when the phrase is absent does each term mark itself, which is the
// honest answer for a query like "saints 2006" whose words are far apart.
//
// The matcher (`occurrenceSearch.searchOccurrences`) is an AND over terms across
// the label, path, fields and body, so a term may have matched somewhere other
// than the label. A term that is not in this text simply marks nothing here —
// the row still shows its own "why" line for those.

// A pathological query ("a" against a long body) must not produce thousands of
// segments for React to render. The cap is on RANGES, before merging.
const MAX_RANGES = 60;

/** Every [start,end) of `needle` in `hay`, both already lowercased. */
function occurrences(hay, needle, out) {
  if (!needle) return;
  let at = hay.indexOf(needle);
  while (at >= 0 && out.length < MAX_RANGES) {
    out.push([at, at + needle.length]);
    at = hay.indexOf(needle, at + needle.length);
  }
}

/** Overlapping or touching ranges become one, so a merged run marks once. */
function mergeRanges(ranges) {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * Split `text` into segments for rendering.
 * @returns {{text: string, hit: boolean}[]} — always covers the whole string.
 */
export function highlightSegments(text, query) {
  const src = typeof text === "string" ? text : "";
  const phrase = String(query || "").toLowerCase().trim().replace(/\s+/g, " ");
  if (!src || !phrase) return [{ text: src, hit: false }];

  const hay = src.toLowerCase();
  const ranges = [];
  occurrences(hay, phrase, ranges);
  if (!ranges.length) {
    // No phrase — mark each term where it appears, so a multi-word query still
    // explains itself when its words are apart.
    for (const term of phrase.split(" ")) occurrences(hay, term, ranges);
  }
  if (!ranges.length) return [{ text: src, hit: false }];

  const segs = [];
  let cur = 0;
  for (const [a, b] of mergeRanges(ranges)) {
    if (a > cur) segs.push({ text: src.slice(cur, a), hit: false });
    segs.push({ text: src.slice(a, b), hit: true });
    cur = b;
  }
  if (cur < src.length) segs.push({ text: src.slice(cur), hit: false });
  return segs;
}
