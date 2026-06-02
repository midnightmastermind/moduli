import { describe, it, expect } from "vitest";
import {
  resolveDefaultLayout,
  mergeLayoutRules,
  resolveLayoutCascade,
  buildLayoutCascadeContext,
  resolveEffectiveLayout,
  resolveEffectiveViewModeFromCascade,
  classifyOccurrenceContext,
  isMoveBlockedByCascadeLock,
} from "../helpers/layoutCascade";

// Layout cascade semantics:
//   - per-kind default is the base layer
//   - meta.layoutCascade on each ancestor (Grid → Panel → Page → Container)
//     layers as a partial override (only specified keys win)
//   - per-occurrence meta.layoutCascadeOverride is the strongest
//   - page-in-container hardcoded rule trumps every layer

describe("resolveDefaultLayout", () => {
  it("folder page → top-level offers actual + actual-converted (D4 2026-05-24)", () => {
    const r = resolveDefaultLayout({ role: "page", kind: "folder", context: "topLevel" });
    // top-level pages default to actual but expose actual-converted in the
    // switcher so users can collapse any page into a container-styled
    // render without nesting it.
    expect(r.dragInView).toBe("actual");
    expect(r.navOptions).toEqual(["actual", "actual-converted"]);
    expect(r.navAllowChange).toBe(true);
  });

  it("canvas container → representation default", () => {
    const r = resolveDefaultLayout({ role: "container", kind: "canvas" });
    expect(r.dragInView).toBe("representation");
    expect(r.showFieldsByDefault).toBe(false);
  });

  it("page nested in container → defaults to actual-converted with representation alt (Q2 2026-05-24)", () => {
    const r = resolveDefaultLayout({ role: "page", kind: "doc", context: "nestedInContainer" });
    expect(r.dragInView).toBe("actual-converted");
    expect(r.navOptions).toEqual(["representation", "actual-converted"]);
    expect(r.navAllowChange).toBe(true);
  });

  it("instance leaf — actual + nav locked to actual", () => {
    const r = resolveDefaultLayout({ role: "instance" });
    expect(r.dragInView).toBe("actual");
    expect(r.navOptions).toEqual(["actual"]);
  });
});

describe("mergeLayoutRules", () => {
  it("child overrides only the keys it specifies", () => {
    const parent = { dragInView: "actual", navOptions: ["actual"], locked: false };
    const child = { dragInView: "representation" };
    expect(mergeLayoutRules(parent, child)).toEqual({
      dragInView: "representation",
      navOptions: ["actual"],
      locked: false,
    });
  });

  it("null/undefined child values are skipped", () => {
    const parent = { dragInView: "actual", locked: true };
    const child = { dragInView: null, locked: undefined };
    expect(mergeLayoutRules(parent, child)).toEqual(parent);
  });

  it("null parent returns child", () => {
    const child = { dragInView: "preview" };
    expect(mergeLayoutRules(null, child)).toBe(child);
  });
});

