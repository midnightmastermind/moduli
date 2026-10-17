// server/migrations/0413-day-page-reflections.mjs
//
// User 2026-10-17: the day page's daily reflections go at the BOTTOM of each day column, inside a
// nested "Reflections" container holding one doc container per book (that book's page for the day),
// "built via operations, not hardcoded". So both halves are operation steps, editable in the
// operations editor:
//
//   "Day Page: Build Day"   finds the column's Reflections section (identitySignature
//                           daypage:reflections) and CREATEs it when missing; the column's text is
//                           rebuilt with that section LAST, whatever order the children were listed in.
//   "Day Page: Add Reading" imports each book's page INTO the section (0402's builder), and moves a
//                           reading imported straight into the column before this into the section.
//
// Nothing here builds a container; the next load's Build Day does. Anchored on the steps' shape (the
// column-text loop over `$col.occurrences as $kidId2` and the `UPDATE $col.textmap` after it), refuses
// when it cannot find them, idempotent.

import { CALLEE, addReadingPipeline, REFLECTIONS_SIG } from "./0402-day-page-readings.mjs";
import { readBoardAndDate } from "./0403-day-page-reading-retry.mjs";

export const id = "0413-day-page-reflections";
export const describe = "Day page: a Reflections section at the bottom of each day column, holding each book's page.";
export const touches = ["operations"];

export const BUILD_DAY = "Day Page: Build Day";
const uid = () => globalThis.crypto.randomUUID();
const r = (left, comparator, right = "") => ({ id: uid(), left, comparator, right });
const all = (...rules) => ({ id: uid(), operator: "AND", rules });
const act = (config) => ({ id: uid(), type: "action", actionType: config.type, config });
const iff = (condition, then, els = []) => ({ id: uid(), type: "if", condition, then, else: els });

/** PURE. Build Day's steps with the Reflections section. Returns null when already there. */
export function withReflectionsSection(steps) {
  if (JSON.stringify(steps).includes(REFLECTIONS_SIG)) return null;
  const out = JSON.parse(JSON.stringify(steps));
  const dayIf = out.find((s) => s.type === "if" && JSON.stringify(s.condition).includes('"$day"'));
  const body = dayIf?.then;
  if (!Array.isArray(body)) throw new Error("0413: Build Day has no `$day IS_NOT_EMPTY` branch");
  const initBody = body.findIndex((s) => s.config?.type === "INIT_VAR" && s.config?.name === "$body");
  const restLoop = body.findIndex((s) => s.type === "loop" && s.as === "$kidId2");
  const writeText = body.findIndex((s) => s.config?.type === "UPDATE" && s.config?.path === "$col.textmap");
  if (initBody < 0 || restLoop < initBody || writeText < restLoop) throw new Error("0413: Build Day's column-text steps not found");
  const restIf = body[restLoop].body?.find((s) => s.type === "if");
  if (!restIf?.condition?.rules) throw new Error("0413: the column-text loop has no IF");

  restIf.condition.rules.push(r("$kid2.identitySignature", "IS_NOT", REFLECTIONS_SIG));
  body.splice(writeText, 0, iff(all(r("$reflId", "IS_NOT_EMPTY")), [
    act({ type: "PUSH_TO_ARRAY", name: "$body", value: { type: "moduleEmbed", attrs: { occurrenceId: "$reflId" } } }),
  ]));
  body.splice(initBody, 0,
    act({ type: "FIND", over: "$allOccurrences", predicate: all(r("parentId", "IS", "$colId"), r("identitySignature", "IS", REFLECTIONS_SIG)),
      itemIdVar: "$reflId", itemVar: "$refl" }),
    iff(all(r("$colId", "IS_NOT_EMPTY"), r("$reflId", "IS_EMPTY")), [
      act({ type: "CREATE", role: "container", kind: "doc", name: "Reflections", parent: "$colId",
        identitySignature: REFLECTIONS_SIG, itemIdVar: "$reflId" }),
    ]),
  );
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const build = await Operation.findOne({ gridId, name: BUILD_DAY }).lean();
  if (!build) throw new Error(`0413: no "${BUILD_DAY}" on this grid`);
  const next = withReflectionsSection(build.pipeline.steps);
  if (next) {
    log(`~ ${BUILD_DAY}: Reflections section, kept last in the column`);
    if (!dryRun) await Operation.updateOne({ id: build.id }, { $set: { "pipeline.steps": next } });
  } else log(`${BUILD_DAY} already builds the section`);

  const callee = await Operation.findOne({ gridId, name: CALLEE }).lean();
  if (!callee) { log(`no "${CALLEE}" — readings not set up on this grid`); return; }
  if (JSON.stringify(callee.pipeline).includes("OLDER_THAN_MINUTES")) { log(`${CALLEE} already current`); return; }
  const where = readBoardAndDate(callee);
  if (!where) throw new Error(`0413: could not read the board / date field off "${CALLEE}"`);
  log(`~ ${CALLEE}: imports into the Reflections section`);
  if (dryRun) return;
  await Operation.updateOne({ id: callee.id }, { $set: { pipeline: addReadingPipeline(where) } });
  const back = await Operation.find({ id: { $in: [build.id, callee.id] } }).lean();
  if (back.some((o) => !JSON.stringify(o.pipeline).includes(REFLECTIONS_SIG))) throw new Error("0413: an op did not change");
  log("done. Restart the server (pm2).");
}
