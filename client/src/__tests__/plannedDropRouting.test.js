// @vitest-environment jsdom
// A piece dragged out of a Magic view lands as a COPY on a board, and leaves nothing behind when it
// lands somewhere that takes no rows. Drives the real routeDrop -> handleDocEmbedDrop.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildDropContext } from "../helpers/dragHitTesting";
import { routeDrop } from "../helpers/dropHandlers";
import { registerPlannedState, __resetPlannedRegistry } from "../helpers/plannedDrop";

const PLANNED = {
  modules: [{ id: "pmTb", role: "textblock", kind: "doc", label: "" }],
  occurrences: [{ id: "ptb", moduleId: "pmTb", textmap: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "kept" }] }] } }],
};
const modules = {
  panelMod: { id: "panelMod", role: "panel", kind: "board", label: "Panel" },
  toContainerMod: { id: "toContainerMod", role: "container", kind: "board", label: "To" },
};
const occs = () => ({
  panelOcc: { id: "panelOcc", moduleId: "panelMod", occurrences: ["toContOcc"] },
  toContOcc: { id: "toContOcc", moduleId: "toContainerMod", occurrences: [] },
});
const ctx = (o) => ({
  dispatch: vi.fn(), socket: { connected: true, emit: vi.fn() },
  state: { modulesById: modules, grid: { _id: "g1" }, gridId: "g1", userId: "u1" },
  occurrencesById: o, baseAllPanels: [modules.panelMod], baseContainers: [modules.toContainerMod],
  clearSession: vi.fn(), sessionRef: { current: { mode: "copy" } }, getCellFromPoint: () => null,
});
const drop = (targetOccId, o) => buildDropContext({
  source: { moduleId: "pmTb", occurrenceId: "ptb", sourceKind: "doc-embed", defaultMode: "move", payloadType: "instance", context: { occurrenceId: "ptb", sourceType: "doc-embed" } },
  hover: { x: 0, y: 0, dropTargetData: { occurrenceId: targetOccId, closestEdge: null } },
  modifiers: {}, pointer: { x: 0, y: 0 }, dataTransfer: null,
}, { occurrencesById: o, modulesById: modules });
const emitted = (c, ev) => c.socket.emit.mock.calls.filter(([e]) => e === ev).map(([, p]) => p);

beforeEach(() => { __resetPlannedRegistry(); registerPlannedState(PLANNED); });

describe("dragging a Magic piece out", () => {
  it("mints a copy and lists it in the board it was dropped on; the planned row is untouched", () => {
    const o = occs(); const c = ctx(o);
    const before = JSON.stringify(PLANNED);
    routeDrop(drop("toContOcc", o), c);
    const made = emitted(c, "create_occurrence").map((p) => p.occurrence);
    expect(made).toHaveLength(1);
    const copy = made[0];
    expect(copy.id).not.toBe("ptb");
    expect(copy.textmap.content[0].content[0].text).toBe("kept");
    const updates = emitted(c, "update_occurrence").map((p) => p.occurrence);
    expect(updates.find((u) => u.id === "toContOcc")?.occurrences).toContain(copy.id);
    expect(updates.find((u) => u.id === copy.id)?.parentId).toBe("toContOcc");
    expect(emitted(c, "delete_occurrence")).toHaveLength(0);
    expect(JSON.stringify(PLANNED)).toBe(before);
    expect(c.sessionRef.current.mode).toBe("copy"); // restored after
  });

  it("removes the copy again when the drop lands where no row can go", () => {
    const o = occs(); const c = ctx(o);
    routeDrop(drop("panelOcc", o), c);
    const made = emitted(c, "create_occurrence").map((p) => p.occurrence);
    expect(made).toHaveLength(1);
    expect(emitted(c, "delete_occurrence").map((p) => p.occurrenceId)).toContain(made[0].id);
  });

  it("an ordinary (non-planned) drop is routed exactly as before", () => {
    __resetPlannedRegistry();
    const o = occs(); const c = ctx(o);
    routeDrop(drop("toContOcc", o), c);
    expect(emitted(c, "create_occurrence")).toHaveLength(0);
  });
});
