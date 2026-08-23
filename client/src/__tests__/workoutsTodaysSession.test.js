// __tests__/workoutsTodaysSession.test.js
//
// THE `Workouts` TRACKER TILE, DRIVEN THROUGH THE REAL EXECUTOR.
//
// User, 2026-08-22: *"and workouts arent showing up in trackers"*. The tile WAS empty,
// and reading the database said every one of its 26 movement fields held nothing. That
// reads exactly like a dead operation — and it is not one.
//
// **The day it was reported was a SATURDAY, which this grid's templates make a REST
// DAY**, and the user's own earlier instruction was *"and for rest day, dont have
// anythign for excersise"*. So an empty tile that day is the feature working.
//
// A CLAIM THAT SOMETHING IS BROKEN NEEDS THE CASE WHERE IT WOULD WORK. Reading the live
// grid can only ever show the rest day, because today's is the only day column that
// exists. So arm B INJECTS one completed `Barbell Bench Press` onto today's column and
// asserts the tile fills — which is the only thing that separates "correctly quiet" from
// "structurally dead", and it is the assertion nothing covered before.
//
// MY FIRST VERSION OF ARM B FAILED AGAINST CORRECT CODE. The op CLEARS all 26 fields and
// then writes the ones it finds, so there are two writes to the same field and `.find()`
// returns the CLEAR. Reading the first of several writes is not reading the outcome —
// check the probe before believing the failure, which is the rule this repo keeps paying
// for and paid for again here.
//
// A/B'd, and the FIRST mutation proved nothing — which is the more useful half. Removing
// the injected row from the slot's `occurrences[]` left both arms GREEN, because the op
// reaches it through `parentId` and never reads the slot's list. So that mutation was not
// a weaker test, it was the wrong lever. Removing the row's **Movement pick** fails
// exactly arm B while arm A's control still passes — a movement is what this op matches
// on, and the pick is the only thing the assertion is really about.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { runMatchingOperations } from "../helpers/operationExecutor";

// Each arm runs 65 pipelines over 3,372 occurrences. That is integration scale and
// legitimately takes seconds — it passed alone and timed out at the 5s default only
// when the full suite was competing for the CPU.
vi.setConfig({ testTimeout: 60000 });
const say=()=>{};

// PINNED TO THE FIXTURE'S OWN DAY COLUMN.
//
// These assertions are about "today's column", and the ops resolve `$today` from
// the wall clock — so an unpinned suite is green the day the fixture is exported
// and red the next morning. All three files that read this fixture went red at
// midnight on 2026-08-23, which is the failure CLAUDE.md 2026-08-20 (2) records:
// *"a suite that fails by the calendar gets disabled rather than read."*
//
// The anchor is the DATE THE FIXTURE'S DAY COLUMN CARRIES, not `_exportedAt` and
// not a hardcoded day. `_exportedAt` makes the tests depend on which weekday
// somebody last ran the exporter (2026-08-21, when a Friday export left a column
// with no movements); the column's own date is a fact about the data in front of
// them, and it survives a re-export taken on any day.
function fixtureDayFrom(fx) {
  const SF = fx.fields.find((f) => f.name === "Schedule Format")?.id;
  const DATE = fx.fields.find((f) => f.name === "Date" && f.type === "date")?.id;
  const col = fx.occurrences.find((o) => o.fields?.[SF]?.value === "day-col" && o.fields?.[DATE]?.value);
  const d = col?.fields?.[DATE]?.value;
  if (!d) throw new Error("fixture carries no dated day column — cannot pin the clock to it");
  return String(d).slice(0, 10);
}

let fx;
beforeAll(() => { const here = path.dirname(fileURLToPath(import.meta.url));
  fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString("utf8"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${fixtureDayFrom(fx)}T12:00:00`));
});

function run(mutate) {
  const operations = fx.operations.filter(o => o.enabled !== false);
  const fieldsById = Object.fromEntries(fx.fields.map(f => [f.id, f]));
  const modulesById = Object.fromEntries(fx.modules.map(m => [m.id, m]));
  const occurrencesById = Object.fromEntries(fx.occurrences.map(o => [o.id, structuredClone(o)]));
  const operationsById = Object.fromEntries(operations.map(o => [o.id, o]));
  if (mutate) mutate({ occurrencesById, modulesById, fieldsById });
  const state = { grid: fx.grid, gridId: fx.grid?._id, fields: fx.fields, modules: Object.values(modulesById),
    occurrencesById, modulesById, fieldsById, operationsById, operations };
  const ctx = { state, fieldsById, operationsById, occurrencesById, modulesById };
  const updates = runMatchingOperations(operations, null, null, ctx, { onError:()=>{}, onSuccess:()=>{} }) || [];
  const TILE = "1ve8fwc6c7k";
  const writes = updates.filter(u => (u.itemId) === TILE)
    .map(u => `${fieldsById[u.fieldId]?.name || (u.metaPath ? "meta:"+u.metaPath.join(".") : "fieldVisibility")} = ${JSON.stringify(u.value)?.slice(0,80)}`);
  return { writes, fieldsById, occurrencesById };
}

afterAll(() => { vi.useRealTimers(); });

describe("Workouts: Today's Session — does it fill when a movement IS on today's column?", () => {
  it("A: today as it really is (Saturday, a rest day)", () => {
    const { writes } = run(null);
    say("=== A: untouched (Saturday, rest day) ===");
    writes.forEach(w => say("   " + w));
    const nonNull = writes.filter(w => !/= null$/.test(w) && !/fieldVisibility/.test(w));
    say(`   -> ${writes.length} writes, ${nonNull.length} non-null movement values`);
    expect(writes.length).toBeGreaterThan(20);   // control: the op ran
  });

  it("B: with a Bench Press exercise injected onto today's column", () => {
    const { writes } = run(({ occurrencesById, modulesById, fieldsById }) => {
      const SF = "vQ0ELZP_zxnx";
      const col = Object.values(occurrencesById).find(o => o.fields?.[SF]?.value === "day-col");
      const slot = occurrencesById[col.occurrences[10]];
      const MOVEMENT = fx.fields.find(f => f.name === "Movement").id;
      const COMPLETED = fx.fields.find(f => f.name === "Completed").id;
      // the catalog Barbell Bench Press the op's own pipeline names
      const bench = Object.values(occurrencesById).find(o =>
        (o.label || modulesById[o.moduleId]?.label) === "Barbell Bench Press" && !o.meta?.feedSourceId);
      const mod = { id: "probe-mod", role: "instance", label: "Exercise",
        fieldBindings: [{ fieldId: MOVEMENT, order: 0 }, { fieldId: COMPLETED, order: 1 }] };
      modulesById[mod.id] = mod;
      occurrencesById["probe-ex"] = { id: "probe-ex", moduleId: mod.id, parentId: slot.id, occurrences: [],
        fields: { [MOVEMENT]: { value: bench.id }, [COMPLETED]: { value: true } }, meta: {} };
      slot.occurrences = [...(slot.occurrences || []), "probe-ex"];
      say(`   (injected Exercise -> Movement=${bench.id} "${bench.label || modulesById[bench.moduleId]?.label}" into slot ${slot.id})`);
    });
    say("=== B: one Bench Press, completed, on today's column ===");
    writes.forEach(w => say("   " + w));
    const bench = writes.filter(w => w.startsWith("Barbell Bench Press")).pop();
    expect(bench).toBe("Barbell Bench Press = 1");
  });
});
