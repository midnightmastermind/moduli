// blocks/OperationsCanvas.jsx
// ============================================================
// Canvas where blocks are dropped and connected
// ============================================================

import React, { useCallback } from "react";
import { useDroppableCanvas } from "./useBlockDnD";
import Block from "./Block";
import { cloneBlock } from "../helpers/blockTypes";

/**
 * OperationsCanvas - The main editing area for block structures
 *
 * Props:
 * - rootBlock: The root block structure (or null if empty)
 * - onChange: (newRootBlock) => void
 * - disabled: boolean
 */
export default function OperationsCanvas({
  rootBlock,
  onChange,
  disabled = false,
}) {
  // Handle dropping a block onto the canvas
  const handleCanvasDrop = useCallback((block, isPalette, position) => {
    // If palette block, clone it
    const newBlock = isPalette ? cloneBlock(block) : block;

    // If canvas is empty, this becomes the root
    if (!rootBlock) {
      onChange(newBlock);
      return;
    }

    // If canvas has a root, replace it (or could implement positioning)
    onChange(newBlock);
  }, [rootBlock, onChange]);

  const { ref, isOver, dropProps } = useDroppableCanvas({
    disabled,
    onDrop: handleCanvasDrop,
  });

  // Handle connecting a block to a slot
  const handleSlotConnect = useCallback((parentBlockId, slotId, droppedBlock, isPalette) => {
    if (!rootBlock) return;

    // Clone if from palette
    const blockToInsert = isPalette ? cloneBlock(droppedBlock) : droppedBlock;

    // Find the parent block and update its slot
    const updatedRoot = updateBlockSlot(rootBlock, parentBlockId, slotId, blockToInsert);
    onChange(updatedRoot);
  }, [rootBlock, onChange]);

  // Handle inserting a block into a C-block's inner area
  const handleInnerInsert = useCallback((parentBlockId, innerSlotId, droppedBlock, isPalette, edge) => {
    if (!rootBlock) return;

    const blockToInsert = isPalette ? cloneBlock(droppedBlock) : droppedBlock;

    const updatedRoot = insertIntoInnerSlot(rootBlock, parentBlockId, innerSlotId, blockToInsert, edge);
    onChange(updatedRoot);
  }, [rootBlock, onChange]);

  // Handle removing a block
  const handleRemove = useCallback((blockId) => {
    if (!rootBlock) return;

    // If removing root, clear canvas
    if (rootBlock.id === blockId) {
      onChange(null);
      return;
    }

    // Otherwise, find and remove the block
    const updatedRoot = removeBlock(rootBlock, blockId);
    onChange(updatedRoot);
  }, [rootBlock, onChange]);

  return (
    <div
      ref={ref}
      {...dropProps}
      className={`
        operations-canvas
        flex-1 min-h-[120px]
        p-4
        bg-background/50
        border-2 border-dashed rounded-lg
        transition-colors
        ${isOver
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/20"
        }
        ${disabled ? "opacity-50 pointer-events-none" : ""}
      `}
    >
      {rootBlock ? (
        <div className="canvas-content">
          <Block
            block={rootBlock}
            onSlotConnect={handleSlotConnect}
            onInnerInsert={handleInnerInsert}
            onRemove={handleRemove}
          />
        </div>
      ) : (
        <div className="canvas-empty flex items-center justify-center h-full min-h-[80px]">
          <p className="text-sm text-muted-foreground">
            Drag blocks here to build an expression
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Helper: Update a slot in a block tree
 */
function updateBlockSlot(block, targetBlockId, slotId, newBlock) {
  if (block.id === targetBlockId) {
    // Found the target block, update its slot
    return {
      ...block,
      slots: block.slots?.map(slot =>
        slot.id === slotId
          ? { ...slot, connected: newBlock }
          : slot
      ),
    };
  }

  // Recursively search in slots
  const updatedSlots = block.slots?.map(slot => {
    if (!slot.connected) return slot;
    return {
      ...slot,
      connected: updateBlockSlot(slot.connected, targetBlockId, slotId, newBlock),
    };
  });

  // Recursively search in inner slots
  const updatedInnerSlots = block.innerSlots?.map(innerSlot => ({
    ...innerSlot,
    connected: innerSlot.connected?.map(innerBlock =>
      updateBlockSlot(innerBlock, targetBlockId, slotId, newBlock)
    ),
  }));

  return {
    ...block,
    slots: updatedSlots,
    innerSlots: updatedInnerSlots,
  };
}

/**
 * Helper: Insert a block into a C-block's inner slot
 */
function insertIntoInnerSlot(block, targetBlockId, innerSlotId, newBlock, edge) {
  if (block.id === targetBlockId) {
    // Found the target block
    return {
      ...block,
      innerSlots: block.innerSlots?.map(innerSlot => {
        if (innerSlot.id !== innerSlotId) return innerSlot;

        const connected = innerSlot.connected || [];
        // For now, just append. Could implement edge-based insertion.
        return {
          ...innerSlot,
          connected: edge === "top"
            ? [newBlock, ...connected]
            : [...connected, newBlock],
        };
      }),
    };
  }

  // Recursively search
  const updatedSlots = block.slots?.map(slot => {
    if (!slot.connected) return slot;
    return {
      ...slot,
      connected: insertIntoInnerSlot(slot.connected, targetBlockId, innerSlotId, newBlock, edge),
    };
  });

  const updatedInnerSlots = block.innerSlots?.map(innerSlot => ({
    ...innerSlot,
    connected: innerSlot.connected?.map(innerBlock =>
      insertIntoInnerSlot(innerBlock, targetBlockId, innerSlotId, newBlock, edge)
    ),
  }));

  return {
    ...block,
    slots: updatedSlots,
    innerSlots: updatedInnerSlots,
  };
}

/**
 * Helper: Remove a block from the tree
 */
function removeBlock(block, targetBlockId) {
  // Clear slot connections that reference the target
  const updatedSlots = block.slots?.map(slot => {
    if (slot.connected?.id === targetBlockId) {
      return { ...slot, connected: null };
    }
    if (slot.connected) {
      return {
        ...slot,
        connected: removeBlock(slot.connected, targetBlockId),
      };
    }
    return slot;
  });

  // Filter out from inner slots
  const updatedInnerSlots = block.innerSlots?.map(innerSlot => ({
    ...innerSlot,
    connected: innerSlot.connected
      ?.filter(b => b.id !== targetBlockId)
      .map(b => removeBlock(b, targetBlockId)),
  }));

  return {
    ...block,
    slots: updatedSlots,
    innerSlots: updatedInnerSlots,
  };
}

/**
 * CompactCanvas - Smaller canvas for inline use (e.g., in forms)
 */
export function CompactCanvas({
  rootBlock,
  onChange,
  disabled = false,
  placeholder = "Drop a block",
}) {
  const handleCanvasDrop = useCallback((block, isPalette) => {
    const newBlock = isPalette ? cloneBlock(block) : block;
    onChange(newBlock);
  }, [onChange]);

  const { ref, isOver, dropProps } = useDroppableCanvas({
    disabled,
    onDrop: handleCanvasDrop,
  });

  const handleSlotConnect = useCallback((parentBlockId, slotId, droppedBlock, isPalette) => {
    if (!rootBlock) return;
    const blockToInsert = isPalette ? cloneBlock(droppedBlock) : droppedBlock;
    const updatedRoot = updateBlockSlot(rootBlock, parentBlockId, slotId, blockToInsert);
    onChange(updatedRoot);
  }, [rootBlock, onChange]);

  const handleRemove = useCallback((blockId) => {
    if (!rootBlock) return;
    if (rootBlock.id === blockId) {
      onChange(null);
      return;
    }
    const updatedRoot = removeBlock(rootBlock, blockId);
    onChange(updatedRoot);
  }, [rootBlock, onChange]);

  return (
    <div
      ref={ref}
      {...dropProps}
      className={`
        compact-canvas
        min-h-[40px] p-2
        border border-dashed rounded
        transition-colors
        ${isOver ? "border-primary bg-primary/5" : "border-border"}
        ${disabled ? "opacity-50" : ""}
      `}
    >
      {rootBlock ? (
        <Block
          block={rootBlock}
          onSlotConnect={handleSlotConnect}
          onRemove={handleRemove}
        />
      ) : (
        <span className="text-xs text-muted-foreground">{placeholder}</span>
      )}
    </div>
  );
}
