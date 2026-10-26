// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { pressPanel } from "../helpers/pressPanel.js";
import { buttonTransaction } from "../helpers/buttonRun.js";

describe("the panel a button was pressed in", () => {
  const state = {
    grid: { occurrences: ["pA"] },
    occurrences: [{ id: "elsewhere", moduleId: "PM", viewId: "vX" }, { id: "pA", moduleId: "PM", viewId: "v1" }],
    views: [{ id: "v1", activeOccurrenceId: "artistsPage" }],
  };
  it("is found from the element: the panel on this grid, its view and the page it shows", () => {
    document.body.innerHTML = '<div data-panel-id="PM"><div><button id="b">Albums</button></div></div>';
    expect(pressPanel(document.getElementById("b"), state)).toEqual({ panelOccurrenceId: "pA", panelViewId: "v1", panelPageId: "artistsPage" });
  });
  it("is nothing outside a panel (control)", () => {
    document.body.innerHTML = '<button id="b">x</button>';
    expect(pressPanel(document.getElementById("b"), state)).toEqual({});
  });
  it("reaches the operation as $trigger.panelViewId / panelPageId", () => {
    const t = buttonTransaction({ op: { id: "o" }, hostOccurrence: { id: "r", moduleId: "m" }, fieldId: "f", panel: { panelOccurrenceId: "pA", panelViewId: "v1", panelPageId: "artistsPage" } });
    expect([t.panelViewId, t.panelPageId, t.panelOccurrenceId]).toEqual(["v1", "artistsPage", "pA"]);
  });
});
