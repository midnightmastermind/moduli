// modules/containers/ContainerTable.jsx
// Layout-only table container. Grid lives in occurrence.meta.table.
// Rows/cols/cells are NOT entities. This task renders a static grid;
// live cell editors come in later tasks.
import React, { useMemo, useCallback } from "react";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { cellKey, emptyCellDoc, plainText } from "../../helpers/tableCells";

const DEFAULT_TABLE = () => ({
  columns: [
    { id: "tcol_a", title: "Column 1", width: 160, displayFieldId: null, sort: null, filter: null },
    { id: "tcol_b", title: "Column 2", width: 160, displayFieldId: null, sort: null, filter: null },
  ],
  rowCount: 4,
  cells: {},
});

export default function ContainerTable({ occurrence, dispatch, socket }) {
  const table = occurrence?.meta?.table || DEFAULT_TABLE();
  const { columns, rowCount, cells } = table;

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

  return (
    <div className="table-container" data-occ-id={occurrence?.id}>
      <div className="table-grid" style={{
        gridTemplateColumns: columns.map(c => `${c.width || 160}px`).join(" "),
      }}>
        {columns.map((col) => (
          <div key={col.id} className="table-th">{col.title}</div>
        ))}
        {rows.map((r) =>
          columns.map((col, c) => {
            const doc = cells[cellKey(r, c)] || emptyCellDoc();
            return (
              <div key={`${r}:${c}`} className="table-td" data-r={r} data-c={c}>
                {plainText(doc)}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
