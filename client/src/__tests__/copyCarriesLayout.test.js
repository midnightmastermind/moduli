// A copied placement carries its row layout (user, 2026-10-15).
import { describe, it, expect } from "vitest";
import * as LayoutHelpers from "../helpers/LayoutHelpers";

const layout = { tree: { dir: "row", items: ["label"] } };
const src = { id: "s", moduleId: "m", fields: {}, meta: { instanceLayout: layout, x: 3 } };
const createdBy = (dispatch) => dispatch.mock.calls.map((c) => c[0]).filter((a) => a?.payload?.occurrence || a?.occurrence)
  .map((a) => a.payload?.occurrence || a.occurrence).find((o) => o.moduleId === "m" && o.id !== "s");
import { vi } from "vitest";

describe("copies carry the placement's layout", () => {
  it("copy", () => {
    const dispatch = vi.fn();
    LayoutHelpers.copyInstanceToContainer({ dispatch, socket: null, gridId: "g", sourceInstanceId: "m",
      toContainer: { id: "c", _occurrence: { id: "co", occurrences: [] } }, userId: "u", sourceOccurrence: src, emit: false });
    const occ = createdBy(dispatch);
    expect(occ.meta.instanceLayout).toEqual(layout);
    expect(occ.meta.x).toBeUndefined();
  });
  it("copy-link", () => {
    const dispatch = vi.fn();
    LayoutHelpers.mintLinkedCopy({ dispatch, socket: null, gridId: "g", sourceInstanceId: "m", userId: "u",
      sourceOccurrence: { ...src, linkedGroupId: "lg" }, parentId: "p", emit: false });
    expect(createdBy(dispatch).meta.instanceLayout).toEqual(layout);
  });
});
