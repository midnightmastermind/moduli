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
  createLeafInstanceAtIndex,
  createPageInContainer, createChildInContainer,
  createTextblockInContainer, createContainerInContainer,
} from "../helpers/CommitHelpers";
import { operationsBridge } from "../state/bindSocketToStore";

// ─── Mock factory ──────────────────────────────────────────────────────────
function makeMocks() {
  return {
    dispatch: vi.fn(),
    // connected:true so safeEmit forwards through to socket.emit instead of queuing
    socket: { emit: vi.fn(), connected: true },
  };
}

// ─── ONE WRITE, SEVERAL TRIGGERS ───────────────────────────────────────────
// A dropdown pick that prefills the values it implies is ONE socket write
// carrying the pick and its fills (helpers/prefillFromPick). Each changed field
// still has to fire its own MeasureOp, because a tracker subscribes to a FIELD —
// a filled Protein must move the day's Protein exactly as a typed one does.
// ── The cascade hold is armed FROM THE WRITE PATH (2026-09-06) ─────────────
//
// User: "its taking a second to mark something complete if i just marked it on
// a diff occurance". One `Completed` write fires a sweep measured at 570-690ms
// over the live grid's 74 pipelines, so tick B's deferred paint waits on tick
// A's one long synchronous task. `interactionHold` already defers this class of
// fire — it was armed by DragProvider alone, so a tap got none of it.
//
// THE WIRING IS TWO LINES AT A SEAM `bindSocketToStore`'s own tests cannot
// reach, which is exactly why the ORDER is asserted here instead: arming after
// the fire would let the first held fire escape and change nothing.
describe("updateOccurrence arms the cascade hold", () => {
  const write = (dispatch, socket, id, order) => updateOccurrence({
    dispatch, socket,
    occurrence: { id, moduleId: "m1", fields: { fA: { value: 1 } } },
    emit: true,
    triggerField: { fieldId: "fA", value: 1, instanceId: "m1" },
  });

  test("a rapid SECOND write begins the interaction, and does it BEFORE firing", () => {
    const { dispatch, socket } = makeMocks();
    const order = [];
    const prevFire = operationsBridge.fireOperations;
    const prevBegin = operationsBridge.beginInteraction;
    operationsBridge.fireOperations = () => order.push("fire");
    operationsBridge.beginInteraction = () => order.push("begin");
    try {
      write(dispatch, socket, "o1");          // first — fires unheld
      write(dispatch, socket, "o2");          // second, immediately after
    } finally {
      operationsBridge.fireOperations = prevFire;
      operationsBridge.beginInteraction = prevBegin;
    }
    // The lone-write case is unchanged: nothing armed before the first fire.
    expect(order[0]).toBe("fire");
    // …and the burst arms before its own fire, not after it.
    expect(order).toContain("begin");
    expect(order.indexOf("begin")).toBeLessThan(order.lastIndexOf("fire"));
  });

  test("a write still fires when nothing is listening for the hold", () => {
    // THE CONTROL. `beginInteraction` is null until `bindSocketToStore` runs;
    // a write during that window must behave exactly as before rather than
    // throwing on an absent bridge.
    const { dispatch, socket } = makeMocks();
    const fired = [];
    const prevFire = operationsBridge.fireOperations;
    const prevBegin = operationsBridge.beginInteraction;
    operationsBridge.fireOperations = (t) => fired.push(t);
    operationsBridge.beginInteraction = null;
    try {
      write(dispatch, socket, "o1");
      write(dispatch, socket, "o2");
    } finally {
      operationsBridge.fireOperations = prevFire;
      operationsBridge.beginInteraction = prevBegin;
    }
    expect(fired).toEqual(["MeasureOp", "MeasureOp"]);
  });
});

