// helpers/dropHandlers.js
// ============================================================
// Extracted drop handlers from DragProvider.jsx
//
// Each handler receives a context object (ctx) with:
//   dispatch, socket, state, occurrencesById, baseAllPanels,
//   baseContainers, clearSession, sessionRef, getCellFromPoint,
//   getHoveredPanelId, getHoveredContainerId, getHoveredInstanceId
//
// And a drop descriptor (drop) with:
//   payload, dropTarget, panelId, containerId, instanceId, x, y
// ============================================================

import * as CommitHelpers from "./CommitHelpers";
import * as LayoutHelpers from "./LayoutHelpers";
import { DragType, parseExternalDrop } from "./dragSystem";
import { runMatchingOperations } from "./operationExecutor";

function makeUUID() {
  return crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cellKeyFromPanel(p) {
  return `cell-${p.row}-${p.col}`;
}

// ============================================================
// PANEL → GRID CELL
// ============================================================
export function handlePanelDrop(ctx, drop) {
  const { dispatch, socket, state, occurrencesById, baseAllPanels, getCellFromPoint } = ctx;
  const { payload, dropTarget, x, y } = drop;

  let isCrossWindow = false;
  if (dropTarget.dataTransfer) {
    const parsed = parseExternalDrop(dropTarget.dataTransfer);
    isCrossWindow = parsed.isCrossWindow;
  }

  let cell = null;
  if (dropTarget.type === "grid-cell" && dropTarget.context?.row !== undefined && dropTarget.context?.col !== undefined) {
    cell = { row: dropTarget.context.row, col: dropTarget.context.col, cellId: dropTarget.context.cellId };
  } else {
    cell = getCellFromPoint(x, y);
  }

  if (cell && isCrossWindow) {
    const sourcePanel = payload.data;
    const newPanelId = makeUUID();
    const newContainerIds = [];

    const sourceContainers = sourcePanel?.containerObjects || [];
    sourceContainers.forEach(sourceContainer => {
      const newContainerId = makeUUID();
      newContainerIds.push(newContainerId);

      const sourceInstances = sourceContainer?.instanceObjects || [];
      sourceInstances.forEach(sourceInstance => {
        const newInstanceId = makeUUID();
        CommitHelpers.createModule({ dispatch, socket, module: { id: newInstanceId, label: sourceInstance.label || "Instance", role: "instance" }, emit: true });
      });

      CommitHelpers.createModule({ dispatch, socket, module: { id: newContainerId, label: sourceContainer.label || "Container", role: "container", occurrences: [] }, emit: true });
    });

    LayoutHelpers.createPanelInGrid({
      dispatch, socket, grid: state?.grid,
      panel: { id: newPanelId, containers: newContainerIds, layout: sourcePanel?.layout || {} },
      placement: { row: cell.row, col: cell.col, width: sourcePanel?.width || 1, height: sourcePanel?.height || 1 },
      userId: state?.userId, emit: true,
    });

    const destStack = baseAllPanels.filter(p => p.row === cell.row && p.col === cell.col);
    destStack.forEach(p => {
      LayoutHelpers.setPanelStackDisplay({ dispatch, socket, panel: p, display: "none", emit: true });
    });
  } else if (cell) {
    const panel = baseAllPanels.find(p => p.id === payload.id);
    if (panel && (panel.row !== cell.row || panel.col !== cell.col)) {
      const fromRow = panel.row, fromCol = panel.col;
      const toRow = cell.row, toCol = cell.col;

      const occurrenceId = panel._occurrenceId;
      const occurrence = occurrenceId ? occurrencesById[occurrenceId] : null;

      if (occurrence) {
        CommitHelpers.updateOccurrence({
          dispatch, socket,
          occurrence: { ...occurrence, placement: { ...(occurrence.placement || {}), row: toRow, col: toCol } },
          emit: true,
        });
      }

      CommitHelpers.updateModule({
        dispatch, socket,
        module: { ...panel, layout: { ...(panel.layout || {}), style: { ...(panel.layout?.style || {}), display: "block" } } },
        emit: true,
      });

      const sourceCellKey = `cell-${fromRow}-${fromCol}`;
      const destCellKey = `cell-${toRow}-${toCol}`;
      const sourceStack = baseAllPanels.filter(p => p.id !== payload.id && cellKeyFromPanel(p) === sourceCellKey);
      const destStack = baseAllPanels.filter(p => p.id !== payload.id && cellKeyFromPanel(p) === destCellKey);

      if (sourceStack.length > 0 && sourceStack[0]) {
        LayoutHelpers.setPanelStackDisplay({ dispatch, socket, panel: sourceStack[0], display: "block", emit: true });
        sourceStack.slice(1).forEach(p => {
          if (p) LayoutHelpers.setPanelStackDisplay({ dispatch, socket, panel: p, display: "none", emit: true });
        });
      }

      destStack.forEach(p => {
        LayoutHelpers.setPanelStackDisplay({ dispatch, socket, panel: p, display: "none", emit: true });
      });
    }
  }
}

// ============================================================
// CONTAINER → PANEL
// ============================================================
export function handleContainerDrop(ctx, drop) {
  const { dispatch, socket, state, occurrencesById, baseAllPanels, baseContainers, clearSession, sessionRef } = ctx;
  const { payload, dropTarget, containerId, panelId } = drop;

  let isCrossWindow = false;
  if (dropTarget.dataTransfer) {
    const parsed = parseExternalDrop(dropTarget.dataTransfer);
    isCrossWindow = parsed.isCrossWindow;
  }

  if (isCrossWindow) {
    const sourceContainer = payload.data;
    const targetPanel = baseAllPanels.find(p => p.id === panelId);
    if (!targetPanel) { clearSession(); return; }

    const gridId = state?.gridId || state?.grid?._id;
    const targetPanelOcc = targetPanel?._occurrence ? occurrencesById[targetPanel._occurrence.id] : null;

    let toIndex = null;
    if (dropTarget.context?.insertAt !== undefined) {
      toIndex = dropTarget.context.insertAt;
    } else if (containerId) {
      const hoveredIndex = LayoutHelpers.getTargetIndexInOccurrences(containerId, targetPanelOcc?.occurrences || [], occurrencesById);
      if (hoveredIndex !== -1) {
        const edge = dropTarget.context?.closestEdge;
        if (edge === 'top' || edge === 'left') toIndex = hoveredIndex;
        else if (edge === 'bottom' || edge === 'right') toIndex = hoveredIndex + 1;
      }
    }

    const newContainerId = makeUUID();
    LayoutHelpers.createContainerInPanel({
      dispatch, socket, gridId, panel: targetPanel,
      container: { id: newContainerId, label: sourceContainer?.label || "Container", occurrences: [] },
      userId: state?.userId, index: toIndex, emit: true,
    });

    (sourceContainer?.instanceObjects || []).forEach(() => {
      LayoutHelpers.createInstanceInContainer({
        dispatch, socket, gridId,
        container: { id: newContainerId },
        instance: { id: makeUUID(), label: "Instance" },
        userId: state?.userId, emit: true,
      });
    });
  } else {
    const fromPanel = baseAllPanels.find(p => p.id === payload.context?.panelId);
    const toPanel = baseAllPanels.find(p => p.id === panelId);
    const fromPanelOcc = fromPanel?._occurrence ? occurrencesById[fromPanel._occurrence.id] : null;
    const toPanelOcc = toPanel?._occurrence ? occurrencesById[toPanel._occurrence.id] : null;

    // When containers live inside a PAGE occurrence (board pages), use the page
    // occurrence for ordering instead of the panel occurrence (which only has page IDs).
    const fromPageOccId = payload.context?.pageOccurrenceId;
    const toPageOccId = dropTarget.context?.pageOccurrenceId;
    const fromOrderOcc = fromPageOccId ? (occurrencesById[fromPageOccId] || fromPanelOcc) : fromPanelOcc;
    const toOrderOcc = toPageOccId ? (occurrencesById[toPageOccId] || toPanelOcc || fromOrderOcc) : (toPanelOcc || fromOrderOcc);

    if (fromPanel && toPanel && fromOrderOcc) {
      const draggedContainerId = payload.id;
      const occurrenceId = LayoutHelpers.findOccurrenceIdByTarget(draggedContainerId, fromOrderOcc.occurrences || [], occurrencesById);
      if (!occurrenceId) { clearSession(); return; }

      let toIndex = null;

      if (dropTarget.context?.insertAt !== undefined) {
        toIndex = dropTarget.context.insertAt;
      } else if (containerId) {
        const hoveredIndex = LayoutHelpers.getTargetIndexInOccurrences(containerId, toOrderOcc.occurrences || [], occurrencesById);
        if (hoveredIndex !== -1) {
          const edge = dropTarget.context?.closestEdge;
          if (edge === 'top' || edge === 'left') toIndex = hoveredIndex;
          else if (edge === 'bottom' || edge === 'right') toIndex = hoveredIndex + 1;
          const sameOrderOcc = fromOrderOcc.id === toOrderOcc.id;
          if (sameOrderOcc) {
            const fromIndex = LayoutHelpers.getTargetIndexInOccurrences(draggedContainerId, fromOrderOcc.occurrences || [], occurrencesById);
            if (fromIndex !== -1 && fromIndex < hoveredIndex) toIndex = Math.max(0, toIndex - 1);
          }
        }
      }

      const gridId = state?.gridId || state?.grid?._id;
      const isCopyMode = sessionRef.current.mode === 'copy';
      const samePanel = fromPanel.id === toPanel.id;
      const sameOrderOcc = fromOrderOcc.id === toOrderOcc.id;

      if (isCopyMode && sameOrderOcc) {
        const fromIndex = LayoutHelpers.getTargetIndexInOccurrences(draggedContainerId, fromOrderOcc.occurrences || [], occurrencesById);
        if (fromIndex !== -1) {
          if (toIndex === null) { clearSession(); return; }
          if (fromIndex !== toIndex) {
            LayoutHelpers.reorderContainersInPanel({ dispatch, socket, panelOccurrence: fromOrderOcc, fromIndex, toIndex, emit: true });
          }
        }
      } else if (isCopyMode) {
        LayoutHelpers.copyContainerToPanel({ dispatch, socket, gridId, sourceContainerId: draggedContainerId, toPanel, userId: state?.userId, toIndex, emit: true });
      } else if (sameOrderOcc) {
        const fromIndex = LayoutHelpers.getTargetIndexInOccurrences(draggedContainerId, fromOrderOcc.occurrences || [], occurrencesById);
        if (fromIndex !== -1) {
          if (toIndex === null) { clearSession(); return; }
          if (fromIndex !== toIndex) {
            LayoutHelpers.reorderContainersInPanel({ dispatch, socket, panelOccurrence: fromOrderOcc, fromIndex, toIndex, emit: true });
          }
        }
      } else if (samePanel && fromPanelOcc) {
        // Same panel, different page — move between pages
        LayoutHelpers.moveContainerBetweenPanels({
          dispatch, socket, fromPanelOccurrence: fromOrderOcc, toPanelOccurrence: toOrderOcc,
          occurrenceId, toIndex, emit: true,
        });
      } else {
        LayoutHelpers.moveContainerBetweenPanels({
          dispatch, socket, fromPanelOccurrence: fromOrderOcc, toPanelOccurrence: toOrderOcc,
          occurrenceId, toIndex, emit: true,
        });
      }
    }
  }
}

// ============================================================
// INSTANCE → CONTAINER
// ============================================================
export function handleInstanceDrop(ctx, drop) {
  const { dispatch, socket, state, occurrencesById, baseContainers, clearSession, sessionRef } = ctx;
  const { payload, dropTarget, containerId, instanceId, y } = drop;

  if (dropTarget.dataTransfer) {
    const parsed = parseExternalDrop(dropTarget.dataTransfer);
    if (parsed.isCrossWindow) return; // Let cross-window handler deal with it
  }

  const fromC = baseContainers.find(c => c.id === payload.context?.containerId);
  const toC = baseContainers.find(c => c.id === containerId);
  const fromCOcc = fromC ? Object.values(occurrencesById).find(o => o.targetId === fromC.id) : null;
  const toCOcc = toC ? Object.values(occurrencesById).find(o => o.targetId === toC.id) : null;

  if (!fromC || !toC) return;

  // Doc containers handle drops via Editor.jsx's dropTargetForElements → moduleEmbed insertion.
  // DragProvider must not also move/copy the instance into the container's occurrence list.
  if (toC.kind === "doc") return;

  if (toC.behaviorMode === "own" && toC.behavior?.droppable === false) { clearSession(); return; }

  const draggedInstanceId = payload.id;
  const occurrenceId = fromCOcc ? LayoutHelpers.findOccurrenceIdByTarget(draggedInstanceId, fromCOcc.occurrences || [], occurrencesById) : null;
  if (!occurrenceId) { clearSession(); return; }

  let toIndex = null;
  if (dropTarget.context?.insertAt !== undefined) {
    toIndex = dropTarget.context.insertAt;
  } else if (instanceId && toCOcc) {
    const hoveredIndex = LayoutHelpers.getTargetIndexInOccurrences(instanceId, toCOcc.occurrences || [], occurrencesById);
    if (hoveredIndex !== -1) {
      const edge = dropTarget.context?.closestEdge;
      if (edge === 'top' || edge === 'left') toIndex = hoveredIndex;
      else if (edge === 'bottom' || edge === 'right') toIndex = hoveredIndex + 1;
      else toIndex = hoveredIndex;
      if (fromCOcc && fromCOcc.id === toCOcc.id) {
        const fromIndex = LayoutHelpers.getTargetIndexInOccurrences(draggedInstanceId, fromCOcc.occurrences || [], occurrencesById);
        if (fromIndex !== -1 && fromIndex < hoveredIndex) toIndex = Math.max(0, toIndex - 1);
      }
    }
  }

  const gridId = state?.gridId || state?.grid?._id;
  const grid = state?.grid;
  const iterations = grid?.iterations || [];
  const selectedIterationId = state?.selectedIterationId || grid?.selectedIterationId || "default";
  const selectedIteration = iterations.find(i => i.id === selectedIterationId) || iterations[0];
  const currentIterationDate = state?.currentIterationValue || selectedIteration?.currentDate || new Date();

  const isCopyMode = sessionRef.current.mode === 'copy';
  const isCopylinkMode = sessionRef.current.mode === 'copylink';
  const sameContainer = fromC.id === toC.id;

  if (sameContainer && toC?.behaviorMode === "own" && toC?.behavior?.sortable === false) { clearSession(); return; }

  if ((isCopylinkMode || isCopyMode) && sameContainer) {
    if (fromCOcc) {
      const fromIndex = LayoutHelpers.getTargetIndexInOccurrences(draggedInstanceId, fromCOcc.occurrences || [], occurrencesById);
      if (fromIndex !== -1) {
        if (toIndex === null) { clearSession(); return; }
        if (fromIndex !== toIndex) {
          LayoutHelpers.reorderInstancesInContainer({ dispatch, socket, containerOccurrence: fromCOcc, fromIndex, toIndex, emit: true });
        }
      }
    }
  } else if (isCopylinkMode) {
    LayoutHelpers.copylinkInstanceToContainer({
      dispatch, socket, gridId, sourceInstanceId: draggedInstanceId, sourceOccurrenceId: occurrenceId,
      toContainer: toCOcc ? { ...toC, _occurrence: toCOcc } : toC,
      userId: state?.userId, toIndex, emit: true,
      iterationMode: "specific", iterationValue: currentIterationDate,
      sourceOccurrence: occurrenceId ? occurrencesById[occurrenceId] : null,
    });
  } else if (isCopyMode) {
    const copyResult = LayoutHelpers.copyInstanceToContainer({
      dispatch, socket, gridId, sourceInstanceId: draggedInstanceId,
      toContainer: toCOcc ? { ...toC, _occurrence: toCOcc } : toC,
      userId: state?.userId, toIndex, emit: true,
      iterationMode: "specific", iterationValue: currentIterationDate,
      sourceOccurrence: occurrenceId ? occurrencesById[occurrenceId] : null,
    });
    autoCheckBooleanFields(state, dispatch, socket, draggedInstanceId, copyResult?.occurrence?.id);
  } else if (sameContainer) {
    if (fromCOcc) {
      const fromIndex = LayoutHelpers.getTargetIndexInOccurrences(draggedInstanceId, fromCOcc.occurrences || [], occurrencesById);
      if (fromIndex !== -1) {
        if (toIndex === null) { clearSession(); return; }
        if (fromIndex !== toIndex) {
          LayoutHelpers.reorderInstancesInContainer({ dispatch, socket, containerOccurrence: fromCOcc, fromIndex, toIndex, emit: true });
        }
      }
    }
  } else {
    if (fromCOcc && toCOcc) {
      LayoutHelpers.moveInstanceBetweenContainers({
        dispatch, socket, fromContainerOccurrence: fromCOcc, toContainerOccurrence: toCOcc,
        occurrenceId, toIndex, emit: true,
      });

      // Fire OccurrenceMoveOp
      const allOccs = Object.values(occurrencesById);
      const fromPanelOcc = fromCOcc.parentId ? allOccs.find(o => o.id === fromCOcc.parentId) : null;
      const toPanelOcc = toCOcc.parentId ? allOccs.find(o => o.id === toCOcc.parentId) : null;
      const tx = {
        type: "OccurrenceMoveOp", occurrenceId, instanceId: draggedInstanceId,
        fromContainerId: fromC.id, toContainerId: toC.id,
        fromPanelId: fromPanelOcc?.targetId || null, toPanelId: toPanelOcc?.targetId || null,
      };
      const operations = Object.values(state?.operationsById || {});
      const fieldsById = Object.fromEntries((state?.fields || []).map(f => [f.id, f]));
      const allUpdates = runMatchingOperations(operations, "OccurrenceMoveOp", tx, {
        state, fieldsById, operationsById: state?.operationsById || {}, occurrencesById: { ...occurrencesById },
      });
      if (allUpdates?.length) {
        dispatch({ type: "SET_COMPUTED_VALUES", updates: allUpdates });
      }
    }
    autoCheckBooleanFields(state, dispatch, socket, draggedInstanceId, occurrenceId);
  }
}

// Helper: auto-check boolean fields on drop
function autoCheckBooleanFields(state, dispatch, socket, instanceId, occurrenceId) {
  if (!occurrenceId) return;
  const instance = (state?.instances || []).find(i => i.id === instanceId);
  if (!instance?.meta?.autoCheckOnDrop) return;
  const boolBindings = (instance.fieldBindings || []).filter(b => {
    const field = (state?.fields || []).find(f => f.id === b.fieldId);
    return field?.type === "boolean";
  });
  if (boolBindings.length > 0) {
    const autoFields = {};
    boolBindings.forEach(b => { autoFields[b.fieldId] = { value: true, flow: "in" }; });
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: occurrenceId, fields: autoFields }, emit: true });
  }
}

