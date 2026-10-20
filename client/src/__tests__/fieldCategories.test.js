import { describe, it, expect } from "vitest";
import {
  fieldCategoryFolders, groupFieldsByCategory, uniqueFieldName, appendFieldBinding,
} from "../helpers/fieldCategories";

describe("fieldCategoryFolders", () => {
  const foldersById = {
    a: { id: "a", gridId: "g", folderType: "category", categoryKind: "field", sortOrder: 2 },
    b: { id: "b", gridId: "g", folderType: "category", categoryKind: "op", sortOrder: 1 },
    c: { id: "c", gridId: "g", folderType: "category", categoryKind: null, sortOrder: 0 },
    d: { id: "d", gridId: "g", folderType: "category", categoryKind: null, sortOrder: 3 },
    e: { id: "e", gridId: "other", folderType: "category", categoryKind: "field" },
    f: { id: "f", gridId: "g", folderType: "page" },
  };
  it("keeps field categories of this grid, in sort order; a legacy op-only folder is not one", () => {
    const out = fieldCategoryFolders({
      foldersById, gridId: "g",
      fieldsById: {}, operationsById: { o: { id: "o", folderId: "d" } },
    });
    expect(out.map((f) => f.id)).toEqual(["c", "a"]);
  });
});

describe("groupFieldsByCategory", () => {
  it("puts a field in its folder's column, else uncategorized", () => {
    const groups = groupFieldsByCategory(
      [{ id: "1", folderId: "a" }, { id: "2", folderId: "gone" }, { id: "3" }],
      [{ id: "a" }]
    );
    expect(groups.a.map((f) => f.id)).toEqual(["1"]);
    expect(groups.uncategorized.map((f) => f.id).sort()).toEqual(["2", "3"]);
  });
});

describe("uniqueFieldName", () => {
  it("numbers past names already taken, case-insensitively", () => {
    expect(uniqueFieldName({})).toBe("New Field");
    expect(uniqueFieldName({ x: { name: "new field" }, y: { name: "New Field 2" } })).toBe("New Field 3");
  });
});

describe("appendFieldBinding", () => {
  it("appends a visible input binding after the highest order", () => {
    const out = appendFieldBinding([{ fieldId: "a", order: 4 }, { fieldId: "b", order: 1 }], "c");
    expect(out[2]).toEqual({ fieldId: "c", role: "input", order: 5, hidden: false });
  });
  it("shows a binding that exists but is hidden, keeping everything else", () => {
    const out = appendFieldBinding([{ fieldId: "a", order: 0, hidden: true, role: "display" }], "a");
    expect(out).toEqual([{ fieldId: "a", order: 0, hidden: false, role: "display" }]);
  });
  it("returns null for a field already showing (nothing to write)", () => {
    expect(appendFieldBinding([{ fieldId: "a" }], "a")).toBeNull();
    expect(appendFieldBinding([], null)).toBeNull();
  });
  it("starts at order 0 on a module with no bindings", () => {
    expect(appendFieldBinding(undefined, "a")).toEqual([{ fieldId: "a", role: "input", order: 0, hidden: false }]);
  });
});
