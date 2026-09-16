// utils/htmlEntities.js
//
// Decode the HTML entities that reach us as TEXT rather than as markup.
//
// WHY THIS IS SHARED. Two places need it and they were not agreeing: the
// markdown converter carried an inline `.replace` chain, and `titleFromHtml`
// carried none at all — so the reader headed the badgerherald article
// "exploring UW&#8217;s underground labyrinth &#8211; The Badger Herald",
// entities and all, and a bookmark saved from that page stored the same string
// as its LABEL. Measured across six live sites, 1 of 6 titles carries them.
//
// ORDER IS LOAD-BEARING: `&amp;` is decoded LAST. Decoding it first turns
// "&amp;lt;" — which is the literal text "&lt;" — into "<", i.e. it decodes a
// thing the author deliberately escaped.
//
// An entity this does not know is LEFT EXACTLY AS WRITTEN. A title is shown to
// the user and stored as a label; a wrong guess there is worse than a visible
// "&foo;", and the named set below is the one real pages actually use.
const NAMED = {
  nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…", middot: "·",
  deg: "°", trade: "™", copy: "©", reg: "®",
};

export function decodeEntities(text) {
  if (typeof text !== "string" || !text) return "";
  return text
    // Numeric, decimal and hex. An out-of-range code point is left alone
    // rather than thrown at String.fromCodePoint, which would take the caller
    // down over one bad character in a title.
    .replace(/&#(\d+);/g, (m, n) => cp(Number(n), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => cp(parseInt(h, 16), m))
    .replace(/&([a-z]+);/gi, (m, name) => {
      const hit = NAMED[name.toLowerCase()];
      return hit === undefined ? m : hit;
    })
    // `&nbsp;` decodes to a NO-BREAK space above; collapse it to an ordinary
    // one so a label does not carry an invisible character that breaks search.
    .replace(/ /g, " ")
    .replace(/&amp;/g, "&");
}

function cp(n, original) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return original;
  try { return String.fromCodePoint(n); } catch { return original; }
}
