// docs/CellEmbedContext.js
// Per-cell context that lets a table cell's <Editor> broadcast its column's
// displayFieldId down into the moduleEmbed NodeView without touching the
// global GridActionsContext (which is shared across every editor on the page).
//
// Usage:
//   Provider — <CellEmbedContext.Provider value={{ displayFieldId }}>
//               wraps the EditorContent inside a cell Editor.
//   Consumer — useContext(CellEmbedContext) inside ModuleEmbedNode.
//
// When displayFieldId is null/undefined the consumer falls through to the
// normal full-instance render, byte-identical to doc mode.

import { createContext } from "react";

// fieldFilter — optional embed-render filter set by the enclosing table
// column. Shape: { mode: "show" | "hide", fieldIds: string[] }.
//   - "show": only those field IDs render in the embed (whitelist).
//   - "hide": those field IDs are skipped; everything else renders (blacklist).
//   - null/undefined: no filter, full render.
// Independent of `displayFieldId` (which projects ONE field as a compact
// pill). Column authors pick either single-field projection OR a multi-
// field show/hide list, not both — but they don't conflict if both are set,
// `displayFieldId` wins for the projected-cell render path.
export const CellEmbedContext = createContext({
  displayFieldId: null,
  fieldFilter: null,
});
