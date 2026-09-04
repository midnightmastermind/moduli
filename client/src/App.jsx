// App.jsx — STEP 2: commits routed through CommitHelpers / LayoutHelpers
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { armScrollDiag } from "./helpers/scrollDiag.js";
import { armHaptics } from "./helpers/haptics.js";
import { enableOffscreenRows, setOffscreenRowsDeferred } from "./helpers/offscreenRows.js";
// Installs window.__domAudit() — the DOM census (helpers/domAudit.js). Imported
// for its side effect only: nothing calls it, and unimported it would be tree
// shaken out of the bundle, so the one device that needs it could never run it.
import "./helpers/domAudit.js";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { preventUnhandled } from "@atlaskit/pragmatic-drag-and-drop/prevent-unhandled";

import { socket } from "./socket";
import { bindFullStateRequest } from "./helpers/fullStateRequest";
import { bindSocketToStore, operationsBridge } from "./state/bindSocketToStore";
import { toast } from "./state/notificationStore";

import { ActionTypes, logoutAction } from "./state/actions";
import Grid from "./Grid";
import LoginScreen from "./LoginScreen";

import { GridDataContext } from "./GridDataContext";
import { GridActionsContext } from "./GridActionsContext";
import { GridLiveContext } from "./GridLiveContext";
import { initActiveCellForGrid } from "./state/activeCellStore";

import { useBoardState } from "./state/useBoardState";

import Toolbar from "./Toolbar";
import TransactionHistory from "./ui/TransactionHistory";
// Lazy: CommandCenter pulls the whole settings-tab tree + the blocks
// operations editor — none of it is needed before the user opens it.
const CommandCenter = React.lazy(() => import("./ui/CommandCenter"));
import AssistantDrawer from "./ui/AssistantDrawer";
import TextContextMenu from "./ui/TextContextMenu";
import ClipboardDropOverlay from "./ui/ClipboardDropOverlay";
import RubberBandSelector from "./ui/RubberBandSelector";
import { Spinner } from "./components/ui/spinner";
import UserInputModal from "./ui/UserInputModal";
import { ImagePickerHost } from "./ui/ImagePickerMenu";
import { AddressPickerHost } from "./ui/AddressPickerMenu";
import { IntakeSheetHost } from "./ui/IntakeSheet";
import { ConfirmListHost } from "./ui/ConfirmListHost";
import IntakePasteHost from "./ui/IntakePasteHost";
import { SelectionContext, useSelectionProvider } from "./state/SelectionContext";
import { publishComputedValues } from "./state/computedValuesStore";

import { useUndoRedo } from "./hooks/useUndoRedo";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useAnimations } from "./hooks/useAnimations";
import { useScheduler } from "./state/useScheduler";
import { useTheme } from "./helpers/useTheme";
import { SURFACE_ALPHA } from "./helpers/StyleHelpers";
import { useSkin } from "./hooks/useSkin";
import { useMobileDetect } from "./hooks/useMobileDetect";
import { useLayoutRuleMode } from "./hooks/useLayoutRuleMode";
import { installMobileInputAutoScroll } from "./hooks/useMobileKeyboard";
import { enableStagedMount } from "./helpers/stagedMount";

import * as CommitHelpers from "./helpers/CommitHelpers";
import * as LayoutHelpers from "./helpers/LayoutHelpers";
import { requestLabelEdit } from "./helpers/pendingLabelEdit.js";
import { openPanelOnRootFolderPage } from "./helpers/importsFolder";
import { buildLookup } from "./helpers/LayoutHelpers";
import { optionScopeFieldIds, poolKeyFrom } from "./helpers/optionPoolKey";

