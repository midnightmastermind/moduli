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

  // The container here is deliberately NOT a wrapGroup: this test is about the
  // walk reaching depth, and a wrapGroup carries its own >=2-member rule (see
  // below), so the old `wrapGroup[paragraph, embed]` fixture was a shape the
  // real schema (`moduleEmbed{2,}`) cannot hold and quietly tested two things.
  it("reaches a NESTED embed, not just a top-level one", () => {
    const tm = doc({ type: "blockquote", content: [para("a"), embed("gone")] });
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

// ── 2026-09-17: the two gaps a real delete walked straight through ──────────
//
// User: *"i went to delete the empty container i just produced by moving the
// sections in the new page article and it leaved an embed: missing element in
// its spot."* The scrub existed and was correct; what was missing was (a) the
// inline link chip's node type, and (b) the wrapper that the removed embed left
// standing empty.
describe("scrubDeletedEmbeds — the inline link chip", () => {
  const chip = (id) => ({ type: "instanceTextblockInline", attrs: { occurrenceId: id } });

  it("removes an inline chip whose occurrence was deleted", () => {
    const tm = doc({ type: "paragraph", content: [{ type: "text", text: "see " }, chip("gone")] });
    const res = scrubDeletedEmbeds(tm, new Set(["gone"]));
    expect(res?.removed).toBe(1);
    expect(res.textmap.content[0].content.map(n => n.type)).toEqual(["text"]);
  });

  // The CONTROL: a chip whose occurrence still exists is never touched. Without
  // this, "removes chips" is also satisfied by a scrub that removes all of them.
  it("leaves a live chip alone", () => {
    const tm = doc({ type: "paragraph", content: [chip("alive")] });
    expect(scrubDeletedEmbeds(tm, new Set(["gone"]))).toBe(null);
  });
});

describe("scrubDeletedEmbeds — a wrap group emptied by the scrub", () => {
  const group = (...content) => ({ type: "wrapGroup", content });

  it("drops a wrap group whose only members were deleted", () => {
    const tm = doc(para("before"), group(embed("a"), embed("b")), para("after"));
    const res = scrubDeletedEmbeds(tm, new Set(["a", "b"]));
    expect(res.removed).toBe(2);
    expect(res.textmap.content.map(n => n.type)).toEqual(["paragraph", "paragraph"]);
  });

  // INVERTED 2026-09-17, and the old expectation is the bug it pinned: it
  // asserted the scrub leaves a ONE-child wrapGroup. `wrapGroup` content is
  // `moduleEmbed{2,}`, so that document is invalid, and ProseMirror repairs it
  // on load by inserting a default `moduleEmbed` — occurrenceId `""` — which
  // paints `embed: missing` forever and names no id any scrub can match.
  // The survivor is kept; what goes is the group that can no longer hold it.
  it("FLATTENS a wrap group left with a single member", () => {
    const tm = doc(group(embed("a"), embed("b")));
    const res = scrubDeletedEmbeds(tm, new Set(["a"]));
    expect(res.removed).toBe(1);
    expect(res.textmap.content[0].type).toBe("moduleEmbed");
    expect(res.textmap.content[0].attrs.occurrenceId).toBe("b");
  });

  // A group that was ALREADY empty is not this scrub's business — it is dropped
  // only when this pass is what emptied it, so nothing else can be swept here.
  it("leaves an already-empty group alone", () => {
    const tm = doc(group(), embed("gone"));
    const res = scrubDeletedEmbeds(tm, new Set(["gone"]));
    expect(res.removed).toBe(1);
    expect(res.textmap.content.map(n => n.type)).toEqual(["wrapGroup"]);
  });
});

// ── A WRAP GROUP LEFT WITH ONE MEMBER IS INVALID, AND THE REPAIR IS WORSE ────
//
// `wrapGroup` content is `moduleEmbed{2,}` (client/src/docs/WrapGroupExtension.js).
// The scrub handled the group dropping to ZERO and not to ONE — and a one-child
// group is not a group ProseMirror will accept, so on the next load its schema
// repair FILLS the missing required node with a default `moduleEmbed`, whose
// `occurrenceId` default is `""`. That renders as `embed: missing` forever, and
// no later scrub can ever match it because it names no id.
//
// Measured on poms grid 2026-09-17 — the Alan Watts article page carried exactly
// that shape: wrapGroup[ moduleEmbed(e027b531…), moduleEmbed("") ].
//
// The client has had the right rule since the wrap work: `detachGroupMember`
// keeps the group at >=2 and otherwise "flattens to plain sibling embeds". The
// server's scrub is its twin and never learned it.
describe("scrubDeletedEmbeds — a wrap group the scrub shrinks below two", () => {
  const group = (...ids) => ({
    type: "wrapGroup",
    attrs: { side: "left", anchor: "top" },
    content: ids.map((occurrenceId) => ({ type: "moduleEmbed", attrs: { occurrenceId } })),
  });
  const doc = (...content) => ({ type: "doc", content });

  it("one survivor is FLATTENED into the parent, never left in a 1-child group", () => {
    const res = scrubDeletedEmbeds(doc(group("keep", "gone"), { type: "paragraph" }), new Set(["gone"]));
    expect(res).not.toBeNull();
    // The survivor is still in the document — dropping the group wholesale
    // would delete an embed the user never deleted.
    expect(res.textmap.content[0]).toEqual({ type: "moduleEmbed", attrs: { occurrenceId: "keep" } });
    expect(res.textmap.content[1]).toEqual({ type: "paragraph" });
  });

  it("the flattened output contains NO wrapGroup and no empty-id embed", () => {
    const res = scrubDeletedEmbeds(doc(group("keep", "gone")), new Set(["gone"]));
    const seen = [];
    const walk = (n) => { if (!n) return; seen.push(n.type); (n.content || []).forEach(walk); };
    walk(res.textmap);
    expect(seen).not.toContain("wrapGroup");
    expect(JSON.stringify(res.textmap)).not.toContain('"occurrenceId":""');
  });

  it("two survivors KEEP the group, attributes intact", () => {
    const res = scrubDeletedEmbeds(doc(group("a", "b", "gone")), new Set(["gone"]));
    expect(res.textmap.content[0].type).toBe("wrapGroup");
    expect(res.textmap.content[0].attrs).toEqual({ side: "left", anchor: "top" });
    expect(res.textmap.content[0].content).toHaveLength(2);
  });

  it("every member deleted still removes the group entirely", () => {
    const res = scrubDeletedEmbeds(doc(group("x", "y"), { type: "paragraph" }), new Set(["x", "y"]));
    expect(res.textmap.content).toEqual([{ type: "paragraph" }]);
  });

  // THE CONTROL. Without it, "a short group is flattened" is also satisfied by a
  // scrub that dissolves every wrap group it walks past.
  it("a group the scrub did not touch is left exactly as it was", () => {
    const before = doc(group("a", "b"), { type: "moduleEmbed", attrs: { occurrenceId: "gone" } });
    const res = scrubDeletedEmbeds(before, new Set(["gone"]));
    expect(res.textmap.content[0]).toEqual(group("a", "b"));
  });
});
