// __tests__/operationDropToInstance.test.js
//
// An operation pill in Command Center → Operations advertises, in its own
// tooltip, "drag to instance to add as runnable widget". Dragging one onto an
// instance on prod 2026-09-21 wrote nothing: the drag ran (dragstart →
// dragenter → drop on `.instance-textcol` → dragend), no error appeared, and
// the target module's `operationBindings` stayed null.
//
// `routeDrop` dispatches on `payload.sourceKind`, and `buildRawDropEvent`
// derives that from `sourceType` (dragHitTesting.js:335). The pill's
// `getInitialData` advertises `sourceType: "command-center"`, so the drop was
// routed to `handleModuleDrop` — which looks the payload up in `modulesById`,
// finds nothing for an operation id, and returns. `handleOperationDrop` was
// unreachable from the UI.
//
// (The other half of the payload is fine and is pinned below so a "fix" cannot
// quietly break it: the normalizer maps `id` → `moduleId`, which is the key
// `handleOperationDrop` reads.)
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRawDropEvent } from "../helpers/dragHitTesting";
import { handleOperationDrop } from "../helpers/dropHandlers";
import { DragType, DropAccepts } from "../helpers/dragSystem";

/** Exactly what OperationsTab's draggable puts on the wire. */
const pillPayload = (over) => ({ type: "operation", id: "op-1", data: { name: "Log a Glass" }, ...over });

// buildRawDropEvent needs a hovered OCCURRENCE (it reads context.occurrenceId)
// before it will produce an event at all.
const dropTarget = { type: "occurrence", context: { occurrenceId: "occ-1", instanceId: "inst-1" } };

describe("an operation dragged from Command Center reaches the operation handler", () => {
  it("advertises a sourceKind that routeDrop sends to handleOperationDrop", () => {
    const ev = buildRawDropEvent({ dropTarget, payload: pillPayload({ sourceType: "operation" }) });
    expect(ev.source.sourceKind).toBe("operation");
  });

  it("still carries the operation id as moduleId, which the handler reads", () => {
    const ev = buildRawDropEvent({ dropTarget, payload: pillPayload({ sourceType: "operation" }) });
    expect(ev.source.moduleId).toBe("op-1");
  });

  it("OperationsTab's draggable advertises sourceType 'operation'", () => {
    // A source guard: the wiring lives in a component that needs the whole
    // Command Center to mount, and the defect was ONE STRING in it.
    const src = fs.readFileSync(path.join(__dirname, "../ui/commandCenter/OperationsTab.jsx"), "utf8");
    const at = src.indexOf('type: "operation"');
    const block = src.slice(at, src.indexOf("}),", at) + 3);   // the whole getInitialData literal
    expect(block, "the op pill must advertise sourceType 'operation' — 'command-center' routes it to handleModuleDrop")
      .toMatch(/sourceType:\s*"operation"/);
  });
});

describe("an instance's drop zone accepts an operation at all", () => {
  // The SECOND half of why this never worked. `useDragDrop`'s canDrop is
  // `accepts.includes(source.data.type)`, and `DragType` had no OPERATION
  // member — so no drop zone listed it and Pragmatic declined every operation
  // drop before the app saw it. The native drop event still fires on the DOM,
  // which is why the drag LOOKED like it worked.
  it("DragType has an OPERATION member", () => {
    expect(DragType.OPERATION).toBe("operation");
  });

  it("DropAccepts.INSTANCE accepts it", () => {
    expect(DropAccepts.INSTANCE).toContain("operation");
  });

  it("still accepts everything it accepted before", () => {
    // The control: "accepts operation" must not be satisfied by a list that
    // replaced the existing entries.
    for (const t of [DragType.INSTANCE, DragType.MODULE, DragType.ARTIFACT, DragType.FILE, DragType.TEXT, DragType.URL]) {
      expect(DropAccepts.INSTANCE, `INSTANCE stopped accepting ${t}`).toContain(t);
    }
  });

  it("an empty grid cell does NOT accept an operation", () => {
    // Dropping an operation on empty space has no instance to bind to, so the
    // zone should keep declining it rather than swallow the gesture.
    expect(DropAccepts.GRID_CELL).not.toContain("operation");
  });
});

describe("handleOperationDrop binds the operation to the instance", () => {
  // dropView derives instanceId from the TARGET's module role, so the fixture
  // has to carry a real occurrence + module, not just an id.
  const ctxFor = (instance) => ({
    dispatch: vi.fn(),
    socket: { connected: true, emit: vi.fn() },
    state: {
      instances: instance ? [instance] : [],
      modulesById: { "inst-1": { id: "inst-1", role: "instance" } },
    },
    occurrencesById: { "occ-1": { id: "occ-1", moduleId: "inst-1" } },
  });
  const drop = (name) => ({
    payload: { moduleId: "op-1", id: "op-1", sourceKind: "operation", data: name ? { name } : undefined },
    target: { occurrenceId: "occ-1", moduleId: "inst-1" },
    position: {}, dataTransfer: null,
  });

  it("appends a trigger-widget binding", () => {
    const ctx = ctxFor({ id: "inst-1", label: "Log water", operationBindings: [] });
    handleOperationDrop(drop("Log a Glass"), ctx);
    const emit = ctx.socket.emit.mock.calls.find(([ev]) => ev === "update_module");
    expect(emit, "no update_module reached the socket").toBeTruthy();
    expect(emit[1].module.operationBindings).toEqual([
      { operationId: "op-1", widgetType: "trigger", displayName: "Log a Glass" },
    ]);
  });

  it("does not double-add an operation already bound", () => {
    const ctx = ctxFor({ id: "inst-1", operationBindings: [{ operationId: "op-1", widgetType: "trigger", displayName: "x" }] });
    handleOperationDrop(drop(), ctx);
    expect(ctx.socket.emit.mock.calls.filter(([ev]) => ev === "update_module")).toEqual([]);
  });
});
