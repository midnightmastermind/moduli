// `Schedule: Place Weekday Tasks` — a task with a Weekday, and no Date, lands on
// that weekday's column every week.
//
// USER, 2026-08-21: *"i also want a weekday dropdown field for tasks so when i
// have that set and date empty, we add them to the schedule for that day"*, and
// in the same session: a FRESH COPY each week, in the day's Todo unless the task
// carries a Time Slot.
//
// THE CASE THAT MATTERS MOST IS THE SECOND PASS. This op places an unsigned row,
// so its idempotence rests entirely on `mergeSubtreeInto`'s `auto:<sourceId>`
// fallback matching the clone against its own source. If that regresses, every
// page load clones the task again — the 23-duplicate-wrappers bug of 2026-07-31.
//
// The op is built from the migration's OWN exported builder rather than copied
// here, so a test cannot pass against a pipeline the grid does not have.
import { describe, it, expect, vi } from "vitest";
vi.setConfig({ testTimeout: 120000 });
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";
import {
  buildWeekdayTaskPipeline,
  yieldDuePlacementToWeekday,
} from "../../../server/migrations/0173-weekday-tasks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());

// STRIP ANY WEEKDAY THE USER HAS SINCE SET. Every "placed nothing" assertion
// below is only about the OP if the fixture starts with no weekday carriers —
// which the control immediately after this says in as many words. That premise
// held only while nobody had used the feature: on 2026-09-05 the fixture
// carried one row given a Weekday on 09-04, and the control failed for a
// perfectly good reason — the feature was being used.
//
// A snapshot of a live grid cannot be relied on to be in any particular state,
// so the harness puts it in one. Same remedy as `freshDay` and as 2026-08-20's
// meal-tracker harness: THE HARNESS CONSTRUCTS THE CONDITION IT MEASURES.
const strippedWeekdays = (() => {
  const wd = fx.fields.find((f) => f.name === "Weekday")?.id;
  if (!wd) return 0;
  let n = 0;
  for (const o of fx.occurrences) {
    if (o.fields?.[wd]?.value) { delete o.fields[wd]; n++; }
  }
  return n;
})();

const SCHEDULE_PAGE = "llpF10Bda5nu";
const FORMAT = "vQ0ELZP_zxnx", DATE = "Eh7oi4HKdbHB", TS = "nSccAtADyUGW";
const modsById = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
const lbl = (o) => o?.label || modsById[o?.moduleId]?.label || "?";
const WD = fx.fields.find((f) => f.name === "Weekday" && !f.displayEnabled).id;
const DUE = fx.fields.find((f) => f.name === "Due" && f.type === "date" && !f.displayEnabled).id;

const OP = {
  id: "op-weekday-tasks", name: "Schedule: Place Weekday Tasks", enabled: true,
  pipeline: { sources: [], steps: buildWeekdayTaskPipeline({ DATE, TS, FMT: FORMAT, WD, schedPageId: SCHEDULE_PAGE }) },
  triggerTypes: ["onLoad"],
  triggerObjects: [{ eventType: "onLoad", subjectType: "grid", targetId: "", priority: 3 }],
  targetOccurrenceId: SCHEDULE_PAGE,
};

/**
 * Put the fixture on `isoDate`, repair the Todo marker `0172` restores, apply
 * `mutate`, and run the op. Returns the world plus what landed on the column.
 *
 * BOTH the column's date AND the SCHEDULE PAGE's own filterOverride move:
 * `$activePeriodDates` resolves from `operation.targetOccurrenceId`'s effective
 * filter — the op's own page — not from the clock. A harness that moves only the
 * clock silently iterates the fixture's original date and places nothing.
 */
