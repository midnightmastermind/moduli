import { describe, test, expect } from "vitest";
import { unlinkSlotCopies, slotLinkMembers } from "../migrations/0446-schedule-slots-are-plain-copies.mjs";

const step = (cfg) => ({ id: cfg.id || "s", type: "action", config: { type: "COPY_LINK", ...cfg } });

describe("0446 unlinkSlotCopies", () => {
  test("turns the slot COPY_LINK into a plain copy, nested anywhere", () => {
    const pipe = { steps: [{ type: "if", config: { then: [{ type: "loop", config: { body: [step({ sourceId: "$tplChildId", parent: "$dayColId" })] } }] } }] };
    const [out, n] = unlinkSlotCopies(pipe, "$tplChildId");
    expect(n).toBe(1);
    expect(out.steps[0].config.then[0].config.body[0].config).toMatchObject({ linked: false, sourceId: "$tplChildId", parent: "$dayColId" });
  });
  test("leaves a COPY_LINK of anything else linked", () => {
    const [out, n] = unlinkSlotCopies({ steps: [step({ sourceId: "$task.id" })] }, "$tplChildId");
    expect(n).toBe(0);
    expect(out.steps[0].config.linked).toBeUndefined();
  });
  test("a second run finds nothing", () => {
    const [once] = unlinkSlotCopies({ steps: [step({ sourceId: "$tplChildId" })] }, "$tplChildId");
    expect(unlinkSlotCopies(once, "$tplChildId")[1]).toBe(0);
  });
});

describe("0446 slotLinkMembers", () => {
  const F = "fmt", T = "slot";
  const role = (m) => (m.startsWith("c") ? "container" : "instance");
  const ids = { formatFieldId: F, slotFieldId: T };
  test("dissolves a group of slots (and the Todo)", () => {
    const occs = [
      { id: "a", moduleId: "c1", linkedGroupId: "g", fields: { [F]: { value: "slot" } } },
      { id: "b", moduleId: "c1", linkedGroupId: "g", fields: { [F]: { value: "slot" } } },
      { id: "t1", moduleId: "c2", linkedGroupId: "h", fields: { [T]: { value: "Todo" } } },
      { id: "t2", moduleId: "c2", linkedGroupId: "h", fields: { [T]: { value: "Todo" } } },
    ];
    expect(slotLinkMembers(occs, role, ids).sort()).toEqual(["a", "b", "t1", "t2"]);
  });
  test("never touches a group that holds a row", () => {
    const occs = [
      { id: "a", moduleId: "c1", linkedGroupId: "g", fields: { [F]: { value: "slot" } } },
      { id: "r", moduleId: "i1", linkedGroupId: "g", fields: {} },
      { id: "x", moduleId: "i2", linkedGroupId: "k", fields: {} },
      { id: "y", moduleId: "i2", linkedGroupId: "k", fields: {} },
    ];
    expect(slotLinkMembers(occs, role, ids)).toEqual([]);
  });
});
