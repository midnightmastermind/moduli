// __tests__/pomodoroSlotOption.test.js
import { describe, it, expect } from "vitest";
import { pickTimeOptionForNow } from "../ui/PomodoroTimer.jsx";

const OPTIONS = ["12:00am", "6:00am", "9:00am", "12:00pm", "5:00pm", "11:00pm"];

describe("pickTimeOptionForNow", () => {
  it("picks the latest option at or before now", () => {
    expect(pickTimeOptionForNow(OPTIONS, new Date(2026, 6, 25, 9, 30))).toBe("9:00am");
    expect(pickTimeOptionForNow(OPTIONS, new Date(2026, 6, 25, 17, 5))).toBe("5:00pm");
  });

  it("handles 24-hour option spellings too", () => {
    expect(pickTimeOptionForNow(["09:00", "13:00"], new Date(2026, 6, 25, 14, 0))).toBe("13:00");
  });

  it("returns null when there are no usable options", () => {
    expect(pickTimeOptionForNow([], new Date())).toBeNull();
    expect(pickTimeOptionForNow(["not a time"], new Date())).toBeNull();
  });

  it("returns null when every option is later than now", () => {
    expect(pickTimeOptionForNow(["5:00pm"], new Date(2026, 6, 25, 6, 0))).toBeNull();
  });

  it("treats 12am as midnight and 12pm as noon", () => {
    expect(pickTimeOptionForNow(["12:00am", "11:00pm"], new Date(2026, 6, 25, 0, 30))).toBe("12:00am");
    expect(pickTimeOptionForNow(["11:00am", "12:00pm"], new Date(2026, 6, 25, 12, 30))).toBe("12:00pm");
  });
});

// ── buildContainerCrumbOptions ───────────────────────────────────────────────
//
// The destination picker's option list. Extracted from a `useMemo` that was
// keyed on `occurrencesById` inside a panel that is NEVER UNMOUNTED (it hides
// with `opacity: 0`), so it walked all 21,262 occurrences twice on every store
// write to fill a `<select>` nobody had open — 156ms of the load's 3,181ms
// effect window on a source-mapped profile. The memo is gated on `expanded`
// now; this covers the walk itself, which had no tests at all.
import { buildContainerCrumbOptions } from "../ui/PomodoroTimer.jsx";

const world = (occList, modList) => [
  Object.fromEntries(occList.map((o) => [o.id, o])),
  Object.fromEntries(modList.map((m) => [m.id, m])),
];

describe("buildContainerCrumbOptions", () => {
  it("labels a container with its Page › Container chain", () => {
    const [occs, mods] = world(
      [{ id: "p", moduleId: "mp", occurrences: ["c"] }, { id: "c", moduleId: "mc" }],
      [{ id: "mp", role: "page", label: "Schedule" }, { id: "mc", role: "container", label: "Todo" }],
    );
    expect(buildContainerCrumbOptions(occs, mods)).toEqual([{ id: "c", label: "Schedule › Todo" }]);
  });

  it("lists containers only — pages and instances are not destinations", () => {
    const [occs, mods] = world(
      [{ id: "a", moduleId: "mc" }, { id: "b", moduleId: "mi" }, { id: "d", moduleId: "mp" }],
      [{ id: "mc", role: "container", label: "C" }, { id: "mi", role: "instance", label: "I" }, { id: "mp", role: "page", label: "P" }],
    );
    expect(buildContainerCrumbOptions(occs, mods).map((o) => o.id)).toEqual(["a"]);
  });

  // Placement on this grid IS the parent's child list, so a row can be listed
  // by one occurrence while `parentId` names another. The child list wins.
  it("prefers the lister over the child's own parentId", () => {
    const [occs, mods] = world(
      [
        { id: "lister", moduleId: "mp", occurrences: ["c"] },
        { id: "claimed", moduleId: "mp2" },
        { id: "c", moduleId: "mc", parentId: "claimed" },
      ],
      [
        { id: "mp", role: "page", label: "Real" },
        { id: "mp2", role: "page", label: "Claimed" },
        { id: "mc", role: "container", label: "C" },
      ],
    );
    expect(buildContainerCrumbOptions(occs, mods)[0].label).toBe("Real › C");
  });

  // THE ONE THAT MATTERS — and my first version of it was VACUOUS. It asserted
  // only that the walk TERMINATED, which the depth cap already guarantees, so
  // it passed with `seen` removed. What the cycle guard actually buys is a
  // correct LABEL: without it a 2-cycle unshifts the same two crumbs until the
  // cap, and the option reads "Y › X › Y › X › …". Assert the label.
  it("does not repeat crumbs when the parent chain cycles", () => {
    const [occs, mods] = world(
      [
        { id: "x", moduleId: "mx", occurrences: ["y"] },
        { id: "y", moduleId: "my", occurrences: ["x", "c"] },
        { id: "c", moduleId: "mc" },
      ],
      [
        { id: "mx", role: "container", label: "X" },
        { id: "my", role: "container", label: "Y" },
        { id: "mc", role: "container", label: "C" },
      ],
    );
    const out = buildContainerCrumbOptions(occs, mods);
    expect(out.map((o) => o.id).sort()).toEqual(["c", "x", "y"]);
    // `c` is listed by `y`, which is listed by `x`, which is listed by `y`.
    const c = out.find((o) => o.id === "c");
    expect(c.label).toBe("X › Y › C");
  });

  it("sorts by label and falls back when a module carries none", () => {
    const [occs, mods] = world(
      [{ id: "zzzzzzzz", moduleId: "m1" }, { id: "aaaaaaaa", moduleId: "m2" }],
      [{ id: "m1", role: "container" }, { id: "m2", role: "container", label: "Alpha" }],
    );
    const out = buildContainerCrumbOptions(occs, mods);
    expect(out.map((o) => o.label)).toEqual(["Alpha", "zzzzzz"]);
  });

  it("survives an empty world", () => {
    expect(buildContainerCrumbOptions(null, null)).toEqual([]);
  });
});
