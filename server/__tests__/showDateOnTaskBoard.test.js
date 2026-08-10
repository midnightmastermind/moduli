// 0065 unhides a binding on live modules, so the tests are about the SELECTOR:
// which modules it picks and — carrying more weight — which it refuses.
import { describe, it, expect } from "vitest";
import { collectSubtree, modulesToReveal, resolveFieldByName }
  from "../migrations/0065-show-date-on-task-board.mjs";

const DATE = "f-date";
const occMap = (rows) => new Map(rows.map((o) => [o.id, o]));
const modMap = (rows) => new Map(rows.map((m) => [m.id, m]));

describe("0065 collectSubtree", () => {
  it("walks occurrences[] to any depth, not just direct children", () => {
    // The tasks sit two levels down: page → dimension container → task.
    const occs = occMap([
      { id: "page", occurrences: ["dim"] },
      { id: "dim", occurrences: ["task"] },
      { id: "task" },
    ]);
    expect(collectSubtree("page", occs).map((o) => o.id)).toEqual(["dim", "task"]);
  });

  it("excludes the root itself — the page is not one of its own children", () => {
    const occs = occMap([{ id: "page", occurrences: ["a"] }, { id: "a" }]);
    expect(collectSubtree("page", occs).map((o) => o.id)).toEqual(["a"]);
  });

  it("survives a cycle instead of hanging", () => {
    const occs = occMap([
      { id: "page", occurrences: ["a"] },
      { id: "a", occurrences: ["b"] },
      { id: "b", occurrences: ["a"] },
    ]);
    const ids = collectSubtree("page", occs).map((o) => o.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("ignores a child id naming nothing", () => {
    const occs = occMap([{ id: "page", occurrences: ["ghost", "a"] }, { id: "a" }]);
    expect(collectSubtree("page", occs).map((o) => o.id)).toEqual(["a"]);
  });
});

describe("0065 modulesToReveal", () => {
  const subtree = [{ id: "o1", moduleId: "m1" }];

  it("picks an instance module whose Date binding is HIDDEN", () => {
    const mods = modMap([{ id: "m1", role: "instance", label: "Task",
      fieldBindings: [{ fieldId: "f-done" }, { fieldId: DATE, hidden: true }] }]);
    expect([...modulesToReveal({ subtree, modulesById: mods, dateFieldId: DATE }).keys()]).toEqual(["m1"]);
  });

  it("REFUSES a module that does not bind Date — revealing ≠ adding", () => {
    // Adding a binding is a larger change than unhiding one, and would put a
    // date control on something that never had one.
    const mods = modMap([{ id: "m1", role: "instance", fieldBindings: [{ fieldId: "f-done" }] }]);
    expect(modulesToReveal({ subtree, modulesById: mods, dateFieldId: DATE }).size).toBe(0);
  });

  it("REFUSES a binding already visible, which is what makes a re-run a no-op", () => {
    const mods = modMap([{ id: "m1", role: "instance",
      fieldBindings: [{ fieldId: DATE, hidden: false }] }]);
    expect(modulesToReveal({ subtree, modulesById: mods, dateFieldId: DATE }).size).toBe(0);
  });

  it("REFUSES a non-instance module, so a CONTAINER never sprouts a date row", () => {
    // The Tasks board's dimension containers are in the subtree too.
    const mods = modMap([{ id: "m1", role: "container",
      fieldBindings: [{ fieldId: DATE, hidden: true }] }]);
    expect(modulesToReveal({ subtree, modulesById: mods, dateFieldId: DATE }).size).toBe(0);
  });

  it("dedupes a module placed on the board twice", () => {
    // "Therapy with Keith" really does appear more than once.
    const mods = modMap([{ id: "m1", role: "instance",
      fieldBindings: [{ fieldId: DATE, hidden: true }] }]);
    const twice = [{ id: "o1", moduleId: "m1" }, { id: "o2", moduleId: "m1" }];
    expect(modulesToReveal({ subtree: twice, modulesById: mods, dateFieldId: DATE }).size).toBe(1);
  });

  it("tolerates a module with no fieldBindings at all", () => {
    const mods = modMap([{ id: "m1", role: "instance" }]);
    expect(modulesToReveal({ subtree, modulesById: mods, dateFieldId: DATE }).size).toBe(0);
  });
});

describe("0065 resolveFieldByName", () => {
  const fields = [
    { id: "a", name: "Due", type: "number" },
    { id: "b", name: "Due", type: "date" },
    { id: "c", name: "Date", type: "date" },
  ];
  it("discriminates same-named fields by TYPE (poms grid has two called Due)", () => {
    expect(resolveFieldByName(fields, "Due", "date").id).toBe("b");
  });
  it("returns null when ambiguous, so the caller fails closed", () => {
    expect(resolveFieldByName(fields, "Due")).toBeNull();
  });
  it("finds the Date field", () => {
    expect(resolveFieldByName(fields, "Date", "date").id).toBe("c");
  });
});
