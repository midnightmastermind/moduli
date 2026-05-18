// modules/containers/ContainerTable.jsx
// Layout-only table container. Grid lives in occurrence.meta.table.
// Rows/cols/cells are NOT entities. Cells are static plain-text this task;
// live editors come in Task 9.
import React, { useMemo, useCallback, useState, useRef, useContext } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} from "@tanstack/react-table";
import { MoreVertical, ChevronUp, ChevronDown } from "lucide-react";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { cellKey, emptyCellDoc, plainText, getCellSortValue, deleteColumn, insertColumn } from "../../helpers/tableCells";
import { GridActionsContext } from "../../GridActionsContext";
import { uid } from "../../uid";

const DEFAULT_TABLE = () => ({
  columns: [
    { id: "tcol_a", title: "Column 1", width: 160, displayFieldId: null, sort: null, filter: null },
    { id: "tcol_b", title: "Column 2", width: 160, displayFieldId: null, sort: null, filter: null },
  ],
  rowCount: 4,
  cells: {},
});

export default function ContainerTable({ occurrence, dispatch, socket }) {
  const { occurrencesById, modulesById } = useContext(GridActionsContext);

  const table = occurrence?.meta?.table || DEFAULT_TABLE();
  const { columns, rowCount, cells } = table;

  // Kebab menu state: { colIndex, anchor }
  const [kebabOpen, setKebabOpen] = useState(null);

  // Resize state: { colIndex, startX, startWidth }
  const [resizing, setResizing] = useState(null);

  // eslint-disable-next-line no-unused-vars
  const persist = useCallback((nextTable) => {
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

  const handleTitleKeyDown = useCallback((e, colIndex) => {
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
    };
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
  const handleRemoveLastRow = useCallback((r) => {
    if (r !== rowCount - 1) return; // only trailing row
    persist({ ...table, rowCount: Math.max(0, rowCount - 1) });
  }, [table, rowCount, persist]);

  // Close kebab on outside click
  const containerRef = useRef(null);
  React.useEffect(() => {
    if (!kebabOpen) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setKebabOpen(null);
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
          <div key={col.id} className="table-th" style={{ position: "relative" }}>
            <div className="table-th-inner">
              <input
                className="table-th-title"
                defaultValue={col.title}
                onBlur={(e) => handleTitleBlur(c, e.currentTarget.value)}
                onKeyDown={(e) => handleTitleKeyDown(e, c)}
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
            {columns.map((col, c) => {
              const doc = cells[cellKey(r, c)] || emptyCellDoc();
              return (
                <div key={`${r}:${c}`} className="table-td" data-r={r} data-c={c}>
                  {plainText(doc)}
                </div>
              );
            })}
            {/* Trailing-row removal button — aligned to +column cell */}
            <div className="table-td table-row-action-cell">
              {r === rowCount - 1 && (
                <button
                  className="table-remove-row-btn"
                  title="Remove last row"
                  onClick={() => handleRemoveLastRow(r)}
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
