// helpers/pasteClipboard.js
//
// Bulk-paste executor for the multi-select clipboard (see
// state/SelectionContext.js). Given a clipboard `{ mode, ids }` and a
// destination occurrence (container or page), replays each id according
// to mode:
//
//   copy     — DEEP clone. Mints a fresh occurrence for the source AND
//              recursively for every descendant under it (via
//              `occurrences[]`). Fields are deep-copied. New occurrences
//              are independent (no linkedGroupId). Iteration mode is
//              carried over from the source so persistent items don't
//              silently become specific.
//   move     — re-parent the existing occurrence. The source's old parent
//              loses it from `occurrences[]`; the destination gains it.
//              The occurrence keeps its identity, fields, and linkedGroupId.
//              No descendant changes — the move is shallow because the
//              children are still parented to the moved node, which is
//              itself now under the destination.
//   copylink — mint a fresh occurrence that shares moduleId AND
//              linkedGroupId with the source. Field/textmap writes
//              propagate across the linked group (server fan-out).
//              Currently SHALLOW (root only) — recursive link sharing
//              is a known follow-up; for now copylink-with-children
//              yields a linked root + empty descendant slot.
//
// Destination resolution: occurrences[] on a container or page is the
// canonical "what's inside me" list. The helper always reads / writes
// occurrences via CommitHelpers so optimistic dispatches stay consistent.

import * as LayoutHelpers from "./LayoutHelpers";
import * as CommitHelpers from "./CommitHelpers";

// Heuristic: the helper accepts either a container occurrence or a page
// occurrence as destination. Both shapes use `occurrences[]` for ordering;
// the only difference is the module's role.
function buildToContainerShim(destinationOccurrence, destinationModule) {
  return {
    id: destinationModule?.id || destinationOccurrence?.moduleId,
    label: destinationModule?.label || "",
    _occurrence: destinationOccurrence,
  };
}

// Build the full subtree of new occurrences for a "copy" paste. Returns
// a tree node `{ occurrence, children }` where `occurrence` is the new
// (not-yet-emitted) record with all child ids already resolved, and
// `children` is the list of recursive subtree nodes. Depth-capped at
// 24 to defang any pathological cycles (parentId / occurrences[] loops
// shouldn't exist but the guard is cheap).
function buildCloneSubtree(srcOcc, occurrencesById, parentOccId, gridId, userId, depth = 0) {
  if (!srcOcc || depth > 24) return null;
  const newId = crypto.randomUUID();
  // Children first so we know their new ids when constructing this node.
  const children = [];
  for (const childId of (srcOcc.occurrences || [])) {
    const childOcc = occurrencesById[childId];
    if (!childOcc) continue;
    const subtree = buildCloneSubtree(childOcc, occurrencesById, newId, gridId, userId, depth + 1);
    if (subtree) children.push(subtree);
  }
  // Deep-copy fields so editing one copy can't leak into the other.
  let fields = {};
  if (srcOcc.fields && typeof srcOcc.fields === "object") {
    try { fields = JSON.parse(JSON.stringify(srcOcc.fields)); }
    catch { fields = { ...srcOcc.fields }; }
  }
  return {
    occurrence: {
      id: newId,
      userId,
      gridId,
      moduleId: srcOcc.moduleId,
      parentId: parentOccId || null,
      fields,
      iteration: srcOcc.iteration
        ? { ...srcOcc.iteration }
        : { key: "time", value: new Date(), mode: "specific" },
      occurrences: children.map(c => c.occurrence.id),
      timestamp: new Date(),
      ...(srcOcc.meta ? { meta: { ...srcOcc.meta } } : {}),
    },
    children,
  };
}

// Emit the subtree to the socket / dispatch in pre-order (parent before
// children) so the optimistic Redux dispatch order matches the tree
// shape. CommitHelpers.createOccurrence is idempotent w.r.t. parentId
// references that don't yet exist server-side, so the order is a
// convention rather than a strict requirement.
function emitCloneSubtree(subtree, dispatch, socket) {
  if (!subtree) return;
  CommitHelpers.createOccurrence({ dispatch, socket, occurrence: subtree.occurrence, emit: true });
  for (const child of subtree.children) emitCloneSubtree(child, dispatch, socket);
}

