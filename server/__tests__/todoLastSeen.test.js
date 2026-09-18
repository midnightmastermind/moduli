// 0340 — the Todo container's Last Seen chip.
//
// The rule and its risk come from 0067: hide the BINDING, never the value.
// Slots and feeds FIND containers by those values, so a migration that clears
// one breaks the thing it was tidying.
import { describe, it, expect } from "vitest";
import { todosShowingLastSeen } from "../migrations/0340-the-todo-stops-showing-last-seen.mjs";

const LS = "fld-last-seen";
const todo = (bindings) => ({ id: "m-todo", role: "container", label: "Todo", fieldBindings: bindings });

describe("0340 todosShowingLastSeen", () => {
  it("hides the Last Seen binding and leaves its other keys intact", () => {
    const [t] = todosShowingLastSeen([todo([{ fieldId: LS, role: "input", order: 2 }])], LS);
    expect(t.nextBindings).toEqual([{ fieldId: LS, role: "input", order: 2, hidden: true }]);
  });

  it("touches ONLY that binding — the Todo's other chips are not its business", () => {
    const [t] = todosShowingLastSeen(
      [todo([{ fieldId: "f-date", order: 1 }, { fieldId: LS, order: 2 }, { fieldId: "f-ts", order: 0, hidden: true }])],
      LS);
    expect(t.nextBindings.filter((b) => b.hidden)).toHaveLength(2);
    expect(t.nextBindings.find((b) => b.fieldId === "f-date").hidden).toBeUndefined();
  });

  it("NEVER returns a value — only the binding array is planned", () => {
    const [t] = todosShowingLastSeen([todo([{ fieldId: LS }])], LS);
    expect(Object.keys(t)).toEqual(["module", "nextBindings"]);
  });

  it("skips a Todo that is already quiet, so a re-run writes nothing", () => {
    expect(todosShowingLastSeen([todo([{ fieldId: LS, hidden: true }])], LS)).toEqual([]);
  });

  it("REFUSES an INSTANCE that binds Last Seen — its chips are the data", () => {
    // The discriminating case: 0067's role gate, and the whole reason the
    // tasks on screen keep showing theirs.
    const inst = { id: "i", role: "instance", label: "Todo", fieldBindings: [{ fieldId: LS }] };
    expect(todosShowingLastSeen([inst], LS)).toEqual([]);
  });

  it("REFUSES a container that is not a Todo", () => {
    const other = { id: "m-x", role: "container", label: "Tasks Completed", fieldBindings: [{ fieldId: LS }] };
    expect(todosShowingLastSeen([other], LS)).toEqual([]);
  });

  it("matches the label case-insensitively and whole, not as a substring", () => {
    const yes = { id: "a", role: "container", label: "TODO", fieldBindings: [{ fieldId: LS }] };
    const no = { id: "b", role: "container", label: "Todo Archive", fieldBindings: [{ fieldId: LS }] };
    expect(todosShowingLastSeen([yes, no], LS).map((t) => t.module.id)).toEqual(["a"]);
  });

  it("tolerates a Todo with no bindings at all", () => {
    expect(todosShowingLastSeen([todo(undefined)], LS)).toEqual([]);
  });

  it("plans nothing without a field id, rather than hiding every binding", () => {
    expect(todosShowingLastSeen([todo([{ fieldId: LS }])], null)).toEqual([]);
  });
});
