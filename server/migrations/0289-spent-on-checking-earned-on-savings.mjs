// Spent and Earned were bound on account tiles that nothing wrote.
//
// User, 2026-09-05: *"spent should stay on checking account but savings account
// should be the one with the earned fields"*.
//
// Measured on the live grid, this is one instance of the audit's Class B - a
// tile binds a DISPLAY field that the owning tracker op writes to a DIFFERENT
// occurrence, so it renders empty forever:
//
//     Checking Account binds  Checking Balance, Spent, Earned
//     the `Spent`  op writes  -> the "Spent" tile   (not Checking)
//     the `Earned` op writes  -> the "Income" tile  (not Checking)
//     Savings Account binds   Savings Balance only
//
// So the account tiles showed a blank Spent and a blank Earned, and Savings had
// no Earned at all.
//
// TWO HALVES, AND BOTH ARE REQUIRED. Moving the BINDING alone leaves the field
// bound and still unwritten - the same empty box in a new place. Adding the
// WRITE alone leaves Savings with a value nothing renders. So:
//
//   1. Checking Account   drops `Earned`, keeps `Spent`
//   2. Savings Account    gains `Earned`
//   3. the `Spent`  op    ALSO writes its total to Checking Account
//   4. the `Earned` op    ALSO writes its total to Savings Account
//
// THE SECOND WRITE MIRRORS THE FIRST rather than inventing a shape: each op
// already ends its guarded branch with
// `UPDATE $goalItem.fields.<fid>.value = $acc`, so this appends an INIT_VAR
// naming the account tile picker-direct and an identical UPDATE beside it.
//
// STATED RATHER THAN IMPLIED: the account tiles now show the SAME total the
// Spent/Income tiles show - the op's existing Schedule-scoped figure. This does
// not compute "spent FROM checking" per account; no field on this grid records
// which account a purchase drew on. If that is what is wanted it is a different
// change (a per-account gate in the loop), not a second write.
//
// Idempotent: a tile already bound is left alone, and an op already writing to
// the account tile is not appended to twice.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0289-spent-on-checking-earned-on-savings";
export const description =
  "Account tiles show a figure something actually writes: Spent on Checking, Earned on Savings.";
export const touches = ["fields", "modules", "occurrences", "operations"];

const rid = () => "s" + Math.random().toString(36).slice(2, 12);

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const oneField = async (name) => {
    const hits = await Field.find({ gridId: gid, name }).lean();
    if (hits.length !== 1) throw new Error(`field "${name}": ${hits.length} matches - refusing`);
    return hits[0].id;
  };
  const spentF = await oneField("Spent");
  const earnedF = await oneField("Earned");

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const tile = (label) => {
    const hits = occs.filter((o) => (o.label || modById[o.moduleId]?.label) === label);
    if (hits.length !== 1) throw new Error(`tile "${label}": ${hits.length} matches - refusing`);
    return hits[0];
  };
  const checking = tile("Checking Account");
  const savings = tile("Savings Account");

  // ---- 1 + 2: the bindings -------------------------------------------------
  const rebind = async (occ, addFid, dropFid) => {
    const mod = modById[occ.moduleId];
    let bindings = [...(mod.fieldBindings || [])];
    const label = occ.label || mod.label;
    let changed = false;
    if (dropFid && bindings.some((b) => b.fieldId === dropFid)) {
      bindings = bindings.filter((b) => b.fieldId !== dropFid);
      log(`  ${label}: unbind ${dropFid.slice(0, 8)}`); changed = true;
    }
    if (addFid && !bindings.some((b) => b.fieldId === addFid)) {
      // Placed after the balance so the tile reads balance-then-flow, matching
      // Checking's own order rather than appending below the Category input.
      const at = bindings.findIndex((b) => b.role === "input");
      const entry = { fieldId: addFid, role: "display" };
      if (at === -1) bindings.push(entry); else bindings.splice(at, 0, entry);
      log(`  ${label}: bind ${addFid.slice(0, 8)} (display)`); changed = true;
    }
    if (changed && apply) await Module.updateOne({ id: mod.id, gridId: gid }, { $set: { fieldBindings: bindings } });
    if (!changed) log(`  ${label}: bindings already correct`);
  };
  await rebind(checking, null, earnedF);
  await rebind(savings, earnedF, null);

  // ---- 3 + 4: the second write --------------------------------------------
  const alsoWrite = async (opName, targetOcc, fieldId) => {
    const op = await Operation.findOne({ gridId: gid, name: opName }).lean();
    if (!op) { log(`  ${opName}: no such operation - skipped`); return; }
    const pipeline = JSON.parse(JSON.stringify(op.pipeline || {}));
    if (JSON.stringify(pipeline).includes(targetOcc.id)) { log(`  ${opName}: already writes to ${opName === "Spent" ? "Checking" : "Savings"} - left alone`); return; }

    // The guarded branch that already carries the goal UPDATE.
    const ifStep = (pipeline.steps || []).find((s) => (s.config?.type || s.type) === "if" && Array.isArray(s.then));
    if (!ifStep) throw new Error(`${opName}: no top-level if/then to append to - refusing`);
    const hasUpdate = ifStep.then.some((s) => (s.config?.type || s.type) === "UPDATE");
    if (!hasUpdate) throw new Error(`${opName}: the guarded branch has no UPDATE - shape changed, refusing`);

    const varName = "$acctItem";
    ifStep.then.push(
      { id: rid(), type: "action", config: { type: "INIT_VAR", name: varName, expr: `$allItemsById.${targetOcc.id}` } },
      { id: rid(), type: "action", config: { type: "UPDATE", path: `${varName}.fields.${fieldId}.value`, value: "$acc" } },
    );
    log(`  ${opName}: + writes $acc to ${targetOcc.label || modById[targetOcc.moduleId]?.label}.${fieldId.slice(0, 8)}`);
    if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline } });
  };
  await alsoWrite("Spent", checking, spentF);
  await alsoWrite("Earned", savings, earnedF);

  if (!apply) log("  DRY RUN - pass --apply to write.");
}
