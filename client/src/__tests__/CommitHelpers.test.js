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

  test("updateOccurrence skips if occurrence has no id", () => {
    const { dispatch, socket } = makeMocks();
    updateOccurrence({ dispatch, socket, occurrence: {} });
    expect(dispatch).not.toHaveBeenCalled();
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
