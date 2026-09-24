import { describe, it, expect } from "vitest";
import {
  shareRulesFrom, freeShareTypes, newShareRule, haltsChain, setHaltsChain,
  markUserEdited, recentShares, sharePropsFor, CATCH_ALL,
} from "../helpers/shareRulesUi";

const rule = (id, shareType, priority, extra = {}) => ({
  id, gridId: "g1", priority, triggerObjects: [{ eventType: "onShare", shareType }], ...extra,
});

describe("shareRulesFrom", () => {
  it("lists only this grid's onShare operations, typed by priority, catch-all last", () => {
    const ops = [
      rule("c", CATCH_ALL, 0), rule("b", "link", 20), rule("a", "ics", 5),
      { id: "x", gridId: "g1", triggerObjects: [{ eventType: "onLoad" }] },
      rule("other-grid", "link", 1, { gridId: "g2" }),
    ];
    expect(shareRulesFrom(ops, "g1").map(o => o.id)).toEqual(["a", "b", "c"]);
  });
});

describe("one rule per type (D8)", () => {
  it("does not offer a type that already has a rule", () => {
    const free = freeShareTypes([rule("l", "link", 1), rule("c", CATCH_ALL, 99)]).map(t => t.id);
    expect(free).not.toContain("link");
    expect(free).toContain("ics");
  });
});

describe("newShareRule", () => {
  it("is an onShare operation with NO steps — the user writes them (D18/D19)", () => {
    const r = newShareRule({ id: "n", gridId: "g1", shareType: "link" });
    expect(r.triggerObjects).toEqual([{ eventType: "onShare", shareType: "link" }]);
    expect(r.pipeline.steps).toEqual([]);
    expect(r.name).toBe("Share: link");
  });
});

describe("the halt checkbox (D9)", () => {
  it("adds ONE SET_VAR $share.handled step, and removes it again", () => {
    const on = setHaltsChain({ steps: [{ id: "s1" }] }, true, "h1");
    expect(haltsChain(on)).toBe(true);
    expect(on.steps.at(-1).config).toEqual({ type: "SET_VAR", name: "$share.handled", value: "true" });
    const twice = setHaltsChain(on, true, "h2");
    expect(twice.steps.filter(s => s.config?.name === "$share.handled")).toHaveLength(1);
    const off = setHaltsChain(on, false);
    expect(haltsChain(off)).toBe(false);
    expect(off.steps).toEqual([{ id: "s1" }]);
  });
});

describe("saving", () => {
  it("marks the rule user-edited so the catch-all upgrade never overwrites it", () => {
    expect(markUserEdited({ id: "c", meta: { catchAllVersion: 2 } }).meta)
      .toEqual({ catchAllVersion: 2, userEdited: true });
  });
});

describe("recentShares", () => {
  it("is newest first", () => {
    expect(recentShares({ shareLog: [{ at: "1" }, { at: "2" }] }).map(e => e.at)).toEqual(["2", "1"]);
    expect(recentShares(null)).toEqual([]);
  });
});

describe("sharePropsFor", () => {
  it("offers the common props plus the type's own", () => {
    expect(sharePropsFor("link")).toContain("$share.props.url");
    expect(sharePropsFor("link")).toContain("$share.label");
  });
});