describe("resolveLayoutCascade", () => {
  it("default-only cascade — no overrides, just the per-kind default", () => {
    const { levels, resolved } = resolveLayoutCascade({}, "container", "canvas");
    expect(levels.map(l => l.kind)).toEqual(["default"]);
    expect(resolved.dragInView).toBe("representation");
  });

  it("Grid override layers on top of default", () => {
    const ctx = {
      grid: { meta: { layoutCascadeDefaults: { dragInView: "preview" } } },
    };
    // Use "doc" container kind — it's the no-switcher kind after the
    // q3 ii rename collapsed list → board.
    const { levels, resolved } = resolveLayoutCascade(ctx, "container", "doc");
    expect(levels.map(l => l.kind)).toEqual(["default", "grid"]);
    expect(resolved.dragInView).toBe("preview");
    // navOptions still comes from the default
    expect(resolved.navOptions).toEqual(["actual"]);
  });

  it("Container override beats grid override", () => {
    const ctx = {
      grid: { meta: { layoutCascadeDefaults: { dragInView: "preview" } } },
      containerOcc: { meta: { layoutCascade: { dragInView: "representation" } } },
    };
    const { resolved } = resolveLayoutCascade(ctx, "instance", null);
    expect(resolved.dragInView).toBe("representation");
  });

  it("representationFieldIds flows through the cascade", () => {
    // Grid sets the default, container overrides it for descendants.
    const ctx = {
      grid: { meta: { layoutCascadeDefaults: { representationFieldIds: ["a", "b"] } } },
      containerOcc: { meta: { layoutCascade: { representationFieldIds: ["c"] } } },
    };
    const { resolved } = resolveLayoutCascade(ctx, "instance", null);
    expect(resolved.representationFieldIds).toEqual(["c"]);
  });

  it("Per-occurrence override is strongest", () => {
    const ctx = {
      containerOcc: { meta: { layoutCascade: { dragInView: "preview" } } },
      instanceOcc:  { meta: { layoutCascadeOverride: { dragInView: "actual" } } },
    };
    const { resolved } = resolveLayoutCascade(ctx, "instance", null);
    expect(resolved.dragInView).toBe("actual");
  });

  it("page-in-container hardcoded rule clamps navOptions to representation + actual-converted (Q2 2026-05-24)", () => {
    const ctx = {
      containerOcc: { meta: { layoutCascade: { dragInView: "actual", navAllowChange: true } } },
      pageOcc:      { meta: { layoutCascadeOverride: { dragInView: "actual" } } },
      container:    { id: "c1" }, // marks the leaf as "nestedInContainer"
    };
    const { resolved } = resolveLayoutCascade(ctx, "page", "board");
    // override of "actual" is illegal in container — coerced to actual-converted
    expect(resolved.dragInView).toBe("actual-converted");
    expect(resolved.navAllowChange).toBe(true);
    expect(resolved.navOptions).toEqual(["representation", "actual-converted"]);
  });

  it("standalone page — forced actual, no switcher", () => {
    const { resolved } = resolveLayoutCascade({}, "page", "doc");
    expect(resolved.dragInView).toBe("actual");
    expect(resolved.navAllowChange).toBe(false);
    expect(resolved.navOptions).toEqual([]);
  });
});

describe("buildLayoutCascadeContext", () => {
  it("walks parent chain via occurrences[] reverse map", () => {
    const occurrencesById = {
      p1: { id: "p1", targetId: "panelMod", occurrences: ["pg1"] },
      pg1: { id: "pg1", targetId: "pageMod", occurrences: ["c1"] },
      c1: { id: "c1", targetId: "contMod", occurrences: ["i1"] },
      i1: { id: "i1", targetId: "instMod" },
    };
    const modulesById = {
      panelMod: { role: "panel" },
      pageMod:  { role: "page",  kind: "board" },
      contMod:  { role: "container", kind: "board" },
      instMod:  { role: "instance" },
    };
    const ctx = buildLayoutCascadeContext({
      leafOccurrence: occurrencesById.i1,
      occurrencesById,
      modulesById,
      grid: { meta: {} },
    });
    // Leaf goes in `leaf` slot — never in an ancestor slot.
    expect(ctx.leaf?.role).toBe("instance");
    expect(ctx.leafOcc?.id).toBe("i1");
    expect(ctx.container?.role).toBe("container");
    expect(ctx.page?.role).toBe("page");
    expect(ctx.panel?.role).toBe("panel");
  });

  it("page leaf does NOT populate ctx.page (ancestor slot)", () => {
    const occurrencesById = {
      pg1: { id: "pg1", targetId: "pageMod" },
    };
    const modulesById = { pageMod: { role: "page", kind: "doc" } };
    const ctx = buildLayoutCascadeContext({
      leafOccurrence: occurrencesById.pg1,
      occurrencesById, modulesById, grid: { meta: {} },
    });
    expect(ctx.leaf?.role).toBe("page");
    expect(ctx.page).toBeFalsy();   // ancestor slot stays empty
  });

  it("missing inputs return ctx with just grid", () => {
    const ctx = buildLayoutCascadeContext({ grid: { meta: {} } });
    expect(ctx).toEqual({ grid: { meta: {} } });
  });
});

