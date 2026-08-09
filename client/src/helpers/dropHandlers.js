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
import { makeOpNotificationCallbacks } from "./opResultSummary";
import { pushTxNotification } from "../state/notificationStore";
import { operationsBridge } from "../state/bindSocketToStore";
import { embedDeleteRegistry } from "./embedRegistry";
import { buildReverseMap, findGridPanelOcc } from "./occurrenceHelpers";
import { classifyIntake, isUrlish } from "./intake";
import { applyIntakeShape, filterToImplemented } from "./intakeApply";
import { openIntakeSheet } from "../ui/IntakeSheet";
import { snapPanelToEdge } from "./gridSnap";
import { placementSemanticForKind } from "./mainFile";
import { isOptionBoard } from "./boardOption";
import { filesFieldIdFor } from "./occurrenceMedia";
import { linkTargetFieldsFor } from "./intakeFields";
import { toast } from "../state/notificationStore";
import { jumpToOccurrence } from "./jumpToOccurrence";
import { createImportsDocPage } from "./importsFolder";
import { DROP_TARGET_KIND } from "./dragHitTesting";
import { autoAppendFieldsToAncestorsShowMode } from "./fieldVisibilityAutoAppend";
import { resolveDropInViewMode, isMoveBlockedByCascadeLock } from "./layoutCascade";
// Both live in a leaf module now so the TYPED-create paths (which run through
// CommitHelpers, and so cannot import this file) can stamp the same values.
// Re-exported here because this was their home and callers/tests import them
// from here.
import { computePageFilterFields, normalizeFilterDateValue } from "./filterFieldStamp";
export { computePageFilterFields, normalizeFilterDateValue };

