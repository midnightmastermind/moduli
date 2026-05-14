// helpers/dropHandlers.js
// ============================================================
// Per-type drop handlers + the routeDrop dispatcher.
//
// Each handler is `(dropContext, ctx)` — `dropContext` is the unified
// shape produced by dragHitTesting.buildDropContext, `ctx` carries the
// commit-side bag (dispatch, socket, state, occurrencesById, etc.).
// Role-aware locals are derived once per handler via dropView() at the
// top of each function.
//
// ─── Date-stamp ownership map (audit, 2026-05-11) ──────────────────────────
// Every place a date-typed field value is written or cleared, and which
// layer owns the transition. "Date-typed field" = a field whose
// `field.type === "date"` AND that the active named filter lists as
// `isNav: true` (the filter-nav arrow walks it).
//
// 1. Drop into a Schedule-descended container (board page or list slot)
//    Owner: dropHandlers.computePageFilterFields
//    When:  copy-mode + move-mode handleInstanceDrop, handleModuleDrop (CC drag)
//    What:  resolves the destination container's parent-chain effective
//           filter (page override → grid filter), normalizes via
//           normalizeFilterDateValue, folds the result into the source's
//           fields BEFORE LayoutHelpers.copyInstanceToContainer creates the
//           occurrence — so the optimistic OccurrenceCreateOp + per-field
//           MeasureOp loop see the destination's date.
//
// 2. Move into a Schedule-descended container (occurrence already exists)
//    Owner: dropHandlers.stampPageFilterFields
//    When:  handleOccurrenceMove same-grid move branch
//    What:  same merge as #1, but written via CommitHelpers.updateOccurrence
//           AND mirrored into operationsBridge.updateLocalOcc so the
//           subsequent fireMoveTrigger MeasureOp loop sees the new date.
//
// 3. Move out of Schedule into a non-schedule container or page
//    Owner: Operation "Schedule: Clear Date on Move-Out" (createTestGrid.js)
//    Trigger: onMove (subjectType: "occurrence")
//    What:  if the moved occurrence's _ancestors no longer include the
//           Schedule page, UPDATE writes null to fields.<dateFieldId>.value
//           and fields.<timeslotFieldId>.value. Copy never fires this path
//           because copy mints a new occurrence id.
//
// 4. Drop into a canvas page (PageCanvas)
//    Owner: dropHandlers.handleOccurrenceMove canvas branch
//    Stamps: meta.x / meta.y ONLY — never touches the date field. Canvas
//            placement is positional and intentionally orthogonal to the
//            filter-nav cascade.
//
// 5. Per-day instance creation by "Schedule: Seed Daily Routine"
//    Owner: Operation seed pipeline
//    What:  CREATE actions write fields: { [dateFieldId]: "$schedDate" }
//           where $schedDate resolves to (in order):
//             a. $parentFilter.<dateFieldId>      — slot-level override wins
//             b. $schedPage._effectiveFilter.<dateFieldId>  — page filter
//             c. $trigger.date                    — filter-nav payload
//             d. $today                           — ultimate fallback
//           operationActions.CREATE validates the resolved value via
//           isDateValue() and falls back to $today if it isn't a parseable
//           YYYY-MM-DD prefix.
//
// 6. Per-todo copy by "Schedule: Build Day" todo sweep
//    Owner: Operation Build Day pipeline
//    What:  CREATE writes fields: { [dateFieldId]: "$schedDate" } for the
//           Due-container copy — same isDateValue guard as #5.
//
// 7. "Schedule: Stamp Date & Time Slot" operation
//    Owner: Operation pipeline (onCreate, centerHub panel)
//    Stamps: timeslot field ONLY. The date field is intentionally NOT
//            written here — the drop side (#1/#2) already pre-stamped it
//            from the slot's effective filter at drop time, and rewriting
//            via $trigger._effectiveFilter would resolve to undefined on
//            the optimistic OccurrenceCreateOp transaction and clobber the
//            correct value. Comment in createTestGrid.js documents this.
//
// 8. Auto-attach safety net (added 2026-05-11)
//    Owner: bindSocketToStore.applyOperationEffect UPDATE_ITEM_FIELD
//    What:  When any op writes occ.fields[fid] and the target module's
//           fieldBindings doesn't include fid, the binding is appended
//           (role:"input"). Same coverage in operationActions.CREATE for
//           cfg.fields keys and operationActions.UPDATE_MODULE for
//           cfg.attachFields. Without this the renderer silently dropped
//           the value because the module wasn't bound to the field.
// ───────────────────────────────────────────────────────────────────────────

import * as CommitHelpers from "./CommitHelpers";
import { setOccurrenceFieldValue } from "./CommitHelpers";
import * as LayoutHelpers from "./LayoutHelpers";
import { DragType, parseExternalDrop } from "./dragSystem";
import { runMatchingOperations } from "./operationExecutor";
import { operationsBridge } from "../state/bindSocketToStore";
import { embedDeleteRegistry } from "./embedRegistry";
import { buildReverseMap, findGridPanelOcc } from "./occurrenceHelpers";
import { createModuleAction, createOccurrenceAction } from "../state/actions";
import { mimeToKind } from "./fileKind";
import { getEffectiveFilterForOccurrence } from "../state/selectors";
import { DROP_TARGET_KIND } from "./dragHitTesting";

// Normalize a date-typed filter value to a local-tz YYYY-MM-DD string. Handles
// the three input shapes the filter pipeline produces in the wild:
//   1) "2026-05-23"        — already a day-key, return as-is
//   2) "2026-05-23T...Z"   — ISO timestamp, slice the date prefix; the time
//      component shouldn't bleed into local-tz interpretation downstream.
//   3) Date instance       — format via getFullYear/getMonth/getDate.
// null/undefined/empty → null. Other shapes → null (caller skips stamp).
//
// Why this exists: stampPageFilterFields previously passed `effective[fid]`
// straight through. When the page filter stored a UTC midnight ISO string
// ("2026-05-23T00:00:00.000Z"), downstream date-field renders called
// `new Date(...)` and shifted to the previous day in any TZ west of UTC —
// the "stamping as May 22 when the filter says May 23" bug.
export function normalizeFilterDateValue(v) {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  return null;
}

// Resolves the page-filter date stamps that should land on an occurrence
// placed under `parentContainerOcc`, returning a merged fields map (existing +
// stamped) without writing anything. Use BEFORE creating the occurrence so the
// new record is born with the correct date — otherwise the in-flight
// OccurrenceCreateOp + per-field MeasureOps fire against the source's old
// date and trackers (which check `fields.<dateFieldId>.value SAME_DAY
// $goalDate`) silently exclude it. Returns the original `existingFields`
// reference unchanged when there are no nav fields or no value to stamp, so
// callers can cheaply detect a no-op via identity.
function computePageFilterFields({ state, occurrencesById, parentContainerOcc, existingFields = {} }) {
  if (!parentContainerOcc) return existingFields;
  const grid = state?.grid;
  const activeNamedFilter = (grid?.namedFilters || []).find(f => f.id === grid?.activeFilterId);
  const navFieldIds = (activeNamedFilter?.conditions || [])
    .filter(c => c.isNav && c.fieldId)
    .map(c => c.fieldId);
  if (!navFieldIds.length) return existingFields;

  const effective = getEffectiveFilterForOccurrence(parentContainerOcc, { grid, occurrencesById });
  let merged = existingFields;
  for (const fid of navFieldIds) {
    const v = normalizeFilterDateValue(effective?.[fid]);
    if (v == null) continue;
    const existing = merged[fid];
    const existingValue = existing && typeof existing === "object" ? existing.value : existing;
    if (normalizeFilterDateValue(existingValue) === v) continue;
    if (merged === existingFields) merged = { ...existingFields };
    merged[fid] = { value: v, flow: existing?.flow ?? "in" };
  }
  return merged;
}

// Post-create / post-move stamp for an existing occurrence. Writes the
// stamped fields via updateOccurrence AND mirrors them into the executor's
// local cache so the next fireOperations pass (e.g. the per-field MeasureOp
// loop after a move) sees the new date in $allItems. Pre-creates should call
// `computePageFilterFields` directly and fold the result into the create
// payload — this function is for the rare case where the occurrence already
// exists.
function stampPageFilterFields({ dispatch, socket, state, occurrencesById, occurrence, parentContainerOcc }) {
  if (!occurrence?.id || !parentContainerOcc) return;
  const merged = computePageFilterFields({
    state, occurrencesById,
    parentContainerOcc,
    existingFields: occurrence.fields || {},
  });
  if (merged === (occurrence.fields || {})) return;
  CommitHelpers.updateOccurrence({
    dispatch, socket,
    occurrence: { id: occurrence.id, fields: merged },
    emit: true,
  });
  operationsBridge.updateLocalOcc?.({ ...occurrence, fields: merged });
}

