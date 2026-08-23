// The right-click items that SET the sticky open target. Setting and opening
// are different gestures — this list only does the first.
import { describe, it, expect } from "vitest";
import { targetPanelMenuItems, shouldOfferTargetPicker } from "../helpers/targetPanelMenu";

const panels = [{ id: "pA", label: "Panel A" }, { id: "pC", label: "Panel C" }];

describe("targetPanelMenuItems", () => {
  it("lists every panel", () => {
    expect(targetPanelMenuItems({ panels }).map(i => i.label)).toEqual(["Panel A", "Panel C"]);
  });

  it("ticks the current target", () => {
    const items = targetPanelMenuItems({ panels, currentId: "pC" });
    expect(items.find(i => i.id === "pC").checked).toBe(true);
    expect(items.find(i => i.id === "pA").checked).toBe(false);
  });

  it("offers Clear only when something is SET", () => {
    // An always-present Clear on a feature that is off by default is a control
    // that does nothing.
    expect(targetPanelMenuItems({ panels }).some(i => i.clears)).toBe(false);
    expect(targetPanelMenuItems({ panels, currentId: "pC" }).some(i => i.clears)).toBe(true);
  });

  it("still offers Clear when the target panel is GONE, and says so", () => {
    // Otherwise the setting is unreachable and silently keeps failing over to
    // "here" forever, with no way to turn it off.
    const items = targetPanelMenuItems({ panels, currentId: "pGone" });
    const clear = items.find(i => i.clears);
    expect(clear).toBeTruthy();
    expect(clear.label).toMatch(/gone/);
  });

  it("names an unlabelled panel rather than rendering a blank row", () => {
    expect(targetPanelMenuItems({ panels: [{ id: "p1" }] })[0].label).toBe("Untitled panel");
  });

  it("skips a panel with no id", () => {
    expect(targetPanelMenuItems({ panels: [{ label: "ghost" }, ...panels] })).toHaveLength(2);
  });

  it("an empty list yields nothing — the control", () => {
    expect(targetPanelMenuItems({ panels: [] })).toEqual([]);
  });
});

describe("shouldOfferTargetPicker", () => {
  it("is offered with more than one panel", () => {
    expect(shouldOfferTargetPicker(panels)).toBe(true);
  });
  it("is NOT offered with one panel or none", () => {
    // With one panel there is nowhere else to send anything and the setting
    // would only restate the default.
    expect(shouldOfferTargetPicker([panels[0]])).toBe(false);
    expect(shouldOfferTargetPicker([])).toBe(false);
    expect(shouldOfferTargetPicker(undefined)).toBe(false);
  });
});
