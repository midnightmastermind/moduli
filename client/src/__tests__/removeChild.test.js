// REMOVE_CHILD is the inverse of ADD_CHILD: it unlinks a child from a parent's
// occurrences[] and must NEVER delete the child, because the children it tidies
// (the day page's Todo, its completed tasks) are the Schedule's own occurrences,
// multi-parented in.
import { describe, test, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

function run(cfg, { parent, vars = {} } = {}) {
  const occurrencesById = parent ? { [parent.id]: { ...parent } } : {};
  const updates = executeActionItem(
    "REMOVE_CHILD",
    { ...cfg },
    { ...vars },
    { occurrencesById, modulesById: {}, fieldsById: {}, state: {} },
    null
  );
  return { updates: updates || [], occurrencesById };
}

describe("REMOVE_CHILD", () => {
  test("unlinks the child from the parent's occurrences[]", () => {
    const { updates } = run(
      { parentId: "P", childId: "b" },
      { parent: { id: "P", occurrences: ["a", "b", "c"] } }
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ _effect: "UPDATE_OCCURRENCE" });
    expect(updates[0].occurrence).toEqual({ id: "P", occurrences: ["a", "c"] });
  });

  test("emits NO delete effect — the child occurrence survives", () => {
    const { updates } = run(
      { parentId: "P", childId: "b" },
      { parent: { id: "P", occurrences: ["a", "b"] } }
    );
    expect(updates.some(u => /DELETE|REMOVE_OCCURRENCE/.test(u._effect))).toBe(false);
  });

  test("is a no-op when the child is not listed", () => {
    const { updates } = run(
      { parentId: "P", childId: "zzz" },
      { parent: { id: "P", occurrences: ["a"] } }
    );
    expect(updates).toHaveLength(0);
  });

  test("patches the in-pipeline overlay so a later step sees the new list", () => {
    const { occurrencesById } = run(
      { parentId: "P", childId: "a" },
      { parent: { id: "P", occurrences: ["a", "b"] } }
    );
    expect(occurrencesById.P.occurrences).toEqual(["b"]);
  });

  test("resolves $var expressions for both ids", () => {
    const { updates } = run(
      { parentId: "$p", childId: "$c" },
      { parent: { id: "P", occurrences: ["x", "y"] }, vars: { $p: "P", $c: "y" } }
    );
    expect(updates[0].occurrence.occurrences).toEqual(["x"]);
  });

  test("missing ids do nothing", () => {
    expect(run({ parentId: "", childId: "b" }, { parent: { id: "P", occurrences: ["b"] } }).updates).toHaveLength(0);
    expect(run({ parentId: "P", childId: "" }, { parent: { id: "P", occurrences: ["b"] } }).updates).toHaveLength(0);
  });
});
