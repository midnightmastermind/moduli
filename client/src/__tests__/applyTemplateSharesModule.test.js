// A copy is another occurrence of the same module (user, 2026-10-21: *"copy link
// the ones into template and then copy the template one … they all keep the same
// module"*). APPLY_TEMPLATE places each template node's OWN module and mints none;
// a root renamed per apply takes the name as its occurrence label.
import { describe, it, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

const world = () => ({
  occurrencesById: {
    board: { id: "board", moduleId: "boardMod", occurrences: [] },
    tpl: { id: "tpl", moduleId: "tplMod", occurrences: ["tplKid"], fields: {} },
    tplKid: { id: "tplKid", moduleId: "exercise", parentId: "tpl", occurrences: [], fields: {} },
  },
  modulesById: {
    tplMod: { id: "tplMod", label: "Day", role: "container", kind: "doc" },
    exercise: { id: "exercise", label: "Exercise", role: "instance" },
    boardMod: { id: "boardMod", role: "container" },
  },
});
const run = (cfg, vars = {}) => {
  const ctx = world();
  const $vars = { $allItems: Object.values(ctx.occurrencesById), $allOccurrences: [], ...vars };
  return (executeActionItem("APPLY_TEMPLATE", cfg, $vars, ctx, {}) || []).filter((u) => u._effect === "CREATE_ITEM");
};

describe("APPLY_TEMPLATE shares the template's modules", () => {
  it("each copy places its node's own module and mints no new one", () => {
    const creates = run({ templateRef: "tpl", rootParent: "board" });
    expect(creates.length).toBe(2);
    expect(creates.map((c) => c.instance.templateId).sort()).toEqual(["exercise", "tplMod"]);
    for (const c of creates) {
      expect(c.templateExists).toBe(true);
      expect(c.template.id).toBe(c.instance.templateId);
    }
  });
  it("a root renamed per apply carries the name as its OWN label; the module keeps its name", () => {
    const ctx = world();
    const $vars = { $allItems: Object.values(ctx.occurrencesById), $allOccurrences: [], $day: "Tuesday" };
    const creates = (executeActionItem("APPLY_TEMPLATE", { templateRef: "tpl", rootParent: "board", rootLabel: "${$day}" }, $vars, ctx, {}) || [])
      .filter((u) => u._effect === "CREATE_ITEM");
    const root = creates.find((c) => c.instance.parentId === "board");
    expect(root.instance.label).toBe("Tuesday");
    expect(root.instance.templateId).toBe("tplMod");
    expect(ctx.modulesById.tplMod.label).toBe("Day");
  });
});
