// Scoring for the import eval set. PURE. Every part is 0..1; a part whose expectation is absent is
// omitted from `parts` and from the average.

const strip = (t) =>
  String(t || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>)\s?/gm, "")
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_`~\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const words = (t) => strip(t).toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
const norm = (t) => words(t).join(" ");

/** Split markdown into blocks: `{ type: "heading"|"quote"|"para", text }`. */
export function parseBlocks(md) {
  return String(md || "")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => {
      const lines = b.split("\n");
      if (/^#{1,6}\s/.test(lines[0])) return { type: "heading", text: strip(lines[0]) };
      if (lines.every((l) => /^\s*>/.test(l))) return { type: "quote", text: strip(b) };
      return { type: "para", text: strip(b) };
    });
}

function lev(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
const sim = (a, b) => {
  const x = norm(a), y = norm(b);
  const m = Math.max(x.length, y.length);
  return m ? 1 - lev(x, y) / m : 1;
};
const f1 = (matched, nExp, nAct) => {
  if (!nExp && !nAct) return 1;
  if (!matched) return 0;
  const p = matched / nAct, r = matched / nExp;
  return (2 * p * r) / (p + r);
};
// greedy one-to-one match of two lists by similarity >= threshold
const matchCount = (exp, act, ok) => {
  const used = new Set();
  let n = 0;
  for (const e of exp) {
    const i = act.findIndex((a, k) => !used.has(k) && ok(e, a));
    if (i >= 0) { used.add(i); n++; }
  }
  return n;
};

function starts(blocks) {
  let off = 0;
  const out = [];
  for (const b of blocks) {
    out.push(off);
    off += words(b.text).length;
  }
  return out;
}

export function scoreCase({ expectedMd, expectedMeta = {}, actualMd, actualMeta = {} }) {
  const parts = {};
  const eb = parseBlocks(expectedMd), ab = parseBlocks(actualMd);

  // paragraph boundaries: start word offsets, F1 with a 2-word tolerance (OCR drops/adds a word or two)
  const es = starts(eb), as = starts(ab);
  parts.paragraphs = f1(matchCount(es, as, (e, a) => Math.abs(e - a) <= 2), es.length, as.length);

  const eh = eb.filter((b) => b.type === "heading"), ah = ab.filter((b) => b.type === "heading");
  if (eh.length) parts.headings = f1(matchCount(eh, ah, (e, a) => sim(e.text, a.text) >= 0.8), eh.length, ah.length);

  const eq = eb.filter((b) => b.type === "quote"), aq = ab.filter((b) => b.type === "quote");
  if (eq.length) parts.quotes = f1(matchCount(eq, aq, (e, a) => sim(e.text, a.text) >= 0.8), eq.length, aq.length);

  if (expectedMeta.title) parts.title = sim(expectedMeta.title, actualMeta.title || "");
  if (expectedMeta.imageKept !== undefined) {
    parts.imageKept = (actualMeta.images?.length > 0) === !!expectedMeta.imageKept ? 1 : 0;
  }
  if (expectedMeta.board) parts.board = actualMeta.board === expectedMeta.board ? 1 : 0;

  const ce = strip(expectedMd), ca = strip(actualMd), cm = Math.max(ce.length, ca.length);
  parts.chars = cm ? 1 - lev(ce, ca) / cm : 1;

  const vals = Object.values(parts);
  return { total: vals.reduce((s, v) => s + v, 0) / vals.length, parts };
}
