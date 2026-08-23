// 0205's predicate. The danger here is documented and specific: CLAUDE.md
// 2026-08-01 (19) records a scrub of this exact shape CAUSING the regression it
// was written to fix, by removing the one embed that was rendering a surviving
// sibling. These cases are that lesson.
import { describe, it, expect } from "vitest";
import { stripDeadEmbeds } from "../migrations/0205-scrub-dead-embeds.mjs";

const embed = (id) => ({ type: "moduleEmbed", attrs: { occurrenceId: id } });
const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const doc = (...content) => ({ type: "doc", content });

describe("stripDeadEmbeds", () => {
  it("removes an embed whose target is gone", () => {
    const { next, removed } = stripDeadEmbeds(doc(embed("dead")), new Set());
    expect(removed).toEqual(["dead"]);
    expect(next.content).toHaveLength(0);
  });

  it("KEEPS an embed whose target is alive", () => {
    // The whole safety of this migration is that the predicate is "points at
    // nothing", never "looks stale".
    const { next, kept } = stripDeadEmbeds(doc(embed("alive")), new Set(["alive"]));
    expect(kept).toEqual(["alive"]);
    expect(next).toBeNull();          // nothing changed, so nothing is written
  });

  it("returns null when there is nothing to do — a no-op writes no textmap", () => {
    expect(stripDeadEmbeds(doc(para("hello")), new Set()).next).toBeNull();
  });

  it("keeps the live embeds AROUND a dead one, and the prose", () => {
    const { next, removed, kept } = stripDeadEmbeds(
      doc(para("before"), embed("a"), embed("dead"), embed("b"), para("after")),
      new Set(["a", "b"]),
    );
    expect(removed).toEqual(["dead"]);
    expect(kept).toEqual(["a", "b"]);
    expect(next.content.map(n => n.type)).toEqual(["paragraph", "moduleEmbed", "moduleEmbed", "paragraph"]);
    expect(next.content[0].content[0].text).toBe("before");
  });

  it("reaches a NESTED embed", () => {
    // Embeds sit inside list items and blockquotes, not only at the top level.
    const nested = doc({ type: "blockquote", content: [embed("dead"), para("keep")] });
    const { next, removed } = stripDeadEmbeds(nested, new Set());
    expect(removed).toEqual(["dead"]);
    expect(next.content[0].content.map(n => n.type)).toEqual(["paragraph"]);
  });

  it("leaves an embed with NO target alone", () => {
    // A different defect. Removing it would widen a repair whose safety rests
    // on the pointer being checkable.
    const { next, removed } = stripDeadEmbeds(doc({ type: "moduleEmbed", attrs: {} }), new Set());
    expect(removed).toEqual([]);
    expect(next).toBeNull();
  });

  it("reads the `id` attr as well as `occurrenceId` on an embed node", () => {
    const { removed } = stripDeadEmbeds(doc({ type: "moduleEmbed", attrs: { id: "dead" } }), new Set());
    expect(removed).toEqual(["dead"]);
  });

  it("LEAVES a dangling instanceTextblock alone — a different renderer", () => {
    // `ModuleEmbedNode` paints `embed: <uuid>` when it cannot resolve its
    // target, which is the visible defect this migration exists for.
    // `InstanceTextblockNode` does not: it FORCES the occurrence live and looks
    // again. Scrubbing it would delete a node that recovers on its own. One
    // exists on the live grid; it is reported, not repaired.
    const { next, removed } = stripDeadEmbeds(doc({ type: "instanceTextblock", attrs: { id: "dead" } }), new Set());
    expect(removed).toEqual([]);
    expect(next).toBeNull();
  });

  it("does not touch a non-embed node that happens to carry an id", () => {
    const { next } = stripDeadEmbeds(doc({ type: "image", attrs: { id: "whatever" } }), new Set());
    expect(next).toBeNull();
  });

  it("survives an empty or malformed doc", () => {
    expect(stripDeadEmbeds({ type: "doc" }, new Set()).next).toBeNull();
    expect(stripDeadEmbeds(null, new Set()).next).toBeNull();
  });

  it("is idempotent — a second pass removes nothing", () => {
    const first = stripDeadEmbeds(doc(embed("dead"), para("x")), new Set());
    expect(stripDeadEmbeds(first.next, new Set()).next).toBeNull();
  });
});