// ============================================================
// EXTERNAL FILE DROP → UPLOAD
// ============================================================
export function handleFileDrop(ctx, drop) {
  const { dispatch, socket, state, occurrencesById, clearSession } = ctx;
  const { payload, panelId, getCellFromPoint, x, y } = drop;

  const file = payload.data.files[0];
  const cell = getCellFromPoint(x, y);
  const fileGridId = state?.gridId || state?.grid?._id;
  const fileUserId = state?.userId;
  const fileGrid = state?.grid;

  if (!fileGridId || !fileUserId || !fileGrid) { clearSession(); return; }

  const capturedPanelOcc = panelId ? Object.values(occurrencesById).find(o => o.targetId === panelId) : null;
  const capturedPanelView = capturedPanelOcc?.viewId ? state?.viewsById?.[capturedPanelOcc.viewId] : null;
  const isExistingArtifactPanel = capturedPanelView?.viewType === "display" || capturedPanelView?.hasTree;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("userId", fileUserId);
  formData.append("gridId", fileGridId);

  fetch("/api/artifacts/upload", { method: "POST", body: formData })
    .then(r => r.json())
    .then(({ occurrence: uploadedOcc }) => {
      if (!uploadedOcc?.id) return;
      if (isExistingArtifactPanel && capturedPanelView) {
        CommitHelpers.updateView({ dispatch, socket, view: { ...capturedPanelView, activeOccurrenceId: uploadedOcc.id } });
      } else {
        const targetCell = cell || { row: 0, col: 0 };
        const newPanelModule = { id: makeUUID(), label: file.name || "Uploaded File", role: "panel", kind: "list" };
        const panelResult = LayoutHelpers.createPanelInGrid({
          dispatch, socket, grid: fileGrid, panel: newPanelModule,
          placement: { row: targetCell.row, col: targetCell.col, width: 1, height: 1 },
          userId: fileUserId, emit: true,
        });
        if (panelResult?.occurrence) {
          const viewId = makeUUID();
          CommitHelpers.createView({
            dispatch, socket,
            view: { id: viewId, userId: fileUserId, gridId: fileGridId, viewType: "display", hasTree: false, manifestId: null, activeOccurrenceId: uploadedOcc.id },
            emit: true,
          });
          CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...panelResult.occurrence, viewId }, emit: true });
        }
      }
    })
    .catch(err => console.error("[FILE DROP] Upload error:", err));

  clearSession();
}

