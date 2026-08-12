// "Mood: Record Selection" — a click on the Emotions Wheel records a mood.
//
// This is the BEHAVIOURAL half of migration 0079 (which repairs 0046): the
// migration's own log proves the pipeline was WRITTEN; only this proves it
// RUNS. It boots the real executor on the migration's own exported pipeline
// builder and fires a real GraphSelectOp, asserting by DIFFING state.
//
// The pipeline comes from the migration itself rather than a copy, so this can
// never drift from what actually ships to a grid.
//
// THE FIXTURE MIRRORS THE LIVE SHAPE, because the live shape is what broke it:
// the wheel is ONE occurrence multi-parented into several day columns and
// carries NO filter of its own, and the journals live under the SCHEDULE, not
// inside the columns. A fixture where the graph owns a tidy filterOverride —
// which is what 0046's tests used — passes against code that cannot work.
import { describe, it, expect, beforeEach } from "vitest";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";
import { buildPerDayPipeline } from "../../../server/migrations/0084-highlight-is-per-day.mjs";
import { buildFieldReadPipeline } from "../../../server/migrations/0085-wheel-reads-the-field.mjs";
import { buildAlwaysLandsPipeline } from "../../../server/migrations/0086-a-click-always-lands.mjs";
import { buildCheckInTruthPipeline } from "../../../server/migrations/0087-the-check-in-is-the-truth.mjs";

const GRAPH = "occ-graph";
const OTHER_GRAPH = "occ-other-graph";
const MOOD = "fld-mood";
const DATE = "fld-date";
const SCHED = "occ-sched";           // the Schedule page — the host scope
const TODAY = "2026-08-11";
const YESTERDAY = "2026-08-10";
const COL_TODAY = "occ-col-today";
const COL_YESTER = "occ-col-yester";

const LONELY = "occ-lonely";
const HURT = "occ-hurt";
// The Check In half (0083): the tracker counts an INSTANCE carrying a Mood and
// a Date under the Schedule, which is what these place.
const TIMESLOT = "fld-timeslot";
const COMPLETED = "fld-completed";
const CHECKIN_SRC = "occ-checkin-src";      // the Routines catalog entry
const TODO_TODAY = "occ-todo-today";
const TODO_YESTER = "occ-todo-yester";

let occurrencesById, modulesById, fieldsById, operations, operationsById, grid;

function makeOp(targetGraph = GRAPH) {
  return {
    id: `op-${targetGraph}`, name: "Mood: Record Selection",
    enabled: true, priority: 3, targetOccurrenceId: targetGraph,
    // Without triggerTypes the op takes the legacy no-config path and fires
    // ONLY on load — a click matches nothing.
    triggerTypes: ["onGraphSelect"],
    triggerObjects: [{
      eventType: "onGraphSelect", subjectType: "module",
      subjectRole: "container", targetId: targetGraph,
    }],
    // 0084 is what SHIPS, so the whole suite runs against it — every existing
    // assertion below therefore also proves the Check In steps did not disturb
    // the mood/highlight writes they were folded into.
    pipeline: buildPerDayPipeline({
      graphOccId: targetGraph, moodFieldId: MOOD, dateFieldId: DATE,
      schedulePageOccId: SCHED, checkInSourceOccId: CHECKIN_SRC,
      timeslotFieldId: TIMESLOT, completedFieldId: COMPLETED,
    }),
  };
}

