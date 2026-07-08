// GridLiveContext.js
// Frequently-changing values separated from GridActionsContext (C4).
// Only consumers that need activeCell/undo/mobile state subscribe here.
// computedValues moved to state/computedValuesStore (per-key subscriptions) —
// riding here meant every op-drain display update re-rendered every consumer.
import { createContext } from "react";

export const GridLiveContext = createContext({
  fullStateLoaded: false,
  isTouch: false,
  isMobileLayout: false,
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