// ============================================================
// EXTERNAL TEXT/URL → CONTAINER
// ============================================================
export function handleExternalDrop(ctx, drop) {
  const { dispatch, socket, state, occurrencesById, baseContainers, clearSession } = ctx;
  const { payload, dropTarget, containerId, y } = drop;

  let label = "Untitled";
  if (payload.type === DragType.TEXT) label = (payload.data?.text || "").slice(0, 80) || "Text";
  else if (payload.type === DragType.URL) label = payload.data?.url || "Link";

  const container = baseContainers.find(c => c.id === containerId);
  if (!container) { clearSession(); return; }

  const containerOcc = Object.values(occurrencesById).find(o => o.targetId === container.id);
  let toIndex = dropTarget.context?.insertAt ?? null;
  if (toIndex === null) toIndex = resolveNearestIndex(containerOcc, occurrencesById, y);

  const gridId = state?.gridId || state?.grid?._id;
  LayoutHelpers.createInstanceInContainer({
    dispatch, socket, gridId, container, containerOccurrence: containerOcc || null,
    instance: { id: makeUUID(), label }, userId: state?.userId, index: toIndex, emit: true,
  });
}

// ============================================================
// CROSS-WINDOW INSTANCE DROP
// ============================================================
export function handleCrossWindowDrop(ctx, drop) {
  const { dispatch, socket, state, occurrencesById, baseContainers, clearSession } = ctx;
  const { dropTarget, containerId, y } = drop;

  const parsed = parseExternalDrop(dropTarget.dataTransfer);
  if (!parsed.isCrossWindow || parsed.type !== DragType.INSTANCE) return;

  const container = baseContainers.find(c => c.id === containerId);
  if (!container) { clearSession(); return; }

  const xwContainerOcc = Object.values(occurrencesById).find(o => o.targetId === container.id);
  let toIndex = dropTarget.context?.insertAt ?? null;
  if (toIndex === null) toIndex = resolveNearestIndex(xwContainerOcc, occurrencesById, y);

  const gridId = state?.gridId || state?.grid?._id;
  const label = parsed.meta?.label || parsed.data?.label || "Untitled";
  LayoutHelpers.createInstanceInContainer({
    dispatch, socket, gridId, container, containerOccurrence: xwContainerOcc || null,
    instance: { id: makeUUID(), label }, userId: state?.userId, index: toIndex, emit: true,
  });
}

