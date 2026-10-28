// A copy-link carries the source PLACEMENT's own name, not only the shared module's (2026-10-28:
// "Clean hotel room" was copy-linked as "Clean").
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { executePipeline } from "../helpers/operationExecutor";

const run = (srcLabel) => {
  const occurrencesById = {
    src: { id: "src", role: "instance", moduleId: "m", parentId: "a", label: srcLabel, fields: {}, occurrences: [] },
    a: { id: "a", role: "container", moduleId: "mc", occurrences: ["src"] },
    b: { id: "b", role: "container", moduleId: "mc", occurrences: [] },
  };
  const modulesById = { m: { id: "m", role: "instance", label: "Clean" }, mc: { id: "mc", role: "container", kind: "board" } };
  const op = { id: "op", name: "t", pipeline: { steps: [
    { id: "s", type: "action", config: { type: "COPY_LINK", sourceId: "literal:src", parent: "literal:b", recursive: false } },
  ] } };
  const ctx = { state: { grid: { _id: "g" }, gridId: "g", occurrencesById, modulesById, modules: Object.values(modulesById) }, occurrencesById, modulesById, fieldsById: {} };
  return (executePipeline(op, ctx, {}) || []).find((u) => u._effect === "CREATE_ITEM");
};

describe("COPY_LINK keeps the row's own name", () => {
  it("a renamed row's copy carries its name", () => {
    expect(run("Clean hotel room").instance.label).toBe("Clean hotel room");
  });
  it("a row with no name of its own sends none (it keeps following the module)", () => {
    expect(run(null).instance.label).toBeUndefined();
  });
  it("the store applies a copy-link's own name", () => {
    const src = fs.readFileSync(new URL("../state/bindSocketToStore.js", import.meta.url), "utf8");
    expect(src).toContain("(effect.templateExists || !effect.template)");
  });
});
