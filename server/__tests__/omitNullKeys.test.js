// Stripping absent values off the wire must be invisible to every reader.
import { describe, it, expect } from "vitest";
import { omitNullKeys, omitNullKeysAll } from "../utils/omitNullKeys.js";

describe("omitNullKeys", () => {
  it("drops null and undefined and keeps everything else", () => {
    expect(omitNullKeys({ id: "a", label: null, sortOrder: 0, x: undefined, ok: false }))
      .toEqual({ id: "a", sortOrder: 0, ok: false });
  });

  it("KEEPS empty arrays and objects — absent is not empty for these readers", () => {
    // `dragHitTesting` does `targetOcc.occurrences.length` with no guard, and it
    // sits in the drop path. Dropping `[]` would save ~2.5MB and throw there.
    const row = { id: "a", occurrences: [], fields: {}, meta: {} };
    expect(omitNullKeys(row)).toEqual(row);
  });

  it("keeps falsy values that are real — 0, false, empty string", () => {
    // The bug this guards: `if (!v) continue` would silently drop sortOrder 0.
    expect(omitNullKeys({ sortOrder: 0, hidden: false, label: "" }))
      .toEqual({ sortOrder: 0, hidden: false, label: "" });
  });

  it("does not reach into nested values", () => {
    // A null INSIDE a stored object is part of a value someone chose; only the
    // top level is wire padding.
    const row = { id: "a", meta: { cover: null, x: 1 } };
    expect(omitNullKeys(row)).toEqual(row);
  });

  it("names no role, kind or key — it is a fact about the VALUE", () => {
    // A key list would be one schema change from shipping the padding again.
    const src = readFileSync(new URL("../utils/omitNullKeys.js", import.meta.url), "utf8");
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const domain of ["artifact", "identitySignature", "ownStyle", "filterNavConfig", "media"]) {
      expect(code).not.toContain(domain);
    }
  });

  it("passes non-objects through untouched", () => {
    expect(omitNullKeys(null)).toBe(null);
    expect(omitNullKeys("x")).toBe("x");
    expect(omitNullKeysAll("nope")).toBe("nope");
    expect(omitNullKeysAll([{ a: null, b: 1 }])).toEqual([{ b: 1 }]);
  });
});

import { readFileSync } from "node:fs";