// ============================================================
// TEMPLATE FROM CC → CONTAINER
// ============================================================
export function handleTemplateDrop(ctx, drop) {
  const { socket, state } = ctx;
  const { payload, containerId } = drop;

  if (!containerId) return;
  const gridId = state?.gridId || state?.grid?._id;
  const currentIterationValue = state?.grid?.currentIterationValue;
  CommitHelpers.fillFromTemplate({ socket, gridId, templateId: payload.id, containerId, iterationValue: currentIterationValue });
}

// ============================================================
// MODULE FROM CC/POOL/DOC/TREE → CONTAINER/PANEL/GRID
// ============================================================
export function handleModuleDrop(ctx, drop) {
  const { dispatch, socket, state, occurrencesById, baseAllPanels, baseContainers, getCellFromPoint } = ctx;
  const { payload, dropTarget, containerId, panelId, x, y } = drop;

  const role = payload?.data?.role || payload?.role;
  const gridId = state?.gridId || state?.grid?._id?.toString() || state?.grid?.id;

  // INSTANCE role: create persistent occurrence in target container/panel
  if (!role || role === "instance") {
    let targetContainer = null;
    if (containerId) {
      const c = baseContainers.find(c => c.id === containerId);
      const droppable = !(c?.behaviorMode === "own" && c?.behavior?.droppable === false);
      if (c && droppable) targetContainer = c;
    } else if (panelId) {
      const panel = baseAllPanels.find(p => p.id === panelId);
      if (panel) {
        const panelOcc = panel._occurrence ? occurrencesById[panel._occurrence.id] : null;
        const panelContainerIds = (panelOcc?.occurrences || [])
          .map(occId => occurrencesById[occId]).filter(occ => occ?.targetId).map(occ => occ.targetId);
        const candidates = baseContainers.filter(c => panelContainerIds.includes(c.id));
        targetContainer = candidates.find(c => !(c.behaviorMode === "own" && c.behavior?.droppable === false)) || candidates[0] || null;
      }
    }
    // Doc containers handle drops via Editor.jsx → moduleEmbed node insertion
    if (targetContainer?.kind === "doc") return;

    if (targetContainer && gridId) {
      const targetContainerOcc = Object.values(occurrencesById).find(o => o.targetId === targetContainer.id);
      LayoutHelpers.copyInstanceToContainer({
        dispatch, socket, gridId, sourceInstanceId: payload.id,
        toContainer: targetContainerOcc ? { ...targetContainer, _occurrence: targetContainerOcc } : targetContainer,
        userId: state?.userId, iterationMode: "persistent", emit: true,
      });
    }
  }

  // CONTAINER role → PANEL
  if (role === "container" && panelId && gridId) {
    const panel = baseAllPanels.find(p => p.id === panelId);
    const container = baseContainers.find(c => c.id === payload.id);
    if (panel && container) {
      LayoutHelpers.createContainerInPanel({
        dispatch, socket, gridId, panel,
        container: { id: container.id, label: container.label, kind: container.kind },
        userId: state?.userId, index: null, emit: true,
      });
    }
  }

  // CONTAINER role → GRID CELL: drilldown
  if (role === "container" && dropTarget.type === "grid-cell" && dropTarget.context?.row !== undefined) {
    const cell = { row: dropTarget.context.row, col: dropTarget.context.col };
    const grid = state?.grid;
    const userId = state?.userId;
    const container = baseContainers.find(c => c.id === payload.id);
    if (cell && grid && userId && container) {
      const newPanel = { id: makeUUID(), label: container.label || "Panel", role: "panel", kind: "list" };
      const { occurrence: panelOcc } = LayoutHelpers.createPanelInGrid({
        dispatch, socket, grid, panel: newPanel,
        placement: { row: cell.row, col: cell.col, width: 1, height: 1 }, userId, emit: true,
      });
      LayoutHelpers.createContainerInPanel({
        dispatch, socket, gridId, panel: { ...newPanel, _occurrence: panelOcc },
        container: { id: container.id, label: container.label, kind: container.kind }, userId, emit: true,
      });
    }
  }

  // INSTANCE role → GRID CELL: drilldown
  if ((!role || role === "instance") && dropTarget.type === "grid-cell" && dropTarget.context?.row !== undefined) {
    const cell = { row: dropTarget.context.row, col: dropTarget.context.col };
    const grid = state?.grid;
    const userId = state?.userId;
    const instance = (state?.instances || []).find(i => i.id === payload.id);
    if (cell && grid && userId && instance) {
      const newPanel = { id: makeUUID(), label: instance.label || "Panel", role: "panel", kind: "list" };
      const { occurrence: panelOcc } = LayoutHelpers.createPanelInGrid({
        dispatch, socket, grid, panel: newPanel,
        placement: { row: cell.row, col: cell.col, width: 1, height: 1 }, userId, emit: true,
      });
      const newContainer = { id: makeUUID(), label: instance.label || "Container", role: "container", kind: "list" };
      const { occurrence: containerOcc } = LayoutHelpers.createContainerInPanel({
        dispatch, socket, gridId, panel: { ...newPanel, _occurrence: panelOcc },
        container: newContainer, userId, emit: true,
      });
      LayoutHelpers.copyInstanceToContainer({
        dispatch, socket, gridId, sourceInstanceId: instance.id,
        toContainer: { ...newContainer, _occurrence: containerOcc }, userId, iterationMode: "persistent", emit: true,
      });
    }
  }

  // PANEL role: move to different grid cell
  if (role === "panel" && gridId) {
    const cell = (dropTarget.type === "grid-cell" && dropTarget.context?.row !== undefined)
      ? { row: dropTarget.context.row, col: dropTarget.context.col }
      : getCellFromPoint(x, y);
    if (cell) {
      const panelModule = baseAllPanels.find(p => p.id === payload.id);
      const occurrenceId = panelModule?._occurrenceId;
      const panelOcc = occurrenceId ? occurrencesById[occurrenceId] : null;
      if (panelModule && panelOcc) {
        CommitHelpers.updateOccurrence({
          dispatch, socket,
          occurrence: { ...panelOcc, placement: { ...(panelOcc.placement || {}), row: cell.row, col: cell.col } },
          emit: true,
        });
      }
    }
  }
}

