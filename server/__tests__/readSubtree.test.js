import { describe, it, expect } from "vitest";
import { walkSubtree, embeddedIds } from "../services/readSubtree.js";

const mk = (rows) => {
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  return {
    load: async (ids) => ids.map((id) => byId[id]).filter(Boolean),
    kidsOf: async (ids) => rows.filter((r) => ids.includes(r.parentId)),
  };
};
const doc = (...ids) => ({ type: "doc", content: ids.map((id) => ({ type: "moduleEmbed", attrs: { occurrenceId: id } })) });

describe("walkSubtree", () => {
  it("reaches what a node lists, what is parented to it, and what its body embeds — and nothing else", async () => {
    const rows = [
      { id: "page", occurrences: ["doc"] },
      { id: "doc", parentId: "page", textmap: doc("pic") },
      { id: "pic" },                              // reachable only through the textmap
      { id: "note", parentId: "doc" },            // reachable only through parentId
      { id: "other", parentId: "elsewhere" },     // not part of this page
    ];
    const { occurrences, truncated } = await walkSubtree(rows[0], mk(rows));
    expect(occurrences.map((o) => o.id).sort()).toEqual(["doc", "note", "page", "pic"]);
    expect(truncated).toBe(false);
  });

  it("stops at the cap and says so", async () => {
    const rows = [{ id: "r", occurrences: ["a", "b", "c"] }, { id: "a" }, { id: "b" }, { id: "c" }];
    const out = await walkSubtree(rows[0], { ...mk(rows), cap: 2 });
    expect(out.occurrences).toHaveLength(2);
    expect(out.truncated).toBe(true);
  });

  it("a compressed textmap names nothing (it is not walked as a doc)", () => {
    expect(embeddedIds("H4sIAAAA")).toEqual([]);
    expect(embeddedIds(doc("x"))).toEqual(["x"]);
  });
});
