// helpers/selectionDrag.js
// Dragging one row of a multi-selection drags the whole selection (user, 2026-10-23: "tried to move one of
// them with multiple selected and it only moved that one occurance … id expect all of them to move").
//
// The rows land together, in the order they appear on screen, at the drop point. Move takes them out of
// wherever they were; copy and copy-link leave the originals and place copies. One gesture is one undo step,
// and every list is written ONCE with its final contents — writing a list per row from one snapshot is how
// a bulk paste once re-listed rows it had just moved (pasteClipboard, 2026-09-28).
//
// Covered destinations: a board/list container, and a board page (rows directly on a page). Anything else
// (a doc, a canvas, a table, an empty cell) keeps the single-row drop.
import * as CommitHelpers from "./CommitHelpers";
import * as LayoutHelpers from "./LayoutHelpers";
import { withAction } from "./actionScope";
import { cachedParentMap } from "./dragHitTesting";
import { operationsBridge } from "../state/bindSocketToStore";
import { toast } from "../state/notificationStore";

// ── the current selection, readable outside React (the drop pipeline is not a component) ──
let current = new Set();
export function setSelectionSnapshot(ids) { current = ids instanceof Set ? ids : new Set(ids || []); }
export function getSelectionSnapshot() { return current; }

const LEAF_ROLES = new Set(["instance", "artifact", "textblock"]);
const LIST_KINDS = new Set(["board", "list", undefined, null, ""]);

/** The selected rows a drop of `draggedId` carries — null when it is a single-row drop. */
export function groupForDrag(draggedId, selected, { occurrencesById = {}, modulesById = {} } = {}) {
  if (!draggedId || !selected?.has?.(draggedId) || selected.size < 2) return null;
  const ids = [...selected].filter((id) => {
    const o = occurrencesById[id];
    return o && LEAF_ROLES.has(modulesById[o.moduleId]?.role);
  });
  return ids.length > 1 && ids.includes(draggedId) ? ids : null;
}

/** Screen order: the first time each row appears in the document, then anything not on screen. */
export function orderOnScreen(ids, doc = typeof document !== "undefined" ? document : null) {
  if (!doc) return [...ids];
  const pos = new Map();
  let i = 0;
  for (const el of doc.querySelectorAll("[data-occurrence-id]")) {
    const id = el.getAttribute("data-occurrence-id");
    if (!pos.has(id)) pos.set(id, i++);
  }
  return [...ids].sort((a, b) => (pos.get(a) ?? Infinity) - (pos.get(b) ?? Infinity));
}

/**
 * Where each row comes from and the final contents of every list a MOVE touches. `insertAt` counts positions
 * in the destination list as the user sees it (selected rows still in it); null appends.
 * @returns {{ lists: Object<string, string[]>, moved: Array<{id, fromId}> }}
 */
export function planGroupMove({ ids, destId, insertAt = null, occurrencesById = {} }) {
  const dest = occurrencesById[destId];
  if (!dest) return { lists: {}, moved: [] };
  const pbc = cachedParentMap(occurrencesById);
  const moving = new Set(ids);
  const destList = dest.occurrences || [];
  let at = Number.isInteger(insertAt) ? Math.max(0, Math.min(insertAt, destList.length)) : destList.length;
  at -= destList.slice(0, at).filter((id) => moving.has(id)).length;
  const kept = destList.filter((id) => !moving.has(id));
  const lists = { [destId]: [...kept.slice(0, at), ...ids, ...kept.slice(at)] };
  const moved = [];
  for (const id of ids) {
    const o = occurrencesById[id];
    const fromId = (o?.parentId && (occurrencesById[o.parentId]?.occurrences || []).includes(id))
      ? o.parentId : (pbc[id] ?? o?.parentId ?? null);
    moved.push({ id, fromId });
    if (!fromId || fromId === destId || lists[fromId]) continue;
    const from = occurrencesById[fromId];
    if (from) lists[fromId] = (from.occurrences || []).filter((x) => !moving.has(x));
  }
  return { lists, moved };
}

