// 0466 — Grid: Snap Filter To Today also snaps a window that opens on a PAST date (user, 2026-10-31: "loading up today
// still didnt change the top toolbar filter to today" · "this all should be done via operations, not hardcoded").
// The op snapped only when the grid's Last Opened marker was not today. That marker is one row for the whole grid, while
// each window keeps its own date (helpers/windowLayout, 2026-10-24): once one window loaded today, every other window
// that reopened on yesterday's date found the marker already stamped and kept yesterday. Now the op snaps when EITHER
// the marker is not today OR the date this window opens on is before today. A future date is left alone.
//
//   INIT $openMarker                                         (kept)
//   INIT $snapStale = no
//   IF marker SAME_DAY $today  then []  else [$snapStale = yes]      (the old IF, its else body moved below)
//   IF $activeDate DATE_BEFORE $today  then [$snapStale = yes]
//   IF $snapStale IS yes  then [the old else body: SET_FILTER today, move dated pages, stamp the marker]
export const id = "0466-snap-today-when-date-is-past";
export const describe = "Snap Filter To Today also runs when the window opens on a date before today.";
export const touches = ["operations"];

const OP_NAME = "Grid: Snap Filter To Today";
const FLAG = "$snapStale";

const isMarkerIf = (s) => s?.type === "if"
  && (s.condition?.rules || []).some((r) => r.comparator === "SAME_DAY" && r.right === "$today" && /^\$openMarker\./.test(r.left || ""));

/** Pure. Returns { pipeline, changed }. Idempotent; throws when the shape it rewrites is not there. */
export function snapWhenStale(pipeline) {
  const steps = pipeline?.steps || [];
  if (steps.some((s) => s?.config?.name === FLAG)) return { pipeline, changed: 0 };
  const at = steps.findIndex(isMarkerIf);
  if (at < 0 || steps.filter(isMarkerIf).length !== 1) throw new Error("expected exactly 1 marker IF");
  const old = steps[at];
  const body = old.else || [];
  if (!body.some((s) => s?.config?.type === "SET_FILTER")) throw new Error("the marker IF's else holds no SET_FILTER");
  const setFlag = (id) => ({ id, type: "action", config: { type: "SET_VAR", name: FLAG, expr: "literal:yes" } });
  const next = [
    ...steps.slice(0, at),
    { id: "snapStaleInit", type: "action", config: { type: "INIT_VAR", name: FLAG, expr: "literal:no" } },
    { ...old, else: [setFlag("snapStaleMarker")] },
    { id: "snapStalePast", type: "if",
      condition: { operator: "AND", rules: [{ id: "snapStalePastRule", left: "$activeDate", comparator: "DATE_BEFORE", right: "$today" }] },
      then: [setFlag("snapStalePastSet")], else: [] },
    { id: "snapStaleRun", type: "if",
      condition: { operator: "AND", rules: [{ id: "snapStaleRunRule", left: FLAG, comparator: "IS", right: "yes" }] },
      then: body, else: [] },
    ...steps.slice(at + 1),
  ];
  return { pipeline: { ...pipeline, steps: next }, changed: 1 };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`  no "${OP_NAME}" — nothing to do`); return; }
  const { pipeline, changed } = snapWhenStale(op.pipeline);
  log(`  ${OP_NAME}: ${changed ? "rewritten" : "already done"}`);
  if (!dryRun && changed) {
    await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline, updatedAt: new Date() } });
    log("  applied. RESTART pm2.");
  }
}
