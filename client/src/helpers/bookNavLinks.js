// helpers/bookNavLinks.js
//
// Many e-books carry their own "Previous | Next" links at the top or bottom of every chapter —
// left over from the web page they were made from. The reader already turns pages, so these are
// noise (user, 2026-10-18: "remove the previous and next buttons embeded in the epub").
//
// They are taken out of the page AS IT LOADS in the reader. The book file is never changed, so
// this covers every book, a new upload included, and nothing is lost if a rule is too eager.
//
// What counts, deliberately narrow — a book's own words must never vanish:
//   - a link (or button) whose whole text is a page-turn word: previous / prev / next / back /
//     forward, optionally "page|chapter|section|part", or only arrows (« » ‹ › ← → < > << >>);
//   - "contents" / "table of contents" / "top" / "home" / "index" ONLY beside one of those, so a
//     contents page's own entries and an index heading are left alone;
//   - a link to another site is never touched (that is the author's link, not navigation).
// A block left holding nothing but separators (| · • - [ ]) once its links are gone goes too.

const SEP_CHAR = "[\\s|·•\\-–—\\[\\]()«»‹›<>←→:]";
const SEP = `${SEP_CHAR}*`;
const TURN = new RegExp(`^${SEP}(?:(?:go\\s+to\\s+)?(?:the\\s+)?(?:previous|prev\\.?|next|back|forward)(?:\\s+(?:page|chapter|section|part))?)?${SEP}$`, "i");
const BESIDE = new RegExp(`^${SEP}(?:(?:table\\s+of\\s+)?contents|toc|top|back\\s+to\\s+top|home|index|up)${SEP}$`, "i");
const LINKS = "a, button, input[type=button], input[type=submit], [role=link], [role=button]";
const BLOCKS = new Set(["P", "DIV", "NAV", "CENTER", "SPAN", "TD", "TR", "TABLE", "TBODY", "UL", "OL", "LI", "SECTION", "HEADER", "FOOTER", "SMALL"]);

const labelOf = (el) => {
  const text = (el.value || el.textContent || "").replace(/\s+/g, " ").trim();
  if (text) return text;
  const img = el.querySelector?.("img[alt]");
  return (img?.getAttribute("alt") || el.getAttribute?.("title") || el.getAttribute?.("aria-label") || "").trim();
};
const external = (el) => /^(?:[a-z]+:)?\/\//i.test(el.getAttribute?.("href") || "") || /^mailto:/i.test(el.getAttribute?.("href") || "");
// A turn word is never the empty string: a link with no label at all is not navigation we can name.
const isTurn = (label) => !!label && TURN.test(label) && /[a-z«»‹›←→<>]/i.test(label);

const blockOf = (el) => { let b = el.parentElement; while (b && !BLOCKS.has(b.tagName) && b.tagName !== "BODY") b = b.parentElement; return b; };
const onlySeparators = (text) => !text.replace(new RegExp(SEP_CHAR, "g"), "").trim();

/** Remove the book's own page-turn links from a loaded section document. Returns how many links went. */
export function stripBookNavLinks(doc) {
  if (!doc?.querySelectorAll) return 0;
  const links = [...doc.querySelectorAll(LINKS)].filter((el) => !external(el));
  const byBlock = new Map();
  for (const el of links) {
    const label = labelOf(el);
    const kind = isTurn(label) ? "turn" : BESIDE.test(label) ? "beside" : null;
    if (!kind) continue;
    const block = blockOf(el);
    if (!block || block.tagName === "BODY") continue;
    if (!byBlock.has(block)) byBlock.set(block, []);
    byBlock.get(block).push({ el, kind });
  }
  let removed = 0;
  for (const [block, found] of byBlock) {
    // A bar of navigation, not a sentence: the block holds a page-turn link and, once the
    // navigation links' own text is taken out, nothing but separators. A "Next" inside prose stays.
    if (!found.some((f) => f.kind === "turn")) continue;
    let rest = block.textContent || "";
    for (const { el } of found) rest = rest.replace(el.textContent || "", "");
    if (!onlySeparators(rest) || block.querySelector("img:not(a img), svg, video, audio, iframe, math")) continue;
    for (const { el } of found) { el.remove(); removed++; }
    // Climb a few levels: a <p> of "|" inside a <div> that held only that <p> goes as one.
    for (let b = block, depth = 0; b && depth < 3 && BLOCKS.has(b.tagName); depth++) {
      if (!onlySeparators(b.textContent || "") || b.querySelector("img, svg, video, audio, iframe, math")) break;
      const up = b.parentElement;
      b.remove();
      b = up;
    }
  }
  return removed;
}
