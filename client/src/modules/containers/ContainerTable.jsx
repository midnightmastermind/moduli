// modules/containers/ContainerTable.jsx
// Layout-only table container. Grid lives in occurrence.meta.table.
// Task 9: cells are live TipTap editors (mode="cell") with spreadsheet nav
// and debounced persistence into occurrence.meta.table.cells[key].
// Task 12: TanStack sort + per-column filter (view-only, never rewrites cells).
// Task 13: Row + column virtualization via @tanstack/react-virtual.
import React, { useMemo, useCallback, useState, useRef, useEffect, useContext } from "react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} from "@tanstack/react-table";
import { MoreVertical, ChevronUp, ChevronDown, Hash, Filter, X, Eye, Image as ImageIcon } from "lucide-react";
import { evalRule } from "../../helpers/operationActions";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { cellKey, emptyCellDoc, makeEmbedCellDoc, getCellSortValue, deleteColumn, insertColumn, fillRange, firstEmbedOccId } from "../../helpers/tableCells";
import { assignLinkedGroup } from "../../helpers/LayoutHelpers";
import { COMPARATOR_OPTIONS, UNARY_COMPARATORS } from "../../helpers/comparators";
import { GridActionsContext, useGridActions } from "../../GridActionsContext";
import { getEffectiveFieldVisibilityForOccurrence } from "../../state/selectors";
import {
  autoAppendFieldsToAncestorsShowMode,
  autoAppendFieldsToTableColumnShowMode,
} from "../../helpers/fieldVisibilityAutoAppend";
import { uid } from "../../uid";
import Editor from "../../ui/Editor.jsx";
import DrilldownPicker from "../../ui/DrilldownPicker.jsx";
import ModuleInstance from "../ModuleInstance.jsx";
import ModuleContainer from "../ModuleContainer.jsx";
import { CellEmbedContext } from "../../docs/CellEmbedContext.js";

// ── FilterValueWidget ─────────────────────────────────────────────────────────
// Minimal inline value-input for the column filter popover.
// The grid filter system's FilterNavWidget (FilterNavWidgets.jsx) is a nav-
// period widget (arrows/pills/select driven by filter metadata). It does not
// expose a general comparator+value pair input and requires a named filter
// object that doesn't exist in the per-column context. We therefore write a
// thin inline widget here that covers the same field types the grid filter
// widgets cover (text/number/date string inputs). Reads/writes a plain scalar
// or ISO string — the same shapes evalRule handles natively.
function FilterValueWidget({ comparator, value, onChange }) {
  if (UNARY_COMPARATORS.has(comparator)) return null;
  return (
    <input
      type="text"
      placeholder="value…"
      value={value ?? ""}
      onChange={e => onChange(e.target.value)}
      style={{
        width: "100%",
        height: 22,
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        padding: "0 5px",
        borderRadius: 3,
        background: "var(--input-bg)",
        border: "1px solid var(--input-border)",
        color: "var(--text-primary)",
        outline: "none",
        boxSizing: "border-box",
        marginTop: 3,
      }}
    />
  );
}

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
// StaticCellEmbed — renders a single embedded occurrence WITHOUT a TipTap
// editor (the non-active cell state). Mirrors ModuleEmbedNode's role branch
// for the cases tables actually use (instance / container). Wrapped in
// CellEmbedContext so ModuleInstance's field-visibility + hideLabel projection
// works identically to the editor path.
function StaticCellEmbed({ occId, occurrencesById, modulesById, dispatch, socket, displayFieldId, fieldVisibility, hideLabel, showMedia }) {
  const occurrence = occId ? occurrencesById?.[occId] : null;
  const mod = occurrence?.moduleId ? modulesById?.[occurrence.moduleId] : null;
  const ctxValue = useMemo(
    () => ({ displayFieldId, fieldVisibility, hideLabel, showMedia: !!showMedia, __inCell: true }),
    [displayFieldId, fieldVisibility, hideLabel, showMedia],
  );
  if (!occurrence || !mod) {
    return <div className="table-cell-static" style={{ minHeight: 18 }} />;
  }
  return (
    <CellEmbedContext.Provider value={ctxValue}>
      <div className="table-cell-static">
        {mod.role === "instance" ? (
          <ModuleInstance
            module={mod}
            occurrence={occurrence}
            dispatch={dispatch}
            socket={socket}
            embedSourceType="doc-embed"
            embedHideLabel={hideLabel === true}
          />
        ) : (
          <ModuleContainer
            module={mod}
            panel={null}
            dispatch={dispatch}
            socket={socket}
            occurrenceOverride={occurrence}
            embedSourceType="doc-embed"
          />
        )}
      </div>
    </CellEmbedContext.Provider>
  );
}

