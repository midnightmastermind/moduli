/**
 * mintDiag.test.js
 *
 * The contract that matters is OFF: this runs on the click-an-empty-line path,
 * so an enabled-by-accident diagnostic is a timer and a console.table on every
 * mint. And ON, it has to actually print — it recorded into `window.__mintMarks`
 * and never printed for the whole time it existed, which is why using it meant
 * knowing an incantation.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mintMark, mintStep, startMintTimer, flushMintMarks } from "../helpers/mintDiag";

describe("mintDiag", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.__mintDiag = false;
    window.__mintMarks = undefined;
    window.__mintT0 = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
    window.__mintDiag = false;
  });

  test("OFF: records nothing, schedules nothing, prints nothing", () => {
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    mintMark("mint:go");
    startMintTimer("gesture");
    expect(window.__mintMarks).toBeUndefined();
    // The load-bearing half: no timer was queued, so nothing can fire later.
    expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers();
    expect(table).not.toHaveBeenCalled();
    table.mockRestore();
  });

  test("OFF: mintStep still returns the callback's value", () => {
    expect(mintStep("x", () => 42)).toBe(42);
  });

  test("ON: prints one table once the gesture settles, then resets", () => {
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    window.__mintDiag = true;
    mintMark("mint:go");
    mintMark("editor:focus", { occId: "abcd1234" });
    expect(table).not.toHaveBeenCalled();   // still mid-gesture
    vi.runAllTimers();
    expect(table).toHaveBeenCalledTimes(1);
    const rows = table.mock.calls[0][0];
    expect(rows.map((r) => r.label)).toEqual(["mint:go", "editor:focus"]);
    expect(rows[1].occId).toBe("abcd1234");
    // A fresh clock for the next gesture — not one ever-growing table.
    expect(window.__mintMarks).toEqual([]);
    table.mockRestore();
  });

  test("ON: a later mark restarts the window rather than printing twice", () => {
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    window.__mintDiag = true;
    mintMark("mint:go");
    vi.advanceTimersByTime(900);
    mintMark("editor:blur");            // inside the window — must NOT split
    vi.advanceTimersByTime(900);
    expect(table).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(table).toHaveBeenCalledTimes(1);
    expect(table.mock.calls[0][0]).toHaveLength(2);
    table.mockRestore();
  });

  test("ON: an empty flush prints nothing", () => {
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    window.__mintDiag = true;
    flushMintMarks();
    expect(table).not.toHaveBeenCalled();
    table.mockRestore();
  });
});
