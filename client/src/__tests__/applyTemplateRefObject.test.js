// APPLY_TEMPLATE's template may be a LOCAL VARIABLE holding the occurrence.
//
// The editor's template picker offers a local variable whole (`$task`, a loop's
// item) — it cannot drill to `.id`. poms' `Schedule: Place Weekday Tasks` stores
// `$task.id`; one built by clicking stores `$task`. The executor read the
// reference as an id and looked an OBJECT up in occurrencesById, so it applied
// nothing. It resolves an occurrence to its id now, as the target already did.
import { describe, it, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

const world = () => ({
  occurrencesById: {
    todo: { id: "todo", moduleId: "todoMod", occurrences: [] },
    task: { id: "task", moduleId: "taskMod", occurrences: [], fields: {} },
  },
  modulesById: { todoMod: { id: "todoMod", role: "container" }, taskMod: { id: "taskMod", label: "Take out trash", role: "instance" } },
});
const run = (templateRef, vars) => {
  const ctx = world();
  const $vars = { $allItems: Object.values(ctx.occurrencesById), $allOccurrences: [], ...vars };
  return (executeActionItem("APPLY_TEMPLATE", { type: "APPLY_TEMPLATE", templateRef, rootParent: "todo", mode: "merge" }, $vars, ctx, {}) || [])
    .filter((u) => u._effect === "CREATE_ITEM");
};

describe("APPLY_TEMPLATE template reference", () => {
  it("applies a template named by a variable holding the OCCURRENCE ($task)", () => {
    const creates = run("$task", { $task: world().occurrencesById.task });
    expect(creates.length).toBe(1);
    expect(creates[0].instance.parentId).toBe("todo");
  });
  it("still applies one named by id ($task.id) — poms' stored shape", () => {
    const creates = run("$task.id", { $task: world().occurrencesById.task });
    expect(creates.length).toBe(1);
  });
});