// Walks the DOM from the drop point outward looking for the nearest ancestor
// occurrence that owns its own `filterOverride` (the schedule day-cols are the
// canonical case — each day-col carries `filterOverride: { dateFieldId: "<one
// specific day>" }` while the page above carries the multi-day filter shape).
// Returns the day-col occurrence to use as the parent for date-stamp
// resolution. Falls back to null when:
//   - pointer coords aren't available (programmatic drops)
//   - no ancestor with a filter override sits between the drop point and the
//     destination container (the normal single-day case — caller falls back
//     to the destination container itself)
// This is what unblocks MD1: drag a task between day-cols of a multi-day
// Schedule and the new placement re-stamps to the destination day's date.
// Without it, both day-cols' slots resolve their effective filter through
// the slot's `parentId` (= page) → the page's multi-day filter → no single
// date to stamp → the task keeps its source-day's date.
export function findFilterOverrideAncestor({ pointer, occurrencesById, excludeOccId }) {
  if (!pointer || typeof document === "undefined") return null;
  const x = pointer.x ?? pointer.clientX;
  const y = pointer.y ?? pointer.clientY;
  if (typeof x !== "number" || typeof y !== "number") return null;
  let els;
  try { els = document.elementsFromPoint(x, y) || []; } catch { return null; }
  for (const el of els) {
    const occId = el?.dataset?.occurrenceId || el?.getAttribute?.("data-occ-id");
    if (!occId || occId === excludeOccId) continue;
    const occ = occurrencesById?.[occId];
    if (!occ) continue;
    const override = occ.filterOverride;
    if (!override || typeof override !== "object") continue;
    // Must touch at least one field key (empty override `{}` = "clear cascade",
    // not "set a specific date").
    if (Object.keys(override).length === 0) continue;
    return occ;
  }
  return null;
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

// Thin wrapper that resolves the new occurrence + destination parent by id and
// fires the auto-append helper. Defined once here so every drop branch can call
// it with whatever ids it has — the helper itself short-circuits when there's
// nothing to do (no fieldIds to add, no ancestor in show mode). Resilient to
// stale `occurrencesById` references: the dispatched/optimistic copy of the
// new occurrence may not have landed back into the passed `occurrencesById`
// map yet, so callers can pass `newOccurrence` directly (object) as a
// fallback.
function autoAppendOnDrop({ ctx, newOccurrenceId, newOccurrence, parentOccurrenceId }) {
  if (!ctx) return;
  const { dispatch, socket, state, occurrencesById } = ctx;
  const occ = newOccurrence || (newOccurrenceId ? occurrencesById?.[newOccurrenceId] : null);
  if (!occ) return;
  const parent = parentOccurrenceId ? occurrencesById?.[parentOccurrenceId] : null;
  if (!parent) return;
  autoAppendFieldsToAncestorsShowMode({
    newOccurrence: occ,
    destinationOccurrence: parent,
    ctx: { dispatch, socket, occurrencesById, modulesById: state?.modulesById },
  });
  // Layout cascade — stamp the new child's viewMode from the destination's
  // dragInView when it's non-default. Idempotent (skips when already set
  // to that mode or when destination wants the default "actual").
  stampDropViewMode({ ctx, newOccurrence: occ, destinationOccurrence: parent });
}

function stampDropViewMode({ ctx, newOccurrence, destinationOccurrence }) {
  if (!newOccurrence?.id || !destinationOccurrence) return;
  const { dispatch, socket, state, occurrencesById } = ctx;
  const wantMode = resolveDropInViewMode({
    destinationOccurrence,
    occurrencesById,
    modulesById: state?.modulesById,
    grid: state?.grid,
  });
  if (!wantMode) return;
  const stored = newOccurrence?.meta?.viewMode;
  if (stored === wantMode) return; // idempotent
  CommitHelpers.updateOccurrence({
    dispatch, socket,
    occurrence: {
      id: newOccurrence.id,
      meta: { ...(newOccurrence.meta || {}), viewMode: wantMode },
    },
    emit: true,
  });
}

// ============================================================
// PANEL → GRID CELL
// ============================================================
export function handlePanelDrop(dropContext, ctx) {
  const { dispatch, socket, state, occurrencesById, baseAllPanels, getCellFromPoint } = ctx;
  // In a mosaic grid there are no (row,col) cells — panel rearrange is handled
  // by GridMosaic's own per-pane drop targets (drop-to-split). Skip the
  // cell-based placement so the two don't fight over the same drop.
  if (state?.grid?.meta?.layoutTree) return;
  const { payload, target, position, pointer, mode, modifiers, dataTransfer } = dropContext;
  const { x, y } = pointer || { x: 0, y: 0 };
  const { dropTarget } = dropView(dropContext, ctx);

  let isCrossWindow = false;
  if (dropTarget.dataTransfer) {
    const parsed = parseExternalDrop(dropTarget.dataTransfer);
    isCrossWindow = parsed.isCrossWindow;
  }

  // Tablet-landscape snap: dropping a panel on the grid's outer edge band
  // grows the grid by one track there and moves the panel into the new track
  // (getSnapEdge is non-null only for touch drags in the desktop layout —
  // the drag counterpart of the desktop Ctrl+Alt+Arrow snap).
  if (!isCrossWindow) {
    const snapEdge = ctx.getSnapEdge?.(x, y);
    if (snapEdge) {
      const panel = baseAllPanels.find(p => p.id === payload.moduleId);
      const panelOcc = panel?._occurrenceId ? occurrencesById[panel._occurrenceId] : null;
      if (panelOcc) {
        snapPanelToEdge({ edge: snapEdge, panelOcc, grid: state?.grid, occurrencesById, dispatch, socket });
        return;
      }
    }
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

    const surfaceEl = document.querySelector(`[data-page-occ-id="${toPageOccId}"] .canvas-surface`);
    const rect = dropTarget.context?.targetRect
      || surfaceEl?.getBoundingClientRect?.()
      || document.querySelector(`[data-page-occ-id="${toPageOccId}"]`)?.getBoundingClientRect?.();
    // Surface is the viewport over a much larger world — add scroll offset so
    // dropped cards land at the cursor's WORLD coords, not viewport coords.
    const scrollX = surfaceEl?.scrollLeft ?? 0;
    const scrollY = surfaceEl?.scrollTop ?? 0;
    const cx = rect ? Math.max(0, Math.round(x - rect.left + scrollX)) : 20;
    const cy = rect ? Math.max(0, Math.round(y - rect.top + scrollY)) : 20;

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

      // Layout-cascade lock rule: reject cross-page container moves out
      // of a locked surface. Same-order-occurrence reorders and copies
      // are exempt (copies leave the source in place; reorders stay
      // inside the locked surface).
      if (!isCopyMode && !sameOrderOcc) {
        const sourceOcc = occurrenceId ? occurrencesById[occurrenceId] : null;
        if (sourceOcc) {
          const lockCheck = isMoveBlockedByCascadeLock({
            sourceOccurrence: sourceOcc,
            destinationOccurrence: toOrderOcc || null,
            occurrencesById,
            modulesById: state?.modulesById || {},
            grid: state?.grid || null,
          });
          if (lockCheck.blocked) {
            try { toast?.("This surface is locked — children can't be moved out."); } catch {}
            clearSession();
            return;
          }
        }
      }

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
  // Only honour an explicit numeric insertAt. It is `null` (not undefined) for a
  // plain container drop with no precomputed index — `!== undefined` wrongly
  // returned that null → the caller appended (item landed LAST instead of at the
  // pointer). `!= null` lets a real index 0 through but falls through to the
  // nearest-by-Y resolution below when there's no explicit index.
  if (dropTarget.context?.insertAt != null) return dropTarget.context.insertAt;
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
  const movedLabel = movedOcc.label || state?.modulesById?.[movedOcc.moduleId]?.label || "item";
  const dropVerb = isCopy ? "Copied" : "Moved";

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
    const surfaceEl = document.querySelector(`[data-page-occ-id="${toPageOccId}"] .canvas-surface`);
    const rect = dropTarget.context?.targetRect
      || surfaceEl?.getBoundingClientRect?.()
      || document.querySelector(`[data-page-occ-id="${toPageOccId}"]`)?.getBoundingClientRect?.();
    const scrollX = surfaceEl?.scrollLeft ?? 0;
    const scrollY = surfaceEl?.scrollTop ?? 0;
    const cx = rect ? Math.max(0, Math.round(x - rect.left + scrollX)) : 20;
    const cy = rect ? Math.max(0, Math.round(y - rect.top + scrollY)) : 20;

    if (isCopy) {
      const newOccId = cloneOccurrence({ parentId: toPageOccId, meta: { ...(movedOcc.meta || {}), x: cx, y: cy } });
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: toPageOccId, occurrences: [...(toPageOcc.occurrences || []), newOccId] },
        emit: true,
      });
      autoAppendOnDrop({ ctx, newOccurrence: { ...movedOcc, id: newOccId, parentId: toPageOccId }, parentOccurrenceId: toPageOccId });
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
      autoAppendOnDrop({ ctx, newOccurrence: movedOcc, parentOccurrenceId: toPageOccId });
    }
    toast.success(`${dropVerb} "${movedLabel}" → ${toPageOcc.label || toPageMod?.label || "canvas"}`);
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
      const newPanel = { id: makeUUID(), label, role: "panel", kind: "board" };
      const { occurrence: panelOcc } = LayoutHelpers.createPanelInGrid({
        dispatch, socket, grid, panel: newPanel,
        placement: { row: cell.row, col: cell.col, width: 1, height: 1 }, userId, emit: true,
      });
      const newContainer = { id: makeUUID(), label, role: "container", kind: "board" };
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
    autoAppendOnDrop({ ctx, newOccurrence: { ...movedOcc, id: newOccId, parentId: toCOcc.id }, parentOccurrenceId: toCOcc.id });
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
    autoAppendOnDrop({ ctx, newOccurrence: movedOcc, parentOccurrenceId: toCOcc.id });
  }
  toast.success(`${dropVerb} "${movedLabel}" → ${toCOcc.label || toC.label || "container"}`);
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

  // Layout-cascade lock rule (Slice 4): handleOccurrenceMove covers canvas
  // page moves and grid-cell drilldown drops. Copy mode leaves the original
  // in place so it's exempt. We can't always determine the destination
  // occurrence at this point (canvas/grid-cell paths derive it later) — pass
  // whatever's resolvable. The lock helper treats a null destination as
  // "leaving the locked surface" → blocked when locked.
  if (mode !== "copy" && mode !== "copylink") {
    const moveSourceOccId = payload?.occurrenceId || payload?.context?.occurrenceId || null;
    const sourceOcc = moveSourceOccId ? occurrencesById[moveSourceOccId] : null;
    if (sourceOcc) {
      const moveDestOccId = dropTarget.context?.pageOccurrenceId || containerOccurrenceId || null;
      const destOcc = moveDestOccId ? occurrencesById[moveDestOccId] : null;
      const lockCheck = isMoveBlockedByCascadeLock({
        sourceOccurrence: sourceOcc,
        destinationOccurrence: destOcc,
        occurrencesById,
        modulesById: state?.modulesById || {},
        grid: state?.grid || null,
      });
      if (lockCheck.blocked) {
        try { toast?.("This surface is locked — children can't be moved out."); } catch {}
        clearSession?.();
        return;
      }
    }
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
      const newPanel = { id: makeUUID(), label: sourceModule.label || "Panel", role: "panel", kind: "board" };
      const { occurrence: panelOcc } = LayoutHelpers.createPanelInGrid({
        dispatch, socket, grid, panel: newPanel,
        placement: { row: cell.row, col: cell.col, width: 1, height: 1 }, userId, emit: true,
      });
      const newContainer = { id: makeUUID(), label: sourceModule.label || "Container", role: "container", kind: "board" };
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

  // ONE trigger per user action. A move fires OccurrenceMoveOp only,
  // carrying the moved occurrence's fields so field-scoped onMove
  // subscribers (subjectType:"field" → transaction.fields[targetId]) match.
  // onChange is reserved for actual value edits on an existing occurrence.
  const fireMoveTrigger = ({ occurrenceId, instanceId, fromContainerId, toContainerId, fromPanelId, toPanelId }) => {
    const fmAncestors = operationsBridge.getAncestorChain?.(occurrenceId) || { ids: [], labels: [] };
    const movedOcc = occurrencesById[occurrenceId];
    operationsBridge.fireOperations?.("OccurrenceMoveOp", {
      type: "OccurrenceMoveOp",
      occurrenceId,
      instanceId,
      fromContainerId,
      toContainerId,
      fromPanelId,
      toPanelId,
      fields: movedOcc?.fields || {},
      _ancestorIds: fmAncestors.ids,
      _ancestorLabels: fmAncestors.labels,
    });
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

    const surfaceEl = document.querySelector(`[data-page-occ-id="${toPageOccId}"] .canvas-surface`);
    const rect = dropTarget.context?.targetRect
      || surfaceEl?.getBoundingClientRect?.()
      || document.querySelector(`[data-page-occ-id="${toPageOccId}"]`)?.getBoundingClientRect?.();
    const scrollX = surfaceEl?.scrollLeft ?? 0;
    const scrollY = surfaceEl?.scrollTop ?? 0;
    const cx = rect ? Math.max(0, Math.round(x - rect.left + scrollX)) : 20;
    const cy = rect ? Math.max(0, Math.round(y - rect.top + scrollY)) : 20;

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
      const newCopyOcc = {
        id: newOccId,
        userId: state?.userId,
        gridId: state?.gridId || state?.grid?._id,
        moduleId: movedOcc.moduleId,
        parentId: toPageOccId,
        fields: { ...(movedOcc.fields || {}) },
        meta: { ...(movedOcc.meta || {}), x: cx, y: cy },
      };
      CommitHelpers.createOccurrence({
        dispatch, socket,
        occurrence: newCopyOcc,
        emit: true,
      });
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: toPageOccId, occurrences: [...(toPageOcc.occurrences || []), newOccId] },
        emit: true,
      });
      autoAppendOnDrop({ ctx, newOccurrence: newCopyOcc, parentOccurrenceId: toPageOccId });
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
      autoAppendOnDrop({ ctx, newOccurrence: { ...movedOcc, parentId: toPageOccId, meta: newMeta }, parentOccurrenceId: toPageOccId });
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
      const canvasCopyResult = LayoutHelpers.copyInstanceToContainer({
        dispatch, socket,
        gridId: state?.gridId || state?.grid?._id,
        sourceInstanceId: payload.moduleId,
        toContainer: { ...toCInner, _occurrence: toCInnerOcc },
        userId: state?.userId, emit: true,
        sourceOccurrence: movedOcc,
      });
      if (canvasCopyResult?.occurrence) {
        autoAppendOnDrop({ ctx, newOccurrence: canvasCopyResult.occurrence, parentOccurrenceId: toCInnerOcc.id });
      }
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
      autoAppendOnDrop({ ctx, newOccurrence: { ...movedOcc, parentId: toCInnerOcc.id, meta: metaWithoutPos }, parentOccurrenceId: toCInnerOcc.id });
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
  if (dropTarget.context?.insertAt !== undefined && dropTarget.context?.insertAt !== null) {
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
        if (fromIndex !== -1 && fromIndex < hoveredIndex) {
          toIndex = Math.max(0, toIndex - 1);
        }
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

  // Layout-cascade lock rule (Slice 4): if the source's effective cascade
  // marks an ancestor as `locked`, the source can't be MOVED out of that
  // surface. Copy / copylink leave the original in place, so they're
  // exempt. Same-container moves are reorders inside the locked surface
  // and are always allowed.
  if (!isCopyMode && !isCopylinkMode && !sameContainer) {
    const sourceOcc = occurrenceId ? occurrencesById[occurrenceId] : null;
    if (sourceOcc) {
      const lockCheck = isMoveBlockedByCascadeLock({
        sourceOccurrence: sourceOcc,
        destinationOccurrence: toCOcc || null,
        occurrencesById,
        modulesById: state?.modulesById || {},
        grid: state?.grid || null,
      });
      if (lockCheck.blocked) {
        try { toast?.("This surface is locked — children can't be moved out."); } catch {}
        clearSession();
        return;
      }
    }
  }

  // Drag-action notifications (reorder / move / copy / copy-link). All the
  // context — item, containers, landing index — is on the client at drop
  // time; the server records no OccurrenceListOp for occurrences[] changes,
  // so the pill is surfaced here directly.
  const _nmods = state?.modulesById || {};
  const _occName = (occId) => {
    const o = occurrencesById[occId];
    return (o && (o.label || _nmods[o.moduleId]?.label)) || "item";
  };
  const _contName = (cMod, cOcc) => cOcc?.label || _nmods[cMod?.id]?.label || cMod?.label || "container";
  // 1-based landing position. toIndex null = appended → end of the dest list.
  const _destPos = (cOcc) => (toIndex == null ? (cOcc?.occurrences?.length ?? 0) : toIndex) + 1;
  // Destination with its page context: "Schedule › 1:00am" instead of a bare
  // "1:00am". Walks the occurrences[] reverse map to the nearest page-role
  // ancestor — purely structural, whatever the page is named.
  const _destName = (cMod, cOcc) => {
    const base = _contName(cMod, cOcc);
    if (!cOcc) return base;
    const rev = buildReverseMap(Object.values(occurrencesById));
    let cur = cOcc, page = null;
    for (let i = 0; i < 20 && cur; i++) {
      const parent = rev[cur.id] ? occurrencesById[rev[cur.id]] : null;
      if (!parent) break;
      const pm = _nmods[parent.moduleId];
      if (pm?.role === "page") { page = parent.label || pm.label; break; }
      cur = parent;
    }
    return page && page !== base ? `${page} › ${base}` : base;
  };

  if ((isCopylinkMode || isCopyMode) && sameContainer) {
    if (fromCOcc) {
      // Index by OCCURRENCE id (not module id) — a list can hold multiple
      // occurrences of the same module, so a module-id match returns the wrong
      // (first) one and the reorder no-ops.
      const fromIndex = (fromCOcc.occurrences || []).indexOf(occurrenceId);
      if (fromIndex !== -1) {
        if (toIndex === null) { clearSession(); return; }
        if (fromIndex !== toIndex) {
          LayoutHelpers.reorderInstancesInContainer({ dispatch, socket, containerOccurrence: fromCOcc, fromIndex, toIndex, emit: true });
          toast.success(`Reordered "${_occName(occurrenceId)}" in ${_contName(fromC, fromCOcc)}: #${fromIndex + 1} → #${toIndex + 1}`);
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
    toast.success(`Linked "${_occName(occurrenceId)}" → ${_destName(toC, toCOcc)} (#${_destPos(toCOcc)})`);
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
    // MD1 — re-stamp under the destination day-col when one is present.
    const copyFilterAncestorOcc = toCOcc
      ? findFilterOverrideAncestor({ pointer, occurrencesById, excludeOccId: toCOcc.id })
      : null;
    const stampedFields = computePageFilterFields({
      state, occurrencesById,
      parentContainerOcc: copyFilterAncestorOcc || toCOcc,
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
    if (copyResult?.occurrence && toCOcc) {
      autoAppendOnDrop({ ctx, newOccurrence: copyResult.occurrence, parentOccurrenceId: toCOcc.id });
    }
    toast.success(`Copied "${_occName(occurrenceId)}" → ${_destName(toC, toCOcc)} (#${_destPos(toCOcc)})`);

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
      // Index by OCCURRENCE id (not module id) — see note above.
      const fromIndex = (fromCOcc.occurrences || []).indexOf(occurrenceId);
      if (fromIndex !== -1) {
        if (toIndex === null) { clearSession(); return; }
        if (fromIndex !== toIndex) {
          LayoutHelpers.reorderInstancesInContainer({ dispatch, socket, containerOccurrence: fromCOcc, fromIndex, toIndex, emit: true });
          toast.success(`Reordered "${_occName(occurrenceId)}" in ${_contName(fromC, fromCOcc)}: #${fromIndex + 1} → #${toIndex + 1}`);
        }
      }
    }
  } else {
    if (fromCOcc && toCOcc) {
      LayoutHelpers.moveInstanceBetweenContainers({
        dispatch, socket, fromContainerOccurrence: fromCOcc, toContainerOccurrence: toCOcc,
        occurrenceId, toIndex, emit: true,
      });
      // MD1 — when the drop landed under a day-col (or any ancestor with
      // its own filterOverride), use IT as the parent for date stamping
      // so a multi-day Schedule drag re-stamps to the destination day.
      const filterAncestorOcc = findFilterOverrideAncestor({
        pointer, occurrencesById, excludeOccId: toCOcc.id,
      });
      stampPageFilterFields({
        dispatch, socket, state, occurrencesById,
        occurrence: occurrencesById[occurrenceId],
        parentContainerOcc: filterAncestorOcc || toCOcc,
      });
      autoAppendOnDrop({ ctx, newOccurrenceId: occurrenceId, parentOccurrenceId: toCOcc.id });
      toast.success(`Moved "${_occName(occurrenceId)}": ${_contName(fromC, fromCOcc)} → ${_destName(toC, toCOcc)} (#${_destPos(toCOcc)})`);

      // Fire OccurrenceMoveOp
      const _revMap = buildReverseMap(Object.values(occurrencesById));
      const _gridOccSet = new Set(state?.grid?.occurrences || []);
      const fromPanelOcc = findGridPanelOcc(fromCOcc, _revMap, occurrencesById, _gridOccSet);
      const toPanelOcc = findGridPanelOcc(toCOcc, _revMap, occurrencesById, _gridOccSet);

      const movedOccForTx = occurrencesById[occurrenceId];
      const tx = {
        type: "OccurrenceMoveOp", occurrenceId, instanceId: draggedInstanceId,
        fromContainerId: fromC.id, toContainerId: toC.id,
        fromPanelId: fromPanelOcc?.moduleId || null,
        toPanelId: toPanelOcc?.moduleId || null,
        fields: movedOccForTx?.fields || {},
      };
      const operations = Object.values(state?.operationsById || {});
      const fieldsById = Object.fromEntries((state?.fields || []).map(f => [f.id, f]));
      const allUpdates = runMatchingOperations(operations, "OccurrenceMoveOp", tx, {
        state, fieldsById, operationsById: state?.operationsById || {}, occurrencesById: { ...occurrencesById },
      }, makeOpNotificationCallbacks(pushTxNotification, () => ({ fieldsById, occurrencesById, modulesById: state?.modulesById || {} })));
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

      // ONE trigger per user action — the OccurrenceMoveOp above already
      // carried `fields`, so field-scoped onMove triggers matched in
      // runMatchingOperations. No piggyback MeasureOp.
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
  const { containerId, containerOccurrenceId, panelId, dropTarget } = dropView(dropContext, ctx);

  const files = Array.from(payload?.data?.files || []);
  if (files.length === 0) { clearSession(); return; }

  const cell = getCellFromPoint(x, y);
  const fileGridId = state?.gridId || state?.grid?._id;
  const fileUserId = state?.userId;
  const fileGrid = state?.grid;

  if (!fileGridId || !fileUserId || !fileGrid) { clearSession(); return; }

  // A mosaic grid (BSP layoutTree) has NO empty cells — every pane is a panel in
  // the tree. Minting a new panel there makes GridMosaic split an existing pane
  // (it corrupted the full-height Viafluere hub into a sliver, 2026-07-15), so the
  // empty-cell drill-down + standalone-panel fallbacks are gated off for mosaic.
  const isMosaic = !!fileGrid?.meta?.layoutTree;

  // ── Resolve the drop DESTINATION so an uploaded file becomes an INSTANCE of
  //    the file right where you drop it — the SAME behavior on every page type,
  //    never a standalone "side view" panel. Priority:
  //      1. the container under the pointer (list / board / table column)
  //      2. a board/table page → its first droppable container (page-gap drop)
  //      3. a canvas page → a free-positioned artifact child at the drop point
  //      4. an existing display/artifact tree panel → swap its active view
  //      5. an empty grid cell → drill down: new board panel + container + art
  //  (Doc pages / doc containers / table CELLS never reach here — the doc
  //   editor's own onDrop owns those and inserts a moduleEmbed; see Editor.jsx.)
  const pageOccId = dropTarget?.context?.pageOccurrenceId || null;
  const pageOcc = pageOccId ? occurrencesById[pageOccId] : null;
  const pageMod = pageOcc ? state?.modulesById?.[pageOcc.moduleId] : null;
  const isCanvasPage = pageMod?.kind === "canvas";

  const capturedPanelOcc = panelId ? Object.values(occurrencesById).find(o => o.moduleId === panelId) : null;
  const capturedPanelView = capturedPanelOcc?.viewId ? state?.viewsById?.[capturedPanelOcc.viewId] : null;
  const isExistingArtifactPanel = capturedPanelView?.viewType === "display" || capturedPanelView?.hasTree;

  // (1) The precise container occurrence under the pointer (dropView resolves
  // the exact occ; fall back to first-by-module for a bare containerId). Doc
  // containers own their embed insertion via the editor — never wire here.
  let destContainerOcc =
    (containerOccurrenceId && occurrencesById[containerOccurrenceId]) ||
    (containerId ? Object.values(occurrencesById).find(o => o.moduleId === containerId) : null);
  if (destContainerOcc && state?.modulesById?.[destContainerOcc.moduleId]?.kind === "doc") {
    destContainerOcc = null;
  }
  // (2) Page-gap fallback: inside a (non-canvas) page but not over a column →
  // the page's first droppable non-doc container.
  if (!destContainerOcc && pageOcc && !isCanvasPage) {
    for (const occId of pageOcc.occurrences || []) {
      const occ = occurrencesById[occId];
      const mod = occ ? state?.modulesById?.[occ.moduleId] : null;
      if (mod?.role === "container" && mod?.kind !== "doc") { destContainerOcc = occ; break; }
    }
  }

  // (3) Canvas drop point in world coords (mirror handleModuleDrop's canvas
  // branch) — each artifact lands as a free-positioned child.
  let canvasPos = null;
  if (!destContainerOcc && isCanvasPage && pageOccId) {
    const surfaceEl = document.querySelector(`[data-page-occ-id="${pageOccId}"] .canvas-surface`);
    const rect = surfaceEl?.getBoundingClientRect?.()
      || document.querySelector(`[data-page-occ-id="${pageOccId}"]`)?.getBoundingClientRect?.();
    canvasPos = {
      x: rect ? Math.max(0, Math.round(x - rect.left + (surfaceEl?.scrollLeft ?? 0))) : 20,
      y: rect ? Math.max(0, Math.round(y - rect.top + (surfaceEl?.scrollTop ?? 0))) : 20,
    };
  }

  // (5) Empty grid cell → drill down like a normal instance: mint a board
  // panel + container here, then drop the artifacts into that container (NOT a
  // display-viewer "side view" panel — that was the reported bug).
  let drillContainerOcc = null;
  if (!destContainerOcc && !canvasPos && !isExistingArtifactPanel && cell && !isMosaic) {
    const newPanel = { id: makeUUID(), label: files[0]?.name || "Files", role: "panel", kind: "board" };
    const panelResult = LayoutHelpers.createPanelInGrid({
      dispatch, socket, grid: fileGrid, panel: newPanel,
      placement: { row: cell.row, col: cell.col, width: 1, height: 1 }, userId: fileUserId, emit: true,
    });
    if (panelResult?.occurrence) {
      const newContainer = { id: makeUUID(), label: newPanel.label, role: "container", kind: "board" };
      const cRes = LayoutHelpers.createContainerInPanel({
        dispatch, socket, gridId: fileGridId, panel: { ...newPanel, _occurrence: panelResult.occurrence },
        container: newContainer, userId: fileUserId, emit: true,
      });
      drillContainerOcc = cRes?.occurrence || null;
    }
  }

  const finalContainerOcc = destContainerOcc || drillContainerOcc;

  // No valid home (e.g. a drop on a mosaic-grid gap / panel chrome, nothing under
  // the pointer) — bail WITHOUT minting placeholders so we never leave orphan
  // artifact occurrences (or a stray panel). The user re-drops onto a real target.
  if (!finalContainerOcc && !canvasPos && !(isExistingArtifactPanel && capturedPanelView)) {
    clearSession();
    return;
  }

  // Placement stamp folded onto each placeholder occurrence up-front so the
  // optimistic render lands in the right spot (container child, or canvas x/y).
  const occExtra = (i) => finalContainerOcc
    ? { parentId: finalContainerOcc.id }
    : canvasPos
      ? { parentId: pageOccId, meta: { x: canvasPos.x + i * 24, y: canvasPos.y + i * 24 } }
      : {};

  // Wiring the new ids into the destination is THIS handler's business — which
  // container's occurrences[], a canvas page, or an artifact panel's active
  // view. The router calls it between minting and uploading.
  const onPlaceholders = (placeholders) => {
    const allOccIds = placeholders.map(p => p.occurrenceId);
    if (finalContainerOcc) {
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: finalContainerOcc.id, occurrences: [...(finalContainerOcc.occurrences || []), ...allOccIds] },
        emit: true,
      });
    } else if (canvasPos && pageOcc) {
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: pageOcc.id, occurrences: [...(pageOcc.occurrences || []), ...allOccIds] },
        emit: true,
      });
    } else if (isExistingArtifactPanel && capturedPanelView) {
      // A file dropped ON an artifact/tree panel just swaps its active view to
      // the (last) upload — no new panel.
      const lastOccId = allOccIds[allOccIds.length - 1];
      CommitHelpers.updateView({ dispatch, socket, view: { ...capturedPanelView, activeOccurrenceId: lastOccId } });
    }
  };

  const intakeCtx = {
    files, gridId: fileGridId, userId: fileUserId, dispatch, socket,
    occExtra, onPlaceholders,
    // The destination whose filter values the new artifact must carry (Step 3).
    // A canvas drop has no container, so the PAGE is the destination there —
    // it is the occurrence the filter cascade resolves through either way.
    destinationOccurrence: finalContainerOcc || (canvasPos ? pageOcc : null) || null,
    containerOccurrenceId: finalContainerOcc?.id || null,
    // IMAGE_ATTACH needs to know WHICH field to append to; the classifier used
    // the same resolution to decide whether to offer the shape at all.
    destination: {
      filesFieldId: filesFieldIdFor(
        finalContainerOcc ? state?.modulesById?.[finalContainerOcc.moduleId] : null,
      ),
    },
    // FILES_FOLDER_PAGE mints a folder under Imports and a page for it, so it
    // needs the folder tree. Passed as the four values the folder helpers take
    // rather than the whole store — the router gets resolved values, never
    // `state`. The route fails closed and SAYS SO if these are absent, which is
    // what stops a caller silently getting a half-shape.
    grid: state?.grid || null,
    manifests: state?.manifests || null,
    folders: state?.folders || null,
    occurrencesById,
    // NOTE the absent `parentId`. An uploaded artifact's parentId is its HOME in
    // the Files folder, stamped server-side (`homeFolderForUpload`); its presence
    // HERE is the destination's `occurrences[]` entry, written by `onPlaceholders`
    // above. Re-stamping parentId to the container would clobber the home and
    // make the whole Files-folder rule inert — the file would once again live
    // wherever the pointer happened to be.
    //
    // Two things fall out of that split rather than needing to be built:
    //   • `delete_occurrence`'s cascade only recurses where `child.parentId ===
    //     id`, so deleting the CONTAINER unlinks the file instead of destroying
    //     it — Step 5's "removing a placement leaves the file in Files".
    //   • the filter cascade is unaffected: it walks the `occurrences[]` reverse
    //     map, not parentId (which containers and pages do not even carry).
    // Canvas still persists `meta` — that is where x/y lives.
    persist: (p) => (canvasPos && !finalContainerOcc ? { meta: p.occurrence.meta } : null),
    // The .md / .csv shapes hand the file's CONTENT to the server importer
    // instead of uploading it, so their outcome arrives asynchronously and has
    // to be reported. A failure here is not hypothetical — an unreadable file
    // or a one-column CSV both land here, and both must say so rather than
    // leaving the user looking at a drop that appeared to do nothing.
    onImportResult: (res) => {
      if (!res?.ok) { toast.error(`Import failed: ${res?.error || "unknown error"}`); return; }
      const s = res.stats || {};
      const bits = [];
      if (s.containers) bits.push(`${s.containers} container${s.containers === 1 ? "" : "s"}`);
      if (s.instances) bits.push(`${s.instances} item${s.instances === 1 ? "" : "s"}`);
      if (s.textblocks) bits.push(`${s.textblocks} text block${s.textblocks === 1 ? "" : "s"}`);
      toast.success(`Imported (${bits.join(" · ") || "no content"})`);
      if (res.rootOccurrenceId) setTimeout(() => jumpToOccurrence(res.rootOccurrenceId), 200);
    },
    // NOTE: no `onIntakeResult` here on purpose. The router reports an intake's
    // outcome itself (`notifyIntake`), including the OCR shapes' progress toast.
    // Passing one here would OVERRIDE that — the seam still exists for a caller
    // that genuinely needs different behaviour, and this one does not.
  };

  // ── ASK what this should become ───────────────────────────────────
  // The audit's first finding was that nothing asks: the same file dropped
  // two feet apart became two different things and the user was never told
  // why. The pre-selected shape is TODAY'S behaviour, so Enter reproduces
  // exactly what this handler used to do on its own.
  const classification = filterToImplemented(
    classifyIntake({ files }, {
      kind: canvasPos ? "canvas" : (finalContainerOcc ? "board" : null),
      occurrenceId: finalContainerOcc?.id || null,
      canDraw: !!canvasPos,
      // Lights up IMAGE_ATTACH — "put this ON that thing" rather than beside it.
      // Offered only where there is somewhere to attach TO, so a destination
      // with no Files field never sees a tile that could not do anything.
      filesFieldId: filesFieldIdFor(
        finalContainerOcc ? state?.modulesById?.[finalContainerOcc.moduleId] : null,
      ),
    }),
  );

  const opened = openIntakeSheet({
    classification,
    position: { top: y + 8, left: x + 8 },
    onPick: (shapeId, answer) => applyIntakeShape(shapeId, intakeCtx, answer),
    // Cancel writes NOTHING. The placeholders have not been minted yet —
    // that is the whole reason the ask happens BEFORE any write rather than
    // after, so "Escape" cannot leave debris behind.
    onCancel: () => {},
  });

  // No host mounted (a preview iframe, a test harness) — fall back to today's
  // behaviour rather than silently dropping the file on the floor.
  if (!opened) applyIntakeShape(classification.fallback, intakeCtx);

  clearSession();
}

