# Table Container — Design Spec

_Date: 2026-05-17_
_Status: approved design, pre-implementation_

## 1. Overview

A new container **kind** `"table"` that renders an Excel-style grid. The grid
(rows, columns, cells) is **pure layout** — rows/columns/cells are NOT entities,
modules, or occurrences. The grid structure is a descriptor stored on the
**container occurrence**.

Each **cell is a live, textblock-style mini rich-text editor** (TipTap) over a
cell-local `textmap`. You can type into a cell, and you can drag content
("drop into individual areas like a doc") into a precise position inside a
cell — exactly the existing doc/textblock drop behavior, reused wholesale. A
cell is NOT a module and is NOT draggable as a unit; it is a fixed structural
slot you drop *into*.

Columns carry a title plus **sort**, **filter**, and a **display** config. The
display config lets a column say "if a cell holds an occurrence, show only
field X" — which, combined with **copylink fill-drag** (Excel corner-drag),
produces the headline workflow: an occurrence in column 0, each subsequent
column bound to a field, fill-drag the row in CopyLink mode so every cell is a
live-linked twin showing only its column's field.

Library split (confirmed by the "what works best with Pragmatic DnD" criterion,
same reasoning that picked TipTap):

- **TanStack Table** (`@tanstack/react-table`) — headless. Owns column model,
  sort logic, column-filter logic, and row/column virtualization. Renders
  nothing.
- **TipTap** (already in repo, `Editor.jsx`) — owns cell content, the
  pill/embed extensions, the drop-into-position pipeline, and the
  `linkedGroupId` copylink fan-out.

They combine without conflict because TanStack is headless: we render every
cell ourselves, and what we render is a TipTap surface.

## 2. Goals / Non-Goals

### Goals
- New `kind: "table"` container, creatable from `ContainerKindSelector` and
  `QuickAddMenu`.
- Grid is layout-only; structure lives in `occurrence.meta.table`.
- Each visible cell is a live TipTap mini-editor: type freely; drop occurrences
  / fields / embeds into a precise position like a doc textblock.
- Column headers: inline-editable title, sort (none→asc→desc), table-local
  filter (reusing existing comparator primitives), display-field picker,
  width-resize, add/insert/delete column.
- copylink fill-drag (corner handle) with **both** a Copy/CopyLink toggle chip
  (default CopyLink) **and** an Alt modifier (Alt = Copy).
- Two filter layers: the existing ancestor/grid **cascade** applies
  automatically; a new **table-local per-column** filter applies as a
  view-only TanStack column filter.
- Sort/filter are **view-only** transforms — they never rewrite cell content
  or positions; clearing them restores the original layout.
- Virtualized: only on-screen cells are mounted as live editors; must feel
  seamless on scroll.

### Non-Goals (YAGNI for v1)
- No formulas / cell references / spreadsheet expression engine.
- No Excel "smart series" autofill (1,2,3… extrapolation). Fill copies the
  source value/content only.
- No multi-cell rectangular range *selection* clipboard ops beyond the fill
  gesture.
- No CSV import/export.
- No per-cell formatting toolbar beyond what the shared Editor already gives.
- No cell merging / spanning.

## 3. Data Model

The table descriptor lives on the **container occurrence** (per-placement
state), never on the module:

```js
occurrence.meta.table = {
  columns: [
    {
      id: "tcol_<uid>",            // stable id
      title: "Protein",
      width: 140,                  // px, resizable; default 160
      displayFieldId: null,        // when a cell holds an occurrence embed,
                                   //   render ONLY this field of it
      sort: null,                  // null | "asc" | "desc" (view-only)
      filter: null                 // null | { comparator, value } (table-local)
    },
    // ...
  ],
  rowCount: 12,                    // pure layout row count
  cells: {                         // sparse map keyed "r:c"
    "0:0": <tiptap JSON doc>,      // a cell textmap fragment
    "3:1": <tiptap JSON doc>,
    // missing key = empty cell
  }
}
```

- **Rows/cols/cells are not entities.** A cell is a coordinate; its content is
  a TipTap doc fragment stored in `cells["r:c"]`.
- **Empty cell** = no `cells` key. Rendered as an empty live editor (drop
  target + typing target).
- **Occurrence-in-cell** = a `moduleEmbed` / `instancePill` node *inside* that
  cell's textmap, pointing at a normal occurrence id. The referenced
  occurrence is a real occurrence (parented wherever it already lives — the
  embed does not require re-parenting, matching how doc embeds work today).
