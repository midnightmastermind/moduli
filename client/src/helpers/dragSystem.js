// helpers/dragSystem.js
// ============================================================
// PRAGMATIC DRAG & DROP SYSTEM
// ============================================================
//
// PHILOSOPHY:
// - Components are DUMB - they just render UI
// - Drag/drop behavior is ATTACHED via hooks
// - All state flows through ONE coordinator (DragProvider)
//
// MOBILE: Touch-based drag replaces HTML5 DnD entirely.
// HTML5 DnD creates native OS-level drags that Samsung/Android
// intercept for split-screen. Touch events bypass the OS gesture
// system — no native drag = nothing to intercept.
//
// HOOKS:
// - useDroppable() - makes an element a drop target only
// - useDragDrop()  - makes an element draggable + drop target. Pass empty
//                    `accepts` to make it a pure drag source (drops on it
//                    pass through to the parent target).
//
// DROP ZONE MATRIX:
// ┌─────────────────┬────────────────────────────────────────┐
// │ Component       │ Accepts drops from                     │
// ├─────────────────┼────────────────────────────────────────┤
// │ GridCell        │ PANEL                                  │
// │ Panel (content) │ CONTAINER, INSTANCE, FILE, TEXT, URL   │
// │ Container (list)│ INSTANCE, FILE, TEXT, URL              │
// │ Instance        │ INSTANCE (for sorting)                 │
// └─────────────────┴────────────────────────────────────────┘

import { useEffect, useLayoutEffect, useRef, useState, useCallback, createContext, useContext } from "react";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { dropTargetForExternal } from "@atlaskit/pragmatic-drag-and-drop/external/adapter";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { dragPerf } from "./dragPerf";
// The op-fire hold. Imported from the bridge rather than threaded through the
// hook's arguments so a drag handle anywhere reaches it — the same surface
// DragProvider already uses for the drop batch.
import { operationsBridge } from "../state/bindSocketToStore";
import { hitInterval, blendCost } from "./hitTestBudget";
import { setDropOver, setDropEdge } from "./dropEdgeAttr";
// Touch-drag replaces HTML5 DnD on any coarse-pointer device (phone OR tablet),
// independent of orientation/layout. Width is irrelevant — a landscape tablet
// still needs finger dragging even while it shows the desktop grid.
// Inside the headset app (window.ModuliNative) the controller's trigger reaches a page as TOUCH, while the media
// query reads fine (the headset has no touchscreen) — so the touch path is the one that can drag there.
const _isTouch = () => window.matchMedia("(pointer: coarse)").matches || (typeof window !== "undefined" && !!window.ModuliNative);

const inHeadset = () => typeof window !== "undefined" && !!window.ModuliNative;

/** A pointer event dressed as the touch event the touch-drag handlers read (one point; touches + changedTouches). */
export function pointerAsTouch(e) {
  const pt = { clientX: e.clientX, clientY: e.clientY, identifier: e.pointerId };
  return {
    touches: e.type === "pointerup" || e.type === "pointercancel" ? [] : [pt],
    changedTouches: [pt],
    cancelable: e.cancelable,
    target: e.target,
    preventDefault: () => e.preventDefault(),
    stopPropagation: () => e.stopPropagation(),
    type: e.type,
  };
}

/**
 * IN THE HEADSET a held trigger is a LONG PRESS to the window's browser: ~0.5s in it fires `contextmenu` (the app's
 * right-click menu opened) and cancels the press, so every drag ended half a second in, still inside its window
 * (user, 2026-10-25: "the menu opens too with the drag … the drag stays in the window"). While a press on a drag
 * handle is down — and briefly after, since the menu can arrive just behind the release — `contextmenu` is swallowed
 * before the app's handlers see it.
 */
let _menuGuardUntil = 0;
let _menuGuardDown = false;
function _swallowMenu(e) {
  if (!_menuGuardDown && performance.now() > _menuGuardUntil) return;
  e.preventDefault();
  e.stopPropagation();
  console.log("[headsetDrag] long-press menu swallowed");
}
export function headsetMenuGuard(down) {
  if (typeof window === "undefined") return;
  if (!window.__moduliMenuGuard) { window.__moduliMenuGuard = true; window.addEventListener("contextmenu", _swallowMenu, true); }
  _menuGuardDown = down;
  if (!down) _menuGuardUntil = performance.now() + 600;
}

/**
 * Feed a non-touch pointer's press / move / release on `el` to the touch-drag handlers. The moves and the release are
 * heard on the WINDOW while pressed, so they keep coming once the pointer leaves the handle (a drag always does).
 * NOT pointer capture: capturing retargets the release to `el`, so the click lands on the handle's wrapper instead of
 * the menu button inside it and a plain tap stopped opening the radial menu. The touch handlers read
 * `touches.length === 1`, so an up event reports no touches. Returns the cleanup.
 */
export function bindPointerAsTouch(el, { onStart, onMove, onEnd }) {
  let active = null;
  const move = (e) => { if (e.pointerId === active) onMove(pointerAsTouch(e)); };
  const up = (e) => {
    if (e.pointerId !== active) return;
    active = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    onEnd(pointerAsTouch(e));
  };
  const down = (e) => {
    if (e.pointerType === "touch" || (e.button !== undefined && e.button !== 0)) return;
    active = e.pointerId;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    onStart(pointerAsTouch(e));
  };
  // A mouse press on an element can start the browser's own drag of it (or a text selection); neither is wanted.
  const noNative = (e) => { if (active != null) e.preventDefault(); };
  el.addEventListener("pointerdown", down);
  el.addEventListener("dragstart", noNative);
  el.addEventListener("selectstart", noNative);
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("dragstart", noNative);
    el.removeEventListener("selectstart", noNative);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
  };
}

/** A touch that ends this close to the window's edge has left the window (headset: the controller moved off the panel). */
export const LEAVE_EDGE_PX = 24;
export function leftThroughEdge(x, y, w, h, edge = LEAVE_EDGE_PX) {
  return x <= edge || y <= edge || x >= w - edge || y >= h - edge;
}

/** Tell the headset a drag started / ended in this window, so it can carry it into another window. */
function _nativeDrag(msg) {
  try { if (typeof window !== "undefined" && window.ModuliNative) window.ModuliNative.postMessage(JSON.stringify(msg)); } catch { /* not in the headset */ }
}

// Create a small pill element for mobile drag ghost — label on top, the action
// verb (Move / Copy / Copy-link) underneath, mirroring the desktop native ghost.
/** The pill a touch drag carries (exported for a drag carried in from another headset window). */
export function createDragPill(label, mode) { return _createDragPill(label, mode); }

function _createDragPill(label, mode) {
  const pill = document.createElement('div');
  Object.assign(pill.style, {
    position: 'fixed', left: '0', top: '0',
    maxWidth: '140px',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '11px',
    fontFamily: 'var(--font-mono, monospace)',
    color: '#fff',
    background: 'rgba(30,60,90,0.92)',
    border: '1px solid rgba(100,160,255,0.4)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    pointerEvents: 'none',
    zIndex: '2147483646',
    willChange: 'transform',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  });
  const title = document.createElement('div');
  title.textContent = label || 'item';
  Object.assign(title.style, { overflow: 'hidden', textOverflow: 'ellipsis' });
  const action = document.createElement('div');
  action.textContent = mode === 'copy' ? 'Copy' : mode === 'copylink' ? 'Copy-link' : 'Move';
  Object.assign(action.style, { fontSize: '9px', opacity: '0.7', letterSpacing: '0.02em' });
  pill.appendChild(title);
  pill.appendChild(action);
  return pill;
}

// ============================================================
// CONSTANTS & TYPES
// ============================================================
export const NATIVE_DND_MIME = "application/x-daytracker-dnd";

export const DragType = {
  PANEL: "panel",
  PAGE: "page",
  CONTAINER: "container",
  INSTANCE: "instance",
  MODULE: "module",     // CC module drag (all roles: panel/container/instance/page)
  ARTIFACT: "artifact",
  FOLDER: "folder",     // Tree folder drag (adds child docs as pages)
  OPERATION: "operation", // CC operation pill → instance (runnable widget)
  EXTERNAL: "external",
  FILE: "file",
  TEXT: "text",
  URL: "url",
};

// What each drop zone accepts
export const DropAccepts = {
  GRID_CELL: [DragType.PANEL, DragType.MODULE, DragType.INSTANCE, DragType.ARTIFACT, DragType.FOLDER, DragType.FILE, DragType.EXTERNAL],
  PANEL_CONTENT: [DragType.PAGE, DragType.CONTAINER, DragType.INSTANCE, DragType.MODULE, DragType.ARTIFACT, DragType.FOLDER, DragType.EXTERNAL, DragType.FILE, DragType.TEXT, DragType.URL],
  PAGE_CONTENT: [DragType.CONTAINER, DragType.INSTANCE, DragType.MODULE, DragType.ARTIFACT, DragType.FOLDER, DragType.EXTERNAL, DragType.FILE, DragType.TEXT, DragType.URL],
  CONTAINER_LIST: [DragType.INSTANCE, DragType.MODULE, DragType.ARTIFACT, DragType.EXTERNAL, DragType.FILE, DragType.TEXT, DragType.URL],
  // OPERATION is instance-only on purpose: `handleOperationDrop` binds the op
  // to an INSTANCE as a trigger widget, and there is nothing to bind it to on
  // an empty grid cell or a page. Without this entry `canAccept` declined
  // every operation drop before the app saw it — the native drop event still
  // fires, so the drag looked like it worked and wrote nothing.
  INSTANCE: [DragType.INSTANCE, DragType.MODULE, DragType.ARTIFACT, DragType.FILE, DragType.TEXT, DragType.URL, DragType.OPERATION],
};

