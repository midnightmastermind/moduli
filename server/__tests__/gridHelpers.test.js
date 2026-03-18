// server/__tests__/gridHelpers.test.js
import { describe, it, expect } from "vitest";
import { selectGrid } from "../utils/gridHelpers.js";

describe("selectGrid", () => {
  // ── No requestedId ──────────────────────────────────────────
  it("no gridId + existing grids → use first existing", () => {
    const result = selectGrid(["abc", "def"], null);
    expect(result).toEqual({ gridId: "abc", action: "use" });
  });

  it("no gridId + no grids → create", () => {
    const result = selectGrid([], null);
    expect(result).toEqual({ gridId: null, action: "create" });
  });

  it("no gridId + undefined → use first existing", () => {
    const result = selectGrid(["abc"], undefined);
    expect(result).toEqual({ gridId: "abc", action: "use" });
  });

  // ── requestedId present ─────────────────────────────────────
  it("valid gridId + exists → use it", () => {
    const result = selectGrid(["abc", "def"], "def");
    expect(result).toEqual({ gridId: "def", action: "use" });
  });

  it("stale gridId + existing grids → fallback to first", () => {
    const result = selectGrid(["abc", "def"], "stale-id");
    expect(result).toEqual({ gridId: "abc", action: "fallback" });
  });

  it("stale gridId + no grids → create", () => {
    const result = selectGrid([], "stale-id");
    expect(result).toEqual({ gridId: null, action: "create" });
  });

  // ── Edge cases ───────────────────────────────────────────────
  it("single grid + exact match → use it", () => {
    const result = selectGrid(["only-one"], "only-one");
    expect(result).toEqual({ gridId: "only-one", action: "use" });
  });

  it("empty string requestedId treated as falsy → use first", () => {
    const result = selectGrid(["abc"], "");
    expect(result).toEqual({ gridId: "abc", action: "use" });
  });
});