- **Field-only display** = either a `fieldPill` node, or a `moduleEmbed` whose
  column has `displayFieldId` set so the renderer projects only that field.
- **Plain text/number** = ordinary text in the cell's textmap. Numeric vs text
  is auto-detected from the cell's plain-text content for sort/filter keying.

### Sort/filter key derivation
TanStack needs one comparable scalar per (row, column). `getCellSortValue(r,
c)`:
1. If the cell textmap contains a single occurrence embed AND the column has
   `displayFieldId` → that occurrence's resolved field value.
2. Else if it contains an occurrence embed (no displayFieldId) → the
   occurrence label.
3. Else → the cell's plain-text content; coerced to Number when the trimmed
   string is fully numeric, else the string.

## 4. Cell Rendering & Active Editing

New component `client/src/modules/containers/ContainerTable.jsx` (parallel to
`ContainerList.jsx`), routed from `ModuleContainer.jsx`.

- **Routing:** in `ModuleContainer.jsx`, alongside the existing
  `isDocContainer` / `isPoolContainer` / `isCanvasContainer` checks (~line
  452), add `isTableContainer = containerViewType === "table" || (!containerViewType && module?.kind === "table")` and render `<ContainerTable>`.
- **Cell editor:** reuse `Editor.jsx` via a new **cell mode** prop set. Each
  visible cell mounts an `<Editor>` over `meta.table.cells["r:c"]` (or an empty
  doc). This mirrors the existing `TextblockCard.jsx` pattern (Editor over a
  textmap, onChange → persist) — the codebase already runs many concurrent
  sub-editors in any multi-textblock doc, so this is a proven pattern.
- **Cell mode** (new `mode="cell"` / equivalent flags on Editor) disables
  doc-only behaviors that don't make sense in a cell:
  - no block handles / block menu,
  - no auto-create-textblock and no merge pre-pass,
  - `Enter` = commit + move focus to the cell below (spreadsheet nav), not
    insert paragraph; `Shift+Enter` = soft newline within the cell;
  - `Tab` / `Shift+Tab` = next/prev cell; `Esc` = blur;
  - arrow-out at content edge = move to adjacent cell.
  Pill/embed/field extensions and the drop pipeline stay enabled.
- **Persistence:** Editor `onChange` writes `occurrence.meta.table.cells["r:c"]`
  via `CommitHelpers.updateOccurrence` (optimistic, same path as
  TextblockCard). Because `linkedGroupId` fan-out in `CommitHelpers.js`
  (~line 149) mirrors `textmap`/`fields` to linked siblings, copylinked cells
  stay in sync automatically when one is edited.
- **Virtualization:** TanStack row + column virtualization. Only cells in (or
  near, small overscan) the viewport mount a live `<Editor>`. Off-screen cells
  are unmounted. Because you can only drop where you can see, "drop into any
  cell" is preserved. Scroll must feel seamless (overscan tuned; lightweight
  cell wrapper; editor mounts keyed by stable `r:c`).
- **Default occurrence render (no displayFieldId):** the embedded occurrence
  renders exactly as it does everywhere else (its normal compact
  `ModuleInstance` form via the existing `moduleEmbed` / `ModuleEmbedNode`
  rendering). No special-casing — consistent with the rest of the system.

## 5. DnD — drop into cells + copylink fill-drag

### Drop into a cell
- Each visible cell's Editor is already a Pragmatic DnD drop target with
  insert-position resolution (the existing `Editor.jsx` `dropTargetForElements`
  + `resolveInsertPos`). Dropping an instance/field/embed lands at the cursor
  position inside that cell exactly like a doc — no second drop system.
- No new `meta.cell` stamping and no new `dropHandlers.js` `TABLE_CELL` branch
  is required for the in-cell drop path, because the embed lives in the cell
  textmap, not as a re-parented child with positional meta. (The earlier
  `meta.cell` design is superseded by the TipTap-cell model.)
- Copy vs move vs copylink for in-cell drops follow the existing Editor drop
  semantics (copy mints a new occurrence/embed; copylink shares
  `linkedGroupId`; move detaches the source via `embedDeleteRegistry` /
  parent-occurrence filter, as Editor already does).

### Fill-drag (Excel corner handle)
- The focused cell shows a small **fill handle** nub at its bottom-right
  corner. This is a **custom pointer gesture** (like `CanvasContent`'s pointer
  gestures), NOT Pragmatic DnD: pointerdown on the nub → track pointermove to
  highlight the covered cell range (constrained to a single row or single
  column run, Excel-style) → pointerup commits.