// ============================================================
// DRAG CONTEXT (identity-STABLE — handlers/getters only, value created once
// by DragProvider). Safe for the hundreds of useDroppable/useDragDrop hooks:
// it never changes, so they never re-render or re-register because of it.
// ============================================================
const DragContext = createContext(null);

const NOOP_DRAG_CTX = {
  handleDragStart: () => {}, handleDragMove: () => {}, handleDragEnd: () => {},
  handleDrop: () => {}, handleDragOver: () => {},
  getActiveType: () => null,
  getStackForPanel: () => [], cyclePanelStack: () => {},
  setDropHighlight: () => {}, clearDropHighlight: () => {},
};

export function useDragContext() {
  const ctx = useContext(DragContext);
  return ctx || NOOP_DRAG_CTX;
}

export { DragContext };

// ============================================================
// DRAG STATE CONTEXT (reactive — flips at drag start/end + mode toggles).
// Subscribe ONLY where the render output depends on it (GridCell, ModulePanel);
// hot-path components use the body[data-drag-kind] CSS gating instead.
// ============================================================
const DragStateContext = createContext({
  activePayload: null, activeType: null, activeId: null, isDragging: false,
  dragMode: "move", isCopyMode: false, isMoveMode: true, isCopylinkMode: false,
  isPanelDrag: false, isPageDrag: false, isContainerDrag: false, isInstanceDrag: false, isExternalDrag: false,
});

export function useDragStateContext() {
  return useContext(DragStateContext);
}

export { DragStateContext };

// ============================================================
// DRAG HOT CONTEXT (changes during drag hover — hotTarget + panelOverCellId)
// Split out so container/instance components don't re-render on every crossing.
// ============================================================
const DragHotContext = createContext({ panelOverCellId: null });

export function useDragHotContext() {
  return useContext(DragHotContext);
}

export { DragHotContext };

// ============================================================
// WINDOW ID (for cross-window detection)
// ============================================================
export { getWindowId } from "./windowId.js";
import { getWindowId } from "./windowId.js";

// ============================================================
// PAYLOAD HELPERS
// ============================================================
// ============================================================
// SHARED: drag-preview ghost render
// ============================================================
// Single source of truth for the see-through card ghost that follows the
// cursor on drag. Used by useDragDrop so every
// module's preview reads identically — solid surface, border, shadow,
// regardless of the source element's own background.
function attachDragPreview(el, location, nativeSetDragImage, opts = {}) {
  // Build the preview FROM DATA (label + status) rather than cloning the source
  // element. Cloning produced an empty box: the source's children use
  // flex:1 / width:100% / min-width:0 and collapse once detached from their
  // layout, and source CSS hides handles/hover-only bits. A purpose-built card
  // always has content. The STATUS sits underneath the label in this SAME
  // element (it's the native drag image, so it tracks the cursor with zero lag —
  // no separate JS-followed pill that trails behind).
  const label = (opts.label != null && String(opts.label).trim()) || "item";
  const action = opts.action || (location?.initial?.input?.altKey ? "Copy" : "Move");
  setCustomNativeDragPreview({
    nativeSetDragImage,
    getOffset: () => ({ x: 12, y: 12 }),
    render: ({ container }) => {
      const card = document.createElement("div");
      Object.assign(card.style, {
        display: "inline-flex", flexDirection: "column", gap: "1px",
        maxWidth: "260px", padding: "5px 9px", borderRadius: "8px",
        // Less opaque than before (was 0.92) per request.
        background: "rgba(15, 25, 40, 0.62)",
        border: "1px solid rgba(120, 170, 220, 0.4)",
        boxShadow: "0 6px 18px rgba(0, 0, 0, 0.4)",
        fontFamily: "var(--font-mono, monospace)", color: "#e6eefc",
        pointerEvents: "none",
      });
      const title = document.createElement("div");
      title.textContent = label;
      Object.assign(title.style, {
        fontSize: "12px", fontWeight: "600",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "242px",
      });
      const status = document.createElement("div");
      status.textContent = action;
      Object.assign(status.style, { fontSize: "10px", opacity: "0.7", letterSpacing: "0.02em" });
      card.appendChild(title);
      card.appendChild(status);
      container.appendChild(card);
    },
  });
}

export function createPayload(type, id, data, context = {}) {
  return {
    type,
    id,
    data,
    context,
    // Normalized dragged-OCCURRENCE id — sources scatter it across shapes
    // (context.occurrenceId / data.occurrenceId / data.occurrence.id), so
    // hoist it to ONE top-level slot here. Consumers (DragProvider's
    // body-dataset stamp, Editor's drop guards) read this first; their
    // shape-probing fallbacks remain only for payloads built outside
    // createPayload (a few NodeView getInitialData sites).
    occurrenceId: context?.occurrenceId || data?.occurrenceId || data?.occurrence?.id || null,
    sourceWindowId: getWindowId(),
  };
}

/** The grid this window shows (a drag tells the window it lands in where it came from). */
export function currentGridIdForDrag() {
  try { const st = window.__moduli_state__; return st?.grid?._id || st?.gridId || null; } catch { return null; }
}

/** What a drag does, as its handle shows it: the row's own mode, else the piece's default, else move. */
export function dragModeOf(payload) {
  const d = payload?.data;
  return payload?.mode || d?.occurrence?.dragMode || d?.defaultDragMode || "move";
}

/** A marker type naming what is dragged — a window can read a drag's TYPES (not its data) while it hovers, so a
 *  target in another window can tell a container from a row before the drop (`canAcceptExternal`). */
export const DRAG_KIND_MIME_PREFIX = "application/x-moduli-kind-";
export function externalDragData(payload, extra = {}) {
  return {
    [NATIVE_DND_MIME]: serializePayload(payload),
    [DRAG_KIND_MIME_PREFIX + String(payload?.type || "item").toLowerCase()]: "1",
    ...extra,
  };
}

/** The dragged type a foreign drag carries, from its types alone, or null when it is not one of ours. */
export function externalDragKind(types) {
  const t = Array.from(types || []).find((x) => String(x).startsWith(DRAG_KIND_MIME_PREFIX));
  return t ? t.slice(DRAG_KIND_MIME_PREFIX.length) : null;
}

/** The payload a drop from outside this window hands the drop pipeline (a foreign drag has no session). */
export function externalSource(parsed) {
  return {
    type: parsed.type, id: parsed.id, data: parsed.data, context: parsed.context || {},
    occurrenceId: parsed.occurrenceId ?? null,
    mode: parsed.mode,
    fromOtherWindow: !!parsed.fromOtherWindow,
    isCrossWindow: !!parsed.isCrossWindow,
    sourceGridId: parsed.sourceGridId || null,
    sourceWindowId: parsed.sourceWindowId || null,
  };
}

/**
 * Whether a drop target takes a drag from outside this window. One of ours (from another window) is taken exactly as
 * it would be here — by the kind it names; anything else (files, text, links) as before.
 */
export function acceptsExternal(list, types) {
  if (!list?.length) return false;
  const kind = externalDragKind(types);
  if (kind) return list.includes(kind);
  return list.includes(DragType.INSTANCE) || list.includes(DragType.FILE) || list.includes(DragType.TEXT) ||
    list.includes(DragType.URL) || list.includes(DragType.EXTERNAL);
}

export function serializePayload(payload) {
  return JSON.stringify({
    mode: dragModeOf(payload),
    sourceGridId: currentGridIdForDrag(),
    v: 1,
    type: payload.type,
    id: payload.id,
    context: payload.context,
    data: payload.data, // Include full data object for complete copying
    occurrenceId: payload.occurrenceId ?? null,
    meta: { label: payload.data?.label || payload.data?.name || "" },
    sourceWindowId: payload.sourceWindowId,
  });
}

export function parseExternalDrop(source) {
  // Handle both native DataTransfer and Pragmatic's external source
  const isPragmaticSource = source && typeof source.getStringData === 'function';
  const types = Array.from(source?.types || []);

  // Helper to get data - works with both native and Pragmatic
  const getData = (type) => {
    if (isPragmaticSource) {
      return source.getStringData(type);
    }
    return source?.getData?.(type) || "";
  };

  // Check for our MIME first (cross-window)
  if (types.includes(NATIVE_DND_MIME)) {
    try {
      const raw = getData(NATIVE_DND_MIME);
      const parsed = JSON.parse(raw);
      return {
        type: parsed.type,
        id: parsed.id,
        data: parsed.data, // Extract the actual data object, not the entire wrapper
        context: parsed.context || {},
        // Round-trip the normalized dragged-occurrence id (createPayload
        // stamps it, serializePayload carries it) so cross-window payloads
        // keep the same top-level contract as same-window ones.
        occurrenceId: parsed.occurrenceId
          ?? (parsed.context?.occurrenceId || parsed.data?.occurrenceId || parsed.data?.occurrence?.id || null),
        // From another window SHOWING ANOTHER GRID. Another window on this grid holds the same rows, so its drop is
        // handled exactly like one made here (user, 2026-10-24: drag between windows like between browser tabs).
        isCrossWindow: parsed.sourceWindowId !== getWindowId() && !!parsed.sourceGridId && parsed.sourceGridId !== currentGridIdForDrag(),
        fromOtherWindow: parsed.sourceWindowId !== getWindowId(),
        sourceGridId: parsed.sourceGridId || null,
        sourceWindowId: parsed.sourceWindowId || null,
        mode: parsed.mode || "move",
        meta: parsed.meta, // Also pass through meta
      };
    } catch { /* fall through */ }
  }

  // Files - handle both native and Pragmatic
  let files = [];
  if (isPragmaticSource && source.items) {
    // Pragmatic external source
    files = source.items.filter(item => item.kind === 'file').map(item => item.getAsFile());
  } else if (source?.files) {
    // Native DataTransfer
    files = Array.from(source.files);
  }

  if (files.length > 0) {
    return {
      type: DragType.FILE,
      id: "__file__",
      data: { files, name: files[0]?.name },
      context: {},
      isCrossWindow: false,
    };
  }

  // URL
  if (types.includes("text/uri-list")) {
    return {
      type: DragType.URL,
      id: "__url__",
      data: { url: getData("text/uri-list") },
      context: {},
      isCrossWindow: false,
    };
  }

  // Text
  const text = getData("text/plain") || "";
  return {
    type: DragType.TEXT,
    id: "__text__",
    data: { text: text.slice(0, 200) },
    context: {},
    isCrossWindow: false,
  };
}

