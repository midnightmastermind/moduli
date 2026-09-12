import { describe, it, expect } from "vitest";
import { readerStateFromPlan } from "../helpers/readerPlan";

// A plan shaped like the one `import_plan` returns: modules + occurrences and a
// root id that is IN the occurrence list.
function plan({ root = "occ-root", occurrences, modules } = {}) {
  return {
    ok: true,
    rootOccurrenceId: root,
    modules: modules ?? [
      { id: "mod-root", role: "container", kind: "doc", label: "Article" },
      { id: "mod-p", role: "textblock", kind: "doc", label: "" },
    ],
    occurrences: occurrences ?? [
      { id: "occ-root", moduleId: "mod-root", occurrences: ["occ-p"] },
      { id: "occ-p", moduleId: "mod-p", parentId: "occ-root" },
    ],
  };
}

describe("readerStateFromPlan", () => {
  it("returns the root id and a state carrying the planned rows", () => {
    const out = readerStateFromPlan(plan());
    expect(out).not.toBeNull();
    expect(out.rootOccurrenceId).toBe("occ-root");
    expect(out.state.occurrences).toHaveLength(2);
    expect(out.state.modules).toHaveLength(2);
    expect(out.state.hydrated).toBe(true);
  });

  // THE POINT OF THE WHOLE DESIGN. These rows exist only for this render; if the
  // state ever carried anything that could reach a write, the reader would be
  // minting occurrences on every page you glance at.
  it("carries ONLY the planned rows — no fields, views or folders", () => {
    const { state } = readerStateFromPlan(plan());
    expect(state.fields).toEqual([]);
    expect(state.views).toEqual([]);
    expect(state.folders).toEqual([]);
  });

  // `publishComputedValues` writes a MODULE-LEVEL singleton shared with the live
  // app. A reader that published an empty map would blank every display field on
  // the grid, so the key must be absent and the caller must opt out.
  it("does NOT carry computedValues", () => {
    const { state } = readerStateFromPlan(plan());
    expect("computedValues" in state).toBe(false);
  });

  it("refuses a plan whose root is not among its occurrences", () => {
    // An empty box and "this page has no text" want different messages, so a
    // plan naming a root it does not carry has to be distinguishable.
    expect(readerStateFromPlan(plan({ root: "occ-missing" }))).toBeNull();
  });

  it("refuses an empty or malformed plan", () => {
    expect(readerStateFromPlan(null)).toBeNull();
    expect(readerStateFromPlan({})).toBeNull();
    expect(readerStateFromPlan(plan({ occurrences: [] }))).toBeNull();
    expect(readerStateFromPlan(plan({ modules: [] }))).toBeNull();
    expect(readerStateFromPlan({ rootOccurrenceId: "x", occurrences: "nope", modules: [] })).toBeNull();
  });

  it("passes the rows through untouched — the renderers get real occurrences", () => {
    const p = plan();
    const { state } = readerStateFromPlan(p);
    expect(state.occurrences[0]).toBe(p.occurrences[0]);
    expect(state.modules[0]).toBe(p.modules[0]);
  });
});
