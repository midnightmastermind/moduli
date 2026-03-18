// __tests__/bindSocketToStore.test.js
// ============================================================
// Tests for bindSocketToStore — the bridge between socket events and Redux state.
// Pattern: create mock socket + dispatch, call bindSocketToStore, emit events,
// verify dispatch was called with the correct action type and payload.
// ============================================================

import { describe, test, expect, vi, beforeEach } from "vitest";
import { bindSocketToStore } from "../state/bindSocketToStore";
import { ActionTypes } from "../state/actions";

// ─── localStorage mock ────────────────────────────────────────────────────────
// jsdom's localStorage doesn't expose .clear() reliably in all vitest versions
const localStorageStore = {};
const localStorageMock = {
  getItem: (k) => localStorageStore[k] ?? null,
  setItem: (k, v) => { localStorageStore[k] = String(v); },
  removeItem: (k) => { delete localStorageStore[k]; },
};
vi.stubGlobal("localStorage", localStorageMock);

// ─── Mock EventEmitter (minimal socket) ──────────────────────────────────────

function makeMockSocket() {
  const listeners = {};
  return {
    on(event, fn) {
      listeners[event] = fn;
    },
    emit(event, ...args) {
      // called BY the handler (e.g. socket.emit("request_full_state"))
    },
    _trigger(event, ...args) {
      // test helper: fire an incoming event as if server sent it
      if (listeners[event]) listeners[event](...args);
    },
    _listeners: listeners,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setup(stateOverride = {}) {
  const socket = makeMockSocket();
  const dispatched = [];
  const dispatch = (action) => dispatched.push(action);
  const stateRef = { current: { modules: [], occurrences: [], operations: [], fields: [], ...stateOverride } };
  bindSocketToStore(socket, dispatch, stateRef);
  return { socket, dispatched, stateRef };
}

// Pull only the non-_fromSocket fields for cleaner assertions
function actionOf(dispatched, type) {
  return dispatched.find(a => a.type === type);
}

// ─── FULL_STATE ───────────────────────────────────────────────────────────────

describe("full_state", () => {
  beforeEach(() => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); });

  test("dispatches FULL_STATE action with payload", () => {
    const { socket, dispatched } = setup();
    socket._trigger("full_state", { gridId: "g1", modules: [], occurrences: [], fields: [], operations: [] });
    const action = actionOf(dispatched, ActionTypes.FULL_STATE);
    expect(action).toBeDefined();
    expect(action.payload.gridId).toBe("g1");
  });

  test("persists gridId to localStorage", () => {
    const { socket } = setup();
    socket._trigger("full_state", { gridId: "g42", modules: [], occurrences: [], fields: [], operations: [] });
    expect(localStorage.getItem("moduli-gridId")).toBe("g42");
  });

  test("does not crash when payload is empty", () => {
    const { socket, dispatched } = setup();
    expect(() => socket._trigger("full_state", {})).not.toThrow();
    expect(actionOf(dispatched, ActionTypes.FULL_STATE)).toBeDefined();
  });
});

// ─── MODULES ─────────────────────────────────────────────────────────────────

describe("module_created / updated / deleted", () => {
  test("module_created dispatches CREATE_MODULE", () => {
    const { socket, dispatched } = setup();
    socket._trigger("module_created", { module: { id: "m1", label: "Test", role: "instance" } });
    const action = actionOf(dispatched, ActionTypes.CREATE_MODULE);
    expect(action).toBeDefined();
  });

  test("module_created with no id does nothing", () => {
    const { socket, dispatched } = setup();
    socket._trigger("module_created", { module: { label: "no id" } });
    expect(actionOf(dispatched, ActionTypes.CREATE_MODULE)).toBeUndefined();
  });

  test("module_updated dispatches UPDATE_MODULE", () => {
    const { socket, dispatched } = setup();
    socket._trigger("module_updated", { module: { id: "m1", label: "Updated" } });
    const action = actionOf(dispatched, ActionTypes.UPDATE_MODULE);
    expect(action).toBeDefined();
  });

  test("module_deleted dispatches DELETE_MODULE", () => {
    const { socket, dispatched } = setup();
    socket._trigger("module_deleted", { moduleId: "m1" });
    const action = actionOf(dispatched, ActionTypes.DELETE_MODULE);
    expect(action).toBeDefined();
  });
});

// ─── OCCURRENCES ─────────────────────────────────────────────────────────────

