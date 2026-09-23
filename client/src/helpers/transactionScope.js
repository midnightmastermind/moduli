// client/src/helpers/transactionScope.js
//
// DOES THIS TRANSACTION BELONG TO THIS MODULE?
//
// `ui/TransactionHistory` opens per-module from every container's and panel's
// radial ("Module History"), and it showed NOTHING on any grid. Measured
// 2026-09-22:
//
//   rebuild   242 transactions   200 SnapshotOp — operations[] EMPTY, the
//                                payload is docs[]; 42 MeasureOp whose measure
//                                is { occurrenceId, fieldId, value, flow }
//   poms     1200 transactions   15,831 measure payloads and ZERO carrying
//                                panelId or containerId; no occurrence_list or
//                                entity ops at all
//
// The old filter asked for `measure.panelId` / `measure.containerId` /
// `occurrence_list.*.containerId` / `entity.moduleId`, so it could not match a
// single row. What a transaction actually names is an OCCURRENCE — or the
// module itself, for a module write — and that is what this reads.
//
// The legacy shapes are kept: they cost one comparison and a grid whose older
// transactions carry them should keep working.

/**
 * @param tx    a transaction record ({ docs?, operations? })
 * @param scope { moduleId, occurrenceIds } — occurrenceIds is a Set of the
 *              occurrence ids that render this module. Without a moduleId every
 *              transaction belongs (the grid-wide panel).
 */
export function transactionTouchesModule(tx, { moduleId, occurrenceIds } = {}) {
  if (!moduleId) return true;
  if (!tx) return false;
  const ids = occurrenceIds instanceof Set ? occurrenceIds : new Set(occurrenceIds || []);

  // SnapshotOp — the shape every write takes now. A doc names the row it wrote
  // (or the module, for a module write).
  for (const d of tx.docs || []) {
    if (!d?.id) continue;
    if (d.id === moduleId || ids.has(d.id)) return true;
  }

  for (const op of tx.operations || []) {
    const mo = op?.measure;
    if (mo) {
      if (mo.occurrenceId && ids.has(mo.occurrenceId)) return true;
      // legacy: some grids' measures carried the surface ids directly
      if (mo.panelId === moduleId || mo.containerId === moduleId) return true;
    }
    const list = op?.occurrence_list;
    if (list && (list.from?.containerId === moduleId || list.to?.containerId === moduleId)) return true;
    if (op?.entity?.moduleId === moduleId) return true;
  }
  return false;
}
