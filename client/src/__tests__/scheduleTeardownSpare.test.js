// __tests__/scheduleTeardownSpare.test.js — "i just dont want it to delete anything i edit"
//
// `Schedule: Build Schedule` tears down a day column that has fallen out of the
// filtered period. `0322` gave it its first exemption — a day where something
// is COMPLETED is kept — and this file covers the second: a day the user
// EDITED, recorded as `meta.userTouched` by the write path.
//
// WHY A STAMP AND NOT A FIELD RULE. Measured over the live grid's 40 day
// columns / 526 rows, every field-level candidate for "anything I edited" broke
// in one of two directions:
//
//   holds a field no op writes              2 of 40   <- DROPS real edits
//   excluding fields ops UPDATE            30 of 40   <- ops PREFILL Meal, Mood
//                                                        and the macros, so this
//                                                        loses the user's picks
//   excluding the build's own stamps       30 of 40   <- kept by `Daily
//                                                        Question`, app-written
//   holds any value at all                 40 of 40   <- spares everything
//
// The same fields are written by both sides, so nothing reading VALUES can tell
// them apart afterwards. The write path already can — `txRecorder` marks a
// write `derived` on exactly `!actionId` — so the fact is recorded there.
//
// THIS FILE DRIVES THE REAL BUILDER'S OWN STEPS. The teardown branch is lifted
// out of `makeScheduleBuildScheduleOp`'s output by what it BINDS ($dcKeep),
// never by position, and executed through the real executor over the real
// fixture. A hand-written copy of the predicate here would pass forever while
// the shipped pipeline drifted away from it.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { executePipeline } from "../helpers/operationExecutor";
import { makeScheduleBuildScheduleOp } from "../../../server/utils/liveSystemBuilders.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "pomsGrid.json.br");

// The fixture's one real day column, and the two fields the teardown reads.
const COL = "cdb0c320-e7e4-4d24-bb4c-ef0e528a691a";
const DONE = "tZWiPDQUDP74";          // Completed (boolean)
const uid = () => "k" + Math.random().toString(36).slice(2, 9);

let fx, modulesById, fieldsById, operationsById, base;
let direct, deep, outside, teardownSteps;

// `buildParentMap` keys child → ONE parent, LAST WRITER WINS, and the schedule
// multi-parents slots across day columns by design. So "is a child of COL" is
// not the same question as "resolves its ancestry back to COL", and picking a
// descendant without checking cost this file four wrong readings.
const reachableFrom = (root, byId) => {
  const parentByChild = {};
  for (const o of Object.values(byId)) for (const c of (o.occurrences || [])) parentByChild[c] = o.id;
  return (id) => {
    const seen = new Set();
    let cur = parentByChild[id] ?? byId[id]?.parentId;
    for (let i = 0; cur && !seen.has(cur) && i < 12; i++) {
      if (cur === root) return true;
      seen.add(cur);
      cur = parentByChild[cur] ?? byId[cur]?.parentId;
    }
    return false;
  };
};

beforeAll(() => {
  fx = JSON.parse(brotliDecompressSync(readFileSync(FIXTURE)).toString("utf8"));
  modulesById = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
  fieldsById = Object.fromEntries(fx.fields.map((f) => [f.id, f]));
  operationsById = Object.fromEntries(fx.operations.map((o) => [o.id, o]));
  base = Object.fromEntries(fx.occurrences.map((o) => [o.id, o]));

  const reaches = reachableFrom(COL, base);
  const kids = base[COL].occurrences || [];
  direct = kids.find(reaches);
  for (const k of kids) {
    const g = (base[k]?.occurrences || []).find(reaches);
    if (g) { deep = g; break; }
  }
  const inside = new Set([COL, ...kids]);
  outside = Object.keys(base).find((id) => !inside.has(id) && !reaches(id));

  // The teardown branch, lifted from the REAL builder by what it binds.
  const op = makeScheduleBuildScheduleOp({
    userId: "u", gridId: "g", dateFieldId: "Eh7oi4HKdbHB", dueFieldId: "DUE",
    timeslotFieldId: "TS", scheduleFormatFieldId: "vQ0ELZP_zxnx",
    schedulePageOccId: "SP", dayContainerOccId: "DAY", completedFieldId: DONE,
  });
  const found = [];
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    if (n.config?.type === "FIND" && n.config?.itemIdVar === "$dcKeep") {
      // The FIND and the `if $dcKeep IS_EMPTY -> DELETE` that consumes it are
      // siblings; capture the whole `else` list they live in.
      return;
    }
    if (Array.isArray(n.else) && JSON.stringify(n.else).includes('"$dcKeep"')) found.push(n.else);
    Object.values(n).forEach(walk);
  })(op.pipeline.steps);
  // Innermost match — the outer `if`s also contain it.
  teardownSteps = found.sort((a, b) => JSON.stringify(a).length - JSON.stringify(b).length)[0];
});

