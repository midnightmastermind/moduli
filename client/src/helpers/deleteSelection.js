// helpers/deleteSelection.js — delete every selected occurrence at once (user 2026-11-15: "if i multiselect
// occurances and delete via one of their radial menus, it should delete all of them. put up an are you sure
// message as well"). One path for the right-click "Delete N selected" and the radial's Delete, so the two cannot
// disagree. Asks first; the whole delete is ONE undo step (withAction).
import * as CommitHelpers from "./CommitHelpers";
import { withAction } from "./actionScope";
import { cachedParentMap } from "./dragHitTesting";

/** The ids a delete pressed on `occId` acts on: the whole selection when occId is in it and it holds 2+, else null. */
export function selectionToDelete(occId, selectedIds) {
  if (!occId || !selectedIds?.has?.(occId) || selectedIds.size < 2) return null;
  return [...selectedIds];
}

/**
 * Ask, then remove each id (its parent's list cleaned, like a single delete). Returns true when it deleted.
 * `confirm` is injectable for tests.
 */
export function deleteSelected({ ids, getOccMap, getParentId, dispatch, socket, clear, confirm = (m) => window.confirm(m) }) {
  const n = ids?.length || 0;
  if (!n) return false;
  if (!confirm(`Delete ${n} selected item${n === 1 ? "" : "s"}?`)) return false;
  clear?.();
  const occMap = getOccMap?.() || {};
  // Who lists each row: the caller's index if it has one, else the shared map (a listed row often has no parentId).
  const parentOf = getParentId || ((id) => cachedParentMap(occMap)[id] || null);
  withAction(`Deleted ${n} items`, () => {
    for (const id of ids) {
      const target = occMap[id];
      const parentId = parentOf(id) || target?.parentId || null;
      const parentOcc = parentId ? occMap[parentId] || null : null;
      CommitHelpers.removeOccurrence({
        dispatch, socket, occurrenceId: id,
        occurrence: target || undefined,
        parentOccurrence: parentOcc || undefined,
        emit: true,
      });
    }
  });
  return true;
}
