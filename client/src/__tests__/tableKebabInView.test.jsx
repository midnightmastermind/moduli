// @vitest-environment jsdom
// The first column's menu opened past the table's left edge and was clipped (x = -143 on poms' People Table, 2026-10-20),
// and on a short table the last items were cut off at the bottom. It is placed against the window now.
import { describe, it, expect } from "vitest";
import { keepKebabMenuInTable } from "../modules/containers/ContainerTable.jsx";

function setup(btnLeft) {
  const wrap = document.createElement("div"); const btn = document.createElement("button"); btn.className = "table-kebab-btn";
  const menu = document.createElement("div"); wrap.append(btn, menu); document.body.appendChild(wrap);
  btn.getBoundingClientRect = () => ({ left: btnLeft, right: btnLeft + 20, top: 40, bottom: 60, width: 20, height: 20 });
  menu.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0, bottom: 300, width: 200, height: 300 });
  Object.defineProperty(menu, "offsetWidth", { value: 200 }); Object.defineProperty(menu, "scrollHeight", { value: 300 });
  return menu;
}

describe("keepKebabMenuInTable", () => {
  it("is fixed to the window, so the table cannot clip it", () => {
    const m = setup(500);
    keepKebabMenuInTable(m);
    expect(m.style.position).toBe("fixed");
    expect(m.style.overflowY).toBe("auto");
  });
  it("stays inside the left edge for the first column", () => {
    const m = setup(20);
    keepKebabMenuInTable(m);
    expect(m.style.left).toBe("8px");
    expect(m.style.right).toBe("auto");
  });
  it("allows for a transformed ancestor moving its origin", () => {
    const m = setup(500);
    m.getBoundingClientRect = () => ({ left: 100, right: 300, top: 50, bottom: 350, width: 200, height: 300 });
    keepKebabMenuInTable(m);
    expect(m.style.left).toBe("220px"); // wants 320 on screen, its 0 is at 100
    expect(m.style.top).toBe("12px");  // wants 62, its 0 is at 50
  });
  it("does nothing on unmount", () => { expect(() => keepKebabMenuInTable(null)).not.toThrow(); });
});