function TableCell({ r, c, initialDoc, tableRef, persist, onCellCommitMove, cellRefs, dispatch, socket, displayFieldId, fieldVisibility, hideLabel, showMedia, onFocusCell, onBlurCell, isFocused, fillMode, onFillPointerDown, onToggleFillMode, style }) {
  const key = cellKey(r, c);

  // Seed TipTap once at mount — never update this ref so the Editor's content
  // prop is stable across re-renders (TipTap is uncontrolled after mount).
  //
  // CRITICAL: must read from `initialDoc` PROP (current-render value passed by
  // the parent) — NOT from `tableRef.current.cells[key]`. The tableRef is
  // updated in a useEffect that runs AFTER commit, so during the first render
  // where this cell mounts, the ref still holds the PREVIOUS table snapshot.
  // For a cell that didn't exist before (rowCount went 0 → 6), the previous
  // snapshot has no entry for `key` → emptyCellDoc() forever (TipTap is
  // uncontrolled after mount, so a later ref update doesn't repopulate the
  // editor). Was the root cause of "table renders rows but every cell is
  // empty" right after the Schedule Table: Build op ran.
  const initialContent = useRef(initialDoc || emptyCellDoc());

  // Debounce timer ref — flushed (not merely cleared) on blur/unmount so the
  // last edit is never silently dropped.
  const debounceTimer = useRef(null);

  // Latest pending doc — written by handleChange so blur/unmount can flush
  // the exact value the debounce would have persisted.
  const pendingDocRef = useRef(null);

  // Forward ref so cellRefs can call editor.commands.focus() on this cell.
  const editorRef = useRef(null);

  // Lazy-editor: a cell that holds a single occurrence embed renders that
  // occurrence DIRECTLY (no TipTap) until it's focused or hovered. Mounting a
  // live <Editor mode="cell"> per cell meant ~24 TipTap instances on the
  // Schedule Table page — Firefox crawled to a crash. Now at most the focused
  // + hovered cell is a real editor; everything else is a plain ModuleInstance
  // (still interactive — checkboxes/fields work). Free-text cells (no embed)
  // always use the editor so typed content keeps working.
  const { occurrencesById, modulesById } = useGridActions() || {};
  const [hovered, setHovered] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const cellElRef = useRef(null);
  const embedOccId = useMemo(
    () => firstEmbedOccId(initialContent.current),
    [],
  );
  const showEditor = !embedOccId || isFocused || hovered;

  // Cell-level drop target — catches drops anywhere in the .table-td,
  // including the padding outside .doc-editor-wrapper, and drops onto cells
  // showing the StaticCellEmbed (where no Editor is mounted). The Editor's
  // own dropTargetForElements still fires for drops INSIDE the editor (it's
  // the innermost target, so pragmatic DnD routes there first) — this
  // handler is the fallback that makes cells with existing content drop-
  // able too. Resolves the dropped occurrence id, then either replaces an
  // empty cell with a moduleEmbed doc, or appends a moduleEmbed to a cell
  // with existing content.
  useEffect(() => {
    const el = cellElRef.current;
    if (!el) return;
    return dropTargetForElements({
      element: el,
      getData: () => ({ type: "table-cell", r, c }),
      canDrop: ({ source }) => {
        const t = source.data?.type;
        return t === "instance" || t === "module" || t === "container" || t === "artifact" || t === "textblock";
      },
      onDragEnter: () => setDropActive(true),
      onDragLeave: () => setDropActive(false),
      onDrop: ({ source }) => {
        setDropActive(false);
        const sd = source.data || {};
        // If the inner Editor is visible AND the user dropped into the
        // Editor's element specifically, the Editor's own drop handler
        // already fired (it's the innermost target). Bail to avoid double-
        // inserting. We detect this by checking whether `el` was the
        // outermost target — pragmatic DnD calls onDrop on every target in
        // the chain, but the Editor's onDrop runs BEFORE ours so we'd see
        // its insertion reflected in tableRef. Skip when the Editor is
        // showing — the doc-editor handler covers it.
        if (showEditor) return;

        let occId = sd.context?.occurrenceId || sd.occurrenceId;
        if (!occId && sd.id) {
          const existing = Object.values(occurrencesById || {}).find(o => o.moduleId === sd.id);
          if (existing) occId = existing.id;
        }
        if (!occId) return;

        const latestTable = tableRef.current;
        const currentDoc = latestTable.cells?.[key];
        const isEmpty = !currentDoc
          || (Array.isArray(currentDoc.content)
              && currentDoc.content.length === 1
              && currentDoc.content[0]?.type === "paragraph"
              && !currentDoc.content[0]?.content);

        let newDoc;
        if (isEmpty) {
          // Empty cell → embed at first position.
          newDoc = makeEmbedCellDoc(occId);
        } else {
          // Non-empty cell → append moduleEmbed at last position.
          const content = Array.isArray(currentDoc.content) ? currentDoc.content : [];
          newDoc = {
            ...currentDoc,
            type: currentDoc.type || "doc",
            content: [...content, { type: "moduleEmbed", attrs: { occurrenceId: occId } }],
          };
        }

        const nextCells = { ...latestTable.cells, [key]: newDoc };
        persist({ ...latestTable, cells: nextCells });
      },
    });
  }, [r, c, key, tableRef, persist, occurrencesById, showEditor]);

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
    <div
      ref={cellElRef}
      className={`table-td${isFocused || hovered ? " table-td-focused" : ""}${dropActive ? " table-td-drop-active" : ""}`}
      data-r={r}
      data-c={c}
      onFocus={onFocusCell}
      onBlur={onBlurCell}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={style}
    >
      {showEditor ? (
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
          fieldVisibility={fieldVisibility ?? null}
          hideLabel={hideLabel ?? false}
          showMedia={showMedia ?? false}
        />
      ) : (
        <StaticCellEmbed
          occId={embedOccId}
          occurrencesById={occurrencesById}
          modulesById={modulesById}
          dispatch={dispatch}
          socket={socket}
          displayFieldId={displayFieldId ?? null}
          fieldVisibility={fieldVisibility ?? null}
          hideLabel={hideLabel ?? false}
          showMedia={showMedia ?? false}
        />
      )}
      {(isFocused || hovered) && (
        <>
          {/* Fill handle nub — bottom-right corner */}
          <div
            className="table-fill-handle"
            onPointerDown={(e) => onFillPointerDown(e, r, c)}
            title="Fill down/right"
          />
          {/* Copy/CopyLink mode chip */}
          <button
            className="table-fill-mode"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggleFillMode(); }}
            title={fillMode === "copylink" ? "CopyLink — click to switch to Copy" : "Copy — click to switch to CopyLink"}
          >
            {fillMode === "copylink" ? "⚡link" : "copy"}
          </button>
        </>
      )}
    </div>
  );
}

