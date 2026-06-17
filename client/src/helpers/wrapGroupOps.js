// helpers/wrapGroupOps.js
// Shared operations on the doc-editor `wrapGroup` node (project_block_wrap_redesign).
// The group holds the NEIGHBOR(s) FIRST (children 0..N-2) then the HOST as the LAST
// child — neighbor-first source order is required so the floated neighbor wraps the
// host's prose (see WrapGroupExtension.js). One source of truth for "collapse this
// group back to plain siblings" so the radial "Unwrap" item, the drag-out-to-another-
// line path, and the cross-container drag-out all behave the same.

// Find the wrapGroup (if any) that holds `occId` as ANY child. Returns
// { groupPos, groupNode, hostOccId, memberIndex, neighborCount } or null. The HOST is
// the LAST child; neighbors are indices 0..neighborCount-1. Top-level scan; descends
// one level into each wrapGroup.
export function findGroupMember(doc, occId) {
  if (!doc || !occId) return null;
  let found = null;
  doc.forEach((node, offset) => {
    if (found || node.type.name !== "wrapGroup") return;
    let idx = -1;
    node.forEach((child, _o, i) => {
      if (idx >= 0) return;
      if (child.attrs?.occurrenceId === occId) idx = i;
    });
    if (idx >= 0) {
      found = {
        groupPos: offset,
        groupNode: node,
        hostOccId: node.lastChild?.attrs?.occurrenceId || null,
        memberIndex: idx,
        neighborCount: Math.max(0, node.childCount - 1),
      };
    }
  });
  return found;
}

// True when `memberIndex` (from findGroupMember) is a NEIGHBOR, not the trailing host.
export function isNeighborMember(group) {
  if (!group) return false;
  return group.memberIndex < group.groupNode.childCount - 1;
}

// Collapse the wrapGroup at `groupPos` back to its children inline (neighbors first,
// then the host as plain sibling embeds). With the real-float model there's no host
// `wrapSpacer` to strip — removing the group's render context un-morphs the host (its
// `--wrap-host-clip` only applies while inside `.wrap-group--on`).
export function unwrapGroupAt(editor, groupPos) {
  if (!editor || groupPos == null) return false;
  const grp = editor.state.doc.nodeAt(groupPos);
  if (!grp || grp.type.name !== "wrapGroup") return false;
  const kids = [];
  grp.forEach((child) => kids.push(child));
  return editor.chain().focus().command(({ tr }) => {
    tr.replaceWith(groupPos, groupPos + grp.nodeSize, kids);
    return true;
  }).run();
}

// Remove ONE member (a neighbor or the host) from the wrapGroup at `groupPos` — used
// when a grouped embed is dragged OUT to another container (the embedDeleteRegistry
// path), where the member's content was already re-homed and we just need to drop its
// node from this doc while keeping the group valid. A group needs ≥2 children (≥1
// neighbor + the host); when fewer remain it flattens to plain sibling embeds.
export function detachGroupMember(editor, groupPos, occId) {
  if (!editor || groupPos == null || !occId) return false;
  const grp = editor.state.doc.nodeAt(groupPos);
  if (!grp || grp.type.name !== "wrapGroup") return false;

  const kept = [];
  grp.forEach((child) => { if (child.attrs?.occurrenceId !== occId) kept.push(child); });

  return editor.chain().focus().command(({ tr }) => {
    const next = kept.length >= 2 ? [grp.type.create(grp.attrs, kept)] : kept;
    tr.replaceWith(groupPos, groupPos + grp.nodeSize, next);
    return true;
  }).run();
}