// ============================================================
// MOBILE TOUCH DRAG SYSTEM
// ============================================================
// On mobile, HTML5 Drag and Drop creates native OS-level drags that
// Samsung One UI / Android intercept for split-screen gestures.
// This touch-based system bypasses native DnD entirely:
// - touchstart/touchmove/touchend on drag handles
// - CSS-positioned clone follows the finger
// - elementFromPoint hit-testing for drop targets
// - No native drag event = nothing for the OS to intercept

const _TOUCH_THRESHOLD = 8; // px movement before drag starts
export const _TOUCH_HOLD_MS = 80;  // minimum hold time before drag activates
// How long a STATIONARY finger on the drag handle waits before the drag lifts
// on its own — the buzz, the pill, the session. Long enough not to fire during
// a tap (which is typically under 150ms and opens the radial menu), short
// enough to feel like a response rather than a wait. Below `_TOUCH_HOLD_MS`
// this would be unreachable, which a test pins.
//
// 220 -> 150 (user, 2026-09-02: "drop down the hold time for the drag"). The
// IMPOSED wait was never the whole story — `via=lift hold=1213ms` on 2026-09-02
// is a 220ms timer arriving a second late because the thread was blocked — but
// it is the half we control, and it is 70ms off every lift that is NOT starved.
//
// 150 is the floor this can take without eating taps: a finger that moves 8px
// starts the drag on its own after `_TOUCH_HOLD_MS`, so this timer only governs
// a finger held DELIBERATELY still, and a tap on the handle that reaches 150ms
// stationary is already a hold. Going lower starts competing with the radial
// menu the same gesture opens.
export const _TOUCH_LIFT_MS = 150;
const _HIT_TEST_INTERVAL = 32; // FLOOR between hit-tests; the real spacing is
                               // derived per drag from what one actually costs
                               // (helpers/hitTestBudget.js) — measured 0.6ms on
                               // Firefox and 17.8-30.3ms on Chrome for the SAME
                               // grid, so no single constant fits both.
const _HIT_CACHE_DIST = 4; // px — skip hit-test if pointer barely moved
// Set by the hit-test, read by dragPerf's per-move bucket. Diagnostic only.
let _lastOver = null;

// Global drop target registry — maps DOM elements to their drop config.
// Used by touch move handler to find drop targets via elementFromPoint.
const _dropRegistry = new Map();

// A RECT INDEX WAS TRIED HERE AND IS NOT COMING BACK — see CLAUDE.md
// 2026-09-01 (6). It read every registered target's rect once and scanned
// them instead of calling `document.elementsFromPoint` (12.9-13.6ms per
// hit-test on the tablet). Run in SHADOW against the engine on the real grid
// it disagreed on **50 of 123** hit-tests, and the cause is structural rather
// than fixable: `.insert-gap` is `margin: -2px 0; z-index: 3`, so it OVERLAPS
// the rows either side of it ON PURPOSE and wins on PAINT ORDER. A rect index
// can only order by DOM depth, and the gap is a SIBLING of the row — so it
// picks the row, wrongly, at every row boundary. Ordering by paint means
// re-implementing stacking contexts.
// It was not even faster: the scan measured 11ms against the engine's 10.3ms,
// because any scroll invalidates the rects and each rebuild is a forced layout
// over ~534 targets.

function _registerDrop(el, config) {
  _dropRegistry.set(el, config);
}

function _unregisterDrop(el) {
  _dropRegistry.delete(el);
}

// ============================================================
// DOC EDITOR TOUCH-DROP ZONES
// ============================================================
// Doc editors register their drop handler here for the TOUCH path. The editor's
// drop target is Pragmatic-only (never fires for our custom touch drags), and
// DragProvider's `.doc-editor` guard intentionally bails on doc drops (on
// desktop the editor's own target already handled them) — so without this
// bridge every doc drop was DEAD on touch: no wrap-beside/page-split, no embed
// insert or reorder. Keyed by the `.doc-editor` wrapper element; the handler
// receives ({ source, clientX, clientY }) with source shaped like a Pragmatic
// drop source ({ data: payload }).
/**
 * Make a handle-dragged element SELECTABLE at rest.
 *
 * Pragmatic's `draggable()` stamps `draggable="true"` on the element it
 * registers. **Firefox refuses to place a caret OR make a text selection
 * anywhere inside an element carrying the draggable attribute** — the whole
 * subtree reads as "maybe a drag" (the Gecko twin of Chromium's
 * `-webkit-user-drag` suppression, f2e89136). Symptoms, all reported by the
 * user in the order they were found: click-to-edit landing at offset 0
 * (2026-07-13), then "i cant highlight text at all inside textblocks so i
 * couldnt copy and paste it" (2026-08-01).
 *
 * Drag START is already gated to the HANDLE, so the element never needs to
 * advertise draggable AT REST. Disarm it; the handle's pointerdown re-arms both
 * the attribute (Firefox) and `-webkit-user-drag` (Chromium) just in time for a
 * real drag, and pointerup/dragend disarm again.
 *
 * Call this after EVERY `draggable()` registration that has a handle —
 * including direct Pragmatic calls in TipTap NodeViews, which do not go through
 * `useDragDrop` and so were missing it (that gap is what broke selection in
 * block textblocks). Re-running on re-registration is required: Pragmatic
 * re-asserts `draggable=true` and would otherwise leave it stuck on.
 *
 * @returns cleanup function
 */
export function disarmDraggableUntilHandle(el, handleEl) {
  if (!el || !handleEl) return () => {};
  const disarm = () => {
    el.draggable = false;
    el.style?.removeProperty?.("-webkit-user-drag");
  };
  disarm();
  const arm = () => {
    el.draggable = true;
    el.style?.setProperty?.("-webkit-user-drag", "element");
    const off = () => {
      disarm();
      window.removeEventListener("pointerup", off);
      window.removeEventListener("dragend", off);
    };
    window.addEventListener("pointerup", off);
    window.addEventListener("dragend", off);
  };
  handleEl.addEventListener("pointerdown", arm);
  return () => handleEl.removeEventListener("pointerdown", arm);
}

const _docTouchDropZones = new Map();

export function registerDocTouchDrop(el, fn) {
  _docTouchDropZones.set(el, fn);
  return () => _docTouchDropZones.delete(el);
}

export function getDocTouchDropZone(el) {
  // The drop may land on a textblock/cell SUB-editor's `.doc-editor` — those
  // never register. Climb to the nearest ANCESTOR editor that did register:
  // a nested doc-container editor (delegate-only zone) or the page editor.
  // Returns { el, fn } so callers can tell WHICH editor matched (the page
  // editor delegates drops whose nearest zone isn't itself).
  let cur = el;
  while (cur) {
    const fn = _docTouchDropZones.get(cur);
    if (fn) return { el: cur, fn };
    cur = cur.parentElement?.closest?.(".doc-editor") || null;
  }
  return null;
}

export function getDocTouchDrop(el) {
  return getDocTouchDropZone(el)?.fn || null;
}

// A doc's drop line for a TOUCH drag (a finger, or the headset's controller). A mouse drag paints it from the editor's
// own `dragover`; a touch drag fires none, so with no registered target under the point the editor under it is handed
// the point to paint the same line (Editor `paintDropAt`), and told when the drag moves off it or ends.
const _docTouchHovers = new Map();
let _docHoverFn = null;
export function registerDocTouchHover(el, fn) {
  _docTouchHovers.set(el, fn);
  return () => { _docTouchHovers.delete(el); if (_docHoverFn === fn) _docHoverFn = null; };
}
function _docHoverAt(x, y) {
  const target = document.elementFromPoint(x, y);
  // The innermost editor that paints its own lines: nested doc-container editors register too, sub-editors do not.
  let cur = target?.closest?.(".doc-editor") || null, fn = null;
  while (cur && !fn) { fn = _docTouchHovers.get(cur) || null; if (!fn) cur = cur.parentElement?.closest?.(".doc-editor") || null; }
  if (fn !== _docHoverFn) { _docHoverFn?.(null); _docHoverFn = fn; }
  fn?.({ x, y, target });
}
/** The drag left the docs or ended: take the doc's drop line down. */
export function clearDocTouchHover() { _docHoverFn?.(null); _docHoverFn = null; }

/**
 * One hover step of a touch drag at (x, y): light the registered target under it (its closest edge too) and tell
 * the drag controller where the pointer is (the insertion line, autoscroll). `target` may be passed when the caller
 * already hit-tested (it times that). Returns the new current target. Shared by a finger drag and a drag the headset
 * carries into this window from another one (ReaderApp), so both look and land the same.
 */
