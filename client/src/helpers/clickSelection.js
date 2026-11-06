// helpers/clickSelection.js — what a double or triple click selects in an editor whose caret the app places itself.
// Editor.jsx places the caret from the click point (Firefox puts none inside a draggable row), which also ran on the
// second press of a double-click and collapsed the word the browser had just selected. 2 clicks = the word, 3 or
// more = the whole line (the textblock), null when there is nothing to select (an atom, no word at that point).
import { wordRangeAt } from "./textLookup.js";

export function selectionForClicks(doc, pos, clicks) {
  if (!doc || clicks < 2) return null;
  let $p;
  try { $p = doc.resolve(pos); } catch { return null; }
  if (!$p.parent.isTextblock) return null;
  const start = $p.start();
  const end = $p.end();
  if (clicks >= 3) return end > start ? { from: start, to: end } : null;
  // One position per character or inline atom, so offsets map 1:1 (the right-click menu reads words the same way).
  const text = doc.textBetween(start, end, "\n", "￼");
  const r = wordRangeAt(text, pos - start);
  return r ? { from: start + r.from, to: start + r.to } : null;
}
