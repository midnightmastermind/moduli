// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
vi.mock("html-to-image", () => ({ toCanvas: vi.fn() }));
vi.mock("../vr/officeScene.js", () => ({ createOfficeScene: vi.fn() }));
import { visibleOnlyFilter } from "../vr/VrOffice.jsx";

describe("visibleOnlyFilter (the office's screen picture takes only what shows)", () => {
  it("keeps what is inside its panel, drops rows scrolled out of it", () => {
    document.body.innerHTML = `<div id="root"><div data-panel-id="p"><div id="in"></div><div id="out"></div></div><span id="flat"></span></div>`;
    const R = { root: [0, 0, 1000, 800], p: [0, 0, 500, 400], in: [10, 10, 200, 50], out: [10, 900, 200, 950], flat: [0, 0, 0, 0] };
    const rectOf = (el) => { const [left, top, right, bottom] = R[el.id || el.getAttribute("data-panel-id")]; return { left, top, right, bottom, width: right - left, height: bottom - top }; };
    const keep = visibleOnlyFilter(document.getElementById("root"), rectOf);
    expect(keep(document.getElementById("in"))).toBe(true);
    expect(keep(document.getElementById("out"))).toBe(false);
    expect(keep(document.getElementById("flat"))).toBe(true);
    expect(keep(document.createTextNode("x"))).toBe(true);
  });
});
