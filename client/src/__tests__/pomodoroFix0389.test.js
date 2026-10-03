import { describe, it, expect } from "vitest";
import { mapSteps, unlinkCopies, deleteByItemIdExpr } from "../../../server/migrations/0389-pomodoro-start-unlinked-stop-deletes.mjs";
describe("0389", () => {
  it("unlinks a copy nested in an IF", () => {
    const out = mapSteps([{ type: "if", then: [{ type: "action", config: { type: "COPY_LINK", sourceId: "s" } }] }], unlinkCopies);
    expect(out[0].then[0].config).toEqual({ type: "COPY_LINK", sourceId: "s", linked: false });
  });
  it("moves DELETE's path to itemIdExpr, leaves a correct one alone", () => {
    expect(deleteByItemIdExpr({ type: "DELETE", path: "$openPomoId" })).toEqual({ type: "DELETE", itemIdExpr: "$openPomoId" });
    expect(deleteByItemIdExpr({ type: "DELETE", itemIdExpr: "$x" })).toEqual({ type: "DELETE", itemIdExpr: "$x" });
    expect(deleteByItemIdExpr({ type: "UPDATE", path: "$a.b" })).toEqual({ type: "UPDATE", path: "$a.b" });
  });
});
