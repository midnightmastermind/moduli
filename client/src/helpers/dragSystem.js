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

// ============================================================
// CONSTANTS & TYPES
// ============================================================
export const NATIVE_DND_MIME = "application/x-daytracker-dnd";

export const DragType = {
  PANEL: "panel",
  CONTAINER: "container",
  INSTANCE: "instance",
  MODULE: "module",     // CC module drag (all roles: panel/container/instance)
  ARTIFACT: "artifact",
  EXTERNAL: "external",
  FILE: "file",
  TEXT: "text",
  URL: "url",
};

// What each drop zone accepts
export const DropAccepts = {
  GRID_CELL: [DragType.PANEL, DragType.MODULE, DragType.ARTIFACT],  // panels, modules, and artifacts drop to grid cells
  PANEL_CONTENT: [DragType.CONTAINER, DragType.INSTANCE, DragType.MODULE, DragType.ARTIFACT, DragType.EXTERNAL, DragType.FILE, DragType.TEXT, DragType.URL],
  CONTAINER_LIST: [DragType.INSTANCE, DragType.MODULE, DragType.ARTIFACT, DragType.EXTERNAL, DragType.FILE, DragType.TEXT, DragType.URL],
  INSTANCE: [DragType.INSTANCE, DragType.ARTIFACT, DragType.FILE, DragType.TEXT, DragType.URL],
};

// ============================================================
// DRAG CONTEXT (stable — handlers + drag-start/end state)
// ============================================================
const DragContext = createContext(null);

export function useDragContext() {
  const ctx = useContext(DragContext);
  if (!ctx) {
    throw new Error("useDraggable/useDroppable must be used within DragProvider");
  }
  return ctx;
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
// useDraggable HOOK (Pragmatic Drag and Drop)
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

    const cleanup = draggable({
      element: el,
      ...(handleEl ? { dragHandle: handleEl } : {}),
      getInitialData: () => payload,
      getInitialDataForExternal: () => ({
        [NATIVE_DND_MIME]: serializePayload(payload),
        'text/plain': data.label || data.name || id,
      }),
      onGenerateDragPreview: ({ nativeSetDragImage }) => {
        // Create a fully opaque drag preview
        if (nativeEnabled) {
          setCustomNativeDragPreview({
            nativeSetDragImage,
            getOffset: () => ({ x: 0, y: 0 }),
            render: ({ container }) => {
              // Clone the element
              const clone = el.cloneNode(true);
              // Ensure it's fully opaque
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
        // Delay handleDragEnd to allow drop target's onDrop to fire first
        setTimeout(() => {
          dragCtx.handleDragEnd();
        }, 0);
      },
    });

    return cleanup;
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
// useDroppable HOOK (Pragmatic Drag and Drop)
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

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    const canAccept = (source) => {
      const dragType = source?.data?.type;
      if (accepts.length === 0) return true;
      return accepts.includes(dragType);
    };

    const canAcceptExternal = () => {
      // Accept external if accepts includes INSTANCE (for cross-window), FILE, TEXT, URL, or EXTERNAL
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
            dataTransfer: nativeEvent?.dataTransfer, // Include native dataTransfer for external drops
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
        },
        onDrop: ({ location, source }) => {
          setIsOver(false);
          const clientX = location.current.input.clientX;
          const clientY = location.current.input.clientY;

          // Parse external drop data
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
            dataTransfer: source, // Pass the native source
          });
        },
      })
    );

    return cleanup;
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
      // Accept external if accepts includes INSTANCE (for cross-window), FILE, TEXT, URL, or EXTERNAL
      return accepts.includes(DragType.INSTANCE) ||
             accepts.includes(DragType.FILE) ||
             accepts.includes(DragType.TEXT) ||
             accepts.includes(DragType.URL) ||
             accepts.includes(DragType.EXTERNAL);
    };

    // Combine draggable, dropTarget for elements, and dropTarget for external
    const cleanup = combine(
      draggable({
        element: el,
        ...(handleEl ? { dragHandle: handleEl } : {}),
        getInitialData: () => payload,
        getInitialDataForExternal: () => ({
          [NATIVE_DND_MIME]: serializePayload(payload),
          'text/plain': data.label || data.name || id,
        }),
        onGenerateDragPreview: ({ nativeSetDragImage }) => {
          // Create a fully opaque drag preview
          if (nativeEnabled) {
            setCustomNativeDragPreview({
              nativeSetDragImage,
              getOffset: () => ({ x: 0, y: 0 }),
              render: ({ container }) => {
                // Clone the element
                const clone = el.cloneNode(true);
                // Ensure it's fully opaque
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
          // Per-occurrence dragMode overrides entity's defaultDragMode
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
          // Delay handleDragEnd to allow drop target's onDrop to fire first
          setTimeout(() => {
            dragCtx.handleDragEnd();
          }, 0);
        },
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => canAccept(source),
        getData: ({ input, element }) => {
          const data = { type, id, context, instanceId: id };
          // Attach closest edge for drop indicator
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

          // Update closest edge as pointer moves
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

          // Extract closestEdge from drop target data
          const edge = extractClosestEdge(self.data);

          dragCtx.handleDrop({
            type,
            id,
            context: { ...context, instanceId: id, closestEdge: edge },
            clientX,
            clientY,
            source: source.data,
            dataTransfer: nativeEvent?.dataTransfer, // Include native dataTransfer
          });
        },
      }),
      dropTargetForExternal({
        element: el,
        canDrop: () => canAcceptExternal(),
        getData: ({ input, element }) => {
          const data = { type, id, context, instanceId: id };
          // Attach closest edge for drop indicator (same as internal drops)
          return attachClosestEdge(data, {
            input,
            element,
            allowedEdges,
          });
        },
        onDragEnter: ({ self }) => {
          if (canAcceptExternal()) {
            setIsOver(true);
            // Extract and set closest edge for drop indicators
            const edge = extractClosestEdge(self.data);
            setClosestEdge(edge);
          }
        },
        onDrag: ({ location, self }) => {
          const clientX = location.current.input.clientX;
          const clientY = location.current.input.clientY;
          // Update closest edge on drag
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

          // Extract closestEdge from drop target data
          const edge = extractClosestEdge(self.data);

          // Parse external drop data
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
            dataTransfer: source, // Pass the native source
          });
        },
      })
    );

    return cleanup;
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
