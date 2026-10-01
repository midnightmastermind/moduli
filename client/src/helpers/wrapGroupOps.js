// helpers/wrapGroupOps.js
// Shared operations on the doc-editor `wrapGroup` node (project_block_wrap_redesign).
// The group holds the NEIGHBOR(s) FIRST (children 0..N-2) then the HOST as the LAST
// child — neighbor-first source order is required so the floated neighbor wraps the
// host's prose (see WrapGroupExtension.js). One source of truth for "collapse this
// group back to plain siblings" so the radial "Unwrap" item, the drag-out-to-another-
// line path, and the cross-container drag-out all behave the same.

import { floatCountOf, afterRemoval } from "../docs/wrapRoles.js";

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
        // FLOATS only — a text-side lead is not a neighbor (docs/wrapRoles.js).
        neighborCount: floatCountOf(node.attrs, node.childCount),
      };
    }
  });
  return found;
}

// True when `memberIndex` (from findGroupMember) is a floated NEIGHBOR — not the
// trailing host, and not a text-side lead between them.
export function isNeighborMember(group) {
  if (!group) return false;
  return group.memberIndex < floatCountOf(group.groupNode.attrs, group.groupNode.childCount);
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
  const removed = [];
  grp.forEach((child, _o, i) => {
    if (child.attrs?.occurrenceId !== occId) kept.push(child); else removed.push(i);
  });
  // Losing a float, a lead or the host shifts the float/text split — and a
  // group whose last float left has nothing to wrap around (docs/wrapRoles.js).
  const plan = afterRemoval(grp.attrs, grp.childCount, removed);

  return editor.chain().focus().command(({ tr }) => {
    const next = plan.flatten ? kept : [grp.type.create({ ...grp.attrs, floatCount: plan.floatCount }, kept)];
    tr.replaceWith(groupPos, groupPos + grp.nodeSize, next);
    return true;
  }).run();
}

// Lift ONE member out of the wrapGroup at `groupPos` to a plain sibling right
// AFTER the group, keeping the rest of the group intact. Used when a text-side
// lead is dragged out within the same doc: the member must stay in the doc so
// the normal same-doc move can relocate it, but its leaving must not unwrap the
// group the way dragging the host or a float does.
export function extractGroupMember(editor, groupPos, occId) {
  if (!editor || groupPos == null || !occId) return false;
  const grp = editor.state.doc.nodeAt(groupPos);
  if (!grp || grp.type.name !== "wrapGroup") return false;
  const kept = [];
  const removed = [];
  let member = null;
  grp.forEach((child, _o, i) => {
    if (child.attrs?.occurrenceId === occId) { member = child; removed.push(i); } else kept.push(child);
  });
  if (!member) return false;
  const plan = afterRemoval(grp.attrs, grp.childCount, removed);
  return editor.chain().command(({ tr }) => {
    const group = plan.flatten ? kept : [grp.type.create({ ...grp.attrs, floatCount: plan.floatCount }, kept)];
    tr.replaceWith(groupPos, groupPos + grp.nodeSize, [...group, member]);
    return true;
  }).run();
}
