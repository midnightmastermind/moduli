// server/migrations/0040-daily-question-autofill.mjs
//
// A day arrived with an EMPTY Daily Question: the bound header rendered a picker
// nobody had picked, so the section read as a blank prompt. Measured on poms grid
// 2026-08-05: 14 question containers, **12 of them empty**.
//
// The fill belongs where the day is BUILT, not at render. A render-time pick
// would choose a different question every load, and the answer written under it
// would end up attached to a question that is no longer there. Built once, it
// persists on the occurrence.
//
// Two halves:
//   1. THE OP. `Day Page: Build` gains a pass that, per day it builds, finds the
//      day's question container and — only when it has no question yet — writes a
//      random one from the SAME pool the field's own picker and the 🎲 button
//      draw from (the "Reflection Questions" container). Guarded on empty, so a
//      day the user has already answered is never re-rolled out from under them.
//   2. THE BACKFILL. The op only visits the days inside the current filter
//      window, so columns already built for other days would stay blank forever.
//      Existing EMPTY containers are filled here, one random question each.
//      A container that already carries a question is never touched.
//
// The question container is found by `identitySignature`, never by label: it is
// deliberately label-less (its header IS the selected question), and the
// signature is what APPLY_TEMPLATE's merge already matches on, so it is the one
// marker guaranteed to survive a clone.
export const id = "0040-daily-question-autofill";
export const describe =
  "Day Page: Build fills a day's Daily Question with a random question from the pool when it has none, " +
  "and backfills the day columns that are already empty.";

export const QUESTION_SIGNATURE = "daypage:Daily Question/question";

/**
 * Pure: append the Daily-Question fill pass to the per-day loop body, right
 * after the step that stamps the template route back onto the column. Returns
 * true when it inserted (false when the pipeline already carries it).
 *
 * Anchored on the `appliedFromTemplateId` UPDATE rather than an index: that step
 * is unique, and it is the last thing that runs while `$col`/`$colId` are bound
 * to the day just built — exactly the scope the fill needs. Exported for tests.
 */