beforeEach(() => {
  grid = { _id: "g1", activeFilterValues: {} };
  fieldsById = {
    [MOOD]: { id: MOOD, name: "Mood", type: "occurrence", inputEnabled: true, meta: { multiSelect: true } },
    [DATE]: { id: DATE, name: "Date", type: "date", inputEnabled: true },
    [TIMESLOT]: { id: TIMESLOT, name: "Time Slot", type: "select", inputEnabled: true },
    [COMPLETED]: { id: COMPLETED, name: "Completed", type: "boolean", inputEnabled: true },
  };
  modulesById = {
    "m-graph": { id: "m-graph", role: "container", kind: "graph", label: "Emotions Wheel" },
    "m-col": { id: "m-col", role: "container", kind: "doc", label: "Day Column" },
    "m-page": { id: "m-page", role: "page", kind: "board", label: "Schedule" },
    // The mood host is found by BINDING, never by label — renaming the journal
    // must not break recording a feeling.
    "m-journal": { id: "m-journal", role: "container", kind: "doc", label: "Journal",
      fieldBindings: [{ fieldId: MOOD, role: "input" }, { fieldId: DATE, role: "input", hidden: true }] },
    "m-emotion": { id: "m-emotion", role: "instance", label: "Lonely" },
    "m-todo": { id: "m-todo", role: "container", kind: "board", label: "Todo" },
    // Check In binds Completed, which is why the tracker skips it until ticked.
    "m-checkin": { id: "m-checkin", role: "instance", label: "Check In",
      fieldBindings: [
        { fieldId: COMPLETED, role: "input" }, { fieldId: MOOD, role: "input" },
        { fieldId: DATE, role: "input", hidden: true },
      ] },
  };
  occurrencesById = {
    // ONE wheel, listed by BOTH columns, with no filter of its own — the live
    // shape after 0068. Its day is therefore not derivable from the data.
    [GRAPH]: { id: GRAPH, moduleId: "m-graph", occurrences: [], fields: {},
               meta: { graph: { type: "sunburst", highlight: [] } } },
    [OTHER_GRAPH]: { id: OTHER_GRAPH, moduleId: "m-graph", occurrences: [], fields: {},
                     meta: { graph: { type: "pie" } } },
    // Each column lists the wheel AND its own Todo — the live shape, where the
    // Todo is multi-parented into both the column and the Schedule day column.
    [COL_TODAY]: { id: COL_TODAY, moduleId: "m-col", occurrences: [GRAPH, TODO_TODAY],
                   fields: { [DATE]: { value: TODAY } } },
    [COL_YESTER]: { id: COL_YESTER, moduleId: "m-col", occurrences: [GRAPH, TODO_YESTER],
                    fields: { [DATE]: { value: YESTERDAY } } },
    [TODO_TODAY]: { id: TODO_TODAY, moduleId: "m-todo", occurrences: [],
                    fields: { [TIMESLOT]: { value: "Todo" } } },
    [TODO_YESTER]: { id: TODO_YESTER, moduleId: "m-todo", occurrences: [],
                     fields: { [TIMESLOT]: { value: "Todo" } } },
    // The catalog entry the placement copies — lives in Routines, not the Schedule.
    [CHECKIN_SRC]: { id: CHECKIN_SRC, moduleId: "m-checkin", occurrences: [], fields: {} },
    // The journals live under the SCHEDULE, not in the columns.
    [SCHED]: { id: SCHED, moduleId: "m-page", occurrences: ["occ-journal", "occ-journal-yester"] },
    "occ-journal": { id: "occ-journal", moduleId: "m-journal", parentId: SCHED, occurrences: [],
                     fields: { [DATE]: { value: TODAY }, [MOOD]: { value: [] } } },
    "occ-journal-yester": { id: "occ-journal-yester", moduleId: "m-journal", parentId: SCHED, occurrences: [],
                            fields: { [DATE]: { value: YESTERDAY }, [MOOD]: { value: [] } } },
    [LONELY]: { id: LONELY, moduleId: "m-emotion", occurrences: [], fields: {} },
    [HURT]: { id: HURT, moduleId: "m-emotion", occurrences: [], fields: {} },
  };
  operations = [makeOp()];
  operationsById = Object.fromEntries(operations.map((o) => [o.id, o]));
});

const ctx = () => ({
  state: {
    grid, gridId: grid._id,
    fields: Object.values(fieldsById), modules: Object.values(modulesById),
    occurrencesById, modulesById, fieldsById, operationsById, operations,
  },
  fieldsById, operationsById, occurrencesById, modulesById,
});