// ============================================================
// FIELD FROM CC → INSTANCE
// ============================================================
export function handleFieldDrop(ctx, drop) {
  const { dispatch, socket, state } = ctx;
  const { payload, dropTarget, instanceId } = drop;

  const targetInstanceId = dropTarget.context?.instanceId || instanceId;
  if (!targetInstanceId) return;
  const instance = state?.instances?.find(i => i.id === targetInstanceId);
  if (!instance) return;

  const fieldId = payload.id;
  const existing = instance.fieldBindings || [];
  if (!existing.some(b => b.fieldId === fieldId)) {
    CommitHelpers.updateModule({ dispatch, socket, module: { ...instance, fieldBindings: [...existing, { fieldId, showLabel: true }] } });
  }
}

// ============================================================
// OPERATION FROM CC → INSTANCE
// ============================================================
export function handleOperationDrop(ctx, drop) {
  const { dispatch, socket, state } = ctx;
  const { payload, dropTarget, instanceId } = drop;

  const targetInstanceId = dropTarget.context?.instanceId || instanceId;
  if (!targetInstanceId) return;
  const instance = state?.instances?.find(i => i.id === targetInstanceId);
  if (!instance) return;

  const operationId = payload.id;
  const existing = instance.operationBindings || [];
  if (!existing.some(b => b.operationId === operationId)) {
    CommitHelpers.updateModule({
      dispatch, socket,
      module: { ...instance, operationBindings: [...existing, { operationId, widgetType: "trigger", displayName: payload.data?.name || "" }] },
    });
  }
}

