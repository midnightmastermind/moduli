// `Tasks: File Completed` — a ticked task files itself into `Tasks › Completed`
// once the day rolls over, and NOT before.
//
// USER, 2026-08-21: *"make sure appointments or tasks set to complete in the
// tasks, get properly sent to completed at the end of the day even if they arent
// on the schedule"*.
//
// THE CASE THAT MATTERS MOST IS "TICKED TODAY STAYS PUT". Filing on the tick is
// the failure this feature is one comparator away from: `DATE_BEFORE_TODAY` used
// to parse a bare `YYYY-MM-DD` as UTC midnight, so today's own stamp read as
// past and every task vanished the moment it was ticked — invisibly in UTC, and
// wrongly everywhere west of it.
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
import { buildFileCompletedPipeline } from "../../../server/migrations/0179-file-completed-tasks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());

const TASKS_PAGE = "9zU5UYHq5FMn";
const modsById = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
const lbl = (o) => o?.label || modsById[o?.moduleId]?.label || "?";
const COMPLETED = fx.fields.find((f) => f.name === "Completed" && f.type === "boolean").id;
const COMPLETED_ON = fx.fields.find((f) => f.name === "Completed On" && f.type === "date").id;

const localDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDay(d); };
const TODAY = localDay(new Date());
const YESTERDAY = shift(-1);

/** Run the op over a clone of the fixture, after `mutate` has shaped it. */
function run(mutate, passes = 1) {
  const occ = Object.fromEntries(fx.occurrences.map((o) => [o.id, structuredClone(o)]));
  const page = occ[TASKS_PAGE];
  const bins = (page.occurrences || []).map((id) => occ[id]).filter(Boolean);
  const done = bins.find((c) => lbl(c) === "Completed");

  const ctxOf = () => {
    const op = {
      id: "op-file-completed", name: "Tasks: File Completed", enabled: true,
      pipeline: { sources: [], steps: buildFileCompletedPipeline({
        tasksPageId: TASKS_PAGE, doneContainerId: done.id, COMPLETED, COMPLETED_ON }) },
      triggerTypes: ["onLoad"],
      triggerObjects: [{ eventType: "onLoad", subjectType: "grid", targetId: "", priority: 9 }],
      targetOccurrenceId: TASKS_PAGE,
    };
    const fieldsById = Object.fromEntries(fx.fields.map((f) => [f.id, f]));
    const operationsById = { [op.id]: op };
    const state = { grid: fx.grid, gridId: fx.grid._id, fields: fx.fields, modules: fx.modules,
      occurrencesById: occ, modulesById: modsById, fieldsById, operationsById, operations: [op] };
    return [[op], { state, fieldsById, operationsById, occurrencesById: occ, modulesById: modsById }];
  };

  mutate?.(occ, { bins, done });

  const errors = [];
  let ups = [];
  for (let i = 0; i < passes; i++) {
    const [operations, ctx] = ctxOf();
    ups = runMatchingOperations(operations, null, null, ctx,
      { onError: (n, e) => errors.push(`${n}: ${e?.message || e}`) });
    applyEffectsToLiveOccs(occ, ups);
  }

  const binOf = (name) => Object.values(occ).find(
    (o) => lbl(o) === name && (page.occurrences || []).includes(o.id));
  return {
    occ, errors, ups, done: occ[done.id],
    inDone: (occ[done.id].occurrences || []).map((id) => lbl(occ[id])),
    listedBy: (id) => Object.values(occ).filter((o) => (o.occurrences || []).includes(id)).map(lbl),
    binOf,
    moves: ups.filter((u) => u._effect === "UPDATE_ITEM_PARENT").length,
  };
}

/** Tick a task that lives in a Tasks dimension container. */
function tick(occ, name, on) {
  const page = occ[TASKS_PAGE];
  for (const bid of page.occurrences || []) {
    for (const tid of occ[bid]?.occurrences || []) {
      if (lbl(occ[tid]) !== name) continue;
      occ[tid].fields = { ...(occ[tid].fields || {}), [COMPLETED]: { value: true, flow: "in" } };
      if (on) occ[tid].fields[COMPLETED_ON] = { value: on, flow: "in" };
      return { task: occ[tid], bin: occ[bid] };
    }
  }
  throw new Error(`no task "${name}" under the Tasks page`);
}

