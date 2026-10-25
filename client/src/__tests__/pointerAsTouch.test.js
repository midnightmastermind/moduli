// @vitest-environment jsdom
// In the headset a controller press reaches the page as a MOUSE pointer; the drag handle feeds it to the touch-drag
// handlers so press-and-move drags instead of the release opening the radial menu.
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { bindPointerAsTouch, pointerAsTouch } from "../helpers/dragSystem.js";

function ev(type, props) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0, ...props });
  return e;
}

describe("a controller (mouse) press on a drag handle", () => {
  it("press, move and release reach the touch handlers as one-point touches", () => {
    const el = document.createElement("div");
    const onStart = vi.fn(); const onMove = vi.fn(); const onEnd = vi.fn();
    const off = bindPointerAsTouch(el, { onStart, onMove, onEnd });
    el.dispatchEvent(ev("pointerdown", { clientX: 10, clientY: 20 }));
    window.dispatchEvent(ev("pointermove", { clientX: 40, clientY: 25 }));
    window.dispatchEvent(ev("pointerup", { clientX: 40, clientY: 25 }));
    expect(onStart.mock.calls[0][0].touches).toEqual([{ clientX: 10, clientY: 20, identifier: 1 }]);
    expect(onMove.mock.calls[0][0].touches[0]).toMatchObject({ clientX: 40 });
    expect(onEnd.mock.calls[0][0].touches).toEqual([]);
    expect(onEnd.mock.calls[0][0].changedTouches[0]).toMatchObject({ clientX: 40, clientY: 25 });
    off();
    el.dispatchEvent(ev("pointerdown", {}));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
  it("a real touch is left to the touch events, and a move with nothing pressed is ignored", () => {
    const el = document.createElement("div");
    const onStart = vi.fn(); const onMove = vi.fn();
    bindPointerAsTouch(el, { onStart, onMove, onEnd: vi.fn() });
    el.dispatchEvent(ev("pointerdown", { pointerType: "touch" }));
    window.dispatchEvent(ev("pointermove", {}));
    expect(onStart).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });
  it("does not capture the pointer (a capture sends the click to the wrapper, not the menu button)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/helpers/dragSystem.js"), "utf8");
    const body = src.slice(src.indexOf("export function bindPointerAsTouch"), src.indexOf("/** Tell the headset"));
    expect(body).not.toMatch(/\.setPointerCapture\(/);
  });
  it("is only wired inside the headset", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/helpers/dragSystem.js"), "utf8");
    expect(src).toMatch(/inHeadset\(\) \? bindPointerAsTouch\(triggerEl, \{ onStart, onMove, onEnd \}\)/);
    expect(pointerAsTouch(ev("pointerup", {})).touches).toEqual([]);
  });
});

import { readerState } from "../ReaderApp.jsx";

describe("a reader window's store", () => {
  it("carries the per-role lists the drop handlers read (a drop found no container without them)", () => {
    const st = readerState({ gridId: "g", occurrences: [], modules: [{ id: "c", role: "container", kind: "board" }, { id: "i", role: "instance" }] });
    expect(st.containers.map((m) => m.id)).toEqual(["c"]);
    expect(st.instances.map((m) => m.id)).toEqual(["i"]);
  });
});