// ============================================================
// ARTIFACT FROM TREE → PANEL/CONTAINER/GRID
// ============================================================
export function handleArtifactDrop(ctx, drop) {
  const { dispatch, socket, state, occurrencesById, baseContainers, clearSession, getCellFromPoint } = ctx;
  const { payload, dropTarget, panelId, containerId } = drop;

  // Drop on container → copy instance
  if (containerId) {
    const artifactOcc = occurrencesById[payload.occurrenceId];
    const artifactModule = artifactOcc ? (state?.modules || []).find(m => m.id === artifactOcc.targetId) : null;
    if (artifactModule) {
      const toC = baseContainers.find(c => c.id === containerId);
      const toCOcc = toC ? Object.values(occurrencesById).find(o => o.targetId === toC.id) : null;
      if (toCOcc) {
        LayoutHelpers.copyInstanceToContainer({
          dispatch, socket, sourceInstanceId: artifactModule.id,
          toContainer: { ...toC, _occurrence: toCOcc }, userId: state?.userId,
          gridId: state?.gridId || state?.grid?._id, emit: true,
        });
      }
    }
    clearSession();
    return;
  }

  // Drop on panel-content → switch active doc
  if (panelId && !containerId && dropTarget.type === "panel-content") {
    const panelOcc = Object.values(occurrencesById).find(o => o.targetId === panelId);
    const viewId = panelOcc?.viewId;
    const view = viewId ? state?.viewsById?.[viewId] : null;
    if (view) {
      CommitHelpers.updateView({ dispatch, socket, view: { ...view, activeOccurrenceId: payload.occurrenceId, scrollAnchor: null } });
    }
  }

  // Drop on grid cell → create artifact panel
  if (dropTarget.type === "grid-cell" && dropTarget.context?.row !== undefined) {
    const cell = { row: dropTarget.context.row, col: dropTarget.context.col };
    const grid = state?.grid;
    const userId = state?.userId;
    if (cell && grid && userId) {
      const artifactOcc = occurrencesById[payload.occurrenceId];
      const artifactModule = artifactOcc ? (state?.modules || []).find(m => m.id === artifactOcc.targetId) : null;
      const label = artifactModule?.label || "Artifact";
      const newPanel = { id: makeUUID(), label, role: "panel", kind: "list" };
      const { occurrence: panelOcc } = LayoutHelpers.createPanelInGrid({
        dispatch, socket, grid, panel: newPanel,
        placement: { row: cell.row, col: cell.col, width: 1, height: 1 }, userId, emit: true,
      });
      const viewId = makeUUID();
      CommitHelpers.createView({
        dispatch, socket,
        view: { id: viewId, userId, viewType: "display", hasTree: false, manifestId: null, activeOccurrenceId: payload.occurrenceId },
        emit: true,
      });
      CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...panelOcc, viewId }, emit: true });
    }
  }
}

