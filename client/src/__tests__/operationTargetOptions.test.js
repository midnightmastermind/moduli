// Options for an operation's op-level `targetOccurrenceId` (the field that
// decides which page's date the op works against).
import { describe, it, expect } from "vitest";
import {
  buildTargetOccurrenceOptions,
  occurrenceLabel,
} from "../helpers/operationTargetOptions.js";

const modulesById = {
  mPage: { id: "mPage", role: "page", kind: "board", label: "Schedule" },
  mPage2: { id: "mPage2", role: "page", kind: "board", label: "Trackers" },
  mPage3: { id: "mPage3", role: "page", kind: "doc", label: "" },
  mGraph: { id: "mGraph", role: "container", kind: "graph", label: "Emotions Wheel" },
  mInst: { id: "mInst", role: "instance", kind: null, label: "Drink Water" },
};
const occurrencesById = {
  oSched: { id: "oSched", moduleId: "mPage" },
  oTrack: { id: "oTrack", moduleId: "mPage2" },
  oUntitled: { id: "oUntitled", moduleId: "mPage3" },
  oWheel: { id: "oWheel", moduleId: "mGraph" },
  oDrink: { id: "oDrink", moduleId: "mInst" },
};

describe("occurrenceLabel", () => {
  it("prefers the occurrence's own label over the module's", () => {
    expect(occurrenceLabel({ moduleId: "mPage", label: "Today's Schedule" }, modulesById))
      .toBe("Today's Schedule");
  });

  it("falls back to the module label when the occurrence has none", () => {
    expect(occurrenceLabel({ moduleId: "mPage" }, modulesById)).toBe("Schedule");
  });

  // A blank string is a legal stored value — falsy-coalescing on a label is the
  // 2026-08-01 (19) trap ("" rendered as *** MISSING ***). Blank must fall
  // THROUGH to the module, not be treated as a real label.
  it("treats a blank/whitespace occurrence label as absent", () => {
    expect(occurrenceLabel({ moduleId: "mPage", label: "" }, modulesById)).toBe("Schedule");
    expect(occurrenceLabel({ moduleId: "mPage", label: "   " }, modulesById)).toBe("Schedule");
  });

  it("is null-safe", () => {
    expect(occurrenceLabel(null, modulesById)).toBe("");
    expect(occurrenceLabel({ moduleId: "nope" }, modulesById)).toBe("");
  });
});

describe("buildTargetOccurrenceOptions", () => {
  it("offers PAGE occurrences only, sorted by label", () => {
    const out = buildTargetOccurrenceOptions({ occurrencesById, modulesById });
    expect(out.map((o) => o.id)).toEqual(["oSched", "oTrack", "oUntitled"]);
    expect(out.map((o) => o.label)).toEqual(["Schedule", "Trackers", "(untitled page)"]);
    // the graph container and the instance are not offered
    expect(out.some((o) => o.id === "oWheel")).toBe(false);
    expect(out.some((o) => o.id === "oDrink")).toBe(false);
  });

  // THE ONE THAT MATTERS ON LIVE DATA. `Mood: Record Selection` targets a
  // container/graph. A select whose value is absent from its options renders
  // BLANK and writes null the next time anything else in the editor changes —
  // so opening that op would silently break it.
  it("PINS a non-page current value first and marks it offList", () => {
    const out = buildTargetOccurrenceOptions({ occurrencesById, modulesById, currentId: "oWheel" });
    expect(out[0]).toMatchObject({
      id: "oWheel", label: "Emotions Wheel", role: "container", kind: "graph",
      isCurrent: true, offList: true,
    });
    expect(out.slice(1).map((o) => o.id)).toEqual(["oSched", "oTrack", "oUntitled"]);
  });

  it("does NOT duplicate a current value that is already a page", () => {
    const out = buildTargetOccurrenceOptions({ occurrencesById, modulesById, currentId: "oSched" });
    expect(out.filter((o) => o.id === "oSched")).toHaveLength(1);
    expect(out.find((o) => o.id === "oSched").isCurrent).toBe(true);
    expect(out.every((o) => !o.offList)).toBe(true);
  });

  // A target whose occurrence was deleted must stay selectable and SAY SO,
  // rather than vanishing and being written away as null.
  it("keeps a DANGLING current id, labelled as missing", () => {
    const out = buildTargetOccurrenceOptions({ occurrencesById, modulesById, currentId: "ghost" });
    expect(out[0]).toMatchObject({ id: "ghost", label: "(missing occurrence)", offList: true, role: null });
  });

  it("is null-safe and returns [] with nothing to offer", () => {
    expect(buildTargetOccurrenceOptions()).toEqual([]);
    expect(buildTargetOccurrenceOptions({})).toEqual([]);
    expect(buildTargetOccurrenceOptions({ occurrencesById: {}, modulesById: {} })).toEqual([]);
  });
});
