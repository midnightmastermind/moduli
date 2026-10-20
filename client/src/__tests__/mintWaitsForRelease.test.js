import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { noteButtonDown, noteButtonUp, buttonHeld, whenButtonReleased, __resetUserInputWindow } from "../helpers/userInputWindow";

// A click on an empty line minted on mousedown; the page editor then finished its own click on release
// and took the caret back, so the new (empty) block vanished — user video, 2026-10-20.
describe("the mint waits for the button to come up", () => {
  beforeEach(() => { __resetUserInputWindow(); vi.useRealTimers(); });

  it("runs at once when no button is held", () => {
    const fn = vi.fn();
    whenButtonReleased(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("waits while held, then runs after the release's own handlers", async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    noteButtonDown();
    expect(buttonHeld()).toBe(true);
    whenButtonReleased(fn);
    expect(fn).not.toHaveBeenCalled();
    noteButtonUp();
    expect(buttonHeld()).toBe(false);
    expect(fn).not.toHaveBeenCalled();     // not inside pointerup — mouseup/click come after it
    vi.runAllTimers();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("the editor's mint check defers while the button is held", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "ui", "Editor.jsx"), "utf8");
    expect(src).toMatch(/if \(buttonHeld\(\)\) \{ mintMark\("mint:wait-release"\); whenButtonReleased\(check\); return; \}/);
    expect(src).toMatch(/addEventListener\("pointerup", noteButtonUp, true\)/);
  });
});
