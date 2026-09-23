// THE ROOT OF THE FIELD-VISIBILITY CASCADE WAS UNREACHABLE.
//
// `grid.meta.fieldVisibility` is the top of the cascade `selectors.js`
// resolves, and it has been read there since 2026-08-11 — for the request that
// created it, *"hide tags everywhere, and hide date everywhere thats not tasks,
// schedule, trackers"*. Measured 2026-09-22: it is READ in exactly one place
// and WRITTEN nowhere in the source. Of ten grids only poms carried one, hiding
// Tags / Date / Kanban Column, so the only way to express "everywhere" was a
// hand write straight into Mongo — a thing this log already records going badly
// on this key's occurrence-level sibling (2026-09-18 (8)).
//
// Same shape as the button field whose `meta.operationId` had no editor
// (2026-09-21 (3)) and `grid.meta.scheduleFieldIds`, seed-only (2026-09-22 (16)).
//
// TWO DIFFERENCES AT THE ROOT ARE DELIBERATE, and both are asserted here so a
// later "tidy-up" cannot quietly restore them:
//   - no "Inherit" — nothing sits above the grid, and its off state IS "no
//     default", so Off CLEARS the key (the resolver already treats absent and
//     {mode:"off"} identically).
//   - no REVEAL control — `getEffectiveFieldRevealForOccurrence` walks
//     occurrences only and has no grid root, so one would write a dead key.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";

const updates = [];
vi.mock("../helpers/CommitHelpers", () => ({
  updateGrid: (args) => { updates.push({ kind: "grid", ...args }); },
  updateOccurrence: (args) => { updates.push({ kind: "occurrence", ...args }); },
}));

import FieldVisibilitySection from "../ui/FieldVisibilitySection";

const FIELDS = {
  "f-tags":   { id: "f-tags",   name: "Tags",   type: "select" },
  "f-date":   { id: "f-date",   name: "Date",   type: "date" },
  "f-notes":  { id: "f-notes",  name: "Notes",  type: "text" },
};
const GRID = { id: "g1", meta: { defaultStyle: { color: "red" }, scheduleFieldIds: ["f-date"] } };

function renderRoot(grid = GRID) {
  const ctx = {
    dispatch: vi.fn(), socket: {}, gridId: "g1",
    fieldsById: FIELDS, occurrencesById: {}, state: { grid },
  };
  return render(
    <GridActionsContext.Provider value={ctx}>
      <FieldVisibilitySection grid={grid} gridId="g1" />
    </GridActionsContext.Provider>
  );
}
const btn = (c, label) => [...c.querySelectorAll("button")].find(b => b.textContent.trim() === label);

beforeEach(() => { updates.length = 0; });

describe("the grid root can be set at all", () => {
  it("writes grid.meta.fieldVisibility, not an occurrence", () => {
    const { container } = renderRoot();
    fireEvent.click(btn(container, "Hide"));
    expect(updates).toHaveLength(1);
    expect(updates[0].kind).toBe("grid");
    expect(updates[0].grid.meta.fieldVisibility).toEqual({ mode: "hide", fieldIds: [] });
  });

  it("KEEPS the rest of grid.meta — a partial write would drop the style root", () => {
    // defaultStyle / scheduleFieldIds / autoAppliedFieldIds all live on meta.
    const { container } = renderRoot();
    fireEvent.click(btn(container, "Hide"));
    expect(updates[0].grid.meta.defaultStyle).toEqual({ color: "red" });
    expect(updates[0].grid.meta.scheduleFieldIds).toEqual(["f-date"]);
  });

  it("ticking a field puts that field id in the list", () => {
    const grid = { ...GRID, meta: { ...GRID.meta, fieldVisibility: { mode: "hide", fieldIds: [] } } };
    const { container } = renderRoot(grid);
    const row = [...container.querySelectorAll("span")].find(s => s.getAttribute("title") === "Tags");
    fireEvent.click(row.parentElement.querySelector('input[type="checkbox"]'));
    expect(updates.at(-1).grid.meta.fieldVisibility).toEqual({ mode: "hide", fieldIds: ["f-tags"] });
  });

  it("Off CLEARS the key rather than storing {mode:'off'}", () => {
    const grid = { ...GRID, meta: { ...GRID.meta, fieldVisibility: { mode: "hide", fieldIds: ["f-tags"] } } };
    const { container } = renderRoot(grid);
    fireEvent.click(btn(container, "Off"));
    expect("fieldVisibility" in updates.at(-1).grid.meta).toBe(false);
  });
});

describe("the root is not an occurrence, and the UI says so", () => {
  it("offers no Inherit — nothing sits above the grid", () => {
    const { container } = renderRoot();
    expect(btn(container, "Inherit")).toBeUndefined();
    expect(btn(container, "Off")).toBeTruthy();
    expect(btn(container, "Show")).toBeTruthy();
    expect(btn(container, "Hide")).toBeTruthy();
  });

  it("offers no Reveal control — that cascade has no grid root", () => {
    const { container } = renderRoot();
    expect(container.textContent).not.toMatch(/Reveal/);
    expect(btn(container, "On hover")).toBeUndefined();
  });

  it("still renders the occurrence form with Inherit AND Reveal (the control)", () => {
    // Without this, "no Inherit" is equally satisfied by a component that lost
    // the button everywhere.
    const occ = { id: "o1", fieldVisibility: null };
    const ctx = { dispatch: vi.fn(), socket: {}, gridId: "g1", fieldsById: FIELDS,
                  occurrencesById: { o1: occ }, state: { grid: GRID } };
    const { container } = render(
      <GridActionsContext.Provider value={ctx}>
        <FieldVisibilitySection occurrence={occ} />
      </GridActionsContext.Provider>
    );
    expect(btn(container, "Inherit")).toBeTruthy();
    expect(container.textContent).toMatch(/Reveal/);
  });

  it("an occurrence write still goes to updateOccurrence (the other control)", () => {
    const occ = { id: "o1", fieldVisibility: null };
    const ctx = { dispatch: vi.fn(), socket: {}, gridId: "g1", fieldsById: FIELDS,
                  occurrencesById: { o1: occ }, state: { grid: GRID } };
    const { container } = render(
      <GridActionsContext.Provider value={ctx}>
        <FieldVisibilitySection occurrence={occ} />
      </GridActionsContext.Provider>
    );
    fireEvent.click(btn(container, "Hide"));
    expect(updates.at(-1).kind).toBe("occurrence");
  });
});

// The RESOLVER's own behaviour — that a grid default applies where nothing
// nearer overrides, and that a nearer level REPLACES rather than merges — is
// covered by `fieldVisibilityGridRoot.test.js`, which has tested it since the
// root shipped. That file is the sharpest statement of this defect: the root
// was implemented, documented AND unit-tested, and nothing could set it.
