// utils/embedRootInDocParent.js
//
// A DOC renders its TEXTMAP, not its child list — so an import listed in a doc (a day page column, a
// doc section) is reachable and invisible. When the caller asks (`import_text` with `embed: true`,
// sent by an operation's Import step), the imported root is also appended to the doc's text as a
// moduleEmbed, the way a block dropped into a doc is. Idempotent: an embed already naming the child
// is left alone. Boards / lists / tables render `occurrences[]` and are not touched.
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import { compressTextmap, decompressTextmap } from "./textmapCompression.js";

export function textmapEmbeds(textmap, childId) {
  let found = false;
  const walk = (n) => {
    if (found || !n || typeof n !== "object") return;
    if (n.attrs?.occurrenceId === childId) { found = true; return; }
    (n.content || []).forEach(walk);
  };
  walk(textmap);
  return found;
}

/** The parent's next textmap with the child embedded at the end, or null when nothing changes. */
export function planDocEmbed({ parentModule, textmap, childId }) {
  if (!parentModule || parentModule.kind !== "doc" || !childId) return null;
  const doc = textmap && typeof textmap === "object" ? textmap : { type: "doc", content: [] };
  if (textmapEmbeds(doc, childId)) return null;
  return { ...doc, type: "doc", content: [...(doc.content || []), { type: "moduleEmbed", attrs: { occurrenceId: childId } }] };
}

export async function embedRootInDocParent({ parentId, childId, userId }) {
  if (!parentId || !childId) return null;
  const parent = await Occurrence.findOne({ id: parentId, userId }).lean();
  if (!parent) return null;
  const parentModule = await Module.findOne({ id: parent.moduleId }).lean();
  const next = planDocEmbed({ parentModule, textmap: decompressTextmap(parent.textmap), childId });
  if (!next) return null;
  await Occurrence.updateOne({ id: parentId, userId }, { $set: { textmap: compressTextmap(next), updatedAt: new Date() } });
  return { id: parentId, textmap: next };
}
