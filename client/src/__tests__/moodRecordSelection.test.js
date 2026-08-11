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
import { buildRecordSelectionPipeline } from "../../../server/migrations/0079-mood-records-the-clicked-day.mjs";

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
    pipeline: buildRecordSelectionPipeline({
      graphOccId: targetGraph, moodFieldId: MOOD, dateFieldId: DATE,
      schedulePageOccId: SCHED,
    }),
  };
}

beforeEach(() => {
  grid = { _id: "g1", activeFilterValues: {} };
  fieldsById = {
    [MOOD]: { id: MOOD, name: "Mood", type: "occurrence", inputEnabled: true, meta: { multiSelect: true } },
    [DATE]: { id: DATE, name: "Date", type: "date", inputEnabled: true },
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
  };
  occurrencesById = {
    // ONE wheel, listed by BOTH columns, with no filter of its own — the live
    // shape after 0068. Its day is therefore not derivable from the data.
    [GRAPH]: { id: GRAPH, moduleId: "m-graph", occurrences: [], fields: {},
               meta: { graph: { type: "sunburst", highlight: [] } } },
    [OTHER_GRAPH]: { id: OTHER_GRAPH, moduleId: "m-graph", occurrences: [], fields: {},
                     meta: { graph: { type: "pie" } } },
    [COL_TODAY]: { id: COL_TODAY, moduleId: "m-col", occurrences: [GRAPH],
                   fields: { [DATE]: { value: TODAY } } },
    [COL_YESTER]: { id: COL_YESTER, moduleId: "m-col", occurrences: [GRAPH],
                    fields: { [DATE]: { value: YESTERDAY } } },
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

  it("UNIONS — a day holds several feelings, and re-picking one does not duplicate it", () => {
    clickSlice(LONELY);
    clickSlice(HURT);
    expect(moods()).toEqual([LONELY, HURT]);
    clickSlice(LONELY);
    expect(moods()).toEqual([LONELY, HURT]);
  });

  it("lights the picked slice, with the SAME ids as the field", () => {
    // The highlight and the stored value are one truth written from the other.
    // Asserted on the EFFECT: applyEffectsToLiveOccs is the in-batch overlay and
    // does not apply UPDATE_ITEM_META, so reading meta back would test the
    // harness rather than the op.
    clickSlice(LONELY);
    const updates = clickSlice(HURT);
    const meta = updates.find((u) => u._effect === "UPDATE_ITEM_META");
    expect(meta).toMatchObject({ itemId: GRAPH, metaPath: ["graph", "highlight"] });
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
