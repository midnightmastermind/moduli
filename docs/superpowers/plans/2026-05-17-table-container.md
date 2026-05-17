# Table Container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a layout-only `kind:"table"` container whose every visible cell is a virtualized TipTap mini-editor, with Excel-style copylink fill-drag and view-only per-column sort/filter.

**Architecture:** TanStack Table (headless) owns the column model / sort / filter / virtualization and renders nothing; TipTap (`Editor.jsx` in a new "cell mode") renders each cell over a textmap fragment stored in `occurrence.meta.table.cells["r:c"]`. Rows/cols/cells are pure layout, never entities. copylink fill-drag reuses an extracted `assignLinkedGroup()` helper and the existing `CommitHelpers` linked fan-out.

**Tech Stack:** React, Vitest + @testing-library/react, TipTap/ProseMirror, `@atlaskit/pragmatic-drag-and-drop`, `@tanstack/react-table`, `@tanstack/react-virtual`.

**Spec:** `docs/superpowers/specs/2026-05-17-table-container-design.md`

**Test runner:** from `client/`, single file: `npx vitest run src/__tests__/<file>`; full client suite: `npm run test`.

**Conventions to honor (from project memory):** optimistic updates everywhere (never wait for server round-trip); no fallback / backwards-compat shims (fully convert, delete the old); containers have NO list-vs-board split; run relevant tests after each change; back up hard-won files before refactor.

---

### Task 1: Add table libraries

**Files:**
- Modify: `client/package.json`

- [ ] **Step 1: Install deps**

Run:
```bash
cd client && npm install @tanstack/react-table@^8 @tanstack/react-virtual@^3
```
Expected: both added to `dependencies`, no peer-dep errors that block install.

- [ ] **Step 2: Verify import resolves**

Run:
```bash
cd client && node -e "require.resolve('@tanstack/react-table'); require.resolve('@tanstack/react-virtual'); console.log('ok')"
```
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add client/package.json client/package-lock.json
git commit -m "build: add @tanstack/react-table + react-virtual for table container"
```

---

### Task 2: Extract `assignLinkedGroup()` from `copylinkInstanceToContainer`

Behavior-preserving refactor so fill-drag and the existing copylink path share group assignment. (Spec §5/§8.)

**Files:**
- Backup: `cp client/src/helpers/LayoutHelpers.js client/src/helpers/LayoutHelpers.js.backup`
- Modify: `client/src/helpers/LayoutHelpers.js` (function `copylinkInstanceToContainer`, ~line 706)
- Test: `client/src/__tests__/assignLinkedGroup.test.js`

- [ ] **Step 1: Back up the hard-won file**

```bash
cp client/src/helpers/LayoutHelpers.js client/src/helpers/LayoutHelpers.js.backup
```

- [ ] **Step 2: Write the failing test**

Create `client/src/__tests__/assignLinkedGroup.test.js`:
```js
import { describe, it, expect, vi } from "vitest";
import { assignLinkedGroup } from "../helpers/LayoutHelpers.js";