export function insertQuestionFill(pipeline, { questionFieldId, poolModuleId, uid }) {
  if (JSON.stringify(pipeline || {}).includes("PICK_RANDOM_FROM_POOL")) return false;

  const steps = [
    // `$allOccurrences`, NOT `$allContainers` (corrected 2026-08-07). The
    // role-filtered collections read `occ.role ?? module.role`, and an occurrence
    // carries no role of its own — so a question container whose MODULE is absent
    // from the client store drops out while the occurrence sits right there, the
    // `$dqId IS_NOT_EMPTY` gate below fails, and the day's question is silently
    // never filled. Same defect 0039 fixed for the column lookup.
    //
    // poms grid ALREADY reads `$allOccurrences` here: 0039 ran after this
    // migration and its `"right":"$colId"` selector matched this FIND too (see
    // that file's header). So this correction makes the migration agree with what
    // the live grid actually runs AND with the builder — a re-run is a no-op, and
    // `dailyQuestionAutofill.test.js` pins the two outputs as identical so a
    // reseeded grid cannot drift from a migrated one.
    { id: uid(), type: "action", config: {
        type: "FIND", over: "$allOccurrences",
        predicate: { operator: "AND", rules: [
          { id: uid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$colId" },
          { id: uid(), left: "identitySignature", comparator: "IS", right: QUESTION_SIGNATURE },
        ]},
        itemIdVar: "$dqId", itemVar: "$dq",
    }},
    { id: uid(), type: "if",
      condition: { operator: "AND", rules: [
        { id: uid(), left: "$dqId", comparator: "IS_NOT_EMPTY", right: "" },
        { id: uid(), left: `$dq.fields.${questionFieldId}.value`, comparator: "IS_EMPTY", right: "" },
      ]},
      then: [
        { id: uid(), type: "action", config: {
            type: "PICK_RANDOM_FROM_POOL", poolId: poolModuleId, varName: "$dailyQuestion",
        }},
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [
            { id: uid(), left: "$dailyQuestion", comparator: "IS_NOT_EMPTY", right: "" },
          ]},
          then: [
            { id: uid(), type: "action", config: {
                type: "UPDATE",
                path: `$dq.fields.${questionFieldId}.value`,
                value: "$dailyQuestion",
            }},
          ],
          else: [],
        },
      ],
      else: [],
    },
  ];

  let inserted = false;
  const walk = (arr) => {
    if (!Array.isArray(arr) || inserted) return;
    for (let i = 0; i < arr.length; i++) {
      const step = arr[i];
      const cfg = step?.config;
      if (cfg?.type === "UPDATE" && cfg.path === "$col.meta.appliedFromTemplateId") {
        arr.splice(i + 1, 0, ...steps);
        inserted = true;
        return;
      }
      if (!inserted) walk(step?.body);
      if (!inserted) walk(step?.then);
      if (!inserted) walk(step?.else);
      if (inserted) return;
    }
  };
  walk(pipeline?.steps);
  return inserted;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Occurrence, Module, Field } = models;
  const uid = () => Math.random().toString(36).slice(2, 14);

  const qField = await Field.findOne({ gridId, name: "Daily Question" }).lean();
  if (!qField) { log("no Daily Question field on this grid — nothing to do"); return; }

  // The pool the picker uses. Resolved by LABEL because that container is user-
  // facing and stable; if it is ever renamed this migration should stop rather
  // than guess at another list.
  const poolModule = await Module.findOne({ gridId, label: "Reflection Questions" }).lean();
  if (!poolModule) { log("no 'Reflection Questions' container — refusing to guess at a pool"); return; }
  const poolOcc = await Occurrence.findOne({ gridId, moduleId: poolModule.id }).lean();
  const poolIds = poolOcc?.occurrences || [];
  if (poolIds.length === 0) { log("the question pool is empty — nothing to draw from"); return; }
  log(`pool: ${poolIds.length} question(s) under module ${poolModule.id}`);

  // ── 1. the op ────────────────────────────────────────────────────────────
  const op = await Operation.findOne({ gridId, name: "Day Page: Build" }).lean();
  if (!op) {
    log("no Day Page: Build op on this grid — skipping the op patch");
  } else {
    const pipeline = JSON.parse(JSON.stringify(op.pipeline || {}));
    const inserted = insertQuestionFill(pipeline, {
      questionFieldId: qField.id, poolModuleId: poolModule.id, uid,
    });
    if (!inserted) {
      log("Day Page: Build already fills the question — no patch needed");
    } else {
      log("inserting the Daily-Question fill pass into Day Page: Build");
      if (!dryRun) await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
    }
  }

  // ── 2. the backfill ──────────────────────────────────────────────────────
  const containers = await Occurrence.find({ gridId, identitySignature: QUESTION_SIGNATURE }).lean();
  // The TEMPLATE's own question container stays blank — it is the shape a day is
  // cloned FROM, and a question baked into it would be handed to every new day.
  const templateModuleIds = new Set(
    (await Module.find({ gridId, "meta.templateModule": true }).lean()).map(m => m.id)
  );
  const empty = containers.filter(o =>
    !templateModuleIds.has(o.moduleId) &&
    !(typeof o.fields?.[qField.id]?.value === "string" && o.fields[qField.id].value.length > 0)
  );
  log(`${containers.length} question container(s); ${empty.length} empty and not the template`);

  const labelOf = async (occId) => {
    const occ = await Occurrence.findOne({ gridId, id: occId }).lean();
    if (!occ) return null;
    if (occ.label) return occ.label;
    const mod = await Module.findOne({ gridId, id: occ.moduleId }).lean();
    return mod?.label || null;
  };

  for (const cont of empty) {
    const pick = poolIds[Math.floor(Math.random() * poolIds.length)];
    const question = await labelOf(pick);
    if (!question) { log(`  ${cont.id}: pool entry ${pick} has no label — skipped`); continue; }
    log(`  ${cont.id} ← "${question.slice(0, 60)}"`);
    if (!dryRun) {
      await Occurrence.updateOne(
        { gridId, id: cont.id },
        { $set: { [`fields.${qField.id}`]: { value: question, flow: "in" } } }
      );
    }
  }

  log(dryRun ? "(dry run — no writes)" : "done");
}
