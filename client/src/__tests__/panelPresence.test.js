import { describe, it, expect } from "vitest";
import { shownPageIds, heldBy, presentInPanels, matchedIds, planPanelFire } from "../helpers/panelPresence.js";
import { computeTriggerMatch } from "../helpers/operationExecutor.js";

const modulesById = {
  mPanel: { id: "mPanel", role: "panel" },
  mPage: { id: "mPage", role: "page" },
  mCont: { id: "mCont", role: "container" },
  mEx: { id: "mEx", role: "instance", label: "Exercise" },
};
const occurrencesById = {
  panelA: { id: "panelA", moduleId: "mPanel", viewId: "vA", occurrences: ["page1", "page2"] },
  panelB: { id: "panelB", moduleId: "mPanel", occurrences: ["page3"] },
  page1: { id: "page1", moduleId: "mPage", occurrences: ["cont1"] },
  page2: { id: "page2", moduleId: "mPage", occurrences: ["cont2"] },
  page3: { id: "page3", moduleId: "mPage", occurrences: [], textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "ex3" } }] } },
  cont1: { id: "cont1", moduleId: "mCont", occurrences: ["ex1"] },
  cont2: { id: "cont2", moduleId: "mCont", occurrences: ["ex2"] },
  ex1: { id: "ex1", moduleId: "mEx" },
  ex2: { id: "ex2", moduleId: "mEx" },
  ex3: { id: "ex3", moduleId: "mEx" },
};
const grid = { occurrences: ["panelA", "panelB"] };

describe("panelPresence", () => {
  it("a panel shows its view's active page, else its first page", () => {
    const viewsById = { vA: { id: "vA", activeOccurrenceId: "page2" } };
    expect(shownPageIds({ grid, occurrencesById, viewsById, modulesById })).toEqual(["page2", "page3"]);
    expect(shownPageIds({ grid, occurrencesById, viewsById: {}, modulesById })).toEqual(["page1", "page3"]);
  });

  it("follows child lists and doc embeds", () => {
    const held = heldBy(["page3"], occurrencesById);
    expect([...held].sort()).toEqual(["ex3", "page3"]);
  });

  it("a page in no panel is not present", () => {
    const present = presentInPanels({ grid, occurrencesById, viewsById: {}, modulesById });
    expect(present.has("ex1")).toBe(true);
    expect(present.has("ex2")).toBe(false);
  });

  it("a query matches named occurrences and occurrences of named modules", () => {
    const present = presentInPanels({ grid, occurrencesById, viewsById: {}, modulesById });
    expect([...matchedIds(present, { moduleIds: ["mEx"] }, occurrencesById)].sort()).toEqual(["ex1", "ex3"]);
    expect([...matchedIds(present, { occurrenceIds: ["cont1", "cont2"] }, occurrencesById)]).toEqual(["cont1"]);
    expect(matchedIds(present, {}, occurrencesById).size).toBe(0);
  });

  it("appear fires for what was gained, once fires only the first time, unload when all left", () => {
    const s = (...ids) => new Set(ids);
    expect(planPanelFire({ eventType: "onLoadInPanel", prev: undefined, next: s("a") })).toEqual({ fire: true, ids: ["a"] });
    expect(planPanelFire({ eventType: "onLoadInPanel", prev: s("a"), next: s("a") }).fire).toBe(false);
    expect(planPanelFire({ eventType: "onLoadInPanel", prev: s("a"), next: s("a", "b") })).toEqual({ fire: true, ids: ["b"] });
    expect(planPanelFire({ eventType: "onLoadInPanel", mode: "once", prev: s(), next: s("a"), firedOnce: true }).fire).toBe(false);
    expect(planPanelFire({ eventType: "onLoadInPanel", mode: "inView", prev: s(), next: s("a") }).fire).toBe(false);
    expect(planPanelFire({ eventType: "onUnloadFromPanel", prev: s("a"), next: s() })).toEqual({ fire: true, ids: ["a"] });
    expect(planPanelFire({ eventType: "onUnloadFromPanel", prev: s("a", "b"), next: s("b") }).fire).toBe(false);
  });

  it("the transaction matcher never fires a panel trigger on its own", () => {
    const op = { id: "op", enabled: true, triggerTypes: ["onLoadInPanel"], triggerObjects: [{ eventType: "onLoadInPanel", subjectType: "panelQuery" }] };
    expect(computeTriggerMatch(op, null, {})).toBe(false);
    expect(computeTriggerMatch(op, "OccurrenceCreateOp", {})).toBe(false);
  });
});
