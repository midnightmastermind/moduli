// "Add a button…" on a container: any text, an empty operation to build — no preset job.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

describe("Add a button", () => {
  it("makes the button with an empty operation, bound on the container, one action", async () => {
    const CH = await import("../helpers/CommitHelpers.js");
    const calls = [];
    const spies = ["createField", "createOperation", "updateModule"].map((k) => vi.spyOn(CH, k).mockImplementation((a) => calls.push([k, a])));
    const { addBlankButton } = await import("../ui/buttonItem.js");
    const op = addBlankButton({ containerModule: { id: "boardMod", fieldBindings: [{ fieldId: "x" }] }, label: "Mark all done", fieldsById: {}, gridId: "g" });
    expect(op.pipeline.steps).toEqual([]);
    expect(op.name).toBe("Mark all done");
    expect(op.triggerObjects[0]).toMatchObject({ eventType: "onButton" });
    const field = calls.find((c) => c[0] === "createField")[1].field;
    expect(field.meta).toMatchObject({ buttonLabel: "Mark all done", operationId: op.id });
    expect(op.triggerObjects[0].targetId).toBe(field.id);
    expect(calls.find((c) => c[0] === "updateModule")[1].module.fieldBindings.map((b) => b.fieldId)).toEqual(["x", field.id]);
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
