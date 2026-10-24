// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { externalDragData, externalDragKind, acceptsExternal, parseExternalDrop, dragModeOf, NATIVE_DND_MIME, createPayload, DragType } from "../helpers/dragSystem.js";

afterEach(() => { delete window.__moduli_state__; });

/** What another window would hand us: its serialized drag, as a DataTransfer-like source. */
function fromOtherWindow(payload, gridId) {
  window.__moduli_state__ = { grid: { _id: gridId } };
  const data = externalDragData({ ...payload, sourceWindowId: "other-window" });
  const raw = JSON.parse(data[NATIVE_DND_MIME]); raw.sourceWindowId = "other-window";
  data[NATIVE_DND_MIME] = JSON.stringify(raw);
  return { types: Object.keys(data), getData: (t) => data[t] };
}

describe("dragging between windows", () => {
  it("carries the handle's mode", () => {
    expect(dragModeOf({ data: { occurrence: { dragMode: "copylink" } } })).toBe("copylink");
    expect(dragModeOf({ data: { defaultDragMode: "copy" } })).toBe("copy");
    expect(dragModeOf({ data: {} })).toBe("move");
  });

  it("a drop from another window on THIS grid is an ordinary drop, with its mode", () => {
    const p = createPayload(DragType.INSTANCE, "m1", { occurrence: { id: "o1", dragMode: "copy" } }, { occurrenceId: "o1" });
    const dt = fromOtherWindow(p, "G1");
    window.__moduli_state__ = { grid: { _id: "G1" } };
    const parsed = parseExternalDrop(dt);
    expect(parsed.fromOtherWindow).toBe(true);
    expect(parsed.isCrossWindow).toBe(false);
    expect(parsed.mode).toBe("copy");
    expect(parsed.occurrenceId).toBe("o1");
  });

  it("a drop from a window on ANOTHER grid is marked so (the server copies it in)", () => {
    const p = createPayload(DragType.INSTANCE, "m1", { occurrence: { id: "o1" } }, { occurrenceId: "o1" });
    const dt = fromOtherWindow(p, "G1");
    window.__moduli_state__ = { grid: { _id: "G2" } };
    const parsed = parseExternalDrop(dt);
    expect(parsed.isCrossWindow).toBe(true);
    expect(parsed.sourceGridId).toBe("G1");
  });

  it("a target takes a foreign drag by the kind it names, as it would here", () => {
    const types = Object.keys(externalDragData({ type: "container", data: {} }));
    expect(externalDragKind(types)).toBe("container");
    expect(acceptsExternal(["instance", "file"], types)).toBe(false);
    expect(acceptsExternal(["container"], types)).toBe(true);
    expect(acceptsExternal(["instance"], ["Files"])).toBe(true);   // an OS file, as before
    expect(acceptsExternal([], types)).toBe(false);
  });
});