- A small **Copy / CopyLink toggle chip** sits beside the handle (default
  **CopyLink**, remembers last choice). **Alt held at release = Copy**
  regardless of chip. Both affordances exist (confirmed).
- Commit, for each target cell:
  - **Source cell contains an occurrence embed:**
    - *CopyLink* → reuse only the **`linkedGroupId` assignment + source-tagging
      logic** from `LayoutHelpers.copylinkInstanceToContainer` (source's
      existing group, else source occurrence id, else new uid; tag the source
      occurrence with the group if untagged). Do **not** call it whole — its
      container-insertion + `occurrences[]` ordering does not apply, because
      the linked occurrence lives in the target cell's textmap as an embed
      node, not as an ordered container child. Extract that group-assignment
      into a small shared helper (`assignLinkedGroup(sourceOcc)`), used by both
      the existing copylink path and fill-drag. Then write a cell textmap
      containing one embed node for the linked occurrence. If the target
      column has `displayFieldId`, the embed renders only that field. Live
      edits propagate via the existing `CommitHelpers` linked fan-out.
    - *Copy* → mint an independent occurrence (same `targetId`, copied
      `fields`), write a one-embed cell textmap referencing it.
  - **Source cell is plain text/number:** copy the textmap fragment verbatim
    into each target cell (no series extrapolation — Non-Goal).
- All target writes are a single batched `updateOccurrence` to
  `meta.table.cells` (optimistic; one socket emit).

### Headline workflow (falls out of the above)
1. Drop an occurrence into the column-0 cell of a row.
2. Set columns 1..N each to a `displayFieldId` via the column menu.
3. Grab the column-0 cell's fill handle, drag across the row, CopyLink.
4. Every cell in the row is now a live-linked twin of that occurrence showing
   only its column's field; editing any cell's field updates them all.

## 6. Sort & Filter — two layers, view-only

### Layer A — ancestor/grid cascade (existing, automatic, no new code)
The table container is an occurrence; it already obeys
`getEffectiveFilterForOccurrence` / `getLocalFilterConditions` /
`isOccurrenceVisible` and `occurrence.filters[]`. Grid and ancestor filters
continue to flow in unchanged ("still follows the parent filters"). An
occurrence embedded in a cell that the cascade hides renders as the cascade
hides it elsewhere.

### Layer B — table-local per-column filter (new, view-only)
- `meta.table.columns[].filter = { comparator, value }`, applied as a TanStack
  **columnFilter** over the derived sort/filter key (Section 3). View-only:
  hides rows from display, never mutates `cells`.
- The filter editor in the column menu **reuses the existing comparator /
  condition primitives** used by `grid.namedFilters` (the same comparator set
  and `FilterNavWidgets`-style value widgets), so behavior matches the rest of
  the app. It is *not wired into* `grid.namedFilters` (independent, local) but
  sits *beneath* Layer A in precedence.
- Column **sort** (`columns[].sort`) is a TanStack sorting state over the same
  key. View-only — clearing sort restores original row order;
  cells/positions are never rewritten (confirmed).

## 7. Column Header UI

A header row above the grid body. Per column:
- **Title** — inline-editable (click to edit, blur/Enter commits to
  `columns[].title`).
- **Sort caret** — click cycles none → asc → desc (`columns[].sort`).
- **Filter icon** — opens a small popover hosting the reused comparator +
  value widget; writes `columns[].filter`. Icon reflects active/empty state.
- **Column menu** (kebab): set/clear **display field** (field picker over
  `fieldsById`), set width, insert column left/right, delete column.
- **Resize** — drag the header's right border; writes `columns[].width`.
- **Add column** — button at the right edge appends a new column def.
- **Row count** — a control to add/remove trailing rows (`rowCount`); a
  trailing "+" row at the bottom adds one row.

All header mutations go through `CommitHelpers.updateOccurrence` on
`meta.table` (optimistic).

## 8. Integration Points (files)

- `client/src/ui/ContainerKindSelector.jsx` — add a `table` entry to
  `CONTAINER_KINDS` (Table label, a grid icon, color).
- `client/src/ui/QuickAddMenu.jsx` — allow `table` where containers are
  addable (`ALLOWED_KINDS_BY_ROLE`).
