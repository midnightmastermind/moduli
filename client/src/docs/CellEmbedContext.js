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

export const CellEmbedContext = createContext({
  displayFieldId: null,
});
