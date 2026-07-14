// blocks/Block.jsx
// ============================================================
// Block component - renders a single block with its slots
// Inspired by Snap!/Scratch visual programming blocks
// ============================================================

import React, { useCallback } from "react";
import { useDraggableBlock } from "./useBlockDnD";
import { BlockType, BlockShape, BLOCK_COLORS } from "../helpers/blockTypes";
import { InlineSlot, CBlockInner } from "./Slot";
import { X } from "lucide-react";

/**
 * Block - Renders a single block with appropriate shape and slots
 *
 * Props:
 * - block: Block definition
 * - nested: boolean - if true, this is rendered inside a slot (smaller)
 * - isPalette: boolean - if true, this is a palette block (always copy on drag)
 * - onSlotConnect: (blockId, slotId, droppedBlock, isPalette) => void
 * - onInnerInsert: (blockId, innerSlotId, droppedBlock, isPalette, edge) => void
 * - onRemove: (blockId) => void
 * - disabled: boolean
 */
export default function Block({
  block,
  nested = false,
  isPalette = false,
  onSlotConnect,
  onInnerInsert,
  onRemove,
  disabled = false,
}) {
  const { ref, isDragging, dragProps } = useDraggableBlock({
    block,
    disabled,
    isPalette,
  });

  // Handle slot connection
  const handleConnect = useCallback((slotId) => (droppedBlock, isPaletteBlock) => {
    onSlotConnect?.(block.id, slotId, droppedBlock, isPaletteBlock);
  }, [block.id, onSlotConnect]);

  // Handle inner block insertion
  const handleInnerInsert = useCallback((innerSlotId) => (droppedBlock, isPaletteBlock, edge) => {
    onInnerInsert?.(block.id, innerSlotId, droppedBlock, isPaletteBlock, edge);
  }, [block.id, onInnerInsert]);

  // Render connected block recursively
  const renderConnected = useCallback((connectedBlock) => (
    <Block
      block={connectedBlock}
      nested={true}
      onSlotConnect={onSlotConnect}
      onInnerInsert={onInnerInsert}
      onRemove={onRemove}
    />
  ), [onSlotConnect, onInnerInsert, onRemove]);

  // Render inner blocks for C-blocks
  const renderInnerBlocks = useCallback((blocks) => (
    <div className="block-stack space-y-1">
      {blocks.map((innerBlock, idx) => (
        <Block
          key={innerBlock.id}
          block={innerBlock}
          onSlotConnect={onSlotConnect}
          onInnerInsert={onInnerInsert}
          onRemove={onRemove}
        />
      ))}
    </div>
  ), [onSlotConnect, onInnerInsert, onRemove]);

  // Get shape-specific classes
  const shapeClass = getShapeClass(block.shape, nested);
  const colorClass = BLOCK_COLORS[block.type] || "bg-gray-500";

  return (
    <div
      ref={ref}
      {...dragProps}
      className={`
        block-wrapper
        relative inline-flex items-center
        text-white font-medium
        cursor-grab active:cursor-grabbing
        select-none
        transition-opacity
        ${shapeClass}
        ${colorClass}
        ${isDragging ? "opacity-50" : "opacity-100"}
        ${nested ? "text-xs" : "text-sm"}
      `}
    >
      {/* Remove button (not on palette blocks or nested) */}
      {!isPalette && !nested && onRemove && (
        <button
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(block.id);
          }}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}

      {/* Block content based on type */}
      {renderBlockContent({
        block,
        nested,
        handleConnect,
        handleInnerInsert,
        renderConnected,
        renderInnerBlocks,
        disabled,
      })}
    </div>
  );
}

/**
 * Render the block content based on its type
 */
