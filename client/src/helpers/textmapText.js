// helpers/textmapText.js
// Plain-text extraction from a TipTap document. Shared by the table cell
// helpers (sort keys) and the occurrence search index (body haystack).
export function plainText(doc) {
  let out = "";
  const walk = (n) => {
    if (!n) return;
    if (n.type === "text" && typeof n.text === "string") out += n.text;
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return out.trim();
}
