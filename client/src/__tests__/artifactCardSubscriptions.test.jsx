// A BOARD OF 1,468 CARDS MUST NOT RE-RENDER BECAUSE SOMETHING MADE A MODULE.
//
// User, 2026-09-10: *"the app also still slows to a crawl but its before it even
// gets to the loading screen"* — which is what ruled out the iframe and pointed
// here. Opening the artifact spread CREATES a module, a view and two
// occurrences before any page starts loading, and `ArtifactCard` subscribed to
// `modulesById`, `viewsById` and `grid` — three maps that swap identity on
// exactly those writes.
//
// None of the three is read while RENDERING. All three are used only inside the
// double-click handler, which already reads `occurrencesById` lazily through
// `getOccMap` for this exact reason — its own comment says so:
//
//   "Resolved at CALLBACK time through the non-subscribing getter, so a board of
//    1,467 bookmark cards does not re-render on every occurrence write"
//
// One map was fixed and three were left, so the fan-out it describes happened
// anyway on any module/view/grid write.
//
// This mounts the REAL provider, because the bug IS the subscription — a mocked
// context would report whatever the mock chose to change.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// THE COUNTER. `Profiler` cannot do this job: its own element re-renders when
// the tree around it does, and `onRender` fires for that — the first version of
// this file counted the Profiler and reported 2 no matter what the card did.
// `resolveFileRef` is called in the card's RENDER BODY, so counting it counts
// renders of the card itself and nothing else.
let renders = 0;
vi.mock("../helpers/fileRef", () => ({ resolveFileRef: (v) => { renders++; return v || null; } }));
vi.mock("../helpers/openBookmark", async (importOriginal) => ({
  ...(await importOriginal()),
  openBookmarkInPanel: vi.fn(() => ({ ok: true })),
  openUrlInPanel: vi.fn(() => ({ ok: true })),
}));
vi.mock("../ui/ArtifactSpreadHost", () => ({ openArtifactSpread: vi.fn() }));
vi.mock("../helpers/targetPanel", () => ({ collectPanelOccurrences: () => ({}), enclosingPanelId: () => null, panelOccIdForElement: () => null }));

import ArtifactCard from "../modules/ArtifactCard";
import { GridActionsContext } from "../GridActionsContext.js";

const MODULE = { id: "m1", role: "artifact", kind: "bookmark", label: "A bookmark", fileRef: "https://example.com" };
const OCC = { id: "o1", moduleId: "m1", gridId: "g", userId: "u" };

// ISOLATION IS THE WHOLE TEST. Re-rendering the provider re-renders its children
// too, so a naive counter reports the PARENT's render and passes no matter what
// the card subscribes to — the first version of this file did exactly that and
// went green against the bug.
//
// `memo` with NO props means the parent can never re-render the card, so any
// count above zero on a value-identical provider update is a subscription firing.
const Card = React.memo(function Card() {
  return <ArtifactCard module={MODULE} label={MODULE.label} occurrence={OCC} />;
});

const baseValue = () => ({
  dispatch: vi.fn(), socket: {},
  getOcc: () => null, getOccMap: () => ({}), getModMap: () => ({}), getState: () => ({ grid: {} }),
  foldersById: {}, modulesById: {}, viewsById: {}, occurrencesById: {}, fieldsById: {},
  state: { grid: {} },
});

const tree = (value) => (
  <GridActionsContext.Provider value={value}>
    <Card />
  </GridActionsContext.Provider>
);

beforeEach(() => { renders = 0; });

describe("an artifact card only subscribes to what it renders from", () => {
  // THE CONTROL. Every assertion below is "it did NOT re-render", and a card
  // that never rendered at all would satisfy all of them.
  it("renders in the first place", () => {
    const { container } = render(tree(baseValue()));
    expect(container.querySelector(".artifact-card")).toBeTruthy();
    expect(renders).toBeGreaterThan(0);
  });

  /** Re-render with one slice swapped for a NEW object of identical contents —
   *  exactly what the reducer produces on a write. Returns the card's renders. */
  const rerendersOn = (patch) => {
    const v = baseValue();
    const { rerender } = render(tree(v));
    renders = 0;
    rerender(tree({ ...v, ...patch }));
    return renders;
  };

  it("does NOT re-render when a MODULE is written", () => {
    expect(rerendersOn({ modulesById: {} })).toBe(0);
  });

  it("does NOT re-render when a VIEW is written", () => {
    expect(rerendersOn({ viewsById: {} })).toBe(0);
  });

  it("does NOT re-render when the GRID is written", () => {
    expect(rerendersOn({ state: { grid: {} } })).toBe(0);
  });

  // THE DISCRIMINATOR. A card that subscribed to NOTHING would pass all three
  // above; it must still follow the things it genuinely renders from.
  it("DOES re-render when its own occurrence map changes shape", () => {
    const v = baseValue();
    const { rerender } = render(tree(v));
    renders = 0;
    rerender(tree({ ...v, foldersById: { f1: {} } }));
    expect(renders).toBeGreaterThan(0);
  });
});