// ============================================================
// EXTERNAL TEXT/URL → CONTAINER
// ============================================================
export function handleExternalDrop(dropContext, ctx) {
  const { dispatch, socket, state, occurrencesById, baseContainers, clearSession } = ctx;
  const { payload, target, position, pointer, dataTransfer } = dropContext;
  const { y } = pointer || { x: 0, y: 0 };
  const { containerId, dropTarget } = dropView(dropContext, ctx);

  const gridId = state?.gridId || state?.grid?._id;

  // ── Drag-to-import pathway (docket #6.5) ────────────────────────
  // When the dropped content is HTML or non-trivial multi-paragraph
  // text, fan it through the server-side importer instead of minting
  // a single instance with the raw text as the label.
  const htmlFromDt = (() => {
    try { return dataTransfer?.getData?.("text/html") || ""; } catch { return ""; }
  })();
  const textFromDt = (() => {
    if (payload?.data?.text) return String(payload.data.text);
    try { return dataTransfer?.getData?.("text/plain") || ""; } catch { return ""; }
  })();
  const wantsImport = (() => {
    if (htmlFromDt && htmlFromDt.trim().length > 12) return { format: "html", content: htmlFromDt };
    const t = textFromDt;
    if (!t) return null;
    const hasStructure = /\n\s*\n/.test(t) || /(^|\n)\s*(?:#{1,6} |[-*] |\d+\. |```|!\[)/.test(t);
    if (hasStructure || t.length > 200) return { format: "auto", content: t };
    return null;
  })();

  // Resolve the import destination — three modes:
  //   1. Container drop  — append under this container's occurrence
  //   2. Page drop       — append under the page occurrence (board
  //                        pages and canvas pages both work)
  //   3. Empty grid cell — mint a new panel + container at the cell,
  //                        then append under the new container
  function resolveImportParent() {
    // Mode 1: container
    if (containerId) {
      const c = baseContainers.find(c => c.id === containerId);
      const cOcc = c ? Object.values(occurrencesById).find(o => o.moduleId === c.id) : null;
      if (cOcc) return { parentId: cOcc.id, title: c.label || "Imported" };
    }
    // Mode 2: page (drop target carries pageOccurrenceId but no container).
    // Folder pages are a special case — the folder-page grid enumerates
    // children of the FOLDER (pageOcc.parentId), not children of the page
    // occurrence. Imports onto a folder page must therefore parent under
    // the folder so the new content actually shows up in the grid.
    const pageOccId = dropTarget?.context?.pageOccurrenceId;
    if (pageOccId && occurrencesById[pageOccId]) {
      const pageOcc = occurrencesById[pageOccId];
      const pageMod = state?.modulesById?.[pageOcc.moduleId];
      if (pageMod?.kind === "folder" && pageOcc.parentId) {
        return { parentId: pageOcc.parentId, title: pageMod?.label || "Imported" };
      }
      return { parentId: pageOccId, title: pageMod?.label || "Imported" };
    }
    // Mode 3: empty grid cell — no natural home. Mint a panel at the cell and
    // flag the import to be wrapped in a doc page under the "Imports" folder
    // (pinned to that panel), mirroring the assistant's homeless-import path.
    // The root is imported detached (parentId: null) and re-homed on result.
    if (dropTarget?.type === DROP_TARGET_KIND.GRID_CELL
        && dropTarget?.context?.row !== undefined
        && dropTarget?.context?.col !== undefined
        && state?.grid && state?.userId && gridId) {
      const cell = { row: dropTarget.context.row, col: dropTarget.context.col };
      const label = "Imported";
      const newPanel = { id: makeUUID(), label, role: "panel", kind: "board" };
      const { occurrence: panelOcc } = LayoutHelpers.createPanelInGrid({
        dispatch, socket, grid: state.grid, panel: newPanel,
        placement: { row: cell.row, col: cell.col, width: 1, height: 1 },
        userId: state.userId, emit: true,
      });
      return { parentId: null, title: label, wrapPanelOccId: panelOcc.id };
    }
    return null;
  }

  // ── Legacy link/text write, as a closure ──────────────────────────
  // Today's outcome for a short text / URL drop: an instance whose LABEL is
  // the raw value. The audit calls this out as the thing to replace, but a
  // decision layer that cannot reproduce what the app already does is not
  // behaviour-preserving — so it stays, as a named shape the sheet offers,
  // until Task 5's chip/bookmark/board-option land.
  const runLegacyLink = () => {
    const container = baseContainers.find(c => c.id === containerId);
    if (!container) { clearSession(); return; }
    const containerOcc = Object.values(occurrencesById).find(o => o.moduleId === container.id);

    let label = "Untitled";
    if (payload.payloadType === DragType.TEXT) label = (payload.data?.text || "").slice(0, 80) || "Text";
    else if (payload.payloadType === DragType.URL) label = payload.data?.url || "Link";

    let toIndex = dropTarget.context?.insertAt ?? null;
    if (toIndex === null) toIndex = resolveNearestIndex(containerOcc, occurrencesById, y);

    LayoutHelpers.createInstanceInContainer({
      dispatch, socket, gridId, container, containerOccurrence: containerOcc || null,
      instance: { id: makeUUID(), label }, userId: state?.userId, index: toIndex, emit: true,
    });
  };

  // ── A LINK drop asks ──────────────────────────────────────────────
  // This is the audit's headline finding: a dropped link became a card
  // labelled with the raw URL, silently, even though the importer could have
  // built the whole page from it. Now it asks — and "Import the page" is a
  // real option here because `import_url` exists (2026-08-07).
  const droppedUrl = payload?.payloadType === DragType.URL
    ? (payload?.data?.url || "")
    : (isUrlish(textFromDt) ? textFromDt.trim() : "");
  if (droppedUrl && containerId) {
    const container = baseContainers.find(c => c.id === containerId);
    const containerOcc = container ? Object.values(occurrencesById).find(o => o.moduleId === container.id) : null;
    // `isOptionBoard` is what lights up the BOARD OPTION shape. It is derived
    // from the board's own feed (helpers/boardOption) rather than a list of
    // board ids, so all 34 option boards get it and an ordinary board does not.
    const classification = filterToImplemented(
      classifyIntake({ url: droppedUrl }, {
        kind: "board",
        occurrenceId: containerOcc?.id || null,
        isOptionBoard: isOptionBoard(containerOcc),
        // Lights up LINK_FIELD_VALUE, and supplies its second question. A LIST,
        // because there is no link field TYPE to detect — the user picks
        // (helpers/intakeFields.js has the measurement).
        linkFields: linkTargetFieldsFor(
          containerOcc ? state?.modulesById?.[containerOcc.moduleId] : null,
          Object.fromEntries((state?.fields || []).map((f) => [f.id, f])),
        ),
      }),
    );
    const linkCtx = {
      payload: classification.payload,
      destination: { parentId: containerOcc?.id || null },
      gridId, socket, onLegacyLink: runLegacyLink,
      // The chip shape mints a real occurrence at the drop point, so it needs
      // the same destination + index the legacy card path resolves.
      userId: state?.userId, dispatch,
      destinationOccurrence: containerOcc || null,
      insertIndex: dropTarget.context?.insertAt
        ?? resolveNearestIndex(containerOcc, occurrencesById, y),
      onImportResult: (res) => {
        if (res?.ok) {
          toast.success("Page imported");
          if (res.rootOccurrenceId) setTimeout(() => jumpToOccurrence(res.rootOccurrenceId), 200);
        } else {
          toast.error(`Couldn't import: ${res?.error || "unknown error"}`);
        }
      },
    };
    const opened = openIntakeSheet({
      classification,
      position: { top: (pointer?.y ?? 0) + 8, left: (pointer?.x ?? 0) + 8 },
      onPick: (shapeId, answer) => { applyIntakeShape(shapeId, linkCtx, answer); clearSession(); },
      onCancel: () => clearSession(),
    });
    if (!opened) { applyIntakeShape(classification.fallback, linkCtx); clearSession(); }
    return;
  }

  if (wantsImport && socket?.emit) {
    const dest = resolveImportParent();
    if (dest) {
      // ── The HTML / long-text drop asks too ────────────────────────
      // Today's outcome (the whole tree, wrapped as a doc page) is the
      // pre-selected shape, so Enter reproduces exactly what this branch did
      // on its own. `runImport` below IS that behaviour, unchanged — the ask
      // just decides whether to run it.
      const textClassification = filterToImplemented(
        classifyIntake(
          wantsImport.format === "html"
            ? { html: wantsImport.content }
            : { text: wantsImport.content },
          { kind: containerId ? "board" : null, occurrenceId: dest.parentId || null },
        ),
      );
      const runImport = () => {
      const requestId = makeUUID();
      // Loading toast — swapped to success/fail on import_text_result
      // (server acks with the matching requestId). 30s upper cap in
      // case the server never responds for some reason.
      // Loading toast — swapped to success/fail when the server acks
      // import_text_result with the matching requestId. 30s upper cap so
      // the loading spinner can't get stuck if the server never responds.
      const toastId = toast.loading(`Importing into ${dest.title}…`, { duration: 30000 });
      const onResult = (resp) => {
        if (!resp || resp.requestId !== requestId) return;
        socket.off?.("import_text_result", onResult);
        if (resp.ok) {
          const s = resp.stats || {};
          const bits = [];
          if (s.containers) bits.push(`${s.containers} container${s.containers === 1 ? "" : "s"}`);
          if (s.instances) bits.push(`${s.instances} item${s.instances === 1 ? "" : "s"}`);
          if (s.textblocks) bits.push(`${s.textblocks} text block${s.textblocks === 1 ? "" : "s"}`);
          if (s.artifacts) bits.push(`${s.artifacts} image${s.artifacts === 1 ? "" : "s"}`);
          toast.success(`Imported (${bits.join(" · ") || "no content"})`, { id: toastId });
          // Homeless import (empty-cell drop): wrap the new root in a doc page
          // under the "Imports" folder, pinned to the panel minted at the cell,
          // so it shows up grouped in the Local/Root tree (same as the assistant
          // import path). Then scroll to + flash the imported content.
          if (resp.rootOccurrenceId && dest.wrapPanelOccId) {
            createImportsDocPage({
              rootOccId: resp.rootOccurrenceId, panelOccurrenceId: dest.wrapPanelOccId,
              grid: state?.grid, manifests: state?.manifests, folders: state?.folders,
              occurrencesById: state?.occurrencesById,
              dispatch, socket, userId: state?.userId, label: dest.title,
            });
          }
          // Scroll to + flash the new root so the user sees their
          // freshly imported content land. Defer briefly so the
          // store has time to absorb the per-entity broadcasts.
          if (resp.rootOccurrenceId) {
            setTimeout(() => jumpToOccurrence(resp.rootOccurrenceId), 200);
          }
        } else {
          toast.error(`Import failed: ${resp.error || "unknown error"}`, { id: toastId });
        }
      };
      socket.on?.("import_text_result", onResult);
      socket.emit("import_text", {
        content: wantsImport.content,
        format: wantsImport.format,
        gridId,
        parentId: dest.parentId,
        title: dest.title,
        requestId,
      });
      };

      const textCtx = {
        payload: textClassification.payload,
        destination: { parentId: dest.parentId },
        gridId, socket,
        // TEXT_TEXTBLOCK writes an occurrence rather than emitting an import, so
        // it needs the same three things every minting route does. Without them
        // it silently bails and the shape is a tile that does nothing — the
        // exact "offered but not implemented" failure the coverage contract
        // exists to prevent.
        dispatch, userId: state?.userId,
        destinationOccurrence: state?.occurrencesById?.[dest.parentId] || null,
        // TEXT_DOC_PAGE mints a page THROUGH `createPageInContainer`, whose
        // `allowChildContainers` flip rewrites the parent module's whole `meta`.
        // Without the module here that write would clobber every other key on
        // it — so this is load-bearing, not a convenience.
        destinationModule: (() => {
          const occ = state?.occurrencesById?.[dest.parentId];
          return occ ? (state?.modulesById?.[occ.moduleId] || null) : null;
        })(),
        // Today's whole-tree import, unchanged, and now reached only where it
        // is the ONLY thing that can work: a HOMELESS import (empty-cell drop),
        // where the panel this wraps into was minted seconds ago by
        // `resolveImportParent` and only this closure knows about it.
        onImportText: runImport,
        // …which means the shapes that own their own write need their own
        // reporting. `runImport`'s toast is inside the closure above, so a
        // shape that bypasses it would otherwise land in silence.
        onImportResult: (res) => {
          if (res?.ok) {
            toast.success("Imported");
            const land = res.pageOccurrenceId || res.rootOccurrenceId;
            if (land) setTimeout(() => jumpToOccurrence(land), 200);
          } else {
            toast.error(`Import failed: ${res?.error || "unknown error"}`);
          }
        },
      };
      const opened = openIntakeSheet({
        classification: textClassification,
        position: { top: (pointer?.y ?? 0) + 8, left: (pointer?.x ?? 0) + 8 },
        onPick: (shapeId, answer) => { applyIntakeShape(shapeId, textCtx, answer); clearSession(); },
        onCancel: () => clearSession(),
      });
      if (!opened) { applyIntakeShape(textClassification.fallback, textCtx); clearSession(); }
      return;
    }
    // No usable drop destination — fall through to legacy below.
  }

  // Short text with no usable import destination — today's behaviour.
  runLegacyLink();
}

// ============================================================
// CROSS-WINDOW INSTANCE DROP
// ============================================================

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
      const surfaceEl = document.querySelector(`[data-page-occ-id="${pageOccId}"] .canvas-surface`);
      const rect = dropTarget.context?.targetRect
        || surfaceEl?.getBoundingClientRect?.()
        || document.querySelector(`[data-page-occ-id="${pageOccId}"]`)?.getBoundingClientRect?.();
      const scrollX = surfaceEl?.scrollLeft ?? 0;
      const scrollY = surfaceEl?.scrollTop ?? 0;
      const cx = rect ? Math.max(0, Math.round(x - rect.left + scrollX)) : 20;
      const cy = rect ? Math.max(0, Math.round(y - rect.top + scrollY)) : 20;

      const newOccId = makeUUID();
      const newCanvasLeaf = {
        id: newOccId,
        userId: state?.userId,
        gridId,
        moduleId: payload.moduleId,
        parentId: pageOccId,
        fields: {},
        meta: { x: cx, y: cy },
      };
      CommitHelpers.createOccurrence({
        dispatch, socket,
        occurrence: newCanvasLeaf,
        emit: true,
      });
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: pageOccId, occurrences: [...(pageOcc.occurrences || []), newOccId] },
        emit: true,
      });
      autoAppendOnDrop({ ctx, newOccurrence: newCanvasLeaf, parentOccurrenceId: pageOccId });
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
      // MD1 — when dropping into a day-col's slot, use the day-col as the
      // parent for filter resolution so the new copy stamps the destination
      // day's date.
      const ccFilterAncestorOcc = targetContainerOcc
        ? findFilterOverrideAncestor({
            pointer, occurrencesById, excludeOccId: targetContainerOcc.id,
          })
        : null;
      // Pre-stamp the destination's page-filter fields so the create lands
      // with the right date — same reasoning as handleOccurrenceMove copy mode.
      const stampedFields = computePageFilterFields({
        state, occurrencesById,
        parentContainerOcc: ccFilterAncestorOcc || targetContainerOcc,
        existingFields: {},
      });
      const ccCopyResult = LayoutHelpers.copyInstanceToContainer({
        dispatch, socket, gridId, sourceInstanceId: payload.moduleId,
        toContainer: targetContainerOcc ? { ...targetContainer, _occurrence: targetContainerOcc } : targetContainer,
        userId: state?.userId, iterationMode: "persistent", emit: true,
        sourceOccurrence: Object.keys(stampedFields).length ? { fields: stampedFields } : null,
      });
      if (ccCopyResult?.occurrence && targetContainerOcc) {
        autoAppendOnDrop({ ctx, newOccurrence: ccCopyResult.occurrence, parentOccurrenceId: targetContainerOcc.id });
      }
    }
  }

  // PAGE role → PANEL: pin the page occurrence as a tab on the panel.
  // Container drops are unreachable for pages because the tree-page drag
  // now uses type "page", which CONTAINER_LIST doesn't accept.
  if (role === "page" && panelId && gridId) {
    const panelOccurrenceId = dropTarget.context?.panelOccurrenceId;
    // Two page-drag sources with different payload shapes: the tree-page drag
    // (ManifestTree) sets a top-level `occurrenceId`; the page-shell drag
    // (ModulePage, moving a page tab between panels) carries the occurrence at
    // `data.occurrence.id`. Resolve both so pinning works from either source.
    const pageOccurrenceId = payload.occurrenceId || payload?.data?.id || payload?.data?.occurrence?.id;
    if (panelOccurrenceId && pageOccurrenceId) {
      CommitHelpers.pinPageToPanel({
        dispatch, socket,
        pageOccurrenceId,
        panelOccurrenceId,
        emit: true,
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
      const newPanel = { id: makeUUID(), label: container.label || "Panel", role: "panel", kind: "board" };
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
      const newPanel = { id: makeUUID(), label: instance.label || "Panel", role: "panel", kind: "board" };
      const { occurrence: panelOcc } = LayoutHelpers.createPanelInGrid({
        dispatch, socket, grid, panel: newPanel,
        placement: { row: cell.row, col: cell.col, width: 1, height: 1 }, userId, emit: true,
      });
      const newContainer = { id: makeUUID(), label: instance.label || "Container", role: "container", kind: "board" };
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

  // Drop on container → LAND A PLACEMENT (plan Task 4 Step 6).
  //
  // Dragging a file OUT of Files places it somewhere; it does not move it out of
  // Files and does not upload anything. WHICH placement is per-kind, and the
  // rule is `placementSemanticForKind` — the client twin of the server's, so a
  // drop can decide without a round trip:
  //
  //   MEDIA    → COPY: a new occurrence of the same module. Each placement moves,
  //              styles and deletes on its own; the bytes are single-sourced by
  //              the sha256 dedup that already exists.
  //   MARKDOWN → MULTIPARENT: the SAME occurrence, listed by one more parent.
  //              `textmap` lives on the occurrence, so copying would give the
  //              placement its own independent body — you would edit it here and
  //              the copy in Files would still show the old text.
  //
  // This is the other half of Step 5: until now nothing in the app created a
  // SECOND placement, so the copy-vs-file delete distinction had no way to be
  // exercised end to end.
  if (containerId) {
    const artifactOcc = occurrencesById[payload.occurrenceId];
    const artifactModule = artifactOcc ? (state?.modules || []).find(m => m.id === artifactOcc.moduleId) : null;
    if (artifactModule) {
      const toC = baseContainers.find(c => c.id === containerId);
      const toCOcc = (containerOccurrenceId && occurrencesById[containerOccurrenceId])
        || (toC ? Object.values(occurrencesById).find(o => o.moduleId === toC.id) : null);
      if (toCOcc) {
        const semantic = placementSemanticForKind(artifactModule.kind);
        const alreadyListed = (toCOcc.occurrences || []).includes(artifactOcc.id);
        if (semantic === "multiparent") {
          // Idempotent: dropping the same markdown file on the same container
          // twice must not list it twice. A duplicate id in `occurrences[]`
          // renders the body twice and makes the array's own order ambiguous.
          if (!alreadyListed) {
            CommitHelpers.spliceChildIntoParent({
              dispatch, socket, parentOccurrence: toCOcc, occurrenceId: artifactOcc.id,
            });
          }
        } else {
          LayoutHelpers.copyInstanceToContainer({
            dispatch, socket, sourceInstanceId: artifactModule.id,
            toContainer: { ...toC, _occurrence: toCOcc }, userId: state?.userId,
            gridId: state?.gridId || state?.grid?._id, emit: true,
          });
        }
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
      const newPanel = { id: makeUUID(), label, role: "panel", kind: "board" };
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