describe("page-within-page (task #45)", () => {
  it("page nested in a container — actual-converted default, switcher exposes representation too (Q2 2026-05-24)", () => {
    const occurrencesById = {
      c1: { id: "c1", targetId: "contMod", occurrences: ["pg1"] },
      pg1: { id: "pg1", targetId: "pageMod" },
    };
    const modulesById = {
      contMod: { role: "container", kind: "doc" },
      pageMod: { role: "page", kind: "board" },
    };
    const ctx = buildLayoutCascadeContext({
      leafOccurrence: occurrencesById.pg1,
      occurrencesById, modulesById, grid: { meta: {} },
    });
    expect(ctx.container?.role).toBe("container");
    expect(ctx.leaf?.role).toBe("page");
    const { resolved } = resolveLayoutCascade(ctx, "page", "board");
    expect(resolved.dragInView).toBe("actual-converted");
    expect(resolved.navAllowChange).toBe(true);
    expect(resolved.navOptions).toEqual(["representation", "actual-converted"]);
  });

  it("page at top level — forced actual, no switcher", () => {
    const occurrencesById = {
      panel1: { id: "panel1", targetId: "panelMod", occurrences: ["pg1"] },
      pg1: { id: "pg1", targetId: "pageMod" },
    };
    const modulesById = {
      panelMod: { role: "panel" },
      pageMod: { role: "page", kind: "doc" },
    };
    const ctx = buildLayoutCascadeContext({
      leafOccurrence: occurrencesById.pg1,
      occurrencesById, modulesById, grid: { meta: {} },
    });
    // Panel parent doesn't count as nesting — page sees panel and treats as topLevel.
    const { resolved } = resolveLayoutCascade(ctx, "page", "doc");
    expect(resolved.dragInView).toBe("actual");
    expect(resolved.navOptions).toEqual([]);
    expect(resolved.navAllowChange).toBe(false);
  });

  it("page nested in another page — forced representation", () => {
    const occurrencesById = {
      pg1: { id: "pg1", targetId: "parentPageMod", occurrences: ["pg2"] },
      pg2: { id: "pg2", targetId: "childPageMod" },
    };
    const modulesById = {
      parentPageMod: { role: "page", kind: "board" },
      childPageMod: { role: "page", kind: "doc" },
    };
    const ctx = buildLayoutCascadeContext({
      leafOccurrence: occurrencesById.pg2,
      occurrencesById, modulesById, grid: { meta: {} },
    });
    expect(ctx.page?.role).toBe("page"); // ancestor page is filled
    expect(ctx.leaf?.role).toBe("page"); // leaf is the inner page
    const { resolved } = resolveLayoutCascade(ctx, "page", "doc");
    // Page-in-page (#45) defaults to representation but is changeable
    // — the user can flip to "actual" to render the inner page inline
    // as a container-like surface.
    expect(resolved.dragInView).toBe("representation");
    expect(resolved.navAllowChange).toBe(true);
    expect(resolved.navOptions).toEqual(["representation", "actual", "actual-converted"]);
  });

  it("page-in-page — per-occurrence meta.viewMode 'actual' survives the cascade", () => {
    const occurrencesById = {
      panel1: { id: "panel1", targetId: "panelMod", occurrences: ["pg1"] },
      pg1: { id: "pg1", targetId: "parentPageMod", occurrences: ["pg2"] },
      pg2: { id: "pg2", targetId: "childPageMod", meta: { layoutCascadeOverride: { dragInView: "actual" } } },
    };
    const modulesById = {
      panelMod: { role: "panel" },
      parentPageMod: { role: "page", kind: "board" },
      childPageMod: { role: "page", kind: "doc" },
    };
    const ctx = buildLayoutCascadeContext({
      leafOccurrence: occurrencesById.pg2,
      occurrencesById, modulesById, grid: {},
    });
    const { resolved } = resolveLayoutCascade(ctx, "page", "doc");
    expect(resolved.dragInView).toBe("actual");
    expect(resolved.navAllowChange).toBe(true);
  });

  it("page-in-container — defaults to actual-converted, switcher exposes representation too (Q2 2026-05-24)", () => {
    const occurrencesById = {
      parent: { id: "parent", targetId: "contMod", occurrences: ["pg"] },
      pg: { id: "pg", targetId: "pageMod" },
    };
    const modulesById = {
      contMod: { role: "container", kind: "board" },
      pageMod: { role: "page", kind: "doc" },
    };
    const ctx = buildLayoutCascadeContext({
      leafOccurrence: occurrencesById.pg,
      occurrencesById, modulesById, grid: {},
    });
    const { resolved } = resolveLayoutCascade(ctx, "page", "doc");
    expect(resolved.dragInView).toBe("actual-converted");
    expect(resolved.navOptions).toEqual(["representation", "actual-converted"]);
    expect(resolved.navAllowChange).toBe(true);
  });
});

