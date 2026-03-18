// blocks/Slot.jsx
// ============================================================
// Slot component - a drop zone within a block that accepts connections
// ============================================================

import React from "react";
import { useDroppableSlot } from "./useBlockDnD";
import { BlockShape } from "../helpers/blockTypes";

/**
 * Slot - A connection point within a block where other blocks can snap
 *
 * Props:
 * - slot: Slot definition { id, label, accepts, connected }
 * - parentBlockId: ID of the parent block
 * - onConnect: (block, isPalette) => void
 * - renderConnected: (block) => ReactNode - for rendering connected block
 * - disabled: boolean
 */
export default function Slot({
  slot,
  parentBlockId,
  onConnect,
  renderConnected,
  disabled = false,
}) {
  const { ref, isOver, canDrop, dropProps } = useDroppableSlot({
    slot,
    parentBlockId,
    disabled,
    onConnect,
  });

  const hasConnection = !!slot.connected;

  return (
    <div
      ref={ref}
      {...dropProps}
      className={`
        slot
        inline-flex items-center justify-center
        min-w-[32px] min-h-[20px]
        transition-all duration-150
        ${hasConnection ? "" : `
          border-2 border-dashed rounded-full
          ${isOver && canDrop
            ? "border-white bg-white/20"
            : "border-white/40 bg-white/5"
          }
          ${isOver && !canDrop ? "border-red-400 bg-red-400/10" : ""}
        `}
      `}
    >
      {hasConnection ? (
        // Render the connected block
        renderConnected ? renderConnected(slot.connected) : (
          <span className="text-xs opacity-70">{slot.connected.label}</span>
        )
      ) : (
        // Empty slot placeholder
        <span className={`
          text-[10px] px-2 py-0.5
          ${isOver && canDrop ? "text-white" : "text-white/50"}
        `}>
          {slot.label || "?"}
        </span>
      )}
    </div>
  );
}

/**
 * InlineSlot - Slot rendered inline within block label
 * Used for operator blocks: [slot] + [slot]
 */
export function InlineSlot({
  slot,
  parentBlockId,
  onConnect,
  renderConnected,
  disabled = false,
}) {
  const { ref, isOver, canDrop, dropProps } = useDroppableSlot({
    slot,
    parentBlockId,
    disabled,
    onConnect,
  });

  const hasConnection = !!slot.connected;

  return (
    <span
      ref={ref}
      {...dropProps}
      className={`
        inline-slot
        inline-flex items-center
        ${hasConnection ? "" : `
          px-1.5 py-0.5
          border border-dashed rounded
          ${isOver && canDrop
            ? "border-white bg-white/20"
            : "border-white/30 bg-black/10"
          }
          ${isOver && !canDrop ? "border-red-400" : ""}
        `}
      `}
    >
      {hasConnection ? (
        renderConnected ? renderConnected(slot.connected) : (
          <span className="text-xs">{slot.connected.label}</span>
        )
      ) : (
        <span className="text-[10px] text-white/50 min-w-[16px] text-center">
          {slot.label || "?"}
        </span>
      )}
    </span>
  );
}

/**
 * LabeledSlot - Slot with a label prefix
 * Used for: "set [var] to [value]"
 */
export function LabeledSlot({
  label,
  slot,
  parentBlockId,
  onConnect,
  renderConnected,
  disabled = false,
}) {
  return (
    <span className="labeled-slot inline-flex items-center gap-1">
      {label && (
        <span className="text-xs text-white/70">{label}</span>
      )}
      <InlineSlot
        slot={slot}
        parentBlockId={parentBlockId}
        onConnect={onConnect}
        renderConnected={renderConnected}
        disabled={disabled}
      />
    </span>
  );
}

/**
 * CBlockInner - Drop zone inside a C-block for statement blocks
 */
export function CBlockInner({
  innerSlot,
  parentBlockId,
  onInsert,
  renderBlocks,
  disabled = false,
}) {
  // This is a special drop zone that accepts statement blocks
  const hasBlocks = innerSlot?.connected?.length > 0;

  return (
    <div
      className={`
        c-block-inner
        ml-4 my-1.5 p-2
        min-h-[32px]
        bg-black/15 rounded
        border border-dashed border-white/20
      `}
    >
      {hasBlocks ? (
        renderBlocks(innerSlot.connected)
      ) : (
        <div className="text-[10px] text-white/40 text-center py-1">
          drop blocks here
        </div>
      )}
    </div>
  );
}
