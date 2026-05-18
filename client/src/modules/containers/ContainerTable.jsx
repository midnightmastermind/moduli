// modules/containers/ContainerTable.jsx
// Layout-only table container. Grid lives in occurrence.meta.table.
// Task 9: cells are live TipTap editors (mode="cell") with spreadsheet nav
// and debounced persistence into occurrence.meta.table.cells[key].
import React, { useMemo, useCallback, useState, useRef, useEffect, useContext } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} from "@tanstack/react-table";
import { MoreVertical, ChevronUp, ChevronDown, Hash } from "lucide-react";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { cellKey, emptyCellDoc, getCellSortValue, deleteColumn, insertColumn } from "../../helpers/tableCells";
import { GridActionsContext } from "../../GridActionsContext";
import { uid } from "../../uid";
import Editor from "../../ui/Editor.jsx";
import CategoryPathPicker from "../../ui/CategoryPathPicker.jsx";

const DEFAULT_TABLE = () => ({
  columns: [
    { id: "tcol_a", title: "Column 1", width: 160, displayFieldId: null, sort: null, filter: null },
    { id: "tcol_b", title: "Column 2", width: 160, displayFieldId: null, sort: null, filter: null },
  ],
  rowCount: 4,
  cells: {},
});

// DEBOUNCE_MS mirrors Editor.jsx's internal persistContent delay (500ms).
const DEBOUNCE_MS = 500;

// ── TableCell ────────────────────────────────────────────────────────────────
// Renders one live TipTap cell editor. onChange is debounced and persists the
// new JSON into occurrence.meta.table.cells[key] via the outer `persist`.
//
// Stale-cells safety: we must not close over the `cells` object captured at
// render time because multiple cells share ONE occurrence.meta.table. If two
// cells are edited concurrently and both flush from a stale snapshot they will
// clobber each other.  Solution: `tableRef` (a ref to the latest `table`
// object) is passed in and read at flush time, so each flush always builds
// nextCells from the FRESHEST cells map — never from the closure snapshot.
//
// No-remount guarantee: stable `key={cellKey(r,c)}` on the wrapper div keeps
// React from tearing down this component across data changes.  `initialContent`
// is a ref so the `content` prop passed to Editor is the mount-time snapshot
// only — TipTap is uncontrolled after mount and manages its own doc state.
function TableCell({ r, c, tableRef, persist, onCellCommitMove, cellRefs, dispatch, socket, displayFieldId }) {
  const key = cellKey(r, c);

  // Seed TipTap once at mount — never update this ref so the Editor's content
  // prop is stable across re-renders (TipTap is uncontrolled after mount).
  const initialContent = useRef(tableRef.current.cells[key] || emptyCellDoc());

  // Debounce timer ref — flushed (not merely cleared) on blur/unmount so the
  // last edit is never silently dropped.
  const debounceTimer = useRef(null);

  // Latest pending doc — written by handleChange so blur/unmount can flush
  // the exact value the debounce would have persisted.
  const pendingDocRef = useRef(null);

  // Forward ref so cellRefs can call editor.commands.focus() on this cell.
  const editorRef = useRef(null);

  // Register / unregister the focus handle in the shared cellRefs map.
  useEffect(() => {
    cellRefs.current.set(key, () => {
      // editorRef.current is the imperative handle: { editor, ... }
      editorRef.current?.editor?.commands?.focus?.();
    });
    return () => {
      cellRefs.current.delete(key);
    };
  // key is stable for the lifetime of this cell instance — no deps needed
  // beyond mount/unmount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush last edit on unmount instead of silently dropping it.
  // CommitHelpers/store dispatch is safe on unmount; no local setState called.
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
        if (pendingDocRef.current !== null) {
          const latestTable = tableRef.current;
          const nextCells = { ...latestTable.cells, [key]: pendingDocRef.current };
          persist({ ...latestTable, cells: nextCells });
          pendingDocRef.current = null;
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = useCallback((newDoc) => {
    // Track the latest pending doc so blur/unmount can flush it.
    pendingDocRef.current = newDoc;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      pendingDocRef.current = null;
      // Read the LATEST table from the ref so concurrent edits in other cells
      // are not clobbered.  Never use the stale `cells` from closure scope.
      const latestTable = tableRef.current;
      const nextCells = { ...latestTable.cells, [key]: newDoc };
      persist({ ...latestTable, cells: nextCells });
    }, DEBOUNCE_MS);
  }, [key, tableRef, persist]);

  // Immediate-flush on blur: Editor calls onBlur(json) with the current doc.
  // Cancel the debounce and persist immediately so navigating away never
  // drops up to DEBOUNCE_MS of edits.
  const handleBlur = useCallback((blurDoc) => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    pendingDocRef.current = null;
    const latestTable = tableRef.current;
    const nextCells = { ...latestTable.cells, [key]: blurDoc };
    tableRef.current = { ...latestTable, cells: nextCells };
    persist({ ...latestTable, cells: nextCells });
  }, [key, tableRef, persist]);

  return (
    <div className="table-td" data-r={r} data-c={c}>
      <Editor
        ref={editorRef}
        mode="cell"
        editable
        content={initialContent.current}
        onChange={handleChange}
        onBlur={handleBlur}
        onCellCommitMove={onCellCommitMove}
        dispatch={dispatch}
        socket={socket}
        placeholder=""
        displayFieldId={displayFieldId ?? null}
      />
    </div>
  );
}