describe("assignLinkedGroup", () => {
  it("reuses the source's existing linkedGroupId", () => {
    const src = { id: "occ_1", linkedGroupId: "grp_existing" };
    const tag = vi.fn();
    const { linkedGroupId } = assignLinkedGroup(src, tag);
    expect(linkedGroupId).toBe("grp_existing");
    expect(tag).not.toHaveBeenCalled();
  });

  it("uses the source occurrence id as the group when untagged, and tags the source", () => {
    const src = { id: "occ_2" };
    const tag = vi.fn();
    const { linkedGroupId } = assignLinkedGroup(src, tag);
    expect(linkedGroupId).toBe("occ_2");
    expect(tag).toHaveBeenCalledWith("occ_2", "occ_2");
  });

  it("falls back to a generated id when there is no source occurrence", () => {
    const tag = vi.fn();
    const { linkedGroupId } = assignLinkedGroup(null, tag);
    expect(typeof linkedGroupId).toBe("string");
    expect(linkedGroupId.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx vitest run src/__tests__/assignLinkedGroup.test.js`
Expected: FAIL — `assignLinkedGroup` is not exported.

- [ ] **Step 4: Implement `assignLinkedGroup` and refactor the existing function to call it**

In `client/src/helpers/LayoutHelpers.js`, add (near `copylinkInstanceToContainer`, reuse the existing `uid` import already in the file):
```js
/**
 * Resolve the linkedGroupId for a copylink/fill operation and tag the source.
 * tagFn(sourceOccurrenceId, linkedGroupId) is called only when the source
 * exists but had no group yet. Returns { linkedGroupId }.
 */
export function assignLinkedGroup(sourceOccurrence, tagFn) {
  const sourceId = sourceOccurrence?.id || null;
  const existing = sourceOccurrence?.linkedGroupId || null;
  const linkedGroupId = existing || sourceId || uid();
  if (sourceId && !existing && typeof tagFn === "function") {
    tagFn(sourceId, linkedGroupId);
  }
  return { linkedGroupId };
}
```
Then, inside `copylinkInstanceToContainer`, replace the inline group computation (the `const linkedGroupId = sourceOccurrence?.linkedGroupId || sourceOccurrenceId || uid();` line ~727 and the source-tagging `if` block ~757-762) with:
```js
const { linkedGroupId } = assignLinkedGroup(
  sourceOccurrence || { id: sourceOccurrenceId },
  (id, grp) => {
    dispatch(updateOccurrenceAction({ id, linkedGroupId: grp }));
    socket?.emit?.("update_occurrence", { occurrence: { id, linkedGroupId: grp } });
  }
);
```
(Match the exact existing dispatch/emit calls already used in that block — keep them identical, just moved into the callback. Do not change any other behavior.)

- [ ] **Step 5: Run the new test + the existing LayoutHelpers test**

Run:
```bash
cd client && npx vitest run src/__tests__/assignLinkedGroup.test.js src/__tests__/LayoutHelpers.test.js
```
Expected: both files PASS (existing copylink behavior unchanged).

- [ ] **Step 6: Commit**

```bash
git add client/src/helpers/LayoutHelpers.js client/src/__tests__/assignLinkedGroup.test.js
git commit -m "refactor: extract assignLinkedGroup() from copylinkInstanceToContainer"
```

---

### Task 3: Cell textmap + sort-key helpers

Pure helpers for the table; no React. (Spec §3.)

**Files:**
- Create: `client/src/helpers/tableCells.js`
- Test: `client/src/__tests__/tableCells.test.js`

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/tableCells.test.js`:
```js
import { describe, it, expect } from "vitest";
import {
  emptyCellDoc, makeEmbedCellDoc, cellKey, getCellSortValue,
} from "../helpers/tableCells.js";

describe("tableCells", () => {
  it("cellKey formats r:c", () => {
    expect(cellKey(3, 1)).toBe("3:1");
  });

  it("emptyCellDoc is an empty tiptap paragraph doc", () => {
    expect(emptyCellDoc()).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("makeEmbedCellDoc wraps a single moduleEmbed node", () => {
    const doc = makeEmbedCellDoc("occ_9");
    expect(doc.type).toBe("doc");
    expect(doc.content[0].type).toBe("moduleEmbed");
    expect(doc.content[0].attrs.occurrenceId).toBe("occ_9");
  });

  it("getCellSortValue: numeric plain text coerces to Number", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: " 42 " }] }] };
    expect(getCellSortValue(doc, { displayFieldId: null }, {})).toBe(42);
  });

  it("getCellSortValue: non-numeric plain text stays string", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] };
    expect(getCellSortValue(doc, { displayFieldId: null }, {})).toBe("hello");
  });

  it("getCellSortValue: embed + column displayFieldId → that field value", () => {
    const doc = makeEmbedCellDoc("occ_1");
    const ctx = {
      occurrencesById: { occ_1: { id: "occ_1", fields: { fld_p: { value: 31 } } } },
    };
    expect(getCellSortValue(doc, { displayFieldId: "fld_p" }, ctx)).toBe(31);
  });

  it("getCellSortValue: embed, no displayFieldId → occurrence label", () => {
    const doc = makeEmbedCellDoc("occ_1");
    const ctx = {
      occurrencesById: { occ_1: { id: "occ_1", targetId: "mod_1" } },
      modulesById: { mod_1: { id: "mod_1", label: "Protein" } },
    };
    expect(getCellSortValue(doc, { displayFieldId: null }, ctx)).toBe("Protein");
  });

  it("getCellSortValue: empty doc → empty string", () => {
    expect(getCellSortValue(emptyCellDoc(), { displayFieldId: null }, {})).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/__tests__/tableCells.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/src/helpers/tableCells.js`**

```js
// helpers/tableCells.js
// Pure helpers for the table container's layout-only cell model.
// A cell's content is a TipTap doc fragment stored in
// occurrence.meta.table.cells["r:c"]. Cells are not entities.

export function cellKey(r, c) {
  return `${r}:${c}`;
}

export function emptyCellDoc() {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

export function makeEmbedCellDoc(occurrenceId) {
  return {
    type: "doc",
    content: [{ type: "moduleEmbed", attrs: { occurrenceId } }],
  };
}

function plainText(doc) {
  let out = "";
  const walk = (n) => {
    if (!n) return;
    if (n.type === "text" && typeof n.text === "string") out += n.text;
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return out.trim();
}

function firstEmbedOccId(doc) {
  let found = null;
  const walk = (n) => {
    if (found || !n) return;
    if (n.type === "moduleEmbed" || n.type === "instancePill") {
      found = n.attrs?.occurrenceId || n.attrs?.id || null;
      if (found) return;
    }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return found;
}

/**
 * Derive one comparable scalar for a cell, for TanStack sort/filter.
 * ctx: { occurrencesById, modulesById }
 */
export function getCellSortValue(doc, column, ctx) {
  if (!doc) return "";
  const occId = firstEmbedOccId(doc);
  if (occId) {
    const occ = ctx?.occurrencesById?.[occId];
    if (column?.displayFieldId && occ) {
      const fv = occ.fields?.[column.displayFieldId];
      const v = fv && typeof fv === "object" ? fv.value : fv;
      return v == null ? "" : v;
    }
    const mod = occ && ctx?.modulesById?.[occ.targetId];
    return mod?.label || occ?.label || "";
  }
  const txt = plainText(doc);
  if (txt === "") return "";
  const asNum = Number(txt);
  return Number.isFinite(asNum) && /^[+-]?\d*\.?\d+$/.test(txt) ? asNum : txt;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/__tests__/tableCells.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/helpers/tableCells.js client/src/__tests__/tableCells.test.js
git commit -m "feat: pure cell-doc + sort-key helpers for table container"
```

---

### Task 4: Fill-range computation helper

Excel fill is constrained to a single row run or single column run. Pure logic. (Spec §5.)

**Files:**
- Modify: `client/src/helpers/tableCells.js`
- Test: `client/src/__tests__/tableCells.test.js` (append)

- [ ] **Step 1: Append failing tests**

Add to `client/src/__tests__/tableCells.test.js`:
```js
import { fillRange } from "../helpers/tableCells.js";

describe("fillRange", () => {
  const src = { r: 1, c: 1 };
  it("horizontal when |dc| >= |dr|", () => {
    expect(fillRange(src, { r: 1, c: 4 })).toEqual([
      { r: 1, c: 2 }, { r: 1, c: 3 }, { r: 1, c: 4 },
    ]);
  });
  it("vertical when |dr| > |dc|", () => {
    expect(fillRange(src, { r: 4, c: 2 })).toEqual([
      { r: 2, c: 1 }, { r: 3, c: 1 }, { r: 4, c: 1 },
    ]);
  });
  it("backwards horizontal", () => {
    expect(fillRange(src, { r: 1, c: -1 }).map(p => p.c)).toEqual([0]);
  });
  it("excludes the source cell and returns [] when target == source", () => {
    expect(fillRange(src, { r: 1, c: 1 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd client && npx vitest run src/__tests__/tableCells.test.js`
Expected: FAIL — `fillRange` not exported.

- [ ] **Step 3: Implement `fillRange`**

Append to `client/src/helpers/tableCells.js`:
```js
/**
 * Cells the fill gesture should write, given the source cell and the cell
 * under the pointer. Constrained to a single axis (Excel-style): the axis
 * with the larger delta wins; the other axis is pinned to the source.
 * Source cell itself is excluded. Targets clamped to >= 0.
 */
export function fillRange(src, target) {
  const dr = target.r - src.r;
  const dc = target.c - src.c;
  if (dr === 0 && dc === 0) return [];
  const horizontal = Math.abs(dc) >= Math.abs(dr);
  const out = [];
  if (horizontal) {
    const step = dc > 0 ? 1 : -1;
    for (let c = src.c + step; c !== src.c + dc + step; c += step) {
      if (c >= 0) out.push({ r: src.r, c });
    }
  } else {
    const step = dr > 0 ? 1 : -1;
    for (let r = src.r + step; r !== src.r + dr + step; r += step) {
      if (r >= 0) out.push({ r, c: src.c });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd client && npx vitest run src/__tests__/tableCells.test.js`
Expected: PASS (all tableCells tests including fillRange).

- [ ] **Step 5: Commit**

```bash
git add client/src/helpers/tableCells.js client/src/__tests__/tableCells.test.js
git commit -m "feat: fillRange helper for table copylink fill-drag"
```

---

### Task 5: `table` kind plumbing (selector + QuickAddMenu)

**Files:**
- Modify: `client/src/ui/ContainerKindSelector.jsx` (`CONTAINER_KINDS`, ~line 14; lucide import, line 9)
- Modify: `client/src/ui/QuickAddMenu.jsx` (`ALLOWED_KINDS_BY_ROLE`)

- [ ] **Step 1: Add the Table option to the kind selector**

In `client/src/ui/ContainerKindSelector.jsx`, change the lucide import on line 9 to add `Table` (or `Grid3x3`):
```js
import { List, FileText, LayoutGrid, PenTool, Table } from "lucide-react";
```
Append to the `CONTAINER_KINDS` array (after the `canvas` entry, ~line 42):
```js
  {
    kind: "table",
    label: "Table",
    description: "Spreadsheet grid of cells",
    icon: Table,
    color: "bg-amber-600 hover:bg-amber-500",
  },
```

- [ ] **Step 2: Allow `table` where containers are addable**

In `client/src/ui/QuickAddMenu.jsx`, find `ALLOWED_KINDS_BY_ROLE` and add `"table"` to the array(s) that already include `"doc"`/`"canvas"` for the container/page add surfaces (match the existing entry for the role that lists `list`/`doc`/`board`/`canvas`). Add only to roles that already list `canvas` — do not invent new role keys.

- [ ] **Step 3: Manual verify**

Run `npm run dev` (repo root). In the UI, open a panel's add menu / container kind selector; confirm a **Table** option appears alongside List/Document/Board/Canvas and selecting it creates a container with `kind:"table"` (it will render blank until Task 6).

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/ContainerKindSelector.jsx client/src/ui/QuickAddMenu.jsx
git commit -m "feat: expose table container kind in selector + quick-add"
```

---

### Task 6: `ContainerTable` skeleton + routing (static grid)

End-to-end thin slice: a table container renders a fixed grid from `meta.table` with plain static cells (cell plain-text only, no editor yet).

**Files:**
- Create: `client/src/modules/containers/ContainerTable.jsx`
- Modify: `client/src/modules/ModuleContainer.jsx` (kind checks ~line 452; render branch)
- Modify: `client/src/index.css` (append a `TABLE CONTAINER` section)

- [ ] **Step 1: Create `ContainerTable.jsx` (static render)**

```jsx
// modules/containers/ContainerTable.jsx
// Layout-only table container. Grid lives in occurrence.meta.table.
// Rows/cols/cells are NOT entities. This task renders a static grid;
// live cell editors come in later tasks.
import React, { useMemo, useCallback } from "react";
import { updateOccurrence } from "../../helpers/CommitHelpers";
import { cellKey, emptyCellDoc } from "../../helpers/tableCells";

const DEFAULT_TABLE = () => ({
  columns: [
    { id: "tcol_a", title: "Column 1", width: 160, displayFieldId: null, sort: null, filter: null },
    { id: "tcol_b", title: "Column 2", width: 160, displayFieldId: null, sort: null, filter: null },
  ],
  rowCount: 4,
  cells: {},
});

function plainText(doc) {
  let out = "";
  const walk = (n) => { if (!n) return; if (n.type === "text") out += n.text || ""; (n.content || []).forEach(walk); };
  walk(doc);
  return out;
}

export default function ContainerTable({ occurrence, dispatch, socket }) {
  const table = occurrence?.meta?.table || DEFAULT_TABLE();
  const { columns, rowCount, cells } = table;

  const persist = useCallback((nextTable) => {
    updateOccurrence(socket, dispatch, {
      id: occurrence.id,
      meta: { ...(occurrence.meta || {}), table: nextTable },
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
```
> Note: confirm the exact export name/signature of the optimistic occurrence update in `client/src/helpers/CommitHelpers.js` (the function used elsewhere as `updateOccurrence`/`commitUpdateOccurrence`). Use the same one the codebase already uses for `occurrence.meta` writes (the textblock save path in `TextblockCard.jsx` is the reference). Match its argument shape exactly.

- [ ] **Step 2: Route `kind:"table"` in `ModuleContainer.jsx`**

Near the existing kind checks (~line 452, alongside `isDocContainer`/`isCanvasContainer`), add:
```js
const isTableContainer =
  containerViewType === "table" ||
  (!containerViewType && module?.kind === "table");
```
Add the import at the top with the other container imports:
```js
import ContainerTable from "./containers/ContainerTable.jsx";
```
In the render/branch logic where `isDocContainer`/`isCanvasContainer` choose their content component, add a branch (same precedence position as canvas) returning:
```jsx
<ContainerTable occurrence={containerOccurrence} dispatch={dispatch} socket={socket} />
```
Use the exact local variable names this file uses for the container occurrence (`containerOccurrence`), dispatch, and socket — match the `isCanvasContainer → CanvasContent` branch as the template.

- [ ] **Step 3: Append CSS**

Append to `client/src/index.css` a new numbered section:
```css
/* ===== TABLE CONTAINER ===== */
.table-container { overflow: auto; max-height: 100%; }
.table-grid { display: grid; width: max-content; }
.table-th {
  position: sticky; top: 0; z-index: 2;
  background: var(--input-bg); border: 1px solid var(--border-default);
  font-weight: 600; font-size: 12px; padding: 4px 8px;
}
.table-td {
  border: 1px solid var(--border-subtle); min-height: 28px;
  padding: 2px 6px; font-size: 13px; overflow: hidden;
}
```

- [ ] **Step 4: Manual verify**

Run `npm run dev`. Create a Table container. Expected: a 2-column × 4-row grid with sticky headers renders; no console errors; `npm run test` (client) still green.

Run: `cd client && npm run test`
Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add client/src/modules/containers/ContainerTable.jsx client/src/modules/ModuleContainer.jsx client/src/index.css
git commit -m "feat: table container skeleton + ModuleContainer routing (static grid)"
```

---

### Task 7: Column header controls + TanStack column model

Add TanStack, inline-editable titles, add/delete/resize columns, rowCount controls. Still static cells.

**Files:**
- Modify: `client/src/modules/containers/ContainerTable.jsx`
- Modify: `client/src/index.css` (table section)

- [ ] **Step 1: Build the TanStack column model + header UI**

In `ContainerTable.jsx`:
- Import `{ useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel } from "@tanstack/react-table"`.
- Build `data` as `rows.map(r => ({ r }))` and `columns` as TanStack column defs from `table.columns` (id = col.id; `accessorFn: (row) => getCellSortValue(cells[cellKey(row.r, idx)], col, { occurrencesById, modulesById })` — pull `occurrencesById`/`modulesById` from `GridActionsContext` like other modules do).
- Replace the header `<div className="table-th">` content with: an inline-editable title (`<input>` that commits `title` on blur/Enter via `persist`), a sort caret button (cycles `col.sort` null→"asc"→"desc"), a kebab menu button (placeholder for Task 10/12 — render the button now, wire later), and a right-border resize grip (pointerdown→pointermove updates `col.width`, pointerup persists).
- Add an "+ column" button at the header's right that appends `{ id: "tcol_"+uid(), title: "Column "+(n+1), width:160, displayFieldId:null, sort:null, filter:null }`.
- Add a footer "+ row" control that sets `rowCount + 1`, and a per-row hover "–" that decrements `rowCount` only when it removes the last row (keep v1 simple: only allow removing the trailing row; deleting arbitrary rows is a Non-Goal).
- Column delete lives in the kebab menu: removes the col def AND deletes any `cells["r:c"]` for that column index, then re-indexes higher columns' cell keys. Implement a pure `deleteColumn(table, colIndex)` in `tableCells.js` (see Step 2) so it is unit-tested.

- [ ] **Step 2: Add + test `deleteColumn` / `insertColumn` pure helpers**

Append tests to `client/src/__tests__/tableCells.test.js`:
```js
import { deleteColumn, insertColumn } from "../helpers/tableCells.js";

describe("column structural ops", () => {
  const base = {
    columns: [{ id: "a" }, { id: "b" }, { id: "c" }],
    rowCount: 2,
    cells: { "0:0": 1, "0:1": 2, "0:2": 3, "1:1": 9 },
  };
  it("deleteColumn removes col + reindexes cell keys", () => {
    const out = deleteColumn(base, 1);
    expect(out.columns.map(c => c.id)).toEqual(["a", "c"]);
    expect(out.cells).toEqual({ "0:0": 1, "0:1": 3 });
  });
  it("insertColumn at index shifts keys right", () => {
    const out = insertColumn(base, 1, { id: "x" });
    expect(out.columns.map(c => c.id)).toEqual(["a", "x", "b", "c"]);
    expect(out.cells["0:0"]).toBe(1);
    expect(out.cells["0:2"]).toBe(2);
    expect(out.cells["0:3"]).toBe(3);
    expect(out.cells["1:2"]).toBe(9);
  });
});
```
Implement in `client/src/helpers/tableCells.js`:
```js
function reindex(cells, fromCol, delta) {
  const next = {};
  for (const k of Object.keys(cells)) {
    const [r, c] = k.split(":").map(Number);
    if (c < fromCol) next[k] = cells[k];
    else if (delta < 0 && c === fromCol) continue; // dropped
    else next[`${r}:${c + delta}`] = cells[k];
  }
  return next;
}
export function deleteColumn(table, colIndex) {
  return {
    ...table,
    columns: table.columns.filter((_, i) => i !== colIndex),
    cells: reindex(table.cells, colIndex, -1),
  };
}
export function insertColumn(table, colIndex, colDef) {
  const columns = table.columns.slice();
  columns.splice(colIndex, 0, colDef);
  return { ...table, columns, cells: reindex(table.cells, colIndex, +1) };
}
```

- [ ] **Step 3: Run tests**

Run: `cd client && npx vitest run src/__tests__/tableCells.test.js`
Expected: PASS (including the new column-op tests).

- [ ] **Step 4: Manual verify**

`npm run dev`: rename a column (persists across reload), add/delete a column (cells follow), resize a column, add/remove trailing row. No console errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/modules/containers/ContainerTable.jsx client/src/helpers/tableCells.js client/src/__tests__/tableCells.test.js client/src/index.css
git commit -m "feat: table column model + header controls (title/add/delete/resize/rows)"
```

---

### Task 8: Editor "cell mode"

Add a `mode="cell"` config to `Editor.jsx` that disables doc-only behaviors and rebinds keys for spreadsheet navigation. (Spec §4.)

**Files:**
- Backup: `cp client/src/ui/Editor.jsx client/src/ui/Editor.jsx.backup`
- Modify: `client/src/ui/Editor.jsx`

- [ ] **Step 1: Back up Editor.jsx**

```bash
cp client/src/ui/Editor.jsx client/src/ui/Editor.jsx.backup
```

- [ ] **Step 2: Add the `mode` prop and gate doc-only behaviors**

In `client/src/ui/Editor.jsx`:
- Add `mode = "doc"` to the component props. Define `const isCell = mode === "cell";`.
- Guard every doc-only behavior behind `!isCell`:
  - block handle / block menu mouse-move + render (the `handleEditorMouseMove`, `blockHandle` state, and the block-handle JSX): skip when `isCell`.
  - auto-create-textblock trigger and the `onUpdate` merge pre-pass: skip when `isCell`.
  - the "click empty space focuses end" wrapper `onClick`: keep (harmless) but ensure it does not insert paragraphs.
- Add cell keymap in the existing `handleDOMEvents.keydown` (or `editorProps.handleKeyDown`) — only when `isCell`:
  - `Enter` (no shift): `e.preventDefault()`, call `props.onCellCommitMove?.("down")`.
  - `Shift+Enter`: allow default soft break (do not exit).
  - `Tab`: `e.preventDefault()`, `props.onCellCommitMove?.("right")`; `Shift+Tab` → `"left"`.
  - `Escape`: `e.preventDefault()`, `editor.commands.blur()`.
  - `ArrowUp` at first line / `ArrowDown` at last line: `props.onCellCommitMove?.("up"/"down")` (reuse the existing `endOfTextblock`-style edge checks already in this file for textblock arrow-out).
- Add the new props to the signature: `onCellCommitMove = null`.
- Leave pill/embed/field extensions and the drop pipeline (`dropTargetForElements`, `resolveInsertPos`) fully enabled in cell mode.

- [ ] **Step 3: Regression test the doc editor**

Run: `cd client && npm run test`
Expected: PASS — existing Editor-dependent tests unchanged (cell mode is opt-in; default `mode="doc"` path untouched).

- [ ] **Step 4: Manual verify doc mode unaffected**

`npm run dev`: open a normal doc container; typing, block handles, auto-textblock, drops all behave exactly as before (no behavior change when `mode` defaults to `"doc"`).

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/Editor.jsx
git commit -m "feat: add opt-in cell mode to Editor (gates doc-only behaviors + cell keymap)"
```

---

### Task 9: Live cell editors + persistence (no virtualization yet)

Mount an `<Editor mode="cell">` per cell over `cells["r:c"]`; persist edits to `meta.table.cells`.

**Files:**
- Modify: `client/src/modules/containers/ContainerTable.jsx`
- Reference pattern: `client/src/modules/TextblockCard.jsx` (Editor-over-textmap + onChange persist)

- [ ] **Step 1: Replace static cell render with a `TableCell` component**

In `ContainerTable.jsx`, add an internal `TableCell` component:
- Renders `<Editor>` with `mode="cell"`, `editable`, `content={cells[cellKey(r,c)] || emptyCellDoc()}`, mirroring how `TextblockCard.jsx` wires `Editor` (`onChange` → debounced persist of the new JSON into `meta.table.cells[key]` via the same `persist(nextTable)` already in this file; copy `cells` then set the key).
- `onCellCommitMove={(dir) => focusCell(nextCoord(r,c,dir))}` where `focusCell` focuses the target cell's editor (track refs in a `Map` keyed by `r:c`); clamp to grid bounds.
- Keep the editor keyed by stable `cellKey(r,c)` so React doesn't remount on data changes.

- [ ] **Step 2: Wire focus navigation**

Add a `cellRefs` ref (`useRef(new Map())`), register each cell's focus handle, and a `focusCell({r,c})` that calls the stored handle (or no-op if out of bounds / not mounted).

- [ ] **Step 3: Manual verify (this is integration/UI — no unit test; verify in browser)**

`npm run dev`, create a Table container:
- Type into a cell → text persists across reload.
- `Enter` moves to the cell below; `Tab` to the right; `Shift+Tab` left; `Esc` blurs.
- Multiple cells editable simultaneously without one stealing another's caret.

Run: `cd client && npm run test`
Expected: PASS (no regressions; cell behavior verified manually as it is editor/DOM integration).

- [ ] **Step 4: Commit**

```bash
git add client/src/modules/containers/ContainerTable.jsx
git commit -m "feat: live TipTap cell editors with spreadsheet nav + persistence"
```

---

### Task 10: Drop-into-cell + displayFieldId projection

Reuse the existing Editor drop pipeline; add the column display-field picker and projection.

**Files:**
- Modify: `client/src/modules/containers/ContainerTable.jsx`
- Reference: `client/src/docs/ModuleEmbedNode.jsx` (how an embed renders an occurrence), `client/src/ui/FieldRenderer.jsx`

- [ ] **Step 1: Confirm drop works (no new drop code expected)**

Because each cell is a live `<Editor>`, dropping an instance/field/embed already lands in the cell at the cursor via the existing `Editor.jsx` `dropTargetForElements`/`resolveInsertPos`. Manually verify: drag an instance from a list/Command Center into a table cell → it inserts as a `moduleEmbed` inside that cell. If a drop is rejected, check `Editor.jsx` `canDrop` accepts the same types in cell mode as doc mode (it should — Task 8 left the pipeline enabled). Do not add a second drop system.

- [ ] **Step 2: Add the column display-field picker**

In the column kebab menu (Task 7 placeholder), add a "Show field" picker: a field selector over `fieldsById` (reuse the existing field-picker component used in `InstanceForm`/`FieldsTab` — match its usage; do not build a new picker). Selecting writes `columns[colIndex].displayFieldId`; "Clear" sets it to `null`. Persist via `persist`.

- [ ] **Step 3: Project a single field when configured**

When a cell's doc is a single embed AND `column.displayFieldId` is set, render that occurrence's single field instead of the full embed. Reuse `FieldRenderer` for the occurrence + that fieldId (compact, `hideName`), exactly as `ModuleEmbedNode`/`Instance` already render a field elsewhere — wrap the embed node view so configured columns project. When `displayFieldId` is null, render the embed's default (the occurrence's normal compact `ModuleInstance` form — unchanged, "exactly how it always is"). Implement the projection in the `moduleEmbed` NodeView path (pass a `displayFieldId` down via Editor `mode="cell"` context / prop), not by mutating the stored doc.

- [ ] **Step 4: Manual verify**

`npm run dev`: drop an occurrence into a cell (renders as normal compact instance). Set the column's display field → the cell now shows only that field, editable, writing back to the occurrence. Clearing the display field restores the full instance render.

Run: `cd client && npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/modules/containers/ContainerTable.jsx client/src/ui/Editor.jsx
git commit -m "feat: column displayFieldId projection for occurrence cells"
```

---

### Task 11: copylink fill-drag (Copy + CopyLink, chip + Alt)

**Files:**
- Modify: `client/src/modules/containers/ContainerTable.jsx`
- Use: `assignLinkedGroup` (Task 2), `makeEmbedCellDoc`/`fillRange` (Tasks 3-4), `client/src/helpers/CommitHelpers.js` (optimistic occurrence create — match the existing helper used to mint copy occurrences elsewhere, e.g. in `dropHandlers.js`/`LayoutHelpers.js`)

- [ ] **Step 1: Render the fill handle**

On the focused cell, render a 8×8 nub at the bottom-right corner (`.table-fill-handle`) plus a small Copy/CopyLink toggle chip (`.table-fill-mode`) beside it. Track `fillMode` state (default `"copylink"`, persisted to `localStorage["moduli-table-fill-mode"]`).

- [ ] **Step 2: Implement the pointer gesture (custom, not Pragmatic DnD)**

`pointerdown` on the nub → capture `src={r,c}`. `pointermove` → hit-test the cell under the pointer (use `document.elementFromPoint` → closest `[data-r][data-c]`), compute `fillRange(src, target)`, add `.table-fill-preview` to those cells. `pointerup` → read `e.altKey` (Alt forces `"copy"`), commit, clear preview. Add CSS for `.table-fill-handle`, `.table-fill-mode`, `.table-fill-preview`.

- [ ] **Step 3: Commit logic**

For the resolved mode and each target cell from `fillRange`:
- Determine the source cell's content: parse `cells[cellKey(src.r,src.c)]` for a single embed occ id (`firstEmbedOccId` — export it from `tableCells.js`).
- **Embed source + CopyLink:** `const { linkedGroupId } = assignLinkedGroup(sourceOcc, tagFn)`; mint a new occurrence (same `targetId`, copied `fields`) with `linkedGroupId` set, using the same optimistic create helper the codebase already uses; set the target cell to `makeEmbedCellDoc(newOccId)`.
- **Embed source + Copy:** same mint but WITHOUT `linkedGroupId` (independent).
- **Plain-text/other source:** deep-clone the source cell's doc JSON verbatim into each target cell (no series extrapolation — Non-Goal).
- Apply ALL target cell writes + any new occurrences in a single batched optimistic update (one `persist(nextTable)` for `cells`, plus the occurrence creates) so there is one socket round-trip's worth of optimistic state, never waiting on the server.

- [ ] **Step 4: Manual verify the headline workflow**

`npm run dev`: occurrence in col 0; set cols 1..N display fields; fill-drag col-0 across the row in CopyLink → each cell shows its column's field; editing one field updates all linked cells live (via existing `CommitHelpers` linked fan-out). Repeat with Alt held → independent copies (editing one does NOT change others). Plain-text fill copies the text.

Run: `cd client && npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/modules/containers/ContainerTable.jsx client/src/helpers/tableCells.js client/src/index.css
git commit -m "feat: copylink fill-drag (Copy/CopyLink chip + Alt) for table cells"
```

---

### Task 12: View-only sort + table-local column filter

**Files:**
- Modify: `client/src/modules/containers/ContainerTable.jsx`
- Reuse: the comparator set + value widgets used by grid filters (`client/src/ui/FilterNavWidgets.jsx`, the comparator list from `GridSettingsTab.jsx`/`FiltersTab.jsx`)

- [ ] **Step 1: Wire TanStack sorting (view-only)**

Derive TanStack `sorting` state from `table.columns[].sort`. Clicking the header sort caret cycles the column's `sort` and persists it. Use `getSortedRowModel()`; render rows in `table.getRowModel().rows` order. The underlying `cells` map is never rewritten — clearing sort restores original row order. (Confirm via manual check: sort, then clear, original order returns; `cells` keys unchanged.)

- [ ] **Step 2: Add the per-column filter popover**

In the column kebab/filter affordance, add a popover hosting the SAME comparator dropdown + value widget the grid filters use (import and reuse `FilterNavWidgets` / the shared comparator constant — do not define a new comparator list). Writes `columns[colIndex].filter = { comparator, value }` (or `null` to clear), persisted.

- [ ] **Step 3: Apply as a TanStack column filter**

Build `columnFilters` from `columns[].filter`; implement a `filterFn` that evaluates the column's comparator against `getCellSortValue(...)` using the same comparator semantics the app already uses (reuse the existing predicate/comparator evaluator if one is exported; otherwise a thin adapter that calls it). View-only: non-matching rows are hidden from render; `cells` untouched.

- [ ] **Step 4: Confirm cascade still applies (no new code)**

The table container is an occurrence and already obeys `getEffectiveFilterForOccurrence`/`isOccurrenceVisible`. Manually verify: an embedded occurrence hidden by the active grid/ancestor filter is hidden in its cell exactly as elsewhere; the table-local column filter is independent and stacks beneath it.

- [ ] **Step 5: Manual verify + suite**

`npm run dev`: sort a column asc/desc/none (view-only, reversible); set a column filter (rows hide), clear it (rows return); change the global grid filter and confirm embedded-occurrence visibility tracks the cascade.

Run: `cd client && npm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/modules/containers/ContainerTable.jsx
git commit -m "feat: view-only column sort + table-local filter reusing grid comparators"
```

---

### Task 13: Virtualization (rows + columns)

Mount live editors only for on-screen cells; off-screen unmounted. Must feel seamless.

**Files:**
- Modify: `client/src/modules/containers/ContainerTable.jsx`

- [ ] **Step 1: Add row + column virtualizers**

Use `@tanstack/react-virtual` (`useVirtualizer`) for rows and columns over the scroll container. Render only virtual rows/columns; absolutely position cells using virtual item `start`/`size`. Keep the header row sticky and aligned to the column virtualizer's horizontal offset.

- [ ] **Step 2: Seamlessness safeguards**

- Stable React `key` per cell = `cellKey(r,c)` (already), so scrolling reuses instances where possible.
- Overscan: rows `8`, columns `2`.
- Keep the currently-focused cell mounted even if it scrolls slightly out of the overscan window (track `focusedCell`; force-include it in the rendered set) so the caret is never destroyed mid-edit.
- Debounce unmount of just-scrolled-off editors by one animation frame to avoid flicker on fast scroll.

- [ ] **Step 3: Manual verify on a large table**

`npm run dev`: set `rowCount` to ~200 (temporarily, via the +row control or by editing meta). Scroll fast: smooth, no blank flashes, no caret loss while editing a cell that scrolls a little. Type in a cell, scroll it off and back: content intact.

Run: `cd client && npm run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/modules/containers/ContainerTable.jsx
git commit -m "feat: virtualize table rows/cols (visible-only live editors, seamless scroll)"
```

---

### Task 14: Polish, folder docs, full suite, cleanup

**Files:**
- Modify: `client/src/modules/CLAUDE.md`, `client/src/helpers/CLAUDE.md`, `client/src/ui/CLAUDE.md`
- Delete: `client/src/helpers/LayoutHelpers.js.backup`, `client/src/ui/Editor.jsx.backup` (only after suite is green)

- [ ] **Step 1: Update folder CLAUDE.md files**

Add a dated "Recent Changes" entry to each touched folder's `CLAUDE.md` summarizing: new `ContainerTable.jsx` (layout-only, TipTap-per-cell, virtualized), `Editor.jsx` cell mode, `assignLinkedGroup` extraction, `tableCells.js` helpers, `table` kind in selector/QuickAddMenu. Keep it to the file/responsibility + key behavior (per the repo's token-efficiency rule).

- [ ] **Step 2: Full client suite**

Run: `cd client && npm run test`
Expected: PASS (all existing + new tests). If any fail, fix before proceeding — do not delete backups.

- [ ] **Step 3: Remove backups once green**

```bash
git rm --cached client/src/helpers/LayoutHelpers.js.backup client/src/ui/Editor.jsx.backup 2>/dev/null || true
rm -f client/src/helpers/LayoutHelpers.js.backup client/src/ui/Editor.jsx.backup
```

- [ ] **Step 4: Final manual smoke**

`npm run dev`: create table, type, drop occurrence, set display field, copylink fill a row, edit a linked field (all twins update), sort/filter a column (view-only), large-table scroll. No console errors. `npm run dev` works.

- [ ] **Step 5: Commit**

```bash
git add client/src/modules/CLAUDE.md client/src/helpers/CLAUDE.md client/src/ui/CLAUDE.md
git commit -m "docs: record table container changes in folder CLAUDE.md; remove refactor backups"
```

---

## Self-Review

**Spec coverage:**
- §1 library split → Task 1 (deps), Tasks 7/13 (TanStack/virtual), Tasks 8-9 (TipTap cells). ✓
- §3 data model (`meta.table`, cells map, sort-key derivation) → Tasks 3, 6, 7. ✓
- §4 cell rendering + active editing + routing + cell mode → Tasks 6, 8, 9. ✓
- §5 drop-into-cell + fill-drag (Copy/CopyLink, chip+Alt, batched optimistic) → Tasks 10, 11. ✓
- §5/§8 `assignLinkedGroup` extraction → Task 2. ✓
- §6 two-layer view-only sort/filter (cascade automatic + table-local reusing comparators) → Task 12. ✓
- §7 column header UI (title/sort/filter/displayField/resize/add/delete/rowCount) → Tasks 7, 10, 12. ✓
- §8 integration points (selector, QuickAddMenu, ModuleContainer, Editor, LayoutHelpers, CommitHelpers, package.json, index.css) → Tasks 1, 5, 6, 8, 10. ✓
- §9 risks (cell-mode surface, virtualization seamlessness, linked fan-out scope, drop precision) → Tasks 8 (regression-gated), 13 (seamlessness safeguards), 11 (linked fan-out verified), 10 (drop precision manual check). ✓
- §10 testing → unit tests in Tasks 2,3,4,7; manual/integration checkpoints + suite runs in UI tasks (honest: editor/DnD/virtualization are integration-tested manually, consistent with the repo's testing workflow). ✓
- §11 phasing → Tasks 5-13 follow the spec's tracer-bullet order. ✓

**Placeholder scan:** Pure-logic tasks (2,3,4,7) contain complete code + tests. UI tasks specify exact files, the reference component to copy, the exact integration variables/props to match, and concrete CSS — no "TBD"/"add error handling". The few "match the existing helper" notes name the specific reference file to read (e.g. `TextblockCard.jsx`, `dropHandlers.js`) because the precise local export name must be read from the codebase, not guessed; this is a deliberate, bounded instruction, not a placeholder.

**Type consistency:** `cellKey`, `emptyCellDoc`, `makeEmbedCellDoc`, `getCellSortValue`, `fillRange`, `deleteColumn`, `insertColumn`, `assignLinkedGroup`, and the `meta.table` shape (`{columns:[{id,title,width,displayFieldId,sort,filter}],rowCount,cells}`) are used identically across Tasks 2-13. `firstEmbedOccId` is defined in Task 3 and explicitly exported in Task 11. `mode="cell"` / `onCellCommitMove` introduced in Task 8 are consumed in Task 9. Consistent.

---

## Execution Handoff

(Presented to the user after save.)
