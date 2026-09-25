// 0362 — a Routines container's item default is the colour its items share.
import { describe, it, expect } from "vitest";
import { planItemDefaults } from "../migrations/0362-routine-containers-item-color.mjs";

const M = (id, role, extra = {}) => [id, { id, role, ...extra }];
const modulesById = new Map([
  M("page", "page"), M("nutr", "container"), M("mixed", "container"), M("set", "container", { childInstanceStyle: { bg: "#000" } }),
  M("elsewhere", "container"),
  M("cook", "instance", { styleMode: "own", ownStyle: { bg: "#98431f" } }),
  M("eat", "instance", { styleMode: "own", ownStyle: { bg: "#98431f" } }),
  M("visited", "instance", { styleMode: "inherit" }),
  M("blue", "instance", { styleMode: "own", ownStyle: { bg: "#00f" } }),
]);
const occurrences = [
  { id: "P", moduleId: "page", occurrences: ["N", "X", "S"] },
  { id: "N", moduleId: "nutr", occurrences: ["c", "e", "v"] },
  { id: "X", moduleId: "mixed", occurrences: ["c2", "b"] },
  { id: "S", moduleId: "set", occurrences: ["c3"] },
  { id: "O", moduleId: "elsewhere", occurrences: ["c4"] },
  { id: "c", moduleId: "cook" }, { id: "e", moduleId: "eat" }, { id: "v", moduleId: "visited" },
  { id: "c2", moduleId: "cook" }, { id: "b", moduleId: "blue" }, { id: "c3", moduleId: "cook" }, { id: "c4", moduleId: "cook" },
];

describe("0362 planItemDefaults", () => {
  const plan = planItemDefaults({ occurrences, modulesById, pageOccIds: new Set(["P"]) });
  it("a container whose items share one colour gets it as the item default", () => {
    expect(plan).toEqual({ nutr: "#98431f" });
  });
  it("mixed colours, an existing default, and containers off the page are left alone", () => {
    expect(plan.mixed).toBeUndefined();
    expect(plan.set).toBeUndefined();
    expect(plan.elsewhere).toBeUndefined();
  });
});
