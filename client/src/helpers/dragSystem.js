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
// - useDraggable() - makes an element draggable
// - useDroppable() - makes an element a drop target
// - useDragDrop()  - both (for sortable items)
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

import { useCallback, useEffect, useRef, useState, createContext, useContext } from "react";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { dropTargetForExternal } from "@atlaskit/pragmatic-drag-and-drop/external/adapter";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { MOBILE_BREAKPOINT } from "../hooks/useMobileDetect";

const _isMobile = () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;

// Create a small pill element for mobile drag ghost
function _createDragPill(label, type) {
  const pill = document.createElement('div');
  pill.textContent = label || type || 'item';
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
    textOverflow: 'ellipsis',
  });
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
  EXTERNAL: "external",
  FILE: "file",
  TEXT: "text",
  URL: "url",
};

// What each drop zone accepts
export const DropAccepts = {
  GRID_CELL: [DragType.PANEL, DragType.MODULE, DragType.ARTIFACT, DragType.FOLDER, DragType.FILE, DragType.EXTERNAL],
  PANEL_CONTENT: [DragType.PAGE, DragType.CONTAINER, DragType.INSTANCE, DragType.MODULE, DragType.ARTIFACT, DragType.FOLDER, DragType.EXTERNAL, DragType.FILE, DragType.TEXT, DragType.URL],
  PAGE_CONTENT: [DragType.CONTAINER, DragType.INSTANCE, DragType.MODULE, DragType.ARTIFACT, DragType.FOLDER, DragType.EXTERNAL, DragType.FILE, DragType.TEXT, DragType.URL],
  CONTAINER_LIST: [DragType.INSTANCE, DragType.MODULE, DragType.ARTIFACT, DragType.EXTERNAL, DragType.FILE, DragType.TEXT, DragType.URL],
  INSTANCE: [DragType.INSTANCE, DragType.ARTIFACT, DragType.FILE, DragType.TEXT, DragType.URL],
};

// ============================================================
// DRAG CONTEXT (stable — handlers + drag-start/end state)
// ============================================================
const DragContext = createContext(null);

const NOOP_DRAG_CTX = {
  isContainerDrag: false, isInstanceDrag: false, isExternalDrag: false,
  isPanelDrag: false, activePayload: null,
  handleDragStart: () => {}, handleDragMove: () => {}, handleDragEnd: () => {},
  handleDrop: () => {}, handleDragOver: () => {},
  getStackForPanel: () => [], cyclePanelStack: () => {},
  setDropHighlight: () => {}, clearDropHighlight: () => {},
};

export function useDragContext() {
  const ctx = useContext(DragContext);
  return ctx || NOOP_DRAG_CTX;
}

