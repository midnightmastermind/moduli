// The first column's menu opened past the table's left edge and was clipped (x = -143 on poms' People
// Table, 2026-10-20). keepKebabMenuInTable flips it to open rightwards when there is no room on the left.
import { describe, it, expect } from "vitest";
import { keepKebabMenuInTable } from "../modules/containers/ContainerTable.jsx";

function setup(menuLeft) {
  const table = document.createElement("div"); table.className = "table-container";
  const menu = document.createElement("div"); table.appendChild(menu); document.body.appendChild(table);
  table.getBoundingClientRect = () => ({ left: 20, right: 900, top: 0, bottom: 600, width: 880, height: 600 });
  menu.getBoundingClientRect = () => ({ left: menuLeft, right: menuLeft + 200, top: 40, bottom: 300, width: 200, height: 260 });
  return menu;
}

describe("keepKebabMenuInTable", () => {
  it("opens to the right when the menu would start left of the table", () => {
    const m = setup(-143);
    keepKebabMenuInTable(m);
    expect(m.style.left).toBe("0px");
    expect(m.style.right).toBe("auto");
  });
  it("leaves a menu that fits where it is", () => {
    const m = setup(300);
    keepKebabMenuInTable(m);
    expect(m.style.left).toBe("");
    expect(m.style.right).toBe("");
  });
  it("does nothing on unmount", () => { expect(() => keepKebabMenuInTable(null)).not.toThrow(); });
});
