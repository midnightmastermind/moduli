// "Duplicate (new instance)" on a row's right-click menu made a MODULE and no
// visible row (watched 2026-10-12: "Now (Copy)" module in the store, 0
// occurrences). It went through create_instance_in_container, whose optimistic
// reducer adds only the module and whose server echo skips the sender — so the
// clicking tab never saw the copy, and the server picked the container by MODULE
// id (any placement of that container). It mints both halves locally now, in the
// row's OWN parent, right after the row, as one undo step.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetActionScope } from "../helpers/actionScope";
import * as CommitHelpers from "../helpers/CommitHelpers";

beforeEach(() => _resetActionScope());

function run() {
  const emitted = [], dispatched = [];
  const socket = { connected: true, emit: (event, data) => emitted.push({ event, data }), on: vi.fn(), off: vi.fn(), io: { opts: {} } };
  const module = { id: "m1", userId: "u1", gridId: "g1", role: "instance", label: "Now", fieldBindings: [{ fieldId: "f1", role: "input" }] };
  const occurrence = { id: "o1", moduleId: "m1", parentId: "c1", fields: { f1: { value: 3, flow: "in" } } };
  const parent = { id: "c1", moduleId: "cm", occurrences: ["a", "o1", "b"] };
  const out = CommitHelpers.duplicateInstance({ dispatch: (a) => dispatched.push(a), socket, module, occurrence, parentOccurrence: parent });
  return { out, emitted, dispatched };
}

describe("duplicateInstance", () => {
  it("creates the module AND an occurrence the clicking tab can see", () => {
    const { out, dispatched } = run();
    const mod = dispatched.map((a) => a.payload?.module || a.payload).find((p) => p?.id === out.moduleId);
    expect(mod?.label).toBe("Now (Copy)");
    expect(mod?.fieldBindings).toEqual([{ fieldId: "f1", role: "input" }]);
    const occ = dispatched.map((a) => a.payload?.occurrence || a.payload).find((p) => p?.id === out.occurrenceId);
    expect(occ?.moduleId).toBe(out.moduleId);
    expect(occ?.parentId).toBe("c1");
    expect(occ?.fields?.f1?.value).toBe(3);
  });

  it("lists the copy right after the row, in the row's own parent", () => {
    const { out, emitted } = run();
    const list = emitted.filter((e) => e.event === "update_occurrence" && e.data?.occurrence?.id === "c1").pop();
    expect(list.data.occurrence.occurrences).toEqual(["a", "o1", out.occurrenceId, "b"]);
  });

  it("is one undo step", () => {
    const { emitted } = run();
    const ids = new Set(emitted.filter((e) => /create_|update_/.test(e.event)).map((e) => e.data?.__actionId ?? null));
    expect([...ids]).toHaveLength(1);
    expect([...ids][0]).toBeTruthy();
  });
});
