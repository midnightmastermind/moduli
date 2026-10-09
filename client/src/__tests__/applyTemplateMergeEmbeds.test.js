// client/src/__tests__/applyTemplateMergeEmbeds.test.js
//
// A DOC draws its TEXTMAP and nothing else. When a template gains a section and
// `Day Page: Build` MERGES it into a day column that already exists, the new
// clone was LISTED by its doc parent and never EMBEDDED — so it existed and never
// appeared (2026-10-09: the rebuild's new Journal › Daily Question showed on a
// freshly built day and on no existing one). Every path that adds a child to a
// doc appends its embed (helpers/docEmbedAppend); the merge now does too.
import { describe, it, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

function world(parentKind = "doc") {
  const occurrencesById = {
    "tpl-root": { id: "tpl-root", moduleId: "m-root", occurrences: ["tpl-sec"] },
    "tpl-sec": { id: "tpl-sec", moduleId: "m-sec", occurrences: ["tpl-q", "tpl-a"] },
    "tpl-q": { id: "tpl-q", moduleId: "m-q", occurrences: [] },
    "tpl-a": { id: "tpl-a", moduleId: "m-a", occurrences: [] },
    col: { id: "col", moduleId: "m-col", occurrences: ["c-sec"] },
    "c-sec": { id: "c-sec", moduleId: "m-sec", parentId: "col", occurrences: ["c-q"], identitySignature: "auto:tpl-sec",
      textmap: { type: "doc", content: [{ type: "paragraph" }, { type: "moduleEmbed", attrs: { occurrenceId: "c-q" } }] } },
    "c-q": { id: "c-q", moduleId: "m-q", parentId: "c-sec", occurrences: [], identitySignature: "auto:tpl-q" },
  };
  const modulesById = {
    "m-root": { id: "m-root", role: "container", kind: "doc", label: "Day Page", fieldBindings: [] },
    "m-sec": { id: "m-sec", role: "container", kind: parentKind, label: "Journal", fieldBindings: [] },
    "m-q": { id: "m-q", role: "container", kind: "doc", label: "Question", fieldBindings: [] },
    "m-a": { id: "m-a", role: "textblock", kind: "doc", label: "", fieldBindings: [] },
    "m-col": { id: "m-col", role: "container", kind: "doc", label: "Column", fieldBindings: [] },
  };
  const records = Object.values(occurrencesById);
  const $vars = { $allOccurrences: records, $allItems: records, $tplId: "tpl-root", $colId: "col" };
  return { occurrencesById, modulesById, $vars };
}
const merge = (w) => executeActionItem("APPLY_TEMPLATE",
  { templateRef: "$tplId", targetOccurrenceVar: "$colId", mode: "merge", unwrapRoot: true },
  w.$vars, { occurrencesById: w.occurrencesById, modulesById: w.modulesById, fieldsById: {} }) || [];

describe("a merge embeds what it adds to an existing doc", () => {
  it("control: exactly one new clone (the added textblock)", () => {
    const created = merge(world()).filter((u) => u._effect === "CREATE_ITEM");
    expect(created).toHaveLength(1);
    expect(created[0].template.role).toBe("textblock");
  });
  it("the doc's textmap gains the new clone's embed, after what it already drew", () => {
    const w = world(); const out = merge(w);
    const newId = out.find((u) => u._effect === "CREATE_ITEM").instance.id;
    const newMod = out.find((u) => u._effect === "CREATE_ITEM").template.id;
    const tm = out.filter((u) => u._effect === "UPDATE_ITEM_TEXTMAP" && u.itemId === "c-sec").at(-1)?.textmap;
    expect(tm.content).toEqual([
      { type: "paragraph" },
      { type: "moduleEmbed", attrs: { occurrenceId: "c-q" } },
      { type: "instanceTextblock", attrs: { instanceId: newMod, occurrenceId: newId } },
    ]);
  });
  it("a board parent (not a doc) gets no textmap write", () => {
    const out = merge(world("board"));
    expect(out.some((u) => u._effect === "UPDATE_ITEM_TEXTMAP" && u.itemId === "c-sec")).toBe(false);
  });
  it("a merge that adds nothing writes no textmap", () => {
    const w = world();
    w.occurrencesById["tpl-sec"] = { ...w.occurrencesById["tpl-sec"], occurrences: ["tpl-q"] };
    expect(merge(w).some((u) => u._effect === "UPDATE_ITEM_TEXTMAP")).toBe(false);
  });
});