export function touchHoverStep({ x, y, payload, sourceEl = null, target, cur, dragCtx }) {
  const hit = target !== undefined ? target : _findDropTarget(x, y, payload?.type, sourceEl);
  if (hit?.el !== cur?.el) {
    cur?.stateRef?.current?.setIsOver?.(false);
    cur?.stateRef?.current?.setClosestEdge?.(null);
    cur = hit;
    hit?.stateRef?.current?.setIsOver?.(true);
  }
  // Optional chain is a shape difference, not a fallback: useDroppable entries register no edgesRef (no closest-edge
  // behavior), useDragDrop entries always do.
  const edges = cur?.edgesRef?.current;
  if (edges) cur.stateRef?.current?.setClosestEdge?.(_computeClosestEdge(cur.el, x, y, edges));
  dragCtx.handleDragMove(x, y);
  if (cur) { clearDocTouchHover(); dragCtx.handleDragOver?.({ type: cur.type, id: cur.id, context: cur.contextRef.current, clientX: x, clientY: y }); }
  else _docHoverAt(x, y);
  return cur;
}

/**
 * The drop of a touch drag at (x, y), decided at the release point: the registered target under it, else a doc
 * editor's touch zone (doc prose is not in the touch registry). `skip`: the drag left this window, nothing here
 * takes it. Clears the hovered target's highlight either way. Returns { dropped, docDropped }.
 */
export function touchDropStep({ x, y, payload, sourceEl = null, cur, dragCtx, skip = false }) {
  clearDocTouchHover();
  const target = skip ? null : _findDropTarget(x, y, payload?.type, sourceEl);
  if (target?.el !== cur?.el) {
    cur?.stateRef?.current?.setIsOver?.(false);
    cur?.stateRef?.current?.setClosestEdge?.(null);
  }
  if (target) {
    // A1: Haptic double-tap on successful drop
    if (navigator.vibrate) navigator.vibrate([8, 30, 8]);
    const endEdges = target.edgesRef?.current;
    const edge = endEdges ? _computeClosestEdge(target.el, x, y, endEdges) : null;
    target.stateRef?.current?.setIsOver?.(false);
    target.stateRef?.current?.setClosestEdge?.(null);
    dragCtx.handleDrop({
      type: target.type, id: target.id,
      context: { ...target.contextRef.current, instanceId: target.id, closestEdge: edge },
      clientX: x, clientY: y,
      source: payload,
      // Lets DragProvider's .doc-editor guard route the drop to the editor's touch handler (on desktop the editor's
      // own Pragmatic target already ran — touch has no equivalent).
      isTouchDrop: true,
    });
    return { dropped: true, docDropped: false };
  }
  // No registered target under the finger — but doc-editor prose isn't in the touch registry at all. Route drops
  // landing on a doc straight to the editor's touch handler (wrap-beside / embed insert).
  const docEl = skip ? null : document.elementFromPoint(x, y)?.closest?.(".doc-editor");
  const docZone = getDocTouchDrop(docEl);
  if (!docZone) return { dropped: false, docDropped: false };
  if (navigator.vibrate) navigator.vibrate([8, 30, 8]);
  docZone({ source: { data: payload }, clientX: x, clientY: y });
  return { dropped: true, docDropped: true };
}

/** The drag controller (DragProvider) of this window, for a drag the headset carries in from another window. */
let _windowDragCtx = null;
export function setWindowDragCtx(ctx) { _windowDragCtx = ctx; }
export function windowDragCtx() { return _windowDragCtx; }

function _computeClosestEdge(el, clientX, clientY, allowedEdges) {
  const rect = el.getBoundingClientRect();
  const distances = {
    top: Math.abs(clientY - rect.top),
    bottom: Math.abs(clientY - rect.bottom),
    left: Math.abs(clientX - rect.left),
    right: Math.abs(clientX - rect.right),
  };
  let closest = null;
  let minDist = Infinity;
  for (const edge of allowedEdges) {
    if (distances[edge] < minDist) {
      minDist = distances[edge];
      closest = edge;
    }
  }
  return closest;
}

function _findDropTarget(clientX, clientY, dragType, sourceEl) {
  // elementsFromPoint returns ALL elements at coordinates (top to bottom).
  // The drag clone has pointer-events:none but may still appear — it's
  // simply not in the registry, so walk-up from it finds nothing.
  //
  // SPLIT FOR ATTRIBUTION. The hit-test measured 13.5ms average and 120ms
  // worst on the user's tablet, every 32ms of a drag, and "drop points are
  // what is slow" is a reasonable reading of that — there is one registered
  // per container, per instance and per insert gap. But the registry lookup is
  // a Map.get per ancestor, and `elementsFromPoint` forces a hit-test over a
  // 20,416-node document: those are very different costs with very different
  // fixes, and the single number cannot tell them apart.
  const _e0 = performance.now();
  const elements = document.elementsFromPoint(clientX, clientY);
  const _e1 = performance.now();
  // WHAT IS UNDER THE FINGER, for dragPerf's per-move buckets. Read off the
  // stack this call already produced — an extra `elementFromPoint` per move
  // would add cost to the very thing being measured. Ordered most specific
  // first: a point over a row is inside a container too.
  _lastOver = (() => {
    const top = elements[0];
    if (!top) return "none";
    if (top.closest?.(".insert-gap")) return "gap";
    if (top.closest?.(".instance-wrap")) return "instance";
    if (top.closest?.(".container-list")) return "container-empty";
    if (top.closest?.(".container-shell")) return "container-chrome";
    if (top.closest?.("[data-panel-id]")) return "panel";
    return "other";
  })();
  for (const el of elements) {
    let node = el;
    while (node && node !== document.body) {
      if (node === sourceEl) { node = node.parentElement; continue; }
      const config = _dropRegistry.get(node);
      if (config) {
        const accepts = config.acceptsRef.current;
        if (accepts.length === 0 || accepts.includes(dragType)) {
          dragPerf.hitParts(_e1 - _e0, performance.now() - _e1, elements.length, _dropRegistry.size);
          return { el: node, ...config };
        }
      }
      node = node.parentElement;
    }
  }
  dragPerf.hitParts(_e1 - _e0, performance.now() - _e1, elements.length, _dropRegistry.size);
  return null;
}


// ============================================================
// useDroppable HOOK
// ============================================================
export function useDroppable({
  type,
  id,
  context = {},
  accepts = [],
  disabled = false,
  // HOVER AS A DOM ATTRIBUTE, for callers that do not READ `isOver`.
  //
  // The hook keeps `isOver` in state, so every hover crossing re-renders the
  // whole component whether or not anything reads the value. `ModuleContainer`
  // destructured it for its LIST target and never used it — and that showed up
  // as 1,681 container renders during a single drag on the user's tablet
  // (2026-09-01), attributed to `(none)`, meaning no tracked prop or
  // subscription changed: hook-internal state, invisible to a code review and
  // to the render probe alike.
  //
  // Opt-in, because `isOver` is a public return value — the same container's
  // HEADER target reads it to draw an insert affordance and must keep real
  // state.
  overAsAttribute = false,
}) {
  const ref = useRef(null);
  const dragCtx = useDragContext();
  const [isOverState, setIsOverState] = useState(false);
  const setIsOver = useCallback((v) => {
    if (overAsAttribute) setDropOver(ref.current, v); else setIsOverState(v);
  }, [overAsAttribute]);
  const isOver = overAsAttribute ? false : isOverState;

  // Stable ref for mobile touch system to update state
  const stateRef = useRef({ setIsOver });
  stateRef.current = { setIsOver };

  // Live refs — every handler reads these at EVENT time, so context/accepts
  // identity churn never tears down + re-registers the Pragmatic targets.
  const contextRef = useRef(context);
  contextRef.current = context;
  const acceptsRef = useRef(accepts);
  acceptsRef.current = accepts;
  const acceptsKey = accepts.join("|");

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    // Register in drop target registry (for mobile touch hit-testing)
    _registerDrop(el, { type, id, contextRef, acceptsRef, allowedEdges: null, stateRef });

    const canAccept = (source) => {
      // Empty accepts list = reject all drops. Lets pure drag sources
      // (panels, pages, canvas cards) register useDragDrop without
      // unintentionally swallowing drops meant for their parent target.
      const list = acceptsRef.current;
      if (list.length === 0) return false;
      const dragType = source?.data?.type;
      return list.includes(dragType);
    };

    const canAcceptExternal = (source) => acceptsExternal(acceptsRef.current, source?.types);

    const cleanup = combine(
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => canAccept(source),
        getData: () => ({ type, id, context: contextRef.current }),
        onDragEnter: ({ self, source }) => {
          if (canAccept(source)) {
            setIsOver(true);
          }
        },
        onDrag: ({ self, source, location }) => {
          const clientX = location.current.input.clientX;
          const clientY = location.current.input.clientY;
          dragCtx.handleDragOver?.({ type, id, context: contextRef.current, clientX, clientY });
        },
        onDragLeave: () => {
          setIsOver(false);
          // Clear container highlight when leaving. If pointer enters another container
          // immediately after, its onDrag fires handleDragOver and cancels the RAF clear.
          if (contextRef.current.containerId) {
            dragCtx.handleDragOver?.({ type, id, context: { ...contextRef.current, containerId: null } });
          }
        },
        onDrop: ({ self, source, location, nativeEvent }) => {
          setIsOver(false);
          const clientX = location.current.input.clientX;
          const clientY = location.current.input.clientY;
          const targetRect = el?.getBoundingClientRect?.();

          dragCtx.handleDrop({
            type,
            id,
            context: contextRef.current,
            clientX,
            clientY,
            targetRect,
            source: source.data,
            dataTransfer: nativeEvent?.dataTransfer,
          });
        },
      }),
      dropTargetForExternal({
        element: el,
        canDrop: ({ source }) => canAcceptExternal(source),
        getData: () => ({ type, id, context: contextRef.current }),
        onDragEnter: ({ source }) => {
          if (canAcceptExternal(source)) {
            setIsOver(true);
          }
        },
        onDrag: ({ location }) => {
          const clientX = location.current.input.clientX;
          const clientY = location.current.input.clientY;
          dragCtx.handleDragOver?.({ type, id, context: contextRef.current, clientX, clientY });
        },
        onDragLeave: () => {
          setIsOver(false);
          if (contextRef.current.containerId) {
            dragCtx.handleDragOver?.({ type, id, context: { ...contextRef.current, containerId: null } });
          }
        },
        onDrop: ({ location, source }) => {
          setIsOver(false);
          const clientX = location.current.input.clientX;
          const clientY = location.current.input.clientY;

          const parsed = parseExternalDrop(source);

          dragCtx.handleDrop({
            type,
            id,
            context: contextRef.current,
            clientX,
            clientY,
            source: externalSource(parsed),
            dataTransfer: source,
          });
        },
      })
    );

    return () => {
      cleanup();
      _unregisterDrop(el);
    };
  }, [type, id, acceptsKey, disabled, dragCtx]);

  return {
    ref,
    isOver,
    dropProps: {
      "data-droppable": "true",
      "data-drop-type": type,
      "data-drop-id": id,
    },
  };
}

