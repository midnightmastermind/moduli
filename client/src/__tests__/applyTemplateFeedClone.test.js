// APPLY_TEMPLATE and FED children (user's call, 2026-08-07: a graph's members
// come from its feed, not from hand-dragged occurrences).
//
// A child carrying `meta.feedSourceId` is DERIVED — feedSync minted it from the
// owner's `feed` config — so cloning it copies a query RESULT instead of
// re-running the query. Measured: 128 of test grid 2's Day Page template's 136
// descendants were feed copies, cloned into every day column.
//
// THE TWO HALVES ARE ONE CHANGE. Skipping fed children without carrying `feed`
// onto the clone leaves every cloned graph permanently empty — strictly worse
// than doing neither. Both are asserted here, and the "carries feed" test is
// what stops someone "simplifying" the skip on its own.
import { describe, it, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

const mod = (id, extra = {}) => ({ id, label: id, role: "container", kind: "doc", meta: {}, ...extra });

function world() {
  // template root -> [ graph(with feed) -> [fed A, fed B, hand-placed C], plain ]
  const occurrencesById = {
    tpl:   { id: "tpl", moduleId: "m-tpl", occurrences: ["graph", "plain"], meta: {}, fields: {} },
    graph: {
      id: "graph", moduleId: "m-graph", occurrences: ["fedA", "fedB", "handC"], fields: {}, meta: {},
      feed: { enabled: true, conditions: [{ left: "tag", comparator: "IS", right: "emotion" }] },
    },
    fedA:  { id: "fedA", moduleId: "m-a", occurrences: [], fields: {}, meta: { feedSourceId: "src-a" } },
    fedB:  { id: "fedB", moduleId: "m-b", occurrences: [], fields: {}, meta: { feedSourceId: "src-b" } },
    handC: { id: "handC", moduleId: "m-c", occurrences: [], fields: {}, meta: {} },
    plain: { id: "plain", moduleId: "m-p", occurrences: [], fields: {}, meta: {} },
    dest:  { id: "dest", moduleId: "m-dest", occurrences: [], fields: {}, meta: {} },
  };
  const modulesById = {
    "m-tpl": mod("m-tpl"), "m-graph": mod("m-graph"), "m-a": mod("m-a"),
    "m-b": mod("m-b"), "m-c": mod("m-c"), "m-p": mod("m-p"), "m-dest": mod("m-dest"),
  };
  return { occurrencesById, modulesById };
}

function apply(mode = undefined) {
  const { occurrencesById, modulesById } = world();
  const $vars = {
    $allOccurrences: Object.values(occurrencesById),
    $allItems: Object.values(occurrencesById),
    $tplId: "tpl",
    $destId: "dest",
  };
  const updates = executeActionItem(
    "APPLY_TEMPLATE",
    { templateRef: "$tplId", targetOccurrenceVar: "$destId", ...(mode ? { mode } : {}) },
    $vars,
    { occurrencesById, modulesById, fieldsById: {} },
  ) || [];
  const creates = updates.filter((u) => u._effect === "CREATE_ITEM");
  // The clone's module carries the SOURCE module's label (mod(id) sets
  // label === id), so that is how a clone is traced back to what it came from.
  return { creates, byLabel: (l) => creates.filter((c) => c.template?.label === l) };
}

describe("APPLY_TEMPLATE — fed children are re-materialized, not copied", () => {
  it("does NOT clone children carrying meta.feedSourceId", () => {
    const { byLabel } = apply();
    expect(byLabel("m-a")).toHaveLength(0);
    expect(byLabel("m-b")).toHaveLength(0);
  });

  it("STILL clones a hand-placed sibling of those fed children", () => {
    // The discriminator is meta.feedSourceId, not "is a child of a fed
    // container" — feed items and hand-placed occurrences coexist by design.
    const { byLabel } = apply();
    expect(byLabel("m-c")).toHaveLength(1);
  });

  it("carries the `feed` config onto the clone — the other half", () => {
    // Without this the graph clone is empty forever and the skip above is a
    // regression rather than a fix.
    const { byLabel } = apply();
    const graphClone = byLabel("m-graph")[0];
    expect(graphClone).toBeTruthy();
    expect(graphClone.instance.feed).toEqual({
      enabled: true,
      conditions: [{ left: "tag", comparator: "IS", right: "emotion" }],
    });
  });

  it("does not invent a `feed` key on a clone whose source has none", () => {
    const { byLabel } = apply();
    expect(byLabel("m-p")[0].instance).not.toHaveProperty("feed");
  });

  it("the graph clone's child list excludes the fed rows", () => {
    const { byLabel } = apply();
    const graphClone = byLabel("m-graph")[0];
    // Exactly one child survives — the hand-placed one.
    expect(graphClone.instance.occurrences).toHaveLength(1);
  });

  it("behaves the same in MERGE mode", () => {
    const { byLabel } = apply("merge");
    expect(byLabel("m-a")).toHaveLength(0);
    expect(byLabel("m-b")).toHaveLength(0);
    expect(byLabel("m-c")).toHaveLength(1);
  });
});
