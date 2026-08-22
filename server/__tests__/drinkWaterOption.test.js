import { describe, it, expect } from "vitest";
import { resolveOption } from "../migrations/0187-drink-water-on-the-meals-layer.mjs";

// The real Beverage field's stored predicate.
const BEV = { meta: { optionsSource: { predicate: { rules: [
  { left: "fields.uew6sn6WWXin.value", comparator: "CONTAINS", right: "beverage" },
  { left: "meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
] } } } };
const nameOf = (o) => o?.label ?? "(?)";

// All three real occurrences labelled "Water" on poms grid.
const boardWater  = { id: "QYYO61oFcf33", label: "Water", fields: { uew6sn6WWXin: { value: ["beverage"] } }, meta: {} };
const trackerTile = { id: "AYYLDkB3Lx-4", label: "Water", fields: {}, meta: {} };
const utilityBill = { id: "FUPj-giikvbm", label: "Water", fields: { uew6sn6WWXin: { value: ["bill"] } }, meta: {} };
const feedCopy    = { id: "copy-1", label: "Water", fields: { uew6sn6WWXin: { value: ["beverage"] } }, meta: { feedSourceId: "QYYO61oFcf33" } };

describe("0187 — Water is resolved by the field's predicate, never by its label", () => {
  it("picks the board row and ignores the tracker tile and the utility BILL", () => {
    const { hits } = resolveOption(BEV, [boardWater, trackerTile, utilityBill], "Water", nameOf);
    expect(hits.map((h) => h.id)).toEqual(["QYYO61oFcf33"]);
  });

  it("excludes a FEED COPY — the 0114 trap: a copy's id dies at the next sync", () => {
    const { hits } = resolveOption(BEV, [boardWater, feedCopy], "Water", nameOf);
    expect(hits.map((h) => h.id)).toEqual(["QYYO61oFcf33"]);
  });

  it("returns nothing when no option carries the tag — the migration then refuses", () => {
    const { hits } = resolveOption(BEV, [trackerTile, utilityBill], "Water", nameOf);
    expect(hits).toEqual([]);
  });

  it("returns SEVERAL when the grid is ambiguous, so the caller can refuse rather than pick", () => {
    const twin = { ...boardWater, id: "twin" };
    const { hits } = resolveOption(BEV, [boardWater, twin], "Water", nameOf);
    expect(hits).toHaveLength(2);
  });

  it("refuses a field carrying no options predicate at all", () => {
    const { hits, why } = resolveOption({}, [boardWater], "Water", nameOf);
    expect(hits).toEqual([]);
    expect(why).toMatch(/no options predicate/);
  });

  it("matches a SCALAR tag as well as an array — CONTAINS is used both ways on this grid", () => {
    const scalar = { id: "s", label: "Water", fields: { uew6sn6WWXin: { value: "beverage" } }, meta: {} };
    expect(resolveOption(BEV, [scalar], "Water", nameOf).hits.map((h) => h.id)).toEqual(["s"]);
  });
});
