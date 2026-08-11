import { describe, it, expect } from "vitest";
import { shapeOf, mergeInheritedShape, SHAPE_KEYS }
  from "../migrations/0068-layout-lands-on-its-own-surface.mjs";
// The migration's key list must not drift from the client's.
import { SURFACE_SHAPE_KEYS } from "../../client/src/helpers/layoutCascade.js";

describe("0068 shapeOf", () => {
  it("keeps shape and drops view keys", () => {
    expect(shapeOf({ mode: "wrap", childMinWidth: 168, dragInView: "representation" }))
      .toEqual({ mode: "wrap", childMinWidth: 168 });
  });
  it("returns null for a view-only rule — nothing was being pushed down", () => {
    expect(shapeOf({ dragInView: "representation", locked: true })).toBeNull();
  });
  it("returns null for nothing at all", () => {
    expect(shapeOf(null)).toBeNull();
  });
});

describe("0068 mergeInheritedShape", () => {
  it("gives a child the shape it used to inherit", () => {
    expect(mergeInheritedShape(null, { mode: "wrap", childMinWidth: 168 }))
      .toEqual({ mode: "wrap", childMinWidth: 168 });
  });
  it("NEVER overwrites the child's own value — the discriminating refusal", () => {
    // The child said something deliberate; the parent's was an inherited default.
    expect(mergeInheritedShape({ mode: "grid" }, { mode: "wrap", childMinWidth: 168 }))
      .toEqual({ mode: "grid", childMinWidth: 168 });
  });
  it("returns null when the child already covers everything — the re-run guard", () => {
    expect(mergeInheritedShape({ mode: "grid", childMinWidth: 100 }, { mode: "wrap", childMinWidth: 168 }))
      .toBeNull();
  });
  it("preserves keys the parent never mentioned", () => {
    expect(mergeInheritedShape({ childGap: 4 }, { mode: "wrap" }))
      .toEqual({ childGap: 4, mode: "wrap" });
  });
  it("returns null when there is nothing to inherit", () => {
    expect(mergeInheritedShape({ mode: "grid" }, null)).toBeNull();
  });
});

describe("0068 key list", () => {
  it("matches the client's SURFACE_SHAPE_KEYS exactly, so the halves cannot drift", () => {
    expect([...SHAPE_KEYS].sort()).toEqual([...SURFACE_SHAPE_KEYS].sort());
  });
});

describe("0068 containerReadableShape", () => {
  it("propagates wrap, which is the one arrangement a container implements", async () => {
    const { containerReadableShape } = await import("../migrations/0068-layout-lands-on-its-own-surface.mjs");
    expect(containerReadableShape({ mode: "wrap", childMinWidth: 168, childGap: 8 }))
      .toEqual({ mode: "wrap", childMinWidth: 168, childGap: 8 });
  });
  it("REFUSES flex-row — inert on a container, so copying preserves nothing", async () => {
    // The Day Page really does push flex-row at its day columns; propagating it
    // would rearrange them the moment ModuleContainer learned the mode.
    const { containerReadableShape } = await import("../migrations/0068-layout-lands-on-its-own-surface.mjs");
    expect(containerReadableShape({ mode: "flex-row", childMinWidth: 420 })).toBeNull();
  });
  it("drops keys a container does not read", async () => {
    const { containerReadableShape } = await import("../migrations/0068-layout-lands-on-its-own-surface.mjs");
    expect(containerReadableShape({ mode: "wrap", columns: 3, sortChildrenByField: "f" }))
      .toEqual({ mode: "wrap" });
  });
});