function renderBlockContent({
  block,
  nested,
  handleConnect,
  handleInnerInsert,
  renderConnected,
  renderInnerBlocks,
  disabled,
}) {
  switch (block.type) {
    // ============================================================
    // VALUE BLOCKS (no slots)
    // ============================================================
    case BlockType.FIELD:
    case BlockType.LITERAL:
    case BlockType.VARIABLE:
      return <span>{block.label}</span>;

    // ============================================================
    // BINARY OPERATORS: [left] op [right]
    // ============================================================
    case BlockType.OPERATOR:
    case BlockType.COMPARISON: {
      const leftSlot = block.slots?.find(s => s.id === "left");
      const rightSlot = block.slots?.find(s => s.id === "right");

      return (
        <div className="flex items-center gap-1">
          {leftSlot && (
            <InlineSlot
              slot={leftSlot}
              parentBlockId={block.id}
              onConnect={handleConnect("left")}
              renderConnected={renderConnected}
              disabled={disabled}
            />
          )}
          <span className="px-1">{block.label}</span>
          {rightSlot && (
            <InlineSlot
              slot={rightSlot}
              parentBlockId={block.id}
              onConnect={handleConnect("right")}
              renderConnected={renderConnected}
              disabled={disabled}
            />
          )}
        </div>
      );
    }

    // ============================================================
    // LOGICAL OPERATORS
    // ============================================================
    case BlockType.LOGICAL: {
      if (block.data.op === "not") {
        const valueSlot = block.slots?.find(s => s.id === "value");
        return (
          <div className="flex items-center gap-1">
            <span>NOT</span>
            {valueSlot && (
              <InlineSlot
                slot={valueSlot}
                parentBlockId={block.id}
                onConnect={handleConnect("value")}
                renderConnected={renderConnected}
                disabled={disabled}
              />
            )}
          </div>
        );
      }

      const leftSlot = block.slots?.find(s => s.id === "left");
      const rightSlot = block.slots?.find(s => s.id === "right");

      return (
        <div className="flex items-center gap-1">
          {leftSlot && (
            <InlineSlot
              slot={leftSlot}
              parentBlockId={block.id}
              onConnect={handleConnect("left")}
              renderConnected={renderConnected}
              disabled={disabled}
            />
          )}
          <span className="px-1">{block.label}</span>
          {rightSlot && (
            <InlineSlot
              slot={rightSlot}
              parentBlockId={block.id}
              onConnect={handleConnect("right")}
              renderConnected={renderConnected}
              disabled={disabled}
            />
          )}
        </div>
      );
    }

    // ============================================================
    // AGGREGATION: sum([field])
    // ============================================================
    case BlockType.AGGREGATION: {
      const sourceSlot = block.slots?.find(s => s.id === "source");

      return (
        <div className="flex items-center gap-1">
          <span>{block.label}</span>
          <span>(</span>
          {sourceSlot && (
            <InlineSlot
              slot={sourceSlot}
              parentBlockId={block.id}
              onConnect={handleConnect("source")}
              renderConnected={renderConnected}
              disabled={disabled}
            />
          )}
          <span>)</span>
        </div>
      );
    }

    // ============================================================
    // FUNCTION: fn([value])
    // ============================================================
    case BlockType.FUNCTION: {
      const valueSlot = block.slots?.find(s => s.id === "value");

      return (
        <div className="flex items-center gap-1">
          <span>{block.label}</span>
          <span>(</span>
          {valueSlot && (
            <InlineSlot
              slot={valueSlot}
              parentBlockId={block.id}
              onConnect={handleConnect("value")}
              renderConnected={renderConnected}
              disabled={disabled}
            />
          )}
          <span>)</span>
        </div>
      );
    }

    // ============================================================
    // CONDITION (C-block): if [condition] then { ... }
    // ============================================================
    case BlockType.CONDITION: {
      const conditionSlot = block.slots?.find(s => s.id === "condition");
      const thenSlot = block.innerSlots?.[0];

      return (
        <div className="flex flex-col">
          <div className="flex items-center gap-1">
            <span>if</span>
            {conditionSlot && (
              <InlineSlot
                slot={conditionSlot}
                parentBlockId={block.id}
                onConnect={handleConnect("condition")}
                renderConnected={renderConnected}
                disabled={disabled}
              />
            )}
            <span>then</span>
          </div>
          {thenSlot && (
            <CBlockInner
              innerSlot={thenSlot}
              parentBlockId={block.id}
              onInsert={handleInnerInsert(thenSlot.id)}
              renderBlocks={renderInnerBlocks}
              disabled={disabled}
            />
          )}
        </div>
      );
    }

    // ============================================================
    // LOOP (C-block): repeat [count] times { ... } / for each [item] in [collection] { ... }
    // ============================================================
    case BlockType.LOOP: {
      const innerSlot = block.innerSlots?.[0];

      if (block.data.loopType === "repeat") {
        const countSlot = block.slots?.find(s => s.id === "count");
        return (
          <div className="flex flex-col">
            <div className="flex items-center gap-1">
              <span>repeat</span>
              {countSlot && (
                <InlineSlot
                  slot={countSlot}
                  parentBlockId={block.id}
                  onConnect={handleConnect("count")}
                  renderConnected={renderConnected}
                  disabled={disabled}
                />
              )}
              <span>times</span>
            </div>
            {innerSlot && (
              <CBlockInner
                innerSlot={innerSlot}
                parentBlockId={block.id}
                onInsert={handleInnerInsert(innerSlot.id)}
                renderBlocks={renderInnerBlocks}
                disabled={disabled}
              />
            )}
          </div>
        );
      }

      // For each
      const collectionSlot = block.slots?.find(s => s.id === "collection");
      return (
        <div className="flex flex-col">
          <div className="flex items-center gap-1">
            <span>for each in</span>
            {collectionSlot && (
              <InlineSlot
                slot={collectionSlot}
                parentBlockId={block.id}
                onConnect={handleConnect("collection")}
                renderConnected={renderConnected}
                disabled={disabled}
              />
            )}
          </div>
          {innerSlot && (
            <CBlockInner
              innerSlot={innerSlot}
              parentBlockId={block.id}
              onInsert={handleInnerInsert(innerSlot.id)}
              renderBlocks={renderInnerBlocks}
              disabled={disabled}
            />
          )}
        </div>
      );
    }

    // ============================================================
    // SET VARIABLE: set [var] to [value]
    // ============================================================
    case BlockType.SET_VARIABLE: {
      const varSlot = block.slots?.find(s => s.id === "varName");
      const valueSlot = block.slots?.find(s => s.id === "value");

      return (
        <div className="flex items-center gap-1">
          <span>set</span>
          {varSlot && (
            <InlineSlot
              slot={varSlot}
              parentBlockId={block.id}
              onConnect={handleConnect("varName")}
              renderConnected={renderConnected}
              disabled={disabled}
            />
          )}
          <span>to</span>
          {valueSlot && (
            <InlineSlot
              slot={valueSlot}
              parentBlockId={block.id}
              onConnect={handleConnect("value")}
              renderConnected={renderConnected}
              disabled={disabled}
            />
          )}
        </div>
      );
    }

    // ============================================================
    // TRIGGERS (hat blocks)
    // ============================================================
    case BlockType.ON_DROP:
    case BlockType.ON_CHANGE:
      return <span>{block.label}</span>;

    // ============================================================
    // DEFAULT
    // ============================================================
    default:
      return <span>{block.label || block.type}</span>;
  }
}

