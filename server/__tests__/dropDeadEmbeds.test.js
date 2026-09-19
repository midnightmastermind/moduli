import { describe, it, expect } from "vitest";
import { dropDeadEmbeds } from "../migrations/0345-day-columns-drop-embeds-of-deleted-check-ins.mjs";
const e = (id) => ({ type: "moduleEmbed", attrs: { occurrenceId: id } });
describe("0345 dropDeadEmbeds", () => {
  it("drops only top-level embeds naming a dead id", () => {
    const doc = { type: "doc", content: [e("wheel"), e("ghost"), { type: "paragraph" }] };
    const { doc: out, dropped } = dropDeadEmbeds(doc, (id) => id === "wheel");
    expect(out.content.map((n) => n.attrs?.occurrenceId || n.type)).toEqual(["wheel", "paragraph"]);
    expect(dropped).toEqual(["ghost"]);
  });
  it("leaves a doc with no dead embed untouched (same object)", () => {
    const doc = { type: "doc", content: [e("wheel")] };
    expect(dropDeadEmbeds(doc, () => true).doc).toBe(doc);
  });
  // An embed with NO id is ProseMirror's own filler, which 0336 owns.
  it("ignores an id-less embed", () => {
    const doc = { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "" } }] };
    expect(dropDeadEmbeds(doc, () => false).dropped).toEqual([]);
  });
});
