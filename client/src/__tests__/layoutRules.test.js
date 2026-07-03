// Tests for helpers/layoutRules.js — per-grid responsive layout rules.
import { describe, it, expect } from "vitest";
import { resolveLayoutMode } from "../helpers/layoutRules";

const vp = (width, height) => ({ width, height });

describe("resolveLayoutMode", () => {
  it("returns null with no rules / empty rules / no viewport", () => {
    expect(resolveLayoutMode(null, vp(800, 600))).toBe(null);
    expect(resolveLayoutMode([], vp(800, 600))).toBe(null);
    expect(resolveLayoutMode([{ id: "a", layout: "desktop" }], null)).toBe(null);
  });

  it("an unbounded rule matches any viewport", () => {
    expect(resolveLayoutMode([{ id: "a", layout: "mobile" }], vp(2000, 50))).toBe("mobile");
  });

  it("applies min/max width bounds", () => {
    const rules = [{ id: "a", minWidth: 700, maxWidth: 1200, layout: "desktop" }];
    expect(resolveLayoutMode(rules, vp(699, 800))).toBe(null);
    expect(resolveLayoutMode(rules, vp(700, 800))).toBe("desktop");
    expect(resolveLayoutMode(rules, vp(1200, 800))).toBe("desktop");
    expect(resolveLayoutMode(rules, vp(1201, 800))).toBe(null);
  });

  it("applies min/max height bounds", () => {
    const rules = [{ id: "a", minHeight: 500, maxHeight: 900, layout: "mobile" }];
    expect(resolveLayoutMode(rules, vp(800, 499))).toBe(null);
    expect(resolveLayoutMode(rules, vp(800, 500))).toBe("mobile");
    expect(resolveLayoutMode(rules, vp(800, 901))).toBe(null);
  });

  it("first matching rule wins", () => {
    const rules = [
      { id: "a", minWidth: 1000, layout: "desktop" },
      { id: "b", layout: "mobile" },
    ];
    expect(resolveLayoutMode(rules, vp(1400, 800))).toBe("desktop");
    expect(resolveLayoutMode(rules, vp(600, 800))).toBe("mobile");
  });

  it("skips malformed rules (bad layout value) and blank-string bounds match any", () => {
    const rules = [
      { id: "bad", layout: "tv" },
      { id: "ok", minWidth: "", maxWidth: null, layout: "desktop" },
    ];
    expect(resolveLayoutMode(rules, vp(500, 500))).toBe("desktop");
  });

  it("pinning both tablet orientations to desktop (the rotation-lag use case)", () => {
    // One rule covering everything ≥600px wide in EITHER orientation.
    const rules = [{ id: "a", minWidth: 600, layout: "desktop" }];
    expect(resolveLayoutMode(rules, vp(1280, 800))).toBe("desktop"); // landscape
    expect(resolveLayoutMode(rules, vp(800, 1280))).toBe("desktop"); // portrait
  });
});
