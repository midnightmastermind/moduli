// blocks/useBlockDnD.js
// ============================================================
// Block-specific drag-and-drop hooks
// Built on top of Pragmatic Drag and Drop (same as grid system)
// ============================================================

import { useCallback, useEffect, useRef, useState, createContext, useContext } from "react";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { BlockShape, canAcceptBlock } from "../helpers/blockTypes";

// ============================================================
// BLOCK DRAG CONTEXT
// ============================================================
const BlockDragContext = createContext(null);

export function useBlockDragContext() {
  return useContext(BlockDragContext);
}

export { BlockDragContext };

/**
 * Block drag context provider
 * Manages the drag state for the block editor
 */
export function BlockDragProvider({ children, onBlockMove, onBlockConnect }) {
  const [activeBlock, setActiveBlock] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const handleDragStart = useCallback((block) => {
    setActiveBlock(block);
  }, []);

  const handleDragEnd = useCallback(() => {
    setActiveBlock(null);
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback((targetInfo) => {
    if (!activeBlock) return;

    const { targetType, targetId, slotId, edge } = targetInfo;

    if (targetType === "slot") {
      // Dropped into a slot
      onBlockConnect?.(activeBlock, targetId, slotId);
    } else if (targetType === "canvas") {
      // Dropped onto canvas
      onBlockMove?.(activeBlock, { x: targetInfo.x, y: targetInfo.y });
    } else if (targetType === "block-stack") {
      // Dropped above/below a statement block
      onBlockMove?.(activeBlock, { stackId: targetId, edge });
    }

    handleDragEnd();
  }, [activeBlock, onBlockConnect, onBlockMove, handleDragEnd]);

  const value = {
    activeBlock,
    dropTarget,
    setDropTarget,
    handleDragStart,
    handleDragEnd,
    handleDrop,
  };

  return (
    <BlockDragContext.Provider value={value}>
      {children}
    </BlockDragContext.Provider>
  );
}

// ============================================================
// useDraggableBlock - Makes a block draggable
// ============================================================
export function useDraggableBlock({
  block,
  disabled = false,
  onDragStart,
  isPalette = false, // If true, this is a palette block (always copy)
}) {
  const ref = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const ctx = useBlockDragContext();

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    const cleanup = draggable({
      element: el,
      getInitialData: () => ({
        type: "block",
        block,
        isPalette,
      }),
      onDragStart: () => {
        setIsDragging(true);
        ctx?.handleDragStart(block);
        onDragStart?.(block);
      },
      onDrop: () => {
        setIsDragging(false);
        // Context handles the actual drop logic
      },
    });

    return cleanup;
  }, [block, disabled, isPalette, ctx, onDragStart]);

  return {
    ref,
    isDragging,
    dragProps: {
      "data-block-id": block?.id,
      "data-block-type": block?.type,
      "data-dragging": isDragging,
    },
  };
}

// ============================================================
// useDroppableSlot - Makes a slot accept blocks
// ============================================================
export function useDroppableSlot({
  slot,
  parentBlockId,
  disabled = false,
  onConnect,
}) {
  const ref = useRef(null);
  const [isOver, setIsOver] = useState(false);
  const [canDrop, setCanDrop] = useState(false);
  const ctx = useBlockDragContext();

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    const cleanup = dropTargetForElements({
      element: el,
      canDrop: ({ source }) => {
        const draggedBlock = source.data?.block;
        if (!draggedBlock) return false;
        return canAcceptBlock(slot, draggedBlock);
      },
      getData: () => ({
        targetType: "slot",
        targetId: parentBlockId,
        slotId: slot.id,
      }),
      onDragEnter: ({ source }) => {
        const draggedBlock = source.data?.block;
        const acceptable = canAcceptBlock(slot, draggedBlock);
        setIsOver(true);
        setCanDrop(acceptable);
        if (acceptable) {
          ctx?.setDropTarget({ type: "slot", slotId: slot.id, parentBlockId });
        }
      },
      onDragLeave: () => {
        setIsOver(false);
        setCanDrop(false);
        ctx?.setDropTarget(null);
      },
      onDrop: ({ source }) => {
        setIsOver(false);
        setCanDrop(false);
        const draggedBlock = source.data?.block;
        const isPalette = source.data?.isPalette;
        if (draggedBlock && canAcceptBlock(slot, draggedBlock)) {
          onConnect?.(draggedBlock, isPalette);
          ctx?.handleDrop({
            targetType: "slot",
            targetId: parentBlockId,
            slotId: slot.id,
          });
        }
      },
    });

    return cleanup;
  }, [slot, parentBlockId, disabled, ctx, onConnect]);

  return {
    ref,
    isOver,
    canDrop,
    dropProps: {
      "data-slot-id": slot?.id,
      "data-slot-over": isOver,
      "data-slot-can-drop": canDrop,
    },
  };
}