// ============================================================
// useDragDrop HOOK (combined - for sortable items)
// ============================================================
export function useDragDrop({
  type,
  id,
  data = {},
  context = {},
  disabled = false,
  nativeEnabled = true,
  accepts = [],
  allowedEdges = ['top', 'bottom'], // Default to vertical (top/bottom), can be ['left', 'right'] for horizontal
  dragHandleRef = null, // optional ref — restricts drag start to that element
  // HOVER AS A DOM ATTRIBUTE INSTEAD OF REACT STATE.
  //
  // `isOver`/`closestEdge` exist to draw four 2px bars at the element's edges.
  // As React state, one hover crossing re-renders the WHOLE component — and
  // for `ModuleContainer` that is a 1,900-line component plus every row and
  // field it renders. Measured on the user's tablet during a single drag
  // (2026-09-01): 2,004-3,383 container renders, 225-248 instance renders, for
  // bars that CSS can toggle from an attribute at zero React cost.
  //
  // Opt-in rather than the default, because the returned values are a public
  // contract — `blocks/` and anything reading `isOver` for logic rather than
  // for a bar must keep getting real state.
  edgeAsAttribute = false,
}) {
  const ref = useRef(null);
  const dragCtx = useDragContext();
  const [isDragging, setIsDragging] = useState(false);
  const [isOverState, setIsOverState] = useState(false);
  const [closestEdgeState, setClosestEdgeState] = useState(null);

  // The attribute path writes the DOM and never touches state; the state path
  // is byte-identical to what it always was.
  const setIsOver = useCallback((v) => {
    if (edgeAsAttribute) setDropOver(ref.current, v); else setIsOverState(v);
  }, [edgeAsAttribute]);
  const setClosestEdge = useCallback((edge) => {
    if (edgeAsAttribute) setDropEdge(ref.current, edge); else setClosestEdgeState(edge);
  }, [edgeAsAttribute]);
  const isOver = edgeAsAttribute ? false : isOverState;
  const closestEdge = edgeAsAttribute ? null : closestEdgeState;
  // diag-only: last edge logged so onDrag doesn't spam every frame
  const lastDiagEdgeRef = useRef(null);

  // Stable ref for mobile touch system to update state
  const stateRef = useRef({ setIsOver, setClosestEdge });
  stateRef.current = { setIsOver, setClosestEdge };

  // Live refs (see useDroppable) — data can be KB-scale ({ ...module, occurrence }
  // with fields/textmap), so neither stringify-diffing it per render nor
  // re-registering listeners on every occurrence write is acceptable.
  const dataRef = useRef(data);
  dataRef.current = data;
  const contextRef = useRef(context);
  contextRef.current = context;
  const acceptsRef = useRef(accepts);
  acceptsRef.current = accepts;
  const edgesRef = useRef(allowedEdges);
  edgesRef.current = allowedEdges;
  const acceptsKey = accepts.join("|");
  const edgesKey = (allowedEdges || []).join("|");

  // Track the handle DOM node via state so the main effect re-runs when
  // the handle mounts/unmounts. Otherwise a ref whose .current is null at
  // first effect run (conditional render of the handle, e.g. page-panel
  // header rendered only once pagesList loads) leaves Pragmatic DnD
  // registered without dragHandle — making the entire panel draggable.
  //
  // COMPARE BEFORE SETTING. This effect runs after EVERY render of every row. A functional
  // setState that returns `prev` still QUEUES an update whenever the fiber has other work
  // pending, and each queued update in a layout effect is a synchronous re-render. A board of
  // hundreds of rows re-rendering during a search jump passed React's 50-nested-update limit
  // and crashed the panel (React #185, 2026-10-18: Bookmarks opened by search). Reading a ref
  // means an unchanged handle never calls setState at all.
  const [handleNode, setHandleNode] = useState(() => dragHandleRef?.current ?? null);
  const handleNodeRef = useRef(handleNode);
  handleNodeRef.current = handleNode;
  useLayoutEffect(() => {
    const current = dragHandleRef?.current ?? null;
    if (current !== handleNodeRef.current) {
      handleNodeRef.current = current;
      setHandleNode(current);
    }
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    const buildPayload = () => createPayload(type, id, dataRef.current, contextRef.current);
    const handleEl = handleNode;

    const canAccept = (source) => {
      // Empty accepts list = reject all drops. Lets pure drag sources
      // (panels, pages, canvas cards) register useDragDrop without
      // unintentionally swallowing drops meant for their parent target.
      const list = acceptsRef.current;
      if (list.length === 0) return false;
      const dragType = source?.data?.type;
      return list.includes(dragType);
    };

    const canAcceptExternal = (source) => acceptsExternal(acceptsRef.current, source?.types);

    // Register in drop target registry (for mobile touch hit-testing)
    _registerDrop(el, { type, id, contextRef, acceptsRef, edgesRef, stateRef });

    // ─── MOBILE: Touch drag + Pragmatic drop targets ───
    if (_isTouch()) {
      const triggerEl = handleEl || el;
      const prevTouchAction = triggerEl.style.touchAction;
      triggerEl.style.touchAction = 'none';

      let clone = null;
      let payload = null; // built at threshold-cross from the live refs
      let dragging = false;
      let startX, startY, offsetX, offsetY;
      let curTarget = null;
      let cachedRect = null;
      let touchStartTime = 0;
      let lastHitTestTime = 0;
      let lastHitX = 0, lastHitY = 0;
      // Rolling cost of one hit-test, and the spacing derived from it. Reset
      // per drag: the answer is a property of THIS grid on THIS device, and a
      // stale estimate from a cheap drag would under-space an expensive one.
      let hitCostMs = 0;
      let hitEveryMs = _HIT_TEST_INTERVAL;

      // ── LIFT-ON-HOLD ──────────────────────────────────────────────────────
      // User: *"theres still a pause between me holding it down and the buzz
      // and the preview showing up, still like a second."*
      //
      // It was never our startup cost. `_TOUCH_HOLD_MS` is 80ms, but the drag
      // could only begin from `onMove`, so nothing happened until the finger
      // travelled `_TOUCH_THRESHOLD` — the measured `hold` was max(80ms, time
      // until you move 8px), which is why captures read 903-3591ms and one
      // read exactly 80. Holding still, waiting for a buzz that could not
      // arrive, is the second they were describing.
      //
      // A timer lifts the drag with the finger stationary. Safe on THIS
      // surface specifically: the trigger is the drag handle, it carries
      // `touch-action: none` so a hold can never be a scroll, and
      // `useLongPress` explicitly skips `[data-dnd-handle]` — so nothing else
      // claims a hold here today.
      let liftTimer = null;
      let movedPastThreshold = false;
      let liftedByHold = false;
      let lastX = 0, lastY = 0;
      const clearLiftTimer = () => {
        if (liftTimer) { clearTimeout(liftTimer); liftTimer = null; }
      };

      // DID THE PAGE SCROLL WHILE THE FINGER WAS DOWN? The whole remaining
      // startup cost is created inside the hold window — `touchRect` measures
      // one forced layout at touchstart at 0.1ms, and the same flush ~1.4s
      // later costs ~1s. Two candidates, opposite fixes: the panel scrolling
      // under the finger (a repaint we inherit, and the same second as the
      // 08-31 "waiting for an entire repaint" report), or our own writes at
      // activation. A count of scroll events separates them and costs nothing
      // — a passive capture listener, no layout read, torn down at activation.
      let holdScrolls = 0;
      let holdScrollFn = null;
      const stopHoldScrollWatch = () => {
        if (!holdScrollFn) return;
        document.removeEventListener("scroll", holdScrollFn, true);
        holdScrollFn = null;
      };

      // ── ACTIVATION, REACHABLE FROM TWO PLACES ────────────────────────────
      // Extracted because the drag can now begin WITHOUT a movement — see the
      // lift timer in onStart. `cx/cy` is where the pill appears: the live
      // touch point when a movement started it, the last known one when the
      // hold did.
      const activateDrag = (cx, cy, via) => {
        stopHoldScrollWatch();
        // In the headset only what is INSIDE a page drags, not the page itself (user, 2026-10-25).
        if (inHeadset() && type === DragType.PAGE) return;
        // `via` separates the wait WE impose from the wait until the user moved.
        dragPerf.activate(holdScrolls, via);   // the wait is over; the work starts here
        dragPerf.mark("t0");
        dragging = true;
        // BEFORE ANY WRITE OF OURS. `f:htmlStyle` billed 955ms, but it was
        // the FIRST flush of the sequence, so it also paid for anything left
        // pending by the 1.6s hold window — and a first measurement that
        // absorbs everything before it is not an attribution. `touchRect`
        // says the page was clean when the finger LANDED (0.1ms); this says
        // whether it still was when the finger MOVED.
        //
        // Zero here means our own writes own the cost. ~950ms here means the
        // app dirtied the page during the hold and the drag merely pays for
        // it — a different problem, and one that would also explain the
        // drop's paint.
        dragPerf.flushMark("f:t0");
        // `documentElement.style.touchAction = 'none'` USED TO BE HERE AND
        // COST 903ms. Attributed by forced flush on the device, with the
        // property written immediately after it on the same element as the
        // control:
        //
        //     f:t0:0  f:touchAction:903  f:overscroll:3  f:bodyAttrs:45
        //     f:pill:4  f:barriers:3  f:setIsDragging:0  f:sessionState:0
        //
        // So it is not "writing to <html>" — it is `touch-action`
        // specifically, which makes Chrome rebuild the touch-action
        // hit-test regions for the whole document (21,282 nodes here). And
        // it was charged TWICE per drag: the reset on drag end is the same
        // invalidation again, inside the drop's ~1.7s paint.
        //
        // WHAT IT WAS FOR IS ALREADY COVERED, EARLIER, BY SOMETHING CHEAPER.
        // dragTouchGuards' header lists the three jobs: the gesture that
        // becomes a drag is claimed by `.module-drag-handle`'s CSS
        // `touch-action: none` before the touch begins; the dragging finger
        // cannot scroll because this file's own `touchmove` is non-passive
        // and calls preventDefault (touch events retarget to the element the
        // touch STARTED on, so it keeps receiving them wherever the finger
        // goes); and OS edge gestures are the edge barriers' job — four
        // fixed 40px divs with capture-phase preventDefault, spawned
        // SYNCHRONOUSLY at drag start for 3ms.
        //
        // The only window given up is a SECOND finger landing mid-screen
        // inside the first frame, before the document-level guards attach.
        // `overscroll-behavior` stays: it costs 3ms and stops pull-to-refresh.
        document.documentElement.style.overscrollBehavior = 'none';
        dragPerf.flushMark("f:overscroll");
        setIsDragging(true);
        dragPerf.flushMark("f:setIsDragging");

        // A1: Haptic feedback on drag start
        if (navigator.vibrate) navigator.vibrate(15);

        offsetX = 40;
        offsetY = 14;
        payload = buildPayload();
        dragPerf.mark("buildPayload");
        const liveData = dataRef.current;
        // Per-occurrence dragMode overrides entity's defaultDragMode
        const mode = liveData?.occurrence?.dragMode ?? liveData?.defaultDragMode ?? 'move';
        clone = _createDragPill(liveData?.label || liveData?.name || type, mode);
        clone.style.transform = `translate3d(${cx - offsetX}px, ${cy - offsetY}px, 0)`;
        document.body.appendChild(clone);
        dragPerf.flushMark("f:pill");
        lastHitX = cx; lastHitY = cy;
        lastHitTestTime = performance.now();
        hitCostMs = 0;
        hitEveryMs = _HIT_TEST_INTERVAL;

        dragCtx.handleDragStart(payload, startX, startY, { mode });
        // The headset carries the drag into another window: it needs the whole drag (that window runs its own drop
        // with it) and the pill's own words, so the label it floats in the room reads the same.
        _nativeDrag({ type: "dragStart", occId: payload?.occurrenceId || null, mode,
          label: clone?.firstChild?.textContent || "", action: clone?.lastChild?.textContent || "",
          payload: serializePayload({ ...payload, mode }) });
        if (inHeadset()) console.log("[headsetDrag] start", payload?.occurrenceId || null, mode);
        dragPerf.mark("handleDragStart");
        dragPerf.start({ label: liveData?.label || liveData?.name || type, mode });
      };

      const onStart = (e) => {
        if (e.touches.length !== 1) return;
        if (inHeadset()) headsetMenuGuard(true);
        // NO e.preventDefault() — triggerEl CSS touch-action:none handles OS gesture suppression
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        // TIMED, because this read forces a full style+layout flush and is the
        // only one that happens before the app has any drag state at all. See
        // dragPerf.touchStart — it is the witness for whether the ~1s the drag
        // pays at startup was already owed when the finger landed.
        // HOLD OPERATION FIRES FROM THE MOMENT THE FINGER LANDS, not from drag
        // activation. The hold DragProvider opens covers the DURING phase, and
        // the device says the remaining cost is the START:
        //
        //     [drag] 757ms "Sleep"  hold=603ms via=lift  paint=748ms
        //     moves=0  longTasks=4(706ms)  firstTask=270ms@1ms  sinceLoad=18523ms
        //
        // A 150ms lift timer arriving at 603ms is a blocked thread, and the pill
        // took 748ms to appear. Opening the hold here buys the whole lift window.
        // Released in `onEnd`, which every gesture reaches — a tap that opens the
        // radial menu included — and the hold caps itself regardless.
        operationsBridge.beginInteraction?.();
        const _rt0 = performance.now();
        cachedRect = el.getBoundingClientRect(); // Cache rect NOW while layout is fresh
        const _rectMs = performance.now() - _rt0;
        touchStartTime = performance.now();
        dragging = false;
        stopHoldScrollWatch();
        holdScrolls = 0;
        holdScrollFn = () => { holdScrolls++; };
        // Capture, because scroll does not bubble — a panel scrolling
        // internally is invisible to a listener on document without it.
        document.addEventListener("scroll", holdScrollFn, { capture: true, passive: true });
        // Before the hold delay and the movement threshold — without this the
        // 80ms we deliberately make the user wait is indistinguishable from
        // our own startup cost.
        dragPerf.touchStart(_rectMs);

        movedPastThreshold = false;
        liftedByHold = false;
        lastX = t.clientX; lastY = t.clientY;
        clearLiftTimer();
        liftTimer = setTimeout(() => {
          liftTimer = null;
          if (dragging) return;
          liftedByHold = true;
          stopHoldScrollWatch();
          activateDrag(lastX, lastY, "lift");
        }, _TOUCH_LIFT_MS);
      };

      const onMove = (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        // BEFORE every early return — the lift timer fires with no event of
        // its own and puts the pill wherever the finger was last seen.
        lastX = t.clientX; lastY = t.clientY;

        // ONE definition of "the finger moved", shared by both paths.
        //
        // This used to be set only on the pre-activation branch below — so a
        // drag begun by the LIFT TIMER never recorded any movement, and
        // `onEnd`'s tap guard (`liftedByHold && !movedPastThreshold`) threw the
        // whole gesture away as a tap. Hold to lift, drag somewhere, let go,
        // and nothing landed. Caught by dragDropAtRelease, not by inspection:
        // the tap guard reads correctly right up until you ask which path set
        // the flag it depends on.
        const _moved = Math.sqrt((t.clientX - startX) ** 2 + (t.clientY - startY) ** 2) >= _TOUCH_THRESHOLD;
        if (_moved) movedPastThreshold = true;

        if (!dragging) {
          // A2: Hold delay — don't start drag until finger held long enough
          if (performance.now() - touchStartTime < _TOUCH_HOLD_MS) return;
          if (!_moved) return;
          // Threshold crossed — NOW claim the gesture
          e.preventDefault();
          // WAS THE LIFT DUE, AND LOST THE RACE? On a saturated main thread a
          // 220ms timer cannot run, so when the thread frees the queued
          // touchmove can beat it — and the capture then reads `via=move` with
          // a 1204ms hold, which looks exactly like a user who held still for
          // a second and got nothing. It is not the same thing, and the two
          // have completely different fixes (ours vs whatever is blocking the
          // thread), so they must not print the same word.
          const _late = performance.now() - touchStartTime >= _TOUCH_LIFT_MS;
          clearLiftTimer();
          activateDrag(t.clientX, t.clientY, _late ? "move-late" : "move");
          return;
        }

        const _pm0 = performance.now();
        e.preventDefault(); // Active drag — prevent scroll
        // Pill follows finger at 60fps (cheap DOM update)
        if (clone) {
          clone.style.transform = `translate3d(${t.clientX - offsetX}px, ${t.clientY - offsetY}px, 0)`;
          // Carried out of this window (headset): the app floats the same pill in the room instead.
          clone.style.visibility = window.__moduliOutside === true ? "hidden" : "";
        }

        // A3+A4: Throttle hit-testing + cache when pointer barely moved
        const now = performance.now();
        const dx = t.clientX - lastHitX, dy = t.clientY - lastHitY;
        if (now - lastHitTestTime < hitEveryMs || (dx * dx + dy * dy < _HIT_CACHE_DIST * _HIT_CACHE_DIST)) {
          // Still update DragProvider position (for auto-scroll etc)
          dragCtx.handleDragMove(t.clientX, t.clientY);
          dragPerf.move(performance.now() - _pm0, _lastOver);
          return;
        }
        lastHitTestTime = now;
        lastHitX = t.clientX; lastHitY = t.clientY;

        // Hit-test drop targets
        const _h0 = performance.now();
        const target = _findDropTarget(t.clientX, t.clientY, payload.type, el);
        const _hitMs = performance.now() - _h0;
        dragPerf.hit(_hitMs);
        // Spend at most a quarter of the time asking what is under the finger.
        // A browser answering in 0.6ms keeps the 32ms floor; one taking 30ms
        // backs off to ~120ms instead of eating the frame budget.
        hitCostMs = blendCost(hitCostMs, _hitMs);
        hitEveryMs = hitInterval(hitCostMs);

        curTarget = touchHoverStep({ x: t.clientX, y: t.clientY, target, cur: curTarget, dragCtx });
        dragPerf.move(performance.now() - _pm0, _lastOver);
      };

      const onEnd = (e) => {
        if (inHeadset()) headsetMenuGuard(false);
        clearDocTouchHover();
        // A tap or a plain scroll ends here without ever activating, so the
        // hold-window watcher has to come off on EVERY end, not just a drag's.
        stopHoldScrollWatch();
        // Same reasoning for the op hold opened in `onStart`: a gesture that
        // never became a drag must not leave it open. (A drag proper releases
        // again via DragProvider's clearSession — releasing twice is a no-op.)
        operationsBridge.endInteraction?.();
        clearLiftTimer();
        if (dragging && liftedByHold && !movedPastThreshold) {
          // LIFTED BY THE HOLD, RELEASED WITHOUT EVER MOVING — that is a TAP,
          // and a tap on this handle opens the radial menu. Unwind the lift and
          // let the synthesized click through, so the hold changes what you SEE
          // while holding and nothing about what a tap DOES.
          if (clone) { clone.remove(); clone = null; }
          curTarget = null;
          dragging = false;
          payload = null;
          liftedByHold = false;
          setIsDragging(false);
          document.documentElement.style.overscrollBehavior = '';
          dragPerf.end();
          setTimeout(() => dragCtx.handleDragEnd(), 0);
          return;
        }
        if (!dragging) {
          // Tap — browser fires native click since we never preventDefault'd
          return;
        }
        // A drag happened — suppress the click some browsers still synthesize
        // on touchend (it was opening the RadialMenu right after a drag), and
        // stamp the moment so click handlers can double-check.
        if (e.cancelable) e.preventDefault();
        if (typeof window !== "undefined") window.__moduliDragEndAt = performance.now();
        const t = e.changedTouches[0];
        dragPerf.dropStart();
        if (clone) { clone.remove(); clone = null; }

        // THE DROP IS DECIDED AT THE RELEASE POINT, NOT AT THE LAST HOVER.
        //
        // `curTarget` is whatever the throttled hover hit-test last resolved,
        // and that throttle is DERIVED FROM ITS OWN COST (hitTestBudget): at
        // the measured `hit avg=21ms` on this tablet it backs off to ~85ms,
        // and the worst captures show 120ms+ hits. So the drop was landing
        // wherever the finger had been up to a tenth of a second before the
        // user let go — reported as "i try to drop to the left side of an
        // empty container and it doesnt drop" and "i drop to the last spot of
        // a container and it puts it after the container".
        //
        // The edge made it worse rather than absorbing it: `_computeClosestEdge`
        // was called with FRESH coordinates against the STALE element, and a
        // point outside an element's rect still yields a "closest" edge — a
        // confident answer computed from a mismatched pair. The user's own
        // reading ("the rect are off") is exactly right about the symptom: the
        // rect is fresh, the element it belongs to is not.
        //
        // One hit-test per drop, against ~900ms of drop paint, is not a cost
        // worth throttling. This leaves the throttle doing only what a throttle
        // should: the highlight may lag the finger, it can no longer decide
        // where the thing lands. The `else` branch below already re-read the
        // point with its own `elementFromPoint` for doc drops — the drop path
        // had stopped trusting `curTarget` for half the cases already.
        // In the headset a drag carried OUT of this window ends here, at the window's edge (the controller has left
        // the panel): this window takes no drop, and the app carries it into the window the trigger is let go over.
        // The app also says when the controller's ray has left this window (window.__moduliOutside): the page only ever
        // saw the last point inside, so a release out there would otherwise drop at that stale point.
        const leftWindow = inHeadset() && (window.__moduliOutside === true || leftThroughEdge(t.clientX, t.clientY, window.innerWidth, window.innerHeight));
        const { dropped: _dropped } = touchDropStep({
          x: t.clientX, y: t.clientY, payload, sourceEl: el, cur: curTarget, dragCtx, skip: leftWindow,
        });

        // The drop handler has returned — the write is dispatched, the paint
        // is still a frame away. `end()` waits for that frame rather than
        // reporting the handler's return as though the user had seen it.
        _nativeDrag({ type: "dragEnd", dropped: _dropped });
        if (inHeadset()) console.log("[headsetDrag] end", JSON.stringify({ x: Math.round(t.clientX), y: Math.round(t.clientY), w: window.innerWidth, h: window.innerHeight, leftWindow, dropped: _dropped, by: e?.type || null }));
        dragPerf.dropDone();
        curTarget = null;
        dragging = false;
        payload = null;
        setIsDragging(false);
        // No touchAction reset — nothing sets it any more, and the reset was
        // the SECOND ~900ms hit-test-region rebuild of every drag.
        document.documentElement.style.overscrollBehavior = '';
        dragPerf.end();
        setTimeout(() => dragCtx.handleDragEnd(), 0);
      };

      triggerEl.addEventListener('touchstart', onStart, { passive: false });
      triggerEl.addEventListener('touchmove', onMove, { passive: false });
      triggerEl.addEventListener('touchend', onEnd);
      triggerEl.addEventListener('touchcancel', onEnd);

      // IN THE HEADSET a controller's trigger reaches the page as a MOUSE pointer, not a touch (user, 2026-10-25:
      // "it keeps opening up a menu on the vr when i try to grab and move the drag handles") — so no touchstart ever
      // fired, the press-and-release was a click, and the click opened the radial menu. A non-touch pointer press on
      // the handle is fed to the same three handlers as a finger: pressed and moved, it drags; pressed and let go
      // without moving, the click still opens the menu. Off everywhere else (a desktop mouse has Pragmatic's drag).
      const pointerCleanup = inHeadset() ? bindPointerAsTouch(triggerEl, { onStart, onMove, onEnd }) : null;

      // A tablet with a mouse/trackpad reports pointer:coarse (primary) AND
      // any-pointer:fine. Register the desktop draggable too so MOUSE drags
      // work — HTML5 drag events never fire from touch on our elements because
      // the capture-phase dragstart guard below cancels touch-initiated ones
      // (Android can start a native drag from a long-press, which is exactly
      // the OS-intercept path the touch system bypasses).
      let lastPointerType = null;
      const onPointerDownType = (e) => { lastPointerType = e.pointerType; };
      const onNativeDragStart = (e) => {
        if (lastPointerType === 'touch' || lastPointerType === 'pen') {
          e.preventDefault();
          e.stopPropagation();
        }
      };
      let mouseDragCleanup = null;
      if (window.matchMedia("(any-pointer: fine)").matches) {
        el.addEventListener('pointerdown', onPointerDownType, { capture: true });
        el.addEventListener('dragstart', onNativeDragStart, { capture: true });
        mouseDragCleanup = draggable({
          element: el,
          ...(handleEl ? { dragHandle: handleEl } : {}),
          getInitialData: () => buildPayload(),
          getInitialDataForExternal: () => externalDragData(buildPayload()),
          onGenerateDragPreview: ({ nativeSetDragImage, location }) => {
            const liveData = dataRef.current;
            const label = liveData?.label || liveData?.name || liveData?.occurrence?.label || "item";
            const mode = liveData?.occurrence?.dragMode ?? liveData?.defaultDragMode ?? "move";
            const action = mode === "copy" ? "Copy" : mode === "copylink" ? "Copy-link" : "Move";
            attachDragPreview(el, location, nativeSetDragImage, { label, action });
          },
          onDragStart: ({ location }) => {
            setIsDragging(true);
            const liveData = dataRef.current;
            const mode = liveData?.occurrence?.dragMode ?? liveData?.defaultDragMode ?? 'move';
            dragCtx.handleDragStart(buildPayload(), location.current.input.clientX, location.current.input.clientY, { mode });
          },
          onDrag: ({ location }) => {
            dragCtx.handleDragMove(location.current.input.clientX, location.current.input.clientY);
          },
          onDrop: () => {
            setIsDragging(false);
            setTimeout(() => dragCtx.handleDragEnd(), 0);
          },
        });
        // Same text-selection disarm the desktop branch does. This registration
        // was missing it, so on a touch-primary device with a mouse attached
        // (tablet + trackpad) every handle-dragged row stayed draggable at rest
        // and its text could not be selected.
        if (handleEl) {
          const armCleanup = disarmDraggableUntilHandle(el, handleEl);
          const rawMouseCleanup = mouseDragCleanup;
          mouseDragCleanup = () => { rawMouseCleanup?.(); armCleanup(); };
        }
      }

      // Drop targets still registered via Pragmatic DnD (for desktop fallback)
      const dropCleanup = combine(
        dropTargetForElements({
          element: el,
          canDrop: ({ source }) => canAccept(source),
          getData: ({ input, element }) => {
            const d = { type, id, context: contextRef.current, instanceId: id };
            return attachClosestEdge(d, { input, element, allowedEdges: edgesRef.current });
          },
          onDragEnter: ({ source, self }) => {
            if (canAccept(source)) {
              setIsOver(true);
              setClosestEdge(extractClosestEdge(self.data));
            }
          },
          onDrag: ({ location, self }) => {
            const clientX = location.current.input.clientX;
            const clientY = location.current.input.clientY;
            dragCtx.handleDragOver?.({ type, id, context: contextRef.current, clientX, clientY });
            setClosestEdge(extractClosestEdge(self.data));
          },
          onDragLeave: () => { setIsOver(false); setClosestEdge(null); },
          onDrop: ({ source, location, nativeEvent, self }) => {
            setIsOver(false); setClosestEdge(null);
            const clientX = location.current.input.clientX;
            const clientY = location.current.input.clientY;
            const edge = extractClosestEdge(self.data);
            dragCtx.handleDrop({
              type, id,
              context: { ...contextRef.current, instanceId: id, closestEdge: edge },
              clientX, clientY,
              source: source.data,
              dataTransfer: nativeEvent?.dataTransfer,
            });
          },
        }),
        dropTargetForExternal({
          element: el,
          canDrop: ({ source }) => canAcceptExternal(source),
          getData: ({ input, element }) => {
            const d = { type, id, context: contextRef.current, instanceId: id };
            return attachClosestEdge(d, { input, element, allowedEdges: edgesRef.current });
          },
          onDragEnter: ({ self, source }) => {
            if (canAcceptExternal(source)) {
              setIsOver(true);
              setClosestEdge(extractClosestEdge(self.data));
            }
          },
          onDrag: ({ location, self }) => {
            const clientX = location.current.input.clientX;
            const clientY = location.current.input.clientY;
            setClosestEdge(extractClosestEdge(self.data));
            dragCtx.handleDragOver?.({ type, id, context: contextRef.current, clientX, clientY });
          },
          onDragLeave: () => { setIsOver(false); setClosestEdge(null); },
          onDrop: ({ location, source, self }) => {
            setIsOver(false); setClosestEdge(null);
            const clientX = location.current.input.clientX;
            const clientY = location.current.input.clientY;
            const edge = extractClosestEdge(self.data);
            const parsed = parseExternalDrop(source);
            dragCtx.handleDrop({
              type, id,
              context: { ...contextRef.current, instanceId: id, closestEdge: edge },
              clientX, clientY,
              source: externalSource(parsed),
              dataTransfer: source,
            });
          },
        })
      );

      return () => {
        stopHoldScrollWatch();
        clearLiftTimer();
        triggerEl.style.touchAction = prevTouchAction;
        triggerEl.removeEventListener('touchstart', onStart);
        triggerEl.removeEventListener('touchmove', onMove);
        triggerEl.removeEventListener('touchend', onEnd);
        triggerEl.removeEventListener('touchcancel', onEnd);
        pointerCleanup?.();
        el.removeEventListener('pointerdown', onPointerDownType, { capture: true });
        el.removeEventListener('dragstart', onNativeDragStart, { capture: true });
        mouseDragCleanup?.();
        dropCleanup();
        _unregisterDrop(el);
        if (clone) { clone.remove(); }
      };
    }

    // ─── DESKTOP: Full Pragmatic DnD ───
    const dragCleanup = draggable({
      element: el,
      ...(handleEl ? { dragHandle: handleEl } : {}),
      getInitialData: () => buildPayload(),
      getInitialDataForExternal: () => {
        const liveData = dataRef.current;
        const externalData = externalDragData(buildPayload());
        if (!_isTouch()) {
          externalData['text/plain'] = liveData.label || liveData.name || id;
        }
        return externalData;
      },
      onGenerateDragPreview: ({ nativeSetDragImage, location }) => {
        if (typeof window !== "undefined" && window.__dragDiag === true) {
          console.log("[dragDiag] genPreview (native ghost)", { type, id, nativeEnabled });
        }
        if (nativeEnabled) {
          const liveData = dataRef.current;
          const label = liveData?.label || liveData?.name || liveData?.occurrence?.label || "item";
          const mode = liveData?.occurrence?.dragMode ?? liveData?.defaultDragMode ?? "move";
          const action = mode === "copy" ? "Copy" : mode === "copylink" ? "Copy-link" : "Move";
          attachDragPreview(el, location, nativeSetDragImage, { label, action });
        }
      },
      onDragStart: ({ location }) => {
        setIsDragging(true);
        const clientX = location.current.input.clientX;
        const clientY = location.current.input.clientY;
        const liveData = dataRef.current;
        const mode = liveData?.occurrence?.dragMode ?? liveData?.defaultDragMode ?? 'move';
        dragCtx.handleDragStart(buildPayload(), clientX, clientY, { mode });
      },
      onDrag: ({ location }) => {
        const clientX = location.current.input.clientX;
        const clientY = location.current.input.clientY;
        dragCtx.handleDragMove(clientX, clientY);
      },
      onDrop: () => {
        setIsDragging(false);
        setTimeout(() => {
          dragCtx.handleDragEnd();
        }, 0);
      },
    });

    // Text-selection fix — see disarmDraggableUntilHandle. Only when a drag
    // handle is used; handle-less draggables (canvas cards, pool pills) must
    // stay draggable everywhere.
    const armCleanup = handleEl ? disarmDraggableUntilHandle(el, handleEl) : () => {};

    const cleanup = combine(
      () => { dragCleanup(); armCleanup(); },
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => canAccept(source),
        getData: ({ input, element }) => {
          const d = { type, id, context: contextRef.current, instanceId: id };
          return attachClosestEdge(d, {
            input,
            element,
            allowedEdges: edgesRef.current,
          });
        },
        onDragEnter: ({ source, self }) => {
          if (canAccept(source)) {
            setIsOver(true);
            const edge = extractClosestEdge(self.data);
            setClosestEdge(edge);
            if (typeof window !== "undefined" && window.__dragDiag === true) {
              console.log("[dragDiag] drop ENTER", { type, id, edge });
            }
          }
        },
        onDrag: ({ location, self }) => {
          const clientX = location.current.input.clientX;
          const clientY = location.current.input.clientY;
          dragCtx.handleDragOver?.({ type, id, context: contextRef.current, clientX, clientY });
          const edge = extractClosestEdge(self.data);
          setClosestEdge(edge);
          if (typeof window !== "undefined" && window.__dragDiag === true && lastDiagEdgeRef.current !== edge) {
            lastDiagEdgeRef.current = edge;
            console.log("[dragDiag] edge", { type, id, edge });
          }
        },
        onDragLeave: () => {
          setIsOver(false);
          setClosestEdge(null);
          lastDiagEdgeRef.current = null;
          if (typeof window !== "undefined" && window.__dragDiag === true) {
            console.log("[dragDiag] drop LEAVE", { type, id });
          }
        },
        onDrop: ({ source, location, nativeEvent, self }) => {
          setIsOver(false);
          setClosestEdge(null);
          const clientX = location.current.input.clientX;
          const clientY = location.current.input.clientY;
          const edge = extractClosestEdge(self.data);
          dragCtx.handleDrop({
            type,
            id,
            context: { ...contextRef.current, instanceId: id, closestEdge: edge },
            clientX,
            clientY,
            source: source.data,
            dataTransfer: nativeEvent?.dataTransfer,
          });
        },
      }),
      dropTargetForExternal({
        element: el,
        canDrop: ({ source }) => canAcceptExternal(source),
        getData: ({ input, element }) => {
          const d = { type, id, context: contextRef.current, instanceId: id };
          return attachClosestEdge(d, {
            input,
            element,
            allowedEdges: edgesRef.current,
          });
        },
        onDragEnter: ({ self, source }) => {
          if (canAcceptExternal(source)) {
            setIsOver(true);
            const edge = extractClosestEdge(self.data);
            setClosestEdge(edge);
          }
        },
        onDrag: ({ location, self }) => {
          const clientX = location.current.input.clientX;
          const clientY = location.current.input.clientY;
          const edge = extractClosestEdge(self.data);
          setClosestEdge(edge);
          dragCtx.handleDragOver?.({ type, id, context: contextRef.current, clientX, clientY });
        },
        onDragLeave: () => {
          setIsOver(false);
          setClosestEdge(null);
        },
        onDrop: ({ location, source, self }) => {
          setIsOver(false);
          setClosestEdge(null);
          const clientX = location.current.input.clientX;
          const clientY = location.current.input.clientY;
          const edge = extractClosestEdge(self.data);
          const parsed = parseExternalDrop(source);
          dragCtx.handleDrop({
            type,
            id,
            context: { ...contextRef.current, instanceId: id, closestEdge: edge },
            clientX,
            clientY,
            source: externalSource(parsed),
            dataTransfer: source,
          });
        },
      })
    );

    return () => {
      cleanup();
      _unregisterDrop(el);
    };
  }, [type, id, disabled, nativeEnabled, acceptsKey, edgesKey, dragCtx, handleNode]);

  return {
    ref,
    isDragging,
    isOver,
    closestEdge, // For drop indicator positioning
    props: {
      "data-draggable": "true",
      "data-drag-type": type,
      "data-drag-id": id,
      "data-droppable": "true",
      "data-drop-type": type,
      "data-drop-id": id,
    },
  };
}

// ============================================================
// AUTO SCROLL SETUP
// ============================================================
export function setupAutoScroll() {
  return autoScrollForElements({
    element: document.documentElement,
    canScroll: ({ element }) => {
      // Allow scrolling on document body and any element with overflow: auto/scroll
      if (element === document.documentElement || element === document.body) {
        return true;
      }
      const style = window.getComputedStyle(element);
      const hasScroll = style.overflow === 'auto' || style.overflow === 'scroll' ||
                        style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                        style.overflowX === 'auto' || style.overflowX === 'scroll';
      return hasScroll && (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth);
    },
  });
}

// ============================================================
// HITBOX UTILITIES (re-export for convenience)
// ============================================================
export { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
