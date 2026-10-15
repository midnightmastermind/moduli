import { describe, it, expect } from "vitest";
import { planDocEmbed, textmapEmbeds } from "../utils/embedRootInDocParent.js";

describe("planDocEmbed", () => {
  const doc = { type: "doc", content: [{ type: "paragraph" }, { type: "moduleEmbed", attrs: { occurrenceId: "a" } }] };
  it("appends an embed of the child to a doc parent's text", () => {
    const next = planDocEmbed({ parentModule: { kind: "doc" }, textmap: doc, childId: "b" });
    expect(next.content.at(-1)).toEqual({ type: "moduleEmbed", attrs: { occurrenceId: "b" } });
    expect(next.content).toHaveLength(3);
    expect(doc.content).toHaveLength(2); // not mutated
  });
  it("is idempotent: a child already embedded (at any depth) is left alone", () => {
    expect(planDocEmbed({ parentModule: { kind: "doc" }, textmap: doc, childId: "a" })).toBe(null);
    const nested = { type: "doc", content: [{ type: "wrapGroup", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "z" } }] }] };
    expect(textmapEmbeds(nested, "z")).toBe(true);
  });
  it("leaves a board alone (it draws its list) and starts an empty doc", () => {
    expect(planDocEmbed({ parentModule: { kind: "board" }, textmap: doc, childId: "b" })).toBe(null);
    expect(planDocEmbed({ parentModule: { kind: "doc" }, textmap: null, childId: "b" }).content).toHaveLength(1);
  });
});
