// client/src/__tests__/applyTemplateMergeKeepsRecord.test.js
//
// A MERGE INTO A NODE THAT ALREADY EXISTS MUST NOT REWRITE ITS READ-MODEL RECORD.
// After topping up a matched node, APPLY_TEMPLATE patched the node's entry in
// `$vars.$allOccurrences` from the RAW stored row — dropping `_ancestors` and the
// rest of the executor's enrichment — and decided which children were "new" by
// checking the node's SIBLINGS, so children it already had were appended again.
// So every later FIND "under this column" in the same run missed the node:
// `Day Page: Build`'s Daily Question pass found nothing once the section sat one
// level deeper (2026-10-09, the rebuild — measured by replaying the real op).
import { describe, it, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

function world() {
  const occurrencesById = {
    "tpl-root": { id: "tpl-root", moduleId: "m-root", occurrences: ["tpl-sec"] },
    "tpl-sec": { id: "tpl-sec", moduleId: "m-sec", occurrences: ["tpl-q"] },
    "tpl-q": { id: "tpl-q", moduleId: "m-q", occurrences: [] },
    col: { id: "col", moduleId: "m-col", occurrences: ["c-sec"] },
    "c-sec": { id: "c-sec", moduleId: "m-sec", parentId: "col", occurrences: ["c-q"], identitySignature: "auto:tpl-sec" },
    "c-q": { id: "c-q", moduleId: "m-q", parentId: "c-sec", occurrences: [], identitySignature: "auto:tpl-q" },
  };
  const modulesById = {
    "m-root": { id: "m-root", role: "container", kind: "doc", label: "Day Page", fieldBindings: [] },
    "m-sec": { id: "m-sec", role: "container", kind: "doc", label: "Journal", fieldBindings: [] },
    "m-q": { id: "m-q", role: "container", kind: "doc", label: "Question", fieldBindings: [] },
    "m-col": { id: "m-col", role: "container", kind: "doc", label: "Column", fieldBindings: [] },
  };
  // the executor's read model: the same rows, ENRICHED
  const anc = { col: [], "c-sec": ["col"], "c-q": ["c-sec", "col"], "tpl-root": [], "tpl-sec": ["tpl-root"], "tpl-q": ["tpl-sec", "tpl-root"] };
  const records = Object.values(occurrencesById).map((o) => ({ ...o, _ancestors: anc[o.id], role: "container" }));
  const $vars = { $allOccurrences: records, $allItems: records, $allContainers: records, $tplId: "tpl-root", $colId: "col" };
  return { occurrencesById, modulesById, $vars };
}

const merge = (w) => executeActionItem("APPLY_TEMPLATE",
  { templateRef: "$tplId", targetOccurrenceVar: "$colId", mode: "merge", unwrapRoot: true },
  w.$vars, { occurrencesById: w.occurrencesById, modulesById: w.modulesById, fieldsById: {} }) || [];

describe("a merge into an existing node keeps its read-model record", () => {
  it("control: nothing new is cloned — every template node already has its clone", () => {
    const w = world();
    expect(merge(w).filter((u) => u._effect === "CREATE_ITEM")).toHaveLength(0);
  });
  it("the matched node keeps its _ancestors", () => {
    const w = world(); merge(w);
    for (const key of ["$allOccurrences", "$allItems", "$allContainers"]) {
      expect(w.$vars[key].find((o) => o.id === "c-sec")._ancestors, key).toEqual(["col"]);
    }
  });
  it("its existing children are not appended again", () => {
    const w = world(); merge(w);
    expect(w.$vars.$allOccurrences.find((o) => o.id === "c-sec").occurrences).toEqual(["c-q"]);
  });
  it("a child cloned into a matched node this run IS added to its record", () => {
    const w = world();
    // the template grows a second child the column's copy does not have yet
    w.occurrencesById["tpl-a"] = { id: "tpl-a", moduleId: "m-q", occurrences: [] };
    w.occurrencesById["tpl-sec"] = { ...w.occurrencesById["tpl-sec"], occurrences: ["tpl-q", "tpl-a"] };
    const created = merge(w).filter((u) => u._effect === "CREATE_ITEM");
    expect(created).toHaveLength(1);
    const rec = w.$vars.$allOccurrences.find((o) => o.id === "c-sec");
    expect(rec.occurrences).toHaveLength(2);
    expect(rec.occurrences[0]).toBe("c-q");
    expect(rec._ancestors).toEqual(["col"]);
  });
});
