// __tests__/scrubDeletedEmbeds.test.js
//
// A doc renders its textmap, so an embed pointing at a deleted occurrence paints
// as raw junk. The risk here is entirely WHICH nodes go: CLAUDE.md 2026-08-01
// (19) records a dangling-embed scrub that WAS the regression, because it
// removed the only node rendering a surviving sibling. This one is handed the
// exact ids a delete just removed, so these tests are about it removing those
// and NOTHING else.
import { describe, it, expect } from "vitest";
import { scrubDeletedEmbeds, occurrencesEmbedding } from "../utils/scrubEmbeds.js";

const doc = (...content) => ({ type: "doc", content });
const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const embed = (id) => ({ type: "moduleEmbed", attrs: { occurrenceId: id } });

describe("scrubDeletedEmbeds", () => {
  it("removes an embed pointing at a deleted occurrence", () => {
    const res = scrubDeletedEmbeds(doc(para("before"), embed("gone"), para("after")), new Set(["gone"]));
    expect(res.removed).toBe(1);
    expect(res.textmap.content.map(n => n.type)).toEqual(["paragraph", "paragraph"]);
  });

  it("leaves an embed whose target SURVIVES — the 2026-08-01 regression", () => {
    const tm = doc(embed("alive"));
    expect(scrubDeletedEmbeds(tm, new Set(["gone"]))).toBeNull();
  });

  it("returns null when nothing matched, so the caller skips the write", () => {
    expect(scrubDeletedEmbeds(doc(para("x")), new Set(["gone"]))).toBeNull();
    expect(scrubDeletedEmbeds(null, new Set(["gone"]))).toBeNull();
    expect(scrubDeletedEmbeds(doc(embed("gone")), new Set())).toBeNull();
  });

  it("reaches a NESTED embed, not just a top-level one", () => {
    const tm = doc({ type: "wrapGroup", content: [para("a"), embed("gone")] });
    const res = scrubDeletedEmbeds(tm, new Set(["gone"]));
    expect(res.removed).toBe(1);
    expect(res.textmap.content[0].content.map(n => n.type)).toEqual(["paragraph"]);
  });

  it("covers the inline textblock node too, by its instanceId", () => {
    const tm = doc({ type: "paragraph", content: [
      { type: "text", text: "a" },
      { type: "instanceTextblock", attrs: { instanceId: "gone" } },
    ]});
    const res = scrubDeletedEmbeds(tm, new Set(["gone"]));
    expect(res.removed).toBe(1);
  });

  it("keeps the surrounding prose untouched", () => {
    const res = scrubDeletedEmbeds(doc(para("keep me"), embed("gone")), new Set(["gone"]));
    expect(res.textmap.content[0].content[0].text).toBe("keep me");
  });
});

describe("occurrencesEmbedding", () => {
  it("finds only the occurrences that actually embed a deleted id", () => {
    const map = {
      a: { id: "a", textmap: doc(embed("gone")) },
      b: { id: "b", textmap: doc(para("no embeds")) },
      c: { id: "c", textmap: doc(embed("alive")) },
      d: { id: "d" },                                    // no textmap at all
    };
    const hits = occurrencesEmbedding(map, new Set(["gone"]));
    expect(hits.map(h => h.occ.id)).toEqual(["a"]);
  });

  it("returns nothing for an empty delete set — the common case", () => {
    expect(occurrencesEmbedding({ a: { id: "a", textmap: doc(embed("x")) } }, new Set())).toEqual([]);
  });
});
