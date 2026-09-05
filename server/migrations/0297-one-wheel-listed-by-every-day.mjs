// One wheel, listed by every day - not a clone per day.
//
// `0046` rebuilt the Emotions Wheel (2026-09-05) and `0296` pointed the op at
// it. That left the wheel where 0046 puts it: as a CHILD OF THE DAY TEMPLATE.
// So `Day Page: Build`'s merge clones it into every column, and the grid ends
// up with one wheel per day while the op is scoped to exactly ONE occurrence
// id - which is the defect 2026-08-11 already diagnosed and chose the fix for:
//
//     *"a trigger scoped by occurrence id matches exactly ONE occurrence, so
//      clicking a wheel on any real day column matched nothing"*
//
// and the user's call then was ONE wheel, multi-parented. The alternative -
// letting APPLY_TEMPLATE carry the feed - materialises ~130 occurrences AND
// ~130 modules per day, forever.
//
// ── THE MECHANISM WAS NEVER MISSING. IT NAMED A DEAD ID. ───────────────────
//
// `Day Page: Build` still carries the step that shape needs:
//
//     ADD_CHILD  parentId=$colId  childId=289583d9...
//
// pointing at the occurrence that no longer exists. ADD_CHILD on a missing
// child is a silent no-op, so no column ever listed a shared wheel and merge
// filled the gap with a clone. Two edits, both small:
//
//   1. that childId -> the rebuilt wheel
//   2. the wheel is UNLISTED from the day template, so merge stops cloning it
//
// (2) is what makes (1) stick. With the wheel still a template child, merge
// clones one into the column BEFORE the ADD_CHILD runs and every day ends with
// two. Unlisting is what the original fix did too.
//
// The wheel KEEPS its `parentId` on the template - that is its home and where
// its feed config lives; only the template's `occurrences[]` stops naming it,
// which is precisely the difference between "is cloned by merge" and "is not".
//
// ADD_CHILD appends to a column's occurrences[] and never touches the child's
// own parentId, so one occurrence is listed by every day without forking - and
// it is idempotent, which is what makes a rebuild free.
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import Operation from "../models/Operation.js";

export const id = "0297-one-wheel-listed-by-every-day";
export const description = "Day Page: Build lists the one Emotions Wheel instead of cloning it per day.";
export const touches = ["modules", "occurrences", "operations"];

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const graphMods = await Module.find({ gridId: gid, role: "container", kind: "graph" }).lean();
  if (!graphMods.length) throw new Error("no graph module - run 0046 first");
  const graphModIds = graphMods.map((m) => m.id);
  const wheels = await Occurrence.find({ gridId: gid, moduleId: { $in: graphModIds } }).lean();
  if (!wheels.length) throw new Error("no wheel occurrence - refusing");

  // THE SHARED ONE IS THE ONE THE OP IS SCOPED TO. Picking "the template's" by
  // parentage would be a second opinion that can disagree with the op.
  const op = await Operation.findOne({ gridId: gid, name: "Mood: Record Selection" }).lean();
  const wheelId = op?.targetOccurrenceId;
  const wheel = wheels.find((w) => w.id === wheelId);
  if (!wheel) throw new Error(`the Mood op names ${wheelId}, which is not one of the ${wheels.length} wheel occurrence(s) - run 0296 first`);
  log(`  shared wheel: ${wheel.id} (the one Mood: Record Selection is scoped to)`);

  // ---- 1: the ADD_CHILD names the live wheel ------------------------------
  const build = await Operation.findOne({ gridId: gid, name: "Day Page: Build" }).lean();
  if (!build) throw new Error("no Day Page: Build - refusing");
  let pipe = JSON.stringify(build.pipeline);
  const shares = [...pipe.matchAll(/"type":"ADD_CHILD","parentId":"\$colId","childId":"([^"]+)"/g)].map((m) => m[1]);
  const stale = shares.filter((s) => !s.startsWith("$") && s !== wheel.id);
  if (!stale.length) log("  the shared ADD_CHILD already names a live occurrence");
  else {
    for (const s of stale) {
      const exists = await Occurrence.findOne({ gridId: gid, id: s }).lean();
      log(`  ADD_CHILD childId ${s.slice(0, 12)} (${exists ? "exists" : "MISSING"}) -> ${wheel.id.slice(0, 12)}`);
      pipe = pipe.split(`"childId":"${s}"`).join(`"childId":"${wheel.id}"`);
    }
    if (apply) await Operation.updateOne({ id: build.id, gridId: gid }, { $set: { pipeline: JSON.parse(pipe) } });
  }

  // ---- 2: unlist it from the template so merge stops cloning --------------
  const listers = await Occurrence.find({ gridId: gid, occurrences: wheel.id }).lean();
  const template = listers.find((l) => l.id === wheel.parentId);
  if (!template) log("  the template does not list the wheel - already unlisted");
  else {
    log(`  unlisting the wheel from its template (${template.id.slice(0, 12)}) so merge stops cloning it`);
    if (apply) await Occurrence.updateOne({ id: template.id, gridId: gid }, { $pull: { occurrences: wheel.id } });
  }

  // ---- 3: the clones merge already made ------------------------------------
  const clones = wheels.filter((w) => w.id !== wheel.id);
  if (!clones.length) log("  no per-day clones to remove");
  else {
    log(`  removing ${clones.length} per-day clone(s) and listing the shared wheel in their place`);
    if (apply) {
      for (const c of clones) {
        const parents = await Occurrence.find({ gridId: gid, occurrences: c.id }).lean();
        for (const p of parents) {
          await Occurrence.updateOne({ id: p.id, gridId: gid }, { $pull: { occurrences: c.id } });
          await Occurrence.updateOne({ id: p.id, gridId: gid }, { $addToSet: { occurrences: wheel.id } });
        }
        await Occurrence.deleteOne({ id: c.id, gridId: gid });
      }
    }
  }

  if (!apply) log("  DRY RUN - pass --apply to write.");
}