import { normalizeFieldBindings } from "./helpers/siblingFieldBindings.js";
import { installFastWheel } from "./helpers/wheelScroll.js";
function findNextOpenPosition(panels = [], rows = 1, cols = 1) {
  const taken = new Set(panels.map((p) => `${p.row}-${p.col}`));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${r}-${c}`;
      if (!taken.has(key)) return { row: r, col: c };
    }
  }
  return { row: 0, col: 0 };
}

export default function App() {
  const { state, dispatch: rawDispatch } = useBoardState();

  // Keep a ref to current state so bindSocketToStore's executor always sees fresh state
  const stateRef = useRef(state);
  stateRef.current = state;

  // Track previous filterNavState to detect date changes for NavigationOp.
  // filterNavInitializedRef stays false until the first non-empty hydration so
  // the initial {} → populated transition (which happens on every load) doesn't
  // fire a spurious NavigationOp on top of the onLoad pass.
  const prevFilterNavRef = useRef({});
  const filterNavInitializedRef = useRef(false);

  // Expose state to window for E2E test data verification
  if (typeof window !== "undefined") window.__moduli_state__ = state;

  // BroadcastChannel for multi-window sync (same origin, same browser)
  const bcRef = useRef(null);

  // Wrapped dispatch: posts to BroadcastChannel for non-socket, non-BC actions
  const dispatch = useCallback((action) => {
    rawDispatch(action);
    if (!action._fromSocket && !action._fromBC && bcRef.current) {
      try {
        bcRef.current.postMessage({ _type: "dispatch", payload: action });
      } catch {
        // ignore non-serializable actions
      }
    }
  }, [rawDispatch]);

  // `[scroll]` diagnostic for the mobile Routines report — arms once, records
  // the first few scroll bursts, then stops. Mute: window.__scrollDiag = false.
  useEffect(() => { armScrollDiag(); }, []);

  // A mouse-wheel notch travels further (user, 2026-08-28). Trackpads and touch
  // are deliberately untouched, and the drag autoscroll is a different system
  // (`helpers/autoscrollMath.js`) — see the helper's header.
  useEffect(() => installFastWheel(document), []);

  // Every button and every picker buzzes (user, 2026-09-02). ONE document
  // listener rather than a prop on hundreds of controls — see the helper's
  // header for why, and for what it deliberately stays quiet on (drag handles,
  // which dragSystem already buzzes for, and text entry).
  useEffect(() => armHaptics(), []);

  // Off-screen mobile panels do not mount their rows — MEASURED AND OFF, see
  // helpers/offscreenRows.js. It does everything it claims (paint -50%, scroll
  // p95 117 -> 28ms) and still loses the tap, because unmounting ~93 rows and
  // remounting them costs more React work than the paint it saves. Kept behind
  // `window.__offscreenRows = true` because the mechanism is sound and the
  // TRIGGER is what is wrong; the deferred-mount variant is the open question.
  useEffect(() => { enableOffscreenRows(false); setOffscreenRowsDeferred(true); }, []);

  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const bc = new BroadcastChannel("moduli-sync");
    bcRef.current = bc;
    bc.onmessage = (e) => {
      if (e.data?._type === "dispatch") {
        rawDispatch({ ...e.data.payload, _fromBC: true });
      }
    };
    return () => {
      bc.close();
      bcRef.current = null;
    };
  }, [rawDispatch]);

  const modulesById = useMemo(
    () => buildLookup(state.modules),
    [state.modules]
  );

  const instancesById = useMemo(
    () => buildLookup(state.instances),
    [state.instances]
  );

  const artifactsById = useMemo(
    () => buildLookup(state.artifacts),
    [state.artifacts]
  );

  const textblocksById = useMemo(
    () => buildLookup(state.textblocks),
    [state.textblocks]
  );

  // THE REACTIVE KEY FOR OPTION POOLS (helpers/optionPoolKey.js).
  //
  // `FieldRenderer` used the grid-wide occurrence COUNT as its dep for option
  // resolution, so any create anywhere re-resolved every dropdown on screen —
  // 615 field renders on a single DROP, because a drop creates an occurrence.
  // A drop creates a schedule placement, which carries no board tag and
  // belongs to no pool.
  //
  // Derived here, once per occurrence change, for the same reason
  // `instancesById` is: doing it inside a selector would walk 21,000
  // occurrences on every store notification, per field.
  const optionScopeFids = useMemo(() => optionScopeFieldIds(state.fields), [state.fields]);
  const optionPoolKey = useMemo(
    () => poolKeyFrom(state.occurrences, optionScopeFids),
    [state.occurrences, optionScopeFids],
  );

  // Merged leaf-placeable lookup — anything that can live as a child of a container.
  const leafModulesById = useMemo(
    () => ({ ...instancesById, ...artifactsById, ...textblocksById }),
    [instancesById, artifactsById, textblocksById]
  );

  const occurrencesById = useMemo(
    () => buildLookup(state.occurrences),
    [state.occurrences]
  );

  // C3: Pre-index linked groups for O(1) sibling lookup in Instance.jsx
  const linkedGroupIndex = useMemo(() => {
    const idx = Object.create(null);
    for (const occ of state.occurrences || []) {
      if (occ.linkedGroupId) {
        (idx[occ.linkedGroupId] || (idx[occ.linkedGroupId] = [])).push(occ);
      }
    }
    return idx;
  }, [state.occurrences]);

  // Pre-index children by parentId for O(1) lookups in ManifestTree
  const childrenByParentId = useMemo(() => {
    const idx = Object.create(null);
    for (const occ of state.occurrences || []) {
      if (occ.parentId) {
        (idx[occ.parentId] || (idx[occ.parentId] = [])).push(occ);
      }
    }
    return idx;
  }, [state.occurrences]);

  // #24 perf — pre-index occurrences by `moduleId`. Every container's
  // `containerOccurrence` memo, every getOtherOccurrences call, every
  // panel-occ resolver previously did `Object.values(occurrencesById)
  // .find(o => o.moduleId === id)` — an O(N) scan per render, per
  // container. With 50 containers × 500 occurrences that's 25k
  // comparisons every paint. Indexing once at the state layer
  // collapses each lookup to O(1).
  const occurrencesByModuleId = useMemo(() => {
    const idx = Object.create(null);
    for (const occ of state.occurrences || []) {
      const mid = occ?.moduleId;
      if (!mid) continue;
      (idx[mid] || (idx[mid] = [])).push(occ);
    }
    return idx;
  }, [state.occurrences]);

  // #24 perf — parent-by-child reverse map built from `occurrences[]`.
  // Used by ModuleContainer's removeMe, dragHitTesting,
  // getEffectiveFilterForOccurrence, FiltersSection ancestor walk —
  // each previously built or scanned this map on demand. Memoizing
  // once at App level eliminates the O(N) scan per consumer.
  const parentByChildId = useMemo(() => {
    const map = Object.create(null);
    for (const occ of state.occurrences || []) {
      if (!Array.isArray(occ?.occurrences)) continue;
      for (const childId of occ.occurrences) map[childId] = occ.id;
    }
    return map;
  }, [state.occurrences]);

  const containersById = useMemo(
    () => buildLookup(state.containers),
    [state.containers]
  );

  const fieldsById = useMemo(
    () => buildLookup(state.fields),
    [state.fields]
  );

  const manifestsById = useMemo(
    () => buildLookup(state.manifests),
    [state.manifests]
  );

  const viewsById = useMemo(
    () => buildLookup(state.views),
    [state.views]
  );

  const foldersById = useMemo(
    () => buildLookup(state.folders),
    [state.folders]
  );

  const operationsById = useMemo(
    () => buildLookup(state.operations),
    [state.operations]
  );

  // Scheduler: runs time-based ops (Operation.schedule != null) on a shared
  // 1s tick. Sub-hour cadences are display-only; hour+ schedules can run the
  // full pipeline. lastFiredAt sync via update_operation handles cross-device
  // coordination (whichever device fires first wins).
  useScheduler({
    state, dispatch, socket,
    fieldsById, operationsById, occurrencesById, modulesById,
  });

  // Undo/Redo state (lifted from Grid so Toolbar can access it)
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commandCenterOpen, setCommandCenterOpen] = useState(false);
  // Once CC opens for the first time, keep it mounted so slide animation works on close
  const [commandCenterEverOpened, setCommandCenterEverOpened] = useState(false);
  useEffect(() => { if (commandCenterOpen) setCommandCenterEverOpened(true); }, [commandCenterOpen]);

  // Prevent OS from intercepting unhandled drags. Per user request, the
  // CommandCenter does NOT auto-collapse on drag start — only file (artifact)
  // pills are still draggable onto the grid; fields and operations are now
  // organize-in-place only (category reorder), so keeping the CC open while
  // dragging makes the source location stay visible.
  useEffect(() => {
    return monitorForElements({
      onDragStart: () => {
        preventUnhandled.start();
      },
      onDrop: () => {
        preventUnhandled.stop();
      },
    });
  }, []);

  // Global Escape key: close history dialog first, then CommandCenter
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.contentEditable === "true") return;
      if (historyOpen) { setHistoryOpen(false); return; }
      if (commandCenterOpen) { setCommandCenterOpen(false); return; }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [commandCenterOpen, historyOpen]);

  const { captureAllPositions, animateToNewPositions, flashElement } = useAnimations();
  useTheme(); // Applies data-theme + dark class from localStorage on mount

  // ONE AUTHORITY FOR SURFACE TRANSPARENCY. Two halves make the grid's wallpaper
  // show through: the stylesheet (`--grid-surface-a`, for surfaces with no
  // colour of their own) and `StyleHelpers.withSurfaceAlpha` (for a container or
  // instance carrying `ownStyle.bg`, which renders INLINE and beats any rule).
  // Publishing the JS constant into the CSS var means there is one number, not
  // two that have to be remembered as equal — the drift this repo keeps paying
  // for. The stylesheet's own value is the pre-mount fallback.
  // …and the SKIN publishes the same number when the grid names one, so a
  // Stardew grid gets its opaque wooden panels rather than retro's glass. This
  // effect is the pre-skin fallback; `useSkin` below runs after it and wins.
  useEffect(() => {
    document.documentElement.style.setProperty("--grid-surface-a", String(SURFACE_ALPHA));
    // FIELD TYPE SIZE IS NOT PUBLISHED FROM HERE ANY MORE (2026-08-26).
    // `setProperty` writes an INLINE style on :root, which beats every
    // stylesheet rule — including the media queries that now shrink the grid's
    // type below tablet width. So `--field-font-px` / `--instance-label-px` /
    // `--filter-font-px` are declared in index.css and the JS constants are
    // `var()` references to them. One authority, and breakpoints can reach it.
  }, []);

  // WHICH SKIN THIS GRID RENDERS IN — per grid, so switching grids re-skins.
  useSkin(state.grid);

  // Mobile grid navigation state. The user can pin the layout per viewport
  // size via grid.meta.layoutRules (GridSettingsTab) — a matching rule wins
  // over the built-in heuristic (e.g. pin tablet portrait AND landscape to the
  // desktop grid so rotation never remounts the whole tree).
  const { isTouch, isMobileLayout: detectedMobileLayout } = useMobileDetect();
  const ruledLayoutMode = useLayoutRuleMode(state.grid?.meta?.layoutRules);
  const isMobileLayout = ruledLayoutMode ? ruledLayoutMode === "mobile" : detectedMobileLayout;

  // Expose the resolved layout to CSS (same pattern as body[data-drag-kind]).
  // Lets the coarse-pointer touch-size bumps stay tablet-only: under the
  // mobile layout the drag handles compact again so they don't push content
  // on phone-width rows (see index.css body[data-layout="mobile"] rules).
  useEffect(() => {
    document.body.dataset.layout = isMobileLayout ? "mobile" : "desktop";
  }, [isMobileLayout]);

  // #23 mobile: install one-time global focusin → scrollIntoView so
  // typing into a field never leaves the cursor under the virtual
  // keyboard. Idempotent + safely no-ops on desktop / unsupported
  // browsers (the helper guards on visualViewport availability).
  useEffect(() => { installMobileInputAutoScroll(); }, []);
  // Panel content mounts one panel per frame instead of all at once (see
  // helpers/stagedMount.js). Enabled HERE rather than at import time so a unit
  // test that renders a panel still gets its content synchronously.
  // `window.__noStaging = true` (set before load) turns it off — the A/B switch
  // the staged-loading measurements are taken against.
  useEffect(() => { if (!window.__noStaging) enableStagedMount(); }, []);

  // Suppress the native `contextmenu` (right-click menu) when it isn't a real
  // desktop right-click: a TOUCH/PEN long-press fires contextmenu ~0.5s in — but
  // long-press IS the drag gesture here, so the menu popped up mid-drag (user
  // 2026-07-19: "the right click shouldn't happen if I'm trying to drag").
  // useLongPress is disabled, so touch has no intended context menu at all.
  // Capture-phase + preventDefault stops it before any onContextMenu handler runs.
  // Desktop MOUSE right-click still opens the menu.
  useEffect(() => {
    let touchActive = false;
    let lastTouchAt = 0;
    const onDown = (e) => {
      if (e.pointerType === "touch" || e.pointerType === "pen") { touchActive = true; lastTouchAt = performance.now(); }
      else touchActive = false;
    };
    const onUp = () => { touchActive = false; };
    const onCtx = (e) => {
      const dragging = !!document.body.dataset.dragKind;
      const recentDrag = window.__moduliDragEndAt && performance.now() - window.__moduliDragEndAt < 700;
      const touchOriginated = touchActive || performance.now() - lastTouchAt < 1200;
      if (dragging || recentDrag || touchOriginated) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    document.addEventListener("contextmenu", onCtx, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      document.removeEventListener("contextmenu", onCtx, true);
    };
  }, []);
  // activeCell / zoomedOut live in state/activeCellStore, NOT here. Holding them
  // in App state meant every rail tap re-rendered the ROOT component by
  // definition — that is the ~450ms block, and no amount of memoisation below
  // App can avoid it. Components that need the value subscribe to the store.
  const [gridSwitchRetrying, setGridSwitchRetrying] = useState(false);

  // Multi-select state (shift+click selection, bulk actions). Lives at App
  // level so it persists across panel re-renders + is reachable from any
  // descendant via SelectionContext.
  const selection = useSelectionProvider();
  // ESC clears the multi-select set FIRST when something is selected, so
  // existing ESC consumers (CommandCenter, history dialog, RadialMenu)
  // still fire when there's no selection in flight.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (selection.count === 0) return;
      const tgt = e.target;
      const tag = tgt?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tgt?.isContentEditable) return;
      e.preventDefault();
      e.stopPropagation();
      selection.clear();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [selection]);

  // GET_USER_INPUT modal — operationsBridge.requestUserInput resolves to a
  // Promise that the user satisfies via this modal. Chained inputs queue:
  // each pending entry is { request, resolve, reject }. We always show the
  // head of the queue.
  const [inputQueue, setInputQueue] = useState([]);
  useEffect(() => {
    operationsBridge.requestUserInput = (request) =>
      new Promise((resolve, reject) => {
        setInputQueue((q) => [...q, { request, resolve, reject }]);
      });
    return () => { operationsBridge.requestUserInput = null; };
  }, []);
  const currentInput = inputQueue[0] || null;
  const handleInputSubmit = useCallback((value) => {
    setInputQueue((q) => {
      const [head, ...rest] = q;
      head?.resolve?.(value);
      return rest;
    });
  }, []);
  const handleInputCancel = useCallback(() => {
    setInputQueue((q) => {
      const [head, ...rest] = q;
      head?.reject?.(new Error("USER_INPUT_CANCELLED"));
      return rest;
    });
  }, []);

  // CS6b — Load persisted CSS token overrides on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("moduli-token-overrides") || "{}");
      const entries = Object.entries(saved).filter(([, v]) => v?.trim());
      if (entries.length === 0) return;
      let tag = document.getElementById("moduli-token-overrides");
      if (!tag) { tag = document.createElement("style"); tag.id = "moduli-token-overrides"; document.head.appendChild(tag); }
      tag.textContent = `:root { ${entries.map(([k, v]) => `${k}: ${v};`).join(" ")} }`;
    } catch {}
  }, []);

  // onUndoAnimation: called by useUndoRedo when undo_result arrives with move_back ops
  // By this point positions are captured (captureAllPositions called in undoWithCapture below)
  // sync_state has been queued but not yet processed; 100ms is enough for React to re-render
  const onUndoAnimation = useCallback((moveOps) => {
    const ids = moveOps.map(op => op.occurrenceId);
    setTimeout(() => {
      animateToNewPositions(ids).then(() => ids.forEach(flashElement));
    }, 100);
  }, [animateToNewPositions, flashElement]);

  const { canUndo, canRedo, undo: _undo, redo, isProcessing } = useUndoRedo(
    socket,
    state.grid?._id,
    onUndoAnimation
  );

  // Wrap undo to capture all occurrence positions BEFORE state changes
  const undo = useCallback(() => {
    captureAllPositions();
    _undo();
  }, [captureAllPositions, _undo]);

  // Global keyboard shortcuts for undo/redo (Ctrl+Z, Ctrl+Y)
  useKeyboardShortcuts({
    onUndo: undo,
    onRedo: redo,
    enabled: !isProcessing,
  });

  // Filter system — reads directly from grid state (no local copy needed — grid is source of truth)

  // Legacy filterNavState NavigationOp (for occurrences still using the old filters[] system)
  useEffect(() => {
    const prev = prevFilterNavRef.current;
    const curr = state.filterNavState || {};

    // First hydration of filterNavState — sync the ref and skip the fire.
    // The matching onLoad pass already runs ops once on full_state arrival;
    // firing NavigationOp here too would run every onFilterChange-triggered op
    // a second time on every reload (and create duplicate sweep targets).
    if (!filterNavInitializedRef.current) {
      if (Object.keys(curr).length > 0) filterNavInitializedRef.current = true;
      prevFilterNavRef.current = curr;
      return;
    }

    const changed = Object.entries(curr).filter(([id, val]) => {
      if (!val || typeof val !== "string") return false;
      if (isNaN(Date.parse(val))) return false;
      return val !== prev[id];
    });

    if (changed.length > 0) {
      const date = changed[0][1];
      operationsBridge.fireOperations?.("NavigationOp", {
        type: "NavigationOp",
        activeFilterValues: curr,
        date,
      });
    }

    prevFilterNavRef.current = curr;
  }, [state.filterNavState]);

  useEffect(() => {
    const unbind = bindSocketToStore(socket, dispatch, stateRef);

    const token = localStorage.getItem("moduli-token");
    if (!token) return () => unbind?.();

    // Re-requests on every RECONNECT, not once per mount — a reconnect that
    // asks for nothing leaves any burst the server dropped dropped, which is
    // the daily half-built schedule (see helpers/fullStateRequest.js).
    const unbindRequest = bindFullStateRequest(
      socket,
      () => localStorage.getItem("moduli-gridId"),
    );

    return () => {
      unbindRequest();
      unbind?.();
    };
  }, [dispatch]);

  // BroadcastChannel: respond to preview iframes requesting state
  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const bc = new BroadcastChannel("moduli-preview");
    bc.onmessage = (e) => {
      if (e.data?.type === "REQUEST_STATE") {
        const s = stateRef.current;
        bc.postMessage({
          type: "PREVIEW_STATE",
          payload: {
            userId: s.userId, gridId: s.gridId, grid: s.grid,
            modules: s.modules || [],
            occurrences: s.occurrences || [],
            instances: s.instances || [],
            containers: s.containers || [],
            panels: s.panels || [],
            views: s.views || [],
            manifests: s.manifests || [],
            folders: s.folders || [],
            fields: s.fields || [],
            operations: s.operations || [],
            pages: s.pages || [],
            computedValues: s.computedValues || {},
          },
        });
      }
    };
    return () => bc.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGridChange = (e) => {
    const newGridId = e.target.value;
    if (!newGridId || newGridId === state.gridId) return;

    dispatch({ type: ActionTypes.SET_GRID_ID, payload: newGridId });
    localStorage.setItem("moduli-gridId", newGridId);

    socket.emit("request_full_state", { gridId: newGridId });
  };

  // "Add new grid" used to clear the stored gridId and re-request state — which
  // MINTS nothing. `request_full_state` only creates a grid for a user who has
  // NONE (state.js); otherwise it falls back to the default-flagged or oldest
  // grid, so on any account with at least one grid the button silently reloaded
  // the grid you were already on. Measured on a fresh account 2026-08-18: same
  // label, same gridId, before and after.
  //
  // It mints for real now, through the `create_grid` handler the server already
  // had. The switch waits for the server's OWN acknowledgement rather than
  // firing request_full_state straight after the emit: socket.io preserves
  // message order but each handler awaits, so the state request can reach
  // Grid.findOne before the upsert lands — and a miss there falls back to the
  // OLD grid, which is exactly the bug wearing a new hat. Same race the
  // create_page/apply_template work documented on 2026-08-03.
  const handleCreateNewGrid = () => {
    // A Grid's `_id` is a Mongo ObjectId, so this has to be 24 hex characters —
    // a UUID fails to cast and the upsert throws. Same shape Mongo would mint:
    // a 4-byte timestamp followed by 8 random bytes.
    const hex = (n) => Array.from({ length: n }, () =>
      Math.floor(Math.random() * 16).toString(16)).join("");
    const newGridId =
      Math.floor(Date.now() / 1000).toString(16).padStart(8, "0") + hex(16);

    const onCreated = (payload = {}) => {
      const grid = payload.grid || payload;
      const id = String(grid?.id || grid?._id || "");
      if (id !== newGridId) return;
      socket.off("grid_created", onCreated);
      clearTimeout(timer);
      dispatch({ type: ActionTypes.SET_GRID_ID, payload: newGridId });
      localStorage.setItem("moduli-gridId", newGridId);
      socket.emit("request_full_state", { gridId: newGridId });
    };
    // If the ack never arrives, say so rather than leaving a dead button.
    const timer = setTimeout(() => {
      socket.off("grid_created", onCreated);
      toast.error("Could not create the grid — the server did not confirm it.");
    }, 10000);

    socket.on("grid_created", onCreated);
    socket.emit("create_grid", { grid: { id: newGridId, rows: 1, cols: 1, name: "" } });
  };

  // Grid-switch retry: if the requested grid hasn't arrived after 8s
  // (e.g. server Mongo timeout swallowed the request_full_state), re-emit
  // and show "Retrying..." under the overlay spinner. Repeats every 8s
  // until state.grid._id catches up to state.gridId.
  const isSwitchingGrid =
    !!state.gridId && !!state.grid?._id && state.gridId !== state.grid._id;
  useEffect(() => {
    if (!isSwitchingGrid) {
      setGridSwitchRetrying(false);
      return;
    }
    const targetGridId = state.gridId;
    const id = setInterval(() => {
      setGridSwitchRetrying(true);
      socket.emit("request_full_state", { gridId: targetGridId });
    }, 8000);
    return () => clearInterval(id);
  }, [isSwitchingGrid, state.gridId]);

  // Restore this grid's saved cell. Imperative — the store persists on write,
  // so App neither holds the value nor re-renders when it changes.
  useEffect(() => {
    if (!state.gridId) return;
    initActiveCellForGrid(state.gridId, state.grid?.rows ?? 1, state.grid?.cols ?? 1);
  }, [state.gridId, state.grid?.rows, state.grid?.cols]);

  // (persistence moved into activeCellStore.setActiveCell)


  const addNewPanel = useCallback((kind = "board") => {
    if (!state.gridId || !state.grid || !state.userId) return;

    const moduleId = crypto.randomUUID();
    const { row, col } = findNextOpenPosition(
      state.panels || [],
      state.grid.rows ?? 1,
      state.grid.cols ?? 1
    );

    const panelNumber = (state.panels?.length || 0) + 1;
    const kindLabels = { board: "Board", notebook: "Notebook", doc: "Doc", mixed: "Mixed" };

    // Module with role: "panel"
    const module = {
      id: moduleId,
      role: "panel",
      kind,
      label: `${kindLabels[kind] || "Panel"} ${panelNumber}`,
      occurrences: [],
      layout: {},
    };

    // Use occurrence-based helper: creates module + occurrence + adds to grid
    const result = LayoutHelpers.createPanelInGrid({
      dispatch,
      socket,
      grid: state.grid,
      panel: module,
      placement: { row, col, width: 1, height: 1 },
      userId: state.userId,
      emit: true,
    });

    // Open the new panel on the ROOT FOLDER page (the card grid of everything
    // on the grid) — same default as the empty-cell tap-to-add, so a fresh
    // panel is never a dead "No content" shell (user directive 2026-07-11).
    if (result?.occurrence?.id) {
      openPanelOnRootFolderPage({
        panelOccId: result.occurrence.id, grid: state.grid, gridId: state.gridId,
        manifestsById, occurrencesById, modulesById, dispatch, socket, userId: state.userId,
      });
    }
  }, [dispatch, state.gridId, state.grid, state.panels, state.userId, manifestsById, occurrencesById, modulesById, socket]);

  const addContainerToPanel = useCallback(
    (panelId, kind = "board") => {
      if (!panelId || !state.gridId || !state.userId) return;

      const id = crypto.randomUUID();
      const kindLabels = { list: "List", doc: "Doc", log: "Log", smart: "Smart" };
      const label = `${kindLabels[kind] || "List"} ${(state.containers?.length || 0) + 1}`;
      // Module with role: "container"
      const module = { id, role: "container", label, kind, occurrences: [] };

      const panel = (state.panels || []).find((p) => p.id === panelId);
      if (!panel) return;

      // Find the panel occurrence so createContainerInPanel can update ordering
      const panelOcc = Object.values(occurrencesById || {}).find(o => o.moduleId === panelId);

      // Use the occurrence-based helper which creates module + occurrence + adds to panel
      LayoutHelpers.createContainerInPanel({
        dispatch,
        socket,
        gridId: state.gridId,
        panel: panelOcc ? { ...panel, _occurrence: panelOcc } : panel,
        container: module,
        userId: state.userId,
        emit: true,
      });
    },
    [dispatch, state.gridId, state.userId, state.containers, state.panels, socket]
  );

  // Use occurrence-based creation with userId.
  // Optional second arg `{ fieldIds }` pre-binds those fields onto the new
  // module — used by QuickAddMenu's "New X" field picker so the user can
  // attach a starter set of fields before creation.
  // Identity-STABLE: reads everything from stateRef at call time. It used to
  // depend on state.instances/state.containers/occurrencesById — all rebuilt
  // per occurrence write — so its identity churned on every write and
  // re-rendered every ModuleInstance/ModuleContainer that takes it as a
  // prop/selector (~90 renders per drop, measured via __RENDER_ATTR).
  const addInstanceToContainer = useCallback(
    (containerId, opts) => {
      const s = stateRef.current;
      if (!containerId || !s.gridId || !s.userId) return;
      const fieldIds = Array.isArray(opts?.fieldIds) ? opts.fieldIds : [];

      const id = crypto.randomUUID();
      const label = `Item ${(s.instances?.length || 0) + 1}`;
      // Module with role: "instance". Pre-bind the fields the picker carried —
      // which since 2026-08-21 are seeded from what the destination's existing
      // rows bind, so "add an ingredient" arrives wearing the ingredient fields.
      //
      // `opts.fieldBindings` WINS over `fieldIds` because it carries each
      // binding's ROLE. A sibling's `display` field must land as a display
      // binding; flattening it to "input" gives the new row a typable box where
      // its neighbours show a value an operation writes.
      const fieldBindings = normalizeFieldBindings({
        fieldBindings: opts?.fieldBindings, fieldIds, hidden: true });
      // NO `kind`. It is the sub-type WITHIN a role and is inert on an instance
      // leaf — and `getModuleTypeIcon` resolves kind BEFORE role, so the
      // `kind: "board"` this line used to carry drew the BOARD icon on every row
      // "+ Item" ever created. Fixed at `createLeafInstanceAtIndex` on
      // 2026-07-29 and at the seed before that; this was the third call site,
      // and it is the one the container header actually uses.
      const module = { id, role: "instance", label, fieldBindings };

      const container = (s.containers || []).find((c) => c.id === containerId);
      if (!container) return;

      // Find the container occurrence so createInstanceInContainer can update ordering
      const containerOcc = (s.occurrences || []).find(o => o.moduleId === containerId);

      // Use the occurrence-based helper which creates module + occurrence + adds to container
      LayoutHelpers.createInstanceInContainer({
        dispatch,
        socket,
        gridId: s.gridId,
        container,
        containerOccurrence: containerOcc || null,
        instance: module,
        userId: s.userId,
        // Values typed in the add menu's value step, if the user went through it.
        fields: opts?.initialFields || null,
        emit: true,
      });
      // Open the new item's label editor focused so it can be named right away.
      requestLabelEdit(id);
    },
    [dispatch, socket]
  );


  // Field CRUD handlers (grid-level field management)
  const createField = useCallback((field) => {
    const gridId = state?.gridId || state?.grid?._id;
    if (!gridId || !state.userId) return;
    const fieldWithGrid = { ...field, gridId, userId: state.userId };
    CommitHelpers.createField({ dispatch, socket, field: fieldWithGrid });
  }, [dispatch, socket, state?.gridId, state?.grid?._id, state.userId]);

  const updateField = useCallback((field) => {
    CommitHelpers.updateField({ dispatch, socket, field });
  }, [dispatch, socket]);

  const deleteField = useCallback((fieldId) => {
    CommitHelpers.deleteField({ dispatch, socket, fieldId });
  }, [dispatch, socket]);

  const dataValue = useMemo(
    () => ({
      // Raw state - components use lookups from context (occurrencesById, instancesById, containersById)
      state: {
        userId: state.userId,
        gridId: state.gridId,
        grid: state.grid,
        modules: state.modules || [],
        panels: state.panels || [],
        containers: state.containers || [],
        instances: state.instances || [],
        occurrences: state.occurrences || [],
        fields: state.fields || [],
        activeId: state.activeId,
        activeSize: state.activeSize,
        softTick: state.softTick,
        containersById,
        panelsById: buildLookup(state.panels),
      },
    }),
    [
      state.userId,
      state.gridId,
      state.grid,
      state.modules,
      state.panels,
      state.containers,
      state.instances,
      state.occurrences,
      state.fields,
      state.activeId,
      state.activeSize,
      state.softTick,
      containersById,
    ]
  );

  const panelsById = useMemo(
    () => buildLookup(state.panels),
    [state.panels]
  );

  const pagesById = useMemo(
    () => buildLookup(state.pages),
    [state.pages]
  );

  // Stable NON-subscribing getters for callback-time / rare-path reads of the
  // per-write-rebuilt maps. Components that only need a map inside an event
  // handler (bulk delete, drop resolution, popup content) use these instead of
  // subscribing to the whole map — subscribing made every container/instance
  // re-render on every occurrence write (the multi-second drop pause).
  const lookupsRef = useRef({});
  lookupsRef.current = { occurrencesById, modulesById, parentByChildId, linkedGroupIndex, state, fieldsById };
  const getOcc = useCallback((id) => (id ? lookupsRef.current.occurrencesById?.[id] || null : null), []);
  const getMod = useCallback((id) => (id ? lookupsRef.current.modulesById?.[id] || null : null), []);
  const getOccMap = useCallback(() => lookupsRef.current.occurrencesById || {}, []);
  const getModMap = useCallback(() => lookupsRef.current.modulesById || {}, []);
  // Read at CALLBACK time like the maps above. `occurrenceUrl` needs it to rank
  // url-ish field NAMES, and the row menus must not subscribe to it.
  const getFieldMap = useCallback(() => lookupsRef.current.fieldsById || {}, []);
  const getParentId = useCallback((id) => (id ? lookupsRef.current.parentByChildId?.[id] || null : null), []);
  const getLinkedGroup = useCallback((groupId) => (groupId ? lookupsRef.current.linkedGroupIndex?.[groupId] || [] : []), []);
  const getState = useCallback(() => lookupsRef.current.state || {}, []);

  const actionsValue = useMemo(
    () => ({
      socket,
      dispatch,
      getOcc,
      getMod,
      getOccMap,
      getModMap,
      getFieldMap,
      getParentId,
      getLinkedGroup,
      getState,

      // Full state object for calculations
      state,

      modulesById,
      instancesById,
      artifactsById,
      textblocksById,
      leafModulesById,
      occurrencesById,
      // Narrow reactive key for option-pool resolution — see
      // helpers/optionPoolKey.js. Subscribing to this instead of the grid-wide
      // occurrence count is what stops a drop re-resolving every dropdown.
      optionPoolKey,
      linkedGroupIndex,
      childrenByParentId,
      occurrencesByModuleId,
      parentByChildId,
      containersById,
      fieldsById,
      pagesById,
      panelsById,
      manifestsById,
      viewsById,
      foldersById,
      operationsById,
      addContainerToPanel,
      addInstanceToContainer,
      // Panel creation. The toolbar's + button is gone (2026-07-26); empty grid
      // cells are the primary way in, and the panel right-click menu carries
      // this for MOSAIC grids, which have no empty cells at all.
      addNewPanel,
      // Field CRUD
      createField,
      updateField,
      deleteField,
      // Filter nav (ephemeral, per-component)
      filterNavState: state.filterNavState || {},
    }),
    [
      dispatch,
      getOcc, getMod, getOccMap, getModMap, getFieldMap, getParentId, getLinkedGroup, getState,
      // Granular state deps — deliberately excludes state.computedValues
      // so that frequent computedValues changes (via GridLiveContext) don't
      // force all GridActionsContext consumers to re-render.
      state.grid, state.occurrences, state.containers, state.instances,
      state.fields, state.modules, state.panels, state.pages,
      state.artifacts, state.textblocks,
      state.userId, state.gridId, state.activeId, state.softTick,
      state.filterNavState,
      modulesById,
      instancesById,
      artifactsById,
      textblocksById,
      leafModulesById,
      occurrencesById,
      // Narrow reactive key for option-pool resolution — see
      // helpers/optionPoolKey.js. Subscribing to this instead of the grid-wide
      // occurrence count is what stops a drop re-resolving every dropdown.
      optionPoolKey,
      linkedGroupIndex,
      childrenByParentId,
      occurrencesByModuleId,
      parentByChildId,
      containersById,
      fieldsById,
      pagesById,
      panelsById,
      manifestsById,
      viewsById,
      foldersById,
      operationsById,
      addContainerToPanel,
      addInstanceToContainer,
      addNewPanel,
      createField,
      updateField,
      deleteField,
    ]
  );

  // computedValues fan out through the per-key subscription store — NOT via
  // context. Riding on GridLiveContext meant every SET_COMPUTED_VALUES swap
  // re-rendered every consumer (all fields/instances/panels/pages), several
  // waves per drop. useLayoutEffect so subscribers commit pre-paint.
  useLayoutEffect(() => {
    publishComputedValues(state.computedValues || {});
  }, [state.computedValues]);

  // activeCell / zoomedOut fan out through their own subscription store — NOT
  // via GridLiveContext. ModulePanel and ModulePage read that context with a
  // PLAIN useContext, so a new value bypasses their React.memo and re-renders
  // every panel, page, container and instance row. They only ever read
  // isMobileLayout / isTouch / fullStateLoaded, which never change — but riding
  // activeCell alongside them meant one rail tap rebuilt the whole grid, which
  // is the delay before the destination cell paints (2026-08-04, Samsung A15).
  // The slider transform was already immediate (2026-07-27, 0.9ms); this is the
  // half that was left. Same remedy as computedValues directly above.

  // C4: Frequently-changing values in separate context — only consumers
  // that need undo/mobile state subscribe here
  const liveValue = useMemo(
    () => ({
      fullStateLoaded: state.fullStateLoaded ?? false,
      canUndo,
      canRedo,
      undo,
      redo,
      isProcessing,
      isTouch,
      isMobileLayout,
      // activeCell / zoomedOut and their setters all live in
      // state/activeCellStore now — nothing navigation-related touches this
      // context, so a cell change cannot invalidate it.
    }),
    [
      state.fullStateLoaded,
      canUndo,
      canRedo,
      undo,
      redo,
      isProcessing,
      isTouch,
      isMobileLayout,
    ]
  );

  if (!state.userId) return <LoginScreen />;

  return (
    <GridActionsContext.Provider value={actionsValue}>
      <GridLiveContext.Provider value={liveValue}>
      <GridDataContext.Provider value={dataValue}>
      <SelectionContext.Provider value={selection}>
        {/* ── Header wrapper — relative so CommandCenter can overlay grid below ── */}
        <div style={{ position: "relative", flexShrink: 0, zIndex: 1050 }}>
        <Toolbar
          gridId={state.gridId}
          availableGrids={state.availableGrids || []}
          onGridChange={handleGridChange}
          onCreateNewGrid={handleCreateNewGrid}
          grid={state?.grid}
          fieldsById={fieldsById}
          onUndo={undo}
          canUndo={canUndo}
          undoBusy={isProcessing}
          onCommandCenter={() => setCommandCenterOpen((prev) => !prev)}
          commandCenterOpen={commandCenterOpen}
          onHistory={() => setHistoryOpen((prev) => !prev)}
          historyOpen={historyOpen}
          userId={state.userId}
          userEmail={state.userEmail}
          onLogout={() => { socket?.emit("logout"); dispatch(logoutAction()); }}
          isMobileLayout={isMobileLayout}
        />

        {/* CommandCenter — keep mounted once opened so slide-up animation works on close */}
        {commandCenterEverOpened && (
          <React.Suspense fallback={null}>
            <CommandCenter
              open={commandCenterOpen}
              onOpenChange={setCommandCenterOpen}
              isMobileLayout={isMobileLayout}
            />
          </React.Suspense>
        )}
        </div>{/* end header wrapper */}

        {/* Transaction History Dialog */}
        <TransactionHistory
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          gridId={state.gridId}
        />

        {/* Jarvis — bottom-right floating chat. See docs/assistant-guide.md. */}
        <AssistantDrawer />
        {/* Right-click on a text input → cut/copy/paste. ONE mount, listening on
            document capture, so no surface menu has to remember to bail. */}
        <TextContextMenu />

        {/* Clipboard hover-drop mode — only mounts listeners while the
            multi-select clipboard is non-empty. Lets the user click any
            container/page on the grid to paste, or Escape / right-click
            to clear. */}
        <ClipboardDropOverlay />

        {/* Shift+drag rubber-band multi-select. Document-level pointer
            listener; activates only past a 4-pixel threshold so a
            sub-threshold shift+click still goes to the existing toggle.
            Q key held = instance-only mode (≥ 1/3 overlap, containers
            excluded). Alt held = replace selection on release. */}
        <RubberBandSelector />

        <div data-testid="app-root" className={`app-root grid-frame bg-background2 shadow-inner ${isMobileLayout ? 'p-0 border-0 rounded-none ring-0' : 'p-3 ring-1 ring-black/40 rounded-xl border border-border'}`}
          style={{ position: "relative" }}
          onTouchStart={(ev) => {
            if (!commandCenterOpen) return;
            const startY = ev.touches[0].clientY;
            const onMove = (e) => {
              const dy = e.touches[0].clientY - startY;
              if (dy < -15) { setCommandCenterOpen(false); done(); }
            };
            const done = () => {
              window.removeEventListener("touchmove", onMove);
              window.removeEventListener("touchend", done);
            };
            window.addEventListener("touchmove", onMove, { passive: true });
            window.addEventListener("touchend", done, { passive: true });
          }}>
          {state.grid?._id ? (
            <Grid />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <Spinner size="xl" />
            </div>
          )}
          {isSwitchingGrid && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                background: "rgba(0, 0, 0, 0.45)",
                backdropFilter: "blur(2px)",
                zIndex: 900,
                pointerEvents: "auto",
              }}
            >
              <Spinner size="xl" />
              {gridSwitchRetrying && (
                <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, letterSpacing: 0.3 }}>
                  Retrying...
                </div>
              )}
            </div>
          )}
        </div>

        {/* Notifications render as the toolbar pill stack
            (ui/TransactionNotificationStack.jsx) — the single notification
            surface. The sonner Toaster was retired; every `toast.*` call now
            routes through state/notificationStore's adapter into the pills. */}

        {/* GET_USER_INPUT modal — only mounts when an op pipeline suspends
            via operationsBridge.requestUserInput. Chained questions render
            sequentially from the queue. */}
        <UserInputModal
          request={currentInput?.request}
          onSubmit={handleInputSubmit}
          onCancel={handleInputCancel}
        />

        {/* Image picker modal — single global host; call sites (occurrence
            dropdown rows, media-role field inputs, the artifact image
            viewer) open it imperatively via openImagePicker() so it
            survives their popovers unmounting. */}
        <ImagePickerHost />
        {/* The `address` field type's map search — same single-host reason as
            the image picker: it is opened from inside field popovers that
            unmount the moment focus leaves them. */}
        <AddressPickerHost />
        {/* Asks what a dropped/pasted payload should become. One host, because
            the callers are drop HANDLERS with nowhere to render a sheet. */}
        <IntakeSheetHost />
        {/* "Which of these?" — the tick-list an intake route opens once it has
            found something to ask about (following a link's links). Separate
            from the sheet because its list does not exist until a fetch has
            come back, and the sheet is closed before its callback runs. */}
        <ConfirmListHost />
        {/* Ctrl+V through the same classifier a drop uses. Its own host because
            a paste has no drop target — no pointer, and none of the five
            per-surface handlers is focused when the key is pressed. */}
        <IntakePasteHost />

        {/* Artifact spread — MOVED to `Grid.jsx`, INSIDE <DragProvider>.
            It is still one global host and still portals to <body>; it just
            has to be mounted where the drag context exists, or its tiles
            register as draggables and then hand every gesture to a no-op.
            Do not move it back up here without moving DragProvider with it. */}
      </SelectionContext.Provider>
      </GridDataContext.Provider>
      </GridLiveContext.Provider>
    </GridActionsContext.Provider>
  );
}