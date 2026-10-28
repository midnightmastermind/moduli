import { describe, it, expect } from "vitest";
import { fieldsToOffer, patchPipeline } from "../migrations/0454-new-buttons-ask-row-fields.mjs";

const F = {
  due: { id: "due", name: "Due", type: "date" }, people: { id: "people", name: "People", type: "occurrence" },
  done: { id: "done", name: "Completed", type: "boolean" }, poster: { id: "poster", name: "Poster", type: "text" },
  left: { id: "left", name: "Days Until Due", type: "number", displayEnabled: true }, rare: { id: "rare", name: "Rare", type: "text" },
};
const row = (...ids) => ({ fieldBindings: ids.map((x) => (typeof x === "string" ? { fieldId: x } : x)) });
const rows = Array.from({ length: 10 }, () => row("due", "people", "done", "left", { fieldId: "poster", role: "media" }));
rows.push(row("rare"));

describe("0454 — which fields a New button's form offers", () => {
  it("offers input fields many rows use; never checkboxes, pictures, display fields or one-offs", () => {
    expect(fieldsToOffer(rows, F)).toEqual(["due", "people"]);
  });
  it("never offers a hidden binding or a field the form already asks", () => {
    const hidden = rows.map((r) => ({ fieldBindings: r.fieldBindings.map((b) => (b.fieldId === "due" ? { ...b, hidden: true } : b)) }));
    expect(fieldsToOffer(hidden, F, ["people"])).toEqual([]);
  });
  it("adds Include-box inputs and makes Create take them, once", () => {
    const pipeline = { steps: [
      { config: { type: "ASK_FORM", items: [{ key: "name", label: "Name", required: true }, { key: "size", fieldId: "rare" }] } },
      { config: { type: "CREATE", name: "$form.values.name" } },
    ] };
    const a = patchPipeline(pipeline, ["due", "people"], F);
    const items = a.pipeline.steps[0].config.items;
    expect(items.map((i) => [i.key, !!i.optional])).toEqual([["name", false], ["size", true], ["due", true], ["people", true]]);
    expect(a.pipeline.steps[1].config.fieldsFrom).toBe("$form.fields");
    const b = patchPipeline(a.pipeline, ["due", "people"], F);
    expect(b.added).toEqual([]); expect(b.boxed).toBe(0);
  });
});