// Exactly what ContainerGraph reports for a click, including WHERE it happened.
function clickSlice(occurrenceId, { graph = GRAPH, column = COL_TODAY } = {}) {
  const tx = {
    type: "GraphSelectOp", occurrenceId, containerId: graph,
    ancestorOccurrenceId: column, value: 1, path: ["Sad", "Lonely"], name: "Lonely",
  };
  const updates = runMatchingOperations(operations, "GraphSelectOp", tx, ctx());
  applyEffectsToLiveOccs(occurrencesById, updates);
  return updates;
}
const moods = () => occurrencesById["occ-journal"].fields[MOOD]?.value;
const moodsYester = () => occurrencesById["occ-journal-yester"].fields[MOOD]?.value;

describe("Mood: Record Selection — clicking the wheel records a mood", () => {
  it("writes the clicked emotion onto the day's Mood", () => {
    expect(moods()).toEqual([]);
    clickSlice(LONELY);
    expect(moods()).toEqual([LONELY]);
  });

  it("TOGGLES — clicking a recorded feeling takes it back", () => {
    // User, 2026-08-12: "if i click that one again, it should remove it."
    // MERGE_ARRAY alone is union-only, so a wheel could only ever fill up.
    clickSlice(LONELY);
    expect(moods()).toEqual([LONELY]);
    clickSlice(LONELY);
    expect(moods()).toEqual([]);
  });

  it("holds SEVERAL feelings, and removing one leaves the others", () => {
    // "if i click on another one, both should be selected and added."
    clickSlice(LONELY);
    clickSlice(HURT);
    expect(moods()).toEqual([LONELY, HURT]);
    clickSlice(LONELY);
    expect(moods()).toEqual([HURT]);
    clickSlice(LONELY);
    expect(moods()).toEqual([HURT, LONELY]);
  });

  it("the HIGHLIGHT follows the toggle — one truth, written twice", () => {
    // Removing a feeling must clear its slice, or the wheel shows a mood the
    // day no longer holds.
    clickSlice(LONELY);
    clickSlice(HURT);
    const updates = clickSlice(LONELY);
    const meta = updates.find((u) => u._effect === "UPDATE_ITEM_META");
    expect(meta.value).toEqual([HURT]);
    expect(meta.value).toEqual(moods());
  });

  it("lights the picked slice, with the SAME ids as the field", () => {
    // The highlight and the stored value are one truth written from the other.
    // Asserted on the EFFECT: applyEffectsToLiveOccs is the in-batch overlay and
    // does not apply UPDATE_ITEM_META, so reading meta back would test the
    // harness rather than the op.
    clickSlice(LONELY);
    const updates = clickSlice(HURT);
    const meta = updates.find((u) => u._effect === "UPDATE_ITEM_META");
    // The path gained the DAY as of 0084: the wheel is one occurrence shared by
    // every column, so a whole-graph highlight lit the same slices on every day.
    // The "one truth" property this test exists for is unchanged — the ids
    // written still equal the day's stored moods.
    expect(meta).toMatchObject({ itemId: GRAPH, metaPath: ["graph", "highlight", TODAY] });
    expect(meta.value).toEqual(moods());
  });

  it("records nothing for a slice with no occurrence behind it", () => {
    const updates = clickSlice(null);
    expect(updates.filter((u) => u._effect?.startsWith("UPDATE_ITEM"))).toEqual([]);
    expect(moods()).toEqual([]);
  });
});

