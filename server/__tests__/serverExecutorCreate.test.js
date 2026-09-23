// server/__tests__/serverExecutorCreate.test.js
//
// serverExecutor's own header says CREATE "needs a connected browser tab
// today". A share arrives with no tab (the extension case), so it cannot.
import { describe, it, expect, vi, beforeEach } from "vitest";

const minted = [];
vi.mock("../services/occurrenceMint.js", () => ({
  mintOccurrence: async (args) => {
    minted.push(args);
    return { occurrenceId: `occ${minted.length}`, moduleId: `mod${minted.length}`, status: "created" };
  },
}));
vi.mock("../models/Secret.js", () => ({ default: { findOne: async () => null } }));

const { runOperationServerSide } = await import("../services/serverExecutor.js");

const op = (steps) => ({ id: "op1", name: "t", pipeline: { steps } });
beforeEach(() => { minted.length = 0; });

describe("CREATE, server-side", () => {
  it("mints a row with resolved values from $vars", async () => {
    await runOperationServerSide(op([
      { type: "action", config: { type: "INIT_VAR", name: "$title", value: "literal:Dentist" } },
      { type: "action", config: { type: "CREATE", parentId: "literal:cont1", label: "$title",
        fields: { fDate: "literal:2026-09-25" }, externalId: "literal:ics:abc" } },
    ]), { userId: "u1", gridId: "g1" });

    expect(minted).toHaveLength(1);
    expect(minted[0].label).toBe("Dentist");
    expect(minted[0].parentId).toBe("cont1");
    expect(minted[0].fields.fDate).toEqual({ value: "2026-09-25", flow: "in" });
  });

  it("BINDS every field it writes (D17)", async () => {
    await runOperationServerSide(op([
      { type: "action", config: { type: "CREATE", parentId: "literal:c", label: "literal:x",
        fields: { fA: "literal:1", fB: "literal:2" }, externalId: "literal:e" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(minted[0].fieldBindings.map(b => b.fieldId).sort()).toEqual(["fA", "fB"]);
  });

  it("honours an explicit bindFields list, so a field can be bound EMPTY", async () => {
    // The ics rule binds Schedule Type with no value so the Schedule op, which
    // gates on the binding, still picks the row up.
    await runOperationServerSide(op([
      { type: "action", config: { type: "CREATE", parentId: "literal:c", label: "literal:x",
        fields: { fDate: "literal:2026-09-25" }, bindFields: ["fSchedType", "fDate"],
        externalId: "literal:e" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(minted[0].fieldBindings.map(b => b.fieldId)).toContain("fSchedType");
    expect(minted[0].fields.fSchedType).toBeUndefined();
  });

  it("runs inside a LOOP once per item", async () => {
    await runOperationServerSide(op([
      { type: "action", config: { type: "INIT_VAR", name: "$xs", value: ["a", "b", "c"] } },
      { type: "loop", overExpr: "$xs", as: "$x", body: [
        { type: "action", config: { type: "CREATE", parentId: "literal:c",
          label: "$x", externalId: "$x" } },
      ]},
    ]), { userId: "u1", gridId: "g1" });
    expect(minted.map(m => m.label)).toEqual(["a", "b", "c"]);
  });

  it("CONTROL — an action still outside the subset does not half-run", async () => {
    // Scope discipline: only CREATE and FIND are added. APPLY_TEMPLATE must
    // still be refused rather than silently doing nothing.
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "APPLY_TEMPLATE", templateRef: "literal:t" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(res.unsupported).toContain("APPLY_TEMPLATE");
    expect(minted).toHaveLength(0);
  });
});
