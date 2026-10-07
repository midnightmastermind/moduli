// helpers/selectionInline.js
// The inline content a mini textblock (inline chip) is built from when a
// selection is turned into one ("Make inline textblock", the doc toolbar).
//
// It used to be the selection's PLAIN TEXT, which silently dropped bold /
// italic / links — "**Barbell Bench Press** – 4 sets" became an unformatted
// chip (2026-10-07). A chip's textmap is one paragraph, so the selection's
// content is flattened to inline nodes: marked text runs are kept as they are,
// blocks are joined with one space, a hard break becomes a space, and atoms a
// chip cannot hold (another chip, an embed, an image) are dropped. The outer
// ends are trimmed, as the plain-text path trimmed them.

const isText = (n) => n?.type === "text" && typeof n.text === "string";

export function inlineContentFromSlice(nodes) {
  const out = [];
  const push = (node) => {
    const prev = out[out.length - 1];
    // merge with the previous run when the marks are identical
    if (prev && isText(prev) && JSON.stringify(prev.marks || null) === JSON.stringify(node.marks || null)) {
      out[out.length - 1] = { ...prev, text: prev.text + node.text };
    } else out.push(node);
  };
  const space = () => { if (out.length && !/\s$/.test(out[out.length - 1].text)) push({ type: "text", text: " " }); };
  const walk = (list, sepBlocks) => {
    (list || []).forEach((n, i) => {
      if (!n) return;
      if (isText(n)) { push(n.marks?.length ? { type: "text", text: n.text, marks: n.marks } : { type: "text", text: n.text }); return; }
      if (n.type === "hardBreak") { space(); return; }
      if (Array.isArray(n.content)) {
        if (sepBlocks && i > 0) space();
        walk(n.content, true);
      }
      // anything else is an atom a chip cannot hold
    });
  };
  walk(nodes, true);
  // trim the outer ends
  while (out.length && isText(out[0]) && !out[0].text.trim()) out.shift();
  while (out.length && isText(out[out.length - 1]) && !out[out.length - 1].text.trim()) out.pop();
  if (out.length) {
    out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, "") };
    const L = out.length - 1;
    out[L] = { ...out[L], text: out[L].text.replace(/\s+$/, "") };
  }
  return out;
}
