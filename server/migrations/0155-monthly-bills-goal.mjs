/**
 * 0155 — Total Subscriptions goes; Monthly Bills becomes paid-vs-due.
 *
 * USER, 2026-08-20: *"get rid of the total subscriptions and monthly bills
 * should be a monthly goal totalling the amount of bills vs what i paid so far."*
 *
 * **TOTAL SUBSCRIPTIONS WAS A SUBSET OF MONTHLY BILLS, which is the case for
 * removing it rather than just the instruction.** Measured: `Subscriptions` is a
 * CHILD of `Bills`, and `Monthly Bills` sums `Amount` over everything with
 * `HAS_ANCESTOR Bills` — so the £30.97 of subscriptions was already inside the
 * £2,220.97 total and the tile showed a slice of its neighbour.
 *
 *     Bills (11 rows, 2220.97/month)
 *       Subscriptions   Netflix 15.99 · Spotify 11.99 · iCloud+ 2.99   = 30.97
 *       Utilities       Electric 95 · Water 38 · Internet 65 · Phone 55
 *       Insurance       Car 180 · Renter 22
 *       Loans           Student Loan 285
 *       Other           Rent / Mortgage 1450
 *
 * **THE GOAL IS PAID-AGAINST-DUE.** `Monthly Bills` already computes the amount
 * DUE, so what was missing is the other half: a new `Bills Paid` display field
 * summing the same rows where `Completed` is true, with the month's total as its
 * TARGET so it renders as progress rather than a bare number.
 *
 * THE TARGET IS COMPUTED AT APPLY TIME, NOT TYPED. It is the sum this migration
 * measures (2220.97 today), so it cannot be keyed in wrong — but it is a STATIC
 * number on the field, and adding a bill changes what is due without changing
 * the target. **Stated rather than hidden:** re-run this migration after
 * changing a bill, or the goal quietly measures against last month's total.
 * A dynamic target would need `displayConfig` to be writable by an op, which it
 * is not.
 *
 * NOTHING IS DELETED THAT HOLDS DATA. The subscription ROWS stay exactly where
 * they are and keep counting toward the bills total; only the redundant tile and
 * its op go.
 */
export const id = "0155-monthly-bills-goal";
export const describe = "Remove the redundant Total Subscriptions tile; add Bills Paid against the month's total.";

