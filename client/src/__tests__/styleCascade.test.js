import { describe, it, expect } from "vitest";
import {
  resolveStyleCascade,
  resolveContainerStyle,
  resolveInstanceStyle,
  buildStyleCascadeContext,
} from "../helpers/StyleHelpers";

// Cascade semantics:
//   - ownStyle (+ per-placement overlay) emits ONLY at the leaf level.
//   - childContainerStyle / childInstanceStyle push DOWN to descendants
//     matching the child kind.
//   - grid.meta.defaultStyle is the cascade root and always emits when set.
//
// Resolved is merge-top-down (closer ancestor wins). levels[] is the
// ordered list of contributions for the editor's read-only view.

const grid = { meta: { defaultStyle: { bg: "#111", fontSize: "12px" } } };
const panel = {
  styleMode: "own", ownStyle: { bg: "panelOwn", borderRadius: "8px" },
  childContainerStyle: { bg: "panelCh-c", padding: "4px" },
  childInstanceStyle:  { bg: "panelCh-i" },
};
const page = {
  styleMode: "own", ownStyle: { bg: "pageOwn", textColor: "#fff" },
};
const container = {
  styleMode: "own", ownStyle: { bg: "contOwn" },
  childInstanceStyle: { bg: "contCh-i", padding: "2px" },
};
const instance = { styleMode: "own", ownStyle: { bg: "instOwn" } };

describe("resolveStyleCascade", () => {
  it("grid leaf — only grid default contributes", () => {
    const out = resolveStyleCascade({ grid }, "grid");
    expect(out.levels.map(l => l.source)).toEqual(["grid.meta.defaultStyle"]);
    expect(out.resolved.bg).toBe("#111");
  });

  it("panel leaf — own bleeds; childContainer/Instance do NOT", () => {
    const out = resolveStyleCascade({ grid, panel }, "panel");
    expect(out.levels.map(l => l.source)).toEqual([
      "grid.meta.defaultStyle",
      "panel.ownStyle",
    ]);
    expect(out.resolved.bg).toBe("panelOwn");
    expect(out.resolved.borderRadius).toBe("8px");
    expect(out.resolved.padding).toBeUndefined(); // childContainer pushdown excluded
  });

  it("page leaf — panel.ownStyle does NOT flow down, panel.childContainerStyle DOES", () => {
    const out = resolveStyleCascade({ grid, panel, page }, "page");
    expect(out.levels.map(l => l.source)).toEqual([
      "grid.meta.defaultStyle",
      "panel.childContainerStyle",
      "page.ownStyle",
    ]);
    // page.ownStyle.bg=pageOwn wins over panel.childContainerStyle.bg=panelCh-c
    expect(out.resolved.bg).toBe("pageOwn");
    expect(out.resolved.padding).toBe("4px"); // from panel.childContainerStyle
    expect(out.resolved.fontSize).toBe("12px"); // from grid default
  });

  it("container leaf — own + ancestor pushdowns; ancestor ownStyle excluded", () => {
    const out = resolveStyleCascade({ grid, panel, container }, "container");
    const sources = out.levels.map(l => l.source);
    expect(sources).toContain("grid.meta.defaultStyle");
    expect(sources).toContain("panel.childContainerStyle");
    expect(sources).toContain("container.ownStyle");
    expect(sources).not.toContain("panel.ownStyle");
    expect(out.resolved.bg).toBe("contOwn"); // own wins
  });

  it("instance leaf — uses childInstanceStyle pushdowns (not childContainerStyle)", () => {
    const out = resolveStyleCascade({ grid, panel, container, instance }, "instance");
    const sources = out.levels.map(l => l.source);
    expect(sources).toContain("panel.childInstanceStyle");
    expect(sources).toContain("container.childInstanceStyle");
    expect(sources).toContain("instance.ownStyle");
    expect(sources).not.toContain("panel.ownStyle");
    expect(sources).not.toContain("container.ownStyle");
    expect(out.resolved.bg).toBe("instOwn");
    expect(out.resolved.padding).toBe("2px"); // container.childInstanceStyle
  });

  it("per-placement overlay wins over module ownStyle at the leaf", () => {
    const containerOcc = { ownStyle: { bg: "placement" } };
    const out = resolveStyleCascade({ grid, panel, container, containerOcc }, "container");
    expect(out.resolved.bg).toBe("placement");
  });

  it("missing ancestors are skipped without error", () => {
    const out = resolveStyleCascade({ grid, container }, "container");
    expect(out.levels.map(l => l.source)).toEqual([
      "grid.meta.defaultStyle",
      "container.ownStyle",
    ]);
  });
});

describe("legacy resolveContainerStyle now layers Grid default", () => {
  it("merges grid → panel.childContainerStyle → container.ownStyle → occurrence", () => {
    const occ = { ownStyle: { borderColor: "red" } };
    const out = resolveContainerStyle(container, panel, occ, grid);
    expect(out.bg).toBe("contOwn"); // container.ownStyle
    expect(out.padding).toBe("4px"); // panel.childContainerStyle
    expect(out.fontSize).toBe("12px"); // grid default
    expect(out.borderColor).toBe("red"); // occurrence overlay
  });

  it("legacy callers that omit grid keep working", () => {
    const out = resolveContainerStyle(container, panel, null);
    expect(out.bg).toBe("contOwn");
    expect(out.fontSize).toBeUndefined();
  });
});

describe("legacy resolveInstanceStyle now layers Grid default", () => {
  it("merges grid → panel/container pushdowns → instance.ownStyle", () => {
    const out = resolveInstanceStyle(instance, container, panel, grid);
    expect(out.bg).toBe("instOwn");
    expect(out.padding).toBe("2px"); // container.childInstanceStyle
    expect(out.fontSize).toBe("12px"); // grid default
  });
});

// THE FIXTURE USED TO SAY `targetId`, which is why the 2026-07-29 rename audit
// missed this walk entirely: the test passed against a function reading a field
// no occurrence has carried since. Measured on the live grid, 0 of 5,564
// occurrences carry `targetId`. Keep these on `moduleId` — with the old shape
// this suite cannot fail.
describe("buildStyleCascadeContext parent-chain walk", () => {
  it("buckets ancestors by role via occurrences[] reverse map", () => {
    const panelMod  = { id: "pmod", role: "panel",     childContainerStyle: { padding: "5px" } };
    const pageMod   = { id: "pgmod", role: "page",     styleMode: "own", ownStyle: { bg: "#abc" } };
    const contMod   = { id: "cmod", role: "container", styleMode: "own", ownStyle: { bg: "#def" } };
    const instMod   = { id: "imod", role: "instance" };
    const occPanel  = { id: "po", moduleId: "pmod",  occurrences: ["pgo"] };
    const occPage   = { id: "pgo", moduleId: "pgmod", parentId: "po",  occurrences: ["co"] };
    const occCont   = { id: "co", moduleId: "cmod",   parentId: "pgo", occurrences: ["io"] };
    const occInst   = { id: "io", moduleId: "imod",   parentId: "co" };
    const ctx = buildStyleCascadeContext({
      leafOccurrence: occInst,
      occurrencesById: { po: occPanel, pgo: occPage, co: occCont, io: occInst },
      modulesById: { pmod: panelMod, pgmod: pageMod, cmod: contMod, imod: instMod },
      grid,
    });
    expect(ctx.panel?.id).toBe("pmod");
    expect(ctx.page?.id).toBe("pgmod");
    expect(ctx.container?.id).toBe("cmod");
    expect(ctx.instance?.id).toBe("imod");
    expect(ctx.grid).toBe(grid);
  });
});
