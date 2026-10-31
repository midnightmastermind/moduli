import { describe, it, expect } from "vitest";
import { todoContainerIdOf, withTodoTriggers } from "../migrations/0465-todo-tasks-place-on-add.mjs";

const pipeline = { steps: [{ type: "if", condition: { rules: [{ left: "$ut.parentId", comparator: "IS", right: "todo-1" }] } }] };

describe("0465", () => {
  it("reads the Todo container from the op's own pipeline", () => {
    expect(todoContainerIdOf(pipeline)).toBe("todo-1");
    expect(todoContainerIdOf({ steps: [] })).toBe(null);
  });
  it("adds add-into, move-into and move-out-of triggers", () => {
    const out = withTodoTriggers([{ eventType: "onLoad", subjectType: "grid", targetId: "" }], "todo-1");
    expect(out).toHaveLength(4);
    expect(out.find((t) => t.eventType === "onAdd").ancestorId).toBe("todo-1");
    expect(out.filter((t) => t.eventType === "onMove").map((t) => t.ancestorId || t.targetId).sort()).toEqual(["todo-1", "todo-1"]);
  });
  it("is idempotent and keeps what was there", () => {
    const once = withTodoTriggers([{ eventType: "onLoad" }], "todo-1");
    expect(withTodoTriggers(once, "todo-1")).toEqual(once);
    expect(once[0]).toEqual({ eventType: "onLoad" });
  });
});
