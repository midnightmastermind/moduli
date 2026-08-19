/**
 * 0148 — Financial reads as a running total, not as "today".
 *
 * USER, 2026-08-19: *"make sure the tracker date isnt showing up on things that dont need it...
 * currently i dont have a filter set on the financial stuff and it still says Todays financials and
 * the tracker dates say today"* — and, asked which shape they wanted, **one `Financial` container,
 * cumulative by default, with `Spent` and `Income` keeping a date on the tile.**
 *
 * `Trackers: Date-Prefix Labels` walks EVERYTHING under the Trackers page in two unconditional
 * loops: containers get `"${$activeDatePossessive} ${moduleLabel}"`, tiles get `$activeDate`
 * stamped into `Tracker Date`. It cannot tell a daily figure from a running one, so a net worth
 * reads "today's".
 *
 * THE CLASSIFICATION IS DERIVED FROM EACH TILE'S OWN OP, NOT HAND-LISTED. For every display field a
 * tile shows, find the enabled operations that write it and collect their date comparators:
 *
 *     only DATE_IN_PERIOD          -> DAILY       (the figure is scoped to the active period)
 *     DATE_AFTER present, or none  -> CUMULATIVE  (a running balance, or no date scoping at all)
 *
 * Measured on the live grid, that rule classifies all nine correctly and needs no list:
 *
 *     daily        Spent · Income
 *     cumulative   Checking · Savings · Mom's · Cash · Net Worth · Subscriptions · Monthly Bills
 *
 * *A hand-written list is a second opinion that drifts the first time a tracker's op changes — the
 * same reason `sweepOrphans` reuses `planOrphanModules` rather than re-deriving "is this dead".*
 *
 * THE OP HAS TO CHANGE OR THE MIGRATION IS INERT. It re-labels on every load, so renaming the
 * container in the data alone would be undone within seconds — the "shipped and does nothing" class
 * this repo keeps paying for. Both loops gain one rule.
 *
 * THE GATE IS `IS_EMPTY` ON A MARKER, NOT A BOOLEAN COMPARISON. A rule's right-hand side is a
 * string, and comparing one to a stored `false` is the loose-equality guess `0112` avoided by
 * storing its cycle position as TEXT. An ABSENT marker is empty and keeps today's behaviour, so
 * every other container and tile on the page is untouched by construction.
 */
export const id = "0148-financial-is-cumulative";
export const describe = "Financial stops saying \"Today's\"; its cumulative tiles stop being date-stamped.";

const TRACKERS_PAGE = "5zaCM_ScvI7n";