function makeUUID() {
  return crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cellKeyFromPanel(p) {
  return `cell-${p.row}-${p.col}`;
}

// ============================================================
// PANEL → GRID CELL
// ============================================================
export function handlePanelDrop(dropContext, ctx) {
  const { dispatch, socket, state, occurrencesById, baseAllPanels, getCellFromPoint } = ctx;
  const { payload, target, position, pointer, mode, modifiers, dataTransfer } = dropContext;
  const { x, y } = pointer || { x: 0, y: 0 };
  const { dropTarget } = dropView(dropContext, ctx);

  let isCrossWindow = false;
  if (dropTarget.dataTransfer) {
    const parsed = parseExternalDrop(dropTarget.dataTransfer);
    isCrossWindow = parsed.isCrossWindow;
  }

  let cell = null;
  if (dropTarget.type === DROP_TARGET_KIND.GRID_CELL && dropTarget.context?.row !== undefined && dropTarget.context?.col !== undefined) {
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
    const panel = baseAllPanels.find(p => p.id === payload.moduleId);
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
      const sourceStack = baseAllPanels.filter(p => p.id !== payload.moduleId && cellKeyFromPanel(p) === sourceCellKey);
      const destStack = baseAllPanels.filter(p => p.id !== payload.moduleId && cellKeyFromPanel(p) === destCellKey);

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
export function handleContainerDrop(dropContext, ctx) {
  const { dispatch, socket, state, occurrencesById, baseAllPanels, baseContainers, clearSession, sessionRef } = ctx;
  const { payload, target, position, pointer, mode, modifiers, dataTransfer } = dropContext;
  const { x, y } = pointer || { x: 0, y: 0 };
  const { containerId, panelId, dropTarget } = dropView(dropContext, ctx);
  const drop = { dropTarget };

  let isCrossWindow = false;
  if (dropTarget.dataTransfer) {
    const parsed = parseExternalDrop(dropTarget.dataTransfer);
    isCrossWindow = parsed.isCrossWindow;
  }

  // ── CANVAS PAGE drop ────────────────────────────────────────────────
  // Containers dragged onto a canvas page land at the drop pointer with
  // `meta.x/y` stamped. The container's module is preserved as-is —
  // `kind` doesn't change, `role` stays "container". Whether the
  // container came from a board, a doc embed, or another canvas, the
  // SAME branch runs so behaviour is uniform.
  const toPageOccId = dropTarget.context?.pageOccurrenceId;
  const toPageOcc = toPageOccId ? occurrencesById[toPageOccId] : null;
  const toPageMod = toPageOcc ? state?.modulesById?.[toPageOcc.moduleId] : null;
  if (toPageOcc && toPageMod?.kind === "canvas") {
    const occurrenceId = payload.context?.occurrenceId
      || payload.context?.containerOccurrenceId
      || (payload.moduleId ? Object.values(occurrencesById).find(o => o.moduleId === payload.moduleId)?.id : null);
    if (!occurrenceId) { clearSession(); return; }
    const movedOcc = occurrencesById[occurrenceId];
    if (!movedOcc) { clearSession(); return; }

    const rect = dropTarget.context?.targetRect
      || document.querySelector(`[data-page-occ-id="${toPageOccId}"] .canvas-surface`)?.getBoundingClientRect?.()
      || document.querySelector(`[data-page-occ-id="${toPageOccId}"]`)?.getBoundingClientRect?.();
    const cx = rect ? Math.max(0, Math.round(x - rect.left)) : 20;
    const cy = rect ? Math.max(0, Math.round(y - rect.top)) : 20;

    const fromParentOccId = movedOcc.parentId
      || Object.values(occurrencesById).find(o => Array.isArray(o.occurrences) && o.occurrences.includes(occurrenceId))?.id;
    const fromParentOcc = fromParentOccId ? occurrencesById[fromParentOccId] : null;

    // Same-canvas drop = reposition only.
    if (fromParentOccId === toPageOccId) {
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: occurrenceId, meta: { ...(movedOcc.meta || {}), x: cx, y: cy } },
        emit: true,
      });
      clearSession();
      return;
    }

    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrenceId, parentId: toPageOccId, meta: { ...(movedOcc.meta || {}), x: cx, y: cy } },
      emit: true,
    });
    if (fromParentOcc) {
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: fromParentOcc.id, occurrences: (fromParentOcc.occurrences || []).filter(id => id !== occurrenceId) },
        emit: true,
      });
    }
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: toPageOccId, occurrences: [...(toPageOcc.occurrences || []).filter(id => id !== occurrenceId), occurrenceId] },
      emit: true,
    });
    if (payload.context?.sourceType === "doc-embed") {
      embedDeleteRegistry.get(occurrenceId)?.();
    }
    clearSession();
    return;
  }

  // ── CANVAS SOURCE — drag container OUT of canvas back to a board ────
  // The default panel-to-panel branch below can't handle a canvas-page
  // source because canvas pages aren't in `baseAllPanels`. Strip any
  // canvas-only positional meta (x/y) so the container doesn't carry
  // floating-card coordinates into a list panel, then re-parent it.
  const fromCanvasPageOccId = payload.context?.containerOccurrenceId
    || payload.context?.pageOccurrenceId
    || payload.context?.parentOccurrenceId;
  const fromCanvasPageOcc = fromCanvasPageOccId ? occurrencesById[fromCanvasPageOccId] : null;
  const fromCanvasPageMod = fromCanvasPageOcc ? state?.modulesById?.[fromCanvasPageOcc.moduleId] : null;
  const isCanvasSource = fromCanvasPageMod?.kind === "canvas" && fromCanvasPageMod?.role === "page";
  if (isCanvasSource && panelId) {
    const occurrenceId = payload.context?.occurrenceId
      || (payload.moduleId ? Object.values(occurrencesById).find(o => o.moduleId === payload.moduleId && o.parentId === fromCanvasPageOcc.id)?.id : null);
    if (!occurrenceId) { clearSession(); return; }
    const movedOcc = occurrencesById[occurrenceId];
    if (!movedOcc) { clearSession(); return; }

    const toPanel = baseAllPanels.find(p => p.id === panelId);
    const toPanelOcc = toPanel?._occurrence ? occurrencesById[toPanel._occurrence.id] : null;
    const toPageDropId = dropTarget.context?.pageOccurrenceId;
    const toOrderOcc = toPageDropId ? (occurrencesById[toPageDropId] || toPanelOcc) : toPanelOcc;
    if (!toOrderOcc) { clearSession(); return; }

    // Strip canvas-only x/y from meta.
    const { x: _x, y: _y, ...metaWithoutPos } = movedOcc.meta || {};
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrenceId, parentId: toOrderOcc.id, meta: metaWithoutPos },
      emit: true,
    });
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: fromCanvasPageOcc.id, occurrences: (fromCanvasPageOcc.occurrences || []).filter(id => id !== occurrenceId) },
      emit: true,
    });
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: toOrderOcc.id, occurrences: [...(toOrderOcc.occurrences || []).filter(id => id !== occurrenceId), occurrenceId] },
      emit: true,
    });
    clearSession();
    return;
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
  } else if (payload.context?.sourceType === "doc-embed") {
    // Container dragged out of a doc embed — add to target board page or panel
    const toPanel = baseAllPanels.find(p => p.id === panelId);
    if (!toPanel) { clearSession(); return; }
    const toPanelOcc = toPanel._occurrence ? occurrencesById[toPanel._occurrence.id] : null;
    if (!toPanelOcc) { clearSession(); return; }

    const occurrenceId = payload.context?.occurrenceId;
    if (!occurrenceId) { clearSession(); return; }

    // Board panels store containers inside page occurrences, not the panel occurrence
    const toPageOccId = drop.dropTarget?.context?.pageOccurrenceId;
    const toOrderOcc = toPageOccId ? (occurrencesById[toPageOccId] || toPanelOcc) : toPanelOcc;

    const newOccurrences = [...(toOrderOcc.occurrences || []), occurrenceId];
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: toOrderOcc.id, occurrences: newOccurrences }, emit: true });

    // Move mode: remove from doc embed
    if (sessionRef.current.mode !== "copy") {
      embedDeleteRegistry.get(occurrenceId)?.();
    }
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

    // The handler used to require both fromPanel and toPanel to exist, but
    // when source/destination is a board *page* (role: "page", not "panel")
    // baseAllPanels doesn't contain it. fromOrderOcc + toOrderOcc are the
    // real ordering anchors — they're populated for both panels and pages
    // via the pageOccurrenceId branch above. Gate on those instead.
    if (fromOrderOcc && toOrderOcc) {
      const draggedContainerId = payload.moduleId;
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
      const samePanel = !!(fromPanel && toPanel && fromPanel.id === toPanel.id);
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
// Resolve the target index for inserting a dragged occurrence into
// `toCOcc.occurrences[]`. Reads `dropTarget.context.insertAt` (set by the
// drop zone) first; otherwise honours the closestEdge of the hovered
// instance, with the same-container forward-shift adjustment.
function _resolveToIndex({ dropTarget, instanceId, toCOcc, occurrencesById, fromCOcc, draggedInstanceId, pointerY }) {
  if (dropTarget.context?.insertAt !== undefined) return dropTarget.context.insertAt;
  if (instanceId && toCOcc) {
    const hoveredIndex = LayoutHelpers.getTargetIndexInOccurrences(instanceId, toCOcc.occurrences || [], occurrencesById);
    if (hoveredIndex !== -1) {
      const edge = dropTarget.context?.closestEdge;
      let toIndex = (edge === "bottom" || edge === "right") ? hoveredIndex + 1 : hoveredIndex;
      if (fromCOcc && fromCOcc.id === toCOcc.id && draggedInstanceId) {
        const fromIndex = LayoutHelpers.getTargetIndexInOccurrences(draggedInstanceId, fromCOcc.occurrences || [], occurrencesById);
        if (fromIndex !== -1 && fromIndex < hoveredIndex) toIndex = Math.max(0, toIndex - 1);
      }
      return toIndex;
    }
  }
  // No specific instance under the cursor — fall back to nearest-by-Y so the
  // drop lands at the pointer position, not appended to the end. Common when
  // dropping a textblock into the gap between cards or onto the container's
  // empty area while siblings exist.
  if (toCOcc && typeof pointerY === "number") {
    return resolveNearestIndex(toCOcc, occurrencesById, pointerY);
  }
  return null;
}

// Drop a doc-embed instance (TipTap moduleEmbed node, or instanceTextblock
// node) onto a target. The occurrence already exists; we MOVE it (or copy
// it) to the destination — never mint a fresh one. In move mode we also ask
// the embed registry to remove the source TipTap node from the parent doc.
// Routed here from routeDrop so handleOccurrenceMove can stay focused on
// in-grid moves/copies.
//
// Supports three destinations:
//   1. List container — splice into container.occurrences[]
//   2. Canvas page    — set parentId to page, stamp meta.x/y from pointer
//   3. Grid cell      — create new panel+container, place occurrence there
//
// For copy mode (sessionRef.current.mode === "copy") a NEW occurrence id is
// minted with the same fields/textmap, and the source TipTap node stays put.
export function handleDocEmbedDrop(dropContext, ctx) {
  const { dispatch, socket, state, occurrencesById, baseContainers, baseAllPanels, clearSession, sessionRef } = ctx;
  const { payload, pointer } = dropContext;
  const { x, y } = pointer || { x: 0, y: 0 };
  const { containerId, containerOccurrenceId, instanceId, dropTarget } = dropView(dropContext, ctx);

  const occurrenceId = payload.context?.occurrenceId;
  if (!occurrenceId) { clearSession(); return; }
  const movedOcc = occurrencesById[occurrenceId];
  if (!movedOcc) { clearSession(); return; }

  const isCopy = sessionRef.current.mode === "copy";
  const gridId = state?.gridId || state?.grid?._id;

  // Helper: clone the occurrence (used for copy mode).
  const cloneOccurrence = (extra = {}) => {
    const newOccId = makeUUID();
    CommitHelpers.createOccurrence({
      dispatch, socket,
      occurrence: {
        id: newOccId,
        userId: state?.userId,
        gridId,
        moduleId: movedOcc.moduleId,
        fields: { ...(movedOcc.fields || {}) },
        textmap: movedOcc.textmap || null,
        ...extra,
      },
      emit: true,
    });
    return newOccId;
  };

  // ── 1. CANVAS PAGE drop ──────────────────────────────────────────────
  const toPageOccId = dropTarget.context?.pageOccurrenceId;
  const toPageOcc = toPageOccId ? occurrencesById[toPageOccId] : null;
  const toPageMod = toPageOcc ? state?.modulesById?.[toPageOcc.moduleId] : null;
  if (toPageOcc && toPageMod?.kind === "canvas") {
    const rect = dropTarget.context?.targetRect
      || document.querySelector(`[data-page-occ-id="${toPageOccId}"] .canvas-surface`)?.getBoundingClientRect?.()
      || document.querySelector(`[data-page-occ-id="${toPageOccId}"]`)?.getBoundingClientRect?.();
    const cx = rect ? Math.max(0, Math.round(x - rect.left)) : 20;
    const cy = rect ? Math.max(0, Math.round(y - rect.top)) : 20;

    if (isCopy) {
      const newOccId = cloneOccurrence({ parentId: toPageOccId, meta: { ...(movedOcc.meta || {}), x: cx, y: cy } });
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: toPageOccId, occurrences: [...(toPageOcc.occurrences || []), newOccId] },
        emit: true,
      });
    } else {
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: occurrenceId, parentId: toPageOccId, meta: { ...(movedOcc.meta || {}), x: cx, y: cy } },
        emit: true,
      });
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: toPageOccId, occurrences: [...(toPageOcc.occurrences || []).filter(id => id !== occurrenceId), occurrenceId] },
        emit: true,
      });
      embedDeleteRegistry.get(occurrenceId)?.();
    }
    clearSession();
    return;
  }

  // ── 2. GRID CELL drop ────────────────────────────────────────────────
  if (dropTarget.type === DROP_TARGET_KIND.GRID_CELL && dropTarget.context?.row !== undefined) {
    const cell = { row: dropTarget.context.row, col: dropTarget.context.col };
    const grid = state?.grid;
    const userId = state?.userId;
    if (cell && grid && userId && gridId) {
      const label = state?.modulesById?.[movedOcc.moduleId]?.label || "Textblock";
      const newPanel = { id: makeUUID(), label, role: "panel", kind: "list" };
      const { occurrence: panelOcc } = LayoutHelpers.createPanelInGrid({
        dispatch, socket, grid, panel: newPanel,
        placement: { row: cell.row, col: cell.col, width: 1, height: 1 }, userId, emit: true,
      });
      const newContainer = { id: makeUUID(), label, role: "container", kind: "list" };
      const { occurrence: containerOcc } = LayoutHelpers.createContainerInPanel({
        dispatch, socket, gridId, panel: { ...newPanel, _occurrence: panelOcc },
        container: newContainer, userId, emit: true,
      });

      if (isCopy) {
        const newOccId = cloneOccurrence({ parentId: containerOcc.id });
        CommitHelpers.updateOccurrence({
          dispatch, socket,
          occurrence: { id: containerOcc.id, occurrences: [...(containerOcc.occurrences || []), newOccId] },
          emit: true,
        });
      } else {
        CommitHelpers.updateOccurrence({
          dispatch, socket,
          occurrence: { id: occurrenceId, parentId: containerOcc.id },
          emit: true,
        });
        CommitHelpers.updateOccurrence({
          dispatch, socket,
          occurrence: { id: containerOcc.id, occurrences: [...(containerOcc.occurrences || []), occurrenceId] },
          emit: true,
        });
        embedDeleteRegistry.get(occurrenceId)?.();
      }
    }
    clearSession();
    return;
  }

  // ── 3. LIST CONTAINER drop ───────────────────────────────────────────
  const toC = baseContainers.find(c => c.id === containerId);
  const toCOcc = (containerOccurrenceId && occurrencesById[containerOccurrenceId])
    || (toC ? Object.values(occurrencesById).find(o => o.moduleId === toC.id) : null);
  if (!toC || !toCOcc) { clearSession(); return; }

  const toIndex = _resolveToIndex({ dropTarget, instanceId, toCOcc, occurrencesById, pointerY: y });

  if (isCopy) {
    const newOccId = cloneOccurrence({ parentId: toCOcc.id });
    const newOccurrences = [...(toCOcc.occurrences || [])];
    if (toIndex !== null) newOccurrences.splice(toIndex, 0, newOccId);
    else newOccurrences.push(newOccId);
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: toCOcc.id, occurrences: newOccurrences }, emit: true });
  } else {
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrenceId, parentId: toCOcc.id },
      emit: true,
    });
    const newOccurrences = [...(toCOcc.occurrences || []).filter(id => id !== occurrenceId)];
    if (toIndex !== null) newOccurrences.splice(toIndex, 0, occurrenceId);
    else newOccurrences.push(occurrenceId);
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: toCOcc.id, occurrences: newOccurrences }, emit: true });
    embedDeleteRegistry.get(occurrenceId)?.();
  }
  clearSession();
}

