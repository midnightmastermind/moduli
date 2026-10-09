// copyContainerToList — a copied container is a new PLACEMENT of the same module in the
// destination list: same module, the source placement's field values, parented to the list,
// inserted at the index, one undo step. Children are not copied (a placement's children are
// its own), as copyContainerToPanel never copied them either.
import { describe, it, expect, vi, beforeEach } from "vitest";
const calls = [];
vi.mock("../helpers/CommitHelpers", () => ({
  createOccurrence: (a) => calls.push(["create", a.occurrence]),
  updateOccurrence: (a) => calls.push(["update", a.occurrence, a.occurrencesBase]),
}));
const actions = [];
vi.mock("../helpers/actionScope", async (orig) => ({ ...(await orig()), withAction: (label, fn) => { actions.push(label); return fn(); } }));
const { copyContainerToList } = await import("../helpers/LayoutHelpers");
beforeEach(() => { calls.length = 0; actions.length = 0; });

describe("copyContainerToList", () => {
  const list = { id: "routine", occurrences: ["a", "b"] };
  const src = { id: "slot7", moduleId: "m-slot7", fields: { ts: { value: "7:00am" } }, occurrences: ["x"] };
  it("mints a placement of the same module, parented to the list, with the source's values", () => {
    copyContainerToList({ dispatch: vi.fn(), socket: {}, gridId: "g", userId: "u", sourceOccurrence: src, toListOcc: list, toIndex: 1 });
    const created = calls.find(c => c[0] === "create")[1];
    expect(created.moduleId).toBe("m-slot7");
    expect(created.parentId).toBe("routine");
    expect(created.fields).toEqual({ ts: { value: "7:00am" } });
    expect(created.fields).not.toBe(src.fields);
    expect(created.occurrences).toEqual([]);
    const upd = calls.find(c => c[0] === "update");
    expect(upd[1].occurrences).toEqual(["a", created.id, "b"]);
    expect(upd[2]).toEqual(["a", "b"]);
  });
  it("appends when no index, in one undo step", () => {
    copyContainerToList({ dispatch: vi.fn(), socket: {}, gridId: "g", userId: "u", sourceOccurrence: src, toListOcc: list, toIndex: null });
    const upd = calls.find(c => c[0] === "update");
    expect(upd[1].occurrences.slice(0, 2)).toEqual(["a", "b"]);
    expect(actions).toEqual(["Copied container"]);
  });
});