describe("resolveEffectiveLayout", () => {
  it("end-to-end: instance in canvas container → representation default", () => {
    const occurrencesById = {
      c1: { id: "c1", targetId: "canvasMod", occurrences: ["i1"] },
      i1: { id: "i1", targetId: "instMod" },
    };
    const modulesById = {
      canvasMod: { role: "container", kind: "canvas" },
      instMod:   { role: "instance" },
    };
    // The leaf is the instance; per-kind default for instance is "actual"
    // (canvas-container default doesn't push down today — that's by design,
    // dragInView only applies AT the surface receiving the drop).
    const r = resolveEffectiveLayout({
      occurrence: occurrencesById.i1,
      occurrencesById,
      modulesById,
      grid: {},
    });
    expect(r.dragInView).toBe("actual");
  });

  it("returns built-in default when occurrence is null", () => {
    const r = resolveEffectiveLayout({ occurrence: null });
    expect(r.dragInView).toBe("actual");
  });
});

describe("resolveEffectiveViewModeFromCascade (task #45)", () => {
  it("nested page in container — stored meta.viewMode wins when allowed (Q2 2026-05-24)", () => {
    const occurrencesById = {
      c1: { id: "c1", targetId: "contMod", occurrences: ["pg1"] },
      pg1: { id: "pg1", targetId: "pageMod", meta: { viewMode: "representation" } },
    };
    const modulesById = {
      contMod: { role: "container", kind: "board" },
      pageMod: { role: "page", kind: "board" },
    };
    const mode = resolveEffectiveViewModeFromCascade({
      occurrence: occurrencesById.pg1,
      occurrencesById, modulesById, grid: {},
    });
    // representation is in the allowed set (navOptions) → stored value wins
    expect(mode).toBe("representation");
  });

  it("nested page in container with no stored meta — defaults to actual-converted (Q2 2026-05-24)", () => {
    const occurrencesById = {
      c1: { id: "c1", targetId: "contMod", occurrences: ["pg1"] },
      pg1: { id: "pg1", targetId: "pageMod" },
    };
    const modulesById = {
      contMod: { role: "container", kind: "board" },
      pageMod: { role: "page", kind: "board" },
    };
    const mode = resolveEffectiveViewModeFromCascade({
      occurrence: occurrencesById.pg1,
      occurrencesById, modulesById, grid: {},
    });
    expect(mode).toBe("actual-converted");
  });

  it("top-level page — cascade forces actual even if meta says representation", () => {
    const occurrencesById = {
      panel1: { id: "panel1", targetId: "panelMod", occurrences: ["pg1"] },
      pg1: { id: "pg1", targetId: "pageMod", meta: { viewMode: "representation" } },
    };
    const modulesById = {
      panelMod: { role: "panel" },
      pageMod: { role: "page", kind: "doc" },
    };
    const mode = resolveEffectiveViewModeFromCascade({
      occurrence: occurrencesById.pg1,
      occurrencesById, modulesById, grid: {},
    });
    expect(mode).toBe("actual");
  });

  it("instance with cascade-allowed change — stored mode wins if allowed", () => {
    const occurrencesById = {
      i1: { id: "i1", targetId: "instMod", meta: { viewMode: "actual" } },
    };
    const modulesById = { instMod: { role: "instance" } };
    const mode = resolveEffectiveViewModeFromCascade({
      occurrence: occurrencesById.i1,
      occurrencesById, modulesById, grid: {},
    });
    expect(mode).toBe("actual");
  });
});

describe("classifyOccurrenceContext (Slice 1 helper, regression-tested)", () => {
  it("topLevel when no parent", () => {
    expect(classifyOccurrenceContext({ occurrence: { id: "a" }, occurrencesById: {}, modulesById: {} })).toBe("topLevel");
  });

  it("nestedInPage when parent is a page", () => {
    const occurrencesById = {
      parent: { id: "parent", targetId: "pageMod" },
      child: { id: "child", parentId: "parent", targetId: "childMod" },
    };
    const modulesById = { pageMod: { role: "page" }, childMod: { role: "page" } };
    expect(classifyOccurrenceContext({
      occurrence: occurrencesById.child, occurrencesById, modulesById,
    })).toBe("nestedInPage");
  });

  it("nestedInContainer when parent is a container", () => {
    const occurrencesById = {
      parent: { id: "parent", targetId: "contMod" },
      child: { id: "child", parentId: "parent", targetId: "childMod" },
    };
    const modulesById = { contMod: { role: "container" }, childMod: { role: "page" } };
    expect(classifyOccurrenceContext({
      occurrence: occurrencesById.child, occurrencesById, modulesById,
    })).toBe("nestedInContainer");
  });
});