describe("Mood: Record Selection — the day comes from the COLUMN that was clicked", () => {
  it("records on the column clicked in, not on some other column", () => {
    // THE HEADLINE. The wheel is one shared occurrence listed by both columns,
    // so no ancestor walk can tell them apart — buildParentMap keys child → ONE
    // parent, last writer wins. Only the reported render context can.
    clickSlice(LONELY, { column: COL_YESTER });
    expect(moodsYester()).toEqual([LONELY]);
    expect(moods()).toEqual([]);          // today's journal untouched
  });

  it("the SAME wheel records to different days depending on where it was clicked", () => {
    clickSlice(LONELY, { column: COL_TODAY });
    clickSlice(HURT, { column: COL_YESTER });
    expect(moods()).toEqual([LONELY]);
    expect(moodsYester()).toEqual([HURT]);
  });

  it("a PERIOD OBJECT on the wheel's own filter no longer blocks the write", () => {
    // Defect 1, pinned. The date picker writes {value,unit,span,kind} even for a
    // single day, and SAME_DAY cannot compare a date string to an object — every
    // candidate failed and the op exited silently. The day now comes from the
    // column, so the object is never in the comparison.
    occurrencesById[GRAPH].filterOverride = {
      [DATE]: { value: TODAY, unit: "day", span: 2, kind: "range" },
    };
    clickSlice(LONELY);
    expect(moods()).toEqual([LONELY]);
  });

  it("ignores a click on a DIFFERENT graph", () => {
    clickSlice(LONELY, { graph: OTHER_GRAPH });
    expect(moods()).toEqual([]);
  });
});

describe("Mood: Record Selection — the host find stays SINGLE", () => {
  it("an orphan journal on the same day is ignored, and nothing throws", () => {
    // Defect 2, pinned. poms grid carries orphaned journals (one with no parent
    // at all) sharing a date with the real one. A multi-match binds an ARRAY and
    // UPDATE throws "$moodHost is not a record (no .id)" — a silent no-op turned
    // into a crash. Scoping to the Schedule page is what keeps it to one.
    occurrencesById["occ-orphan"] = {
      id: "occ-orphan", moduleId: "m-journal", occurrences: [],
      fields: { [DATE]: { value: TODAY }, [MOOD]: { value: [] } },
    };
    expect(() => clickSlice(LONELY)).not.toThrow();
    expect(moods()).toEqual([LONELY]);
    expect(occurrencesById["occ-orphan"].fields[MOOD].value).toEqual([]);
  });
});

describe("Mood: Record Selection — the assertions DISCRIMINATE", () => {
  // A behavioural test that cannot fail is not a test (2026-08-04). Each case
  // breaks one thing the pipeline depends on and shows the write stops.
  it("no host binds Mood → nothing is written and nothing throws", () => {
    modulesById["m-journal"].fieldBindings = [{ fieldId: DATE, role: "input" }];
    expect(() => clickSlice(LONELY)).not.toThrow();
    expect(moods()).toEqual([]);
  });

  it("the host is on another day → nothing is written", () => {
    occurrencesById["occ-journal"].fields[DATE] = { value: "2026-07-01" };
    clickSlice(LONELY);
    expect(moods()).toEqual([]);
  });

  it("the host sits OUTSIDE the Schedule → nothing is written", () => {
    // The cost of the scoping, stated as a test rather than left implicit.
    occurrencesById[SCHED].occurrences = [];
    occurrencesById["occ-journal"].parentId = null;
    clickSlice(LONELY);
    expect(moods()).toEqual([]);
  });

  it("the op is disabled → nothing is written", () => {
    operations[0].enabled = false;
    clickSlice(LONELY);
    expect(moods()).toEqual([]);
  });
});

// ── 0083: the pick also places a Check In, which is what the tracker counts ──
// The Moods tracker loops $allInstances and requires Mood + Date + HAS_ANCESTOR
// <Schedule> + Completed. The Journal is a CONTAINER, so it can never satisfy
// that — these assert the INSTANCE that can.
const creates = (updates) => updates.filter((u) => u._effect === "CREATE_ITEM");
const deletes = (updates) => updates.filter((u) => u._effect === "DELETE_ITEM" || u._effect === "DELETE");

