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
  let ranges = [];
  occurrences(hay, phrase, ranges);
  // A MULTI-WORD PHRASE MUST START ON A WORD BOUNDARY. "A Guide" occurs inside
  // "Mang|a Guide| to Physics" — true, and it reads as a mistake. With no
  // boundary match the phrase is treated as absent and each term marks itself
  // instead, which on that row is simply "Guide".
  //
  // Scoped to MULTI-WORD only, because a single word is how partial typing
  // works: "uide" has no boundary match on "A Guide" and must still mark.
  if (ranges.length && phrase.includes(" ")) {
    ranges = ranges.filter(([a]) => a === 0 || !/[\p{L}\p{N}]/u.test(src[a - 1]));
  }
  if (!ranges.length) {
    // No phrase — mark each term where it appears, so a multi-word query still
    // explains itself when its words are apart ("saints 2006").
    //
    // A ONE-LETTER TERM IS SKIPPED HERE, and that is not tidiness: measured on
    // prod, "A Guide" against "An FBI agents guide to Mental Toughness" marked
    // ["A","a","guide","a"] — the row lit up like static and said less about
    // why it matched than marking "guide" alone. It still marks when the whole
    // query is short, because then there is nothing else to show.
    const terms = phrase.split(" ");
    const worth = terms.filter((t) => t.length > 1);
    for (const term of (worth.length ? worth : terms)) occurrences(hay, term, ranges);
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
