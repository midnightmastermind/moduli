// __tests__/dropHandlers.routing.test.js
// End-to-end test: build a state, fire routeDrop with a DropContext, verify
// the right LayoutHelpers commit fires. Catches the "nothing moves" class
// of regressions that the per-helper isolated tests don't surface.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildDropContext, buildRawDropEvent, DROP_TARGET_KIND } from "../helpers/dragHitTesting";
import { routeDrop } from "../helpers/dropHandlers";
import * as LayoutHelpers from "../helpers/LayoutHelpers";

function makeFixture() {
  const modules = {
    panelMod: { id: "panelMod", role: "panel", kind: "board", label: "Panel" },
    fromContainerMod: { id: "fromContainerMod", role: "container", kind: "board", label: "From" },
    toContainerMod: { id: "toContainerMod", role: "container", kind: "board", label: "To" },
    instMod: { id: "instMod", role: "instance", kind: "board", label: "Inst" },
  };
  const occs = {
    panelOcc: { id: "panelOcc", moduleId: "panelMod", targetId: "panelMod", occurrences: ["fromContOcc", "toContOcc"] },
    fromContOcc: { id: "fromContOcc", moduleId: "fromContainerMod", targetId: "fromContainerMod", occurrences: ["instOcc"] },
    toContOcc: { id: "toContOcc", moduleId: "toContainerMod", targetId: "toContainerMod", occurrences: [] },
    instOcc: { id: "instOcc", moduleId: "instMod", targetId: "instMod", occurrences: [], parentId: "fromContOcc" },
  };
  return { modules, occs };
}

function makeCtx(modules, occs) {
  return {
    dispatch: vi.fn(),
    socket: { emit: vi.fn() },
    state: { modulesById: modules, grid: { _id: "g1" }, gridId: "g1" },
    occurrencesById: occs,
    baseAllPanels: Object.values(modules).filter(m => m.role === "panel"),
    baseContainers: Object.values(modules).filter(m => m.role === "container"),
    clearSession: vi.fn(),
    sessionRef: { current: { mode: "move", payload: null, dragging: true } },
    getCellFromPoint: () => null,
  };
}