describe("Mood: Record Selection — a pick places a Check In in that day's Todo", () => {
  it("mints a Check In into the Todo of the column that was clicked", () => {
    const updates = clickSlice(LONELY, { column: COL_TODAY });
    const made = creates(updates);
    expect(made).toHaveLength(1);
    const inst = made[0].instance;
    expect(inst.templateId).toBe("m-checkin");     // the SAME module, not a clone
    expect(inst.parentId).toBe(TODO_TODAY);
    expect(inst.fields[DATE].value).toBe(TODAY);
    expect(inst.fields[MOOD].value).toEqual([LONELY]);
  });

  it("stamps Completed, or the tracker skips it", () => {
    const inst = creates(clickSlice(LONELY))[0].instance;
    expect(inst.fields[COMPLETED].value).toBe(true);
  });

  it("carries NO linkedGroupId — ticking one must not tick every other", () => {
    const inst = creates(clickSlice(LONELY))[0].instance;
    expect(inst.linkedGroupId ?? null).toBeNull();
  });

  it("follows the CLICKED column — yesterday's pick lands in yesterday's Todo", () => {
    const inst = creates(clickSlice(LONELY, { column: COL_YESTER }))[0].instance;
    expect(inst.parentId).toBe(TODO_YESTER);
    expect(inst.fields[DATE].value).toBe(YESTERDAY);
  });

  it("two different feelings place two Check Ins (one per click)", () => {
    clickSlice(LONELY);
    const updates = clickSlice(HURT);
    expect(creates(updates)).toHaveLength(1);
    expect(moods()).toEqual([LONELY, HURT]);
  });

  it("UN-picking deletes the Check In, so the tracker cannot drift from the wheel", () => {
    clickSlice(LONELY);
    const undo = clickSlice(LONELY);          // same slice again = un-pick
    expect(creates(undo)).toHaveLength(0);
    expect(deletes(undo).length).toBeGreaterThan(0);
    expect(moods()).toEqual([]);
  });

  // DISCRIMINATORS — an assertion of absence proves nothing until the thing has
  // been shown to be present, so each of these breaks exactly one precondition.
  it("no Todo under the clicked column → no Check In, and nothing throws", () => {
    occurrencesById[COL_TODAY].occurrences = [GRAPH];   // Todo no longer listed
    const updates = clickSlice(LONELY);
    expect(creates(updates)).toHaveLength(0);
    expect(moods()).toEqual([LONELY]);                  // the mood still records
  });

  it("a container that is not the Todo is never used as the destination", () => {
    occurrencesById[TODO_TODAY].fields[TIMESLOT] = { value: "9:00am" };
    expect(creates(clickSlice(LONELY))).toHaveLength(0);
  });
});

// ── The highlight write is keyed by the day that was clicked ──────────────
describe("Mood: Record Selection — the highlight is stored PER DAY", () => {
  const metaWrites = (updates) => updates.filter((u) => u._effect === "UPDATE_ITEM_META");

  it("writes the highlight under the clicked day, not over the whole graph", () => {
    const w = metaWrites(clickSlice(LONELY, { column: COL_TODAY }));
    expect(w).toHaveLength(1);
    // meta.graph.highlight.<day> — the day is the LAST path segment.
    expect(w[0].metaPath).toEqual(["graph", "highlight", TODAY]);
    expect(w[0].value).toEqual([LONELY]);
  });

  it("a pick on another day writes under THAT day — the two cannot collide", () => {
    const w = metaWrites(clickSlice(HURT, { column: COL_YESTER }));
    expect(w[0].metaPath).toEqual(["graph", "highlight", YESTERDAY]);
  });
});

