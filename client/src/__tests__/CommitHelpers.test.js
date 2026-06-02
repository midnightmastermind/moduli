/**
 * CommitHelpers.test.js
 *
 * Tests the CommitHelpers contract:
 * - Every helper dispatches the correct action
 * - Every helper emits the correct socket event
 * - Helpers with emit=false skip socket, but still dispatch
 * - Helpers skip gracefully when dispatch/socket are null
 */

import { describe, test, expect, vi } from "vitest";
import {
  createGrid, updateGrid, deleteGrid,
  createInstanceInContainer,
  createOccurrence, updateOccurrence, deleteOccurrence,
  createField, updateField, deleteField,
  createOperation, updateOperation, deleteOperation,
  createModule, updateModule, deleteModule,
} from "../helpers/CommitHelpers";

// ─── Mock factory ──────────────────────────────────────────────────────────
function makeMocks() {
  return {
    dispatch: vi.fn(),
    // connected:true so safeEmit forwards through to socket.emit instead of queuing
    socket: { emit: vi.fn(), connected: true },
  };
}

// ─── GRID ──────────────────────────────────────────────────────────────────
describe("Grid commit helpers", () => {
  test("createGrid dispatches and emits create_grid", () => {
    const { dispatch, socket } = makeMocks();
    const grid = { id: "g1", cols: 3 };
    createGrid({ dispatch, socket, grid });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(socket.emit).toHaveBeenCalledWith("create_grid", { grid });
  });

  test("updateGrid dispatches and emits update_grid", () => {
    const { dispatch, socket } = makeMocks();
    updateGrid({ dispatch, socket, gridId: "g1", grid: { cols: 4 } });
    expect(socket.emit).toHaveBeenCalledWith("update_grid", { gridId: "g1", grid: { cols: 4 } });
  });

  test("deleteGrid dispatches and emits delete_grid", () => {
    const { dispatch, socket } = makeMocks();
    deleteGrid({ dispatch, socket, gridId: "g1" });
    expect(socket.emit).toHaveBeenCalledWith("delete_grid", { gridId: "g1" });
  });

  test("createGrid skips if grid is null", () => {
    const { dispatch, socket } = makeMocks();
    createGrid({ dispatch, socket, grid: null });
    expect(dispatch).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });
});

