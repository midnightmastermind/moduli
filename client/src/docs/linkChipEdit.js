// docs/linkChipEdit.js — editing a link chip as one line: `text[link]`.
//
// User 2026-11-03: a link chip "lets me edit the line like this message[link]" — the words and the address in one
// editable line, the arrow still opening the link. While the chip is focused its text reads `label[url]`; on commit
// the trailing `[...]` is the address. Pure.

/** The line a link chip shows while it is being edited. */
export function linkEditText(label, url) {
  return `${label || ""}[${url || ""}]`;
}

/**
 * Read an edited line back. A trailing `[address]` sets the address; without one the old address is kept, so
 * deleting the brackets by accident never drops the link. An empty `[]` keeps it too.
 */
export function parseLinkEdit(text, oldUrl) {
  const s = String(text || "");
  const m = /^([\s\S]*?)\[([^\[\]]*)\]\s*$/.exec(s);
  if (!m) return { label: s.trim(), url: oldUrl || "" };
  const url = m[2].trim();
  return { label: m[1].trim(), url: url || oldUrl || "" };
}
