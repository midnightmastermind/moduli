/**
 * 0171 — `Workouts: Today's Session`: which movements are on today, and which are done.
 *
 * The op behind `0170`'s tile. It writes **0/1 per movement** from that day's Exercise row and then
 * **hides the fields that are not in today's session**, so a Push day shows six lifts and a rest day
 * shows none — the user's own design: *"show a display field per movement and on each filter change
 * or load, it hides the fields not needed for that day"*.
 *
 * **ONE LOOP WITH A BRANCH PER MOVEMENT, not 26 FINDs.** The obvious shape is a FIND per movement,
 * and it would fire 26 full scans of `$allInstances` every time the date changes — on an op whose
 * whole job is to react to the date changing. A single loop gated to the day column visits ~8 rows
 * and asks each one 26 cheap comparisons instead. Same answer, and it does not scale with the
 * catalog.
 *
 * **EVERY FIELD IS CLEARED FIRST.** A movement that was on yesterday and is not on today must not
 * keep yesterday's 1 — the stale-slot failure `fitnessPrescription.test.js` exists to catch, one tile
 * over. Clearing to null (rather than 0) is what makes "not scheduled" distinguishable from
 * "scheduled and not done", which is exactly the difference the tile is for.
 *
 * **RUN AND STRETCH ARE MATCHED BY MODULE LABEL, and that asymmetry is the data's, not a shortcut.**
 * The 24 lifts are matched on their `Movement` PICK — a real reference, rename-proof. Run and Stretch
 * carry no pick at all because they are ROUTINES rather than catalog movements, so a label is the
 * only thing they have. A migration may name a domain concept (it authors data); the generic
 * renderer may not, which is what `noDomainKnowledge` enforces and why this lives here.
 *
 * **THE TRIGGER SURFACE IS COPIED FROM `Fitness: Today's Prescription` AT RUN TIME** rather than
 * restated — same column resolution, same events. Two ops answering the same question about the same
 * day must not disagree about when to ask it.
 *
 * `Tracker Date` is always appended to the visible set, or clearing the date would hide the pill that
 * says "Total".
 */
const uid = () => Math.random().toString(36).slice(2, 14);
const MOVEMENT = "gF1S8FoNc4An", COMPLETED = "tZWiPDQUDP74", WEEKDAY = "hzkcwybebz";
const ROUTINES = ["Run", "Stretch"];
const OP_NAME = "Workouts: Today's Session";

