// server/migrations/0073-tracker-date-tiles-only.mjs
//
// USER, 2026-08-11: *"the Date display field is not on every tracker atm and
// shouldnt be shown on the container headers. just the individuaL trackers"* and
// *"the filter date is enough for the containers."*
//
// ── BOTH SYMPTOMS ARE ONE MISTAKE IN 0072 ───────────────────────────────────
//
// That migration collected tile modules by walking exactly TWO levels
// (page -> container -> tile) and binding whatever it found, without checking
// ROLE. Measured now:
//
//   46  instance   the real tracker tiles — 31 bound, 15 MISSED
//   14  container  4 of them bound, so the field renders in their HEADER
//
// The 15 missed are all at depth 3: `Reps`, `Workout Log`, the six Volume tiles,
// `Meal Log`, `Meal Nutrition`, `Movies`, `Books`, `Podcasts`, `Overdue` — the
// tiles inside the nested Workout / Nutrition / Media / Planning groups that the
// 2026-07-30 restructure created. A fixed-depth walk cannot see them, and will
// keep missing whatever gets nested next.
//
// So the rule is the INVARIANT rather than a depth: **every instance-role
// occurrence under the Trackers page, at any depth; no container, ever.**
//
// ── WHY CONTAINERS ARE WRONG RATHER THAN MERELY REDUNDANT ───────────────────
//
// A container renders its fields in its HEADER, beside the title — and the title
// already carries the date: `Trackers: Date-Prefix Labels` stamps
// "Today's Physical" on it. So the header showed the date twice, once as prose
// and once as an empty pill. Empty because the op loops `$allInstances`, which
// never had containers in it — the binding promised a value nothing would write.
//
// ── THE OP NEEDS NO CHANGE, and that is worth stating ───────────────────────
//
// Its tile loop is `over $allInstances` gated by `_ancestors HAS_ANCESTOR
// <Trackers page>` — role-filtered and ancestor-scoped at ANY depth. It already
// covers all 46. Only the bindings were wrong, so only the bindings move.

export const id = "0073-tracker-date-tiles-only";
export const describe =
  "Bind Tracker Date on every instance-role tracker tile at any depth, and unbind it from the "
  + "container headers — 0072 walked a fixed two levels and did not check role.";

const FIELD_NAME = "Tracker Date";
const TRACKERS_PAGE = "Trackers";

/**
 * Every occurrence under `rootId`, at any depth, paired with its role.
 *
 * Depth-agnostic on purpose: the tracker tree has been re-nested twice already
 * (2026-07-30 grouped Workout/Nutrition under Physical, Media under
 * Intellectual), and a fixed walk silently misses whatever moves next.
 *
 * Exported so the test drives the REAL traversal.
 */
export function collectSubtree(rootId, { occById, roleOf }) {
  const out = [];
  const seen = new Set([rootId]);
  const walk = (id, depth) => {
    if (depth > 12) return;                       // cycle/pathological guard
    for (const kid of (occById.get(id)?.occurrences || [])) {
      if (seen.has(kid)) continue;
      seen.add(kid);
      out.push({ id: kid, role: roleOf(kid), depth: depth + 1 });
      walk(kid, depth + 1);
    }
  };
  walk(rootId, 0);
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;

  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const occById = new Map(occs.map((o) => [o.id, o]));
  const modById = new Map(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(unlabelled)";
  const roleOf = (id) => modById.get(occById.get(id)?.moduleId)?.role;

  const field = fields.find((f) => f.name === FIELD_NAME);
  if (!field) { log(`  · no "${FIELD_NAME}" field on this grid — 0072 has not run here`); return; }

  const page = occs.find((o) => modById.get(o.moduleId)?.role === "page" && labelOf(o) === TRACKERS_PAGE);
  if (!page) { log(`  · no "${TRACKERS_PAGE}" page on this grid — nothing to do`); return; }

  const subtree = collectSubtree(page.id, { occById, roleOf });
  const tileModuleIds = new Set();
  const containerModuleIds = new Set();
  for (const n of subtree) {
    const mid = occById.get(n.id)?.moduleId;
    if (!mid) continue;
    if (n.role === "instance") tileModuleIds.add(mid);
    else if (n.role === "container") containerModuleIds.add(mid);
  }
  log(`  · under "${TRACKERS_PAGE}": ${subtree.filter((n) => n.role === "instance").length} instance(s) `
    + `across depths ${[...new Set(subtree.filter((n) => n.role === "instance").map((n) => n.depth))].sort().join("/")}, `
    + `${subtree.filter((n) => n.role === "container").length} container(s)`);

  const hasField = (mod) => (mod?.fieldBindings || []).some((b) => b.fieldId === field.id);

  // ── bind every tile that lacks it ─────────────────────────────────────────
  let bound = 0, alreadyBound = 0;
  for (const mid of tileModuleIds) {
    const mod = modById.get(mid);
    if (!mod) continue;
    if (hasField(mod)) { alreadyBound += 1; continue; }
    bound += 1;
    log(`      + ${labelOf(occs.find((o) => o.moduleId === mid))}`);
    if (!dryRun) {
      const bindings = Array.isArray(mod.fieldBindings) ? mod.fieldBindings : [];
      await Module.updateOne({ gridId, id: mid }, {
        $set: { fieldBindings: [...bindings, { fieldId: field.id, role: "display", order: bindings.length }] },
      });
    }
  }

  // ── unbind every container that has it ────────────────────────────────────
  // Surgical: pulls only this fieldId and leaves every other binding untouched.
  // A whole-array write would carry a stale copy of the rest back over anything
  // else that changed (the createPageInContainer clobber, as a class).
  let unbound = 0;
  for (const mid of containerModuleIds) {
    const mod = modById.get(mid);
    if (!mod || !hasField(mod)) continue;
    unbound += 1;
    log(`      - ${labelOf(occs.find((o) => o.moduleId === mid))}  (its label already carries the date)`);
    if (!dryRun) {
      await Module.updateOne({ gridId, id: mid }, {
        $set: { fieldBindings: (mod.fieldBindings || []).filter((b) => b.fieldId !== field.id) },
      });
    }
  }

  log(`  ✓ tiles: ${bound} newly bound, ${alreadyBound} already had it`);
  log(`  ✓ containers: ${unbound} unbound`);
}
