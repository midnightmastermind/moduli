// blocks/index.js
// ============================================================
// Main exports for the visual block programming system
// ============================================================

// Core types and utilities
export {
  BlockType,
  BlockShape,
  BLOCK_COLORS,
  BLOCK_PALETTE,
  getBlockShape,
  createBlock,
  getPaletteCategories,
  createFieldBlocks,
  createFieldBlock,
  cloneBlock,
  canAcceptBlock,
} from "../helpers/blockTypes";

// Drag and drop hooks
export {
  BlockDragProvider,
  useBlockDragContext,
  useDraggableBlock,
  useDroppableSlot,
  useDroppableCanvas,
  useDroppableBlockStack,
  useSortableBlock,
} from "./useBlockDnD";

// Block evaluation
export {
  evaluateBlock,
  evaluateBlockTree,
  validateBlockTree,
  describeBlock,
  serializeBlockTree,
  deserializeBlockTree,
} from "../helpers/blockEvaluator";

// Components
export { default as Block, PaletteBlock, BlockStack } from "./Block";
export { default as Slot, InlineSlot, LabeledSlot, CBlockInner } from "./Slot";
export { default as BlockPalette, MiniPalette, SearchablePalette } from "./BlockPalette";
export { default as OperationsCanvas, CompactCanvas } from "./OperationsCanvas";
export { default as OperationsBuilder, useOperationsBuilder, PipelineEditor } from "./OperationsBuilder";
