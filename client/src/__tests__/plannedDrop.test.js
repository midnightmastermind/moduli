import { describe, it, expect, beforeEach, vi } from "vitest";

const created = { modules: [], occurrences: [] };
vi.mock("../helpers/CommitHelpers", () => ({
  createModule: ({ module }) => created.modules.push(module),
  createOccurrence: ({ occurrence }) => created.occurrences.push(occurrence),
}));

import {
  registerPlannedState, plannedStateFor, collectPlannedSubtree, planMaterialize, materializePlanned,
  __resetPlannedRegistry,
} from "../helpers/plannedDrop";

// A planned Magic tree: a section (root) listing a textblock, whose text embeds a link chip.
const STATE = {
  modules: [
    { id: "mSec", role: "container", kind: "doc", label: "Chapter One" },
    { id: "mTb", role: "textblock", kind: "doc", label: "" },
    { id: "mChip", role: "textblock", kind: "inline", label: "" },
  ],
  occurrences: [
    { id: "sec", moduleId: "mSec", occurrences: ["tb"], textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "tb" } }] } },
    { id: "tb", moduleId: "mTb", textmap: { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "see " },
      { type: "instanceTextblockInline", attrs: { occurrenceId: "chip", instanceId: "mChip" } },
    ] }] } },
    { id: "chip", moduleId: "mChip", meta: { link: { kind: "url", url: "https://x.test" } } },
    { id: "other", moduleId: "mTb" },
  ],
};

beforeEach(() => { __resetPlannedRegistry(); created.modules.length = 0; created.occurrences.length = 0; });

describe("plannedDrop", () => {
  it("knows a planned id only while its view is registered", () => {
    expect(plannedStateFor("tb")).toBe(null);
    const off = registerPlannedState(STATE);
    expect(plannedStateFor("tb")).toBe(STATE);
    off();
    expect(plannedStateFor("tb")).toBe(null);
  });

  it("collects listed AND text-embedded descendants, children before parents, and nothing outside", () => {
    expect(collectPlannedSubtree("sec", STATE)).toEqual(["chip", "tb", "sec"]);
    expect(collectPlannedSubtree("tb", STATE)).toEqual(["chip", "tb"]);
  });

  it("mints fresh ids and points every reference inside the copy at the copy", () => {
    let n = 0;
    const plan = planMaterialize({ rootId: "sec", state: STATE, gridId: "g", userId: "u", parentId: "dest", newId: () => `n${++n}` });
    const byOld = Object.fromEntries(["chip", "tb", "sec"].map((id, i) => [id, plan.occurrences[i]]));
    expect(plan.rootId).toBe(byOld.sec.id);
    expect(plan.occurrences.every((o) => !["sec", "tb", "chip"].includes(o.id))).toBe(true);
    expect(byOld.sec.parentId).toBe("dest");
    expect(byOld.tb.parentId).toBe(byOld.sec.id);
    expect(byOld.chip.parentId).toBe(byOld.tb.id);
    expect(byOld.sec.occurrences).toEqual([byOld.tb.id]);
    expect(byOld.sec.textmap.content[0].attrs.occurrenceId).toBe(byOld.tb.id);
    const chipNode = byOld.tb.textmap.content[0].content[1];
    expect(chipNode.attrs.occurrenceId).toBe(byOld.chip.id);
    expect(chipNode.attrs.instanceId).toBe(byOld.chip.moduleId);
    expect(plan.modules.map((m) => m.id)).toContain(byOld.chip.moduleId);
    expect(plan.occurrences.every((o) => o.gridId === "g" && o.userId === "u")).toBe(true);
    expect(byOld.chip.meta.link.url).toBe("https://x.test");
  });

  it("leaves the planned tree itself untouched (Magic keeps its piece)", () => {
    const before = JSON.stringify(STATE);
    planMaterialize({ rootId: "sec", state: STATE, gridId: "g", userId: "u" });
    expect(JSON.stringify(STATE)).toBe(before);
  });

  it("creates modules first, then occurrences children-first; refuses without a grid or user", () => {
    expect(materializePlanned({ rootId: "sec", state: STATE, gridId: null, userId: "u" })).toBe(null);
    const plan = materializePlanned({ rootId: "sec", state: STATE, gridId: "g", userId: "u", parentId: null });
    expect(created.modules).toHaveLength(3);
    expect(created.occurrences.map((o) => o.id)).toEqual(plan.occurrences.map((o) => o.id));
    expect(created.occurrences.at(-1).id).toBe(plan.rootId);
    expect(created.occurrences.at(-1).parentId).toBe(null);
  });
});
