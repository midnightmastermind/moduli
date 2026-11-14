// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { yieldToBrowser } from "../helpers/sliceWork.js";
const setHidden = (v) => Object.defineProperty(document, "hidden", { configurable: true, get: () => v });

describe("yieldToBrowser in a hidden tab", () => {
  afterEach(() => { setHidden(false); vi.restoreAllMocks(); });
  it("does not wait on a timer, which a hidden tab throttles", async () => {
    setHidden(true);
    const st = vi.spyOn(globalThis, "setTimeout");
    await yieldToBrowser();
    expect(st).not.toHaveBeenCalled();
  });
  it("still yields with a timer when the tab is visible", async () => {
    setHidden(false);
    const st = vi.spyOn(globalThis, "setTimeout");
    await yieldToBrowser();
    expect(st).toHaveBeenCalled();
  });
});