describe("the fixture's own shape — the controls", () => {
  // Without these, every "did not move" assertion below could be measuring a
  // fixture that has no Completed container rather than an op that declined.
  it("has both fields and exactly one Completed container on the Tasks page", () => {
    expect(COMPLETED).toBeTruthy();
    expect(COMPLETED_ON).toBeTruthy();
    const page = fx.occurrences.find((o) => o.id === TASKS_PAGE);
    const bins = (page.occurrences || []).map((id) => fx.occurrences.find((o) => o.id === id));
    expect(bins.filter((c) => lbl(c) === "Completed")).toHaveLength(1);
  });

  it("runs without error and moves nothing on an untouched fixture", () => {
    const r = run();
    expect(r.errors).toEqual([]);
    expect(r.moves).toBe(0);
  });
});

describe("filing happens at the END of the day, not on the tick", () => {
  it("moves a task ticked YESTERDAY into Completed, and out of its container", () => {
    const r = run((occ) => { tick(occ, "Text Tim", YESTERDAY); });
    expect(r.errors).toEqual([]);
    expect(r.inDone).toContain("Text Tim");
    // The MOVE is the point: listed by Completed and by nothing else.
    const id = Object.values(r.occ).find((o) => lbl(o) === "Text Tim" && o.fields?.[COMPLETED]?.value).id;
    expect(r.listedBy(id)).toEqual(["Completed"]);
    expect(r.occ[id].parentId).toBe(r.done.id);
  });

  // THE DISCRIMINATING CASE — fails against the UTC-midnight parse.
  it("leaves a task ticked TODAY exactly where it is", () => {
    const r = run((occ) => { tick(occ, "Text Tim", TODAY); });
    expect(r.errors).toEqual([]);
    expect(r.inDone).not.toContain("Text Tim");
    expect(r.moves).toBe(0);
  });

  it("leaves a ticked task with NO stamp alone — an empty date is not 'long ago'", () => {
    const r = run((occ) => { tick(occ, "Text Tim", null); });
    expect(r.inDone).not.toContain("Text Tim");
    expect(r.moves).toBe(0);
  });

  it("leaves an UNTICKED task alone even with an old stamp", () => {
    const r = run((occ) => {
      const { task } = tick(occ, "Text Tim", YESTERDAY);
      task.fields[COMPLETED] = { value: false, flow: "in" };
    });
    expect(r.inDone).not.toContain("Text Tim");
    expect(r.moves).toBe(0);
  });
});

describe("the destination, and running twice", () => {
  it("records the container it came from", () => {
    const r = run((occ) => { tick(occ, "Text Tim", YESTERDAY); });
    const moved = Object.values(r.occ).find((o) => lbl(o) === "Text Tim" && o.parentId === r.done.id);
    expect(moved.meta?.filedFrom).toBe(r.binOf("Social").id);
  });

  it("never re-files what is already in Completed — a second pass moves nothing", () => {
    const first = run((occ) => { tick(occ, "Text Tim", YESTERDAY); });
    expect(first.moves).toBe(1);
    const both = run((occ) => { tick(occ, "Text Tim", YESTERDAY); }, 2);
    // Pass 2's effect list is what `moves` reports, so 0 means it declined.
    expect(both.moves).toBe(0);
    expect(both.inDone.filter((n) => n === "Text Tim")).toHaveLength(1);
  });

  it("files several tasks from different containers in one pass", () => {
    const r = run((occ) => {
      tick(occ, "Text Tim", YESTERDAY);
      tick(occ, "Organize files", YESTERDAY);
    });
    expect(r.errors).toEqual([]);
    expect(r.inDone).toEqual(expect.arrayContaining(["Text Tim", "Organize files"]));
    expect(r.moves).toBe(2);
  });
});
