import { describe, it, expect } from "vitest";
import { planDropBinding } from "../migrations/0419-slot-containers-drop-last-seen.mjs";

describe("0419 planDropBinding", () => {
  it("removes the binding from containers only, keeping their other bindings", () => {
    const mods = [
      { id: "s", role: "container", label: "7:30am", fieldBindings: [{ fieldId: "ts", hidden: true }, { fieldId: "ls" }] },
      { id: "i", role: "instance", label: "Drink", fieldBindings: [{ fieldId: "ls" }] },
      { id: "c", role: "container", label: "Todo", fieldBindings: [{ fieldId: "ts" }] },
    ];
    expect(planDropBinding(mods, "ls")).toEqual([{ id: "s", label: "7:30am", fieldBindings: [{ fieldId: "ts", hidden: true }] }]);
  });
});
