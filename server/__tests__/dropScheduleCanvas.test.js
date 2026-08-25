// Guards 0247's selection rule. The migration DELETES a page, its children and
// its module on live data, so the question each test answers is "could this
// delete something a person put there, or leave a dangling reference behind?"
import { describe, it, expect } from "vitest";
import { planCanvasRemoval } from "../migrations/0247-drop-the-schedule-canvas.mjs";

const MODS = [
  { id: "m-canvas", role: "page", kind: "canvas", label: "Schedule Canvas" },
  { id: "m-table",  role: "page", kind: "table",  label: "Schedule Table" },
  { id: "m-board",  role: "page", kind: "board",  label: "Schedule Canvas" }, // right label, wrong TYPE
  { id: "m-panel",  role: "panel", kind: "board", label: "Panel C" },
  { id: "m-inst",   role: "instance", kind: "board", label: "Eat" },
];

const canvas = (extra = {}) => ({ id: "canvas", moduleId: "m-canvas", occurrences: [], ...extra });
const copy = (id, srcId = "src", extra = {}) => ({
  id, moduleId: "m-inst", parentId: "canvas", meta: { feedSourceId: srcId }, occurrences: [], ...extra,
});
const source = (id = "src") => ({ id, moduleId: "m-inst", parentId: "schedule", occurrences: [] });
const panel = (id = "panel", lists = ["canvas"]) => ({ id, moduleId: "m-panel", occurrences: lists });

const plan = (occurrences, operations = [], gridMeta = {}) =>
  planCanvasRemoval({ occurrences, modules: MODS, operations, gridMeta });

describe("0247 — what gets deleted with the Schedule Canvas", () => {
  it("plans the page, its feed copies, the panels to unlist and the orphaned module", () => {
    const p = plan([canvas(), copy("c1"), copy("c2"), source(), panel()]);
    expect(p.refusals).toEqual([]);
    expect(p.canvas.id).toBe("canvas");
    expect(p.copies.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(p.unlistFrom).toEqual(["panel"]);
    expect(p.orphanModuleId).toBe("m-canvas");
  });

  it("finds EVERY parent that lists it — one left listing a deleted id is a dangling ref", () => {
    const p = plan([canvas(), source(), panel("panelC"), panel("panelD")]);
    expect(p.unlistFrom.sort()).toEqual(["panelC", "panelD"]);
  });

  it("REFUSES when a child is not a feed copy — a person put that there", () => {
    const p = plan([canvas(), copy("c1"), source(), { id: "mine", moduleId: "m-inst", parentId: "canvas" }]);
    expect(p.refusals.join(" ")).toMatch(/not a feed copy/);
  });

  it("REFUSES a copy whose source lives INSIDE the canvas — deleting it destroys the original", () => {
    const inside = { id: "src", moduleId: "m-inst", parentId: "canvas", occurrences: [] };
    const p = plan([canvas(), copy("c1", "src"), inside, panel()]);
    expect(p.refusals.join(" ")).toMatch(/feed source lives inside the canvas/);
  });

  it("collects a child listed by the page but NOT parented to it — the other reachability edge", () => {
    const listedOnly = { id: "listed", moduleId: "m-inst", parentId: "elsewhere", meta: { feedSourceId: "src" }, occurrences: [] };
    const p = plan([canvas({ occurrences: ["listed"] }), listedOnly, source(), panel()]);
    expect(p.copies.map((c) => c.id)).toEqual(["listed"]);
  });

  it("REFUSES when two page/canvas occurrences carry the label — ambiguous", () => {
    const p = plan([canvas(), { id: "canvas2", moduleId: "m-canvas", occurrences: [] }, source()]);
    expect(p.refusals.join(" ")).toMatch(/ambiguous/);
    expect(p.canvas).toBeNull();
  });

  it("ignores a BOARD page that happens to share the label — name AND type", () => {
    const p = plan([canvas(), { id: "board", moduleId: "m-board", occurrences: [] }, source(), panel()]);
    expect(p.canvas.id).toBe("canvas");
    expect(p.refusals).toEqual([]);
  });

  it("REFUSES when an operation names the page", () => {
    const ops = [{ name: "Something", pipeline: { steps: [{ config: { id: "canvas" } }] } }];
    const p = plan([canvas(), source(), panel()], ops);
    expect(p.refusals.join(" ")).toMatch(/named by an operation/);
  });

  it("REFUSES when a copy is embedded in someone's textmap", () => {
    const host = {
      id: "doc", moduleId: "m-inst", occurrences: [],
      textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "c1" } }] },
    };
    const p = plan([canvas(), copy("c1"), source(), host, panel()]);
    expect(p.refusals.join(" ")).toMatch(/embedded in/);
  });

  // A SECOND placement of the canvas module is necessarily a second
  // page/canvas/"Schedule Canvas" occurrence, so it can only ever surface as
  // ambiguity — which is exactly why the planner sweeps the module without
  // testing placement count. This pins that subsumption.
  it("treats a second placement of the module as ambiguity, never a lone sweep", () => {
    const p = plan([canvas(), { id: "other", moduleId: "m-canvas", occurrences: [] }, source(), panel()]);
    expect(p.refusals.join(" ")).toMatch(/ambiguous/);
    expect(p.canvas).toBeNull();
  });

  it("is a clean no-op on a grid with no Schedule Canvas", () => {
    const p = plan([source(), panel("panel", [])]);
    expect(p.canvas).toBeNull();
    expect(p.refusals).toEqual([]);
    expect(p.copies).toEqual([]);
  });
});
