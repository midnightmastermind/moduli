// fieldVisibilityAutoAppend.js
// When an occurrence lands in a scope whose field-visibility is in `show`
// mode, the new occurrence's bound fields aren't in the scope's `fieldIds`
// list — so they render hidden by default. The user then has to manually
// open the picker and tick each new field. This helper closes that gap:
// after a drop, it walks the destination's ancestors and appends the
// dropped occurrence's fieldIds to any ancestor whose
// `fieldVisibility.mode === "show"`.
//
// Modes other than `show` are untouched:
//   - `hide`: a blacklist — new fields default visible already.
//   - `off` / `inherit` / unset: no whitelist to update.
//
// Never strips fields, only appends — the user's existing picks survive.

import * as CommitHelpers from "./CommitHelpers";
import { buildParentMap } from "./dragHitTesting";

// Collect the fieldIds an occurrence "carries": every fieldId bound on its
// module + every key currently set on its `fields` map (catches stamped
// fields like the schedule date/time-slot pattern that aren't bound). De-dups
// via the returned Set.
function fieldIdsForOccurrence(occurrence, modulesById) {
  const out = new Set();
  if (!occurrence) return out;
  const mod = occurrence.moduleId ? modulesById?.[occurrence.moduleId] : null;
  if (Array.isArray(mod?.fieldBindings)) {
    for (const fb of mod.fieldBindings) {
      if (fb?.fieldId) out.add(fb.fieldId);
    }
  }
  if (occurrence.fields && typeof occurrence.fields === "object") {
    for (const fid of Object.keys(occurrence.fields)) {
      if (fid) out.add(fid);
    }
  }
  return out;
}

// Walk ancestors of `start` (inclusive) leaf→root, calling `visit(occ)` per
// step. Stops when `visit` returns the literal string "stop" — used to break
// the walk at an `off`-mode ancestor (descendants below it see "all fields",
// so anything above is irrelevant for this drop).
function walkAncestorsInclusive(start, occurrencesById, parentByChildId, visit) {
  if (!start) return;
  const pbc = parentByChildId || buildParentMap(occurrencesById || {});
  const guard = new Set();
  let cur = start;
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    const result = visit(cur);
    if (result === "stop") return;
    const nextId = pbc[cur.id] ?? cur.parentId;
    cur = nextId ? (occurrencesById?.[nextId] || null) : null;
  }
}

// For each ancestor of `destinationOccurrence` (inclusive) whose
// `fieldVisibility.mode === "show"`, append the new occurrence's missing
// fieldIds to that ancestor's `fieldVisibility.fieldIds`. Idempotent — does
// nothing when no ancestor is in show mode, or when every fieldId is already
// listed. Stops walking at the first `off`-mode ancestor.
export function autoAppendFieldsToAncestorsShowMode({
  newOccurrence,
  destinationOccurrence,
  ctx,
}) {
  if (!newOccurrence || !destinationOccurrence || !ctx) return;
  const { occurrencesById, modulesById, parentByChildId, dispatch, socket } = ctx;
  const newFieldIds = fieldIdsForOccurrence(newOccurrence, modulesById);
  if (newFieldIds.size === 0) return;

  walkAncestorsInclusive(destinationOccurrence, occurrencesById, parentByChildId, (anc) => {
    const fv = anc.fieldVisibility;
    if (!fv || !fv.mode) return;
    if (fv.mode === "off") return "stop";
    if (fv.mode !== "show") return;
    const existing = Array.isArray(fv.fieldIds) ? fv.fieldIds : [];
    const existingSet = new Set(existing);
    let added = false;
    for (const fid of newFieldIds) {
      if (!existingSet.has(fid)) {
        existingSet.add(fid);
        added = true;
      }
    }
    if (!added) return;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: {
        id: anc.id,
        fieldVisibility: { mode: "show", fieldIds: Array.from(existingSet) },
      },
      emit: true,
    });
  });
}

// Parallel helper for table cells. A table column carries its own
// `fieldVisibility` at `tableOccurrence.meta.table.columns[colIndex]`. If
// that column is in `show` mode, append the new embed occurrence's fieldIds
// to the column's `fieldIds` list. Writes back via updateOccurrence using the
// `meta.table.columns` mutation pattern already used elsewhere in
// ContainerTable.
export function autoAppendFieldsToTableColumnShowMode({
  tableOccurrence,
  columnIndex,
  newOccurrence,
  ctx,
}) {
  if (!tableOccurrence || !newOccurrence || !ctx) return;
  if (typeof columnIndex !== "number" || columnIndex < 0) return;
  const { dispatch, socket, modulesById } = ctx;
  const table = tableOccurrence.meta?.table;
  const columns = Array.isArray(table?.columns) ? table.columns : null;
  if (!columns) return;
  const col = columns[columnIndex];
  const fv = col?.fieldVisibility;
  if (!fv || fv.mode !== "show") return;

  const newFieldIds = fieldIdsForOccurrence(newOccurrence, modulesById);
  if (newFieldIds.size === 0) return;

  const existing = Array.isArray(fv.fieldIds) ? fv.fieldIds : [];
  const merged = new Set(existing);
  let added = false;
  for (const fid of newFieldIds) {
    if (!merged.has(fid)) {
      merged.add(fid);
      added = true;
    }
  }
  if (!added) return;

  const nextColumns = columns.map((c, i) => {
    if (i !== columnIndex) return c;
    return {
      ...c,
      fieldVisibility: { mode: "show", fieldIds: Array.from(merged) },
    };
  });
  CommitHelpers.updateOccurrence({
    dispatch, socket,
    occurrence: {
      id: tableOccurrence.id,
      meta: {
        ...(tableOccurrence.meta || {}),
        table: { ...(table || {}), columns: nextColumns },
      },
    },
    emit: true,
  });
}
