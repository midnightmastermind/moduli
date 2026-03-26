// GridLiveContext.js
// Frequently-changing values separated from GridActionsContext (C4).
// Only consumers that need computedValues/activeCell subscribe here,
// preventing 200+ components from re-rendering on every operation execution.
import { createContext } from "react";

export const GridLiveContext = createContext({
  computedValues: Object.create(null),
  isMobile: false,
  activeCell: null,
  setActiveCell: () => {},
  zoomedOut: false,
  setZoomedOut: () => {},
  canUndo: false,
  canRedo: false,
  undo: () => {},
  redo: () => {},
  isProcessing: false,
});
