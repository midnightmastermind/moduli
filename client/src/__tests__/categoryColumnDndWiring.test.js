// Fields + Operations tab columns must be Pragmatic drop targets with sortable rows.
// The old columns listened for native HTML5 drop events, which a Pragmatic drag of a
// chip never delivered — nothing could be reordered or moved between columns.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (f) => fs.readFileSync(path.join(__dirname, "../ui/commandCenter", f), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe.each([["FieldsTab.jsx", "field"], ["OperationsTab.jsx", "operation"]])("%s", (file, kind) => {
  const src = read(file);
  it("renders each column as a drop target and each row as a sortable row", () => {
    expect(src).toMatch(new RegExp(`<DropColumn[^>]*kind="${kind}"`));
    expect(src).toMatch(new RegExp(`<SortableRow[^>]*kind="${kind}"`));
    expect(src).toMatch(/useCategoryDropMonitor\(/);
  });
  it("no longer relies on native HTML5 drop handlers on the columns", () => {
    expect(src).not.toMatch(/onDrop=\{\(e\)/);
  });
  it("orders each column by its stored columnOrder", () => {
    // The Fields tab groups through helpers/fieldCategories (shared with the row "+"
    // field menu), so the ordering lives there.
    const grouped = /groupFieldsByCategory\(/.test(src)
      ? fs.readFileSync(path.join(__dirname, "../helpers/fieldCategories.js"), "utf8")
      : src;
    expect(grouped).toMatch(/orderColumn\(groups\[k\]\)/);
  });
});