describe("0085 — the wheel reads the field, so the op stops writing a copy", () => {
  const walk = (steps, out = []) => {
    for (const st of steps || []) {
      out.push(st);
      if (st.type === "if") { walk(st.then, out); walk(st.else, out); }
    }
    return out;
  };
  const args = {
    graphOccId: GRAPH, moodFieldId: MOOD, dateFieldId: DATE,
    schedulePageOccId: SCHED, checkInSourceOccId: CHECKIN_SRC,
    timeslotFieldId: TIMESLOT, completedFieldId: COMPLETED,
  };

  it("removes the highlight write and NOTHING else", () => {
    const before = walk(buildPerDayPipeline(args).steps);
    const after = walk(buildFieldReadPipeline(args).steps);
    const hl = (steps) => steps.filter(
      (st) => st.actionType === "UPDATE" &&
        String(st.config?.path || "").startsWith("$graph.meta.graph.highlight"));
    expect(hl(before)).toHaveLength(1);
    expect(hl(after)).toHaveLength(0);
    expect(after).toHaveLength(before.length - 1);
  });

  it("KEEPS the Mood write to the journal — that is what the wheel now reads", () => {
    const after = walk(buildFieldReadPipeline(args).steps);
    const moodWrites = after.filter(
      (st) => st.actionType === "UPDATE" && String(st.config?.path || "").includes(MOOD));
    expect(moodWrites.length).toBeGreaterThan(0);
  });

  it("KEEPS the Check In placement, so a drag still has a row to drag", () => {
    const after = walk(buildFieldReadPipeline(args).steps);
    expect(after.some((st) => st.actionType === "COPY_LINK")).toBe(true);
    expect(after.some((st) => st.actionType === "DELETE")).toBe(true);
  });

  // NOT TESTED, and said plainly rather than faked: the `removed !== 1` guard is
  // unreachable through the public API — buildPerDayPipeline throws first if the
  // write it re-keys is missing, so there is no way to hand this function a
  // pipeline without one. It is a fail-closed assertion for a FUTURE edit
  // upstream, and an earlier version of this block "tested" it by throwing the
  // error itself, which proves nothing.
});

describe("0086 — a click lands on EVERY day, not just the one with a Todo", () => {
  const walk = (steps, out = []) => {
    for (const st of steps || []) { out.push(st); if (st.type === "if") { walk(st.then, out); walk(st.else, out); } }
    return out;
  };
  const args = {
    graphOccId: GRAPH, moodFieldId: MOOD, dateFieldId: DATE,
    schedulePageOccId: SCHED, checkInSourceOccId: CHECKIN_SRC,
    timeslotFieldId: TIMESLOT, completedFieldId: COMPLETED,
  };
  const built = () => walk(buildAlwaysLandsPipeline(args).steps);

  it("places the Check In under $placeParent, never the Todo directly", () => {
    const cl = built().filter((st) => st.actionType === "COPY_LINK");
    expect(cl).toHaveLength(1);
    expect(cl[0].config.parent).toBe("$placeParent");
  });

  it("resolves $placeParent to the Todo when there is one, else the COLUMN", () => {
    const steps = built();
    const gate = steps.find((st) =>
      st.type === "if" && (st.condition?.rules || []).some((r) => r.left === "$todo") &&
      (st.then || []).some((s) => s.config?.name === "$placeParent"));
    expect(gate.then[0].config.expr).toBe("$todo.id");
    // The fallback is the clicked COLUMN — not the Schedule page (which belongs to
    // no day) and not nothing (the silent half-success this fixes).
    expect(gate.else[0].config.expr).toBe("$col.id");
  });

  it("the placement is NO LONGER gated on the Todo existing", () => {
    const gated = built().some((st) =>
      st.type === "if" &&
      (st.condition?.rules || []).some((r) => r.left === "$todo" && r.comparator === "IS_NOT_EMPTY") &&
      (st.then || []).some((s) => s.actionType === "COPY_LINK"));
    expect(gated).toBe(false);
  });

  it("un-picking looks under the SAME parent, or a fallback row is undeletable", () => {
    const finds = built().filter((st) => st.actionType === "FIND");
    const stale = finds.find((f) => f.config?.itemVar === "$staleCheckIn");
    const anc = (stale.config.predicate.rules || []).find((r) => r.comparator === "HAS_ANCESTOR");
    expect(anc.right).toBe("$placeParent");
    // $todo.id still appears exactly once — in the SET_VAR that RESOLVES the
    // fallback. What must be gone is any SCOPE or PARENT still pinned to it.
    const steps = built();
    expect(steps.filter((st) => st.actionType === "COPY_LINK" && st.config?.parent === "$todo.id")).toHaveLength(0);
    expect(steps.filter((st) => (st.config?.predicate?.rules || [])
      .some((r) => r.right === "$todo.id"))).toHaveLength(0);
  });

  it("declares $placeParent before use — an unbound var THROWS in the executor", () => {
    const steps = buildAlwaysLandsPipeline(args).steps;
    expect(steps[0].actionType).toBe("INIT_VAR");
    expect(steps[0].config.name).toBe("$placeParent");
  });

  it("still records the mood and still finds the day's Todo", () => {
    const steps = built();
    expect(steps.some((st) => st.actionType === "UPDATE" && String(st.config?.path || "").includes(MOOD))).toBe(true);
    expect(steps.some((st) => st.actionType === "FIND" && st.config?.itemVar === "$todo")).toBe(true);
  });
});