// ============================================================
// useDroppableCanvas - Makes the canvas accept blocks
// ============================================================
export function useDroppableCanvas({
  disabled = false,
  onDrop,
}) {
  const ref = useRef(null);
  const [isOver, setIsOver] = useState(false);
  const ctx = useBlockDragContext();

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    const cleanup = dropTargetForElements({
      element: el,
      canDrop: ({ source }) => {
        // Canvas accepts any block
        return source.data?.type === "block";
      },
      getData: ({ input, element }) => {
        const rect = element.getBoundingClientRect();
        return {
          targetType: "canvas",
          x: input.clientX - rect.left,
          y: input.clientY - rect.top,
        };
      },
      onDragEnter: () => {
        setIsOver(true);
      },
      onDragLeave: () => {
        setIsOver(false);
      },
      onDrop: ({ source, self }) => {
        setIsOver(false);
        const draggedBlock = source.data?.block;
        const isPalette = source.data?.isPalette;
        if (draggedBlock) {
          onDrop?.(draggedBlock, isPalette, {
            x: self.data.x,
            y: self.data.y,
          });
        }
      },
    });

    return cleanup;
  }, [disabled, ctx, onDrop]);

  return {
    ref,
    isOver,
    dropProps: {
      "data-canvas": "true",
      "data-canvas-over": isOver,
    },
  };
}

// ============================================================
// useDroppableBlockStack - For C-blocks inner area and statement stacking
// ============================================================
export function useDroppableBlockStack({
  stackId,
  accepts = [],
  disabled = false,
  onInsert,
}) {
  const ref = useRef(null);
  const [isOver, setIsOver] = useState(false);
  const [insertEdge, setInsertEdge] = useState(null); // "top" | "bottom"

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    const cleanup = dropTargetForElements({
      element: el,
      canDrop: ({ source }) => {
        const draggedBlock = source.data?.block;
        if (!draggedBlock) return false;
        // Only accept statement-shaped blocks
        return draggedBlock.shape === BlockShape.STATEMENT ||
               draggedBlock.shape === BlockShape.C_BLOCK;
      },
      getData: ({ input, element }) => {
        const rect = element.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const edge = input.clientY < midY ? "top" : "bottom";
        return attachClosestEdge({ stackId, edge }, {
          input,
          element,
          allowedEdges: ["top", "bottom"],
        });
      },
      onDragEnter: ({ self }) => {
        setIsOver(true);
        const edge = extractClosestEdge(self.data);
        setInsertEdge(edge);
      },
      onDrag: ({ self }) => {
        const edge = extractClosestEdge(self.data);
        setInsertEdge(edge);
      },
      onDragLeave: () => {
        setIsOver(false);
        setInsertEdge(null);
      },
      onDrop: ({ source, self }) => {
        setIsOver(false);
        setInsertEdge(null);
        const draggedBlock = source.data?.block;
        const isPalette = source.data?.isPalette;
        const edge = extractClosestEdge(self.data);
        if (draggedBlock) {
          onInsert?.(draggedBlock, isPalette, edge);
        }
      },
    });

    return cleanup;
  }, [stackId, accepts, disabled, onInsert]);

  return {
    ref,
    isOver,
    insertEdge,
    dropProps: {
      "data-block-stack": stackId,
      "data-stack-over": isOver,
      "data-insert-edge": insertEdge,
    },
  };
}

// ============================================================
// useSortableBlock - Combined drag+drop for block reordering
// ============================================================
export function useSortableBlock({
  block,
  stackId,
  disabled = false,
  onReorder,
  onDragStart,
}) {
  const ref = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [closestEdge, setClosestEdge] = useState(null);
  const ctx = useBlockDragContext();

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    const isStatementLike = block.shape === BlockShape.STATEMENT ||
                            block.shape === BlockShape.C_BLOCK;

    const cleanup = combine(
      draggable({
        element: el,
        getInitialData: () => ({
          type: "block",
          block,
          isPalette: false,
        }),
        onDragStart: () => {
          setIsDragging(true);
          ctx?.handleDragStart(block);
          onDragStart?.(block);
        },
        onDrop: () => {
          setIsDragging(false);
        },
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => {
          const draggedBlock = source.data?.block;
          if (!draggedBlock) return false;
          if (draggedBlock.id === block.id) return false; // Can't drop on self

          // Only statement-like blocks can be reordered
          const draggedIsStatement = draggedBlock.shape === BlockShape.STATEMENT ||
                                     draggedBlock.shape === BlockShape.C_BLOCK;
          return isStatementLike && draggedIsStatement;
        },
        getData: ({ input, element }) => {
          return attachClosestEdge({ blockId: block.id, stackId }, {
            input,
            element,
            allowedEdges: ["top", "bottom"],
          });
        },
        onDragEnter: ({ self }) => {
          setIsOver(true);
          setClosestEdge(extractClosestEdge(self.data));
        },
        onDrag: ({ self }) => {
          setClosestEdge(extractClosestEdge(self.data));
        },
        onDragLeave: () => {
          setIsOver(false);
          setClosestEdge(null);
        },
        onDrop: ({ source, self }) => {
          setIsOver(false);
          setClosestEdge(null);
          const draggedBlock = source.data?.block;
          const isPalette = source.data?.isPalette;
          const edge = extractClosestEdge(self.data);
          if (draggedBlock && draggedBlock.id !== block.id) {
            onReorder?.(draggedBlock, isPalette, block.id, edge);
          }
        },
      })
    );

    return cleanup;
  }, [block, stackId, disabled, ctx, onDragStart, onReorder]);

  return {
    ref,
    isDragging,
    isOver,
    closestEdge,
    props: {
      "data-block-id": block?.id,
      "data-dragging": isDragging,
      "data-over": isOver,
      "data-edge": closestEdge,
    },
  };
}

export default {
  BlockDragProvider,
  useBlockDragContext,
  useDraggableBlock,
  useDroppableSlot,
  useDroppableCanvas,
  useDroppableBlockStack,
  useSortableBlock,
};
