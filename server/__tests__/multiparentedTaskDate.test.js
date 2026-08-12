import { describe, it, expect } from "vitest";
import { buildParentLists, occurrencesNeedingOwnVisibility }
  from "../migrations/0069-multiparented-tasks-show-their-date.mjs";

const DATE = "f-date";
const mods = (rows) => new Map(rows.map((m) => [m.id, m]));
const TASK = { id: "m1", role: "instance", fieldBindings: [{ fieldId: DATE, hidden: false }] };
const run = (occs, modules = mods([TASK])) => occurrencesNeedingOwnVisibility({
  occurrences: occs, modulesById: modules,
  parentLists: buildParentLists(occs), dateFieldId: DATE,
});

describe("0069 buildParentLists", () => {
  it("records EVERY parent that lists a child, not just one", () => {
    // The whole bug: the app's reverse map keeps one, so the walk is arbitrary.
    const occs = [{ id: "a", occurrences: ["t"] }, { id: "b", occurrences: ["t"] }, { id: "t" }];
    expect(buildParentLists(occs).get("t")).toEqual(["a", "b"]);
  });
});

describe("0069 occurrencesNeedingOwnVisibility", () => {
  const multi = () => [
    { id: "occupational", occurrences: ["t"] },
    { id: "due", occurrences: ["t"] },
    { id: "t", moduleId: "m1" },
  ];

  it("picks a multi-parented task with a visible Date binding", () => {
    expect(run(multi()).map((o) => o.id)).toEqual(["t"]);
  });

  it("REFUSES a singly-parented task — it already resolves correctly", () => {
    const occs = [{ id: "occupational", occurrences: ["t"] }, { id: "t", moduleId: "m1" }];
    expect(run(occs)).toEqual([]);
  });

  it("REFUSES one that already states its own visibility", () => {
    // Overwriting a deliberate rule destroys intent; this is also the re-run guard.
    const occs = multi();
    occs[2].fieldVisibility = { mode: "hide", fieldIds: [] };
    expect(run(occs)).toEqual([]);
  });

  it("REFUSES when the module binds Date HIDDEN — nothing to reveal", () => {
    const hidden = mods([{ id: "m1", role: "instance", fieldBindings: [{ fieldId: DATE, hidden: true }] }]);
    expect(run(multi(), hidden)).toEqual([]);
  });

  it("REFUSES when the module does not bind Date at all", () => {
    const none = mods([{ id: "m1", role: "instance", fieldBindings: [] }]);
    expect(run(multi(), none)).toEqual([]);
  });

  it("REFUSES a non-instance, so a multi-parented CONTAINER is untouched", () => {
    // The Schedule's shared slots are multi-parented containers by design.
    const cont = mods([{ id: "m1", role: "container", fieldBindings: [{ fieldId: DATE }] }]);
    expect(run(multi(), cont)).toEqual([]);
  });

  it("counts DISTINCT parents — the same parent listing a child twice is not multi-parented", () => {
    // Real data: the Due container lists the same occurrence twice.
    const occs = [{ id: "due", occurrences: ["t", "t"] }, { id: "t", moduleId: "m1" }];
    expect(run(occs)).toEqual([]);
  });
});
