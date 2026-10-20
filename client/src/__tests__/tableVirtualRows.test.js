// A long table's child rows go through the same virtualizer long boards use (user, 2026-10-20: "we will
// just do what boards do"), and a column's hideLabel has a control. ContainerTable needs the whole grid
// to mount, so these pin the wiring; the scroll + load numbers were measured on prod's People Table.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const src = readFileSync(resolve(process.cwd(), "src/modules/containers/ContainerTable.jsx"), "utf8");

describe("table child rows", () => {
  it("are virtualized past VIRTUAL_TABLE_MIN with useVirtualRows", () => {
    expect(src).toMatch(/import \{ useVirtualRows \} from "\.\.\/\.\.\/helpers\/virtualRows"/);
    expect(src).toMatch(/enabled: childRowOccs\.length > VIRTUAL_TABLE_MIN/);
    expect(src).toMatch(/listRef: childListRef/);
  });
  it("render the plan's rows measured, spacers between, and every row when not virtualized", () => {
    expect(src).toMatch(/childVirtual\.plan\.map/);
    expect(src).toMatch(/ref: childVirtual\.measureRef/);
    expect(src).toMatch(/className="virtual-spacer"/);
    expect(src).toMatch(/: childRowOccs\.map\(\(childOcc\) => renderChildRow\(childOcc\)\)/);
  });
  it("the measured element is the row itself (its props land on the row div)", () => {
    expect(src).toMatch(/key=\{`child-row-\$\{childOcc\.id\}`\}\s*\n\s*\{\.\.\.rowProps\}\s*\n\s*className="table-row table-child-row"/);
  });
});

describe("table column menu", () => {
  it("has a control for the column's hideLabel", () => {
    expect(src).toMatch(/const toggleColumnHideLabel = useCallback/);
    expect(src).toMatch(/onClick=\{\(\) => toggleColumnHideLabel\(c\)\}/);
    expect(src).toMatch(/"Show row name" : "Hide row name"/);
  });
  it("can hide the cell's field names, carried to every cell path and down to each field pill", () => {
    expect(src).toMatch(/onClick=\{\(\) => toggleColumnHideFieldNames\(c\)\}/);
    expect(src.match(/hideFieldNames=\{col\.hideFieldNames === true\}/g)?.length).toBe(2);
    expect(src).toMatch(/hideFieldNames: !!hideFieldNames, __inCell: true/);
    const editor = readFileSync(resolve(process.cwd(), "src/ui/Editor.jsx"), "utf8");
    expect(editor).toMatch(/hideFieldNames: !!hideFieldNames, __inCell: true/);
    const inst = readFileSync(resolve(process.cwd(), "src/modules/ModuleInstance.jsx"), "utf8");
    expect(inst).toMatch(/forceHideName=\{cellEmbedCtx\?\.hideFieldNames === true\}/);
    const fr = readFileSync(resolve(process.cwd(), "src/ui/FieldRenderer.jsx"), "utf8");
    expect(fr.match(/hideName=\{hideName \|\| forceHideName\}/g)?.length).toBe(4);
  });
});