/** Destination of a group drop, or null when this drop is not one a group can take. */
export function groupDestination({ dropTarget, containerOccurrenceId, occurrencesById, modulesById }) {
  const pageId = dropTarget?.context?.pageOccurrenceId;
  const page = pageId ? occurrencesById[pageId] : null;
  const pageMod = page ? modulesById[page.moduleId] : null;
  if (page && pageMod?.role === "page") return pageMod.kind === "canvas" ? null : page;
  const cont = containerOccurrenceId ? occurrencesById[containerOccurrenceId] : null;
  const contMod = cont ? modulesById[cont.moduleId] : null;
  if (!cont || contMod?.role !== "container" || !LIST_KINDS.has(contMod.kind)) return null;
  if (contMod.behaviorMode === "own" && contMod.behavior?.droppable === false) return null;
  return cont;
}

/** Where in the destination the group goes: the drop line, else beside the hovered row. */
export function groupInsertAt({ dropTarget, hoveredOccId, dest }) {
  const at = dropTarget?.context?.insertAt;
  if (Number.isInteger(at)) return at;
  const idx = hoveredOccId ? (dest.occurrences || []).indexOf(hoveredOccId) : -1;
  if (idx === -1) return null;
  const edge = dropTarget?.context?.closestEdge;
  return edge === "bottom" || edge === "right" ? idx + 1 : idx;
}

/** Runs the group drop. Returns true when it handled the drop. */
export function runGroupDrop({ ids, dest, insertAt, mode, ctx }) {
  const { dispatch, socket, state, occurrencesById } = ctx;
  const modulesById = state?.modulesById || {};
  const name = (o) => o?.label || modulesById[o?.moduleId]?.label || "item";
  const n = ids.length;
  if (mode === "copy" || mode === "copylink") {
    withAction(`${mode === "copy" ? "Copied" : "Linked"} ${n} items`, () => {
      let working = dest;
      let at = Number.isInteger(insertAt) ? insertAt : (dest.occurrences || []).length;
      for (const id of ids) {
        const src = occurrencesById[id];
        if (!src) continue;
        const args = {
          dispatch, socket, gridId: state?.gridId || state?.grid?._id, userId: state?.userId,
          sourceInstanceId: src.moduleId, sourceOccurrence: src, toIndex: at, emit: true,
          toContainer: { ...(modulesById[dest.moduleId] || {}), _occurrence: working },
          iterationMode: src.iteration?.mode || "specific", iterationValue: src.iteration?.value || null,
        };
        const res = mode === "copy"
          ? LayoutHelpers.copyInstanceToContainer(args)
          : LayoutHelpers.copylinkInstanceToContainer({ ...args, sourceOccurrenceId: src.id });
        const newId = res?.occurrence?.id;
        if (!newId) continue;
        const list = [...(working.occurrences || [])];
        list.splice(Math.min(at, list.length), 0, newId);
        working = { ...working, occurrences: list };
        at += 1;
      }
    });
    toast.success(`${mode === "copy" ? "Copied" : "Linked"} ${n} items → ${name(dest)}`);
    return true;
  }

  const { lists, moved } = planGroupMove({ ids, destId: dest.id, insertAt, occurrencesById });
  withAction(`Moved ${n} items`, () => {
    for (const [occId, list] of Object.entries(lists)) {
      const before = occurrencesById[occId];
      CommitHelpers.updateOccurrence({
        dispatch, socket, emit: true,
        occurrence: { id: occId, occurrences: list },
        occurrencesBase: before?.occurrences || [],
      });
      if (before) operationsBridge.updateLocalOcc?.({ ...before, occurrences: list });
    }
    for (const { id, fromId } of moved) {
      const o = occurrencesById[id];
      if (o && o.parentId !== dest.id) {
        CommitHelpers.updateOccurrence({ dispatch, socket, emit: true, occurrence: { id, parentId: dest.id } });
        operationsBridge.updateLocalOcc?.({ ...o, parentId: dest.id });
      }
      if (fromId === dest.id) continue;
      const chain = operationsBridge.getAncestorChain?.(id) || { ids: [], labels: [] };
      operationsBridge.fireOperations?.("OccurrenceMoveOp", {
        type: "OccurrenceMoveOp", occurrenceId: id, instanceId: o?.moduleId,
        fromContainerId: fromId, toContainerId: dest.id, fromPanelId: null, toPanelId: null,
        fields: o?.fields || {}, _ancestorIds: chain.ids, _ancestorLabels: chain.labels,
      });
    }
  });
  toast.success(`Moved ${n} items → ${name(dest)}`);
  return true;
}