- `client/src/modules/ModuleContainer.jsx` — add `isTableContainer` routing
  (~line 452) → render `<ContainerTable>`; pass `containerOccurrence`,
  dispatch, socket.
- `client/src/modules/containers/ContainerTable.jsx` — **NEW**. Owns the
  TanStack table instance, virtualization, header row, fill-handle gesture,
  cell editor mounting.
- `client/src/ui/Editor.jsx` — add **cell mode** (prop/config) gating block
  handles, auto-textblock, merge pre-pass, and Enter/Tab/arrow nav as
  described in §4. No changes to the existing drop pipeline.
- `client/src/helpers/LayoutHelpers.js` — extract the `linkedGroupId`
  assignment + source-tagging out of `copylinkInstanceToContainer` into a
  shared `assignLinkedGroup(sourceOcc)` helper; refactor the existing function
  to call it (behavior-preserving) and have fill-drag call it too. Add a thin
  helper to mint a one-embed cell textmap for fill-drag.
- `client/src/helpers/CommitHelpers.js` — no change expected; the existing
  `linkedGroupId` textmap/fields fan-out (~line 149) already covers copylinked
  cell sync. Verify it fans out `meta` writes too; if it only fans out
  top-level `textmap`/`fields`, extend the linked-sibling mirror to also
  mirror `meta.table.cells` for the changed key (scoped, additive).
- `client/package.json` — add `@tanstack/react-table` (+ a virtualizer, e.g.
  `@tanstack/react-virtual`).
- `client/src/index.css` — a new section for `.table-container`, header row,
  cell, fill-handle, resize-grip styles.

## 9. Risks / Open

- **Editor "cell mode" surface area.** `Editor.jsx` is large and doc-oriented.
  Cell mode must cleanly *disable* doc behaviors without regressing doc usage.
  Mitigation: gate every doc-only behavior behind an explicit `mode !== "cell"`
  check; add focused tests for cell-mode keymap.
- **Virtualization seamlessness.** Mount/unmount of TipTap editors on scroll
  must not flash or lose focus/caret. Mitigation: stable `r:c` keys, modest
  overscan, keep the focused cell mounted even if it scrolls slightly
  off-viewport, debounce unmount.
- **Linked fan-out scope.** Confirm `CommitHelpers` linked mirror covers the
  `meta.table.cells` write path for copylinked cells; extend if it only
  mirrors `textmap`/`fields`.
- **Sort/filter key for rich cells.** A cell can contain mixed content; the
  derivation in §3 picks one scalar deterministically — acceptable for v1,
  documented as a known simplification.
- **Drop precision in tiny cells.** `resolveInsertPos` in a very short cell
  editor — verify the existing left-edge / midline heuristics behave in a
  1-line box; tune if needed.

## 10. Testing

- Unit: `getCellSortValue` (numeric/text/occurrence-field/label cases);
  fill-range computation (single row/col constraint); cell-mode keymap
  (Enter/Tab/arrows).
- Integration: create a table container; type into cells; drop an occurrence
  into a cell; set a column display field; CopyLink fill across a row and
  assert linked sync on field edit; Copy fill produces independent
  occurrences; column sort/filter is view-only (clearing restores order;
  `cells` unchanged); ancestor cascade still hides embedded occurrences.
- Manual/UI: virtualized scroll on a large (e.g. 200-row) table stays smooth;
  caret not lost on scroll; resize/add/delete column; Alt-modifier vs chip for
  fill mode.
- Keep `npm run dev` working at every step; follow the repo testing workflow
  (run relevant tests after each change).

## 11. Phasing (tracer-bullet order)

1. `table` kind plumbing (selector, QuickAddMenu, ModuleContainer routing) +
   empty `ContainerTable` rendering a fixed grid from `meta.table` with plain
   static cells. End-to-end thin slice.
2. Add TanStack column model + header row (title/add/delete/resize) +
   `rowCount` controls. Still static cells.
3. Cell mode in `Editor.jsx`; mount a live editor per visible cell
   (no virtualization yet); typing + persistence to `meta.table.cells`.
4. Drop-into-cell via existing Editor pipeline; default occurrence render;
   column `displayFieldId` projection.
5. Fill-handle gesture: Copy + CopyLink, chip + Alt modifier; batched commit;
   linked sync verified.
6. Sort + table-local column filter (view-only) reusing comparator primitives.
7. Virtualization (row/col) + seamlessness tuning.
8. Polish, tests, CSS, docs/folder CLAUDE.md updates.
