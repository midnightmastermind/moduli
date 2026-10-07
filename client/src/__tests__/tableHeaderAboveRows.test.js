// The table's sticky header row must stack ABOVE the rows' cards.
// 2026-10-07: on a table whose rows are occurrences (a feed), the column menu
// (inside the header row) drew BEHIND the row cards — `.instance-wrap` carries
// z-index 3 globally and the header row was ALSO 3, so every later row painted
// over it and a click on "Delete column" / "Field visibility…" hit a row.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");

describe("table header stacking", () => {
  const css = read("../index.css");
  const wrapZ = Number(css.match(/\.instance-wrap \{[^}]*?z-index:\s*(\d+)/)?.[1]);
  const src = read("../modules/containers/ContainerTable.jsx");
  const hdr = src.slice(src.indexOf('className="table-header-row"'), src.indexOf('className="table-header-row"') + 400);
  const m = hdr.match(/zIndex:\s*([A-Z_]+|\d+)/);
  const headerZ = /^\d+$/.test(m?.[1]) ? Number(m[1]) : Number(src.match(new RegExp(`const ${m?.[1]}\\s*=\\s*(\\d+)`))?.[1]);

  it("reads both values (control: the detector is not matching nothing)", () => {
    expect(Number.isFinite(wrapZ)).toBe(true);
    expect(Number.isFinite(headerZ)).toBe(true);
  });
  it("the header row's z-index is above a row card's", () => {
    expect(headerZ).toBeGreaterThan(wrapZ);
  });
});

// 2026-10-07: the LAST typed row can be removed. A table whose rows come from a
// feed needs none (poms' Schedule Table is stored at rowCount 0), "Add row" is
// always there, and the table renders at 0 — the old `rowCount <= 1` guard made
// that shape unreachable from the UI.
describe("the last typed row is removable", () => {
  const src = read("../modules/containers/ContainerTable.jsx");
  it("handleRemoveRowAt only refuses when there is nothing to remove", () => {
    const i = src.indexOf("const handleRemoveRowAt = useCallback");
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 600)).toMatch(/if \(rowCount <= 0\) return;/);
  });
  it("the remove button is disabled only at zero", () => {
    expect(src).toMatch(/disabled=\{rowCount <= 0\}/);
    expect(src).not.toMatch(/disabled=\{rowCount <= 1\}/);
  });
});
