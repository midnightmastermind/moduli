// "Add a button…" on a container: any text, an empty operation to build — no preset job.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

describe("Add a button", () => {
  it("makes only the button, bound on the container, in one action — no operation", async () => {
    const CH = await import("../helpers/CommitHelpers.js");
    const { getActionId } = await import("../helpers/actionScope.js");
    const calls = [];
    const spies = ["createField", "createOperation", "updateModule"].map((k) => vi.spyOn(CH, k).mockImplementation((a) => calls.push([k, a, getActionId()])));
    const { addButton } = await import("../ui/buttonItem.js");
    const field = addButton({ containerModule: { id: "boardMod", fieldBindings: [{ fieldId: "x" }] }, label: "Mark all done", fieldsById: {}, gridId: "g" });
    expect(calls.map((c) => c[0])).toEqual(["createField", "updateModule"]);
    expect(field).toMatchObject({ type: "button", meta: { buttonLabel: "Mark all done" } });
    expect(field.meta.operationId).toBeUndefined();
    expect(calls[1][1].module.fieldBindings.map((b) => b.fieldId)).toEqual(["x", field.id]);
    expect(calls[0][2]).toBeTruthy();
    expect(calls[1][2]).toBe(calls[0][2]);
    spies.forEach((sp) => sp.mockRestore());
  });

  it("asks only for the text, with nothing filled in and no preset job", () => {
    const src = readFileSync(new URL("../ui/buttonItem.js", import.meta.url), "utf8");
    expect(src).toMatch(/key: "label"/);
    expect(src).not.toMatch(/default:|key: "does"|planFormButton/);
  });

  it("all three container header variants offer it", () => {
    const src = readFileSync(new URL("../modules/ModuleContainer.jsx", import.meta.url), "utf8");
    expect(src.match(/buttonItem\(\{/g)?.length).toBe(3);
    expect(src).toMatch(/exportMarkdownItem\(\{/); // control
  });
});