export default function ContainerTable({ occurrence, dispatch, socket }) {
  const { occurrencesById, modulesById, fieldsById } = useContext(GridActionsContext);

  const table = useMemo(() => occurrence?.meta?.table || DEFAULT_TABLE(), [occurrence?.meta?.table]);
  const { columns, rowCount, cells } = table;

  // tableRef always holds the latest table so TableCell.handleChange reads
  // fresh cells at flush time (avoids concurrent-edit data loss).
  const tableRef = useRef(table);
  useEffect(() => { tableRef.current = table; }, [table]);

  // cellRefs: key → focus-handle function.  Populated by each TableCell on mount.
  const cellRefs = useRef(new Map());

  // ── Focus navigation ─────────────────────────────────────────────────────
  // nextCoord: given current (r,c) and a direction, return the neighbour cell
  // clamped to grid bounds.
  const nextCoord = useCallback((r, c, dir) => {
    const maxR = tableRef.current.rowCount - 1;
    const maxC = tableRef.current.columns.length - 1;
    if (dir === "down")  return { r: Math.min(r + 1, maxR), c };
    if (dir === "up")    return { r: Math.max(r - 1, 0), c };
    if (dir === "right") return { r, c: Math.min(c + 1, maxC) };
    if (dir === "left")  return { r, c: Math.max(c - 1, 0) };
    return { r, c };
  }, []);

  const focusCell = useCallback(({ r, c }) => {
    const handle = cellRefs.current.get(cellKey(r, c));
    handle?.();
  }, []);

  // Kebab menu state: { colIndex, anchor }
  const [kebabOpen, setKebabOpen] = useState(null);

  // Field picker: which column is showing the "Show field" picker
  const [fieldPickerCol, setFieldPickerCol] = useState(null);

  // Resize state: { colIndex, startX, startWidth }
  const [resizing, setResizing] = useState(null);

  // Ref to active resize handlers for cleanup on unmount
  const resizeHandlersRef = useRef(null);

  // Cleanup resize listeners if component unmounts mid-drag
  useEffect(() => () => {
    const h = resizeHandlersRef.current;
    if (h) {
      window.removeEventListener("pointermove", h.onMove);
      window.removeEventListener("pointerup", h.onUp);
    }
  }, []);

  const persist = useCallback((nextTable) => {
    // Sync the ref immediately so any other cell that flushes within the same
    // JS tick reads the post-write snapshot rather than a stale pre-write one.
    // The useEffect that keeps tableRef current only runs after React's commit
    // phase, which is too late when two debounce timers fire in the same tick.
    tableRef.current = nextTable;
    CommitHelpers.updateOccurrence({
      dispatch,
      socket,
      occurrence: {
        id: occurrence.id,
        meta: { ...(occurrence.meta || {}), table: nextTable },
      },
    });
  }, [occurrence?.id, occurrence?.meta, socket, dispatch]);

  const rows = useMemo(() => Array.from({ length: rowCount }, (_, r) => r), [rowCount]);

  // Build TanStack column definitions
  const tanstackColumns = useMemo(() =>
    columns.map((col, idx) => ({
      id: col.id,
      accessorFn: (row) => {
        const doc = cells[cellKey(row.r, idx)] || emptyCellDoc();
        return getCellSortValue(doc, col, { occurrencesById, modulesById });
      },
      header: col.title,
      meta: { colDef: col, colIdx: idx },
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [columns, cells, occurrencesById, modulesById]);

  const tanstackData = useMemo(() => rows.map(r => ({ r })), [rows]);

  // Built now; consumed by Task 12 (view-only sort/filter). Intentionally unused here.
  // eslint-disable-next-line no-unused-vars
  const tableInstance = useReactTable({
    data: tanstackData,
    columns: tanstackColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  // --- Column title inline editing ---
  const handleTitleBlur = useCallback((colIndex, newTitle) => {
    const trimmed = newTitle.trim();
    if (trimmed === columns[colIndex].title) return;
    const nextCols = columns.map((c, i) =>
      i === colIndex ? { ...c, title: trimmed || c.title } : c
    );
    persist({ ...table, columns: nextCols });
  }, [columns, persist, table]);

  const handleTitleKeyDown = useCallback((e) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    }
  }, []);

  // --- Sort cycling: null → "asc" → "desc" → null ---
  const handleSortClick = useCallback((colIndex) => {
    const col = columns[colIndex];
    const next = col.sort === null ? "asc" : col.sort === "asc" ? "desc" : null;
    const nextCols = columns.map((c, i) =>
      i === colIndex ? { ...c, sort: next } : c
    );
    persist({ ...table, columns: nextCols });
  }, [columns, persist, table]);

  // --- Kebab menu toggle ---
  const handleKebabClick = useCallback((e, colIndex) => {
    e.stopPropagation();
    setKebabOpen(prev =>
      prev?.colIndex === colIndex ? null : { colIndex }
    );
  }, []);

  // --- Delete column (from kebab) ---
  const handleDeleteColumn = useCallback((colIndex) => {
    setKebabOpen(null);
    const nextTable = deleteColumn(table, colIndex);
    persist(nextTable);
  }, [table, persist]);

  // --- Set displayFieldId on a column (from kebab "Show field" picker) ---
  // Pass fieldId=null to clear (show full instance embed instead of single field).
  const handleSetDisplayField = useCallback((colIndex, fieldId) => {
    setFieldPickerCol(null);
    setKebabOpen(null);
    const nextCols = columns.map((c, i) =>
      i === colIndex ? { ...c, displayFieldId: fieldId || null } : c
    );
    persist({ ...table, columns: nextCols });
  }, [columns, persist, table]);

  // Build the field picker config — reuse the same CategoryPathPicker pattern
  // as InstanceForm's FieldsSection: single flat category, one-click commit.
  const allFields = useMemo(
    () => Object.values(fieldsById || {}),
    [fieldsById],
  );
  const buildFieldPickerConfig = useCallback((colIndex) => {
    const currentFieldId = columns[colIndex]?.displayFieldId;
    return {
      placeholder: currentFieldId ? "Change field…" : "Pick a field…",
      categories: [{
        id: "fields",
        label: "Pick a field to display",
        description: "Shows a single field value instead of the full instance form.",
        icon: Hash,
        color: "rgba(168,85,247,0.7)",
        resolveItems: () => allFields.map(f => ({
          value: f.id,
          title: f.name || "(unnamed field)",
          sub: f.type || "field",
          description: f.meta?.description || `${f.type || "field"} field`,
          hasChildren: false,
        })),
      }],
    };
  }, [allFields, columns]);

  // --- Resize column ---
  const handleResizePointerDown = useCallback((e, colIndex) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = columns[colIndex].width || 160;
    setResizing({ colIndex, startX, startWidth });

    const onMove = (moveE) => {
      const delta = moveE.clientX - startX;
      const newWidth = Math.max(60, startWidth + delta);
      // Live update via DOM for smoothness (no persist during drag)
      setResizing(r => r ? { ...r, currentWidth: newWidth } : r);
    };
    const onUp = (upE) => {
      const delta = upE.clientX - startX;
      const newWidth = Math.max(60, startWidth + delta);
      const nextCols = columns.map((c, i) =>
        i === colIndex ? { ...c, width: newWidth } : c
      );
      persist({ ...table, columns: nextCols });
      setResizing(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      resizeHandlersRef.current = null;
    };
    resizeHandlersRef.current = { onMove, onUp };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [columns, persist, table]);

  // --- Add column ---
  const handleAddColumn = useCallback(() => {
    const n = columns.length + 1;
    const colDef = {
      id: "tcol_" + uid(),
      title: "Column " + n,
      width: 160,
      displayFieldId: null,
      sort: null,
      filter: null,
    };
    const nextTable = insertColumn(table, columns.length, colDef);
    persist(nextTable);
  }, [columns.length, table, persist]);

  // --- Add row ---
  const handleAddRow = useCallback(() => {
    persist({ ...table, rowCount: rowCount + 1 });
  }, [table, rowCount, persist]);

  // --- Remove last row ---
  const handleRemoveLastRow = useCallback(() => {
    if (rowCount > 1) persist({ ...table, rowCount: rowCount - 1 });
  }, [table, rowCount, persist]);

  // Close kebab (and field picker) on outside click
  const containerRef = useRef(null);
  React.useEffect(() => {
    if (!kebabOpen) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setKebabOpen(null);
        setFieldPickerCol(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [kebabOpen]);

  // Compute effective column widths (accounting for live resize)
  const effectiveWidths = columns.map((c, i) => {
    if (resizing && resizing.colIndex === i && resizing.currentWidth != null) {
      return resizing.currentWidth;
    }
    return c.width || 160;
  });

  return (
    <div className="table-container" data-occ-id={occurrence?.id} ref={containerRef}>
      <div
        className="table-grid"
        style={{
          gridTemplateColumns: effectiveWidths.map(w => `${w}px`).join(" ") + " auto",
        }}
      >
        {/* Header row */}
        {columns.map((col, c) => (
          <div key={col.id} className="table-th">
            <div className="table-th-inner">
              <input
                className="table-th-title"
                defaultValue={col.title}
                onBlur={(e) => handleTitleBlur(c, e.currentTarget.value)}
                onKeyDown={(e) => handleTitleKeyDown(e)}
              />
              <div className="table-th-actions">
                <button
                  className="table-sort-btn"
                  title={col.sort === "asc" ? "Sort ascending" : col.sort === "desc" ? "Sort descending" : "No sort"}
                  onClick={() => handleSortClick(c)}
                >
                  {col.sort === "asc" ? (
                    <ChevronUp size={11} />
                  ) : col.sort === "desc" ? (
                    <ChevronDown size={11} />
                  ) : (
                    <span className="table-sort-inactive">↕</span>
                  )}
                </button>
                <div className="table-kebab-wrap">
                  <button
                    className="table-kebab-btn"
                    title="Column options"
                    onClick={(e) => handleKebabClick(e, c)}
                  >
                    <MoreVertical size={12} />
                  </button>
                  {kebabOpen?.colIndex === c && (
                    <div className="table-kebab-menu">
                      {/* Show field picker or the Show field trigger */}
                      {fieldPickerCol === c ? (
                        <div className="table-kebab-field-picker">
                          <CategoryPathPicker
                            value=""
                            onChange={(picked) => {
                              const fieldId = picked ? picked.split(".").pop() : null;
                              handleSetDisplayField(c, fieldId || null);
                            }}
                            ctx={{ fields: allFields, sources: [], localVars: [] }}
                            config={buildFieldPickerConfig(c)}
                          />
                          {col.displayFieldId && (
                            <button
                              className="table-kebab-item table-kebab-clear-field"
                              onClick={() => handleSetDisplayField(c, null)}
                            >
                              Clear field display
                            </button>
                          )}
                          <button
                            className="table-kebab-item"
                            onClick={() => setFieldPickerCol(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className="table-kebab-item"
                          onClick={() => setFieldPickerCol(c)}
                        >
                          {col.displayFieldId
                            ? `Field: ${fieldsById?.[col.displayFieldId]?.name || col.displayFieldId}`
                            : "Show field…"}
                        </button>
                      )}
                      <button
                        className="table-kebab-item table-kebab-delete"
                        onClick={() => handleDeleteColumn(c)}
                      >
                        Delete column
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {/* Resize grip */}
            <div
              className="table-resize-grip"
              onPointerDown={(e) => handleResizePointerDown(e, c)}
            />
          </div>
        ))}

        {/* +Column button header cell */}
        <div className="table-th table-add-col-th">
          <button className="table-add-col-btn" onClick={handleAddColumn} title="Add column">
            + column
          </button>
        </div>

        {/* Data rows */}
        {rows.map((r) => (
          <React.Fragment key={r}>
            {columns.map((col, c) => (
              <TableCell
                key={cellKey(r, c)}
                r={r}
                c={c}
                tableRef={tableRef}
                persist={persist}
                onCellCommitMove={(dir) => focusCell(nextCoord(r, c, dir))}
                cellRefs={cellRefs}
                dispatch={dispatch}
                socket={socket}
                displayFieldId={col.displayFieldId ?? null}
              />
            ))}
            {/* Trailing-row removal button — aligned to +column cell */}
            <div className="table-td table-row-action-cell">
              {r === rowCount - 1 && (
                <button
                  className="table-remove-row-btn"
                  title="Remove last row"
                  onClick={handleRemoveLastRow}
                >
                  –
                </button>
              )}
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* Footer +row */}
      <div className="table-footer">
        <button className="table-add-row-btn" onClick={handleAddRow}>
          + row
        </button>
      </div>
    </div>
  );
}
