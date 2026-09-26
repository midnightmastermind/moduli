// A toolbar filter change carries down to pages that pinned their own value.
import { describe, it, expect } from "vitest";
import { planFollowingPages } from "../helpers/filterFollow";

const mods = { page: { role: "page" }, col: { role: "container" } };
const occ = (id, moduleId, filterOverride) => ({ id, moduleId, filterOverride });

describe("planFollowingPages", () => {
  it("a page pinned to today follows the toolbar to tomorrow", () => {
    const occs = { s: occ("s", "page", { date: "2026-09-26" }) };
    expect(planFollowingPages({ date: "2026-09-27" }, occs, mods)).toEqual([{ id: "s", filterOverride: { date: "2026-09-27" } }]);
  });
  it("keeps the page's other filters", () => {
    const occs = { s: occ("s", "page", { date: "2026-09-26", ctx: "work" }) };
    expect(planFollowingPages({ date: "2026-09-27" }, occs, mods)[0].filterOverride).toEqual({ date: "2026-09-27", ctx: "work" });
  });
  it("leaves inheriting pages, switched-off filters and day columns alone", () => {
    const occs = {
      inherit: occ("inherit", "page", null),
      off: occ("off", "page", { date: null }),
      other: occ("other", "page", { ctx: "work" }),
      col: occ("col", "col", { date: "2026-09-26" }),
      already: occ("already", "page", { date: "2026-09-27" }),
    };
    expect(planFollowingPages({ date: "2026-09-27" }, occs, mods)).toEqual([]);
  });
});
