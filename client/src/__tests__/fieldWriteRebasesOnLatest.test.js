// A field edit is written from the row the component last RENDERED. That copy can be behind: an operation
// stamped another field (Completed On) a moment ago, or a child was listed. The write sent the whole stale row
// and the server merges shallowly, so the edit put the other field back — and could overwrite a child list.
// A field edit (one that names its fields through `triggerField`) now sends only `id` + `fields`, with the
// named fields from the caller and every other field from the latest local copy (2026-11-04).
import { describe, it, expect, vi, afterEach } from "vitest";
import { updateOccurrence } from "../helpers/CommitHelpers";
import { operationsBridge } from "../state/bindSocketToStore";

const saved = { getLocalOcc: operationsBridge.getLocalOcc, updateLocalOcc: operationsBridge.updateLocalOcc, fireOperations: operationsBridge.fireOperations };
afterEach(() => Object.assign(operationsBridge, saved));

function setup(latest) {
  const socket = { emit: vi.fn(), connected: true };
  operationsBridge.getLocalOcc = (id) => (id === latest?.id ? latest : null);
  operationsBridge.updateLocalOcc = vi.fn();
  operationsBridge.fireOperations = vi.fn();
  return socket;
}
const sent = (socket) => socket.emit.mock.calls.find((c) => c[0] === "update_occurrence")?.[1]?.occurrence;

const rendered = {
  id: "row", moduleId: "m", occurrences: ["a"], meta: { old: true },
  fields: { done: { value: false, flow: "in" }, on: { value: null, flow: "replace" } },
};
const latest = {
  id: "row", moduleId: "m", occurrences: ["a", "b"], meta: { old: true, newer: 1 },
  fields: { done: { value: true, flow: "in" }, on: { value: "2026-11-04", flow: "replace" } },
};

describe("a field edit is written over the latest copy of the row", () => {
  it("keeps a field an operation wrote after the render, and sends only id + fields", () => {
    const socket = setup(latest);
    updateOccurrence({ dispatch: vi.fn(), socket, occurrence: rendered, emit: true, triggerField: { fieldId: "done", value: false, instanceId: "m" } });
    const occ = sent(socket);
    expect(occ.fields.done).toEqual({ value: false, flow: "in" });
    expect(occ.fields.on).toEqual({ value: "2026-11-04", flow: "replace" });
    expect(Object.keys(occ).sort()).toEqual(["fields", "id"]);
  });

  it("every field the caller names comes from the caller (a pick and its prefills)", () => {
    const socket = setup(latest);
    const withFill = { ...rendered, fields: { ...rendered.fields, on: { value: "2026-01-01", flow: "replace" } } };
    updateOccurrence({ dispatch: vi.fn(), socket, occurrence: withFill, emit: true,
      triggerField: [{ fieldId: "done", value: false }, { fieldId: "on", value: "2026-01-01" }] });
    expect(sent(socket).fields.on.value).toBe("2026-01-01");
  });

  it("a write without triggerField is sent as given — the control", () => {
    const socket = setup(latest);
    updateOccurrence({ dispatch: vi.fn(), socket, occurrence: rendered, emit: true });
    expect(sent(socket)).toEqual(rendered);
  });

  it("with no local copy, the caller's fields are sent as they are", () => {
    const socket = setup(null);
    updateOccurrence({ dispatch: vi.fn(), socket, occurrence: rendered, emit: true, triggerField: { fieldId: "done", value: false } });
    expect(sent(socket).fields).toEqual(rendered.fields);
  });
});
