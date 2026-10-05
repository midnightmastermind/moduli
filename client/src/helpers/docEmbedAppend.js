// A DOC renders its TEXTMAP and nothing else, so a child that is only LISTED
// in a doc's `occurrences[]` exists in the data and never appears on screen —
// the listed-but-not-embedded class this repo has repaired from several
// directions. Every path that adds a child to a doc appends its embed here.

/** The node a doc uses to draw an occurrence: a textblock is drawn inline as
 *  an `instanceTextblock`, everything else as a `moduleEmbed`. */
export function docEmbedNode({ moduleId, occurrenceId, role }) {
  if (role === "textblock") return { type: "instanceTextblock", attrs: { instanceId: moduleId, occurrenceId } };
  return { type: "moduleEmbed", attrs: { occurrenceId } };
}

/** `textmap` with `node` appended at the end. A missing textmap becomes a doc
 *  holding just the node. Never mutates its input. */
export function appendDocEmbed(textmap, node) {
  const tm = textmap && typeof textmap === "object" ? textmap : { type: "doc", content: [] };
  const content = Array.isArray(tm.content) ? tm.content : [];
  return { ...tm, type: tm.type || "doc", content: [...content, node] };
}

/** Is this parent a doc, i.e. does it draw its children from its textmap? */
export function isDocParent(parentModule) {
  return parentModule?.kind === "doc";
}
