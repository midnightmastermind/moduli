import { describe, it, expect } from "vitest";
import { itemKey, missingRequired, answersToResult } from "../helpers/formItems.js";

describe("formItems", () => {
  it("itemKey slugs a label and keeps it unique", () => {
    expect(itemKey("Release Year", [])).toBe("release_year");
    expect(itemKey("Name", ["name"])).toBe("name_2");
    expect(itemKey("Name", ["name", "name_2"])).toBe("name_3");
    expect(itemKey("", [])).toBe("item");
    expect(itemKey("  ??  ", ["item"])).toBe("item_2");
  });

  it("missingRequired names the required items with no answer", () => {
    const items = [{ key: "name", required: true }, { key: "year" }, { key: "seen", type: "boolean", required: true }];
    expect(missingRequired(items, {})).toEqual(["name"]);
    expect(missingRequired(items, { name: "  " })).toEqual(["name"]);
    expect(missingRequired(items, { name: "Dune" })).toEqual([]);
    expect(missingRequired([{ key: "tags", required: true }], { tags: [] })).toEqual(["tags"]);
  });

  it("answersToResult keys every answer by item key, and field items by field id too", () => {
    const items = [{ key: "name" }, { key: "year", fieldId: "fYear" }, { key: "blank", fieldId: "fB" }];
    expect(answersToResult(items, { name: "Dune", year: 2021 })).toEqual({
      values: { name: "Dune", year: 2021, blank: null },
      fields: { fYear: 2021, fB: null },
    });
  });
});
