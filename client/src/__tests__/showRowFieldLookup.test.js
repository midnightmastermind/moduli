// A Play button asks "is this a show?" on every tile render, and that searched every field on the grid each time.
import { describe, it, expect } from "vitest";
import { isShowOrSeasonRow } from "../helpers/nextUnwatched";

const row = (v) => ({ meta: { jellyfinId: "j" }, fields: { bc: { value: v } } });
const counting = () => {
  let reads = 0;
  const target = { bc: { id: "bc", name: "Board Category", type: "select" }, x: { id: "x", name: "Other", type: "text" } };
  const map = new Proxy(target, { ownKeys(t) { reads++; return Reflect.ownKeys(t); } });
  return { map, reads: () => reads };
};

describe("isShowOrSeasonRow", () => {
  it("answers as before", () => {
    const f = { bc: { id: "bc", name: "Board Category", type: "select" } };
    expect(isShowOrSeasonRow(row(["series"]), f)).toBe(true);
    expect(isShowOrSeasonRow(row("season"), f)).toBe(true);
    expect(isShowOrSeasonRow(row(["movie"]), f)).toBe(false);
    expect(isShowOrSeasonRow({ meta: {}, fields: {} }, f)).toBe(false);
    expect(isShowOrSeasonRow(row(["series"]), {})).toBe(false);
  });
  it("searches one field map once, however many tiles ask", () => {
    const c = counting();
    for (let i = 0; i < 50; i++) isShowOrSeasonRow(row(["movie"]), c.map);
    expect(c.reads()).toBe(1);
  });
  it("a new field map is searched again", () => {
    const a = { bc: { id: "bc", name: "Board Category", type: "select" } };
    const b = { other: { id: "other", name: "Board Category", type: "select" } };
    expect(isShowOrSeasonRow(row(["series"]), a)).toBe(true);
    expect(isShowOrSeasonRow({ meta: { jellyfinId: "j" }, fields: { other: { value: ["series"] } } }, b)).toBe(true);
  });
});
