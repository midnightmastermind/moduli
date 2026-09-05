// Net Worth counted Mom's Account and not Cash.
//
// User, 2026-09-05: *"net worth should also be the total of checking and
// savings and cash, not my moms account"*, then *"cash is also an account"*.
//
// The stored pipeline sums three loops over $allInstances, each gated on a
// balance field being non-empty:
//
//     Checking Balance  +  Savings Balance  +  Mom's Account
//
// Mom's Account is money the user manages, not money the user HAS, so it does
// not belong in a personal net worth. Cash does, and had no loop at all.
//
// THE EDIT IS THE THIRD LOOP'S FIELD, BOTH PLACES. A loop like this names its
// field TWICE - once in the `if` rule that decides whether a row counts
// (`IS_NOT_EMPTY`), once in the `ADD_TO_VAR` that sums it. Changing only the
// sum leaves the loop gated on rows carrying MOM'S balance while adding their
// CASH - which on this grid would silently total zero, because no row carries
// both. Every occurrence of the old field id inside that one loop is swapped.
//
// SCOPED TO THE ONE LOOP, not the pipeline: `Mom's Account` legitimately keeps
// its own tracker op and its own tile, and a blind find-and-replace across the
// operation would also rewrite anything else naming it.
//
// It refuses unless it finds EXACTLY one loop summing Mom's Account, so a
// pipeline that has since been restructured fails loudly instead of writing a
// half-edit.
import Operation from "../models/Operation.js";
import Field from "../models/Field.js";

export const id = "0288-net-worth-counts-cash-not-moms";
export const description =
  "Net Worth = Checking + Savings + Cash; Mom's Account is money managed, not owned.";
export const touches = ["operations", "fields"];

const findLoops = (steps, out = []) => {
  for (const s of steps || []) {
    const c = s.config || {};
    if ((c.type || s.type) === "loop") out.push(s);
    for (const k of ["steps", "then", "else", "body", "children"]) if (Array.isArray(s[k])) findLoops(s[k], out);
    if (Array.isArray(c.steps)) findLoops(c.steps, out);
  }
  return out;
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const one = async (name) => {
    const hits = await Field.find({ gridId: gid, name, type: "number" }).lean();
    if (hits.length !== 1) throw new Error(`field "${name}": ${hits.length} matches - refusing (ambiguous)`);
    return hits[0].id;
  };
  const moms = await one("Mom's Account");
  const cash = await one("Cash");

  const op = await Operation.findOne({ gridId: gid, name: "Net Worth" }).lean();
  if (!op) { log("  no Net Worth operation - nothing to do"); return; }

  const loops = findLoops(op.pipeline?.steps);
  const momLoops = loops.filter((l) => JSON.stringify(l).includes(moms));
  const cashLoops = loops.filter((l) => JSON.stringify(l).includes(cash));
  log(`  loops: ${loops.length} | summing Mom's Account: ${momLoops.length} | summing Cash: ${cashLoops.length}`);

  if (cashLoops.length && !momLoops.length) { log("  already converged - Cash is summed, Mom's is not."); return; }
  if (momLoops.length !== 1) throw new Error(`expected exactly ONE loop summing Mom's Account, found ${momLoops.length}`);

  // Swap the field id everywhere INSIDE that one loop - the gate and the sum.
  const before = JSON.stringify(momLoops[0]);
  const occurrences = (before.match(new RegExp(moms, "g")) || []).length;
  const after = before.split(moms).join(cash);
  log(`  swapping ${occurrences} reference(s) to Mom's Account -> Cash inside that loop`);
  if (occurrences < 2) log("     NOTE: fewer than 2 - the gate and the sum should BOTH name it; check the shape");

  const pipeline = JSON.parse(JSON.stringify(op.pipeline).split(before).join(after));
  if (JSON.stringify(pipeline).includes(moms)) log("     (Mom's Account still referenced elsewhere in the op - left alone deliberately)");

  if (!apply) { log("  DRY RUN - pass --apply to write."); return; }
  await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline } });
  log("  Net Worth now sums Checking + Savings + Cash.");
}
