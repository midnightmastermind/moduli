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

// fieldVisibility — optional embed-render field-visibility set by the
// enclosing table column. Shape: { mode: "show" | "hide", fieldIds: string[] }.
//   - "show": only those field IDs render in the embed (whitelist).
//   - "hide": those field IDs are skipped; everything else renders (blacklist).
//   - null/undefined: no column-level override — the occurrence's own
//     cascade-resolved field-visibility (ancestor chain) applies instead.
// This is the per-column LOCAL override; it wins over the occurrence-level
// cascade when set. Independent of `displayFieldId` (which projects ONE
// field as a compact pill). When both are set, `displayFieldId` wins for
// the projected-cell render path.
// hideLabel — optional flag set by the enclosing table column to suppress the
// ModuleInstance row's label (the instance/task name). Useful for narrow
// "Date" / "Time" projection columns where the label is repetitive across
// rows (every row's task is already shown in the Task column).
// __inCell — true ONLY when provided by a table cell (StaticCellEmbed or the
// cell <Editor>). Default false so consumers can detect "am I inside a table
// cell" (the default context object is otherwise truthy).
// showMedia — optional flag set by the enclosing table column. When true, the
// cell's ModuleInstance will surface its role:"media" field binding as a
// media block under label + fields — mirroring the board/list render. When
// false (default in cells), media is suppressed inside the cell.
export const CellEmbedContext = createContext({
  displayFieldId: null,
  fieldVisibility: null,
  hideLabel: false,
  showMedia: false,
  __inCell: false,
});