export function handleOccurrenceMove(dropContext, ctx) {
  const { dispatch, socket, state, occurrencesById, baseContainers, clearSession, sessionRef } = ctx;
  const { payload, target, position, pointer, mode, modifiers, dataTransfer } = dropContext;
  const { x, y } = pointer || { x: 0, y: 0 };
  const { containerId, containerOccurrenceId, instanceId, dropTarget } = dropView(dropContext, ctx);

  if (dropTarget.dataTransfer) {
    const parsed = parseExternalDrop(dropTarget.dataTransfer);
    if (parsed.isCrossWindow) return; // Let cross-window handler deal with it
  }

  // GRID CELL drop — drilldown: create a new panel + container in the empty
  // cell and copy the instance there. Mirrors the leaf-role branch in
  // handleModuleDrop (line ~1261) so in-grid drags of textblocks/instances
  // can be placed anywhere on the grid, not just into existing containers.
  if (dropTarget.type === DROP_TARGET_KIND.GRID_CELL && dropTarget.context?.row !== undefined) {
    const cell = { row: dropTarget.context.row, col: dropTarget.context.col };
    const grid = state?.grid;
    const userId = state?.userId;
    const gridId = state?.gridId || state?.grid?._id;
    const sourceModule = (state?.modules || []).find(m => m.id === payload.moduleId);
    if (cell && grid && userId && sourceModule) {
      const newPanel = { id: makeUUID(), label: sourceModule.label || "Panel", role: "panel", kind: "list" };
      const { occurrence: panelOcc } = LayoutHelpers.createPanelInGrid({
        dispatch, socket, grid, panel: newPanel,
        placement: { row: cell.row, col: cell.col, width: 1, height: 1 }, userId, emit: true,
      });
      const newContainer = { id: makeUUID(), label: sourceModule.label || "Container", role: "container", kind: "list" };
      const { occurrence: containerOcc } = LayoutHelpers.createContainerInPanel({
        dispatch, socket, gridId, panel: { ...newPanel, _occurrence: panelOcc },
        container: newContainer, userId, emit: true,
      });
      LayoutHelpers.copyInstanceToContainer({
        dispatch, socket, gridId, sourceInstanceId: sourceModule.id,
        toContainer: { ...newContainer, _occurrence: containerOcc },
        userId, iterationMode: "persistent", emit: true,
      });
    }
    clearSession?.();
    return;
  }

  // Helper: fire OccurrenceMoveOp + per-field MeasureOp so user-defined `onMove`
  // operations (e.g. "Schedule: Clear Date on Move-Out") run after the move.
  // Mirrors the post-move trigger burst in the regular container-move branch
  // so canvas moves participate in the same operation pipeline.
  const fireMoveTrigger = ({ occurrenceId, instanceId, fromContainerId, toContainerId, fromPanelId, toPanelId }) => {
    operationsBridge.fireOperations?.("OccurrenceMoveOp", {
      type: "OccurrenceMoveOp",
      occurrenceId,
      instanceId,
      fromContainerId,
      toContainerId,
      fromPanelId,
      toPanelId,
    });
    const movedOcc = occurrencesById[occurrenceId];
    for (const fieldId of Object.keys(movedOcc?.fields || {})) {
      const fv = movedOcc.fields[fieldId];
      operationsBridge.fireOperations?.("MeasureOp", {
        type: "MeasureOp",
        occurrenceId,
        instanceId,
        fieldId,
        value: fv && typeof fv === "object" && "value" in fv ? fv.value : fv,
      });
    }
  };

  // CANVAS PAGE drop — move/copy a leaf occurrence into the page with meta.x/y stamp.
  // The page itself is the parent (no container in between).
  const toPageOccId = dropTarget.context?.pageOccurrenceId;
  const toPageOcc = toPageOccId ? occurrencesById[toPageOccId] : null;
  const toPageMod = toPageOcc ? state?.modulesById?.[toPageOcc.moduleId] : null;
  if (toPageOcc && toPageMod?.kind === "canvas") {
    const occurrenceId = payload.context?.occurrenceId;
    if (!occurrenceId) { clearSession(); return; }
    const movedOcc = occurrencesById[occurrenceId];
    if (!movedOcc) { clearSession(); return; }

    const rect = dropTarget.context?.targetRect
      || document.querySelector(`[data-page-occ-id="${toPageOccId}"] .canvas-surface`)?.getBoundingClientRect?.()
      || document.querySelector(`[data-page-occ-id="${toPageOccId}"]`)?.getBoundingClientRect?.();
    const cx = rect ? Math.max(0, Math.round(x - rect.left)) : 20;
    const cy = rect ? Math.max(0, Math.round(y - rect.top)) : 20;

    // Same-canvas drop = reposition only: just update meta.x/y, no parent change.
    if (movedOcc.parentId === toPageOccId) {
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: occurrenceId, meta: { ...(movedOcc.meta || {}), x: cx, y: cy } },
        emit: true,
      });
      clearSession();
      return;
    }

    const isCopy = sessionRef.current?.mode === "copy";
    if (isCopy) {
      const newOccId = makeUUID();
      CommitHelpers.createOccurrence({
        dispatch, socket,
        occurrence: {
          id: newOccId,
          userId: state?.userId,
          gridId: state?.gridId || state?.grid?._id,
          moduleId: movedOcc.moduleId,
          parentId: toPageOccId,
          fields: { ...(movedOcc.fields || {}) },
          meta: { ...(movedOcc.meta || {}), x: cx, y: cy },
        },
        emit: true,
      });
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: toPageOccId, occurrences: [...(toPageOcc.occurrences || []), newOccId] },
        emit: true,
      });
    } else {
      // Move: detach from old parent, attach to page, stamp canvas position.
      const fromParentOccId = movedOcc.parentId;
      const fromParentOcc = fromParentOccId ? occurrencesById[fromParentOccId] : null;
      const newMeta = { ...(movedOcc.meta || {}), x: cx, y: cy };
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: {
          id: occurrenceId,
          parentId: toPageOccId,
          meta: newMeta,
        },
        emit: true,
      });
      if (fromParentOcc) {
        CommitHelpers.updateOccurrence({
          dispatch, socket,
          occurrence: {
            id: fromParentOccId,
            occurrences: (fromParentOcc.occurrences || []).filter(id => id !== occurrenceId),
          },
          emit: true,
        });
      }
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: {
          id: toPageOccId,
          occurrences: [...(toPageOcc.occurrences || []).filter(id => id !== occurrenceId), occurrenceId],
        },
        emit: true,
      });
      // Mirror the parent-occurrences update into the executor cache before
      // firing the move trigger so user-defined onMove ops see the new ancestry.
      if (fromParentOcc) {
        operationsBridge.updateLocalOcc?.({
          ...fromParentOcc,
          occurrences: (fromParentOcc.occurrences || []).filter(id => id !== occurrenceId),
        });
      }
      operationsBridge.updateLocalOcc?.({
        ...toPageOcc,
        occurrences: [...(toPageOcc.occurrences || []).filter(id => id !== occurrenceId), occurrenceId],
      });
      // Mirror the FULL post-update state (including new meta) into the executor
      // cache. If we leave old meta here, downstream onMove ops that read the
      // occurrence and dispatch a derived update will overwrite our fresh
      // meta.x/y in Redux with stale values — card lands at default 20,20.
      operationsBridge.updateLocalOcc?.({
        ...movedOcc,
        parentId: toPageOccId,
        meta: newMeta,
      });
      fireMoveTrigger({
        occurrenceId,
        instanceId: movedOcc.moduleId,
        fromContainerId: fromParentOcc?.moduleId || null,
        toContainerId: toPageOcc.moduleId,
        fromPanelId: null,
        toPanelId: null,
      });
    }
    clearSession();
    return;
  }

  // CANVAS PAGE source — drag from canvas onto a regular container/panel/cell.
  // The page is the source parent (not a container), so the standard fromC lookup
  // returns undefined. Handle move/copy out manually.
  const fromCanvasPageOccId = payload.context?.containerOccurrenceId
    || payload.context?.parentOccurrenceId;
  const fromCanvasPageOcc = fromCanvasPageOccId ? occurrencesById[fromCanvasPageOccId] : null;
  const fromCanvasPageMod = fromCanvasPageOcc ? state?.modulesById?.[fromCanvasPageOcc.moduleId] : null;
  const isCanvasSource = fromCanvasPageMod?.kind === "canvas" && fromCanvasPageMod?.role === "page";
  if (isCanvasSource) {
    const occurrenceId = payload.context?.occurrenceId;
    const movedOcc = occurrenceId ? occurrencesById[occurrenceId] : null;
    if (!movedOcc) { clearSession(); return; }

    const toCInner = baseContainers.find(c => c.id === containerId);
    const toCInnerOcc = (containerOccurrenceId && occurrencesById[containerOccurrenceId])
      || (toCInner ? Object.values(occurrencesById).find(o => o.moduleId === toCInner.id) : null);
    if (!toCInner || !toCInnerOcc) { clearSession(); return; }
    if (toCInner.kind === "doc") { clearSession(); return; } // editor handles doc drops itself

    const isCopy = sessionRef.current?.mode === "copy";
    if (isCopy) {
      LayoutHelpers.copyInstanceToContainer({
        dispatch, socket,
        gridId: state?.gridId || state?.grid?._id,
        sourceInstanceId: payload.moduleId,
        toContainer: { ...toCInner, _occurrence: toCInnerOcc },
        userId: state?.userId, emit: true,
        sourceOccurrence: movedOcc,
      });
    } else {
      // Strip canvas-only positional meta (x/y) so it doesn't carry into a list container.
      const { x: _x, y: _y, ...metaWithoutPos } = movedOcc.meta || {};
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: occurrenceId, parentId: toCInnerOcc.id, meta: metaWithoutPos },
        emit: true,
      });
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: {
          id: fromCanvasPageOcc.id,
          occurrences: (fromCanvasPageOcc.occurrences || []).filter(id => id !== occurrenceId),
        },
        emit: true,
      });
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: {
          id: toCInnerOcc.id,
          occurrences: [...(toCInnerOcc.occurrences || []).filter(id => id !== occurrenceId), occurrenceId],
        },
        emit: true,
      });
      operationsBridge.updateLocalOcc?.({
        ...fromCanvasPageOcc,
        occurrences: (fromCanvasPageOcc.occurrences || []).filter(id => id !== occurrenceId),
      });
      operationsBridge.updateLocalOcc?.({
        ...toCInnerOcc,
        occurrences: [...(toCInnerOcc.occurrences || []).filter(id => id !== occurrenceId), occurrenceId],
      });
      operationsBridge.updateLocalOcc?.({
        ...movedOcc,
        parentId: toCInnerOcc.id,
        meta: metaWithoutPos,
      });
      // Stamp the destination's effective page filter (date, etc.) onto the
      // moved occurrence so trackers' SAME_DAY predicates match. Canvas
      // sources don't carry a date by default — without this stamp the note
      // lands in the slot with `fields[dateFieldId]` unset, and the goal
      // aggregations never count it. Mirrors the same call the container-to-
      // container move branch makes below.
      stampPageFilterFields({
        dispatch, socket, state, occurrencesById,
        occurrence: occurrencesById[occurrenceId],
        parentContainerOcc: toCInnerOcc,
      });
      fireMoveTrigger({
        occurrenceId,
        instanceId: movedOcc.moduleId,
        fromContainerId: fromCanvasPageOcc.moduleId,
        toContainerId: toCInner.id,
        fromPanelId: null,
        toPanelId: null,
      });
    }
    clearSession();
    return;
  }

  const fromC = baseContainers.find(c => c.id === payload.context?.containerId);
  const toC = baseContainers.find(c => c.id === containerId);
  // Schedule slots have one occurrence per day sharing the same module id, so
  // prefer the per-occurrence id from the payload/drop context. Falling back
  // to find-by-targetId silently picks the first day's slot, which is rarely
  // the visible one — that's the "drop does nothing" symptom.
  const fromCOccCandidateId = payload.context?.containerOccurrenceId
    || payload.context?.containerOccId
    || payload.context?.parentOccurrenceId
    || null;
  const fromCOcc = (fromCOccCandidateId && occurrencesById[fromCOccCandidateId])
    || (fromC ? Object.values(occurrencesById).find(o => o.moduleId === fromC.id) : null);
  const toCOcc = (containerOccurrenceId && occurrencesById[containerOccurrenceId])
    || (toC ? Object.values(occurrencesById).find(o => o.moduleId === toC.id) : null);

  if (!fromC || !toC) return;

  // Doc containers handle drops via Editor.jsx's dropTargetForElements → moduleEmbed insertion.
  // DragProvider must not also move/copy the instance into the container's occurrence list.
  if (toC.kind === "doc") return;

  if (toC.behaviorMode === "own" && toC.behavior?.droppable === false) { clearSession(); return; }

  const draggedInstanceId = payload.moduleId;
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
    const _revMap = buildReverseMap(Object.values(occurrencesById));
    const _gridOccSet = new Set(state?.grid?.occurrences || []);
    const toPanelOcc = toCOcc ? findGridPanelOcc(toCOcc, _revMap, occurrencesById, _gridOccSet) : null;
    // Pre-stamp page-filter fields onto the source's fields so the create
    // lands with the destination's date already set. Without this, the
    // OccurrenceCreateOp + per-field MeasureOps fired by createOccurrence see
    // the source's old date and trackers' SAME_DAY predicate silently rejects
    // the new occurrence — the post-create stamp then quietly fixes the date
    // but no operation re-fires, so trackers stay stale until you edit a
    // field.
    const sourceOcc = occurrenceId ? occurrencesById[occurrenceId] : null;
    const stampedFields = computePageFilterFields({
      state, occurrencesById,
      parentContainerOcc: toCOcc,
      existingFields: sourceOcc?.fields || {},
    });
    const toPanelMod = toPanelOcc?.moduleId
      ? state?.modulesById?.[toPanelOcc.moduleId]
      : null;
    const copyResult = LayoutHelpers.copyInstanceToContainer({
      dispatch, socket, gridId, sourceInstanceId: draggedInstanceId,
      toContainer: toCOcc ? { ...toC, _occurrence: toCOcc } : toC,
      userId: state?.userId, toIndex, emit: true,
      iterationMode: "specific", iterationValue: currentIterationDate,
      sourceOccurrence: sourceOcc
        ? { ...sourceOcc, fields: stampedFields }
        : (Object.keys(stampedFields).length ? { fields: stampedFields } : null),
      toPanelId: toPanelOcc?.moduleId || null,
      toPanelLabel: toPanelMod?.label || "",
    });
    autoCheckBooleanFields(state, dispatch, socket, draggedInstanceId, copyResult?.occurrence?.id);

    // Trackers + onChange-bound aggregations fire while createOccurrence is
    // still inside the OccurrenceCreateOp dispatch — at that moment the new
    // occurrence's fields haven't been stamped by Schedule: Stamp Date yet
    // (UPDATE effects are applied to the live overlay during the same batch,
    // but the tracker pipeline reads $allItems from the snapshot it built at
    // dispatch time). Mirror what the MOVE branch does: after the create +
    // stamps + autoCheck have all run, sync the new occurrence into the
    // executor cache and fire one final MeasureOp per field so trackers see
    // the fully-realized state. Without this, dragging a completed task from
    // Daily Toolkit lands in Schedule but goal totals stay stale until the
    // user edits a field.
    // CommitHelpers.createOccurrence already fires OccurrenceCreateOp +
    // per-field MeasureOps for the new occurrence's stamped fields; with
    // the dateFieldId UPDATE removed from Schedule: Stamp Date the values
    // aren't corrupted any more, so the tracker recounts correctly off the
    // initial burst — no rAF re-fire needed.
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
      stampPageFilterFields({
        dispatch, socket, state, occurrencesById,
        occurrence: occurrencesById[occurrenceId],
        parentContainerOcc: toCOcc,
      });

      // Fire OccurrenceMoveOp
      const _revMap = buildReverseMap(Object.values(occurrencesById));
      const _gridOccSet = new Set(state?.grid?.occurrences || []);
      const fromPanelOcc = findGridPanelOcc(fromCOcc, _revMap, occurrencesById, _gridOccSet);
      const toPanelOcc = findGridPanelOcc(toCOcc, _revMap, occurrencesById, _gridOccSet);

      const tx = {
        type: "OccurrenceMoveOp", occurrenceId, instanceId: draggedInstanceId,
        fromContainerId: fromC.id, toContainerId: toC.id,
        fromPanelId: fromPanelOcc?.moduleId || null,
        toPanelId: toPanelOcc?.moduleId || null,
      };
      const operations = Object.values(state?.operationsById || {});
      const fieldsById = Object.fromEntries((state?.fields || []).map(f => [f.id, f]));
      const allUpdates = runMatchingOperations(operations, "OccurrenceMoveOp", tx, {
        state, fieldsById, operationsById: state?.operationsById || {}, occurrencesById: { ...occurrencesById },
      });
      if (allUpdates?.length) {
        // Split display updates from effect updates (legacy non-effect rows feed
        // computedValues; UPDATE_DISPLAY_VALUE effects are routed alongside).
        const displayUpdates = allUpdates.filter(u => !u._effect);
        const effectUpdates = allUpdates.filter(u => u._effect);
        if (displayUpdates.length) {
          dispatch({ type: "SET_COMPUTED_VALUES", updates: displayUpdates });
        }
        for (const eff of effectUpdates) {
          if (eff._effect === "UPDATE_ITEM_FIELD" && eff.subKind !== "flow") {
            setOccurrenceFieldValue({
              dispatch, socket, occurrencesById,
              occurrenceId: eff.itemId,
              fieldId: eff.fieldId,
              value: eff.value,
              flow: "replace",
            });
          } else if (eff._effect === "UPDATE_DISPLAY_VALUE") {
            dispatch({ type: "SET_COMPUTED_VALUES", updates: [{ fieldId: eff.fieldId, occurrenceId: eff.itemId || null, value: eff.value }] });
          }
        }
      }

      // Update localOccsById to reflect new container membership so the executor
      // builds the correct _parentByChildId map when MeasureOp fires
      const fromIdsAfter = (fromCOcc.occurrences || []).filter(id => id !== occurrenceId);
      const toIdsRaw = (toCOcc.occurrences || []).filter(id => id !== occurrenceId);
      const toIdsAfter = (toIndex !== null && toIndex >= 0)
        ? [...toIdsRaw.slice(0, toIndex), occurrenceId, ...toIdsRaw.slice(toIndex)]
        : [...toIdsRaw, occurrenceId];
      operationsBridge.updateLocalOcc?.({ ...fromCOcc, occurrences: fromIdsAfter });
      operationsBridge.updateLocalOcc?.({ ...toCOcc, occurrences: toIdsAfter });

      // Fire MeasureOp for each field of the moved occurrence so onChange operations retrigger
      const movedOcc = occurrencesById[occurrenceId];
      if (movedOcc?.fields) {
        for (const fieldId of Object.keys(movedOcc.fields)) {
          const fv = movedOcc.fields[fieldId];
          operationsBridge.fireOperations?.("MeasureOp", {
            type: "MeasureOp",
            occurrenceId,
            instanceId: draggedInstanceId,
            fieldId,
            value: fv && typeof fv === "object" && "value" in fv ? fv.value : fv,
          });
        }
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
export function handleFileDrop(dropContext, ctx) {
  const { dispatch, socket, state, occurrencesById, baseContainers, clearSession, getCellFromPoint } = ctx;
  const { payload, target, pointer } = dropContext;
  const { x, y } = pointer || { x: 0, y: 0 };
  const { containerId, panelId } = dropView(dropContext, ctx);

  const file = payload.data.files[0];
  const cell = getCellFromPoint(x, y);
  const fileGridId = state?.gridId || state?.grid?._id;
  const fileUserId = state?.userId;
  const fileGrid = state?.grid;

  if (!fileGridId || !fileUserId || !fileGrid) { clearSession(); return; }

  const capturedPanelOcc = panelId ? Object.values(occurrencesById).find(o => o.moduleId === panelId) : null;
  const capturedPanelView = capturedPanelOcc?.viewId ? state?.viewsById?.[capturedPanelOcc.viewId] : null;
  const isExistingArtifactPanel = capturedPanelView?.viewType === "display" || capturedPanelView?.hasTree;

  const capturedContainerOcc = containerId
    ? Object.values(occurrencesById).find(o => o.moduleId === containerId)
    : null;

  // ── Build placeholder module + occurrence with client-generated IDs ──
  const moduleId = makeUUID();
  const occurrenceId = makeUUID();
  const kind = mimeToKind(file.type, file.name);

  const placeholderModule = {
    id: moduleId,
    userId: fileUserId,
    gridId: fileGridId,
    role: "artifact",
    kind,
    label: file.name,
    fileRef: null,
    defaultDragMode: "copy",
    meta: {
      uploadStatus: "pending",
      originalName: file.name,
      mimeType: file.type,
      uploadSize: file.size,
    },
  };

  const placeholderOccurrence = {
    id: occurrenceId,
    userId: fileUserId,
    gridId: fileGridId,
    moduleId,
    fields: {},
    meta: {},
  };

  // Optimistic local dispatch — renders the spinner immediately.
  dispatch(createModuleAction(placeholderModule));
  dispatch(createOccurrenceAction(placeholderOccurrence));

  // Wire the placeholder into its destination so the spinner appears in the right spot.
  if (capturedContainerOcc) {
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: capturedContainerOcc.id, occurrences: [...(capturedContainerOcc.occurrences || []), occurrenceId] },
      emit: true,
    });
  } else if (isExistingArtifactPanel && capturedPanelView) {
    CommitHelpers.updateView({ dispatch, socket, view: { ...capturedPanelView, activeOccurrenceId: occurrenceId } });
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
      const { viewType, artifactType } = viewFieldsForKindClient(kind);
      CommitHelpers.createView({
        dispatch, socket,
        view: { id: viewId, userId: fileUserId, gridId: fileGridId, viewType, artifactType, hasTree: false, manifestId: null, activeOccurrenceId: occurrenceId },
        emit: true,
      });
      CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...panelResult.occurrence, viewId }, emit: true });
    }
  }

  // ── Background upload — server upserts using the IDs we just dispatched ──
  const formData = new FormData();
  formData.append("file", file);
  formData.append("userId", fileUserId);
  formData.append("gridId", fileGridId);
  formData.append("moduleId", moduleId);
  formData.append("occurrenceId", occurrenceId);

  fetch("/api/artifacts/upload", { method: "POST", body: formData })
    .then(r => r.json())
    .then(({ module: uploadedModule }) => {
      if (uploadedModule?.id) {
        // Local module already exists; reducer is idempotent — clears the spinner.
        CommitHelpers.updateModule({ dispatch, socket, module: uploadedModule, emit: false });
      }
    })
    .catch(err => {
      console.error("[FILE DROP] Upload error:", err);
      CommitHelpers.updateModule({
        dispatch, socket,
        module: { id: moduleId, meta: { ...placeholderModule.meta, uploadStatus: "error" } },
        emit: false,
      });
    });

  clearSession();
}

