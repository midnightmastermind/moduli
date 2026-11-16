// services/buildEdit — Jonah's change / remove, pure half (2026-11-15).
import { describe, it, expect } from "vitest";
import { pickByName, planChange, subtreeIds, stripEmbeds } from "../services/buildEdit.js";

const c = (id, label, role, parentLabel) => ({ occ: { id, label: null }, module: { label, role }, parentLabel });

describe("pickByName", () => {
  const cands = [c("a", "Mail", "container", "Quick Links"), c("b", "Mail", "container", "Old"), c("t", "Tasks", "page", null), c("r", "Tasks", "instance", "Todo")];
  it("a path picks by parent", () => expect(pickByName("Quick Links › Mail", cands).hit.occ.id).toBe("a"));
  it("a page beats a row of the same name", () => expect(pickByName("Tasks", cands).hit.occ.id).toBe("t"));
  it("two same-named sections are ambiguous, listed, never guessed", () => {
    expect(pickByName("Mail", cands).ambiguous).toEqual(["Quick Links › Mail", "Old › Mail"]);
  });
  it("nothing found says so", () => expect(pickByName("Nope", cands).error).toMatch(/nothing named/));
});

describe("planChange", () => {
  const fieldsAll = [{ id: "fd", name: "Date", type: "date" }, { id: "fq", name: "Qty", type: "number" }];
  it("renames the module when it is placed only here", () => {
    expect(planChange({ occ: { id: "o" }, module: { label: "Old" }, rename: "New" })).toMatchObject({ modPatch: { label: "New" }, occPatch: {} });
  });
  it("renames only this placement when the module is shared", () => {
    expect(planChange({ occ: { id: "o" }, module: { label: "Movie" }, placements: 900, rename: "Inception" }).occPatch.label).toBe("Inception");
  });
  it("sets, coerces and binds field values; null clears", () => {
    const r = planChange({ occ: { id: "o", fields: { fq: { value: 1 } } }, module: { fieldBindings: [{ fieldId: "fq" }] }, fields: { Date: "2026-11-20", Qty: null }, fieldsAll });
    expect(r.occPatch.fields).toEqual({ fd: { value: "2026-11-20", flow: "in" } });
    expect(r.modPatch.fieldBindings.map((b) => b.fieldId)).toEqual(["fq", "fd"]);
  });
  it("an unknown field is a problem", () => {
    expect(planChange({ occ: { id: "o" }, module: {}, fields: { Colour: "red" }, fieldsAll }).problems[0]).toMatch(/Colour/);
  });
});

describe("remove helpers", () => {
  it("collects the subtree, cycle-safe", () => {
    const m = { p: { occurrences: ["a", "b"] }, a: { occurrences: ["c"] }, b: { occurrences: ["p"] }, c: {} };
    expect(subtreeIds("p", m).sort()).toEqual(["a", "b", "c", "p"]);
  });
  it("strips embeds of removed rows, nested too", () => {
    const tm = { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "x" } }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "instanceTextblockInline", attrs: { occurrenceId: "y" } }] }] }] }] };
    const out = stripEmbeds(tm, ["x", "y"]);
    expect(JSON.stringify(out)).not.toMatch(/"x"|"y"/);
    expect(stripEmbeds(tm, ["z"])).toBe(null);
  });
});