function run(isoDate, mutate, opts = {}) {
  const occ = Object.fromEntries(fx.occurrences.map((o) => [o.id, structuredClone(o)]));
  const column = Object.values(occ).find((o) => o.fields?.[FORMAT]?.value === "day-col");
  column.fields[DATE] = { value: isoDate, flow: "in" };
  const sched = occ[SCHEDULE_PAGE];
  sched.filterOverride = { ...(sched.filterOverride || {}), [DATE]: isoDate };

  // The Todo container's identity marker, as `0172` restores it. Without this
  // the fixture's Todo has a null marker and the op has nowhere to place —
  // which is the live defect `0172` exists for, and is asserted below.
  const todo = (column.occurrences || []).map((id) => occ[id])
    .find((o) => o && lbl(o) === "Todo");
  if (todo) {
    if (opts.leaveTodoBroken) {
      // ACTIVELY CLEAR it. This used to work by merely declining to SET the
      // marker, which was enough while the fixture carried a null one — that
      // was the live defect `0172` exists for. `0172` repaired it and the
      // fixture was refreshed off the healthy grid, so "don't set it" now
      // leaves a perfectly good marker in place and the arm stopped testing
      // anything. The broken state has to be produced, not assumed.
      const f = { ...(todo.fields || {}) };
      delete f[TS];
      todo.fields = f;
    } else {
      todo.fields = { ...(todo.fields || {}), [TS]: { value: "Todo", flow: "in" } };
    }
  }

  mutate?.(occ);

  const operations = [structuredClone(OP)];
  const fieldsById = Object.fromEntries(fx.fields.map((f) => [f.id, f]));
  const operationsById = { [operations[0].id]: operations[0] };
  const state = { grid: fx.grid, gridId: fx.grid._id, fields: fx.fields, modules: fx.modules,
    occurrencesById: occ, modulesById: modsById, fieldsById, operationsById, operations };
  const errors = [];
  const ups = runMatchingOperations(operations, null, null,
    { state, fieldsById, operationsById, occurrencesById: occ, modulesById: modsById },
    { onError: (n, e) => errors.push(`${n}: ${e?.message || e}`) });
  applyEffectsToLiveOccs(occ, ups);

  const childrenOf = (id) => (occ[id]?.occurrences || []).map((c) => occ[c]).filter(Boolean);
  const inTodo = todo ? childrenOf(todo.id).map(lbl) : [];
  const bySlot = {};
  for (const s of childrenOf(column.id)) bySlot[lbl(s)] = childrenOf(s.id).map(lbl);
  return {
    occ, errors, todo, column,
    created: ups.filter((u) => u._effect === "CREATE_ITEM").length,
    inTodo, bySlot,
    placedOf: (name) => Object.values(occ).filter(
      (o) => lbl(o) === name && o.fields?.[DATE]?.value === isoDate),
  };
}

/** Give an existing Tasks-page row a Weekday, and clear its Date. */
function makeWeekly(occ, name, weekday, extra) {
  const row = Object.values(occ).find((o) => lbl(o) === name);
  row.fields = { ...(row.fields || {}), [WD]: { value: weekday, flow: "in" } };
  delete row.fields[DATE];
  if (extra) extra(row);
  return row;
}

describe("the fixture's own shape — the controls", () => {
  it("has a Weekday field and a Due date field, and NO instance carries a Weekday yet", () => {
    // The op is inert until the user sets one. If the fixture already carried
    // weekday instances, every "placed nothing" assertion below would be
    // measuring the fixture rather than the op.
    expect(WD).toBeTruthy();
    expect(DUE).toBeTruthy();
    const carriers = fx.occurrences.filter(
      (o) => modsById[o.moduleId]?.role === "instance" && o.fields?.[WD]?.value);
    expect(carriers.map((o) => o.id), "the strip above did not clear every weekday").toEqual([]);
    // Reported, not asserted: how many the live grid had. It is 0 on a grid
    // nobody has used the feature on and grows as they do, so pinning it would
    // just be this control failing again next week.
    if (strippedWeekdays) {
      // eslint-disable-next-line no-console
      console.log(`weekdayTasks: stripped ${strippedWeekdays} weekday value(s) the live grid carried`);
    }
  });

  it("the day column's Todo container CARRIES its marker — `0172` has landed", () => {
    // INVERTED 2026-08-26, not deleted. This used to pin the live defect: the
    // marker every Todo lookup resolves by was null on the column, which is why
    // due placement was a silent no-op. `0172` repaired it, the fixture was
    // refreshed off the healthy grid, and the assertion was still describing
    // the bug — so it failed for the best possible reason.
    //
    // It is kept, pointing the other way, because the marker is what every Todo
    // lookup resolves by: if it goes null again, placement silently stops and
    // this is the test that says so.
    const column = fx.occurrences.find((o) => o.fields?.[FORMAT]?.value === "day-col");
    const todo = (column.occurrences || [])
      .map((id) => fx.occurrences.find((o) => o.id === id))
      .find((o) => lbl(o) === "Todo");
    expect(todo).toBeTruthy();
    expect(todo.fields?.[TS]?.value).toBe("Todo");
  });
});

