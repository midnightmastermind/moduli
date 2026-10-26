// @vitest-environment jsdom
// A copied row keeps its own name (user, 2026-10-26: "when i copied my clean hotel room to the schedule, the label
// was just clean (the original modules label)").
import { describe, it, expect, vi } from "vitest";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { copyInstanceToContainer } from "../helpers/LayoutHelpers";

describe("copyInstanceToContainer", () => {
  it("carries the row's own label, and leaves it off when the row has none", () => {
    const spy = vi.spyOn(CommitHelpers, "createOccurrence").mockImplementation(() => {});
    vi.spyOn(CommitHelpers, "updateOccurrence").mockImplementation(() => {});
    const base = { dispatch: () => {}, socket: null, gridId: "g", sourceInstanceId: "m-clean", userId: "u", emit: false,
      toContainer: { label: "9:00am", _occurrence: { id: "slot", occurrences: [] } } };
    copyInstanceToContainer({ ...base, sourceOccurrence: { id: "o1", label: "Clean Hotel Room", fields: {} } });
    copyInstanceToContainer({ ...base, sourceOccurrence: { id: "o2", fields: {} } });
    const made = spy.mock.calls.map((c) => c[0].occurrence);
    expect(made[0].label).toBe("Clean Hotel Room");
    expect(made[0].moduleId).toBe("m-clean");
    expect("label" in made[1]).toBe(false);
    vi.restoreAllMocks();
  });
});
