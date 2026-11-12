import { describe, it, expect } from "vitest";
import { planItemAnnotations } from "../migrations/0496-lookup-item-annotations.mjs";

const li = (id) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "instanceTextblockInline", attrs: { occurrenceId: id } }] }] });
const doc = (...items) => ({ type: "doc", content: [{ type: "bulletList", content: items }, { type: "moduleEmbed", attrs: { occurrenceId: "summary" } }] });
const rows = new Map([["a", ["a", "Alpha", "note a", ["w:Alpha"]]], ["b", ["b", "Beta", "note b", []]]]);
let n = 0; const mint = () => `q${++n}`;

describe("0496 planItemAnnotations", () => {
  it("puts a quote inside each bullet, right after the item", () => {
    n = 0;
    const r = planItemAnnotations(doc(li("a"), li("b")), new Map([["a", "Alpha"], ["b", "Beta"]]), rows, mint);
    expect(r.added).toHaveLength(2);
    const items = r.doc.content[0].content;
    expect(items[0].content[1]).toEqual({ type: "moduleEmbed", attrs: { occurrenceId: "q1", align: "full" } });
    expect(items[1].content[1].attrs.occurrenceId).toBe("q2");
    expect(r.doc.content[1].attrs.occurrenceId).toBe("summary"); // section summary untouched
  });
  it("skips an item whose text changed and reports it", () => {
    const r = planItemAnnotations(doc(li("a")), new Map([["a", "Something else"]]), rows, mint);
    expect(r.added).toHaveLength(0);
    expect(r.changed).toEqual(["a"]);
  });
  it("is idempotent: a bullet already holding an embed is left alone", () => {
    const first = planItemAnnotations(doc(li("a")), new Map([["a", "Alpha"]]), rows, mint);
    const again = planItemAnnotations(first.doc, new Map([["a", "Alpha"]]), rows, mint);
    expect(again.added).toHaveLength(0);
    expect(again.doc).toEqual(first.doc);
  });
  it("leaves a bullet with no annotation row alone", () => {
    const r = planItemAnnotations(doc(li("zzz")), new Map(), rows, mint);
    expect(r.added).toHaveLength(0);
  });
});
