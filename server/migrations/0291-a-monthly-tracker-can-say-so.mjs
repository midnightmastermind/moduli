// A monthly tracker could only say "Total".
//
// User, 2026-09-05: *"bills should be monthly (Tracker Date should reflect that
// based on Filter)"*.
//
// `Monthly Bills` sums exactly the bills whose Cadence IS monthly - the figure
// was always a monthly one - but its TILE said "Total", because
// `Trackers: Date-Prefix Labels` had only two states, chosen by one marker:
//
//     no meta.cumulative  ->  Tracker Date  = $activeDate     ("2026-09-05")
//     meta.cumulative     ->  Tracker Scope = "Total"
//
// A day or everything. There was no way to say "the month the filter is on",
// so a monthly tracker had to pick the wrong one of the two.
//
// ── THREE COORDINATED EDITS, AND ALL THREE ARE REQUIRED ────────────────────
//
//   1. the tile         meta.cumulative -> meta.period: "month"
//   2. the label op     a new loop for period tiles, writing $activeMonthLabel;
//                       and the DAILY loop learns to skip them
//   3. the bindings     Tracker Scope -> Tracker Date on the tile
//
// Skipping (2)'s second half is the trap: drop `meta.cumulative` alone and the
// existing daily loop claims the tile and stamps "2026-09-05" on it - a
// monthly total labelled with one day, which is worse than "Total" because it
// looks right.
//
// `$activeMonthLabel` is new in the executor and derives from the same active
// date every other label uses, so the tile cannot disagree with the page about
// which month is showing.
//
// Idempotent: converges once the tile carries meta.period and the op has the
// loop.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0291-a-monthly-tracker-can-say-so";
export const description =
  "Monthly Bills reports the month its filter is on instead of \"Total\".";
export const touches = ["fields", "modules", "occurrences", "operations"];

const rid = () => "m" + Math.random().toString(36).slice(2, 12);

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const one = (name) => {
    const hits = fields.filter((f) => f.name === name);
    if (hits.length !== 1) throw new Error(`field "${name}": ${hits.length} matches - refusing`);
    return hits[0].id;
  };
  const trackerDate = one("Tracker Date");
  const trackerScope = one("Tracker Scope");

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const tiles = occs.filter((o) => (o.label || modById[o.moduleId]?.label) === "Monthly Bills");
  if (tiles.length !== 1) throw new Error(`tile "Monthly Bills": ${tiles.length} matches - refusing`);
  const tile = tiles[0];

  // ---- 1: the tile ---------------------------------------------------------
  const meta = { ...(tile.meta || {}) };
  const already = meta.period === "month";
  if (already) log("  tile already marked period=month");
  else {
    delete meta.cumulative;
    meta.period = "month";
    log("  tile: meta.cumulative -> meta.period=\"month\"");
    if (apply) await Occurrence.updateOne({ id: tile.id, gridId: gid }, { $set: { meta } });
  }

  // ---- 2: the label op -----------------------------------------------------
  const op = await Operation.findOne({ gridId: gid, name: "Trackers: Date-Prefix Labels" }).lean();
  if (!op) throw new Error("no Trackers: Date-Prefix Labels operation - refusing");
  const pipeline = JSON.parse(JSON.stringify(op.pipeline || {}));

  // Find the loop that stamps the DAILY date, by what it writes - not by
  // position, so a reordered pipeline still resolves.
  const loops = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if ((n.config?.type || n.type) === "loop") loops.push(n);
    Object.values(n).forEach(walk);
  })(pipeline.steps);
  const writesField = (node, fid) => JSON.stringify(node).includes(`fields.${fid}.value`);
  const dailyLoop = loops.find((l) => writesField(l, trackerDate));
  if (!dailyLoop) throw new Error("no loop writing Tracker Date - shape changed, refusing");

  // The daily loop must SKIP a period tile, or it stamps one day on a monthly
  // total. Wrapped in an explicit AND for the same reason 0290 wraps.
  const gate = { left: "$goal.meta.period", comparator: "IS_EMPTY", right: "" };
  const already2 = JSON.stringify(dailyLoop).includes('"$goal.meta.period"');
  if (already2) log("  daily loop already skips period tiles");
  else {
    (function addGate(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(addGate); return; }
      for (const k of ["condition", "predicate"]) {
        const gr = n[k];
        if (gr && Array.isArray(gr.rules) && JSON.stringify(gr).includes("$goal.")) {
          n[k] = { operator: "AND", rules: [gr, { ...gate, id: rid() }] };
        }
      }
      Object.values(n).forEach(addGate);
    })(dailyLoop);
    log("  daily loop: + skip tiles carrying meta.period");
  }

  // The new monthly loop - a copy of the daily one, regated and rewritten, so
  // it inherits the same Trackers-page scope rather than inventing one.
  const hasMonthly = JSON.stringify(pipeline).includes("$activeMonthLabel");
  if (hasMonthly) log("  monthly loop already present");
  else {
    const monthly = JSON.parse(JSON.stringify(dailyLoop)
      .split('"$goal.meta.period","comparator":"IS_EMPTY"').join('"$goal.meta.period","comparator":"IS"')
      .split('"$activeDate"').join('"$activeMonthLabel"'));
    // `IS month` rather than `IS_NOT_EMPTY`, so a future period="week" gets its
    // own loop instead of silently borrowing this one's month label.
    const s = JSON.stringify(monthly).split('"comparator":"IS","right":""').join('"comparator":"IS","right":"month"');
    pipeline.steps.push(JSON.parse(s));
    log("  + monthly loop writing $activeMonthLabel to Tracker Date");
  }

  if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline } });

  // ---- 3: the bindings -----------------------------------------------------
  const mod = modById[tile.moduleId];
  let bindings = [...(mod.fieldBindings || [])];
  if (bindings.some((b) => b.fieldId === trackerDate)) log("  bindings already carry Tracker Date");
  else {
    bindings = bindings.filter((b) => b.fieldId !== trackerScope);
    bindings.push({ fieldId: trackerDate, role: "display" });
    log("  bindings: Tracker Scope -> Tracker Date");
    if (apply) await Module.updateOne({ id: mod.id, gridId: gid }, { $set: { fieldBindings: bindings } });
  }

  if (!apply) log("  DRY RUN - pass --apply to write.");
}