// ─── MODULES (unified — replaces createPanel/updatePanel/etc.) ─────────────
describe("Module commit helpers (unified Panel + Container + Instance)", () => {
  test("createModule dispatches and emits create_module", () => {
    const { dispatch, socket } = makeMocks();
    createModule({ dispatch, socket, module: { id: "m1", role: "panel" } });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(socket.emit).toHaveBeenCalledWith("create_module", { module: { id: "m1", role: "panel" } });
  });

  test("updateModule dispatches and emits update_module", () => {
    const { dispatch, socket } = makeMocks();
    updateModule({ dispatch, socket, module: { id: "m1", label: "Patched" } });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(socket.emit).toHaveBeenCalledWith("update_module", { module: { id: "m1", label: "Patched" } });
  });

  test("deleteModule dispatches and emits delete_module", () => {
    const { dispatch, socket } = makeMocks();
    deleteModule({ dispatch, socket, moduleId: "m1" });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(socket.emit).toHaveBeenCalledWith("delete_module", { moduleId: "m1" });
  });

  test("createModule with role=container emits create_module", () => {
    const { dispatch, socket } = makeMocks();
    createModule({ dispatch, socket, module: { id: "c1", role: "container", label: "Todo" } });
    expect(socket.emit).toHaveBeenCalledWith("create_module", { module: { id: "c1", role: "container", label: "Todo" } });
  });

  test("createModule with role=instance emits create_module", () => {
    const { dispatch, socket } = makeMocks();
    createModule({ dispatch, socket, module: { id: "i1", role: "instance", label: "Exercise" } });
    expect(socket.emit).toHaveBeenCalledWith("create_module", { module: { id: "i1", role: "instance", label: "Exercise" } });
  });

  test("updateModule with emit=false skips socket but dispatches", () => {
    const { dispatch, socket } = makeMocks();
    updateModule({ dispatch, socket, module: { id: "m1" }, emit: false });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  test("updateModule skips if module has no id", () => {
    const { dispatch, socket } = makeMocks();
    updateModule({ dispatch, socket, module: {} });
    expect(dispatch).not.toHaveBeenCalled();
  });

  test("deleteModule skips if moduleId is falsy", () => {
    const { dispatch, socket } = makeMocks();
    deleteModule({ dispatch, socket, moduleId: null });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// ─── INSTANCE IN CONTAINER ─────────────────────────────────────────────────
describe("createInstanceInContainer commit helper", () => {
  test("dispatches and emits create_instance_in_container", () => {
    const { dispatch, socket } = makeMocks();
    createInstanceInContainer({
      dispatch, socket,
      containerId: "c1",
      instance: { id: "i1", label: "Task" },
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(socket.emit).toHaveBeenCalledWith("create_instance_in_container", {
      containerId: "c1",
      instance: { id: "i1", label: "Task" },
    });
  });

  test("skips if instance has no id", () => {
    const { dispatch, socket } = makeMocks();
    createInstanceInContainer({ dispatch, socket, containerId: "c1", instance: {} });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// ─── OCCURRENCES ───────────────────────────────────────────────────────────
describe("Occurrence commit helpers", () => {
  test("createOccurrence dispatches and emits create_occurrence", () => {
    const { dispatch, socket } = makeMocks();
    const occurrence = { id: "occ1", targetType: "module" };
    createOccurrence({ dispatch, socket, occurrence });
    expect(socket.emit).toHaveBeenCalledWith("create_occurrence", { occurrence });
  });

  test("updateOccurrence dispatches and emits update_occurrence", () => {
    const { dispatch, socket } = makeMocks();
    const occurrence = { id: "occ1", fields: {} };
    updateOccurrence({ dispatch, socket, occurrence });
    expect(socket.emit).toHaveBeenCalledWith("update_occurrence", { occurrence });
  });

  test("deleteOccurrence dispatches and emits delete_occurrence", () => {
    const { dispatch, socket } = makeMocks();
    deleteOccurrence({ dispatch, socket, occurrenceId: "occ1" });
    expect(socket.emit).toHaveBeenCalledWith("delete_occurrence", { occurrenceId: "occ1" });
  });

  // Regression: an operation-effect delete (applyOperationEffect → DELETE_ITEM)
  // calls deleteOccurrence WITHOUT an `occurrence` arg. deleteOccurrence must
  // snapshot the occurrence from the local cache (getLocalOcc) BEFORE eviction
  // and pass it as occurrencesOverride on the OccurrenceDeleteOp fire — that
  // override is what lets the executor enrich $trigger.occurrence so the
  // Table/Canvas "Build" self-trigger guard can match
  // `$trigger.occurrence._ancestors HAS_ANCESTOR <ownPageId>` and skip the
  // rebuild. Without it the rebuild's orphan-sweep deletes re-fire the rebuild
  // → exponential freeze.
  test("deleteOccurrence sources snapshot from cache and passes it as override", async () => {
    const { dispatch, socket } = makeMocks();
    const { operationsBridge } = await import("../state/bindSocketToStore");
    const snap = { id: "occ1", moduleId: "mod1", parentId: "tbl1", fields: {} };
    const fireOperations = vi.fn();
    const getLocalOcc = vi.fn(() => snap);
    operationsBridge.getLocalOcc = getLocalOcc;
    operationsBridge.removeLocalOcc = vi.fn();
    operationsBridge.fireOperations = fireOperations;
    try {
      deleteOccurrence({ dispatch, socket, occurrenceId: "occ1" });
      expect(getLocalOcc).toHaveBeenCalledWith("occ1");
      const deleteCall = fireOperations.mock.calls.find(c => c[0] === "OccurrenceDeleteOp");
      expect(deleteCall).toBeTruthy();
      expect(deleteCall[1]).toMatchObject({ occurrenceId: "occ1", containerId: "tbl1" });
      expect(deleteCall[2]).toEqual({ occurrencesOverride: { occ1: snap } });
    } finally {
      operationsBridge.getLocalOcc = null;
      operationsBridge.removeLocalOcc = null;
      operationsBridge.fireOperations = null;
    }
  });

  // Cycle breaker: an operation effect deleting DERIVED data (a mirror op's
  // row/card copy) passes fireTrigger:false. The deletion must still propagate
  // (dispatch + socket emit + cache eviction) but must NOT fire
  // OccurrenceDeleteOp — re-aggregating trackers over a deleted derived row
  // (never under the Schedule scope) is pure waste and was the ~5s post-loop
  // freeze. User-initiated deletes keep the default fireTrigger:true.
  test("deleteOccurrence with fireTrigger:false still deletes but skips the OccurrenceDeleteOp fire", async () => {
    const { dispatch, socket } = makeMocks();
    const { operationsBridge } = await import("../state/bindSocketToStore");
    const snap = { id: "occ1", moduleId: "mod1", parentId: "tbl1", fields: { f1: { value: 2 } } };
    const fireOperations = vi.fn();
    operationsBridge.getLocalOcc = vi.fn(() => snap);
    operationsBridge.removeLocalOcc = vi.fn();
    operationsBridge.fireOperations = fireOperations;
    try {
      deleteOccurrence({ dispatch, socket, occurrenceId: "occ1", fireTrigger: false });
      // Deletion still propagated:
      expect(operationsBridge.removeLocalOcc).toHaveBeenCalledWith("occ1");
      expect(socket.emit).toHaveBeenCalledWith("delete_occurrence", { occurrenceId: "occ1" });
      // But NO trigger fired:
      expect(fireOperations).not.toHaveBeenCalled();
    } finally {
      operationsBridge.getLocalOcc = null;
      operationsBridge.removeLocalOcc = null;
      operationsBridge.fireOperations = null;
    }
  });

  test("updateOccurrence skips if occurrence has no id", () => {
    const { dispatch, socket } = makeMocks();
    updateOccurrence({ dispatch, socket, occurrence: {} });
    expect(dispatch).not.toHaveBeenCalled();
  });

  // Uniform-trigger rule: each user action fires exactly ONE trigger type.
  // A create fires OccurrenceCreateOp (matches onAdd) and NOT a piggyback
  // MeasureOp — onChange is reserved for actual value edits on an existing
  // occurrence. The OccurrenceCreateOp carries `fields` so field-scoped
  // onAdd subscribers (subjectType:"field") still match.
  test("createOccurrence fires OccurrenceCreateOp only (no piggyback MeasureOp) and carries fields", async () => {
    const { dispatch, socket } = makeMocks();
    const { operationsBridge } = await import("../state/bindSocketToStore");
    const fireOperations = vi.fn();
    operationsBridge.fireOperations = fireOperations;
    try {
      const occurrence = { id: "occ1", moduleId: "mod1", parentId: "c1", fields: { f1: { value: 5 } } };
      createOccurrence({ dispatch, socket, occurrence });
      const types = fireOperations.mock.calls.map(c => c[0]);
      expect(types).toContain("OccurrenceCreateOp");
      expect(types).not.toContain("MeasureOp");
      const createCall = fireOperations.mock.calls.find(c => c[0] === "OccurrenceCreateOp");
      expect(createCall[1].fields).toEqual({ f1: { value: 5 } });
    } finally {
      operationsBridge.fireOperations = null;
    }
  });

  // Same rule on the delete path: one OccurrenceDeleteOp carrying fields, no
  // piggyback MeasureOp.
  test("deleteOccurrence fires OccurrenceDeleteOp only and the transaction carries fields", async () => {
    const { dispatch, socket } = makeMocks();
    const { operationsBridge } = await import("../state/bindSocketToStore");
    const snap = { id: "occ1", moduleId: "mod1", parentId: "c1", fields: { f1: { value: 7 } } };
    const fireOperations = vi.fn();
    operationsBridge.getLocalOcc = vi.fn(() => snap);
    operationsBridge.removeLocalOcc = vi.fn();
    operationsBridge.fireOperations = fireOperations;
    try {
      deleteOccurrence({ dispatch, socket, occurrenceId: "occ1" });
      const types = fireOperations.mock.calls.map(c => c[0]);
      expect(types).toEqual(["OccurrenceDeleteOp"]);
      const deleteCall = fireOperations.mock.calls.find(c => c[0] === "OccurrenceDeleteOp");
      expect(deleteCall[1].fields).toEqual({ f1: { value: 7 } });
    } finally {
      operationsBridge.getLocalOcc = null;
      operationsBridge.removeLocalOcc = null;
      operationsBridge.fireOperations = null;
    }
  });
});

// ─── FIELDS ────────────────────────────────────────────────────────────────
describe("Field commit helpers", () => {
  test("createField dispatches and emits create_field", () => {
    const { dispatch, socket } = makeMocks();
    createField({ dispatch, socket, field: { id: "f1", name: "Duration" } });
    expect(socket.emit).toHaveBeenCalledWith("create_field", { field: { id: "f1", name: "Duration" } });
  });

  test("updateField dispatches and emits update_field", () => {
    const { dispatch, socket } = makeMocks();
    updateField({ dispatch, socket, field: { id: "f1", displayEnabled: true } });
    expect(socket.emit).toHaveBeenCalledWith("update_field", { field: { id: "f1", displayEnabled: true } });
  });

  test("deleteField dispatches and emits delete_field", () => {
    const { dispatch, socket } = makeMocks();
    deleteField({ dispatch, socket, fieldId: "f1" });
    expect(socket.emit).toHaveBeenCalledWith("delete_field", { fieldId: "f1" });
  });
});

// ─── OPERATIONS ────────────────────────────────────────────────────────────
describe("Operation commit helpers", () => {
  test("createOperation dispatches and emits create_operation", () => {
    const { dispatch, socket } = makeMocks();
    createOperation({ dispatch, socket, operation: { id: "op1", name: "Budget Alert" } });
    expect(socket.emit).toHaveBeenCalledWith("create_operation", { operation: { id: "op1", name: "Budget Alert" } });
  });

  test("updateOperation dispatches and emits update_operation", () => {
    const { dispatch, socket } = makeMocks();
    updateOperation({ dispatch, socket, operation: { id: "op1", enabled: true } });
    expect(socket.emit).toHaveBeenCalledWith("update_operation", { operation: { id: "op1", enabled: true } });
  });

  test("deleteOperation dispatches and emits delete_operation", () => {
    const { dispatch, socket } = makeMocks();
    deleteOperation({ dispatch, socket, operationId: "op1" });
    expect(socket.emit).toHaveBeenCalledWith("delete_operation", { operationId: "op1" });
  });
});

// ─── NULL SAFETY ───────────────────────────────────────────────────────────
describe("Null safety — all helpers tolerate missing dispatch/socket", () => {
  test("updateModule works without dispatch", () => {
    const { socket } = makeMocks();
    expect(() => updateModule({ socket, module: { id: "m1" } })).not.toThrow();
  });

  test("updateModule works without socket", () => {
    const { dispatch } = makeMocks();
    expect(() => updateModule({ dispatch, module: { id: "m1" } })).not.toThrow();
  });

  test("updateModule works without both", () => {
    expect(() => updateModule({ module: { id: "m1" } })).not.toThrow();
  });

  test("deleteModule works without both", () => {
    expect(() => deleteModule({ moduleId: "m1" })).not.toThrow();
  });
});
