// Which panels exist, and which one am I inside.
//
// Extracted because the card that OPENS a bookmark and the menu that SETS the
// target were doing the same walk twice. These tests pin the two things that
// walk has to get right and that a second copy would drift on: the DEPTH CAP,
// and the ORDER a picker lists panels in.
import { describe, it, expect } from "vitest";
import { collectPanelOccurrences, enclosingPanelId, panelChoices } from "../helpers/targetPanel";

const mods = {
  mPanel: { id: "mPanel", role: "panel", label: "Panel module" },
  mBoard: { id: "mBoard", role: "container" },
  mLeaf:  { id: "mLeaf",  role: "artifact" },
};
const occs = {
  pA:   { id: "pA",   moduleId: "mPanel", label: "Left",  parentId: null },
  pB:   { id: "pB",   moduleId: "mPanel", label: "Right", parentId: null },
  page: { id: "page", moduleId: "mBoard", parentId: "pA" },
  row:  { id: "row",  moduleId: "mLeaf",  parentId: "page" },
  free: { id: "free", moduleId: "mLeaf",  parentId: null },
};

describe("collectPanelOccurrences", () => {
  it("keeps only occurrences whose MODULE is a panel", () => {
    expect(Object.keys(collectPanelOccurrences(occs, mods)).sort()).toEqual(["pA", "pB"]);
  });
  it("is empty when nothing is a panel — the control", () => {
    expect(collectPanelOccurrences({ row: occs.row }, mods)).toEqual({});
  });
});

describe("enclosingPanelId", () => {
  it("walks up to the panel a row sits in", () => {
    expect(enclosingPanelId("row", occs, collectPanelOccurrences(occs, mods))).toBe("pA");
  });

  it("returns null for a row under no panel, rather than guessing one", () => {
    expect(enclosingPanelId("free", occs, collectPanelOccurrences(occs, mods))).toBeNull();
  });

  it("a panel resolves to ITSELF", () => {
    expect(enclosingPanelId("pB", occs, collectPanelOccurrences(occs, mods))).toBe("pB");
  });

  it("TERMINATES on a parent cycle instead of hanging the click", () => {
    // This grid has produced a self-parented occurrence before (2026-07-30, a
    // board that became its own child). Without the cap this is an infinite
    // loop inside a click handler, which reads as the app freezing.
    const cyclic = { a: { id: "a", moduleId: "mLeaf", parentId: "b" }, b: { id: "b", moduleId: "mLeaf", parentId: "a" } };
    expect(enclosingPanelId("a", cyclic, {})).toBeNull();
  });
});

describe("panelChoices", () => {
  const panels = collectPanelOccurrences(occs, mods);

  it("lists panels in the GRID's own order, not object order", () => {
    // A menu whose rows reshuffle between two right-clicks cannot be learned.
    expect(panelChoices({ occurrences: ["pB", "pA"] }, panels, mods).map(p => p.id)).toEqual(["pB", "pA"]);
  });

  it("still includes a panel the grid does not list, rather than hiding it", () => {
    expect(panelChoices({ occurrences: ["pA"] }, panels, mods).map(p => p.id)).toEqual(["pA", "pB"]);
  });

  it("never lists the same panel twice when the grid lists it twice", () => {
    expect(panelChoices({ occurrences: ["pA", "pA"] }, panels, mods).map(p => p.id)).toEqual(["pA", "pB"]);
  });

  it("falls back to the MODULE label when the occurrence has none", () => {
    const unlabelled = { pZ: { id: "pZ", moduleId: "mPanel", parentId: null } };
    expect(panelChoices({ occurrences: ["pZ"] }, unlabelled, mods)[0].label).toBe("Panel module");
  });
});