describe("routeDrop + handleOccurrenceMove — in-grid instance move", () => {
  let moveSpy, copySpy;

  beforeEach(() => {
    moveSpy = vi.spyOn(LayoutHelpers, "moveInstanceBetweenContainers").mockImplementation(() => {});
    copySpy = vi.spyOn(LayoutHelpers, "copyInstanceToContainer").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("instance dragged from one container to another in same panel → moveInstanceBetweenContainers", () => {
    const { modules, occs } = makeFixture();
    const env = { occurrencesById: occs, modulesById: modules };

    const rawEvent = {
      source: {
        moduleId: "instMod",
        occurrenceId: "instOcc",
        sourceKind: "in-grid",
        defaultMode: "move",
        payloadType: "instance",
        context: {
          containerId: "fromContainerMod",
          containerOccurrenceId: "fromContOcc",
          panelId: "panelMod",
        },
      },
      hover: {
        x: 0, y: 0,
        dropTargetData: { occurrenceId: "toContOcc", closestEdge: null },
      },
      modifiers: {},
      pointer: { x: 0, y: 0 },
      dataTransfer: null,
    };

    const dropContext = buildDropContext(rawEvent, env);
    expect(dropContext).not.toBeNull();
    expect(dropContext.target.occurrenceId).toBe("toContOcc");
    expect(dropContext.target.moduleId).toBe("toContainerMod");

    const ctx = makeCtx(modules, occs);
    ctx.sessionRef.current.payload = { id: "instMod", context: rawEvent.source.context };
    routeDrop(dropContext, ctx);

    expect(moveSpy).toHaveBeenCalledTimes(1);
    const call = moveSpy.mock.calls[0][0];
    expect(call.fromContainerOccurrence.id).toBe("fromContOcc");
    expect(call.toContainerOccurrence.id).toBe("toContOcc");
    expect(call.occurrenceId).toBe("instOcc");
  });

  it("instance dragged into schedule-slot-shaped target (parent is page) → moveInstanceBetweenContainers", () => {
    // Schedule slot: container occurrence whose parent is a page-role
    // occurrence. Different from the panel-parent case above; this is the
    // shape that was silently failing in the field.
    const modules = {
      pageMod: { id: "pageMod", role: "page", kind: "board", label: "Schedule" },
      slotMod: { id: "slotMod", role: "container", kind: "board", label: "6:00am", meta: { scheduleSlot: true } },
      fromContainerMod: { id: "fromContainerMod", role: "container", kind: "board", label: "From" },
      instMod: { id: "instMod", role: "instance", kind: "board", label: "Drink Water" },
    };
    const occs = {
      pageOcc: { id: "pageOcc", moduleId: "pageMod", targetId: "pageMod", occurrences: ["slotOcc"] },
      slotOcc: { id: "slotOcc", moduleId: "slotMod", targetId: "slotMod", occurrences: [], parentId: "pageOcc" },
      fromContOcc: { id: "fromContOcc", moduleId: "fromContainerMod", targetId: "fromContainerMod", occurrences: ["instOcc"] },
      instOcc: { id: "instOcc", moduleId: "instMod", targetId: "instMod", occurrences: [], parentId: "fromContOcc" },
    };
    const env = { occurrencesById: occs, modulesById: modules };

    const rawEvent = {
      source: {
        moduleId: "instMod",
        occurrenceId: "instOcc",
        sourceKind: "in-grid",
        defaultMode: "move",
        payloadType: "instance",
        context: {
          containerId: "fromContainerMod",
          containerOccurrenceId: "fromContOcc",
        },
      },
      hover: {
        x: 0, y: 0,
        dropTargetData: { occurrenceId: "slotOcc", closestEdge: null },
      },
      modifiers: {},
      pointer: { x: 0, y: 0 },
      dataTransfer: null,
    };

    const dropContext = buildDropContext(rawEvent, env);
    expect(dropContext).not.toBeNull();
    expect(dropContext.target.occurrenceId).toBe("slotOcc");
    expect(dropContext.target.moduleId).toBe("slotMod");
    expect(dropContext.target.parentOccurrenceId).toBe("pageOcc");

    const ctx = makeCtx(modules, occs);
    ctx.sessionRef.current.payload = { id: "instMod", context: rawEvent.source.context };
    routeDrop(dropContext, ctx);

    expect(moveSpy).toHaveBeenCalledTimes(1);
    expect(moveSpy.mock.calls[0][0].toContainerOccurrence.id).toBe("slotOcc");
  });

  it("realistic Pragmatic onDrop input → committed in-grid move", () => {
    // This is the shape DragProvider.handleDrop actually receives from
    // dragSystem.useDragDrop's dropTargetForElements.onDrop:
    //   { type, id, context, clientX, clientY, source, dataTransfer }
    // where context comes from the drop zone's `context` prop merged with
    // { instanceId, closestEdge } that the hook adds.
    const { modules, occs } = makeFixture();
    const env = { occurrencesById: occs, modulesById: modules };

    // What ModuleContainer's listDropRef passes:
    //   type: "container-list"
    //   context: { panelId, containerId: toContainerMod, occurrenceId: toContOcc }
    // Hook merges in `instanceId: toContainerMod` and `closestEdge: null`.
    const dropTarget = {
      type: "container-list",
      id: "container-list:toContainerMod",
      context: {
        panelId: "panelMod",
        containerId: "toContainerMod",
        occurrenceId: "toContOcc",
        instanceId: "toContainerMod",
        closestEdge: null,
      },
      clientX: 100, clientY: 100,
      source: { ...modules.instMod, occurrence: occs.instOcc },
      dataTransfer: null,
    };

    // What handleDragStart stored in sessionRef.payload (createPayload shape):
    const sessionPayload = {
      type: "instance",
      id: "instMod",
      data: { ...modules.instMod, occurrence: occs.instOcc },
      context: {
        containerId: "fromContainerMod",
        containerOccurrenceId: "fromContOcc",
        panelId: "panelMod",
        instanceId: "instMod",
        occurrenceId: "instOcc",
        sourceType: null,
      },
    };

    const rawEvent = buildRawDropEvent({
      dropTarget,
      payload: sessionPayload,
      sessionMode: "move",
      hovered: { containerOccId: "toContOcc" },
    });
    expect(rawEvent).not.toBeNull();
    expect(rawEvent.source.moduleId).toBe("instMod");
    expect(rawEvent.source.sourceKind).toBe("in-grid");
    expect(rawEvent.hover.dropTargetData.occurrenceId).toBe("toContOcc");

    const dropContext = buildDropContext(rawEvent, env);
    expect(dropContext).not.toBeNull();
    expect(dropContext.target.occurrenceId).toBe("toContOcc");
    expect(dropContext.target.moduleId).toBe("toContainerMod");

    const ctx = makeCtx(modules, occs);
    ctx.sessionRef.current.payload = sessionPayload;
    routeDrop(dropContext, ctx);

    expect(moveSpy).toHaveBeenCalledTimes(1);
    expect(moveSpy.mock.calls[0][0].fromContainerOccurrence.id).toBe("fromContOcc");
    expect(moveSpy.mock.calls[0][0].toContainerOccurrence.id).toBe("toContOcc");
  });

  it("CC instance drop on a container → copyInstanceToContainer", () => {
    const { modules, occs } = makeFixture();
    const env = { occurrencesById: occs, modulesById: modules };

    const rawEvent = {
      source: {
        moduleId: "instMod",
        occurrenceId: null,
        sourceKind: "command-center",
        defaultMode: "move",
        payloadType: "module",
        data: { ...modules.instMod },
        context: { sourceType: "command-center" },
      },
      hover: { x: 0, y: 0, dropTargetData: { occurrenceId: "toContOcc", closestEdge: null } },
      modifiers: {},
      pointer: { x: 0, y: 0 },
      dataTransfer: null,
    };

    const dropContext = buildDropContext(rawEvent, env);
    const ctx = makeCtx(modules, occs);
    ctx.sessionRef.current.payload = { id: "instMod", context: rawEvent.source.context };
    routeDrop(dropContext, ctx);

    expect(copySpy).toHaveBeenCalledTimes(1);
    expect(copySpy.mock.calls[0][0].sourceInstanceId).toBe("instMod");
  });
});
