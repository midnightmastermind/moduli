// docs/trailingEmpty.js — a doc container's empty line after its final block.
//
// That ONE line is the container's hover line: index.css hides it at rest and reveals it while the card is hovered,
// so you can click below the block and type. More than one shows as a blank space (the Glossary's Web & dev, where a
// click saved a second one), and the read-only stand-in drew even one as a blank line at rest (2026-11-15). So:
// saving keeps at most one (`keep = 1`), the stand-in draws none (`keep = 0`), and a built page gets one
// (`ensureHoverLine`). Only empty lines AFTER A BLOCK at the very end count: a blank line after text is someone's.
const isEmptyPara = (n) => n?.type === "paragraph" && !(n.content && n.content.length);

/** `doc` with at most `keep` empty paragraphs after its last non-paragraph node; `doc` itself when nothing changes. */
export function trimTrailingEmptyAfterBlock(doc, keep = 1) {
  const c = doc?.content;
  if (!Array.isArray(c) || !c.length || !isEmptyPara(c[c.length - 1])) return doc;
  let end = c.length;
  while (end > 0 && isEmptyPara(c[end - 1])) end--;
  if (end === 0 || c[end - 1]?.type === "paragraph") return doc;
  if (c.length - end <= keep) return doc;
  return { ...doc, content: c.slice(0, end + keep) };
}

/** A doc ending in a block, with exactly one empty line after it (its hover line). Other docs come back as they are. */
export function ensureHoverLine(doc) {
  const c = doc?.content;
  if (!Array.isArray(c) || !c.length) return doc;
  const trimmed = trimTrailingEmptyAfterBlock(doc, 0);
  const last = trimmed.content[trimmed.content.length - 1];
  if (last?.type === "paragraph") return doc === trimmed ? doc : trimTrailingEmptyAfterBlock(doc, 1);
  return { ...trimmed, content: [...trimmed.content, { type: "paragraph" }] };
}
