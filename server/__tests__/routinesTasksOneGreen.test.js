import { describe, it, expect } from "vitest";
import { planOneGreen, GREEN } from "../migrations/0417-routines-tasks-one-green.mjs";

const modules = [
  { id: "pR", role: "page", label: "Routines" }, { id: "pX", role: "page", label: "Schedule" },
  { id: "pT", role: "page", label: "Trackers" },
  { id: "c2", role: "container", label: "Shared", styleMode: "own", ownStyle: { bg: "#ababab" } },
  { id: "c1", role: "container", label: "Physical", styleMode: "own", ownStyle: { bg: "#b84329" } },
  { id: "i1", role: "instance", label: "Sleep", styleMode: "own", ownStyle: { bg: "#98431f" } },
  { id: "i2", role: "instance", label: "Done", styleMode: "own", ownStyle: { bg: GREEN } },
  { id: "k1", role: "instance", label: "Sleep", meta: { clonedFromModuleId: "i1" } },
  { id: "o1", role: "instance", label: "Elsewhere", styleMode: "own", ownStyle: { bg: "#123456" } },
];
const occurrences = [
  { id: "R", moduleId: "pR", occurrences: ["C1", "C2"] },
  { id: "C2", moduleId: "c2" },
  { id: "T", moduleId: "pT", occurrences: ["C2T"] }, { id: "C2T", moduleId: "c2" },
  { id: "C1", moduleId: "c1", occurrences: ["I1", "I2"], ownStyle: { bg: "#fff" } },
  { id: "I1", moduleId: "i1" }, { id: "I2", moduleId: "i2" },
  { id: "X", moduleId: "pX", occurrences: ["O1"] }, { id: "O1", moduleId: "o1" },
];

describe("0417 planOneGreen", () => {
  it("the page's containers + items and their clones; not other pages; not already green", () => {
    const { modIds, occIds, placeIds } = planOneGreen({ occurrences, modules });
    expect(modIds.sort()).toEqual(["c1", "i1", "k1"]);
    expect(occIds).toEqual(["C1"]);
    // c2 is also on Trackers: its module is left alone, its Routines placement is coloured.
    expect(placeIds).toEqual(["C2"]);
  });
});