describe("0087 — the Check In is the truth, so a journal-less day still works", () => {
  const walk = (steps, out = []) => {
    for (const st of steps || []) { out.push(st); if (st.type === "if") { walk(st.then, out); walk(st.else, out); } }
    return out;
  };
  const args = {
    graphOccId: GRAPH, moodFieldId: MOOD, dateFieldId: DATE,
    schedulePageOccId: SCHED, checkInSourceOccId: CHECKIN_SRC,
    timeslotFieldId: TIMESLOT, completedFieldId: COMPLETED,
  };
  const top = () => buildCheckInTruthPipeline(args).steps;
  const all = () => walk(top());
  const hostGates = (steps) => walk(steps).filter((st) =>
    st.type === "if" && (st.condition?.rules || []).length === 1 &&
    st.condition.rules[0]?.left === "$moodHost");

  it("the PLACEMENT no longer sits under the journal gate", () => {
    // The whole defect: on a day with no journal the gate is false and the click
    // silently does nothing.
    for (const g of hostGates(top())) {
      expect(walk(g.then).some((s) => s.actionType === "COPY_LINK")).toBe(false);
    }
    expect(all().some((s) => s.actionType === "COPY_LINK")).toBe(true);
  });

  it("the journal gate now guards ONLY reading and writing the journal", () => {
    const gates = hostGates(top());
    expect(gates.length).toBe(2);
    const kinds = gates.map((g) => (g.then || []).map((s) => s.actionType).join(","));
    expect(kinds).toContain("INIT_VAR");
    expect(kinds.some((k) => k.includes("UPDATE"))).toBe(true);
  });

  it("the toggle asks the CHECK IN first, with the journal as an OR fallback", () => {
    const toggle = all().find((st) =>
      st.type === "if" && (st.condition?.rules || []).some((r) => r.left === "$staleCheckIn"));
    expect(toggle.condition.operator).toBe("OR");
    // The journal arm is load-bearing: 7 feelings were recorded before Check Ins
    // existed and live only there — without it, clicking one would DUPLICATE.
    expect(toggle.condition.rules.some((r) => r.left === "$moods")).toBe(true);
  });

  it("the stale-Check-In FIND runs BEFORE the toggle, not inside its THEN", () => {
    const flat = top();
    const idxFind = walk(flat).findIndex((s) => s.config?.itemVar === "$staleCheckIn");
    const idxToggle = walk(flat).findIndex((s) =>
      s.type === "if" && (s.condition?.rules || []).some((r) => r.left === "$staleCheckIn"));
    expect(idxFind).toBeGreaterThanOrEqual(0);
    expect(idxFind).toBeLessThan(idxToggle);
  });

  it("still deletes on un-pick and still places on pick", () => {
    const toggle = all().find((st) =>
      st.type === "if" && (st.condition?.rules || []).some((r) => r.left === "$staleCheckIn"));
    expect(walk(toggle.then).some((s) => s.actionType === "DELETE")).toBe(true);
    expect(walk(toggle.else).some((s) => s.actionType === "COPY_LINK")).toBe(true);
  });
});