const world = () => {
  const o = Object.fromEntries(fx.occurrences.map((x) => [x.id, structuredClone(x)]));
  for (const x of Object.values(o)) {
    if (x.meta?.userTouched) delete x.meta.userTouched;
    if (x.fields?.[DONE]) delete x.fields[DONE];
  }
  return o;
};

const tearDown = (occurrencesById) => {
  const ctx = {
    state: { grid: fx.grid, gridId: fx.grid?._id, fields: fx.fields, modules: fx.modules,
             occurrencesById, modulesById, fieldsById, operationsById, operations: fx.operations },
    fieldsById, operationsById, occurrencesById, modulesById,
  };
  const op = { id: "p", name: "p", pipeline: { steps: [
    { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$cont", expr: `$allItemsById.${COL}` } },
    ...teardownSteps,
  ] } };
  return (executePipeline(op, ctx, null) || []).filter((e) => e?._effect === "DELETE_ITEM").length;
};

const stampTouched = (w, id) => { w[id] = { ...w[id], meta: { ...(w[id].meta || {}), userTouched: true } }; return w; };
const stampDone = (w, id) => { w[id] = { ...w[id], fields: { ...(w[id].fields || {}), [DONE]: { value: true } } }; return w; };

describe("the schedule teardown spares a day you edited", () => {
  it("the fixture carries what these arms measure — the control", () => {
    expect(teardownSteps, "the teardown branch is gone from the builder").toBeTruthy();
    expect(JSON.stringify(teardownSteps)).toContain("meta.userTouched");
    expect(direct, "no direct child of the column resolves its ancestry back to it").toBeTruthy();
    expect(deep, "no depth-2 descendant to test with").toBeTruthy();
    expect(outside).toBeTruthy();
  });

  // THE CONTROL THAT MATTERS MOST. Every other arm asserts a day SURVIVES, and
  // a teardown that never fires would satisfy all of them. It must still delete.
  it("still tears down a day with nothing done and nothing edited", () => {
    expect(tearDown(world())).toBe(1);
  });

  it("spares a day whose descendant the user EDITED", () => {
    expect(tearDown(stampTouched(world(), direct))).toBe(0);
  });

  it("spares it however deep the edit is", () => {
    expect(tearDown(stampTouched(world(), deep))).toBe(0);
  });

  // 0322 must not be quietly undone by widening the rule beside it.
  it("still spares a day whose descendant is COMPLETED", () => {
    expect(tearDown(stampDone(world(), direct))).toBe(0);
  });

  // THE SCOPE CONTROL. Without the `_ancestors` rule the probe matches an edit
  // anywhere on the grid and every past day is spared forever — which reads as
  // "it works" on every arm above.
  it("is NOT spared by an edit outside the column", () => {
    expect(tearDown(stampTouched(world(), outside))).toBe(1);
  });

  // WHY THE COLLECTION WIDENED, measured rather than argued. The same stamp on
  // the same row, over $allInstances, does not save the day: this descendant is
  // a CONTAINER, and a journal section or a note is exactly the thing you edit.
  it("would MISS the same edit over $allInstances — which is why it reads $allOccurrences", () => {
    const role = base[direct]?.role || modulesById[base[direct]?.moduleId]?.role;
    expect(role, "this arm only discriminates while the probe row is a non-instance").not.toBe("instance");

    const narrowed = JSON.parse(JSON.stringify(teardownSteps));
    (function walk(n) {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== "object") return;
      if (n.type === "FIND" && n.itemIdVar === "$dcKeep") n.over = "$allInstances";
      Object.values(n).forEach(walk);
    })(narrowed);
    expect(JSON.stringify(narrowed), "the mutation did not land").toContain("$allInstances");

    const w = stampTouched(world(), direct);
    const ctx = {
      state: { grid: fx.grid, gridId: fx.grid?._id, fields: fx.fields, modules: fx.modules,
               occurrencesById: w, modulesById, fieldsById, operationsById, operations: fx.operations },
      fieldsById, operationsById, occurrencesById: w, modulesById,
    };
    const op = { id: "p", name: "p", pipeline: { steps: [
      { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$cont", expr: `$allItemsById.${COL}` } },
      ...narrowed,
    ] } };
    const deletes = (executePipeline(op, ctx, null) || []).filter((e) => e?._effect === "DELETE_ITEM").length;
    expect(deletes, "$allInstances would have been enough — this widening is unnecessary").toBe(1);
  });
});