export { DragContext };

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
let _windowId = null;
export function getWindowId() {
  if (!_windowId) {
    _windowId = crypto?.randomUUID?.() || `win-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return _windowId;
}

// ============================================================
// PAYLOAD HELPERS
// ============================================================
export function createPayload(type, id, data, context = {}) {
  return {
    type,
    id,
    data,
    context,
    sourceWindowId: getWindowId(),
  };
}

export function serializePayload(payload) {
  return JSON.stringify({
    v: 1,
    type: payload.type,
    id: payload.id,
    context: payload.context,
    data: payload.data, // Include full data object for complete copying
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
        isCrossWindow: parsed.sourceWindowId !== getWindowId(),
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
const _TOUCH_HOLD_MS = 80;  // minimum hold time before drag activates
const _HIT_TEST_INTERVAL = 32; // ms between expensive hit-test calls
const _HIT_CACHE_DIST = 4; // px — skip hit-test if pointer barely moved

// Global drop target registry — maps DOM elements to their drop config.
// Used by touch move handler to find drop targets via elementFromPoint.
const _dropRegistry = new Map();

function _registerDrop(el, config) {
  _dropRegistry.set(el, config);
}

function _unregisterDrop(el) {
  _dropRegistry.delete(el);
}

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
  const elements = document.elementsFromPoint(clientX, clientY);
  for (const el of elements) {
    let node = el;
    while (node && node !== document.body) {
      if (node === sourceEl) { node = node.parentElement; continue; }
      const config = _dropRegistry.get(node);
      if (config) {
        if (config.accepts.length === 0 || config.accepts.includes(dragType)) {
          return { el: node, ...config };
        }
      }
      node = node.parentElement;
    }
  }
  return null;
}

// ============================================================
// useDraggable HOOK
// ============================================================
export function useDraggable({
  type,
  id,
  data = {},
  context = {},
  disabled = false,
  nativeEnabled = true,
  dragHandleRef = null, // optional ref — restricts drag start to that element
}) {
  const ref = useRef(null);
  const dragCtx = useDragContext();
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    const payload = createPayload(type, id, data, context);
    const handleEl = dragHandleRef?.current;

    // ─── MOBILE: Touch-based drag (no native DnD) ───
    if (_isMobile()) {
      const triggerEl = handleEl || el;
      // Prevent browser gestures on drag handle (sampled at touchstart)
      const prevTouchAction = triggerEl.style.touchAction;
      triggerEl.style.touchAction = 'none';

      let clone = null;
      let dragging = false;
      let startX, startY, offsetX, offsetY;
      let curTarget = null;
      let cachedRect = null;
      let touchStartTime = 0;
      let lastHitTestTime = 0;
      let lastHitX = 0, lastHitY = 0;

      const onStart = (e) => {
        if (e.touches.length !== 1) return;
        // NO e.preventDefault() — triggerEl CSS touch-action:none handles OS gesture suppression
        // This lets the browser fire native click/pointer events for taps
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        cachedRect = el.getBoundingClientRect(); // Cache rect NOW while layout is fresh
        touchStartTime = performance.now();
        dragging = false;
      };

      const onMove = (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];

        if (!dragging) {
          // A2: Hold delay — don't start drag until finger held long enough
          if (performance.now() - touchStartTime < _TOUCH_HOLD_MS) return;
          if (Math.sqrt((t.clientX - startX) ** 2 + (t.clientY - startY) ** 2) < _TOUCH_THRESHOLD) return;
          // Threshold crossed — NOW claim the gesture
          e.preventDefault();
          dragging = true;
          document.documentElement.style.touchAction = 'none';
          document.documentElement.style.overscrollBehavior = 'none';
          setIsDragging(true);

          // A1: Haptic feedback on drag start
          if (navigator.vibrate) navigator.vibrate(15);

          offsetX = 40;
          offsetY = 14;
          clone = _createDragPill(data?.label || data?.name || type, type);
          clone.style.transform = `translate(${t.clientX - offsetX}px, ${t.clientY - offsetY}px)`;
          document.body.appendChild(clone);
          lastHitX = t.clientX; lastHitY = t.clientY;
          lastHitTestTime = performance.now();
          dragCtx.handleDragStart(payload, startX, startY);
          return;
        }

        e.preventDefault(); // Active drag — prevent scroll
        // Pill follows finger at 60fps (cheap DOM update)
        if (clone) {
          clone.style.transform = `translate(${t.clientX - offsetX}px, ${t.clientY - offsetY}px)`;
        }

        // A3+A4: Throttle hit-testing + cache when pointer barely moved
        const now = performance.now();
        const dx = t.clientX - lastHitX, dy = t.clientY - lastHitY;
        if (now - lastHitTestTime < _HIT_TEST_INTERVAL || (dx * dx + dy * dy < _HIT_CACHE_DIST * _HIT_CACHE_DIST)) {
          // Still update DragProvider position (for auto-scroll etc)
          dragCtx.handleDragMove(t.clientX, t.clientY);
          return;
        }
        lastHitTestTime = now;
        lastHitX = t.clientX; lastHitY = t.clientY;

        // Hit-test drop targets
        const target = _findDropTarget(t.clientX, t.clientY, payload.type, el);

        if (target?.el !== curTarget?.el) {
          curTarget?.stateRef?.current?.setIsOver?.(false);
          curTarget?.stateRef?.current?.setClosestEdge?.(null);
          curTarget = target;
          target?.stateRef?.current?.setIsOver?.(true);
        }
        if (curTarget?.allowedEdges) {
          const edge = _computeClosestEdge(curTarget.el, t.clientX, t.clientY, curTarget.allowedEdges);
          curTarget.stateRef?.current?.setClosestEdge?.(edge);
        }

        dragCtx.handleDragMove(t.clientX, t.clientY);
        if (curTarget) {
          dragCtx.handleDragOver?.({
            type: curTarget.type, id: curTarget.id,
            context: curTarget.context,
            clientX: t.clientX, clientY: t.clientY,
          });
        }
      };

      const onEnd = (e) => {
        if (!dragging) {
          // Tap — browser fires native click since we never preventDefault'd
          return;
        }
        const t = e.changedTouches[0];
        if (clone) { clone.remove(); clone = null; }

        if (curTarget) {
          // A1: Haptic double-tap on successful drop
          if (navigator.vibrate) navigator.vibrate([8, 30, 8]);
          const edge = curTarget.allowedEdges
            ? _computeClosestEdge(curTarget.el, t.clientX, t.clientY, curTarget.allowedEdges)
            : null;
          curTarget.stateRef?.current?.setIsOver?.(false);
          curTarget.stateRef?.current?.setClosestEdge?.(null);
          dragCtx.handleDrop({
            type: curTarget.type, id: curTarget.id,
            context: { ...curTarget.context, instanceId: curTarget.id, closestEdge: edge },
            clientX: t.clientX, clientY: t.clientY,
            source: payload,
          });
        }

        curTarget = null;
        dragging = false;
        setIsDragging(false);
        document.documentElement.style.touchAction = '';
        document.documentElement.style.overscrollBehavior = '';
        setTimeout(() => dragCtx.handleDragEnd(), 0);
      };

      triggerEl.addEventListener('touchstart', onStart, { passive: false });
      triggerEl.addEventListener('touchmove', onMove, { passive: false });
      triggerEl.addEventListener('touchend', onEnd);
      triggerEl.addEventListener('touchcancel', onEnd);

      return () => {
        triggerEl.style.touchAction = prevTouchAction;
        triggerEl.removeEventListener('touchstart', onStart);
        triggerEl.removeEventListener('touchmove', onMove);
        triggerEl.removeEventListener('touchend', onEnd);
        triggerEl.removeEventListener('touchcancel', onEnd);
        if (clone) { clone.remove(); }
      };
    }

    // ─── DESKTOP: Pragmatic DnD (HTML5 Drag and Drop) ───
    const cleanup = draggable({
      element: el,
      ...(handleEl ? { dragHandle: handleEl } : {}),
      getInitialData: () => payload,
      getInitialDataForExternal: () => {
        const externalData = {
          [NATIVE_DND_MIME]: serializePayload(payload),
        };
        // Only include text/plain on desktop — Android treats it as shareable content
        // and triggers split-screen/popup window gestures
        if (!_isMobile()) {
          externalData['text/plain'] = data.label || data.name || id;
        }
        return externalData;
      },
      onGenerateDragPreview: ({ nativeSetDragImage, location }) => {
        if (nativeEnabled) {
          const rect = el.getBoundingClientRect();
          const cursorX = location.initial.input.clientX;
          const cursorY = location.initial.input.clientY;
          const offsetX = Math.round(cursorX - rect.left);
          const offsetY = Math.round(cursorY - rect.top);
          setCustomNativeDragPreview({
            nativeSetDragImage,
            getOffset: () => ({ x: offsetX, y: offsetY }),
            render: ({ container }) => {
              const clone = el.cloneNode(true);
              clone.style.opacity = '1';
              clone.style.transform = 'none';
              container.appendChild(clone);
            },
          });
        }
      },
      onDragStart: ({ location }) => {
        setIsDragging(true);
        const clientX = location.current.input.clientX;
        const clientY = location.current.input.clientY;
        dragCtx.handleDragStart(payload, clientX, clientY);
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

    return () => { cleanup(); };
  }, [type, id, JSON.stringify(data), JSON.stringify(context), disabled, nativeEnabled, dragCtx, dragHandleRef]);

  return {
    ref,
    isDragging,
    dragProps: {
      "data-draggable": "true",
      "data-drag-type": type,
      "data-drag-id": id,
    },
  };
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
}) {
  const ref = useRef(null);
  const dragCtx = useDragContext();
  const [isOver, setIsOver] = useState(false);

  // Stable ref for mobile touch system to update state
  const stateRef = useRef({ setIsOver });
  stateRef.current = { setIsOver };

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    // Register in drop target registry (for mobile touch hit-testing)
    _registerDrop(el, { type, id, context, accepts, allowedEdges: null, stateRef });

    const canAccept = (source) => {
      const dragType = source?.data?.type;
      if (accepts.length === 0) return true;
      return accepts.includes(dragType);
    };

    const canAcceptExternal = () => {
      return accepts.includes(DragType.INSTANCE) ||
             accepts.includes(DragType.FILE) ||
             accepts.includes(DragType.TEXT) ||
             accepts.includes(DragType.URL) ||
             accepts.includes(DragType.EXTERNAL);
    };

    const cleanup = combine(
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => canAccept(source),
        getData: () => ({ type, id, context }),
        onDragEnter: ({ self, source }) => {
          if (canAccept(source)) {
            setIsOver(true);
          }
        },
        onDrag: ({ self, source, location }) => {
          const clientX = location.current.input.clientX;
          const clientY = location.current.input.clientY;
          dragCtx.handleDragOver?.({ type, id, context, clientX, clientY });
        },
        onDragLeave: () => {
          setIsOver(false);
          // Clear container highlight when leaving. If pointer enters another container
          // immediately after, its onDrag fires handleDragOver and cancels the RAF clear.
          if (context.containerId) {
            dragCtx.handleDragOver?.({ type, id, context: { ...context, containerId: null } });
          }
        },
        onDrop: ({ self, source, location, nativeEvent }) => {
          setIsOver(false);
          const clientX = location.current.input.clientX;
          const clientY = location.current.input.clientY;

          dragCtx.handleDrop({
            type,
            id,
            context,
            clientX,
            clientY,
            source: source.data,
            dataTransfer: nativeEvent?.dataTransfer,
          });
        },
      }),
      dropTargetForExternal({
        element: el,
        canDrop: () => canAcceptExternal(),
        getData: () => ({ type, id, context }),
        onDragEnter: () => {
          if (canAcceptExternal()) {
            setIsOver(true);
          }
        },
        onDrag: ({ location }) => {
          const clientX = location.current.input.clientX;
          const clientY = location.current.input.clientY;
          dragCtx.handleDragOver?.({ type, id, context, clientX, clientY });
        },
        onDragLeave: () => {
          setIsOver(false);
          if (context.containerId) {
            dragCtx.handleDragOver?.({ type, id, context: { ...context, containerId: null } });
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
            context,
            clientX,
            clientY,
            source: {
              type: parsed.type,
              id: parsed.id,
              data: parsed.data,
              context: parsed.context || {},
            },
            dataTransfer: source,
          });
        },
      })
    );

    return () => {
      cleanup();
      _unregisterDrop(el);
    };
  }, [type, id, JSON.stringify(context), JSON.stringify(accepts), disabled, dragCtx]);

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
}) {
  const ref = useRef(null);
  const dragCtx = useDragContext();
  const [isDragging, setIsDragging] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [closestEdge, setClosestEdge] = useState(null);

  // Stable ref for mobile touch system to update state
  const stateRef = useRef({ setIsOver, setClosestEdge });
  stateRef.current = { setIsOver, setClosestEdge };

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    const payload = createPayload(type, id, data, context);
    const handleEl = dragHandleRef?.current;

    const canAccept = (source) => {
      const dragType = source?.data?.type;
      if (accepts.length === 0) return true;
      return accepts.includes(dragType);
    };

    const canAcceptExternal = () => {
      return accepts.includes(DragType.INSTANCE) ||
             accepts.includes(DragType.FILE) ||
             accepts.includes(DragType.TEXT) ||
             accepts.includes(DragType.URL) ||
             accepts.includes(DragType.EXTERNAL);
    };

    // Register in drop target registry (for mobile touch hit-testing)
    _registerDrop(el, { type, id, context, accepts, allowedEdges, stateRef });

    // ─── MOBILE: Touch drag + Pragmatic drop targets ───
    if (_isMobile()) {
      const triggerEl = handleEl || el;
      const prevTouchAction = triggerEl.style.touchAction;
      triggerEl.style.touchAction = 'none';

      let clone = null;
      let dragging = false;
      let startX, startY, offsetX, offsetY;
      let curTarget = null;
      let cachedRect = null;
      let touchStartTime = 0;
      let lastHitTestTime = 0;
      let lastHitX = 0, lastHitY = 0;

      const onStart = (e) => {
        if (e.touches.length !== 1) return;
        // NO e.preventDefault() — triggerEl CSS touch-action:none handles OS gesture suppression
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        cachedRect = el.getBoundingClientRect(); // Cache rect NOW while layout is fresh
        touchStartTime = performance.now();
        dragging = false;
      };

      const onMove = (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];

        if (!dragging) {
          // A2: Hold delay — don't start drag until finger held long enough
          if (performance.now() - touchStartTime < _TOUCH_HOLD_MS) return;
          if (Math.sqrt((t.clientX - startX) ** 2 + (t.clientY - startY) ** 2) < _TOUCH_THRESHOLD) return;
          // Threshold crossed — NOW claim the gesture
          e.preventDefault();
          dragging = true;
          document.documentElement.style.touchAction = 'none';
          document.documentElement.style.overscrollBehavior = 'none';
          setIsDragging(true);

          // A1: Haptic feedback on drag start
          if (navigator.vibrate) navigator.vibrate(15);

          offsetX = 40;
          offsetY = 14;
          clone = _createDragPill(data?.label || data?.name || type, type);
          clone.style.transform = `translate(${t.clientX - offsetX}px, ${t.clientY - offsetY}px)`;
          document.body.appendChild(clone);
          lastHitX = t.clientX; lastHitY = t.clientY;
          lastHitTestTime = performance.now();

          // Per-occurrence dragMode overrides entity's defaultDragMode
          const mode = data?.occurrence?.dragMode ?? data?.defaultDragMode ?? 'move';
          dragCtx.handleDragStart(payload, startX, startY, { mode });
          return;
        }

        e.preventDefault(); // Active drag — prevent scroll
        // Pill follows finger at 60fps (cheap DOM update)
        if (clone) {
          clone.style.transform = `translate(${t.clientX - offsetX}px, ${t.clientY - offsetY}px)`;
        }

        // A3+A4: Throttle hit-testing + cache when pointer barely moved
        const now = performance.now();
        const dx = t.clientX - lastHitX, dy = t.clientY - lastHitY;
        if (now - lastHitTestTime < _HIT_TEST_INTERVAL || (dx * dx + dy * dy < _HIT_CACHE_DIST * _HIT_CACHE_DIST)) {
          // Still update DragProvider position (for auto-scroll etc)
          dragCtx.handleDragMove(t.clientX, t.clientY);
          return;
        }
        lastHitTestTime = now;
        lastHitX = t.clientX; lastHitY = t.clientY;

        // Hit-test drop targets
        const target = _findDropTarget(t.clientX, t.clientY, payload.type, el);

        if (target?.el !== curTarget?.el) {
          curTarget?.stateRef?.current?.setIsOver?.(false);
          curTarget?.stateRef?.current?.setClosestEdge?.(null);
          curTarget = target;
          target?.stateRef?.current?.setIsOver?.(true);
        }
        if (curTarget?.allowedEdges) {
          const edge = _computeClosestEdge(curTarget.el, t.clientX, t.clientY, curTarget.allowedEdges);
          curTarget.stateRef?.current?.setClosestEdge?.(edge);
        }

        dragCtx.handleDragMove(t.clientX, t.clientY);
        if (curTarget) {
          dragCtx.handleDragOver?.({
            type: curTarget.type, id: curTarget.id,
            context: curTarget.context,
            clientX: t.clientX, clientY: t.clientY,
          });
        }
      };

      const onEnd = (e) => {
        if (!dragging) {
          // Tap — browser fires native click since we never preventDefault'd
          return;
        }
        const t = e.changedTouches[0];
        if (clone) { clone.remove(); clone = null; }

        if (curTarget) {
          // A1: Haptic double-tap on successful drop
          if (navigator.vibrate) navigator.vibrate([8, 30, 8]);
          const edge = curTarget.allowedEdges
            ? _computeClosestEdge(curTarget.el, t.clientX, t.clientY, curTarget.allowedEdges)
            : null;
          curTarget.stateRef?.current?.setIsOver?.(false);
          curTarget.stateRef?.current?.setClosestEdge?.(null);
          dragCtx.handleDrop({
            type: curTarget.type, id: curTarget.id,
            context: { ...curTarget.context, instanceId: curTarget.id, closestEdge: edge },
            clientX: t.clientX, clientY: t.clientY,
            source: payload,
          });
        }

        curTarget = null;
        dragging = false;
        setIsDragging(false);
        document.documentElement.style.touchAction = '';
        document.documentElement.style.overscrollBehavior = '';
        setTimeout(() => dragCtx.handleDragEnd(), 0);
      };

      triggerEl.addEventListener('touchstart', onStart, { passive: false });
      triggerEl.addEventListener('touchmove', onMove, { passive: false });
      triggerEl.addEventListener('touchend', onEnd);
      triggerEl.addEventListener('touchcancel', onEnd);

      // Drop targets still registered via Pragmatic DnD (for desktop fallback)
      const dropCleanup = combine(
        dropTargetForElements({
          element: el,
          canDrop: ({ source }) => canAccept(source),
          getData: ({ input, element }) => {
            const data = { type, id, context, instanceId: id };
            return attachClosestEdge(data, { input, element, allowedEdges });
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
            dragCtx.handleDragOver?.({ type, id, context, clientX, clientY });
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
              context: { ...context, instanceId: id, closestEdge: edge },
              clientX, clientY,
              source: source.data,
              dataTransfer: nativeEvent?.dataTransfer,
            });
          },
        }),
        dropTargetForExternal({
          element: el,
          canDrop: () => canAcceptExternal(),
          getData: ({ input, element }) => {
            const data = { type, id, context, instanceId: id };
            return attachClosestEdge(data, { input, element, allowedEdges });
          },
          onDragEnter: ({ self }) => {
            if (canAcceptExternal()) {
              setIsOver(true);
              setClosestEdge(extractClosestEdge(self.data));
            }
          },
          onDrag: ({ location, self }) => {
            const clientX = location.current.input.clientX;
            const clientY = location.current.input.clientY;
            setClosestEdge(extractClosestEdge(self.data));
            dragCtx.handleDragOver?.({ type, id, context, clientX, clientY });
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
              context: { ...context, instanceId: id, closestEdge: edge },
              clientX, clientY,
              source: { type: parsed.type, id: parsed.id, data: parsed.data, context: parsed.context || {} },
              dataTransfer: source,
            });
          },
        })
      );

      return () => {
        triggerEl.style.touchAction = prevTouchAction;
        triggerEl.removeEventListener('touchstart', onStart);
        triggerEl.removeEventListener('touchmove', onMove);
        triggerEl.removeEventListener('touchend', onEnd);
        triggerEl.removeEventListener('touchcancel', onEnd);
        dropCleanup();
        _unregisterDrop(el);
        if (clone) { clone.remove(); }
      };
    }

    // ─── DESKTOP: Full Pragmatic DnD ───
    const dragCleanup = draggable({
      element: el,
      ...(handleEl ? { dragHandle: handleEl } : {}),
      getInitialData: () => payload,
      getInitialDataForExternal: () => {
        const externalData = {
          [NATIVE_DND_MIME]: serializePayload(payload),
        };
        if (!_isMobile()) {
          externalData['text/plain'] = data.label || data.name || id;
        }
        return externalData;
      },
      onGenerateDragPreview: ({ nativeSetDragImage, location }) => {
        if (nativeEnabled) {
          const rect = el.getBoundingClientRect();
          const cursorX = location.initial.input.clientX;
          const cursorY = location.initial.input.clientY;
          const offsetX = Math.round(cursorX - rect.left);
          const offsetY = Math.round(cursorY - rect.top);
          setCustomNativeDragPreview({
            nativeSetDragImage,
            getOffset: () => ({ x: offsetX, y: offsetY }),
            render: ({ container }) => {
              const clone = el.cloneNode(true);
              clone.style.opacity = '1';
              clone.style.transform = 'none';
              container.appendChild(clone);
            },
          });
        }
      },
      onDragStart: ({ location }) => {
        setIsDragging(true);
        const clientX = location.current.input.clientX;
        const clientY = location.current.input.clientY;
        const mode = data?.occurrence?.dragMode ?? data?.defaultDragMode ?? 'move';
        dragCtx.handleDragStart(payload, clientX, clientY, { mode });
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

    const cleanup = combine(
      () => { dragCleanup(); },
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => canAccept(source),
        getData: ({ input, element }) => {
          const data = { type, id, context, instanceId: id };
          return attachClosestEdge(data, {
            input,
            element,
            allowedEdges,
          });
        },
        onDragEnter: ({ source, self }) => {
          if (canAccept(source)) {
            setIsOver(true);
            const edge = extractClosestEdge(self.data);
            setClosestEdge(edge);
          }
        },
        onDrag: ({ location, self }) => {
          const clientX = location.current.input.clientX;
          const clientY = location.current.input.clientY;
          dragCtx.handleDragOver?.({ type, id, context, clientX, clientY });
          const edge = extractClosestEdge(self.data);
          setClosestEdge(edge);
        },
        onDragLeave: () => {
          setIsOver(false);
          setClosestEdge(null);
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
            context: { ...context, instanceId: id, closestEdge: edge },
            clientX,
            clientY,
            source: source.data,
            dataTransfer: nativeEvent?.dataTransfer,
          });
        },
      }),
      dropTargetForExternal({
        element: el,
        canDrop: () => canAcceptExternal(),
        getData: ({ input, element }) => {
          const data = { type, id, context, instanceId: id };
          return attachClosestEdge(data, {
            input,
            element,
            allowedEdges,
          });
        },
        onDragEnter: ({ self }) => {
          if (canAcceptExternal()) {
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
          dragCtx.handleDragOver?.({ type, id, context, clientX, clientY });
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
            context: { ...context, instanceId: id, closestEdge: edge },
            clientX,
            clientY,
            source: {
              type: parsed.type,
              id: parsed.id,
              data: parsed.data,
              context: parsed.context || {},
            },
            dataTransfer: source,
          });
        },
      })
    );

    return () => {
      cleanup();
      _unregisterDrop(el);
    };
  }, [type, id, JSON.stringify(data), JSON.stringify(context), disabled, nativeEnabled, JSON.stringify(accepts), JSON.stringify(allowedEdges), dragCtx, dragHandleRef]);

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
