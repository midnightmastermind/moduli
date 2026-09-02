/**
 * "Operations running" — the signal the person holding the tablet never had.
 *
 * User, 2026-09-02: *"is there any way we can have a notification where the
 * reconnected message is, to say that ops are still running. that way i dont
 * try to drag during it"*.
 *
 * The risk in a pill like this is not that it fails to appear — it is that it
 * appears constantly, becomes wallpaper, and is then ignored on the one load
 * that mattered. So the tests that carry the weight are the NEGATIVE ones: a
 * single cheap sweep must not light it, and it must go quiet on its own.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  noteOpSweep, subscribeOpActivity, getOpActivity, _resetOpActivity, _OP_ACTIVITY,
} from "../helpers/opActivity.js";

afterEach(() => { _resetOpActivity(); vi.useRealTimers(); });

describe("op activity signal", () => {
  it("stays quiet for a single cheap sweep — a checkbox must not flash it", () => {
    vi.useFakeTimers();
    noteOpSweep(30);
    expect(getOpActivity().busy).toBe(false);
  });

  it("lights up for a burst that costs real time", () => {
    vi.useFakeTimers();
    noteOpSweep(_OP_ACTIVITY.SHOW_MS + 50);
    expect(getOpActivity().busy).toBe(true);
  });

  it("lights up for a burst that simply will not stop, even if each sweep is cheap", () => {
    // The measured shape during a drag: ~20 sweeps of ~50ms over 22 seconds.
    // No single one is expensive; together they own the main thread.
    vi.useFakeTimers();
    for (let i = 0; i < _OP_ACTIVITY.SHOW_SWEEPS; i++) noteOpSweep(5);
    expect(getOpActivity().busy).toBe(true);
  });

  it("goes quiet on its own once the sweeps stop", () => {
    vi.useFakeTimers();
    noteOpSweep(500);
    expect(getOpActivity().busy).toBe(true);
    vi.advanceTimersByTime(_OP_ACTIVITY.QUIET_MS + 10);
    expect(getOpActivity().busy).toBe(false);
    expect(getOpActivity().sweeps).toBe(0);
  });

  it("stays lit across a gap SHORTER than the quiet window", () => {
    // The load cascade fires roughly one sweep a second. A quiet window under
    // that would blink the pill through the very thing it exists to report.
    vi.useFakeTimers();
    noteOpSweep(500);
    vi.advanceTimersByTime(_OP_ACTIVITY.QUIET_MS - 100);
    noteOpSweep(20);
    vi.advanceTimersByTime(_OP_ACTIVITY.QUIET_MS - 100);
    expect(getOpActivity().busy).toBe(true);
  });

  it("hands useSyncExternalStore a STABLE snapshot when nothing changed", () => {
    // A fresh object per read is an infinite render loop, not a slow pill.
    vi.useFakeTimers();
    noteOpSweep(500);
    const a = getOpActivity();
    expect(getOpActivity()).toBe(a);
  });

  it("notifies subscribers when it changes, and not when it does not", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const off = subscribeOpActivity(fn);
    noteOpSweep(500);
    expect(fn).toHaveBeenCalled();
    const seen = fn.mock.calls.length;
    vi.advanceTimersByTime(_OP_ACTIVITY.QUIET_MS + 10);
    expect(fn.mock.calls.length).toBeGreaterThan(seen);   // the quiet transition
    const after = fn.mock.calls.length;
    vi.advanceTimersByTime(5000);                          // nothing more happens
    expect(fn.mock.calls.length).toBe(after);
    off();
  });

  it("unsubscribes", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    subscribeOpActivity(fn)();
    noteOpSweep(500);
    expect(fn).not.toHaveBeenCalled();
  });
});
