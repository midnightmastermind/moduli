// The Fields and Operations columns used to cap their list at 180px (~7 rows), so a tall
// screen showed a scrollbar in every column and most of the screen empty.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("Command Center column lists use the screen", () => {
  for (const file of ["ui/commandCenter/FieldsTab.jsx", "ui/commandCenter/OperationsTab.jsx"]) {
    it(`${file} does not cap its column at 180px`, () => {
      const src = read(file);
      expect(src).toContain('maxHeight: "min(560px, 55vh)"');
      expect(src).not.toMatch(/maxHeight:\s*180\b/);
    });
  }
});
