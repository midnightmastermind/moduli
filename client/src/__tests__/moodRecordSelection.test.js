// "Mood: Record Selection" — a click on the Emotions Wheel records a mood.
//
// This is the BEHAVIOURAL half of migration 0046: the migration's own log, and
// the shape checks over its persisted output, prove the pipeline was WRITTEN
// correctly. They cannot prove it RUNS. So this boots the real executor on the
// migration's own exported pipeline builder and fires a real GraphSelectOp,
// asserting the values that land by DIFFING state — the discipline the
// 2026-08-04 entry paid for ("a test that passes before the fix exists is not a
// test"; every assertion here is A/B'd against a deliberately broken world in
// the last describe block).
//
// The pipeline comes from the migration itself rather than a copy, so this can
// never drift from what actually ships to a grid.
import { describe, it, expect, beforeEach } from "vitest";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";
import { buildRecordSelectionPipeline } from "../../../server/migrations/0046-emotions-wheel-graph.mjs";

const GRAPH = "occ-graph";
const OTHER_GRAPH = "occ-other-graph";
const MOOD = "fld-mood";
const DATE = "fld-date";
const TODAY = "2026-08-06";

// Three emotions, standing in for the 128 on the board. Ids are what a click
// carries and what Mood stores — the same ids, which is the whole point of
// pointing Mood at the board (0045).
const LONELY = "occ-lonely";
const HURT = "occ-hurt";

let occurrencesById, modulesById, fieldsById, operations, operationsById, grid;

