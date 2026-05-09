// helpers/dragHitTesting.js
// ============================================================
// PURE drag hit-testing + DropContext builder.
//
// CONTRACT: every function here is pure — no React, no socket,
// no module-scope state. Inputs in, outputs out.
//
// The buildDropContext function is the single reconciliation point
// for "what happens when a drag ends here." Adapters (Pragmatic DnD,
// touch driver, TipTap) feed it a RawDropEvent. It returns a
// DropContext that the routeDrop dispatcher can act on without
// caring which input modality fired.
//
// Reads `occ.moduleId` directly. The dual-name alias (moduleId ↔ targetId)
// is set up at the state-ingest boundary in bindSocketToStore.js.
// ============================================================

export const DROP_TARGET_KIND = Object.freeze({
  OCCURRENCE: "occurrence",
  GRID_CELL: "grid-cell",
  DOC_CURSOR: "doc-cursor",
});

// ------------------------------------------------------------
// resolveEdgeToIndex
// ------------------------------------------------------------
// Given the closest edge of a hovered occurrence and the dragged
// occurrence's current index in the same parent (or -1 if it lives
// elsewhere), return the splice-position the dragged item should
// end up at.
//
// Same-container forward moves shift by -1 because removing the
// dragged item from its old slot pulls every later index down by 1.
export function resolveEdgeToIndex(edge, hoveredIndex, fromIndex) {
  let toIndex;
  if (edge === "top" || edge === "left") toIndex = hoveredIndex;
  else if (edge === "bottom" || edge === "right") toIndex = hoveredIndex + 1;
  else toIndex = hoveredIndex;
  if (fromIndex !== -1 && fromIndex < hoveredIndex) {
    toIndex = Math.max(0, toIndex - 1);
  }
  return toIndex;
}

// ------------------------------------------------------------
// resolveDragMode
// ------------------------------------------------------------
// Modifier keys override the payload's default drag mode.
// Alt+Shift = copylink, Alt = copy, otherwise default (or "move").
export function resolveDragMode(modifiers = {}, payloadDefault) {
  if (modifiers.alt && modifiers.shift) return "copylink";
  if (modifiers.alt) return "copy";
  return payloadDefault || "move";
}

// ------------------------------------------------------------
// buildParentMap
// ------------------------------------------------------------
// Reverse-index the occurrence tree: for each child id in any
// occurrence's `.occurrences[]`, record its parent's id. Used by
// buildDropContext to find a hovered occurrence's parent in O(1).
export function buildParentMap(occurrencesById) {
  const map = Object.create(null);
  for (const occ of Object.values(occurrencesById)) {
    if (!Array.isArray(occ?.occurrences)) continue;
    for (const childId of occ.occurrences) map[childId] = occ.id;
  }
  return map;
}

// ------------------------------------------------------------
// walkHoveredOccurrence
// ------------------------------------------------------------
// Walk elementsFromPoint and return the innermost ancestor that
// carries an occurrence-id data attribute. Pure given an injected
// elementsFromPoint stub; falls back to document.elementsFromPoint
// when called in a browser.
const _OCC_ATTRS = ["data-occurrence-id", "data-occ-id", "data-instance-id"];

export function walkHoveredOccurrence(x, y, env = {}) {
  let efp = env.elementsFromPoint;
  if (!efp && typeof document !== "undefined" && typeof document.elementsFromPoint === "function") {
    efp = document.elementsFromPoint.bind(document);
  }
  if (!efp) return null;
  const stack = efp(x, y) || [];
  for (const el of stack) {
    if (!el?.getAttribute) continue;
    for (const attr of _OCC_ATTRS) {
      const id = el.getAttribute(attr);
      if (id) return { occurrenceId: id };
    }
  }
  return null;
}

