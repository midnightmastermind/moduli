import { describe, it, expect } from "vitest";
import { planTarget, agreedValues } from "../migrations/0433-new-item-buttons.mjs";

function maps({ occs, mods, fields }) {
  const occById = new Map(occs.map((o) => [o.id, o]));
  return { occById, modById: new Map(mods.map((m) => [m.id, m])), fieldById: new Map(fields.map((f) => [f.id, f])),
    childrenOf: (o) => (o.occurrences || []).map((id) => occById.get(id)).filter(Boolean) };
}
const fields = [
  { id: "t", name: "Year", type: "number" }, { id: "c", name: "Board Category", type: "select" },
  { id: "p", name: "Poster", type: "media" }, { id: "n", name: "Name", type: "text" },
];

describe("0433 planTarget", () => {
  it("a shared-module board places that module, asks its visible inputs, fixes agreed values", () => {
    const binds = [{ fieldId: "t" }, { fieldId: "c", hidden: true }, { fieldId: "p", role: "media" }];
    const m = maps({ fields,
      mods: [{ id: "box", role: "container", label: "Movies", fieldBindings: [] }, { id: "mv", role: "artifact", kind: "movie", label: "Movie", fieldBindings: binds }],
      occs: [{ id: "C", moduleId: "box", occurrences: ["a", "b"] },
        { id: "a", moduleId: "mv", fields: { c: { value: ["movie"] }, t: { value: 1999 } } },
        { id: "b", moduleId: "mv", fields: { c: { value: ["movie"] }, t: { value: 2001 } } }] });
    const p = planTarget({ container: "C", expect: "Movies", label: "New movie" }, m);
    expect(p.items.map((i) => i.label)).toEqual(["Name", "Year"]);
    expect(p.create).toMatchObject({ module: "mv", occurrenceLabel: "$form.values.name", parent: "$trigger.occurrenceId" });
    expect(p.create.fields).toEqual({ c: ["movie"], t: "$form.fields.t" });
    expect(p.steps.map((s) => s.config.type)).toEqual(["ASK_FORM", "CREATE", "SCROLL_TO"]);
  });

  it("own-module rows: a new module, the Name field filled from the form, hidden flags kept", () => {
    const m = maps({ fields,
      mods: [{ id: "box", role: "container", label: "People", fieldBindings: [] },
        { id: "m1", role: "instance", fieldBindings: [{ fieldId: "n" }, { fieldId: "c", hidden: true }] },
        { id: "m2", role: "instance", fieldBindings: [{ fieldId: "n" }, { fieldId: "c", hidden: true }] }],
      occs: [{ id: "C", moduleId: "box", occurrences: ["a", "b"] },
        { id: "a", moduleId: "m1", fields: { c: { value: ["person"] } } }, { id: "b", moduleId: "m2", fields: { c: { value: ["person"] } } }] });
    const p = planTarget({ container: "C", expect: "People", label: "New person" }, m);
    expect(p.items.map((i) => i.label)).toEqual(["Name"]);
    expect(p.create).toMatchObject({ role: "instance", newModule: true, name: "$form.values.name", fieldHidden: { c: true } });
    expect(p.create.fields).toEqual({ n: "$form.values.name", c: ["person"] });
  });

  it("a Where target asks which sub-container and creates there", () => {
    const m = maps({ fields,
      mods: [{ id: "area", role: "container", label: "Physical" }, { id: "sub", role: "container", label: "Exercise" }, { id: "r", role: "instance", fieldBindings: [] }],
      occs: [{ id: "A", moduleId: "area", occurrences: ["S"] }, { id: "S", moduleId: "sub", label: "Exercise", occurrences: ["x"] }, { id: "x", moduleId: "r" }] });
    const p = planTarget({ container: "A", label: "New routine", where: "children" }, m);
    expect(p.items[1]).toMatchObject({ key: "where", type: "select", required: true, options: [{ value: "S", label: "Exercise" }] });
    expect(p.create.parent).toBe("$form.values.where");
  });

  it("refuses a container that is not the expected board", () => {
    const m = maps({ fields, mods: [{ id: "box", role: "container", label: "Other" }], occs: [{ id: "C", moduleId: "box" }] });
    expect(planTarget({ container: "C", expect: "Movies", label: "New movie" }, m).skip).toMatch(/expected "Movies"/);
  });

  it("agreedValues needs two rows that agree", () => {
    expect(agreedValues([{ fields: { a: { value: 1 } } }], ["a"])).toEqual({});
    expect(agreedValues([{ fields: { a: { value: 1 } } }, { fields: { a: { value: 1 } } }], ["a"])).toEqual({ a: 1 });
  });
});