describe("isMoveBlockedByCascadeLock (Slice 4)", () => {
  // Common setup: a locked container "lockedC" with a child instance "i1",
  // plus another container "openC" elsewhere.
  function buildWorld({ lockedCMeta = { layoutCascade: { locked: true } } } = {}) {
    const occurrencesById = {
      lockedC: { id: "lockedC", targetId: "contMod", occurrences: ["i1"], meta: lockedCMeta },
      openC:   { id: "openC",   targetId: "contMod", occurrences: ["i2"] },
      i1:      { id: "i1", targetId: "instMod" },
      i2:      { id: "i2", targetId: "instMod" },
    };
    const modulesById = {
      contMod: { role: "container", kind: "board" },
      instMod: { role: "instance" },
    };
    return { occurrencesById, modulesById };
  }

  it("returns blocked when moving out of a locked container into another container", () => {
    const { occurrencesById, modulesById } = buildWorld();
    const r = isMoveBlockedByCascadeLock({
      sourceOccurrence: occurrencesById.i1,
      destinationOccurrence: occurrencesById.openC,
      occurrencesById, modulesById, grid: {},
    });
    expect(r.blocked).toBe(true);
    expect(r.lockedAncestorId).toBe("lockedC");
  });

  it("returns not blocked for in-place reorder (same locked surface)", () => {
    const { occurrencesById, modulesById } = buildWorld();
    const r = isMoveBlockedByCascadeLock({
      sourceOccurrence: occurrencesById.i1,
      destinationOccurrence: occurrencesById.lockedC, // back into same surface
      occurrencesById, modulesById, grid: {},
    });
    expect(r.blocked).toBe(false);
  });

  it("returns not blocked when source has no locked ancestor", () => {
    const { occurrencesById, modulesById } = buildWorld({ lockedCMeta: {} });
    const r = isMoveBlockedByCascadeLock({
      sourceOccurrence: occurrencesById.i1,
      destinationOccurrence: occurrencesById.openC,
      occurrencesById, modulesById, grid: {},
    });
    expect(r.blocked).toBe(false);
  });

  it("treats null destination (drag to grid cell) as leaving the locked surface", () => {
    const { occurrencesById, modulesById } = buildWorld();
    const r = isMoveBlockedByCascadeLock({
      sourceOccurrence: occurrencesById.i1,
      destinationOccurrence: null,
      occurrencesById, modulesById, grid: {},
    });
    expect(r.blocked).toBe(true);
  });

  it("allows move when destination is a descendant of the locked ancestor", () => {
    // lockedPage holds two containers; moving an instance from one to the other
    // is still inside the locked surface.
    const occurrencesById = {
      lockedPage: { id: "lockedPage", targetId: "pageMod", occurrences: ["cA", "cB"], meta: { layoutCascade: { locked: true } } },
      cA: { id: "cA", targetId: "contMod", occurrences: ["i1"] },
      cB: { id: "cB", targetId: "contMod", occurrences: [] },
      i1: { id: "i1", targetId: "instMod" },
    };
    const modulesById = {
      pageMod: { role: "page", kind: "board" },
      contMod: { role: "container", kind: "board" },
      instMod: { role: "instance" },
    };
    const r = isMoveBlockedByCascadeLock({
      sourceOccurrence: occurrencesById.i1,
      destinationOccurrence: occurrencesById.cB,
      occurrencesById, modulesById, grid: {},
    });
    expect(r.blocked).toBe(false);
  });

  it("blocks move out of locked page to an unrelated destination", () => {
    const occurrencesById = {
      lockedPage: { id: "lockedPage", targetId: "pageMod", occurrences: ["cA"], meta: { layoutCascade: { locked: true } } },
      cA: { id: "cA", targetId: "contMod", occurrences: ["i1"] },
      otherC: { id: "otherC", targetId: "contMod", occurrences: [] },
      i1: { id: "i1", targetId: "instMod" },
    };
    const modulesById = {
      pageMod: { role: "page", kind: "board" },
      contMod: { role: "container", kind: "board" },
      instMod: { role: "instance" },
    };
    const r = isMoveBlockedByCascadeLock({
      sourceOccurrence: occurrencesById.i1,
      destinationOccurrence: occurrencesById.otherC,
      occurrencesById, modulesById, grid: {},
    });
    expect(r.blocked).toBe(true);
    expect(r.lockedAncestorId).toBe("lockedPage");
  });
});