describe("updateOccurrence triggerField", () => {
  test("an ARRAY fires one MeasureOp per field, on a single write", () => {
    const { dispatch, socket } = makeMocks();
    const fired = [];
    const prevFire = operationsBridge.fireOperations;
    operationsBridge.fireOperations = (type, tx) => fired.push({ type, tx });
    try {
      updateOccurrence({
        dispatch, socket,
        occurrence: { id: "o1", moduleId: "m1", fields: { fA: { value: 1 }, fB: { value: 2 } } },
        emit: true,
        triggerField: [
          { fieldId: "fA", value: 1, instanceId: "m1" },
          { fieldId: "fB", value: 2, instanceId: "m1" },
        ],
      });
    } finally { operationsBridge.fireOperations = prevFire; }

    // ONE write…
    const writes = socket.emit.mock.calls.filter(c => c[0] === "update_occurrence");
    expect(writes.length).toBe(1);
    // …and one MeasureOp per field.
    expect(fired.length).toBe(2);
    expect(fired.map(f => Object.keys(f.tx.fields)[0])).toEqual(["fA", "fB"]);
    expect(fired.every(f => f.type === "MeasureOp")).toBe(true);
  });

  test("a single object still fires exactly one — the old shape is untouched", () => {
    const { dispatch, socket } = makeMocks();
    const fired = [];
    const prevFire = operationsBridge.fireOperations;
    operationsBridge.fireOperations = (type, tx) => fired.push({ type, tx });
    try {
      updateOccurrence({
        dispatch, socket,
        occurrence: { id: "o1", moduleId: "m1", fields: { fA: { value: 1 } } },
        emit: true,
        triggerField: { fieldId: "fA", value: 1, instanceId: "m1" },
      });
    } finally { operationsBridge.fireOperations = prevFire; }
    expect(fired.length).toBe(1);
    expect(Object.keys(fired[0].tx.fields)).toEqual(["fA"]);
  });

  test("an entry with no fieldId is skipped rather than firing an empty MeasureOp", () => {
    const { dispatch, socket } = makeMocks();
    const fired = [];
    const prevFire = operationsBridge.fireOperations;
    operationsBridge.fireOperations = (type, tx) => fired.push({ type, tx });
    try {
      updateOccurrence({
        dispatch, socket,
        occurrence: { id: "o1", moduleId: "m1", fields: {} },
        emit: true,
        triggerField: [{ fieldId: "fA", value: 1 }, { value: 9 }, null],
      });
    } finally { operationsBridge.fireOperations = prevFire; }
    expect(fired.length).toBe(1);
  });
});

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
    expect(socket.emit).toHaveBeenCalledWith("create_occurrence", expect.objectContaining({ occurrence }));
  });

  // Regression: a copy-drop into a spot in a multi-instance container must land
  // at that spot, not rubber-band to the end. The server's create handler
  // $positions the child into parent.occurrences[] at `insertAtIndex` (else it
  // appends); copyInstanceToContainer passes the drop index, so createOccurrence
  // must forward it ON THE EMIT (but NOT on the dispatched/cached occurrence — it
  // isn't a persisted field).
  test("createOccurrence forwards insertAtIndex on the emit only, not the dispatch", () => {
    const { dispatch, socket } = makeMocks();
    const occurrence = { id: "occ1", parentId: "cont1", targetType: "module" };
    createOccurrence({ dispatch, socket, occurrence, insertAtIndex: 0 });
    expect(socket.emit).toHaveBeenCalledWith("create_occurrence", expect.objectContaining({
      occurrence: { ...occurrence, insertAtIndex: 0 },
    }));
    // dispatched occurrence stays clean (no insertAtIndex leaks into local state)
    const dispatched = dispatch.mock.calls
      .map((c) => c[0])
      .find((a) => a?.payload?.occurrence?.id === "occ1");
    expect(dispatched.payload.occurrence.insertAtIndex).toBeUndefined();
  });

  test("createOccurrence omits insertAtIndex when null (plain append)", () => {
    const { dispatch, socket } = makeMocks();
    const occurrence = { id: "occ2", parentId: "cont1" };
    createOccurrence({ dispatch, socket, occurrence });
    expect(socket.emit).toHaveBeenCalledWith("create_occurrence", expect.objectContaining({ occurrence }));
  });

  test("updateOccurrence dispatches and emits update_occurrence", () => {
    const { dispatch, socket } = makeMocks();
    const occurrence = { id: "occ1", fields: {} };
    updateOccurrence({ dispatch, socket, occurrence });
    expect(socket.emit).toHaveBeenCalledWith("update_occurrence", expect.objectContaining({ occurrence }));
  });

  test("deleteOccurrence dispatches and emits delete_occurrence", () => {
    const { dispatch, socket } = makeMocks();
    deleteOccurrence({ dispatch, socket, occurrenceId: "occ1" });
    expect(socket.emit).toHaveBeenCalledWith("delete_occurrence", expect.objectContaining({ occurrenceId: "occ1" }));
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
  test("deleteOccurrence sources snapshot from cache and carries it on the transaction", async () => {
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
      // Snapshot rides ON the transaction (trigger context only) — 2026-07-07:
      // the old occurrencesOverride re-injected the deleted occurrence into
      // executor state, so tracker recounts still counted it (deleting a
      // completed task never decremented Tasks Completed).
      expect(deleteCall[1]).toMatchObject({
        occurrenceId: "occ1", containerId: "tbl1", _occurrenceSnapshot: snap,
      });
      expect(deleteCall[2]).toBeUndefined();
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
      expect(socket.emit).toHaveBeenCalledWith("delete_occurrence", expect.objectContaining({ occurrenceId: "occ1" }));
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

// ─── createLeafInstanceAtIndex (insert-here gap) ─────────────────────────────
describe("createLeafInstanceAtIndex", () => {
  const base = () => ({ gridId: "g1", userId: "u1", parentOccurrence: { id: "p1", occurrences: ["a", "b"] } });
  const emitted = (socket, event) => socket.emit.mock.calls.find(c => c[0] === event)?.[1];

  test("existing module id → reuses it (no new module), spliced at index", () => {
    const { dispatch, socket } = makeMocks();
    const out = createLeafInstanceAtIndex({ dispatch, socket, ...base(), index: 1, existingModuleId: "mod-x" });
    expect(emitted(socket, "create_module")).toBeUndefined(); // reuses the picked module
    expect(emitted(socket, "create_occurrence").occurrence.moduleId).toBe("mod-x");
    expect(out.moduleId).toBe("mod-x");
    expect(emitted(socket, "update_occurrence").occurrence.occurrences).toEqual(["a", out.occurrenceId, "b"]);
  });

  test("existing module passed as an OBJECT → moduleId normalized to its id string", () => {
    const { dispatch, socket } = makeMocks();
    const out = createLeafInstanceAtIndex({ dispatch, socket, ...base(), existingModuleId: { id: "mod-obj", label: "Picked" } });
    expect(emitted(socket, "create_module")).toBeUndefined();
    const occMod = emitted(socket, "create_occurrence").occurrence.moduleId;
    expect(occMod).toBe("mod-obj");
    expect(typeof occMod).toBe("string"); // never the object
    expect(out.moduleId).toBe("mod-obj");
  });

  test("no existing module → mints a role:instance module, binds fieldIds, appends when index null", () => {
    const { dispatch, socket } = makeMocks();
    const out = createLeafInstanceAtIndex({ dispatch, socket, ...base(), fieldIds: ["f1", "f2"] });
    const mod = emitted(socket, "create_module").module;
    expect(mod.id).toBe(out.moduleId);
    expect(mod.role).toBe("instance");
    expect(mod.fieldBindings).toEqual([{ fieldId: "f1", role: "input" }, { fieldId: "f2", role: "input" }]);
    expect(emitted(socket, "update_occurrence").occurrence.occurrences).toEqual(["a", "b", out.occurrenceId]);
  });

  test("returns null when required args missing", () => {
    const { dispatch, socket } = makeMocks();
    expect(createLeafInstanceAtIndex({ dispatch, socket, gridId: "g1", userId: "u1" })).toBeNull();
  });
});

// ─── addImageArtifactFromUrl (image search / URL pick → no upload round-trip) ─
import { addImageArtifactFromUrl } from "../helpers/CommitHelpers";
describe("addImageArtifactFromUrl", () => {
  const base = () => ({ gridId: "g1", userId: "u1", containerOccurrence: { id: "c1", occurrences: ["a", "b"] } });
  const emitted = (socket, event) => socket.emit.mock.calls.find(c => c[0] === event)?.[1];

  test("mints a kind:image artifact module with the remote fileRef + occurrence in the container", () => {
    const { dispatch, socket } = makeMocks();
    const out = addImageArtifactFromUrl({ dispatch, socket, ...base(), url: "https://img.example/x.jpg", label: "Poster" });
    const mod = emitted(socket, "create_module").module;
    expect(mod.role).toBe("artifact");
    expect(mod.kind).toBe("image");
    expect(mod.fileRef).toBe("https://img.example/x.jpg");
    expect(mod.label).toBe("Poster");
    expect(mod.meta.external).toBe(true);
    const occ = emitted(socket, "create_occurrence").occurrence;
    expect(occ.moduleId).toBe(out.moduleId);
    expect(occ.parentId).toBe("c1");
    expect(emitted(socket, "update_occurrence").occurrence.occurrences).toEqual(["a", "b", out.occurrenceId]);
  });

  test("splices at index; returns null without a url", () => {
    const { dispatch, socket } = makeMocks();
    const out = addImageArtifactFromUrl({ dispatch, socket, ...base(), url: "https://i/y.png", index: 0 });
    expect(emitted(socket, "update_occurrence").occurrence.occurrences).toEqual([out.occurrenceId, "a", "b"]);
    expect(addImageArtifactFromUrl({ dispatch, socket, ...base() })).toBeNull();
  });
});

describe("createPageInContainer / createChildInContainer page-* tiles", () => {
  const base = () => ({
    gridId: "g1", userId: "u1",
    containerOccurrence: { id: "c1", moduleId: "cm1", occurrences: ["a", "b"] },
  });
  const emitted = (socket, event) => socket.emit.mock.calls.find(c => c[0] === event)?.[1];
  const allEmitted = (socket, event) => socket.emit.mock.calls.filter(c => c[0] === event).map(c => c[1]);

  test("mints ONE page module + ONE occurrence homed in the folder and listed by the container", () => {
    const { dispatch, socket } = makeMocks();
    const out = createPageInContainer({ dispatch, socket, ...base(), kind: "canvas", folderId: "root-folder" });
    const mod = emitted(socket, "create_module").module;
    expect(mod.role).toBe("page");
    expect(mod.kind).toBe("canvas");

    // Exactly one occurrence — two would give a doc/canvas page two textmaps.
    const occs = allEmitted(socket, "create_occurrence");
    expect(occs).toHaveLength(1);
    const occ = occs[0].occurrence;
    // Home in the tree...
    expect(occ.parentId).toBe("root-folder");
    // ...and multi-parented into the container that spawned it.
    expect(emitted(socket, "update_occurrence").occurrence.occurrences).toEqual(["a", "b", out.occurrenceId]);
    // Pinned to the compact view; the cascade would otherwise default to
    // actual-converted (an empty inline box for a brand-new page).
    expect(occ.meta.layoutCascadeOverride.dragInView).toBe("representation");
    // canvas/doc pages need a textmap to mount clean.
    expect(occ.textmap).toEqual({ type: "doc", content: [] });
  });

  test("a table page gets no textmap, and with no folder the container is its only home", () => {
    const { dispatch, socket } = makeMocks();
    createPageInContainer({ dispatch, socket, ...base(), kind: "table", folderId: null });
    const occ = emitted(socket, "create_occurrence").occurrence;
    expect(occ.textmap).toBeUndefined();
    expect(occ.parentId).toBe("c1");
  });

  test("createChildInContainer routes page-* to a PAGE and the bare kind to a CONTAINER", () => {
    const { dispatch, socket } = makeMocks();
    createChildInContainer({ dispatch, socket, ...base(), kind: "page-doc", folderId: "root-folder" });
    expect(emitted(socket, "create_module").module.role).toBe("page");

    const second = makeMocks();
    createChildInContainer({ dispatch, socket: second.socket, ...base(), kind: "doc" });
    expect(emitted(second.socket, "create_module").module.role).toBe("container");
  });

  test("returns null without a container", () => {
    const { dispatch, socket } = makeMocks();
    expect(createPageInContainer({ dispatch, socket, gridId: "g1", userId: "u1", containerOccurrence: null })).toBeNull();
  });
});

// ─── FILTER STAMPING ON TYPED CREATES ──────────────────────────────────────
// A textblock made by TYPING used to be born with no `fields` key at all, so the
// date filter could not see it — while the DROP path had folded the date into
// the create since 2026-05-07. These lock the two paths together.
describe("typed creates are born carrying the parent's filter values", () => {
  const DATE_FID = "date-fid";
  const emitted = (socket, event) => socket.emit.mock.calls.find(c => c[0] === event)?.[1];

  // The parent day column and the grid whose active filter is a date nav.
  function filterWorld(dayColOverride = { [DATE_FID]: "2026-08-05" }) {
    const dayCol = {
      id: "daycol-1",
      occurrences: [],
      filterOverride: dayColOverride,
    };
    return {
      state: {
        grid: {
          id: "g1",
          activeFilterId: "filter_daily",
          namedFilters: [{ id: "filter_daily", conditions: [{ fieldId: DATE_FID, isNav: true }] }],
          activeFilterValues: {},
        },
      },
      occurrencesById: { [dayCol.id]: dayCol },
      dayCol,
    };
  }

  function withBridge(world, fn) {
    const prev = operationsBridge.getFilterContext;
    operationsBridge.getFilterContext = () => ({ state: world.state, occurrencesById: world.occurrencesById });
    try { return fn(); } finally { operationsBridge.getFilterContext = prev; }
  }

  test("createTextblockInContainer stamps the day column's date", () => {
    const { dispatch, socket } = makeMocks();
    const world = filterWorld();
    withBridge(world, () =>
      createTextblockInContainer({ dispatch, socket, gridId: "g1", userId: "u1", containerOccurrence: world.dayCol }));
    const occ = emitted(socket, "create_occurrence").occurrence;
    expect(occ.fields?.[DATE_FID]?.value).toBe("2026-08-05");
  });

  test("createContainerInContainer stamps it too — any occurrence can carry fields", () => {
    const { dispatch, socket } = makeMocks();
    const world = filterWorld();
    withBridge(world, () =>
      createContainerInContainer({ dispatch, socket, gridId: "g1", userId: "u1", containerOccurrence: world.dayCol, kind: "doc" }));
    const occ = emitted(socket, "create_occurrence").occurrence;
    expect(occ.fields?.[DATE_FID]?.value).toBe("2026-08-05");
  });

  test("caller-supplied fields WIN over the stamp (the addNew flow copies identity values)", () => {
    const { dispatch, socket } = makeMocks();
    const world = filterWorld();
    withBridge(world, () =>
      createLeafInstanceAtIndex({
        dispatch, socket, gridId: "g1", userId: "u1", parentOccurrence: world.dayCol,
        index: 0, initialFields: { [DATE_FID]: { value: "2026-01-01", flow: "in" } },
      }));
    const occ = emitted(socket, "create_occurrence").occurrence;
    expect(occ.fields[DATE_FID].value).toBe("2026-01-01");
  });

  test("a container that opts out of stamping gets nothing", () => {
    const { dispatch, socket } = makeMocks();
    const world = filterWorld();
    world.dayCol.meta = { skipFilterStamp: true };
    withBridge(world, () =>
      createTextblockInContainer({ dispatch, socket, gridId: "g1", userId: "u1", containerOccurrence: world.dayCol }));
    const occ = emitted(socket, "create_occurrence").occurrence;
    expect(occ.fields).toBeUndefined();
  });

  test("an unwired bridge still creates the occurrence — a create must never fail on this", () => {
    const { dispatch, socket } = makeMocks();
    const prev = operationsBridge.getFilterContext;
    operationsBridge.getFilterContext = null;
    try {
      const res = createTextblockInContainer({
        dispatch, socket, gridId: "g1", userId: "u1",
        containerOccurrence: { id: "c1", occurrences: [] },
      });
      expect(res.occurrenceId).toBeTruthy();
      expect(emitted(socket, "create_occurrence").occurrence.fields).toBeUndefined();
    } finally { operationsBridge.getFilterContext = prev; }
  });
});
