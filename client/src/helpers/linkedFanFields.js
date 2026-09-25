// helpers/linkedFanFields.js
//
// WHICH FIELDS A COPY-LINK SHARES ON SCREEN — the client half of a rule the
// server already enforces.
//
// `update_occurrence` fans a field write out to every member of a copy-link
// group EXCEPT the per-PLACEMENT fields: the ones the grid filters on (`Date`
// on poms grid) and the ones an operation stamps from the destination
// container (`Time Slot`). server/utils/filterFields.js says why — two copies
// in two day columns, or two slots, must be free to disagree about where they
// are.
//
// `CommitHelpers.updateOccurrence` runs the same fan-out LOCALLY, so linked
// rows tick in the same frame, and it shared EVERY field. So setting Date or
// Time Slot on one copy wrote it onto its siblings in this tab while the
// server never stored it there — the value showed, then vanished on the next
// reload or sync.
//
// The rule is IMPORTED, not copied: one definition, two callers (the same way
// operationActions.js imports server/utils/cloneModuleReuse.js).
import {
  filterFieldIdsOf,
  placementStampFieldIdsOf,
  withoutPerPlacementFields,
} from "../../../server/utils/filterFields.js";

// Walking every pipeline is O(all operations); a field write must not pay it.
// Keyed on the operations ARRAY identity — the store replaces it on every
// operation write, so a new array IS the invalidation signal.
const placementCache = new WeakMap();

function placementIdsOf(operations, gridId) {
  if (!Array.isArray(operations)) return null;
  let byGrid = placementCache.get(operations);
  if (!byGrid) { byGrid = new Map(); placementCache.set(operations, byGrid); }
  const key = gridId || "";
  if (!byGrid.has(key)) {
    // A tab holds other grids' operations too (writes are broadcast per user),
    // and only THIS grid's pipelines say what this grid stamps.
    const own = gridId ? operations.filter(op => !op?.gridId || op.gridId === gridId) : operations;
    byGrid.set(key, placementStampFieldIdsOf(own));
  }
  return byGrid.get(key);
}

/**
 * `fields` minus every per-placement field of the grid in `state`. Fails open
 * exactly as the server does: with no grid or operations known, the fields are
 * returned unchanged.
 */
export function linkedFanFields(fields, state) {
  if (!fields || !state) return fields;
  const grid = state.grid || null;
  const gridId = grid?._id || grid?.id || state.gridId || null;
  return withoutPerPlacementFields(
    fields,
    filterFieldIdsOf(grid),
    placementIdsOf(state.operations, gridId),
  );
}