describe("occurrence_created / updated / deleted", () => {
  test("occurrence_created dispatches CREATE_OCCURRENCE with occurrence", () => {
    const { socket, dispatched } = setup();
    socket._trigger("occurrence_created", { occurrence: { id: "occ1", targetId: "m1" } });
    const action = actionOf(dispatched, ActionTypes.CREATE_OCCURRENCE);
    expect(action).toBeDefined();
    expect(action.payload.occurrence.id).toBe("occ1");
  });

  test("occurrence_created with no id does nothing", () => {
    const { socket, dispatched } = setup();
    socket._trigger("occurrence_created", { occurrence: { targetId: "m1" } });
    expect(actionOf(dispatched, ActionTypes.CREATE_OCCURRENCE)).toBeUndefined();
  });

  test("occurrence_updated dispatches UPDATE_OCCURRENCE", () => {
    const { socket, dispatched } = setup();
    socket._trigger("occurrence_updated", { occurrence: { id: "occ1", fields: { f1: { value: 5 } } } });
    const action = actionOf(dispatched, ActionTypes.UPDATE_OCCURRENCE);
    expect(action).toBeDefined();
    expect(action.payload.occurrence.id).toBe("occ1");
  });

  test("occurrence_deleted dispatches DELETE_OCCURRENCE by occurrenceId", () => {
    const { socket, dispatched } = setup();
    socket._trigger("occurrence_deleted", { occurrenceId: "occ1" });
    const action = actionOf(dispatched, ActionTypes.DELETE_OCCURRENCE);
    expect(action).toBeDefined();
    expect(action.payload.occurrenceId).toBe("occ1");
  });

  test("occurrence_deleted accepts legacy id field", () => {
    const { socket, dispatched } = setup();
    socket._trigger("occurrence_deleted", { id: "occ2" });
    const action = actionOf(dispatched, ActionTypes.DELETE_OCCURRENCE);
    expect(action?.payload.occurrenceId).toBe("occ2");
  });

  test("occurrence_created updates localOccsById (used by fireOperations)", () => {
    // Verify that after occurrence_created, a subsequent occurrence_updated
    // dispatches the updated data — this validates the local cache is live
    const { socket, dispatched } = setup();
    socket._trigger("occurrence_created", { occurrence: { id: "occ5", targetId: "m1", fields: {} } });
    socket._trigger("occurrence_updated", { occurrence: { id: "occ5", targetId: "m1", fields: { f1: { value: 99 } } } });
    const updates = dispatched.filter(a => a.type === ActionTypes.UPDATE_OCCURRENCE);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.occurrence.fields.f1.value).toBe(99);
  });
});

// ─── FIELDS ──────────────────────────────────────────────────────────────────

describe("field_created / updated / deleted", () => {
  test("field_created dispatches CREATE_FIELD", () => {
    const { socket, dispatched } = setup();
    socket._trigger("field_created", { field: { id: "f1", name: "Score", type: "number" } });
    expect(actionOf(dispatched, ActionTypes.CREATE_FIELD)).toBeDefined();
  });

  test("field_updated dispatches UPDATE_FIELD", () => {
    const { socket, dispatched } = setup();
    socket._trigger("field_updated", { field: { id: "f1", name: "Score Updated" } });
    const action = actionOf(dispatched, ActionTypes.UPDATE_FIELD);
    expect(action).toBeDefined();
    expect(action.payload.field.name).toBe("Score Updated");
  });

  test("field_deleted dispatches DELETE_FIELD", () => {
    const { socket, dispatched } = setup();
    socket._trigger("field_deleted", { fieldId: "f1" });
    const action = actionOf(dispatched, ActionTypes.DELETE_FIELD);
    expect(action).toBeDefined();
    expect(action.payload.fieldId).toBe("f1");
  });

  test("field_deleted with no id does nothing", () => {
    const { socket, dispatched } = setup();
    socket._trigger("field_deleted", {});
    expect(actionOf(dispatched, ActionTypes.DELETE_FIELD)).toBeUndefined();
  });
});

// ─── GRIDS ───────────────────────────────────────────────────────────────────

describe("grid_updated / deleted / created", () => {
  beforeEach(() => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); });

  test("grid_updated dispatches UPDATE_GRID", () => {
    const { socket, dispatched } = setup();
    socket._trigger("grid_updated", { gridId: "g1", activeFilterId: "f_daily" });
    const action = actionOf(dispatched, ActionTypes.UPDATE_GRID);
    expect(action).toBeDefined();
    expect(action.payload.gridId).toBe("g1");
  });

  test("grid_updated with activeFilterValues fires NavigationOp (no crash)", () => {
    const { socket, dispatched } = setup();
    expect(() => {
      socket._trigger("grid_updated", {
        gridId: "g1",
        activeFilterValues: { fieldDate: "2026-03-16T00:00:00.000Z" },
      });
    }).not.toThrow();
    expect(actionOf(dispatched, ActionTypes.UPDATE_GRID)).toBeDefined();
  });

  test("grid_deleted dispatches DELETE_GRID", () => {
    const { socket, dispatched } = setup();
    socket._trigger("grid_deleted", { gridId: "g1" });
    const action = actionOf(dispatched, ActionTypes.DELETE_GRID);
    expect(action).toBeDefined();
    expect(action.payload.gridId).toBe("g1");
  });

  test("grid_deleted clears localStorage when it matches saved gridId", () => {
    localStorage.setItem("moduli-gridId", "g_active");
    const { socket } = setup();
    socket._trigger("grid_deleted", { gridId: "g_active" });
    expect(localStorage.getItem("moduli-gridId")).toBeNull();
  });

  test("grid_deleted does NOT clear localStorage when gridId does not match", () => {
    localStorage.setItem("moduli-gridId", "g_other");
    const { socket } = setup();
    socket._trigger("grid_deleted", { gridId: "g_unrelated" });
    expect(localStorage.getItem("moduli-gridId")).toBe("g_other");
  });

  test("grid_created dispatches CREATE_GRID", () => {
    const { socket, dispatched } = setup();
    socket._trigger("grid_created", { grid: { id: "g2", name: "New Grid" } });
    const action = actionOf(dispatched, ActionTypes.CREATE_GRID);
    expect(action).toBeDefined();
  });
});

// ─── _fromSocket tag ─────────────────────────────────────────────────────────

describe("_fromSocket tag", () => {
  test("all dispatched actions are tagged _fromSocket: true", () => {
    const { socket, dispatched } = setup();
    socket._trigger("module_created", { module: { id: "m1", label: "x" } });
    socket._trigger("occurrence_created", { occurrence: { id: "occ1" } });
    socket._trigger("field_created", { field: { id: "f1" } });
    for (const a of dispatched) {
      expect(a._fromSocket).toBe(true);
    }
  });
});