// ------------------------------------------------------------
// buildDropContext
// ------------------------------------------------------------
// The single reconciliation point. Given a RawDropEvent and the
// current data env, produce the DropContext the router will dispatch
// on, or null when there's nothing actionable.
//
// RawDropEvent shape:
//   { source:    { occurrenceId, moduleId, sourceKind, defaultMode, ... },
//     hover:     { x, y, dropTargetData: { occurrenceId|kind|gridCell|editorPos, closestEdge } },
//     modifiers: { shift, alt, ctrl, meta },
//     pointer:   { x, y } }
//
// DropContext shape: see spec §4.
export function buildDropContext(rawEvent, env) {
  if (!rawEvent || !env) return null;
  const { source, hover, modifiers = {}, pointer, dataTransfer = null } = rawEvent;
  const dtd = hover?.dropTargetData;
  if (!dtd) return null;

  const occurrencesById = env.occurrencesById || {};

  let kind = dtd.kind;
  if (!kind && dtd.occurrenceId) kind = DROP_TARGET_KIND.OCCURRENCE;

  const ptr = pointer || { x: hover.x, y: hover.y };
  const mode = resolveDragMode(modifiers, source?.defaultMode);

  // The full original dropTargetData is preserved on `target.raw` so handlers
  // that need ad-hoc fields (e.g. board page-occurrence id, grid-cell row/col,
  // cellId) can reach them without polluting the contract.
  const rawTargetData = dtd;

  if (kind === DROP_TARGET_KIND.GRID_CELL) {
    return {
      payload: { ...source },
      target: {
        occurrenceId: null,
        moduleId: null,
        parentOccurrenceId: null,
        kind: DROP_TARGET_KIND.GRID_CELL,
        gridCell: dtd.gridCell || null,
        docCursor: null,
        raw: rawTargetData,
      },
      position: { edge: null, insertIndex: 0 },
      mode, modifiers, pointer: ptr, dataTransfer,
    };
  }

  if (kind === DROP_TARGET_KIND.DOC_CURSOR) {
    const docOcc = dtd.occurrenceId ? occurrencesById[dtd.occurrenceId] : null;
    return {
      payload: { ...source },
      target: {
        occurrenceId: dtd.occurrenceId || null,
        moduleId: docOcc?.moduleId || null,
        parentOccurrenceId: null,
        kind: DROP_TARGET_KIND.DOC_CURSOR,
        gridCell: null,
        docCursor: { editorPos: dtd.editorPos ?? null, occurrenceId: dtd.occurrenceId || null },
        raw: rawTargetData,
      },
      position: { edge: null, insertIndex: 0 },
      mode, modifiers, pointer: ptr, dataTransfer,
    };
  }

  // OCCURRENCE
  if (!dtd.occurrenceId) return null;
  const targetOcc = occurrencesById[dtd.occurrenceId];
  if (!targetOcc) return null;

  const parents = buildParentMap(occurrencesById);
  const parentId = parents[targetOcc.id] || null;
  const parentOcc = parentId ? occurrencesById[parentId] : null;

  let insertIndex = 0;
  let edge = dtd.closestEdge ?? null;
  if (parentOcc && Array.isArray(parentOcc.occurrences)) {
    const hoveredIndex = parentOcc.occurrences.indexOf(targetOcc.id);
    const fromIndex = source?.occurrenceId
      ? parentOcc.occurrences.indexOf(source.occurrenceId)
      : -1;
    insertIndex = hoveredIndex !== -1
      ? resolveEdgeToIndex(edge, hoveredIndex, fromIndex)
      : parentOcc.occurrences.length;
  } else if (Array.isArray(targetOcc.occurrences)) {
    insertIndex = targetOcc.occurrences.length;
    edge = null;
  }

  const targetModuleId = targetOcc.moduleId || null;
  return {
    payload: { ...source },
    target: {
      occurrenceId: targetOcc.id,
      moduleId: targetModuleId,
      parentOccurrenceId: parentId,
      kind: DROP_TARGET_KIND.OCCURRENCE,
      gridCell: null,
      docCursor: null,
      raw: rawTargetData,
    },
    position: { edge, insertIndex },
    mode, modifiers, pointer: ptr, dataTransfer,
  };
}