function makeOp(targetGraph = GRAPH) {
  return {
    id: `op-${targetGraph}`, name: "Mood: Record Selection",
    enabled: true, priority: 3, targetOccurrenceId: targetGraph,
    // Without triggerTypes the op takes the legacy no-config path and fires
    // ONLY on load — a click matches nothing. Kept explicit here because it is
    // exactly what these tests exist to catch.
    triggerTypes: ["onGraphSelect"],
    triggerObjects: [{
      eventType: "onGraphSelect", subjectType: "module",
      subjectRole: "container", targetId: targetGraph,
    }],
    pipeline: buildRecordSelectionPipeline({
      graphOccId: targetGraph, moodFieldId: MOOD, dateFieldId: DATE,
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
    // The mood host is found by BINDING, never by label — renaming the journal
    // must not break recording a feeling.
    "m-journal": { id: "m-journal", role: "container", kind: "doc", label: "Journal",
      fieldBindings: [{ fieldId: MOOD, role: "input" }, { fieldId: DATE, role: "input", hidden: true }] },
    "m-emotion": { id: "m-emotion", role: "instance", label: "Lonely" },
  };
  occurrencesById = {
    [GRAPH]: { id: GRAPH, moduleId: "m-graph", parentId: "occ-day", occurrences: [],
               filterOverride: { [DATE]: TODAY }, fields: {}, meta: { graph: { type: "sunburst", highlight: [] } } },
    [OTHER_GRAPH]: { id: OTHER_GRAPH, moduleId: "m-graph", parentId: "occ-day", occurrences: [],
                     filterOverride: { [DATE]: TODAY }, fields: {}, meta: { graph: { type: "pie" } } },
    "occ-journal": { id: "occ-journal", moduleId: "m-journal", parentId: "occ-day", occurrences: [],
                     fields: { [DATE]: { value: TODAY }, [MOOD]: { value: [] } } },
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

// Exactly what ContainerGraph reports for a click.
function clickSlice(occurrenceId, containerId = GRAPH) {
  const tx = { type: "GraphSelectOp", occurrenceId, containerId, value: 1, path: ["Sad", "Lonely"], name: "Lonely" };
  const updates = runMatchingOperations(operations, "GraphSelectOp", tx, ctx());
  applyEffectsToLiveOccs(occurrencesById, updates);
  return updates;
}
const moods = () => occurrencesById["occ-journal"].fields[MOOD]?.value;

describe("Mood: Record Selection — clicking the wheel records a mood", () => {
  it("writes the clicked emotion onto the day's Mood", () => {
    expect(moods()).toEqual([]);
    clickSlice(LONELY);
    expect(moods()).toEqual([LONELY]);
  });

  it("UNIONS — a day holds several feelings, and re-picking one does not duplicate it", () => {
    // Mood is a multiselect precisely because several feelings in a day is the
    // normal case. A replace here would make the wheel a one-feeling-per-day
    // control, which is not what was asked for.
    clickSlice(LONELY);
    clickSlice(HURT);
    expect(moods()).toEqual([LONELY, HURT]);
    clickSlice(LONELY);
    expect(moods()).toEqual([LONELY, HURT]);
  });

  it("lights the picked slice, with the SAME ids as the field", () => {
    // The highlight and the stored value are one truth written from the other —
    // that is what keeps the renderer from needing to know what a feeling is.
    //
    // Asserted on the EFFECT, not on applied state: `applyEffectsToLiveOccs` is
    // the in-batch overlay and does not apply UPDATE_ITEM_META (the real effect
    // handler does), so reading meta back here would test the harness rather
    // than the op.
    clickSlice(LONELY);
    const updates = clickSlice(HURT);
    const meta = updates.find((u) => u._effect === "UPDATE_ITEM_META");
    expect(meta).toMatchObject({ itemId: GRAPH, metaPath: ["graph", "highlight"] });
    expect(meta.value).toEqual(moods());
  });

  it("records nothing for a slice with no occurrence behind it", () => {
    // A hardcoded literal on a chart carries occurrenceId null. Writing that
    // into a multiselect would poison the field with a null member.
    const updates = clickSlice(null);
    expect(updates.filter((u) => u._effect?.startsWith("UPDATE_ITEM"))).toEqual([]);
    expect(moods()).toEqual([]);
  });
});

describe("Mood: Record Selection — scoping", () => {
  it("ignores a click on a DIFFERENT graph", () => {
    // subjectType:"occurrence" is not a case matchSubjectFilter knows, so it
    // falls through to "match anything" — with that shape this op fired for
    // every graph on the grid. The trigger uses subjectRole:"container", which
    // compares transaction.containerId. This test is what pins that.
    clickSlice(LONELY, OTHER_GRAPH);
    expect(moods()).toEqual([]);
  });

  it("records against the day the WHEEL is showing, not today", () => {
    // The wheel sits on a day column. Looking at yesterday and clicking a
    // feeling must record it on YESTERDAY — so the day comes from the graph's
    // own effective filter, never from $today.
    const YESTERDAY = "2026-08-05";
    occurrencesById[GRAPH].filterOverride = { [DATE]: YESTERDAY };
    occurrencesById["occ-yesterday"] = {
      id: "occ-yesterday", moduleId: "m-journal", occurrences: [],
      fields: { [DATE]: { value: YESTERDAY }, [MOOD]: { value: [] } },
    };
    clickSlice(LONELY);
    expect(occurrencesById["occ-yesterday"].fields[MOOD].value).toEqual([LONELY]);
    expect(moods()).toEqual([]);   // today's journal untouched
  });
});

describe("Mood: Record Selection — the assertions DISCRIMINATE", () => {
  // A behavioural test that cannot fail is not a test (2026-08-04). Each case
  // breaks one thing the pipeline depends on and shows the write stops.
  it("no host binds Mood → nothing is written and nothing throws", () => {
    modulesById["m-journal"].fieldBindings = [{ fieldId: DATE, role: "input" }];
    clickSlice(LONELY);
    expect(moods()).toEqual([]);
  });

  it("the host is on another day → nothing is written", () => {
    occurrencesById["occ-journal"].fields[DATE] = { value: "2026-07-01" };
    clickSlice(LONELY);
    expect(moods()).toEqual([]);
  });

  it("the op is disabled → nothing is written", () => {
    operations[0].enabled = false;
    clickSlice(LONELY);
    expect(moods()).toEqual([]);
  });
});
