// Nine tracker tiles bound a field that another tile's op owned, so they were
// blank. Five of them get their own scoped tracker.
//
// User, 2026-09-05, asked for an audit of the trackers ("alot of them arent
// updating"). Driving the live sweep through the real executor and comparing
// what each op WRITES against what each tile BINDS, twelve display bindings
// under the Trackers page were written by nobody. The pattern is one thing:
//
//     a tile binds a display field that a DIFFERENT tile's tracker owns
//
// `Total Workouts` is written to `Fitness Stats`, not to `Workout Log`.
// `Time Spent` is written to `Reading Time`, and FOUR other tiles bind it.
// A tracker op is scoped to ONE goal occurrence, so the second tile gets
// nothing, forever, with no error anywhere.
//
// Asked which they wanted, the user chose: each tile gets its OWN number.
//
// ── THE SCOPE IS DERIVED FROM WHERE THE TILE LIVES ─────────────────────────
//
// Every one of these sits under a `Today's <Dimension>` container, and `Tags`
// already carries exactly those dimension values (social, creative, spiritual,
// occupational, environmental). So the dimension is READ OFF THE PARENT'S
// LABEL and checked against the tag values actually in use - if the derived tag
// is not a real one, the tile is REPORTED AND SKIPPED rather than given a
// tracker that silently sums nothing.
//
// ── IT CLONES THE EXEMPLAR RATHER THAN REBUILDING ──────────────────────────
//
// `makeTrackerOp` would regenerate these, and getting one of its gates wrong is
// invisible: a tracker that silently sums the wrong set still reads as a
// number. So each new op is a CLONE of the op that already computes that field
// correctly - Time Spent, Completed Tasks - with exactly two edits:
//
//   1. `$goalItem` repointed at this tile
//   2. one rule ANDed into every PER-ITEM gate: Tags CONTAINS <dimension>
//
// Every other gate the exemplar carries (the Schedule ancestor scope, the
// feed-copy exclusion, the date period, the completion test) rides along
// unchanged, which is the whole reason to clone.
//
// The per-item gates are found STRUCTURALLY - any predicate whose rules read
// `$item.` - not by position, so a pipeline that grows a loop still gets gated.
//
// Idempotent: a tile something already writes is left alone.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0290-each-tile-counts-its-own-dimension";
export const description =
  "Give five blank tracker tiles their own dimension-scoped op, cloned from the op that owns the field.";
export const touches = ["fields", "modules", "occurrences", "operations"];

// tile label -> the op that already computes that field correctly
const SPECS = [
  { tile: "Connection Time",   exemplar: "Time Spent" },
  { tile: "Creative Duration", exemplar: "Time Spent" },
  { tile: "Practice Duration", exemplar: "Time Spent" },
  { tile: "Work Duration",     exemplar: "Time Spent" },
  { tile: "Environment Care",  exemplar: "Completed Tasks" },
];

const rid = () => "r" + Math.random().toString(36).slice(2, 12);

// Any gate that tests a single item. Structural, so a loop added later is
// covered too. The key is `condition` (an if step) - `predicate` is checked as
// well so a shape change does not silently stop narrowing.
//
// IT WRAPS RATHER THAN APPENDS, and that is the load-bearing part: these
// conditions carry an `operator`, and several are OR groups. Pushing a rule
// into an OR would WIDEN the match - the tracker would sum MORE, not less,
// which is the opposite of scoping and would read as a plausible number.
// Wrapping in an explicit AND is correct whatever the original operator was,
// and `evalGroupAgainstRecord` has handled nested groups since 2026-05-03.
const gateEveryItemRule = (node, rule, count = { n: 0 }) => {
  if (!node || typeof node !== "object") return count;
  if (Array.isArray(node)) { for (const x of node) gateEveryItemRule(x, rule, count); return count; }
  for (const key of ["condition", "predicate"]) {
    const g = node[key];
    if (g && Array.isArray(g.rules) && touchesItem(g)) {
      node[key] = { operator: "AND", rules: [g, { ...rule, id: rid() }] };
      count.n++;
    }
  }
  for (const v of Object.values(node)) gateEveryItemRule(v, rule, count);
  return count;
};