export function runPasteClipboard({
  mode,
  ids,
  destinationOccurrence,
  destinationModule = null,
  occurrencesById = {},
  dispatch,
  socket,
  gridId,
  userId,
  panelId = null,
  panelLabel = "",
}) {
  if (!mode || !Array.isArray(ids) || ids.length === 0) return { pasted: 0 };
  if (!destinationOccurrence?.id) return { pasted: 0 };

  let pasted = 0;
  const toContainer = buildToContainerShim(destinationOccurrence, destinationModule);

  for (const occId of ids) {
    const src = occurrencesById[occId];
    if (!src) continue;
    if (occId === destinationOccurrence.id) continue;

    if (mode === "copy") {
      // Deep-clone path: walks src.occurrences[] recursively so a
      // container paste mints both the container AND its descendants
      // instead of producing an empty shell. Falls back to the simple
      // LayoutHelpers path for leaf-only sources (no children) so we
      // pick up the existing operation triggers (OccurrenceCreateOp +
      // per-field MeasureOps) the shallow path already fires.
      const hasChildren = Array.isArray(src.occurrences) && src.occurrences.length > 0;
      if (hasChildren) {
        const subtree = buildCloneSubtree(src, occurrencesById, destinationOccurrence.id, gridId, userId);
        if (subtree) {
          emitCloneSubtree(subtree, dispatch, socket);
          // Append the new root to the destination's occurrences[].
          const nextChildren = [...(destinationOccurrence.occurrences || []), subtree.occurrence.id];
          CommitHelpers.updateOccurrence({
            dispatch, socket,
            occurrence: { id: destinationOccurrence.id, occurrences: nextChildren },
            emit: true,
          });
          pasted += 1;
        }
      } else {
        const result = LayoutHelpers.copyInstanceToContainer({
          dispatch, socket, gridId,
          sourceInstanceId: src.moduleId,
          toContainer,
          userId,
          sourceOccurrence: src,
          toPanelId: panelId,
          toPanelLabel: panelLabel,
        });
        if (result?.occurrence) pasted += 1;
      }
    } else if (mode === "copylink") {
      const result = LayoutHelpers.copylinkInstanceToContainer({
        dispatch, socket, gridId,
        sourceInstanceId: src.moduleId,
        sourceOccurrenceId: src.id,
        toContainer,
        userId,
        sourceOccurrence: src,
      });
      if (result?.occurrence) pasted += 1;
    } else if (mode === "move") {
      // Find the current parent: any occurrence whose occurrences[] contains
      // this id. Falls back to src.parentId if no parent map entry exists
      // (matches the parentByChildId build pattern used elsewhere).
      let fromOcc = null;
      for (const cand of Object.values(occurrencesById)) {
        if (Array.isArray(cand.occurrences) && cand.occurrences.includes(occId)) {
          fromOcc = cand;
          break;
        }
      }
      if (!fromOcc && src.parentId) fromOcc = occurrencesById[src.parentId] || null;
      if (!fromOcc) continue;
      if (fromOcc.id === destinationOccurrence.id) continue;

      LayoutHelpers.moveInstanceBetweenContainers({
        dispatch, socket,
        fromContainerOccurrence: fromOcc,
        toContainerOccurrence: destinationOccurrence,
        occurrenceId: occId,
      });
      // Keep src.parentId aligned with the new home so downstream ancestor
      // walks (operationExecutor, filter cascade) see the move immediately.
      if (src.parentId !== destinationOccurrence.id) {
        CommitHelpers.updateOccurrence({
          dispatch, socket,
          occurrence: { id: occId, parentId: destinationOccurrence.id },
          emit: true,
        });
      }
      pasted += 1;
    }
  }

  return { pasted };
}
