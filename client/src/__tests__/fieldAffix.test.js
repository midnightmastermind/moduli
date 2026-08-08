// Per-row prefix/postfix.
//
// The load-bearing cases are the ones about NOT losing things: a pick of ""
// must survive (it is how a row says "no unit"), and writing one per-row key
// must not drop the others — which is exactly the bug handleFlowChange had.
import { describe, it, expect } from "vitest";
import {
  affixOptions, hasAffixChoice, resolveAffix, affixMenu, withAffix,
} from "../helpers/fieldAffix";

const field = (meta) => ({ id: "f1", meta });

describe("what a field offers", () => {
  it("reads the option list and keeps the AUTHOR'S order", () => {
    // Sorting would silently reorder someone's menu.
    const f = field({ postfixOptions: ["kg", "g", "ml"] });
    expect(affixOptions(f, "postfix")).toEqual(["kg", "g", "ml"]);
  });

  it("drops blanks and duplicates", () => {
    const f = field({ postfixOptions: ["kg", "", "  ", "kg", " g "] });
    expect(affixOptions(f, "postfix")).toEqual(["kg", "g"]);
  });

  it("is empty when the field offers nothing — today's behaviour", () => {
    expect(affixOptions(field({ postfix: "oz" }), "postfix")).toEqual([]);
    expect(affixOptions(field({}), "prefix")).toEqual([]);
    expect(affixOptions(null, "prefix")).toEqual([]);
    expect(hasAffixChoice(field({ prefix: "$" }), "prefix")).toBe(false);
  });
});

describe("which affix a row shows", () => {
  const f = field({ postfix: "oz", postfixOptions: ["kg", "g"] });

  it("prefers the row's pick over the field default", () => {
    expect(resolveAffix(f, { value: 2, postfix: "kg" }, "postfix")).toBe("kg");
  });

  it("falls back to the field default when the row has not picked", () => {
    expect(resolveAffix(f, { value: 2 }, "postfix")).toBe("oz");
    expect(resolveAffix(f, null, "postfix")).toBe("oz");
  });

  it('PRESERVES a pick of "" — that is a row saying "no unit here"', () => {
    // The discriminating case. A truthiness check would fall through to the
    // field default and make it impossible to clear the affix on one row.
    expect(resolveAffix(f, { value: 2, postfix: "" }, "postfix")).toBe("");
  });

  it("returns nothing when neither a pick nor a default exists", () => {
    expect(resolveAffix(field({}), { value: 1 }, "prefix")).toBe("");
  });
});

describe("the menu offered on a row", () => {
  it("always offers an explicit none", () => {
    const f = field({ postfixOptions: ["kg", "g"] });
    expect(affixMenu(f, null, "postfix")[0]).toBe("");
  });

  it("includes the field default even when it is not in the option list", () => {
    // Otherwise a field defaulting to $ with options [kg,g] offers no way back.
    const f = field({ prefix: "$", prefixOptions: ["€", "£"] });
    expect(affixMenu(f, null, "prefix")).toContain("$");
  });

  it("includes a pick the author has since REMOVED from the list", () => {
    // The row would otherwise display a value it cannot reselect.
    const f = field({ postfixOptions: ["kg", "g"] });
    expect(affixMenu(f, { value: 1, postfix: "lb" }, "postfix")).toContain("lb");
  });

  it("is empty when the field offers no choice — no picker renders", () => {
    expect(affixMenu(field({ postfix: "oz" }), null, "postfix")).toEqual([]);
  });
});

describe("writing a pick", () => {
  it("PRESERVES every other per-row key", () => {
    // The bug this guards: handleFlowChange rebuilt the object as
    // { value, flow } and silently dropped the display flags.
    const stored = { value: 5, flow: "out", hideName: true, hidePrefix: true, timestamp: "t" };
    const next = withAffix(stored, "postfix", "kg");
    expect(next).toEqual({ ...stored, postfix: "kg" });
  });

  it("clears the pick with null, so the field default applies again", () => {
    const next = withAffix({ value: 5, postfix: "kg" }, "postfix", null);
    expect("postfix" in next).toBe(false);
    expect(next.value).toBe(5);
  });

  it('distinguishes clearing (null) from pinning "no affix" ("")', () => {
    const f = field({ postfix: "oz", postfixOptions: ["kg"] });
    const cleared = withAffix({ value: 1, postfix: "kg" }, "postfix", null);
    const pinned = withAffix({ value: 1, postfix: "kg" }, "postfix", "");
    expect(resolveAffix(f, cleared, "postfix")).toBe("oz");  // default returns
    expect(resolveAffix(f, pinned, "postfix")).toBe("");     // stays blank
  });

  it("copes with a bare scalar that was never an object", () => {
    expect(withAffix(7, "postfix", "kg")).toEqual({ value: 7, postfix: "kg" });
    expect(withAffix(undefined, "prefix", "$")).toEqual({ value: null, prefix: "$" });
  });
});