/** daily <=> the figure is scoped to the active period and nothing else. */
export function classify(comparators) {
  const c = new Set(comparators);
  if (c.size === 0) return "cumulative";
  if (c.has("DATE_AFTER")) return "cumulative";
  return c.has("DATE_IN_PERIOD") ? "daily" : "cumulative";
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const byId = new Map(occs.map(o => [o.id, o]));
  const modById = new Map(mods.map(m => [m.id, m]));
  const fById = new Map(fields.map(f => [f.id, f]));
  const lbl = (o) => o?.label || modById.get(o?.moduleId)?.label || "?";
  const kids = (id) => (byId.get(id)?.occurrences || []).map(c => byId.get(c)).filter(Boolean);
  const enabled = ops.filter(o => o.enabled !== false);
  const raws = enabled.map(o => ({ name: o.name, raw: JSON.stringify(o.pipeline) }));

  const page = byId.get(TRACKERS_PAGE);
  if (!page) { log(`  REFUSING: no Trackers page ${TRACKERS_PAGE}`); return; }
  const fin = kids(page.id).find(c => /Financial/i.test(lbl(c)));
  if (!fin) { log("  REFUSING: no Financial container under the Trackers page"); return; }
  const TRACKER_DATE = fields.find(f => f.name === "Tracker Date" && f.displayEnabled)?.id;
  if (!TRACKER_DATE) { log("  REFUSING: no Tracker Date display field"); return; }

  // ---- classify every tile from its own writers --------------------------
  const daily = [], cumulative = [];
  for (const t of kids(fin.id)) {
    const m = modById.get(t.moduleId);
    const shows = (m.fieldBindings || []).filter(b => b.role === "display" && !b.hidden)
      .map(b => fById.get(b.fieldId)).filter(f => f && f.name !== "Tracker Date");
    const comps = new Set();
    for (const f of shows) for (const r of raws) {
      if (!r.raw.includes(f.id)) continue;
      for (const c of ["DATE_IN_PERIOD", "DATE_AFTER", "DATE_BEFORE", "SAME_DAY"]) {
        if (r.raw.includes(`"${c}"`)) comps.add(c);
      }
    }
    (classify(comps) === "daily" ? daily : cumulative).push({ occ: t, label: m.label, comps: [...comps] });
  }
  log(`  daily      : ${daily.map(d => d.label).join(", ") || "(none)"}`);
  log(`  cumulative : ${cumulative.map(d => d.label).join(", ") || "(none)"}`);
  if (!cumulative.length) { log("  REFUSING: nothing classified cumulative — the derivation is broken, not the grid"); return; }

  // ---- the op ------------------------------------------------------------
  const op = ops.find(o => /Date-Prefix/i.test(o.name));
  if (!op) { log("  REFUSING: the Date-Prefix op is not on this grid"); return; }
  const pipeline = JSON.parse(JSON.stringify(op.pipeline));
  const addRule = (cond, left, id) => {
    if ((cond.rules || []).some(r => r.left === left)) return false;
    cond.rules.push({ id, left, comparator: "IS_EMPTY", right: "" });
    return true;
  };
  let patched = 0;
  for (const step of pipeline.steps || []) {
    if (step.type !== "loop") continue;
    const iff = (step.body || []).find(b => b.type === "if");
    if (!iff?.condition?.rules) continue;
    const v = step.as;                                   // "$grp" or "$goal"
    const marker = v === "$grp" ? "noDatePrefix" : "cumulative";
    if (addRule(iff.condition, `${v}.meta.${marker}`, `cum-${marker}`)) {
      patched++; log(`  op: ${v} loop gains  ${v}.meta.${marker} IS_EMPTY`);
    }
  }
  if (!patched) log("  op already carries both guards");

  const containerNeedsFlag = !byId.get(fin.id)?.meta?.noDatePrefix;
  const staleLabel = fin.label && fin.label !== modById.get(fin.moduleId)?.label;
  const toStamp = cumulative.filter(c => !c.occ.meta?.cumulative);
  const toClear = cumulative.filter(c => c.occ.fields?.[TRACKER_DATE]?.value != null);
  log(`  container flag: ${containerNeedsFlag ? "to set" : "already set"} · label ${staleLabel ? `"${fin.label}" -> (module label)` : "already clean"}`);
  log(`  tiles to mark cumulative: ${toStamp.length} · tiles to clear a stamped date from: ${toClear.length}`);

  if (!patched && !containerNeedsFlag && !staleLabel && !toStamp.length && !toClear.length) {
    log("  already converged"); return;
  }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  if (patched) await Operation.updateOne({ id: op.id, gridId }, { $set: { pipeline } });
  if (containerNeedsFlag) await Occurrence.updateOne({ id: fin.id, gridId }, { $set: { "meta.noDatePrefix": true } });
  // Clearing the label lets it fall back to the MODULE label, "Financial" —
  // rather than writing that string a second time where it can drift.
  if (staleLabel) await Occurrence.updateOne({ id: fin.id, gridId }, { $set: { label: null } });
  for (const c of toStamp) await Occurrence.updateOne({ id: c.occ.id, gridId }, { $set: { "meta.cumulative": true } });
  for (const c of toClear) await Occurrence.updateOne({ id: c.occ.id, gridId }, { $unset: { [`fields.${TRACKER_DATE}`]: "" } });
  log("  done — RESTART pm2 and reload; the op re-labels on load, so judge it after both.");
}
