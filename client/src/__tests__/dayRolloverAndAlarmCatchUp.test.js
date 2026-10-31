// User, 2026-10-31: "make sure my overall filter changes to todays date on first load? also the alarm for
// 6am is never going off anymore … i came back to the page this morning … it didnt do anything till i
// reloaded". The tab had been put to sleep (prod log: no socket traffic for 11h); the 6:30 alarm last
// rang Oct 21.
import { describe, it, expect, vi } from "vitest";
import { shouldReloadForNewDay, localDayKey, isEditingElement, installDayRolloverReload } from "../helpers/dayRollover";
import { isDueAt, lastAtTimeAtOrBefore } from "../state/useScheduler";

describe("a tab left open reloads onto the new day", () => {
  it("reloads when the loaded day is not today", () => {
    expect(shouldReloadForNewDay({ loadedDay: "2026-10-30", today: "2026-10-31", editing: false, lastReloadDay: null })).toBe(true);
  });
  it("does nothing on the same day (control)", () => {
    expect(shouldReloadForNewDay({ loadedDay: "2026-10-31", today: "2026-10-31", editing: false, lastReloadDay: null })).toBe(false);
  });
  it("waits while the user is typing", () => {
    expect(shouldReloadForNewDay({ loadedDay: "2026-10-30", today: "2026-10-31", editing: true, lastReloadDay: null })).toBe(false);
  });
  it("reloads at most once for a given day", () => {
    expect(shouldReloadForNewDay({ loadedDay: "2026-10-30", today: "2026-10-31", editing: false, lastReloadDay: "2026-10-31" })).toBe(false);
  });
  it("the day key is LOCAL, not UTC", () => {
    expect(localDayKey(new Date(2026, 9, 31, 23, 30))).toBe("2026-10-31");
  });
  it("an editor counts as typing", () => {
    expect(isEditingElement({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditingElement({ tagName: "INPUT" })).toBe(true);
    expect(isEditingElement({ tagName: "BUTTON" })).toBe(false);
  });
  it("a tab coming back into view on a later day reloads", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 30, 20, 0));
    const listeners = {};
    const doc = { visibilityState: "hidden", activeElement: null, addEventListener: (e, f) => (listeners[e] = f), removeEventListener() {} };
    const reload = vi.fn();
    const store = {};
    const win = {
      location: { reload }, addEventListener() {}, removeEventListener() {},
      setInterval: () => 1, clearInterval() {},
      sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v) },
    };
    installDayRolloverReload(win, doc);
    vi.setSystemTime(new Date(2026, 9, 31, 8, 14));
    doc.visibilityState = "visible";
    listeners.visibilitychange();
    expect(reload).toHaveBeenCalledTimes(1);
    listeners.visibilitychange();
    expect(reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("an alarm that missed its minute still rings", () => {
  const at630 = { kind: "atTimes", times: ["06:30"] };
  it("a tick that skipped 06:30 rings at 06:31", () => {
    expect(isDueAt(at630, new Date(2026, 9, 31, 6, 31, 5), new Date(2026, 9, 30, 6, 30).toISOString())).toBe(true);
  });
  it("a tab waking at 06:40 rings it", () => {
    expect(isDueAt(at630, new Date(2026, 9, 31, 6, 40), new Date(2026, 9, 30, 6, 30).toISOString())).toBe(true);
  });
  it("rings once: stamped at 06:31, not again at 06:33", () => {
    expect(isDueAt(at630, new Date(2026, 9, 31, 6, 33), new Date(2026, 9, 31, 6, 31).toISOString())).toBe(false);
  });
  it("hours late does not ring", () => {
    expect(isDueAt(at630, new Date(2026, 9, 31, 8, 14), new Date(2026, 9, 30, 6, 30).toISOString())).toBe(false);
  });
  it("an alarm set at 06:35 for 06:30 does not ring at once", () => {
    expect(isDueAt(at630, new Date(2026, 9, 31, 6, 36), null, new Date(2026, 9, 31, 6, 35).getTime())).toBe(false);
  });
  it("a 23:55 alarm missed across midnight is found on yesterday", () => {
    const t = lastAtTimeAtOrBefore(["23:55"], new Date(2026, 9, 31, 0, 2));
    expect(t.getDate()).toBe(30);
    expect(isDueAt({ kind: "atTimes", times: ["23:55"] }, new Date(2026, 9, 31, 0, 2), null)).toBe(true);
  });
});