export const id = "0171-workouts-session-op";
export const describe =
  "Writes 0/1 per movement from that day's Exercise row and hides the fields not in today's session.";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean() ]);
  const oById = new Map(occs.map((o) => [o.id, o]));
  const mById = new Map(mods.map((m) => [m.id, m]));
  const lbl = (o) => o?.label || mById.get(o?.moduleId)?.label || o?.id;
  const fByName = new Map(fields.map((f) => [f.name, f]));

  const tile = occs.find((o) => String(lbl(o)) === "Workouts" && (o.role || mById.get(o.moduleId)?.role) === "instance");
  const exemplar = ops.find((o) => o.name === "Fitness: Today's Prescription");
  if (!tile) { log("  REFUSING: no 'Workouts' tile — run 0170 first"); return; }
  if (!exemplar) { log("  REFUSING: no 'Fitness: Today's Prescription' to copy the column resolution from"); return; }

  // The movements the templates place, mapped to the fields 0170 minted.
  const tpls = occs.filter((o) => o.fields?.[WEEKDAY]?.value);
  const movementOccIds = new Map();   // name -> source occurrence id
  for (const t of tpls) {
    const walk = (id, d = 0) => {
      if (d > 4) return;
      for (const c of oById.get(id)?.occurrences || []) {
        const o = oById.get(c); if (!o) continue;
        const v = o.fields?.[MOVEMENT]?.value;
        if (v) { const mv = oById.get(Array.isArray(v) ? v[0] : v); if (mv) movementOccIds.set(String(lbl(mv)), mv.id); }
        walk(c, d + 1);
      }
    };
    walk(t.id);
  }
  const picks = [...movementOccIds.entries()]
    .map(([name, occId]) => ({ name, occId, field: fByName.get(name) }))
    .filter((x) => x.field);
  const routines = ROUTINES.map((n) => ({ name: n, field: fByName.get(n) })).filter((x) => x.field);
  const trackerDate = fByName.get("Tracker Date");
  log(`  ${picks.length} movement(s) matched on their Movement PICK · ${routines.length} routine(s) matched by label`);
  const missing = [...movementOccIds.keys()].filter((n) => !fByName.has(n));
  if (missing.length) { log(`  REFUSING: ${missing.length} movement(s) have no field — re-run 0170: ${missing.join(", ")}`); return; }

  // ── the column resolution, copied from the exemplar rather than restated ──
  const exSteps = exemplar.pipeline?.steps || [];
  const colFind = exSteps.find((s) => s.config?.type === "FIND" && s.config?.itemIdVar === "$colId");
  if (!colFind) { log("  REFUSING: could not find the exemplar's day-column FIND to copy"); return; }
  const schedInit = exSteps.find((s) => s.config?.type === "INIT_VAR" && s.config?.name === "$schedPage");

  const act = (config) => ({ id: uid(), type: "action", config });
  const steps = [
    act({ type: "INIT_VAR", name: "$tile", expr: `$allItemsById.${tile.id}` }),
    ...(schedInit ? [JSON.parse(JSON.stringify(schedInit))] : []),
    JSON.parse(JSON.stringify(colFind)),
    act({ type: "INIT_VAR", name: "$visible", expr: "json:[]" }),
    // clear every slot BEFORE the loop — a movement not on today must not keep
    // yesterday's value, and null is what distinguishes "not scheduled" from
    // "scheduled and not done".
    ...[...picks, ...routines].map((p) => act({ type: "UPDATE", path: `$tile.fields.${p.field.id}.value`, value: null })),
  ];

  const doneBranch = (p, rowVar) => ({
    id: uid(), type: "if",
    condition: { operator: "AND", rules: [{ id: uid(), left: `${rowVar}.fields.${COMPLETED}.value`, comparator: "IS", right: true }] },
    then: [act({ type: "UPDATE", path: `$tile.fields.${p.field.id}.value`, value: 1 })],
    else: [act({ type: "UPDATE", path: `$tile.fields.${p.field.id}.value`, value: 0 })],
  });
  const branch = (p, rule) => ({
    id: uid(), type: "if",
    condition: { operator: "AND", rules: [rule] },
    then: [
      act({ type: "PUSH_TO_VAR", name: "$visible", value: p.field.id }),
      doneBranch(p, "$ex"),
    ],
    else: [],
  });

  steps.push({
    id: uid(), type: "loop", overExpr: "$allInstances", as: "$ex",
    body: [{
      id: uid(), type: "if",
      condition: { operator: "AND", rules: [
        { id: uid(), left: "$ex._ancestors", comparator: "HAS_ANCESTOR", right: "$colId" },
        { id: uid(), left: "$ex.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
      ] },
      then: [
        ...picks.map((p) => branch(p, { id: uid(), left: `$ex.fields.${MOVEMENT}.value`, comparator: "CONTAINS", right: p.occId })),
        ...routines.map((p) => branch(p, { id: uid(), left: "$ex.moduleLabel", comparator: "IS", right: p.name })),
      ],
      else: [],
    }],
  });

  if (trackerDate) steps.push(act({ type: "PUSH_TO_VAR", name: "$visible", value: trackerDate.id }));
  steps.push(act({ type: "UPDATE", path: "$tile.fieldVisibility", value: { mode: "show", fieldIds: "$visible" } }));

  const existing = ops.find((o) => o.name === OP_NAME);
  log(`  op: ${existing ? "exists — replacing its pipeline" : "to create"} · ${steps.length} top-level step(s)`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  const doc = {
    name: OP_NAME, enabled: true, gridId, userId: tile.userId,
    pipeline: { sources: [], steps },
    triggerTypes: exemplar.triggerTypes,
    triggerObjects: JSON.parse(JSON.stringify(exemplar.triggerObjects || [])),
    targetOccurrenceId: exemplar.targetOccurrenceId ?? null,
    folderId: exemplar.folderId ?? null,
  };
  if (existing) await Operation.updateOne({ _id: existing._id }, { $set: doc });
  else await Operation.create({ id: uid(), ...doc });
  log(`  ${existing ? "replaced" : "created"} "${OP_NAME}" — RESTART pm2 and reload.`);
}