// ── WHERE THE REMAINING 5 FAILURES STAND (2026-08-26) ──────────────────────
// Traced, not guessed at, and NOT yet fixed. What is established:
//
//   the op is NOT inert — it runs the whole pipeline cleanly, 0 errors
//   $activePeriodDates resolves to the faked date        ["2026-08-24"]
//   $dayColId found · $wd = "Monday" · $todoId FIND runs
//   the task loop iterates $allInstances                 1169 items
//   "Text Tim" IS among those 1169                       verified directly
//   all THREE predicate rules are true for it:
//       Weekday CONTAINS "Monday"   -> true
//       Date IS_EMPTY               -> true
//       meta.feedSourceId IS_EMPTY  -> true
//   ...and the pipeline still emits 0 effects.
//
// So the failure is downstream of the match, in the THEN branch — the merge or
// the placement target — not in the trigger, the date, or the predicate.
//
// TWO THINGS THAT COST TIME AND ARE WORTH INHERITING:
//   1. The executor CAPS loop logging at 50 iterations. A probe that asks the
//      run log "did the loop see this row" reads false on a 1169-item loop and
//      it is a claim about the LOG. Compute membership directly.
//   2. This feature has NEVER run on real data: poms grid has 0 instances
//      carrying a Weekday (all 8 carriers are the workout/meal/routine
//      CONTAINERS, which a different op merges). So these tests are the only
//      evidence about it, and "it works live" is NOT available as a reassurance
//      — the thing that works live is the template merge, not this.

describe("Schedule: Place Weekday Tasks", () => {
  // 2026-08-24 is a Monday, 2026-08-25 a Tuesday.
  it("places a Monday task on Monday, in Todo", () => {
    const out = run("2026-08-24", (occ) => makeWeekly(occ, "Text Tim", "Monday"));
    expect(out.errors).toEqual([]);
    expect(out.inTodo).toContain("Text Tim");
    expect(out.created).toBe(1);
  });

  it("places NOTHING on any other weekday — the discriminator", () => {
    const out = run("2026-08-25", (occ) => makeWeekly(occ, "Text Tim", "Monday"));
    expect(out.errors).toEqual([]);
    expect(out.inTodo).not.toContain("Text Tim");
    expect(out.created).toBe(0);
  });

  it("a task carrying a Time Slot lands in that slot, not in Todo", () => {
    const out = run("2026-08-24", (occ) =>
      makeWeekly(occ, "Text Tim", "Monday", (row) => {
        row.fields[TS] = { value: "3:00pm", flow: "in" };
      }));
    expect(out.errors).toEqual([]);
    expect(out.bySlot["3:00pm"]).toContain("Text Tim");
    expect(out.inTodo).not.toContain("Text Tim");
  });

  it("falls back to Todo when the day has no such slot, rather than placing nowhere", () => {
    const out = run("2026-08-24", (occ) =>
      makeWeekly(occ, "Text Tim", "Monday", (row) => {
        row.fields[TS] = { value: "no such slot", flow: "in" };
      }));
    expect(out.errors).toEqual([]);
    expect(out.inTodo).toContain("Text Tim");
  });

  it("a task that already has a Date is left alone — it is placed, not recurring", () => {
    const out = run("2026-08-24", (occ) => {
      const row = Object.values(occ).find((o) => lbl(o) === "Text Tim");
      row.fields = { ...(row.fields || {}), [WD]: { value: "Monday", flow: "in" },
        [DATE]: { value: "2026-08-24", flow: "in" } };
    });
    expect(out.created).toBe(0);
  });

  it("a multi-select Weekday recurs on each day it names", () => {
    for (const [date, expected] of [["2026-08-24", true], ["2026-08-26", true], ["2026-08-25", false]]) {
      const out = run(date, (occ) => makeWeekly(occ, "Text Tim", ["Monday", "Wednesday"]));
      expect(out.errors).toEqual([]);
      expect(out.inTodo.includes("Text Tim")).toBe(expected);
    }
  });

  it("the copy is DATED and the source stays undated — that is what makes it a fresh copy", () => {
    const out = run("2026-08-24", (occ) => makeWeekly(occ, "Text Tim", "Monday"));
    const copies = out.placedOf("Text Tim");
    expect(copies).toHaveLength(1);
    expect(copies[0].fields[DATE].value).toBe("2026-08-24");
    const source = Object.values(out.occ).find(
      (o) => lbl(o) === "Text Tim" && o.id !== copies[0].id);
    expect(source.fields?.[DATE]?.value ?? null).toBeNull();
  });

  it("a SECOND pass over the same day creates nothing", () => {
    // The whole safety of placing an unsigned row. Run once, feed the result
    // back in, and assert the merge recognises the clone as its own source's.
    const first = run("2026-08-24", (occ) => makeWeekly(occ, "Text Tim", "Monday"));
    expect(first.created).toBe(1);

    const operations = [structuredClone(OP)];
    const fieldsById = Object.fromEntries(fx.fields.map((f) => [f.id, f]));
    const operationsById = { [operations[0].id]: operations[0] };
    const errors = [];
    const ups = runMatchingOperations(operations, null, null,
      { state: { grid: fx.grid, gridId: fx.grid._id, fields: fx.fields, modules: fx.modules,
        occurrencesById: first.occ, modulesById: modsById, fieldsById, operationsById, operations },
        fieldsById, operationsById, occurrencesById: first.occ, modulesById: modsById },
      { onError: (n, e) => errors.push(`${n}: ${e?.message || e}`) });
    expect(errors).toEqual([]);
    expect(ups.filter((u) => u._effect === "CREATE_ITEM")).toHaveLength(0);
  });

  it("places nothing when the Todo marker is missing AND the task has no slot", () => {
    // Fails CLOSED rather than parenting the copy to nothing. This is also the
    // measurement behind `0172`: before that repair, this was every task.
    const out = run("2026-08-24", (occ) => makeWeekly(occ, "Text Tim", "Monday"),
      { leaveTodoBroken: true });
    expect(out.errors).toEqual([]);
    expect(out.created).toBe(0);
  });
});

