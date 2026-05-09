import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";

function makeLogger() {
  return { entries: [], add(kind, data) { this.entries.push({ kind, ...data }); } };
}

describe("RUN_OPERATION action", () => {
  it("invokes another op by name and bubbles its effects up", async () => {
    const calleeOp = {
      id: "op_callee",
      name: "Set Marker",
      pipeline: {
        sources: [],
        steps: [
          // Emit an UPDATE_DISPLAY_VALUE effect so we can assert it bubbled up.
          { id: "c1", type: "action", config: {
              type: "UPDATE",
              path: "$display.fld_x.itm_y",
              value: "called",
          }},
        ],
      },
    };
    const callerOp = {
      id: "op_caller",
      name: "Caller",
      pipeline: {
        sources: [],
        steps: [
          { id: "p1", type: "action", config: { type: "RUN_OPERATION", operationName: "Set Marker" } },
        ],
      },
    };

    const ctx = {
      state: { grid: {}, gridId: "g", modules: [] },
      modulesById: {},
      occurrencesById: {},
      fieldsById: {},
      operationsById: { op_callee: calleeOp, op_caller: callerOp },
    };
    const logger = makeLogger();
    const effects = await executePipeline(callerOp, ctx, undefined, undefined, logger);

    expect(Array.isArray(effects)).toBe(true);
    const display = effects.find(e => e._effect === "UPDATE_DISPLAY_VALUE");
    expect(display).toBeDefined();
    expect(display.value).toBe("called");
  });

  it("looks up by operationId when name is omitted", async () => {
    const calleeOp = {
      id: "op_inner",
      name: "Inner",
      pipeline: {
        sources: [],
        steps: [
          { id: "c1", type: "action", config: { type: "UPDATE", path: "$display.f.i", value: 42 } },
        ],
      },
    };
    const callerOp = {
      id: "op_outer",
      name: "Outer",
      pipeline: {
        sources: [],
        steps: [
          { id: "p1", type: "action", config: { type: "RUN_OPERATION", operationId: "op_inner" } },
        ],
      },
    };
    const ctx = {
      state: { grid: {}, gridId: "g", modules: [] },
      modulesById: {}, occurrencesById: {}, fieldsById: {},
      operationsById: { op_inner: calleeOp, op_outer: callerOp },
    };

    const effects = await executePipeline(callerOp, ctx, undefined, undefined, makeLogger());
    expect(effects.find(e => e._effect === "UPDATE_DISPLAY_VALUE" && e.value === 42)).toBeDefined();
  });

  it("caps recursion at depth 4 (no infinite loop on A→A)", async () => {
    const recursiveOp = {
      id: "op_rec",
      name: "Recursive",
      pipeline: {
        sources: [],
        steps: [
          { id: "p1", type: "action", config: { type: "RUN_OPERATION", operationName: "Recursive" } },
          { id: "p2", type: "action", config: { type: "UPDATE", path: "$display.f.i", value: 1 } },
        ],
      },
    };
    const ctx = {
      state: { grid: {}, gridId: "g", modules: [] },
      modulesById: {}, occurrencesById: {}, fieldsById: {},
      operationsById: { op_rec: recursiveOp },
    };
    // Should complete (not stack-overflow). The guard only short-circuits the
    // RUN_OPERATION step itself — the rest of that frame's pipeline (the UPDATE
    // step at p2) still runs. So depths 0..4 each contribute one UPDATE write.
    const effects = await executePipeline(recursiveOp, ctx, undefined, undefined, makeLogger());
    const displayWrites = effects.filter(e => e._effect === "UPDATE_DISPLAY_VALUE");
    expect(displayWrites.length).toBe(5);
  });

  it("returns no-op (and warns) when operation lookup fails", async () => {
    const callerOp = {
      id: "op_x",
      name: "X",
      pipeline: {
        sources: [],
        steps: [
          { id: "p1", type: "action", config: { type: "RUN_OPERATION", operationName: "Nonexistent Op" } },
          { id: "p2", type: "action", config: { type: "UPDATE", path: "$display.f.i", value: 7 } },
        ],
      },
    };
    const ctx = {
      state: { grid: {}, gridId: "g", modules: [] },
      modulesById: {}, occurrencesById: {}, fieldsById: {},
      operationsById: { op_x: callerOp },
    };
    const effects = await executePipeline(callerOp, ctx, undefined, undefined, makeLogger());
    // p1 is a no-op (op not found); p2 still runs.
    expect(effects.filter(e => e._effect === "UPDATE_DISPLAY_VALUE").length).toBe(1);
    expect(effects[0].value).toBe(7);
  });
});