// ============================================================
// FOLDER → PANEL (add child docs as pages)
// ============================================================
export function handleFolderDrop(ctx, drop) {
  const { dispatch, socket, state, occurrencesById, getHoveredPanelId } = ctx;
  const { payload } = drop;

  const hoveredPanelId = getHoveredPanelId();
  if (!hoveredPanelId) return;

  const panelOcc = Object.values(occurrencesById || {}).find(o => o.targetId === hoveredPanelId);
  if (!panelOcc) return;

  const existingOccs = [...(panelOcc.occurrences || [])];
  for (const childOccId of payload.childOccurrenceIds) {
    const childOcc = occurrencesById[childOccId];
    if (!childOcc) continue;
    const childMod = (state?.modules || []).find(m => m.id === childOcc.targetId);
    if (!childMod) continue;
    const pageModId = crypto.randomUUID();
    const pageOccId = crypto.randomUUID();
    CommitHelpers.createModule({ dispatch, socket, module: { id: pageModId, role: "page", kind: "doc", label: childMod.label || "Untitled" }, emit: true });
    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: { id: pageOccId, userId: state?.userId, gridId: state?.grid?._id, targetId: pageModId, targetType: "module", fields: {} }, emit: true });
    existingOccs.push(pageOccId);
  }
  CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: panelOcc.id, occurrences: existingOccs }, emit: true });
}

// ============================================================
// HELPER: find nearest instance index by cursor Y position
// ============================================================
function resolveNearestIndex(containerOcc, occurrencesById, y) {
  const occurrenceIds = containerOcc?.occurrences || [];
  if (occurrenceIds.length === 0) return null;

  let nearestIndex = 0;
  let nearestDistance = Infinity;

  occurrenceIds.forEach((occId, index) => {
    const occ = occurrencesById[occId];
    if (occ && occ.targetType === 'instance') {
      const el = document.querySelector(`[data-instance-id="${occ.targetId}"]`);
      if (el) {
        const rect = el.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const distance = Math.abs(y - centerY);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      }
    }
  });

  const nearestOcc = occurrencesById[occurrenceIds[nearestIndex]];
  if (nearestOcc) {
    const nearestEl = document.querySelector(`[data-instance-id="${nearestOcc.targetId}"]`);
    if (nearestEl) {
      const rect = nearestEl.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      return y < centerY ? nearestIndex : nearestIndex + 1;
    }
  }
  return null;
}
