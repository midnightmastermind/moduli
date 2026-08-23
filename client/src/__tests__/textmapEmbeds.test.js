// The THIRD reachability path: a doc draws its TEXTMAP, and those nodes name
// other occurrences. `PagePreviewApp` walked `occurrences[]` and `parentId` and
// stopped, so a text-heavy page's preview card was full of `embed: <uuid>`
// placeholders while the page itself rendered fine — 474 embeds across 233 hosts
// on the live grid are reachable ONLY this way.
import { describe, it, expect } from "vitest";
import { collectEmbeddedIds, expandByEmbeds } from "../helpers/textmapEmbeds";

const doc = (...content) => ({ type: "doc", content });
const embed = (id) => ({ type: "moduleEmbed", attrs: { occurrenceId: id } });
const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });

describe("collectEmbeddedIds", () => {
  it("finds a top-level embed", () => {
    expect([...collectEmbeddedIds(doc(embed("a")))]).toEqual(["a"]);
  });

  it("finds NESTED embeds — a blockquote or list item holds them too", () => {
    const tm = doc({ type: "blockquote", content: [embed("a"), para("x")] }, embed("b"));
    expect([...collectEmbeddedIds(tm)].sort()).toEqual(["a", "b"]);
  });

  it("reads both `occurrenceId` and `id`, and the textblock node types", () => {
    const tm = doc({ type: "instanceTextblock", attrs: { id: "t1" } },
                   { type: "instanceTextblockInline", attrs: { occurrenceId: "t2" } });
    expect([...collectEmbeddedIds(tm)].sort()).toEqual(["t1", "t2"]);
  });

  it("returns nothing for a COMPRESSED textmap rather than throwing", () => {
    // Raw Mongo stores textmaps compressed; a consumer that receives one must
    // not explode inside a render.
    expect(collectEmbeddedIds("H4sIAAAA...").size).toBe(0);
    expect(collectEmbeddedIds(null).size).toBe(0);
    expect(collectEmbeddedIds(undefined).size).toBe(0);
  });

  it("ignores a non-embed node that happens to carry an id", () => {
    expect(collectEmbeddedIds(doc({ type: "image", attrs: { id: "img" } })).size).toBe(0);
  });

  it("survives a cyclic-looking structure without hanging", () => {
    const deep = { type: "doc", content: [] };
    let cur = deep;
    for (let i = 0; i < 200; i++) { const n = { type: "div", content: [] }; cur.content.push(n); cur = n; }
    cur.content.push(embed("deep"));
    expect(() => collectEmbeddedIds(deep)).not.toThrow();
  });
});

describe("expandByEmbeds", () => {
  const occ = (id, tm) => ({ id, textmap: tm });
  const index = (...list) => Object.fromEntries(list.map((o) => [o.id, o]));

  it("adds what a seen occurrence DRAWS", () => {
    const by = index(occ("host", doc(embed("kid"))), occ("kid", null));
    expect([...expandByEmbeds(new Set(["host"]), by)].sort()).toEqual(["host", "kid"]);
  });

  it("is TRANSITIVE — an embedded doc can embed further docs", () => {
    const by = index(occ("a", doc(embed("b"))), occ("b", doc(embed("c"))), occ("c", null));
    expect([...expandByEmbeds(new Set(["a"]), by)].sort()).toEqual(["a", "b", "c"]);
  });

  it("does NOT add an id that resolves to nothing", () => {
    // A dangling embed (the `0205` class) must leave the node undrawn, not put a
    // phantom id into a set the module lookup then misses on.
    const by = index(occ("a", doc(embed("gone"))));
    expect([...expandByEmbeds(new Set(["a"]), by)]).toEqual(["a"]);
  });

  it("terminates on a CYCLE — two docs embedding each other", () => {
    const by = index(occ("a", doc(embed("b"))), occ("b", doc(embed("a"))));
    expect([...expandByEmbeds(new Set(["a"]), by)].sort()).toEqual(["a", "b"]);
  });

  it("leaves a set with no embeds untouched", () => {
    const by = index(occ("a", doc(para("just words"))));
    expect([...expandByEmbeds(new Set(["a"]), by)]).toEqual(["a"]);
  });
});