const BILLS = "X5Of8jcGO4II";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const byId = new Map(occs.map(o => [o.id, o]));
  const modById = new Map(mods.map(m => [m.id, m]));
  const AMT = fields.find(f => f.name === "Amount" && !f.displayEnabled);
  const CMP = fields.find(f => f.name === "Completed" && !f.displayEnabled);
  if (!AMT || !CMP) { log("  REFUSING: no Amount / Completed field"); return; }
  if (!byId.get(BILLS)) { log(`  REFUSING: no Bills container ${BILLS}`); return; }

  // ---- the month's total, measured from the tree -------------------------
  const under = (rootId) => {
    const out = []; const walk = (id) => {
      for (const c of byId.get(id)?.occurrences || []) { out.push(byId.get(c)); walk(c); } };
    walk(rootId); return out.filter(Boolean);
  };
  // THE TARGET ASKS THE SAME QUESTION THE OP ASKS. The first version summed
  // every bill with an amount and got 2220.97, while the `Monthly Bills` op
  // showed 2040.97 — because that op requires `Cadence IS "monthly"`, and Car
  // Insurance is `every-n-days`. **The op was right and my sum was wrong**: a
  // yearly premium is not part of what is due this month. Two things answering
  // "what is due this month" must ask it identically, which is the same rule
  // this migration's own header states about Subscriptions being a subset.
  const CAD = fields.find(f => f.name === "Cadence");
  if (!CAD) { log("  REFUSING: no Cadence field — cannot tell a monthly bill from a yearly one"); return; }
  const all = under(BILLS).filter(o => Number(o.fields?.[AMT.id]?.value) > 0 && !o.meta?.feedSourceId);
  const rows = all.filter(o => o.fields?.[CAD.id]?.value === "monthly");
  const total = rows.reduce((n, o) => n + Number(o.fields[AMT.id].value), 0);
  const skipped = all.filter(o => !rows.includes(o))
    .map(o => `${o.label || modById.get(o.moduleId)?.label} (${o.fields?.[CAD.id]?.value})`);
  log(`  bills with an amount: ${all.length} · MONTHLY: ${rows.length} · month total ${total.toFixed(2)}`);
  if (skipped.length) log(`  not monthly, excluded: ${skipped.join(", ")}`);
  if (!rows.length) { log("  REFUSING: no bill carries an amount — the walk is broken, not the data"); return; }

  // ---- retire Total Subscriptions ----------------------------------------
  const subsOp = ops.find(o => o.name === "Total Subscriptions");
  const subsMod = mods.find(m => m.label === "Total Subscriptions" && m.role === "instance");
  const subsOccs = subsMod ? occs.filter(o => o.moduleId === subsMod.id) : [];
  log(`  Total Subscriptions: op ${subsOp ? "to remove" : "absent"} · tile ${subsMod ? `to remove (${subsOccs.length} placement)` : "absent"}`);

  const existingPaid = fields.find(f => f.name === "Bills Paid" && f.displayEnabled);
  const billsMod = mods.find(m => m.label === "Monthly Bills" && m.role === "instance");
  if (!billsMod) { log("  REFUSING: no Monthly Bills tile to add the goal to"); return; }
  log(`  "Bills Paid": ${existingPaid ? "present" : "to create"} · target ${total.toFixed(2)}`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  const uid = () => Math.random().toString(36).slice(2, 14);
  let paidId = existingPaid?.id;
  if (!paidId) {
    paidId = uid();
    await Field.create({ id: paidId, gridId, userId: billsMod.userId, name: "Bills Paid",
      type: "number", unit: "", inputEnabled: false, displayEnabled: true,
      displayConfig: { targetValue: Number(total.toFixed(2)) }, meta: {} });
    log(`  created "Bills Paid" with target ${total.toFixed(2)}`);
  } else {
    await Field.updateOne({ id: paidId, gridId }, { $set: { "displayConfig.targetValue": Number(total.toFixed(2)) } });
    log(`  refreshed the target to ${total.toFixed(2)}`);
  }
  if (!(billsMod.fieldBindings || []).some(b => b.fieldId === paidId)) {
    await Module.updateOne({ id: billsMod.id, gridId }, { $push: { fieldBindings:
      { fieldId: paidId, order: (billsMod.fieldBindings || []).length, role: "display" } } });
    log(`  bound "Bills Paid" to the Monthly Bills tile`);
  }

  // ---- the op that fills it ----------------------------------------------
  const billsOp = ops.find(o => o.name === "Monthly Bills");
  if (!billsOp) { log("  REFUSING: the Monthly Bills op is gone"); return; }
  const billsOcc = occs.find(o => o.moduleId === billsMod.id);
  const A = (config) => ({ id: uid(), type: "action", config });
  const rule = (left, comparator, right = "") => ({ id: uid(), left, comparator, right });
  const steps = [
    A({ type: "INIT_VAR", name: "$tile", expr: `$allItemsById.${billsOcc.id}` }),
    A({ type: "INIT_VAR", name: "$paid", value: 0 }),
    { id: uid(), type: "loop", overExpr: "$allInstances", as: "$item", body: [
      { id: uid(), type: "if", condition: { operator: "AND", rules: [
        rule("$item._ancestors", "HAS_ANCESTOR", BILLS),
        rule("$item.meta.feedSourceId", "IS_EMPTY"),
        rule(`$item.fields.${CMP.id}.value`, "IS", true),
        rule(`$item.fields.${AMT.id}.value`, "IS_NOT_EMPTY"),
      ] }, then: [ A({ type: "ADD_TO_VAR", name: "$paid", expr: `$item.fields.${AMT.id}.value` }) ], else: [] },
    ] },
    A({ type: "UPDATE", path: `$tile.fields.${paidId}.value`, value: "$paid" }),
  ];
  await Operation.deleteOne({ gridId, name: "Bills: Paid This Month" });
  await Operation.create({ id: uid(), gridId, userId: billsMod.userId,
    name: "Bills: Paid This Month", enabled: true,
    triggerTypes: billsOp.triggerTypes ?? [], triggerObjects: billsOp.triggerObjects ?? [],
    targetOccurrenceId: billsOp.targetOccurrenceId ?? null,
    pipeline: { sources: [], steps } });
  log(`  created op "Bills: Paid This Month"`);

  // ---- and now the removal, last, so a failure above leaves it intact -----
  if (subsOp) await Operation.deleteOne({ id: subsOp.id, gridId });
  for (const o of subsOccs) {
    if (o.parentId) await Occurrence.updateOne({ id: o.parentId, gridId }, { $pull: { occurrences: o.id } });
    await Occurrence.deleteOne({ id: o.id, gridId });
  }
  if (subsMod) await Module.deleteOne({ id: subsMod.id, gridId });
  if (subsMod) log(`  removed the Total Subscriptions tile and op — the rows it counted stay under Bills`);
  log("  RESTART pm2 and reload.");
}
