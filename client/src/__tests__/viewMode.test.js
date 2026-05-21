// __tests__/viewMode.test.js
// Coverage for the view-mode resolution helper + context constraints.
import { describe, it, expect } from "vitest";
import {
  getEffectiveViewMode,
  getAllowedViewModes,
  isViewModeIllegal,
  VIEW_MODES,
  VIEW_MODE_CONTEXTS,
} from "../helpers/viewMode";

describe("getEffectiveViewMode", () => {
  it("returns the stored meta.viewMode when allowed in context", () => {
    const occ = { meta: { viewMode: "representation" } };
    expect(getEffectiveViewMode(occ, "default")).toBe("representation");
    expect(getEffectiveViewMode(occ, "mindMap")).toBe("representation");
  });

  it("falls back to the context default when no stored viewMode", () => {
    expect(getEffectiveViewMode({}, "default")).toBe("actual");
    expect(getEffectiveViewMode({}, "folderPage")).toBe("preview");
    expect(getEffectiveViewMode({}, "mindMap")).toBe("representation");
  });

  it("coerces a disallowed stored mode back to the context default", () => {
    // "actual" is illegal on folder-page cards per spec.
    const occ = { meta: { viewMode: "actual" } };
    expect(getEffectiveViewMode(occ, "folderPage")).toBe("preview");
  });

  it("returns context default for null occurrence", () => {
    expect(getEffectiveViewMode(null, "default")).toBe("actual");
    expect(getEffectiveViewMode(undefined, "folderPage")).toBe("preview");
  });

  it("falls back to default context when an unknown contextTag is passed", () => {
    expect(getEffectiveViewMode({}, "nonexistent")).toBe("actual");
  });
});

describe("getAllowedViewModes", () => {
  it("returns all three modes for the default context", () => {
    expect(getAllowedViewModes("default")).toEqual(["preview", "representation", "actual"]);
  });

  it("excludes 'actual' from folderPage context", () => {
    expect(getAllowedViewModes("folderPage")).toEqual(["preview", "representation"]);
    expect(getAllowedViewModes("folderPage")).not.toContain("actual");
  });

  it("allows all three for mindMap context", () => {
    expect(getAllowedViewModes("mindMap")).toContain("actual");
  });
});

describe("isViewModeIllegal", () => {
  it("returns true when the stored mode isn't allowed", () => {
    expect(isViewModeIllegal({ meta: { viewMode: "actual" } }, "folderPage")).toBe(true);
  });

  it("returns false when stored mode is allowed", () => {
    expect(isViewModeIllegal({ meta: { viewMode: "preview" } }, "folderPage")).toBe(false);
  });

  it("returns false when no viewMode is stored (default fallback applies cleanly)", () => {
    expect(isViewModeIllegal({}, "folderPage")).toBe(false);
    expect(isViewModeIllegal(null, "folderPage")).toBe(false);
  });
});

describe("VIEW_MODES + contexts shape", () => {
  it("VIEW_MODES has exactly the three modes the spec calls for", () => {
    expect(new Set(VIEW_MODES)).toEqual(new Set(["preview", "representation", "actual"]));
  });

  it("every context's default is one of VIEW_MODES", () => {
    for (const cfg of Object.values(VIEW_MODE_CONTEXTS)) {
      expect(VIEW_MODES).toContain(cfg.default);
    }
  });

  it("every context's allowed list contains its default", () => {
    for (const cfg of Object.values(VIEW_MODE_CONTEXTS)) {
      expect(cfg.allowed).toContain(cfg.default);
    }
  });
});
