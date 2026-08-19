// __tests__/typeStyleCascade.test.js
//
// "Change the lettering all at once" (user, 2026-08-19). The cascade has always
// been by PLACEMENT — grid → panel → page → container → instance — so styling
// every doc container meant visiting every doc container. `grid.meta.typeStyles`
// is one entry per `role/kind`.
//
// The load-bearing part is WHERE it sits: under the grid root so it is a
// default, above the placement chain so any one container can still override
// it. A type default that could not be overridden would be a worse tool than
// editing by hand.
import { describe, it, expect } from "vitest";
import {
  typeKeyFor, typeStyleFor, resolveContainerStyle, resolveInstanceStyle, resolveStyleCascade,
} from "../helpers/StyleHelpers";

const grid = (typeStyles, defaultStyle = null) => ({ meta: { typeStyles, ...(defaultStyle ? { defaultStyle } : {}) } });

describe("typeKeyFor", () => {
  it("uses the same role/kind string checkGrid and the sweep already use", () => {
    expect(typeKeyFor({ role: "container", kind: "doc" })).toBe("container/doc");
    expect(typeKeyFor({ role: "instance" })).toBe("instance/-");   // no sub-types
  });
  it("returns null for something with no role rather than a bogus key", () => {
    expect(typeKeyFor({})).toBeNull();
    expect(typeKeyFor(null)).toBeNull();
  });
});

describe("the type layer reaches the RENDER paths, not just the editor", () => {
  it("styles every container of a type", () => {
    const g = grid({ "container/doc": { fontFamily: "Silkscreen", textColor: "#3a2410" } });
    const out = resolveContainerStyle({ role: "container", kind: "doc" }, null, null, g);
    expect(out.fontFamily).toBe("Silkscreen");
    expect(out.textColor).toBe("#3a2410");
  });

  it("styles every instance of a type", () => {
    const g = grid({ "instance/-": { fontSize: "13px" } });
    const out = resolveInstanceStyle({ role: "instance" }, null, null, g);
    expect(out.fontSize).toBe("13px");
  });

  it("leaves a DIFFERENT type alone", () => {
    const g = grid({ "container/doc": { fontFamily: "Silkscreen" } });
    const out = resolveContainerStyle({ role: "container", kind: "board" }, null, null, g);
    expect(out?.fontFamily ?? null).toBeNull();
  });

  it("is a DEFAULT — the container's own style still wins", () => {
    const g = grid({ "container/doc": { textColor: "#111" } });
    const out = resolveContainerStyle(
      { role: "container", kind: "doc", styleMode: "own", ownStyle: { textColor: "#f00" } },
      null, null, g,
    );
    expect(out.textColor).toBe("#f00");
  });

  it("…and so does a single PLACEMENT", () => {
    const g = grid({ "container/doc": { textColor: "#111" } });
    const out = resolveContainerStyle(
      { role: "container", kind: "doc" }, null, { ownStyle: { textColor: "#0f0" } }, g,
    );
    expect(out.textColor).toBe("#0f0");
  });

  it("sits ABOVE the grid default, so a type refines it", () => {
    const g = grid({ "container/doc": { textColor: "#222" } }, { textColor: "#999", padding: "4px" });
    const out = resolveContainerStyle({ role: "container", kind: "doc" }, null, null, g);
    expect(out.textColor).toBe("#222");   // the type wins
    expect(out.padding).toBe("4px");      // …and the grid default still applies
  });

  it("changes NOTHING for a grid that has no typeStyles — the back-compat case", () => {
    const before = resolveContainerStyle({ role: "container", kind: "doc" }, null, null, { meta: {} });
    expect(before).toBeNull();
    expect(typeStyleFor({ meta: {} }, { role: "container", kind: "doc" })).toBeNull();
  });
});

describe("the editor's cascade view shows the row that actually paints", () => {
  it("surfaces a Type level named after the key", () => {
    const g = grid({ "container/doc": { fontSize: "12px" } });
    const { levels } = resolveStyleCascade(
      { grid: g, container: { role: "container", kind: "doc" } }, "container",
    );
    const row = levels.find(l => l.kind === "type");
    expect(row).toBeTruthy();
    expect(row.label).toBe("Every container/doc");
    expect(row.source).toBe('grid.meta.typeStyles["container/doc"]');
  });

  it("shows no Type row when the grid has none", () => {
    const { levels } = resolveStyleCascade(
      { grid: { meta: {} }, container: { role: "container", kind: "doc" } }, "container",
    );
    expect(levels.find(l => l.kind === "type")).toBeUndefined();
  });
});