// Local mirror of server.js viewFieldsForKind (only used when creating an artifact panel).
function viewFieldsForKindClient(kind) {
  if (["image", "video", "audio", "pdf"].includes(kind)) return { viewType: "display", artifactType: kind };
  if (kind === "code") return { viewType: "code", artifactType: null };
  return { viewType: "markdown", artifactType: null };
}

// ============================================================
// EXTERNAL TEXT/URL → CONTAINER
// ============================================================
export function handleExternalDrop(dropContext, ctx) {
  const { dispatch, socket, state, occurrencesById, baseContainers, clearSession } = ctx;
  const { payload, target, position, pointer, dataTransfer } = dropContext;
  const { y } = pointer || { x: 0, y: 0 };
  const { containerId, dropTarget } = dropView(dropContext, ctx);

  let label = "Untitled";
  if (payload.payloadType === DragType.TEXT) label = (payload.data?.text || "").slice(0, 80) || "Text";
  else if (payload.payloadType === DragType.URL) label = payload.data?.url || "Link";

  const container = baseContainers.find(c => c.id === containerId);
  if (!container) { clearSession(); return; }

  const containerOcc = Object.values(occurrencesById).find(o => o.moduleId === container.id);
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
export function handleCrossWindowDrop(dropContext, ctx) {
  const { dispatch, socket, state, occurrencesById, baseContainers, clearSession } = ctx;
  const { target, position, pointer, dataTransfer } = dropContext;
  const { y } = pointer || { x: 0, y: 0 };
  const { containerId, dropTarget } = dropView(dropContext, ctx);

  const parsed = parseExternalDrop(dropTarget.dataTransfer);
  if (!parsed.isCrossWindow || parsed.type !== DragType.INSTANCE) return;

  const container = baseContainers.find(c => c.id === containerId);
  if (!container) { clearSession(); return; }

  const xwContainerOcc = Object.values(occurrencesById).find(o => o.moduleId === container.id);
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
// MODULE FROM CC/POOL/DOC/TREE → CONTAINER/PANEL/GRID
// ============================================================
export function handleModuleDrop(dropContext, ctx) {
  const { dispatch, socket, state, occurrencesById, baseAllPanels, baseContainers, getCellFromPoint } = ctx;
  const { payload, target, position, pointer, mode, modifiers, dataTransfer } = dropContext;
  const { x, y } = pointer || { x: 0, y: 0 };
  const { containerId, containerOccurrenceId, panelId, dropTarget } = dropView(dropContext, ctx);

  const role = payload?.data?.role || payload?.role;
  const gridId = state?.gridId || state?.grid?._id?.toString() || state?.grid?.id;

  // LEAF roles (instance | artifact | textblock): create persistent occurrence in target container/panel
  const isLeafRole = !role || role === "instance" || role === "artifact" || role === "textblock";

  // CANVAS PAGE drop — page itself is the parent (no container). Stamp meta.x/y from drop pointer.
  if (isLeafRole) {
    const pageOccId = dropTarget.context?.pageOccurrenceId;
    const pageOcc = pageOccId ? occurrencesById[pageOccId] : null;
    const pageMod = pageOcc ? state?.modulesById?.[pageOcc.moduleId] : null;
    if (pageOcc && pageMod?.kind === "canvas" && gridId) {
      const rect = dropTarget.context?.targetRect
        || document.querySelector(`[data-page-occ-id="${pageOccId}"] .canvas-surface`)?.getBoundingClientRect?.()
        || document.querySelector(`[data-page-occ-id="${pageOccId}"]`)?.getBoundingClientRect?.();
      const cx = rect ? Math.max(0, Math.round(x - rect.left)) : 20;
      const cy = rect ? Math.max(0, Math.round(y - rect.top)) : 20;

      const newOccId = makeUUID();
      CommitHelpers.createOccurrence({
        dispatch, socket,
        occurrence: {
          id: newOccId,
          userId: state?.userId,
          gridId,
          moduleId: payload.moduleId,
          parentId: pageOccId,
          fields: {},
          meta: { x: cx, y: cy },
        },
        emit: true,
      });
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: pageOccId, occurrences: [...(pageOcc.occurrences || []), newOccId] },
        emit: true,
      });
      return;
    }
  }

  if (isLeafRole) {
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
          .map(occId => occurrencesById[occId]).filter(occ => occ?.moduleId).map(occ => occ.moduleId);
        const candidates = baseContainers.filter(c => panelContainerIds.includes(c.id));
        targetContainer = candidates.find(c => !(c.behaviorMode === "own" && c.behavior?.droppable === false)) || candidates[0] || null;
      }
    }
    // Doc containers handle drops via Editor.jsx → moduleEmbed node insertion
    if (targetContainer?.kind === "doc") return;

    if (targetContainer && gridId) {
      // Prefer the drop context's per-occurrence id (so we hit the visible
      // slot, not the first match by targetId — same disambiguation as
      // handleOccurrenceMove).
      const targetContainerOcc = (containerOccurrenceId && occurrencesById[containerOccurrenceId])
        || Object.values(occurrencesById).find(o => o.moduleId === targetContainer.id);
      // Pre-stamp the destination's page-filter fields so the create lands
      // with the right date — same reasoning as handleOccurrenceMove copy mode.
      const stampedFields = computePageFilterFields({
        state, occurrencesById,
        parentContainerOcc: targetContainerOcc,
        existingFields: {},
      });
      LayoutHelpers.copyInstanceToContainer({
        dispatch, socket, gridId, sourceInstanceId: payload.moduleId,
        toContainer: targetContainerOcc ? { ...targetContainer, _occurrence: targetContainerOcc } : targetContainer,
        userId: state?.userId, iterationMode: "persistent", emit: true,
        sourceOccurrence: Object.keys(stampedFields).length ? { fields: stampedFields } : null,
      });
    }
  }

  // CONTAINER role → PANEL
  if (role === "container" && panelId && gridId) {
    const panel = baseAllPanels.find(p => p.id === panelId);
    const container = baseContainers.find(c => c.id === payload.moduleId);
    if (panel && container) {
      LayoutHelpers.createContainerInPanel({
        dispatch, socket, gridId, panel,
        container: { id: container.id, label: container.label, kind: container.kind },
        userId: state?.userId, index: null, emit: true,
      });
    }
  }

  // CONTAINER role → GRID CELL: drilldown
  if (role === "container" && dropTarget.type === DROP_TARGET_KIND.GRID_CELL && dropTarget.context?.row !== undefined) {
    const cell = { row: dropTarget.context.row, col: dropTarget.context.col };
    const grid = state?.grid;
    const userId = state?.userId;
    const container = baseContainers.find(c => c.id === payload.moduleId);
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

  // LEAF role → GRID CELL: drilldown (works for instance | artifact | textblock)
  if (isLeafRole && dropTarget.type === DROP_TARGET_KIND.GRID_CELL && dropTarget.context?.row !== undefined) {
    const cell = { row: dropTarget.context.row, col: dropTarget.context.col };
    const grid = state?.grid;
    const userId = state?.userId;
    const instance = (state?.modules || []).find(m => m.id === payload.moduleId);
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
    const cell = (dropTarget.type === DROP_TARGET_KIND.GRID_CELL && dropTarget.context?.row !== undefined)
      ? { row: dropTarget.context.row, col: dropTarget.context.col }
      : getCellFromPoint(x, y);
    if (cell) {
      const panelModule = baseAllPanels.find(p => p.id === payload.moduleId);
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
export function handleFieldDrop(dropContext, ctx) {
  const { dispatch, socket, state } = ctx;
  const { payload, target, position, dataTransfer } = dropContext;
  const { containerId, instanceId, dropTarget } = dropView(dropContext, ctx);

  // Allow dropping a field onto either an instance or a container — both can
  // carry fieldBindings. Prefer the instance when both ids are present (the
  // user clearly aimed at the smaller/inner element).
  const targetId = dropTarget.context?.instanceId || dropTarget.context?.containerId || instanceId || containerId;
  if (!targetId) return;
  const targetModule = (state?.instances || []).find(i => i.id === targetId)
    || (state?.containers || []).find(c => c.id === targetId)
    || (state?.modules || []).find(m => m.id === targetId);
  if (!targetModule) return;

  const fieldId = payload.moduleId;
  const existing = targetModule.fieldBindings || [];
  if (!existing.some(b => b.fieldId === fieldId)) {
    CommitHelpers.updateModule({ dispatch, socket, module: { ...targetModule, fieldBindings: [...existing, { fieldId, showLabel: true }] } });
  }
}

// ============================================================
// OPERATION FROM CC → INSTANCE
// ============================================================
export function handleOperationDrop(dropContext, ctx) {
  const { dispatch, socket, state } = ctx;
  const { payload, target, position, dataTransfer } = dropContext;
  const { instanceId, dropTarget } = dropView(dropContext, ctx);

  const targetInstanceId = dropTarget.context?.instanceId || instanceId;
  if (!targetInstanceId) return;
  const instance = state?.instances?.find(i => i.id === targetInstanceId);
  if (!instance) return;

  const operationId = payload.moduleId;
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
export function handleArtifactDrop(dropContext, ctx) {
  const { dispatch, socket, state, occurrencesById, baseContainers, clearSession, getCellFromPoint } = ctx;
  const { payload, target, position, dataTransfer } = dropContext;
  const { containerId, containerOccurrenceId, panelId, dropTarget } = dropView(dropContext, ctx);

  // Drop on container → copy instance
  if (containerId) {
    const artifactOcc = occurrencesById[payload.occurrenceId];
    const artifactModule = artifactOcc ? (state?.modules || []).find(m => m.id === artifactOcc.moduleId) : null;
    if (artifactModule) {
      const toC = baseContainers.find(c => c.id === containerId);
      const toCOcc = (containerOccurrenceId && occurrencesById[containerOccurrenceId])
        || (toC ? Object.values(occurrencesById).find(o => o.moduleId === toC.id) : null);
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
    const panelOcc = Object.values(occurrencesById).find(o => o.moduleId === panelId);
    const viewId = panelOcc?.viewId;
    const view = viewId ? state?.viewsById?.[viewId] : null;
    if (view) {
      CommitHelpers.updateView({ dispatch, socket, view: { ...view, activeOccurrenceId: payload.occurrenceId, scrollAnchor: null } });
    }
  }

  // Drop on grid cell → create artifact panel
  if (dropTarget.type === DROP_TARGET_KIND.GRID_CELL && dropTarget.context?.row !== undefined) {
    const cell = { row: dropTarget.context.row, col: dropTarget.context.col };
    const grid = state?.grid;
    const userId = state?.userId;
    if (cell && grid && userId) {
      const artifactOcc = occurrencesById[payload.occurrenceId];
      const artifactModule = artifactOcc ? (state?.modules || []).find(m => m.id === artifactOcc.moduleId) : null;
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
export function handleFolderDrop(dropContext, ctx) {
  const { dispatch, socket, state, occurrencesById, getHoveredPanelId } = ctx;
  const { payload } = dropContext;

  const hoveredPanelId = getHoveredPanelId();
  if (!hoveredPanelId) return;

  const panelOcc = Object.values(occurrencesById || {}).find(o => o.moduleId === hoveredPanelId);
  if (!panelOcc) return;

  const existingOccs = [...(panelOcc.occurrences || [])];
  for (const childOccId of payload.childOccurrenceIds) {
    const childOcc = occurrencesById[childOccId];
    if (!childOcc) continue;
    const childMod = (state?.modules || []).find(m => m.id === childOcc.moduleId);
    if (!childMod) continue;
    const pageModId = crypto.randomUUID();
    const pageOccId = crypto.randomUUID();
    CommitHelpers.createModule({ dispatch, socket, module: { id: pageModId, role: "page", kind: "doc", label: childMod.label || "Untitled" }, emit: true });
    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: { id: pageOccId, userId: state?.userId, gridId: state?.grid?._id, moduleId: pageModId, fields: {} }, emit: true });
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

  // Walk every child occurrence — textblocks and artifacts don't carry the
  // legacy `targetType === "instance"` flag, but they're still rendered via
  // ModuleInstance and tagged with `data-occurrence-id` / `data-instance-id`.
  // Prefer the occurrence-id query so we hit the exact card even when many
  // siblings share a module (schedule slots).
  let nearestIndex = 0;
  let nearestDistance = Infinity;
  const rectFor = (occ) =>
    document.querySelector(`[data-occurrence-id="${occ.id}"]`)?.getBoundingClientRect?.()
    || (occ.moduleId
      ? document.querySelector(`[data-instance-id="${occ.moduleId}"]`)?.getBoundingClientRect?.()
      : null);

  occurrenceIds.forEach((occId, index) => {
    const occ = occurrencesById[occId];
    if (!occ) return;
    const rect = rectFor(occ);
    if (!rect) return;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.abs(y - centerY);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  const nearestOcc = occurrencesById[occurrenceIds[nearestIndex]];
  if (nearestOcc) {
    const rect = rectFor(nearestOcc);
    if (rect) {
      const centerY = rect.top + rect.height / 2;
      return y < centerY ? nearestIndex : nearestIndex + 1;
    }
  }
  return null;
}

// ============================================================
// dropView — projection of DropContext + ctx into resolved locals
// ============================================================
// Pure projection. Returns role-aware locals each handler needs so the
// per-handler preamble stays a single destructure.
//
// Returns:
//   targetOcc / parentOcc / targetRole / parentRole / targetModuleId / parentModuleId
//   containerId / panelId / instanceId / containerOccurrenceId
//   dropTarget — synthetic { type, context, dataTransfer } so handler
//                bodies that read top-level `dropTarget.X` keep working
//                without each one re-synthesizing the projection.
const _INSTANCE_ROLES = new Set(["instance", "page", "artifact", "textblock"]);
const _PANEL_ROLES = new Set(["panel", "page"]);

function dropView(dropContext, ctx) {
  const { target, position, dataTransfer } = dropContext;
  const occs = ctx.occurrencesById || {};
  const modules = ctx.state?.modulesById || {};

  const targetOcc = target.occurrenceId ? occs[target.occurrenceId] : null;
  const parentOcc = target.parentOccurrenceId ? occs[target.parentOccurrenceId] : null;

  const targetModuleId = target.moduleId || null;
  const parentModuleId = parentOcc?.moduleId || null;
  const targetRole = targetModuleId ? (modules[targetModuleId]?.role || null) : null;
  const parentRole = parentModuleId ? (modules[parentModuleId]?.role || null) : null;

  const containerId = targetRole === "container" ? targetModuleId
    : parentRole === "container" ? parentModuleId : null;
  const containerOccurrenceId = targetRole === "container" ? target.occurrenceId
    : parentRole === "container" ? parentOcc?.id || null : null;
  const instanceId = _INSTANCE_ROLES.has(targetRole) ? targetModuleId : null;
  const panelId = _PANEL_ROLES.has(targetRole) ? targetModuleId
    : _PANEL_ROLES.has(parentRole) ? parentModuleId : null;

  const dropTarget = {
    type: target.kind,
    context: {
      ...(target.raw || {}),
      closestEdge: position.edge,
      insertAt: position.insertIndex,
    },
    dataTransfer,
  };

  return {
    targetOcc, parentOcc, targetRole, parentRole, targetModuleId, parentModuleId,
    containerId, containerOccurrenceId, instanceId, panelId,
    dropTarget,
  };
}

// ============================================================
// routeDrop — entry point for the unified drag pipeline
// ============================================================
// Dispatches a fully-built DropContext to the appropriate per-type
// handler. All handlers take (dropContext, ctx).
export function routeDrop(dropContext, ctx) {
  if (!dropContext) { ctx.clearSession?.(); return; }
  const { payload } = dropContext;
  const sourceModule = payload.moduleId ? ctx.state?.modulesById?.[payload.moduleId] : null;
  const sourceRole = sourceModule?.role || null;

  // Source-kind first — these are unambiguous and don't depend on role.
  if (payload.sourceKind === "file") return handleFileDrop(dropContext, ctx);
  if (payload.sourceKind === "external" || payload.sourceKind === "text" || payload.sourceKind === "url") {
    return handleExternalDrop(dropContext, ctx);
  }
  if (payload.sourceKind === "field") return handleFieldDrop(dropContext, ctx);
  if (payload.sourceKind === "operation") return handleOperationDrop(dropContext, ctx);
  if (payload.sourceKind === "doc-embed") return handleDocEmbedDrop(dropContext, ctx);

  if (payload.sourceKind === "command-center" || payload.sourceKind === "pool"
      || payload.sourceKind === "doc" || payload.sourceKind === "canvas"
      || payload.sourceKind === "tree-anchor" || payload.sourceKind === "tree-page") {
    return handleModuleDrop(dropContext, ctx);
  }

  if (payload.payloadType === "artifact") return handleArtifactDrop(dropContext, ctx);
  if (payload.payloadType === "folder") return handleFolderDrop(dropContext, ctx);

  // In-grid drag: dispatch by source role. Pages live as direct children
  // of panels (panel.occurrences[] holds page occurrence ids) — same shape
  // as containers — so they go through handleContainerDrop, not the
  // leaf-level handleOccurrenceMove.
  if (sourceRole === "panel") return handlePanelDrop(dropContext, ctx);
  if (sourceRole === "container" || sourceRole === "page") return handleContainerDrop(dropContext, ctx);
  if (sourceRole === "instance" || sourceRole === "artifact" || sourceRole === "textblock") {
    return handleOccurrenceMove(dropContext, ctx);
  }

  ctx.clearSession?.();
}