describe("due placement yields to a weekday", () => {
  it("the live op ALREADY carries `Weekday IS_EMPTY` on both Due-scoped loops", () => {
    // `0173` is applied to the grid, so a current fixture arrives already yielded
    // and there is nothing left to add. This used to assert `patched === 2`,
    // which only held while the fixture PREDATED the migration — the same stale
    // dependency that broke `mealTrackers` when the fixture was refreshed.
    const dated = fx.operations.find((o) => o.name === "Schedule: Place Dated Work");
    const pipe = structuredClone(dated.pipeline);
    const { patched, alreadyPatched } = yieldDuePlacementToWeekday(pipe, { DUE, WD });
    expect(patched).toBe(0);
    expect(alreadyPatched).toBe(2);    // the claim loop and the sweep loop
  });

  it("and it ADDS them when they are absent — stripped, then yielded again", () => {
    // The half the assertion above can no longer show. Strip the rule the
    // migration adds, and the migration puts it back on exactly two loops — so
    // this still measures the migration rather than the fixture's vintage.
    const dated = fx.operations.find((o) => o.name === "Schedule: Place Dated Work");
    const pipe = structuredClone(dated.pipeline);
    let stripped = 0;
    const strip = (steps) => {
      for (const st of steps || []) {
        const rules = st?.condition?.rules;
        if (Array.isArray(rules)) {
          for (let i = rules.length - 1; i >= 0; i--)
            if (typeof rules[i]?.left === "string" && rules[i].left.endsWith(`.fields.${WD}.value`)) {
              rules.splice(i, 1); stripped++;
            }
        }
        strip(st.body); strip(st.then); strip(st.else);
      }
    };
    strip(pipe.steps);
    expect(stripped).toBe(2);          // a strip that found nothing would be vacuous
    const { patched } = yieldDuePlacementToWeekday(pipe, { DUE, WD });
    expect(patched).toBe(2);
  });

  it("is idempotent — a second yield adds nothing", () => {
    const dated = fx.operations.find((o) => o.name === "Schedule: Place Dated Work");
    const pipe = structuredClone(dated.pipeline);
    yieldDuePlacementToWeekday(pipe, { DUE, WD });
    const again = yieldDuePlacementToWeekday(pipe, { DUE, WD });
    expect(again.patched).toBe(0);
    expect(again.alreadyPatched).toBe(2);
  });

  it("touches no loop that does not test the Due field", () => {
    // Place Dated Work's phase 1 loops $allInstances for APPOINTMENTS, matched
    // on templateId. Gating those on Weekday would silently stop placing them.
    const dated = fx.operations.find((o) => o.name === "Schedule: Place Dated Work");
    const pipe = structuredClone(dated.pipeline);
    const before = JSON.stringify(pipe).split('"$allInstances"').length - 1;
    yieldDuePlacementToWeekday(pipe, { DUE, WD });
    const gated = JSON.stringify(pipe).split(`.fields.${WD}.value`).length - 1;
    expect(before).toBeGreaterThan(2);   // control: there ARE more such loops
    expect(gated).toBe(2);
  });
});
