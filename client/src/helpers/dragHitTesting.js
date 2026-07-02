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
// Reads `occ.moduleId` directly.
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
// buildRawDropEvent
// ------------------------------------------------------------
// Pure assembly of a RawDropEvent from the legacy dropTarget shape
// emitted by useDroppable/useDragDrop hooks plus the active session
// payload. Extracted from DragProvider.handleDrop so the conversion
// is testable without mounting React.
//
// Inputs:
//   dropTarget — { type, id, context, clientX, clientY, source, dataTransfer, ... }
//   payload    — session payload (createPayload-shaped) or dropTarget.source fallback
//   sessionMode — current session mode ("move" | "copy" | "copylink")
//   hovered    — { panelOccId, containerOccId, instanceOccId } from a DOM walk
//   getCellFromPoint — fn(x, y) → { row, col, cellId } | null (for FILE fallback)
//
// Returns RawDropEvent | null (null when no usable target).
export function buildRawDropEvent({ dropTarget, payload, sessionMode, hovered = {}, getCellFromPoint = () => null }) {
  if (!dropTarget) return null;
  const x = dropTarget.clientX ?? 0;
  const y = dropTarget.clientY ?? 0;

  const hoveredOccurrenceId =
    dropTarget.context?.occurrenceId
    || dropTarget.context?.instanceOccurrenceId
    || dropTarget.context?.containerOccurrenceId
    || hovered.instanceOccId
    || hovered.containerOccId
    || hovered.panelOccId
    || null;

  let dropTargetData = null;
  if (dropTarget.type === DROP_TARGET_KIND.GRID_CELL && dropTarget.context?.row !== undefined) {
    dropTargetData = {
      kind: DROP_TARGET_KIND.GRID_CELL,
      gridCell: {
        row: dropTarget.context.row,
        col: dropTarget.context.col,
        cellId: dropTarget.context.cellId,
      },
      ...(dropTarget.context || {}),
    };
  } else if (hoveredOccurrenceId) {
    dropTargetData = {
      occurrenceId: hoveredOccurrenceId,
      closestEdge: dropTarget.context?.closestEdge || null,
      ...(dropTarget.context || {}),
    };
  } else if (payload?.type === "file") {
    const cell = getCellFromPoint(x, y);
    if (cell) {
      dropTargetData = {
        kind: DROP_TARGET_KIND.GRID_CELL,
        gridCell: { row: cell.row, col: cell.col, cellId: cell.cellId },
      };
    }
  }
  if (!dropTargetData) return null;

  return {
    source: {
      occurrenceId: payload?.context?.occurrenceId
        || payload?.context?.containerOccurrenceId
        || payload?.occurrenceId
        || null,
      moduleId: payload?.id || null,
      sourceKind: payload?.context?.sourceType || payload?.sourceType || "in-grid",
      defaultMode: sessionMode || "move",
      payloadType: payload?.type,
      data: payload?.data,
      context: payload?.context,
      sourceContainerId: payload?.context?.containerId,
      sourceContainerOccurrenceId: payload?.context?.containerOccurrenceId,
      childOccurrenceIds: payload?.childOccurrenceIds,
    },
    hover: { x, y, dropTargetData },
    modifiers: {
      shift: dropTarget.shiftKey ?? false,
      alt: dropTarget.altKey ?? false,
      ctrl: dropTarget.ctrlKey ?? false,
      meta: dropTarget.metaKey ?? false,
    },
    pointer: { x, y },
    dataTransfer: dropTarget.dataTransfer || null,
  };
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
// Resolve where a leaf dropped on a container BODY should land among the
// container's children, from the pointer position — matching what the
// insertion-line indicator shows. Covers instance children AND nested
// container children (the hovered-instance sibling branch never fires for
// those, so such drops used to append at "the last spot"). Maps DOM position
// → occurrences[] index via the neighbor card's occurrence id, so
// hidden/filtered children don't skew the index. Returns null when the
// container element / cards can't be resolved (caller appends — old behavior).
export function computeInsertIndexFromPointer(targetOcc, ptr) {
  if (!targetOcc || !ptr || typeof document === "undefined") return null;
  const esc = (v) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(v)) : String(v));
  const containerEl =
    document.querySelector(`[data-occ-id="${esc(targetOcc.id)}"]`) ||
    (targetOcc.moduleId ? document.querySelector(`[data-container-id="${esc(targetOcc.moduleId)}"]`) : null);
  if (!containerEl) return null;

  // Direct member cards: leaf rows (.instance-wrap) and nested container
  // shells. A shell carries [data-container-id] itself, so its "owning
  // container" is the nearest such ancestor ABOVE itself.
  const cards = Array.from(containerEl.querySelectorAll(".instance-wrap, [data-container-id]")).filter((el) => {
    if (el === containerEl) return false;
    const owner = el.classList.contains("instance-wrap")
      ? el.closest("[data-container-id]")
      : el.parentElement?.closest?.("[data-container-id]");
    return owner === containerEl;
  });
  if (cards.length === 0) return null;

  const r0 = cards[0].getBoundingClientRect();
  const r1 = cards.length > 1 ? cards[1].getBoundingClientRect() : null;
  const horizontal = r1 ? Math.abs(r1.left - r0.left) > Math.abs(r1.top - r0.top) : false;
  const p = horizontal ? ptr.x : ptr.y;

  let beforeCard = null;
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
    if (p < mid) { beforeCard = c; break; }
  }

  const occIdOf = (el) =>
    el.getAttribute("data-occurrence-id") ||
    el.getAttribute("data-occ-id") ||
    el.querySelector?.("[data-occurrence-id]")?.getAttribute("data-occurrence-id") ||
    null;
  const list = Array.isArray(targetOcc.occurrences) ? targetOcc.occurrences : [];
  if (beforeCard) {
    const id = occIdOf(beforeCard);
    const idx = id ? list.indexOf(id) : -1;
    return idx >= 0 ? idx : null;
  }
  const lastId = occIdOf(cards[cards.length - 1]);
  const lastIdx = lastId ? list.indexOf(lastId) : -1;
  return lastIdx >= 0 ? lastIdx + 1 : null;
}

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

  // Role of the target + dragged source — distinguishes "drop a leaf INTO
  // this container" from "reorder this occurrence among its siblings".
  const modulesById = env.modulesById || {};
  const LEAF_ROLES = new Set(["instance", "textblock", "artifact"]);
  const targetRole = modulesById[targetOcc.moduleId]?.role ?? null;
  const sourceRole = source?.moduleId ? (modulesById[source.moduleId]?.role ?? null) : null;
  const targetIsContainer = targetRole === "container";
  const sourceIsLeaf = sourceRole != null && LEAF_ROLES.has(sourceRole);

  let insertIndex = 0;
  let edge = dtd.closestEdge ?? null;
  // Explicit insertAt from the drop zone wins — used for "drop INTO the
  // target's children" semantics (e.g. empty page drops where the page is
  // the target and we want index 0 or the children-length, not a position
  // in the panel that holds the page).
  if (typeof dtd.insertAt === "number") {
    insertIndex = dtd.insertAt;
    edge = null;
  } else if (targetIsContainer && sourceIsLeaf && Array.isArray(targetOcc.occurrences)) {
    // Dropping a LEAF onto the CONTAINER body/edge (not onto a specific child
    // instance) → nest it INSIDE the container AT THE POINTER position — the
    // same spot the insertion-line indicator showed. This is what places the
    // drop correctly when the container's children are CONTAINERS (nested
    // boards): the hovered-child branch below only fires for instance targets,
    // so those drops used to silently append at the end. Falls back to append
    // when the DOM can't be resolved.
    const ptrIndex = computeInsertIndexFromPointer(targetOcc, ptr);
    insertIndex = ptrIndex != null ? ptrIndex : targetOcc.occurrences.length;
    edge = null;
  } else if (parentOcc && Array.isArray(parentOcc.occurrences)) {
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