/**
 * Get CSS classes for block shape
 */
function getShapeClass(shape, nested = false) {
  const size = nested ? "px-1.5 py-0.5" : "px-3 py-1.5";

  switch (shape) {
    case BlockShape.REPORTER:
      // Oval/pill shape
      return `rounded-full ${size}`;

    case BlockShape.STATEMENT:
      // Rectangle with notch styling
      return `rounded ${size}`;

    case BlockShape.C_BLOCK:
      // C-shape (rounded with internal structure)
      return `rounded-lg px-3 py-2`;

    case BlockShape.HAT:
      // Hat shape (rounded top, flat bottom)
      return `rounded-t-lg rounded-b ${size}`;

    case BlockShape.CAP:
      // Cap shape (flat top, rounded bottom)
      return `rounded-t rounded-b-lg ${size}`;

    default:
      return `rounded ${size}`;
  }
}

/**
 * PaletteBlock - A block in the palette (always copies on drag)
 */
export function PaletteBlock({ block, onDragStart }) {
  return (
    <Block
      block={block}
      isPalette={true}
      onSlotConnect={() => {}}
      onInnerInsert={() => {}}
    />
  );
}

/**
 * BlockStack - Vertical stack of statement blocks
 */
export function BlockStack({
  blocks = [],
  onSlotConnect,
  onInnerInsert,
  onReorder,
  onRemove,
}) {
  return (
    <div className="block-stack flex flex-col gap-1">
      {blocks.map((block) => (
        <Block
          key={block.id}
          block={block}
          onSlotConnect={onSlotConnect}
          onInnerInsert={onInnerInsert}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}
