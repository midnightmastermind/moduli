// @vitest-environment jsdom
// A later step's picker offers $form › values › <key> and $form › fields › <field name>.
import { describe, it, expect } from "vitest";
import { collectLocalVarShapes, collectLocalVars } from "../blocks/OperationsBuilder.jsx";
import { itemsForLevel } from "../ui/DrilldownPicker.jsx";
import { CATEGORIES } from "../ui/categoryRegistry";

const steps = [{ id: "s", type: "if", condition: { rules: [] }, then: [{ id: "f", type: "action", config: {
  type: "ASK_FORM", items: [{ key: "name", label: "Name" }, { key: "year", label: "Year", fieldId: "fYear" }],
} }], else: [] }];

describe("$form in the path picker", () => {
  it("is declared, with its values and fields", () => {
    expect(collectLocalVars(steps)).toContain("$form");
    expect(collectLocalVarShapes(steps)).toEqual({ $form: { values: { name: {}, year: {} }, fields: { fYear: {} } } });
  });

  it("drills to the keys and to field names", () => {
    const ctx = { localVars: ["$form"], localVarShapes: collectLocalVarShapes(steps), fieldsById: { fYear: { id: "fYear", name: "Year" } } };
    const top = itemsForLevel(["localVars", "$form"], ctx, CATEGORIES);
    expect(top.items.map((i) => i.value)).toEqual(["values", "fields"]);
    expect(itemsForLevel(["localVars", "$form", "values"], ctx, CATEGORIES).items.map((i) => i.value)).toEqual(["name", "year"]);
    const fields = itemsForLevel(["localVars", "$form", "fields"], ctx, CATEGORIES).items;
    expect(fields.map((i) => [i.value, i.title])).toEqual([["fYear", "Year"]]);
  });
});