export default function ContainerTable({ occurrence, dispatch, socket }) {
  const { occurrencesById, modulesById, fieldsById } = useGridActions();

  // Normalize: cells/columns can come back null from the server if a prior
  // partial write stored `null` (e.g. Mongoose Mixed-type quirks on empty
  // subdocs). Without this guard, `tableRef.current.cells[key]` in TableCell
  // throws "can't access property '0:0', t.current.cells is null" and the
  // whole panel crashes. Fall back to safe defaults whenever a field is null
  // or the wrong type — same shape DEFAULT_TABLE provides.
  const table = useMemo(() => {
    const raw = occurrence?.meta?.table || DEFAULT_TABLE();
    return {
      ...raw,
      columns: Array.isArray(raw.columns) ? raw.columns : DEFAULT_TABLE().columns,
      rowCount: typeof raw.rowCount === "number" ? raw.rowCount : 0,
      cells: (raw.cells && typeof raw.cells === "object" && !Array.isArray(raw.cells)) ? raw.cells : {},
      // Table-level sort sits alongside per-column sort. Shape: `{ colId, dir }`
      // where dir is "asc" | "desc". Merged into TanStack's `sorting` state
      // BEFORE per-column entries so it acts as the primary sort key.
      sort: (raw.sort && typeof raw.sort === "object" && raw.sort.colId) ? raw.sort : null,
    };
  }, [occurrence?.meta?.table]);
  const { columns, rowCount, cells } = table;

  // [TABLE-DIAG] Emit a one-line summary every time the table data changes so
  // we can spot "rendered but rowCount=0" vs "rendered but cells missing".
  // Toggle off by setting window.__moduliTableDiag = false.
  useEffect(() => {
    if (typeof window !== "undefined" && window.__moduliTableDiag === false) return;
    const cellCount = cells && typeof cells === "object" ? Object.keys(cells).length : 0;
    // eslint-disable-next-line no-console
    console.log("[table]", {
      occId: occurrence?.id,
      label: modulesById?.[occurrence?.moduleId]?.label,
      rowCount,
      columns: columns?.length,
      cellsPersisted: cellCount,
      hasMetaTable: !!occurrence?.meta?.table,
    });
  }, [occurrence?.id, occurrence?.moduleId, occurrence?.meta?.table, columns, rowCount, cells, modulesById]);

  // Field-visibility cascade resolved at the TABLE-CONTAINER occurrence
  // (its own fieldVisibility, or whatever it inherits from the page/grid
  // via the HeaderDropdown FieldVisibilitySection). Cell-embedded
  // occurrences are not parented under this container, so ModuleInstance's
  // own ancestor walk can't see this — the column must pass it down
  // explicitly. A per-column kebab override (col.fieldVisibility) WINS
  // over this; a null column falls back to this table-level setting.
  const tableFieldVisibility = useMemo(
    () => getEffectiveFieldVisibilityForOccurrence(occurrence, { occurrencesById }),
    [occurrence, occurrencesById],
  );

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

  // Filter popover: which column is showing the filter editor
  const [filterPickerCol, setFilterPickerCol] = useState(null);

  // Field-filter (show/hide which fields render inside the cell's embed)
  // popover: which column is showing the field-filter editor
  const [fieldVisibilityPickerCol, setFieldVisibilityPickerCol] = useState(null);

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

  // ── Fill-drag ─────────────────────────────────────────────────────────────
  // Track which cell is currently focused so we can render the fill nub on it.
  const [focusedCell, setFocusedCell] = useState(null); // { r, c } | null

  // fillMode: "copy" | "copylink", persisted to localStorage.
  const [fillMode, setFillMode] = useState(() => {
    try { return localStorage.getItem("moduli-table-fill-mode") || "copylink"; }
    catch { return "copylink"; }
  });
  const toggleFillMode = useCallback(() => {
    setFillMode(prev => {
      const next = prev === "copylink" ? "copy" : "copylink";
      try { localStorage.setItem("moduli-table-fill-mode", next); } catch {}
      return next;
    });
  }, []);

  // persistRef: always tracks the latest `persist` function so handleFillPointerDown
  // (defined before persist in component scope) can call it without TDZ issues.
  const persistRef = useRef(null);

  // occurrencesByIdRef: mirrors occurrencesById so handleFillPointerDown's onUp
  // can read the latest map without occurrencesById being in the useCallback dep
  // array (which would recreate the callback — and every focused cell that
  // receives it — on every store update).
  const occurrencesByIdRef = useRef(occurrencesById);
  occurrencesByIdRef.current = occurrencesById;

  // Fill gesture state: src = { r, c } while dragging, null otherwise.
  const fillSrcRef = useRef(null);
  // Track which cells currently have the preview highlight so we can clear them.
  const fillPreviewCellsRef = useRef(new Set());
  // Store window-level listeners for cleanup on unmount / cancel.
  const fillHandlersRef = useRef(null);

  // containerRef is declared further down (also used for kebab outside-click).
  // Forward-reference: fill cleanup effect below uses containerRef which is
  // declared after the fill block. React refs are stable objects so hoisting
  // the ref to the top lets both uses share the same ref. Declare here:
  const containerRef = useRef(null);

  // Clear all preview highlights.
  const clearFillPreviews = useCallback((containerEl) => {
    for (const k of fillPreviewCellsRef.current) {
      const el = containerEl?.querySelector(`[data-r][data-c]${dataRCSelector(k)}`);
      if (el) el.classList.remove("table-fill-preview");
    }
    fillPreviewCellsRef.current.clear();
  }, []);

  // Cleanup fill listeners if component unmounts mid-gesture.
  useEffect(() => () => {
    const h = fillHandlersRef.current;
    if (h) {
      window.removeEventListener("pointermove", h.onMove);
      window.removeEventListener("pointerup", h.onUp);
      window.removeEventListener("pointercancel", h.onCancel);
    }
    if (containerRef.current) clearFillPreviews(containerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper: build an attribute selector for a "r:c" key.
  function dataRCSelector(key) {
    const [r, c] = key.split(":");
    return `[data-r="${r}"][data-c="${c}"]`;
  }

  const handleFillPointerDown = useCallback((e, r, c) => {
    e.preventDefault();
    e.stopPropagation();
    const prevFill = fillHandlersRef.current;
    if (prevFill) {
      window.removeEventListener("pointermove", prevFill.onMove);
      window.removeEventListener("pointerup", prevFill.onUp);
      window.removeEventListener("pointercancel", prevFill.onCancel);
      fillHandlersRef.current = null;
      clearFillPreviews(containerRef.current);
    }
    fillSrcRef.current = { r, c };

    const onMove = (moveE) => {
      const container = containerRef.current;
      if (!container || !fillSrcRef.current) return;
      // Hit-test the cell under the pointer.
      const el = document.elementFromPoint(moveE.clientX, moveE.clientY);
      const cellEl = el?.closest("[data-r][data-c]");
      if (!cellEl) return;
      const tr = parseInt(cellEl.getAttribute("data-r"), 10);
      const tc = parseInt(cellEl.getAttribute("data-c"), 10);
      if (isNaN(tr) || isNaN(tc)) return;
      const targets = fillRange(fillSrcRef.current, { r: tr, c: tc });
      const nextKeys = new Set(targets.map(({ r: pr, c: pc }) => cellKey(pr, pc)));
      // Remove stale previews.
      for (const k of fillPreviewCellsRef.current) {
        if (!nextKeys.has(k)) {
          const staleEl = container.querySelector(`[data-r][data-c]${dataRCSelector(k)}`);
          if (staleEl) staleEl.classList.remove("table-fill-preview");
        }
      }
      // Add new previews.
      for (const k of nextKeys) {
        if (!fillPreviewCellsRef.current.has(k)) {
          const newEl = container.querySelector(`[data-r][data-c]${dataRCSelector(k)}`);
          if (newEl) newEl.classList.add("table-fill-preview");
        }
      }
      fillPreviewCellsRef.current = nextKeys;
    };

    const onUp = (upE) => {
      cleanup();
      const container = containerRef.current;
      if (!fillSrcRef.current || !container) { fillSrcRef.current = null; return; }
      const src = fillSrcRef.current;
      fillSrcRef.current = null;

      // Determine final target cell.
      const el = document.elementFromPoint(upE.clientX, upE.clientY);
      const cellEl = el?.closest("[data-r][data-c]");
      if (!cellEl) return;
      const tr = parseInt(cellEl.getAttribute("data-r"), 10);
      const tc = parseInt(cellEl.getAttribute("data-c"), 10);
      if (isNaN(tr) || isNaN(tc)) return;
      const targets = fillRange(src, { r: tr, c: tc });
      if (!targets.length) return;

      // Resolve effective mode: Alt key forces "copy" regardless of chip.
      const mode = upE.altKey ? "copy" : fillMode;

      // Read source cell doc.
      const srcDoc = tableRef.current.cells[cellKey(src.r, src.c)];
      const srcOccId = srcDoc ? firstEmbedOccId(srcDoc) : null;
      const srcOcc = srcOccId ? occurrencesByIdRef.current?.[srcOccId] : null;

      // Build next cells map.
      const nextCells = { ...tableRef.current.cells };

      if (srcOccId && srcOcc) {
        // Embed source: CopyLink or Copy.
        const gridId = occurrence?.gridId;
        const userId = occurrence?.userId;

        // Resolve linkedGroupId once (for CopyLink mode, tagging the source).
        let linkedGroupId = null;
        if (mode === "copylink") {
          const result = assignLinkedGroup(
            srcOcc,
            (sourceId, groupId) => {
              // Tag the source occurrence with the linkedGroupId — mirrors
              // copylinkInstanceToContainer's tagFn exactly (LayoutHelpers.js:743-749).
              CommitHelpers.updateOccurrence({
                dispatch,
                socket,
                occurrence: { id: sourceId, linkedGroupId: groupId },
              });
            }
          );
          linkedGroupId = result.linkedGroupId;
        }

        for (const { r: tr2, c: tc2 } of targets) {
          const newOccId = uid();

          // Deep-copy fields from source occurrence.
          let copiedFields = {};
          if (srcOcc.fields && typeof srcOcc.fields === "object") {
            try { copiedFields = JSON.parse(JSON.stringify(srcOcc.fields)); }
            catch { copiedFields = { ...srcOcc.fields }; }
          }

          // Mint a new occurrence — same moduleId as source, same pattern as
          // CommitHelpers.createOccurrence (the codebase's canonical optimistic
          // occurrence-create helper). Ordering note: occurrence must exist in
          // state BEFORE persist() writes the cell doc that references it, so
          // we createOccurrence first, then accumulate into nextCells, and call
          // persist() once at the end — a single optimistic state update.
          const newOcc = {
            id: newOccId,
            userId: userId || null,
            moduleId: srcOcc.moduleId,
            gridId: gridId || null,
            iteration: srcOcc.iteration
              ? JSON.parse(JSON.stringify(srcOcc.iteration))
              : { key: "time", value: new Date(), mode: "specific" },
            timestamp: new Date(),
            fields: copiedFields,
            parentId: null,
            ...(mode === "copylink" ? { linkedGroupId } : {}),
          };
          CommitHelpers.createOccurrence({ dispatch, socket, occurrence: newOcc });

          nextCells[cellKey(tr2, tc2)] = makeEmbedCellDoc(newOccId);

          // Auto-append: if this column is in show-mode field-visibility,
          // append the new embed's fieldIds to col.fieldVisibility.fieldIds.
          // Mirror for the table's ancestors (a page/panel in show-mode
          // surfaces the new fieldIds too — cell embeds aren't parented under
          // the table in occurrences[], so we walk from the table occurrence
          // itself rather than the embed).
          autoAppendFieldsToTableColumnShowMode({
            tableOccurrence: occurrence,
            columnIndex: tc2,
            newOccurrence: newOcc,
            ctx: { dispatch, socket, modulesById },
          });
          autoAppendFieldsToAncestorsShowMode({
            newOccurrence: newOcc,
            destinationOccurrence: occurrence,
            ctx: { dispatch, socket, occurrencesById, modulesById },
          });
        }
      } else {
        // Plain-text / no embed: deep-clone source doc verbatim into each target.
        const clonedDoc = srcDoc ? JSON.parse(JSON.stringify(srcDoc)) : emptyCellDoc();
        for (const { r: tr2, c: tc2 } of targets) {
          nextCells[cellKey(tr2, tc2)] = JSON.parse(JSON.stringify(clonedDoc));
        }
      }

      // Single batched persist — all target cells written in one updateOccurrence.
      // Use persistRef.current so this callback always calls the latest persist
      // function regardless of declaration order (avoids TDZ issues).
      persistRef.current?.({ ...tableRef.current, cells: nextCells });
    };

    const onCancel = () => {
      cleanup();
      fillSrcRef.current = null;
    };

    function cleanup() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      fillHandlersRef.current = null;
      clearFillPreviews(containerRef.current);
    }

    fillHandlersRef.current = { onMove, onUp, onCancel };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillMode, occurrence?.gridId, occurrence?.userId, dispatch, socket, clearFillPreviews]);

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
  // Keep persistRef current so handleFillPointerDown (declared before persist) can call it.
  persistRef.current = persist;

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
      // filterFn: evaluate col.filter.{comparator,value} against the cell's
      // sort value using the same evalRule that powers all grid comparators.
      // cellValue comes from accessorFn above (already a scalar/string/date).
      // evalRule({ left, comparator, right }, $vars={}) works with plain
      // scalars as `left`/`right` because resolveExpr returns non-$-prefixed
      // values as literals — no $vars map needed here.
      filterFn: (row, _columnId, filterValue) => {
        if (!filterValue || !filterValue.comparator) return true;
        const { comparator, value: filterRightVal } = filterValue;
        // Get the cell's sort value via the accessor (same logic as sort).
        const cellValue = row.getValue(col.id);
        // evalRule({ left, comparator, right }, $vars)
        // We pass cellValue as `left` directly. resolveExpr treats non-string
        // or non-$var values as literals; for scalars we pass them through.
        // Wrap in a synthetic rule so evalRule resolves both sides.
        return evalRule({ left: cellValue, comparator, right: filterRightVal ?? "" }, {});
      },
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [columns, cells, occurrencesById, modulesById]);

  const tanstackData = useMemo(() => rows.map(r => ({ r })), [rows]);

  // ── Step 1: Derive TanStack sorting state ─────────────────────────────────
  // View-only: persisted sort config drives order; cells[] never mutated.
  // Order: table.sort (primary) first, then any per-column sorts. TanStack
  // applies them in array order, so the table-level entry wins ties. Per-column
  // sort lives alongside — clearing the table sort falls back to per-column.
  const sorting = useMemo(() => {
    const out = [];
    if (table.sort?.colId) {
      out.push({ id: table.sort.colId, desc: table.sort.dir === "desc" });
    }
    for (const c of columns) {
      if (c.sort != null && c.id !== table.sort?.colId) {
        out.push({ id: c.id, desc: c.sort === "desc" });
      }
    }
    return out;
  }, [columns, table.sort]);

  // ── Step 3: Derive TanStack columnFilters from columns[].filter ───────────
  // View-only: filter config stored in columns[].filter; cells[] never touched.
  const columnFilters = useMemo(
    () => columns
      .filter(c => c.filter != null)
      .map(c => ({ id: c.id, value: c.filter })),
    [columns],
  );

  // Wire sorting + filtering into the TanStack instance (was unused in Task 7).
  const tableInstance = useReactTable({
    data: tanstackData,
    columns: tanstackColumns,
    state: { sorting, columnFilters },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // Manual state: we drive sort/filter from persisted column config above;
    // no internal onChange needed (sort cycling is already handled by
    // handleSortClick → persist).
    manualSorting: false,
    manualFiltering: false,
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

  // --- Toggle per-column "show media" — when on, table cells in this column
  // surface their occurrence's role:"media" binding (image/video/audio) as
  // a block under label + fields. Off by default; mirrors col.hideLabel.
  const toggleColumnShowMedia = useCallback((colIndex) => {
    const col = columns[colIndex];
    const nextCols = columns.map((c, i) =>
      i === colIndex ? { ...c, showMedia: !c.showMedia } : c
    );
    persist({ ...table, columns: nextCols });
  }, [columns, persist, table]);

  // --- Table-level sort: writes meta.table.sort = { colId, dir } | null ---
  // Independent of per-column sort; lives at table scope so the entire table
  // is sorted by one column at a time. Per-column sort still works for
  // additional layers. Pass colId=null to clear.
  const handleSetTableSort = useCallback((colId, dir) => {
    const next = colId ? { colId, dir: dir === "desc" ? "desc" : "asc" } : null;
    persist({ ...table, sort: next });
  }, [persist, table]);

  const [tableSortMenuOpen, setTableSortMenuOpen] = useState(false);

  // --- Kebab menu toggle ---
  const handleKebabClick = useCallback((e, colIndex) => {
    e.stopPropagation();
    setKebabOpen(prev => {
      if (prev?.colIndex === colIndex) {
        // Closing: reset nested pickers for this column
        setFieldPickerCol(null);
        setFilterPickerCol(null);
        setFieldVisibilityPickerCol(null);
        return null;
      }
      return { colIndex };
    });
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

  // --- Per-column filter (view-only) ---
  // Writes columns[colIndex].filter = { comparator, value } or null to clear.
  // Never touches cells[]. TanStack columnFilters derived from this in the memo above.
  const handleSetFilter = useCallback((colIndex, filterObj) => {
    const nextCols = columns.map((c, i) =>
      i === colIndex ? { ...c, filter: filterObj || null } : c
    );
    persist({ ...table, columns: nextCols });
  }, [columns, persist, table]);

  const handleClearFilter = useCallback((colIndex) => {
    handleSetFilter(colIndex, null);
  }, [handleSetFilter]);

  // --- Per-column field filter (which fields render inside the embed) ---
  // Writes columns[colIndex].fieldVisibility = { mode: "show"|"hide", fieldIds }
  // or null to clear. CellEmbedContext picks it up; ModuleInstance reads
  // fieldVisibility from context and filters bindings accordingly. Independent
  // of displayFieldId (single-field projection) — when both are set,
  // displayFieldId wins for the projected-cell render path.
  const handleSetFieldVisibilityMode = useCallback((colIndex, mode) => {
    const nextCols = columns.map((c, i) => {
      if (i !== colIndex) return c;
      // "off" clears the filter; switching modes keeps the existing fieldIds.
      if (mode === "off") return { ...c, fieldVisibility: null };
      const prev = c.fieldVisibility || { mode: "show", fieldIds: [] };
      return { ...c, fieldVisibility: { mode, fieldIds: prev.fieldIds || [] } };
    });
    persist({ ...table, columns: nextCols });
  }, [columns, persist, table]);

  const handleToggleFieldVisibilityFieldId = useCallback((colIndex, fieldId) => {
    const nextCols = columns.map((c, i) => {
      if (i !== colIndex) return c;
      const prev = c.fieldVisibility || { mode: "show", fieldIds: [] };
      const has = (prev.fieldIds || []).includes(fieldId);
      const nextIds = has
        ? prev.fieldIds.filter(fid => fid !== fieldId)
        : [...(prev.fieldIds || []), fieldId];
      return { ...c, fieldVisibility: { mode: prev.mode || "show", fieldIds: nextIds } };
    });
    persist({ ...table, columns: nextCols });
  }, [columns, persist, table]);

  // Build the field picker config — reuse the same DrilldownPicker pattern
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

  // --- Remove a specific row at index ---
  // Shifts every cell from rows below up by one row, drops the now-last-row
  // cells, decrements rowCount. Mirrors deleteColumn's reindex pattern.
  const handleRemoveRowAt = useCallback((rowIdx) => {
    if (rowCount <= 1) return;
    const nextCells = {};
    Object.entries(cells || {}).forEach(([k, v]) => {
      const [rs, cs] = k.split(":");
      const r = Number(rs);
      const c = Number(cs);
      if (r < rowIdx) {
        nextCells[k] = v;
      } else if (r > rowIdx) {
        nextCells[`${r - 1}:${c}`] = v;
      }
      // r === rowIdx → drop
    });
    persist({ ...table, cells: nextCells, rowCount: rowCount - 1 });
  }, [table, rowCount, cells, persist]);

  // Close kebab (and field picker) on outside click
  // (containerRef declared above in the fill-drag section)
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
  // Track scroll-container width so columns can flex to fill it. Without
  // this, narrow viewports clipped right-side columns AND wide viewports
  // had a dead-zone of empty whitespace past the last column.
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === "undefined") return;
    const el = containerRef.current;
    const update = () => setContainerWidth(el.clientWidth || 0);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // effectiveWidths: live resize takes priority, otherwise the persisted
  // col.width treated as a RATIO (not absolute pixels). The whole row is
  // then scaled to exactly fit the container width (minus the trailing
  // action column). Always fills the panel, never overflows — matches the
  // user spec "should be contained by the table page width (always
  // matching it, and the cells are responsive to that)".
  // First-paint guard: containerWidth is 0 before the ResizeObserver fires;
  // fall through to raw widths in that case so cells aren't pinned to 0.
  const effectiveWidths = useMemo(() => {
    const raw = columns.map((c, i) => {
      if (resizing && resizing.colIndex === i && resizing.currentWidth != null) {
        return resizing.currentWidth;
      }
      return c.width || 160;
    });
    const sum = raw.reduce((a, w) => a + w, 0);
    const ROW_ACTION_COL_W_LOCAL = 32; // mirrors the const below — keep in sync
    const target = Math.max(0, containerWidth - ROW_ACTION_COL_W_LOCAL);
    if (target <= 0 || sum <= 0) return raw;
    // Live-resize takes precedence — if the user is dragging a column,
    // don't redistribute their drag.
    if (resizing) return raw;
    const scale = target / sum;
    const scaled = raw.map(w => Math.max(40, Math.round(w * scale)));
    // Push the rounding remainder into the last column so the columns sum to
    // EXACTLY `target` — fills the panel to the right edge with no dead zone
    // and keeps header/body widths byte-identical.
    const scaledSum = scaled.reduce((a, w) => a + w, 0);
    const remainder = target - scaledSum;
    if (remainder !== 0 && scaled.length > 0) {
      const last = scaled.length - 1;
      scaled[last] = Math.max(40, scaled[last] + remainder);
    }
    return scaled;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, resizing, containerWidth]);

  // Layout constants. Rows are normal-flow flex rows (no virtualization), so
  // there is no min row height — a row is exactly as tall as its tallest cell.
  // HEADER_H: fixed header height.
  const HEADER_H = 30;
  // ROW_ACTION_COL_W: width of the trailing "–" action column (pixels).
  const ROW_ACTION_COL_W = 32;

  const filteredSortedRows = tableInstance.getRowModel().rows;

  // ── Children as rows (2026-07-07) ─────────────────────────────────────────
  // Occurrences PARENTED under the table render as generated rows after the
  // persisted cell rows — one row per child, each column applying its own
  // projection (fieldVisibility / hideLabel / displayFieldId) to the SAME
  // occurrence via StaticCellEmbed. This is what makes a table a feed target
  // (occurrence.feed materializes copy-linked children — the old Table: Build
  // op wrote per-cell embed docs instead) and, generically, what makes any
  // drop-into-a-table read as "new row".
  const childRowOccs = useMemo(() => {
    const ids = occurrence?.occurrences || [];
    return ids.map(id => occurrencesById?.[id]).filter(Boolean);
  }, [occurrence?.occurrences, occurrencesById]);

  // Normal document flow — NO row/column virtualization. This table holds a
  // handful of rows whose cells are heavy occurrence embeds. The virtualizer's
  // absolute positioning + async height measurement was the source of the
  // "extra random line" / overlap and stopped cells in a row from sharing the
  // tallest cell's height. In flow, each row sizes to its tallest cell and all
  // cells stretch to match via CSS `align-items: stretch`.
  const totalColsWidth =
    effectiveWidths.reduce((a, w) => a + w, 0) + ROW_ACTION_COL_W;

  return (
    <div
      className="table-container table-container-virtual"
      data-occ-id={occurrence?.id}
      ref={containerRef}
    >
      {/* ── Flow content div ─────────────────────────────────────────────────
          No virtualization. width = totalColsWidth so the row stays as wide as
          its columns (horizontal scroll handled by the scroll container);
          height is intrinsic so the body grows with its rows. */}
      <div
        className="table-body-flow"
        style={{
          width: totalColsWidth,
          minWidth: "100%",
        }}
      >
      {/* ── Table-level sort button (top-left of header row) ─────────────────
          Sticky-positioned overlay anchored to the table's top-left corner.
          Opens a small popover with a column picker + asc/desc/clear so the
          user can sort the whole table by one column at a time. Per-column
          sort is still available via each column's chevron button. */}
      <div
        className="table-sort-overlay"
        style={{
          position: "sticky",
          top: 0,
          left: 0,
          zIndex: 6,
          width: 0,
          height: 0,
        }}
      >
        <button
          className="table-sort-overlay-btn"
          title={table.sort?.colId
            ? `Sort: ${columns.find(c => c.id === table.sort.colId)?.title || "?"} ${table.sort.dir}`
            : "Set table-level sort"}
          onClick={(e) => { e.stopPropagation(); setTableSortMenuOpen(v => !v); }}
        >
          {table.sort?.dir === "desc" ? (
            <ChevronDown size={11} />
          ) : table.sort?.colId ? (
            <ChevronUp size={11} />
          ) : (
            <span className="table-sort-inactive">↕</span>
          )}
        </button>
        {tableSortMenuOpen && (
          <div className="table-sort-overlay-menu">
            <div className="table-sort-overlay-title">Sort table by</div>
            {columns.map((col) => (
              <div key={col.id} className="table-sort-overlay-row">
                <span className="table-sort-overlay-col-name">{col.title}</span>
                <button
                  className={`table-sort-overlay-dir${table.sort?.colId === col.id && table.sort.dir === "asc" ? " active" : ""}`}
                  onClick={() => { handleSetTableSort(col.id, "asc"); setTableSortMenuOpen(false); }}
                  title="Ascending"
                >
                  <ChevronUp size={11} />
                </button>
                <button
                  className={`table-sort-overlay-dir${table.sort?.colId === col.id && table.sort.dir === "desc" ? " active" : ""}`}
                  onClick={() => { handleSetTableSort(col.id, "desc"); setTableSortMenuOpen(false); }}
                  title="Descending"
                >
                  <ChevronDown size={11} />
                </button>
              </div>
            ))}
            {table.sort?.colId && (
              <button
                className="table-sort-overlay-clear"
                onClick={() => { handleSetTableSort(null); setTableSortMenuOpen(false); }}
              >
                Clear table sort
              </button>
            )}
          </div>
        )}
      </div>
      {/* ── Sticky header row (flex) ───────────────────────────────────────── */}
      <div
        className="table-header-row"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 3,
          height: HEADER_H,
          width: totalColsWidth,
          display: "flex",
          flexDirection: "row",
        }}
      >
        {columns.map((col, c) => {
          if (!col) return null;
          const colW = effectiveWidths[c];
          return (
            <div
              key={col.id}
              className="table-th"
              style={{
                flex: `0 0 ${colW}px`,
                height: HEADER_H,
                boxSizing: "border-box",
              }}
            >
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
                            <DrilldownPicker
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
                        ) : filterPickerCol === c ? (
                          /* ── Per-column filter editor ── */
                          <div className="table-kebab-filter-picker" style={{ padding: "6px 8px", minWidth: 160 }}>
                            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, fontFamily: "var(--font-mono)" }}>
                              Filter this column
                            </div>
                            {/* Comparator dropdown — shared COMPARATOR_OPTIONS (also used by GridSettingsTab) */}
                            <select
                              value={(col.filter?.comparator) || "IS"}
                              onChange={e => {
                                const comparator = e.target.value;
                                const value = UNARY_COMPARATORS.has(comparator) ? "" : (col.filter?.value ?? "");
                                handleSetFilter(c, { comparator, value });
                              }}
                              style={{
                                width: "100%",
                                height: 22,
                                fontSize: 10,
                                fontFamily: "var(--font-mono)",
                                padding: "0 4px",
                                borderRadius: 3,
                                background: "var(--input-bg)",
                                border: "1px solid var(--input-border)",
                                color: "var(--text-primary)",
                                outline: "none",
                                cursor: "pointer",
                                boxSizing: "border-box",
                              }}
                            >
                              {COMPARATOR_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                            {/* Value widget — FilterValueWidget (thin inline widget reusing evalRule semantics) */}
                            <FilterValueWidget
                              comparator={col.filter?.comparator || "IS"}
                              value={col.filter?.value ?? ""}
                              onChange={val => handleSetFilter(c, { comparator: col.filter?.comparator || "IS", value: val })}
                            />
                            {/* Clear filter button */}
                            {col.filter && (
                              <button
                                className="table-kebab-item"
                                style={{ marginTop: 4, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 3 }}
                                onClick={() => { handleClearFilter(c); setFilterPickerCol(null); }}
                              >
                                <X size={9} /> Clear filter
                              </button>
                            )}
                            <button
                              className="table-kebab-item"
                              style={{ marginTop: 2 }}
                              onClick={() => setFilterPickerCol(null)}
                            >
                              Done
                            </button>
                          </div>
                        ) : fieldVisibilityPickerCol === c ? (
                          /* ── Per-column field filter editor (show/hide which fields render inside the cell embed) ── */
                          <div className="table-kebab-fieldvis-picker" style={{ padding: "6px 8px", minWidth: 200 }}>
                            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, fontFamily: "var(--font-mono)" }}>
                              Fields visible in cell embed
                            </div>
                            {/* Inherit = use the table's HeaderDropdown field
                                visibility (which itself cascades from the
                                page/grid). Show / Hide = per-column override. */}
                            {!col.fieldVisibility && (
                              <div style={{ fontSize: 9, color: "var(--text-faint)", marginBottom: 6 }}>
                                Inheriting: {tableFieldVisibility
                                  ? `${tableFieldVisibility.mode === "show" ? "Show only" : "Hide"} ${(tableFieldVisibility.fieldIds || []).length} field${(tableFieldVisibility.fieldIds || []).length === 1 ? "" : "s"}`
                                  : "all fields"}
                              </div>
                            )}
                            {/* Mode toggle: Inherit / Show / Hide */}
                            <div style={{ display: "flex", gap: 2, marginBottom: 6 }}>
                              {["off", "show", "hide"].map(m => {
                                const isActive = (col.fieldVisibility?.mode || "off") === m
                                  || (m === "off" && !col.fieldVisibility);
                                return (
                                  <button
                                    key={m}
                                    onClick={() => handleSetFieldVisibilityMode(c, m)}
                                    style={{
                                      flex: 1, height: 20, fontSize: 9, fontFamily: "var(--font-mono)",
                                      borderRadius: 3, border: "1px solid var(--input-border)",
                                      background: isActive ? "var(--accent-blue-bg, rgba(96,165,250,0.18))" : "var(--input-bg)",
                                      color: isActive ? "var(--accent-blue, #60a5fa)" : "var(--text-muted)",
                                      cursor: "pointer", textTransform: "capitalize",
                                    }}
                                  >
                                    {m === "off" ? "Inherit" : m}
                                  </button>
                                );
                              })}
                            </div>
                            {/* Multi-select field list (only when mode != off) */}
                            {col.fieldVisibility && col.fieldVisibility.mode && col.fieldVisibility.mode !== "off" && (
                              <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--border-subtle)", borderRadius: 3, padding: 2 }}>
                                {allFields.length === 0 && (
                                  <div style={{ fontSize: 10, color: "var(--text-faint)", padding: 4 }}>No fields available</div>
                                )}
                                {allFields.map(f => {
                                  const checked = (col.fieldVisibility.fieldIds || []).includes(f.id);
                                  return (
                                    <label
                                      key={f.id}
                                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 4px", fontSize: 10, cursor: "pointer", borderRadius: 2 }}
                                      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => handleToggleFieldVisibilityFieldId(c, f.id)}
                                        style={{ margin: 0, width: 10, height: 10 }}
                                      />
                                      <span style={{ flex: 1, color: "var(--text-primary)" }}>{f.name || "(unnamed)"}</span>
                                      <span style={{ fontSize: 9, color: "var(--text-faint)" }}>{f.type}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                            <button
                              className="table-kebab-item"
                              style={{ marginTop: 4 }}
                              onClick={() => setFieldVisibilityPickerCol(null)}
                            >
                              Done
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="table-kebab-section-label">Display</div>
                            <button
                              className="table-kebab-item"
                              onClick={() => setFieldPickerCol(c)}
                            >
                              <span className="table-kebab-item-label">
                                {col.displayFieldId
                                  ? `Field: ${fieldsById?.[col.displayFieldId]?.name || col.displayFieldId}`
                                  : "Show field…"}
                              </span>
                            </button>
                            <button
                              className="table-kebab-item"
                              onClick={() => setFieldVisibilityPickerCol(c)}
                            >
                              <Eye size={11} />
                              <span className="table-kebab-item-label">
                                {col.fieldVisibility
                                  ? `${col.fieldVisibility.mode === "show" ? "Show only" : "Hide"} ${(col.fieldVisibility.fieldIds || []).length} field${(col.fieldVisibility.fieldIds || []).length === 1 ? "" : "s"}`
                                  : tableFieldVisibility
                                    ? `Inherited: ${tableFieldVisibility.mode === "show" ? "Show only" : "Hide"} ${(tableFieldVisibility.fieldIds || []).length}`
                                    : "Field visibility…"}
                              </span>
                            </button>
                            <button
                              className="table-kebab-item"
                              onClick={() => toggleColumnShowMedia(c)}
                            >
                              <ImageIcon size={11} />
                              <span className="table-kebab-item-label">
                                {col.showMedia ? "Hide media" : "Show media"}
                              </span>
                            </button>
                            <div className="table-kebab-divider" />
                            <div className="table-kebab-section-label">Sort</div>
                            <button
                              className="table-kebab-item"
                              onClick={() => handleSortClick(c)}
                            >
                              {col.sort === "asc" ? (
                                <ChevronUp size={11} />
                              ) : col.sort === "desc" ? (
                                <ChevronDown size={11} />
                              ) : (
                                <span className="table-sort-inactive" style={{ width: 11, display: "inline-flex", justifyContent: "center" }}>↕</span>
                              )}
                              <span className="table-kebab-item-label">
                                {col.sort === "asc" ? "Sort: Ascending" : col.sort === "desc" ? "Sort: Descending" : "Sort: None (click to cycle)"}
                              </span>
                            </button>
                            <div className="table-kebab-divider" />
                            <div className="table-kebab-section-label">Filter</div>
                            <button
                              className="table-kebab-item"
                              onClick={() => setFilterPickerCol(c)}
                            >
                              <Filter size={11} />
                              <span className="table-kebab-item-label">
                                {col.filter ? "Edit filter…" : "Add filter…"}
                              </span>
                            </button>
                            <div className="table-kebab-divider" />
                            <button
                              className="table-kebab-item table-kebab-delete"
                              onClick={() => handleDeleteColumn(c)}
                            >
                              <X size={11} />
                              <span className="table-kebab-item-label">Delete column</span>
                            </button>
                          </>
                        )}
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
          );
        })}

        {/* +Column button — sits at the right edge of the header, after all columns */}
        <div
          className="table-th table-add-col-th"
          style={{
            flex: `0 0 ${ROW_ACTION_COL_W}px`,
            height: HEADER_H,
            boxSizing: "border-box",
          }}
        >
          <button className="table-add-col-btn" onClick={handleAddColumn} title="Add column">
            +
          </button>
        </div>
      </div>{/* end .table-header-row */}

        {/* Flow rows: each row is a flex row of cells in normal document flow.
            `align-items: stretch` makes every cell in the row take the height
            of the tallest cell, so the row grows with its biggest occurrence
            and all cells stay uniform (no absolute positioning, no measured
            offsets — that was the "extra random line"). */}
        {filteredSortedRows.map((tanRow) => {
          if (!tanRow) return null;
          const r = tanRow.original.r;
          return (
            <div
              key={`row-${r}`}
              className="table-row"
              style={{
                width: totalColsWidth,
                display: "flex",
                flexDirection: "row",
                alignItems: "stretch",
              }}
            >
              {columns.map((col, c) => (
                <TableCell
                  key={cellKey(r, c)}
                  r={r}
                  c={c}
                  initialDoc={cells[cellKey(r, c)] || null}
                  tableRef={tableRef}
                  persist={persist}
                  onCellCommitMove={(dir) => focusCell(nextCoord(r, c, dir))}
                  cellRefs={cellRefs}
                  dispatch={dispatch}
                  socket={socket}
                  displayFieldId={col.displayFieldId ?? null}
                  fieldVisibility={col.fieldVisibility ?? tableFieldVisibility}
                  hideLabel={col.hideLabel === true}
                  showMedia={col.showMedia === true}
                  onFocusCell={() => setFocusedCell({ r, c })}
                  onBlurCell={() => setFocusedCell(prev => (prev?.r === r && prev?.c === c ? null : prev))}
                  isFocused={focusedCell?.r === r && focusedCell?.c === c}
                  fillMode={fillMode}
                  onFillPointerDown={handleFillPointerDown}
                  onToggleFillMode={toggleFillMode}
                  style={{
                    flex: `0 0 ${effectiveWidths[c]}px`,
                    boxSizing: "border-box",
                  }}
                />
              ))}
              {/* Trailing row-action column — every row gets a delete
                  button (hover-revealed via CSS). Mirrors the +Column at the
                  far right of the header. Last-row-only behavior is gone. */}
              <div
                className="table-td table-row-action-cell"
                data-r={r}
                style={{
                  flex: `0 0 ${ROW_ACTION_COL_W}px`,
                  boxSizing: "border-box",
                }}
              >
                <button
                  className="table-remove-row-btn"
                  title="Remove this row"
                  onClick={() => handleRemoveRowAt(r)}
                  disabled={rowCount <= 1}
                >
                  –
                </button>
              </div>
            </div>
          );
        })}

        {/* Children rows — see childRowOccs above. Feed copies
            (meta.feedSourceId) hide the remove button: the feed engine owns
            their lifecycle (a manual delete would just re-mint next sync). */}
        {childRowOccs.map((childOcc) => (
          <div
            key={`child-row-${childOcc.id}`}
            className="table-row table-child-row"
            style={{
              width: totalColsWidth,
              display: "flex",
              flexDirection: "row",
              alignItems: "stretch",
            }}
          >
            {columns.map((col, c) => (
              <div
                key={`${childOcc.id}:${c}`}
                className="table-td"
                style={{
                  flex: `0 0 ${effectiveWidths[c]}px`,
                  boxSizing: "border-box",
                }}
              >
                <StaticCellEmbed
                  occId={childOcc.id}
                  occurrencesById={occurrencesById}
                  modulesById={modulesById}
                  dispatch={dispatch}
                  socket={socket}
                  displayFieldId={col.displayFieldId ?? null}
                  fieldVisibility={col.fieldVisibility ?? tableFieldVisibility}
                  hideLabel={col.hideLabel === true}
                  showMedia={col.showMedia === true}
                />
              </div>
            ))}
            <div
              className="table-td table-row-action-cell"
              style={{ flex: `0 0 ${ROW_ACTION_COL_W}px`, boxSizing: "border-box" }}
            >
              {!childOcc.meta?.feedSourceId && (
                <button
                  className="table-remove-row-btn"
                  title="Remove this item"
                  onClick={() => CommitHelpers.removeOccurrence({
                    dispatch, socket,
                    occurrenceId: childOcc.id,
                    occurrence: childOcc,
                    parentOccurrence: occurrence,
                    emit: true,
                  })}
                >
                  –
                </button>
              )}
            </div>
          </div>
        ))}

      {/* +Row strip — mirrors the +Column strip at the right edge of the
          header but spans the full body width along the bottom. Vertically
          flexed (full-width, slim height) so it reads as the row analogue
          of the column add affordance. */}
      <div
        className="table-add-row-strip"
        onClick={handleAddRow}
        style={{ width: totalColsWidth }}
        title="Add row"
      >
        <span className="table-add-row-strip-icon">+</span>
      </div>
      </div>
    </div>
  );
}
