import { describe, it, expect } from "vitest";
import { applyQueuedEditsToPayload } from "../helpers/queuedEdits.js";

const base = () => ({ gridId: "g", occurrences: [{ id: "a", fields: { f: { value: false } }, label: "A" }, { id: "b" }], modules: [{ id: "m", label: "M" }] });

describe("applyQueuedEditsToPayload", () => {
  it("keeps a field edit made during the snapshot", () => {
    const out = applyQueuedEditsToPayload(base(), [{ event: "update_occurrence", data: { occurrence: { id: "a", fields: { f: { value: true } }, __actionId: "x" } } }]);
    expect(out.occurrences[0]).toEqual({ id: "a", fields: { f: { value: true } }, label: "A" });
  });
  it("adds a created row and module, removes a deleted one", () => {
    const out = applyQueuedEditsToPayload(base(), [
      { event: "create_module", data: { module: { id: "m2" } } },
      { event: "create_occurrence", data: { occurrence: { id: "c", moduleId: "m2" } } },
      { event: "delete_occurrence", data: { occurrenceId: "b" } },
    ]);
    expect(out.occurrences.map((o) => o.id)).toEqual(["a", "c"]);
    expect(out.modules.map((m) => m.id)).toEqual(["m", "m2"]);
  });
  it("applies edits in order and never mutates the payload passed in", () => {
    const p = base();
    const out = applyQueuedEditsToPayload(p, [
      { event: "update_module", data: { module: { id: "m", label: "one" } } },
      { event: "update_module", data: { module: { id: "m", label: "two" } } },
    ]);
    expect(out.modules[0].label).toBe("two");
    expect(p.modules[0].label).toBe("M");
  });
  it("returns the same payload when nothing was queued (control)", () => {
    const p = base();
    expect(applyQueuedEditsToPayload(p, [])).toBe(p);
    expect(applyQueuedEditsToPayload(p, [{ event: "update_grid", data: { gridId: "g" } }])).toBe(p);
  });
});
