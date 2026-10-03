// @vitest-environment jsdom
// A partial `{ id, fields }` write that fires a field trigger must not strip the
// row's placement from the executor's overlay (2026-10-03: Spent stayed 0).
import { describe, it, expect, vi } from "vitest";
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
import { operationsBridge } from "../state/bindSocketToStore";
import * as CommitHelpers from "../helpers/CommitHelpers";

describe("updateOccurrence with triggerField", () => {
  it("keeps parentId / moduleId in the overlay when the payload is partial", () => {
    const store = {};
    const fired = [];
    const saved = { getLocalOcc: operationsBridge.getLocalOcc, updateLocalOcc: operationsBridge.updateLocalOcc, fireOperations: operationsBridge.fireOperations, getAncestorChain: operationsBridge.getAncestorChain };
    operationsBridge.getLocalOcc = (id) => store[id];
    operationsBridge.updateLocalOcc = (o) => { store[o.id] = o; };
    operationsBridge.fireOperations = (type, tx) => fired.push([type, JSON.parse(JSON.stringify(store[tx.occurrenceId]))]);
    operationsBridge.getAncestorChain = () => ({ ids: ["todo"], labels: [] });
    try {
      store.x = { id: "x", moduleId: "m", parentId: "todo", fields: { amt: { value: 5, flow: "in" } } };
      CommitHelpers.updateOccurrence({ dispatch: () => {}, socket: { emit() {}, connected: true }, emit: false,
        occurrence: { id: "x", fields: { amt: { value: 5, flow: "out" } } }, triggerField: [{ fieldId: "amt", value: 5, instanceId: "m" }] });
      expect(fired).toHaveLength(1);
      const seen = fired[0][1];
      expect(seen).toMatchObject({ id: "x", moduleId: "m", parentId: "todo" });
      expect(seen.fields.amt.flow).toBe("out");
    } finally { Object.assign(operationsBridge, saved); }
  });
});
