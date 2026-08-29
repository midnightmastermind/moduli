// resolveExpr is the hot path of the pipeline language, and it checked the
// RARE shapes first.
//
// A source-mapped CPU profile of the prod load sweep put it at 598ms of self
// time — the largest app frame in the profile, roughly a quarter of the
// ~2,270ms op sweep. Every call ran eight `startsWith` probes and an `includes`
// before reaching whatever it actually was. Counted across poms grid's own
// enabled pipelines (9,991 strings): 7,018 plain literals, 2,869 $paths, and 104
// of everything else — so the two shapes that are 99% of the traffic were the
// two paying the most.
//
// The change is pure reordering. These tests exist to prove that: every shape
// must resolve exactly as it did, and the two the fast path handles must not
// swallow the cases that merely LOOK like them.
import { describe, it, expect } from "vitest";
import { resolveExpr } from "../helpers/operationActions";

const $vars = {
  $item: { id: "i1", fields: { water: { value: 16, flow: "in" } }, label: "Drink" },
  $today: "2026-08-29",
  $childId: "c9",
  $allItemsById: { c9: { id: "c9", label: "Child" } },
  $n: 0,
  $falsy: false,
  _occurrencesById: { o1: { id: "o1", fields: { f1: { value: 7, flow: "out" } } } },
};

describe("the fast paths resolve what they always did", () => {
  it("a $path walks to any depth", () => {
    expect(resolveExpr("$item.fields.water.value", $vars)).toBe(16);
    expect(resolveExpr("$item.label", $vars)).toBe("Drink");
    expect(resolveExpr("$item", $vars)).toEqual($vars.$item);
  });

  it("a plain literal comes back unchanged", () => {
    for (const s of ["Drink Water", "Monday", "some label", "a-b-c"]) {
      expect(resolveExpr(s, $vars)).toBe(s);
    }
  });

  it("a literal containing a COLON is still a literal", () => {
    // The fast path bails on any colon, so these fall through to the prefix
    // checks exactly as before and match none of them. A time label is the real
    // case: this grid is full of "9:00am".
    for (const s of ["9:00am", "Note: read this", "http://example.com"]) {
      expect(resolveExpr(s, $vars)).toBe(s);
    }
  });

  it("an unknown $var is null, not the string", () => {
    expect(resolveExpr("$nope.deep.path", $vars)).toBeNull();
    expect(resolveExpr("$item.fields.missing.value", $vars)).toBeNull();
  });

  it("falsy values survive the walk", () => {
    // `cur ?? null` — 0 and false must come back, not be nulled.
    expect(resolveExpr("$n", $vars)).toBe(0);
    expect(resolveExpr("$falsy", $vars)).toBe(false);
  });
});

describe("the memoised path split", () => {
  it("gives the same answer on a repeat call — the parts array is shared", () => {
    // `partsOf` hands the SAME array back for a repeated expression and the
    // walk only reads it. If anything ever mutated it, the second call would
    // diverge, and every op in the sweep uses these strings thousands of times.
    for (let i = 0; i < 3; i++) {
      expect(resolveExpr("$item.fields.water.value", $vars)).toBe(16);
      expect(resolveExpr("$item.label", $vars)).toBe("Drink");
    }
  });

  it("stays correct once the bound is crossed and the cache is cleared", () => {
    // `${}` substitution can mint new expression strings at run time, so the
    // cache is bounded. Crossing that bound must lose speed, never accuracy.
    for (let i = 0; i < 5200; i++) resolveExpr(`$nope${i}.x`, $vars);
    expect(resolveExpr("$item.fields.water.value", $vars)).toBe(16);
    expect(resolveExpr("$item.label", $vars)).toBe("Drink");
  });
});

describe("the shapes the fast path must NOT swallow", () => {
  it("a $-string containing ${} is an INTERPOLATION, not a path", () => {
    // The discriminating case for the whole change: interpolation is checked
    // before the path walk, and "$allItemsById.${$childId}" must resolve
    // through the substitution to the OBJECT, never be walked literally.
    expect(resolveExpr("$allItemsById.${$childId}", $vars)).toEqual({ id: "c9", label: "Child" });
  });

  it("a non-$ interpolation still substitutes", () => {
    expect(resolveExpr("daypage ${$today}", $vars)).toBe("daypage 2026-08-29");
  });

  it("literal: still coerces its scalars", () => {
    expect(resolveExpr("literal:true", $vars)).toBe(true);
    expect(resolveExpr("literal:false", $vars)).toBe(false);
    expect(resolveExpr("literal:null", $vars)).toBeNull();
    expect(resolveExpr("literal:42", $vars)).toBe(42);
    expect(resolveExpr("literal:-3.5", $vars)).toBe(-3.5);
    expect(resolveExpr("literal:hello", $vars)).toBe("hello");
  });

  it("json:, occ:, field:, weekday:, dateLong:, daysUntil: all still route", () => {
    expect(resolveExpr('json:[1,2]', $vars)).toEqual([1, 2]);
    expect(resolveExpr("occ:o1.f1.value", $vars)).toBe(7);
    expect(resolveExpr("occ:o1.f1.flow", $vars)).toBe("out");
    expect(resolveExpr("field:f1.value", $vars)).toBe(7);
    expect(resolveExpr("weekday:$today", $vars)).toBe("Saturday");
    expect(resolveExpr("dateLong:$today", $vars)).toBe("Saturday, August 29th, 2026");
    expect(typeof resolveExpr("daysUntil:$today", $vars)).toBe("number");
  });

  it("non-strings and the __ref sentinel are untouched", () => {
    expect(resolveExpr(42, $vars)).toBe(42);
    expect(resolveExpr(false, $vars)).toBe(false);
    expect(resolveExpr(null, $vars)).toBeNull();
    expect(resolveExpr("", $vars)).toBeNull();
    expect(resolveExpr({ __ref: "$item.label" }, $vars)).toBe("Drink");
    expect(resolveExpr({ __ref: "" }, $vars)).toBeNull();
  });
});
