// An inline chip (role:"textblock" kind:"inline", drawn by an `instanceTextblockInline` node) belongs to
// the occurrence whose TEXT embeds it: parented to it and listed by it, so deleting that text cascades
// into the chip and the client's chip lifecycle can delete a chip its text stops drawing. Chips made
// in the app ("Make inline textblock") already are; the importer minted them listed by nothing
// (1,861 on poms, 1,573 on the rebuild — 2026-10-09).
import { describe, it, expect } from "vitest";
import { ownInlineChips, embeddedChipIds } from "../utils/inlineChipOwnership.js";

const chip = (id, extra = {}) => ({ id, moduleId: `m-${id}`, parentId: null, ...extra });
const para = (...ids) => ({ type: "paragraph", content: ids.map((id) => ({ type: "instanceTextblockInline", attrs: { occurrenceId: id } })) });

describe("ownInlineChips", () => {
  it("parents and lists every chip a text embeds, keeping the text's other children", () => {
    const tb = { id: "tb", occurrences: ["img"], textmap: { type: "doc", content: [para("c1"), { type: "bulletList", content: [para("c2")] }] } };
    const occs = [tb, chip("c1"), chip("c2"), { id: "img", parentId: "tb" }];
    const changed = ownInlineChips(occs);
    expect(tb.occurrences).toEqual(["img", "c1", "c2"]);
    expect(occs[1].parentId).toBe("tb");
    expect(occs[2].parentId).toBe("tb");
    expect(changed.sort()).toEqual(["c1", "c2", "tb"]);
  });
  it("is idempotent: an owned chip changes nothing", () => {
    const tb = { id: "tb", occurrences: ["c1"], textmap: { type: "doc", content: [para("c1")] } };
    expect(ownInlineChips([tb, chip("c1", { parentId: "tb" })])).toEqual([]);
  });
  it("never re-homes a chip that already has a parent elsewhere (it is only listed)", () => {
    const tb = { id: "tb", occurrences: [], textmap: { type: "doc", content: [para("c1")] } };
    const c = chip("c1", { parentId: "other" });
    ownInlineChips([tb, c, { id: "other", occurrences: [] }]);
    expect(c.parentId).toBe("other");
    expect(tb.occurrences).toEqual(["c1"]);
  });
  it("ignores an embed whose chip does not exist and other node types (control)", () => {
    const tb = { id: "tb", occurrences: [], textmap: { type: "doc", content: [para("ghost"), { type: "moduleEmbed", attrs: { occurrenceId: "sec" } }] } };
    expect(ownInlineChips([tb, { id: "sec" }])).toEqual([]);
    expect(tb.occurrences).toEqual([]);
  });
  it("embeddedChipIds reads nested content, in order, once each", () => {
    expect(embeddedChipIds({ type: "doc", content: [para("a", "b"), para("a")] })).toEqual(["a", "b"]);
  });
});
