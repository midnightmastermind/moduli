// helpers/strictBlockSweep.js
//
// WHICH TOP-LEVEL NODES OF A PAGE DOC ARE LOOSE TEXT that belongs in a textblock.
//
// The sweep in Editor.onUpdate was written when a page doc held only
// `instanceTextblock` nodes, so its rule was "anything that is not one gets
// wrapped in a new textblock". A doc now also holds `moduleEmbed`s, `wrapGroup`s
// and tables at the top level, and the old rule wrapped THOSE: typing two
// characters beside a pill on the Wrap Lab page minted five textblocks, put the
// page's container embed inside one, tore the wrap group in two and dropped its
// picture (2026-10-02). An earlier symptom of the same rule was patched at the
// trigger instead ("an extra random parent textblock containing the wrap stuff"
// on every seam resize) — the rule itself is what was wrong.
//
// So it is an ALLOWLIST of text block types. Anything else at the top level is
// an occurrence or a structure in its own right and is left exactly where it is.
const LOOSE_TEXT_BLOCKS = new Set([
  "paragraph", "heading", "blockquote", "codeBlock", "bulletList", "orderedList", "taskList",
]);

/** A line with nothing typed in it: empty, or holding only inline atoms (a pill). */
function hasNoText(node) {
  return node.type.name === "paragraph" && node.textContent.length === 0;
}

/**
 * @param {import("prosemirror-model").Node} doc
 * @returns {{offset:number,nodeSize:number,nodeJson:object}[]} in document order
 */
export function looseTextBlocks(doc) {
  const out = [];
  if (!doc) return out;
  doc.forEach((node, offset) => {
    if (!LOOSE_TEXT_BLOCKS.has(node.type.name)) return;
    if (hasNoText(node)) return;
    out.push({ offset, nodeSize: node.nodeSize, nodeJson: node.toJSON() });
  });
  return out;
}

/** True when the line holds anything besides text — a pill, a chip, a hard break. */
export function lineHasInlineNodes(node) {
  let found = false;
  node?.forEach?.((child) => { if (!child.isText) found = true; });
  return found;
}