// Does this group test the loop item anywhere, including inside nested groups?
const touchesItem = (g) => Array.isArray(g?.rules) && g.rules.some(
  (r) => (Array.isArray(r?.rules) ? touchesItem(r) : String(r?.left || "").startsWith("$item.")));

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const tagsHits = fields.filter((f) => f.name === "Tags");
  if (tagsHits.length !== 1) throw new Error(`field "Tags": ${tagsHits.length} matches - refusing`);
  const tagsFid = tagsHits[0].id;

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o.label || modById[o.moduleId]?.label;

  // Tag values ACTUALLY in use - a derived tag that matches none is a tracker
  // that would sum nothing.
  const liveTags = new Set();
  for (const o of occs) {
    const v = o.fields?.[tagsFid]?.value;
    if (Array.isArray(v)) v.forEach((x) => liveTags.add(String(x)));
    else if (v) liveTags.add(String(v));
  }

  const parentOf = new Map();
  for (const o of occs) for (const c of (o.occurrences || [])) if (!parentOf.has(c)) parentOf.set(c, o.id);
  const byId = Object.fromEntries(occs.map((o) => [o.id, o]));

  const ops = await Operation.find({ gridId: gid }).lean();

  let planned = 0;
  for (const spec of SPECS) {
    const tiles = occs.filter((o) => labelOf(o) === spec.tile);
    if (tiles.length !== 1) { log(`  ${spec.tile}: ${tiles.length} occurrences match - SKIPPED (ambiguous)`); continue; }
    const tile = tiles[0];

    if (ops.some((o) => o.enabled !== false && JSON.stringify(o.pipeline || {}).includes(tile.id))) {
      log(`  ${spec.tile}: an operation already writes this tile - left alone`); continue;
    }

    const parent = byId[parentOf.get(tile.id)];
    const plabel = parent ? String(labelOf(parent) || "") : "";
    const m = /^Today's\s+(.+)$/.exec(plabel);
    if (!m) { log(`  ${spec.tile}: parent "${plabel}" is not a Today's <Dimension> container - SKIPPED`); continue; }
    const dimension = m[1].trim().toLowerCase();
    if (!liveTags.has(dimension)) {
      log(`  ${spec.tile}: derived tag "${dimension}" is not a Tags value in use - SKIPPED`); continue;
    }

    const ex = ops.find((o) => o.name === spec.exemplar);
    if (!ex) { log(`  ${spec.tile}: exemplar "${spec.exemplar}" not found - SKIPPED`); continue; }

    const pipeline = JSON.parse(JSON.stringify(ex.pipeline || {}));
    const refs = [...new Set([...JSON.stringify(pipeline).matchAll(/\$allItemsById\.([A-Za-z0-9_-]+)/g)].map((x) => x[1]))];
    if (refs.length !== 1) { log(`  ${spec.tile}: exemplar names ${refs.length} picker-direct occurrences - SKIPPED (cannot tell which is the goal)`); continue; }
    const repointed = JSON.parse(JSON.stringify(pipeline).split(refs[0]).join(tile.id));

    const gated = gateEveryItemRule(repointed,
      { left: `$item.fields.${tagsFid}.value`, comparator: "CONTAINS", right: dimension });
    if (!gated.n) { log(`  ${spec.tile}: no per-item gate found to narrow - SKIPPED (would sum everything)`); continue; }

    log(`  ${spec.tile}: clone of "${spec.exemplar}" -> goal ${tile.id.slice(0, 8)}, ${gated.n} gate(s) narrowed to Tags CONTAINS "${dimension}"`);
    planned++;
    if (apply) {
      await Operation.create({
        ...ex,
        _id: undefined,
        id: "op" + Math.random().toString(36).slice(2, 12),
        name: spec.tile,
        description: `${spec.exemplar}, scoped to items tagged "${dimension}".`,
        pipeline: repointed,
      });
    }
  }
  if (!apply) log(`  DRY RUN - ${planned} operation(s) would be created. Pass --apply to write.`);
  else log(`  created ${planned} scoped tracker operation(s).`);
}
