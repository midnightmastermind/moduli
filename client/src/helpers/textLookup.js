// helpers/textLookup.js
// ============================================================
// Look a piece of text up: the word under the caret, spelling suggestions,
// a dictionary definition and a Wikipedia search. Used by the text right-click
// menus (the doc editor's and `ui/TextContextMenu`'s) so both offer the same
// things the way Windows / Edge do (user 2026-10-17: "wikipedia search,
// dictionary search, and spelling correct in the right click menu").
//
// WHY WEB SERVICES and not the browser's own spellcheck: the browser's squiggle
// and its suggestions are not readable from a page — there is no API for them.
// So suggestions come from Datamuse ("spelled like", free, no key, CORS-open)
// and definitions from dictionaryapi.dev (same). Both are asked only when the
// menu opens on a word, and answers are cached for the session.
// ============================================================

const WORD_CHAR = /[\p{L}\p{M}'’-]/u;

/** `{ from, to, word }` of the word around `offset` in `text` (inside or right after it), or null. */
export function wordRangeAt(text, offset) {
  const s = String(text ?? "");
  let i = Math.max(0, Math.min(Number(offset) || 0, s.length));
  if (i > 0 && !WORD_CHAR.test(s[i] || "") && WORD_CHAR.test(s[i - 1])) i -= 1;
  if (!WORD_CHAR.test(s[i] || "")) return null;
  let a = i, b = i;
  while (a > 0 && WORD_CHAR.test(s[a - 1])) a -= 1;
  while (b < s.length && WORD_CHAR.test(s[b])) b += 1;
  while (a < b && /['’-]/.test(s[a])) a += 1;
  while (b > a && /['’-]/.test(s[b - 1])) b -= 1;
  return a < b ? { from: a, to: b, word: s.slice(a, b) } : null;
}

/** The word around `offset` in `text`, or "". */
export function wordAt(text, offset) {
  return wordRangeAt(text, offset)?.word || "";
}

/** What the lookup items act on: the selection (trimmed, one line) or the word. */
export function lookupTerm(selectedText, word) {
  const sel = String(selectedText ?? "").replace(/\s+/g, " ").trim();
  if (sel) return sel.length > 80 ? `${sel.slice(0, 77)}…` : sel;
  return String(word ?? "").trim();
}

/** A word worth spell-checking: letters only, 2+ characters, not ALL CAPS (acronyms). */
export function isCheckableWord(word) {
  const w = String(word ?? "");
  if (w.length < 2 || w.length > 40) return false;
  if (!/^[\p{L}'’-]+$/u.test(w)) return false;
  if (w.length > 1 && w === w.toUpperCase()) return false;
  return true;
}

export function wikipediaSearchUrl(term) {
  return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(term)}`;
}

export function dictionaryUrl(word) {
  return `https://en.wiktionary.org/wiki/${encodeURIComponent(String(word).toLowerCase())}`;
}

const IGNORE_KEY = "moduli-spell-ignore";
function ignored() {
  try { return new Set(JSON.parse(localStorage.getItem(IGNORE_KEY) || "[]")); } catch { return new Set(); }
}
/** "Ignore" in the menu: this word is never offered corrections again (this browser). */
export function ignoreSpelling(word) {
  try {
    const s = ignored(); s.add(String(word).toLowerCase());
    localStorage.setItem(IGNORE_KEY, JSON.stringify([...s].slice(-500)));
  } catch { /* storage is a courtesy */ }
}

/**
 * PURE: Datamuse "spelled like" results → `{ misspelled, suggestions }`.
 * A word Datamuse returns as itself is spelled right. Suggestions keep the
 * word's capitalisation ("Teh" → "The").
 */
export function readSpelling(word, results, max = 5) {
  const w = String(word);
  const lower = w.toLowerCase();
  const list = (Array.isArray(results) ? results : []).map((r) => String(r?.word || "")).filter(Boolean);
  if (list.some((x) => x.toLowerCase() === lower)) return { misspelled: false, suggestions: [] };
  const cap = w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase();
  const out = [];
  for (const s of list) {
    if (/\s/.test(s)) continue;
    const v = cap ? s[0].toUpperCase() + s.slice(1) : s;
    if (!out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return { misspelled: true, suggestions: out };
}

const spellCache = new Map();
/**
 * `{ misspelled, suggestions }` for a word, or null when it cannot be checked
 * (offline, not a word, ignored). Never throws.
 */
export async function spellingSuggestions(word, fetchImpl = globalThis.fetch) {
  if (!isCheckableWord(word)) return null;
  const key = String(word).toLowerCase();
  if (ignored().has(key)) return null;
  if (spellCache.has(key)) return spellCache.get(key);
  try {
    const res = await fetchImpl(`https://api.datamuse.com/words?sp=${encodeURIComponent(key)}&max=8`);
    if (!res.ok) return null;
    const out = readSpelling(word, await res.json());
    spellCache.set(key, out);
    return out;
  } catch {
    return null;
  }
}

/** PURE: dictionaryapi.dev entries → up to `max` "(part) definition" lines. */
export function readDefinitions(entries, max = 3) {
  const lines = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    for (const m of e?.meanings || []) {
      for (const d of m?.definitions || []) {
        if (d?.definition) lines.push(`(${m.partOfSpeech || "?"}) ${d.definition}`);
        if (lines.length >= max) return lines;
      }
    }
  }
  return lines;
}

/**
 * PURE: forms to try after `word` itself, singular first — the dictionary has no
 * plurals ("religions" is a 404, "religion" is not).
 */
export function singularCandidates(word) {
  const w = String(word ?? "").toLowerCase();
  const out = [];
  if (/ies$/.test(w) && w.length > 4) out.push(w.slice(0, -3) + "y");
  if (/(s|x|z|ch|sh)es$/.test(w)) out.push(w.slice(0, -2));
  if (/s$/.test(w) && !/ss$/.test(w) && w.length > 3) out.push(w.slice(0, -1));
  return [...new Set(out)].filter((c) => c && c !== w);
}

/** Definition lines for a word ([] when none / offline); tries its singular too. */
export async function defineWord(word, fetchImpl = globalThis.fetch) {
  const w = String(word ?? "").trim();
  if (!w || /\s/.test(w)) return [];
  for (const form of [w.toLowerCase(), ...singularCandidates(w)]) {
    try {
      const res = await fetchImpl(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(form)}`);
      if (!res.ok) continue;
      const lines = readDefinitions(await res.json());
      if (lines.length) return lines;
    } catch {
      // A browser reports the dictionary's 404 as a network error (no CORS header on it),
      // so an error moves on to the next form rather than giving up.
      continue;
    }
  }
  return [];
}
