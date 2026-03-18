// GridDataContext.js
import { createContext } from "react";

export const GridDataContext = createContext({
  state: {
    userId: null,
    gridId: null,
    grid: null,
    panels: [],
    containers: [],
    instances: [],
    occurrences: [],
    fields: [],
    activeId: null,
    activeSize: null,
    softTick: 0,
  },

  // used to render draft ordering during drag
  containersRender: [],

  // local re-render tick during drag (App state)
});