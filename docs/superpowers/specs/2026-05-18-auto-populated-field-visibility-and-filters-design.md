# Auto-populated Field Visibility & Filter Pickers — Design + Plan

_Date: 2026-05-18. Status: ready to implement._

## Problem

The field-visibility checkbox list in `FieldVisibilitySection` (mounted on any
container/page/panel via HeaderDropdown) and the per-column kebab in
`ContainerTable` both enumerate `Object.values(fieldsById)` — every field in
the grid. That includes many fields irrelevant to the scope (workout fields
in a journal page, etc.), forcing the user to wade through them. Same problem
on the filter side: `FilterEditor` lists every grid field when the user adds
a filter row to a local occurrence, regardless of whether any descendant
actually has that field.

Additionally: when a new occurrence is dropped into a scope that's currently
in `show` mode, that occurrence's bound fields are not in `fieldIds`, so they
render hidden. The user has to manually tick every new field after every drop.

## Goal

Two changes flow from one notion — **"fields present at scope S"** = the
union of fieldIds bound on (or stamped onto) instance-role occurrences that
descend from S, plus whatever's already listed in S's own
`fieldVisibility.fieldIds` (so manually-added fields don't disappear if the
contributing occurrence is later deleted).

1. **Picker enumeration scoped** to fields-present-at-scope, instead of
   `Object.values(fieldsById)`. Applies to:
   - `FieldVisibilitySection` checkbox list (per-occurrence on any
     container/page/panel)
   - `ContainerTable` per-column kebab field-visibility list (scope = that
     column's cell embeds)
   - Filter row field-pickers in `FilterEditor` (opened from `FiltersSection`)
     and `ContainerTable` per-column filter editor
   - `grid.namedFilters` at the grid level stays **unscoped** — those are
     global presets that need to reference any field.

2. **Auto-append on drop** for `fieldVisibility` in **show mode only**. When
   an occurrence lands in a new scope, walk its new ancestors; for each
   ancestor whose `fieldVisibility.mode === "show"`, merge the dropped
   occurrence's fieldIds into `fieldIds` (deduped). Hide/inherit/off modes
   default visible naturally — no write needed. Filters: no auto-write at all
   (picker scope only).

### "Shoots up the chain"

Both pickers (field visibility AND filter row field-picker) scope to
fields-present-in-descendants. That means a field bound to a deeply-nested
instance is visible to the picker at every ancestor up to and including the
grid level. No additional plumbing — it's a consequence of how
`getFieldsPresentInScope` walks the tree.

Concretely: dropping a task with `Calories` two cells deep makes
`Calories` appear in the picker of (a) that cell's per-column kebab,
(b) the table container's HeaderDropdown field-vis menu, (c) the schedule
page's field-vis menu, (d) the panel's field-vis menu, (e) every local
filter editor along the same chain, and (f) — if you choose to scope it —
the grid-level filter editor too. The grid `namedFilters` picker is left
unscoped in this design (lists all `fieldsById`) so users can pre-configure
filters before any data exists, but switching it to grid-root-descendants
scope is a one-line change if you decide otherwise.

This is **not**:
- Feature A (operation introspection via `$allOperations`) — separate spec.
- A change to fieldVisibility cascade semantics, mode set, or storage shape.
- A change to `grid.namedFilters` global picker.

## Architecture

### New selectors (in `client/src/state/selectors.js`)

```js
getFieldsPresentInScope(occurrence, {
  occurrencesById, modulesById, parentByChildId,
}) → Set<fieldId>
```

Descendant walk from `occurrence`. For each descendant whose target module
has `role === "instance"`:
- Add every `fieldId` from `module.fieldBindings[]`
- Add every key from `occurrence.fields` (catches stamped-but-unbound fields
  like Schedule's date/time slot pattern)

Skip textblock/artifact/folder/page/panel/container descendants for the
field-gathering step (they don't carry fields), but walk THROUGH them for
their children. Union the result with `occurrence.fieldVisibility?.fieldIds`
(if present) so explicit picks survive when descendants change.

Memoize via the same `parentByChildId` + identity-key pattern used by
`getEffectiveFilterForOccurrence` / `getEffectiveFieldVisibilityForOccurrence`.

```js
getFieldsPresentInTableColumn(tableOccurrence, columnIndex, {
  occurrencesById, modulesById,
}) → Set<fieldId>
```

Reads `tableOccurrence.meta.table.cells[r:col]` for each row r in `rowCount`.
Each cell is a TipTap doc fragment; iterate its content and pick out
`moduleEmbed` nodes (`type: "moduleEmbed"`, `attrs.occurrenceId: <id>`). For
each embed occurrence, call `getFieldsPresentInScope` and union the results.
Also union with `column.fieldVisibility?.fieldIds`.

### Drop-time auto-append (new file `client/src/helpers/fieldVisibilityAutoAppend.js`)

```js
autoAppendFieldsToAncestorsShowMode({
  newOccurrence,
  destinationOccurrence,   // its new parent
  ctx: { occurrencesById, modulesById, parentByChildId, dispatch, socket },
})
```

Behavior:
1. Compute `newFieldIds` = union of `module.fieldBindings[].fieldId` (from
   `newOccurrence`'s target module) + `Object.keys(newOccurrence.fields || {})`.
   If empty, return early.
2. Walk ancestors of `destinationOccurrence` upward via `parentByChildId`,
   inclusive of `destinationOccurrence` itself.
3. For each ancestor with `fieldVisibility?.mode === "show"`:
   - `missing = newFieldIds \ ancestor.fieldVisibility.fieldIds`
   - If `missing.size > 0`, fire one `CommitHelpers.updateOccurrence` with
     the merged + deduped list.
4. Stop walking when an ancestor's `fieldVisibility.mode === "off"` — that
   ancestor breaks the cascade for descendants, so anything above it is
   irrelevant for this drop.

```js
autoAppendFieldsToTableColumnShowMode({
  tableOccurrence,
  columnIndex,
  newOccurrence,
  ctx: { dispatch, socket, modulesById },
})
```

Parallel helper for table cells. Reads `tableOccurrence.meta.table.columns[colIndex].fieldVisibility`;
if `mode === "show"`, appends missing fieldIds to `fieldIds` and writes back
via `updateOccurrence` (`meta.table.columns` is the path).

### Wire-in points

#### Drop handlers — `client/src/helpers/dropHandlers.js`

After the new occurrence is parented in each branch:
- `handleContainerDrop` — container-as-destination, canvas-as-destination
- `handleOccurrenceMove` — every successful destination branch (grid cell,
  schedule slot, canvas, doc embed)
- `handleDocEmbedDrop` — list/canvas/grid-cell destinations

Each calls `autoAppendFieldsToAncestorsShowMode` once with the new occurrence
and its parent. Cheap and idempotent — does nothing when no ancestor is in
show mode.

#### Table — `client/src/modules/containers/ContainerTable.jsx`

Cell-embed creation paths (cell paste, fill-drag copy/copylink, drop into
empty cell): after the new embed occurrence is minted and persisted, call
both:
- `autoAppendFieldsToTableColumnShowMode` for the receiving column
- `autoAppendFieldsToAncestorsShowMode` for ancestors of the table itself
  (in case the table sits inside a show-mode page/container)

#### Picker enumeration

- `FieldVisibilitySection.jsx:67-70` — `allFields` becomes
  `Object.values(fieldsById).filter(f => fieldsPresent.has(f.id))`, where
  `fieldsPresent` is computed via `getFieldsPresentInScope(occurrence, ctx)`.
  No-op when scope is empty (shows no fields) — that's fine; the user can
  drop something in to populate the menu.

- `ContainerTable.jsx:~1189` — per-column field list iterates
  `getFieldsPresentInTableColumn(table, colIndex) ∪ col.fieldVisibility.fieldIds`.

- `FilterEditor.jsx:61` — `allFields` becomes scoped via a new optional
  `scope` prop. `FiltersSection` (the caller for per-occurrence editors)
  computes the scope's fields-present and passes it through. When `scope` is
  null (e.g. opened from a global context), falls back to current behavior
  (all fields). Same for `dateFields` derivation (line 60).

- `ContainerTable.jsx` per-column filter editor (around the
  `filterPickerCol === c` JSX, ~line 1100): uses `getFieldsPresentInTableColumn`
  to scope its field picker too. The current per-column filter only filters
  on the column's `displayFieldId` (so the picker is implicit), but if/when
  the user picks an arbitrary field for filtering, this scopes it.

### Edge cases

- **Field deleted globally**: `Object.values(fieldsById).filter(fieldsPresent.has(...))`
  naturally excludes deleted fields (they're no longer in `fieldsById`).
  Stale fieldIds in persisted `fieldVisibility.fieldIds` are harmless — they
  just don't render checkboxes.
- **Multiple ancestors in show mode**: the walker hits each independently
  (one updateOccurrence per ancestor). Safe — they're independent overrides.
- **Drop into a scope where `mode === "off"`**: nothing happens (the helper
  short-circuits). Off explicitly means "show all", so no list to extend.
- **Move within the same scope**: `destinationOccurrence` is unchanged, the
  newOccurrence's fieldIds are already in any ancestor show-list (no diff,
  no write).
- **Pre-existing show-mode lists that already contain extra/unrelated fields**:
  we never strip — only append. User keeps full control.

### Why not Model A (just-in-time enumeration, no persistence change)

In show mode with `fieldIds: [Date]`, a freshly-dropped task with Calories +
Protein would render hidden (Calories/Protein not in fieldIds). User said
"defaulted to visible for them" — that requires the show-list to grow on
drop. Model B (persisted auto-append) is the only way to satisfy that
without inverting show-mode semantics. Hide mode and other modes default
visible naturally — no change there.

## Implementation Plan

### Tasks

Order matters — selectors first, then helper, then wire-in, then
enumeration tightening.

1. **Add selector `getFieldsPresentInScope`** to `state/selectors.js`.
   - Pure function over `(occurrence, ctx)`.
   - Walks `occurrence.occurrences[]` recursively + uses `parentByChildId`
     reverse map if needed (probably not — `occurrences[]` is sufficient for
     descendants).
   - Skip occurrences whose target module isn't role `"instance"` for the
     field-gathering step, but DO recurse into containers/pages/panels.
   - Union with `occurrence.fieldVisibility?.fieldIds`.
   - Memoize with the standard composed-key pattern.

2. **Add selector `getFieldsPresentInTableColumn`** to `state/selectors.js`
   (or co-locate in `ContainerTable.jsx` if it's the only consumer).
   - Iterate `tableOccurrence.meta.table.cells` keys matching `r:colIndex`.
   - Each cell is a TipTap JSON doc; walk `content` looking for
     `type: "moduleEmbed"` nodes.
   - For each `attrs.occurrenceId`, resolve via `occurrencesById` and call
     `getFieldsPresentInScope`. Union.
   - Union with `column.fieldVisibility?.fieldIds`.

3. **Create `helpers/fieldVisibilityAutoAppend.js`**.
   - Exports `autoAppendFieldsToAncestorsShowMode` and
     `autoAppendFieldsToTableColumnShowMode`.
   - No tests required for first pass — covered by integration via the
     wire-in points; can add Vitest later if regressions appear.

4. **Wire into `helpers/dropHandlers.js`**.
   - `handleContainerDrop` — both move and copy branches, after the
     destination write.
   - `handleOccurrenceMove` — every destination branch (canvas, schedule,
     grid cell, doc embed).
   - `handleDocEmbedDrop` — list, canvas-page, grid-cell, schedule-slot
     destination branches.
   - Single call site per branch: pass the new occurrence + the destination
     parent occurrence + ctx.

5. **Wire into `modules/containers/ContainerTable.jsx`** at cell-embed
   creation paths.
   - Cell drop / paste path (where a new embed occurrence is minted).
   - Fill-drag copy and copylink paths.
   - Call both helpers (column-level + table ancestors).

6. **Tighten enumeration in `FieldVisibilitySection.jsx`**.
   - Compute `fieldsPresent` via `getFieldsPresentInScope`.
   - Filter `allFields` to those in `fieldsPresent`.

7. **Tighten enumeration in `ContainerTable.jsx`** per-column kebab.
   - Compute `colFieldsPresent` per visible column via
     `getFieldsPresentInTableColumn`.
   - Replace the `allFields.map(...)` checkbox loop with a filtered list.

8. **Tighten enumeration in `FilterEditor.jsx`**.
   - New optional `scope` prop: `{ availableFieldIds: Set<fieldId> }`.
   - When set, `allFields` and `dateFields` filter to that set.
   - `FiltersSection` callers compute the scope and pass it through.

9. **Tighten enumeration in `ContainerTable.jsx`** per-column filter editor.
   - Same `scope` mechanism — wire scoped availableFieldIds to whatever
     field picker the per-column filter exposes (currently implicit on
     `col.displayFieldId`; if/when the user can pick an arbitrary field
     here, this prop is ready).

10. **Update folder CLAUDE.md files** per session rule.
    - `client/src/state/CLAUDE.md` — new selectors.
    - `client/src/helpers/CLAUDE.md` — new auto-append helper, wired into
      dropHandlers.
    - `client/src/ui/CLAUDE.md` — FieldVisibilitySection + FilterEditor
      scope prop.
    - `client/src/modules/CLAUDE.md` — ContainerTable cell-creation hooks
      auto-append.

### Tracer bullet order

1 → 2 → 3 → 6 (smallest end-to-end demo: per-occurrence field-vis menu
narrows; no auto-append yet, no filter changes). Verify visually that the
menu shrinks. Then 4 → 5 (auto-append on drop). Then 7 (table per-column).
Then 8 → 9 (filters). Then 10 (docs).

### Verification

- **Manual** (before any commit): in the Schedule Table cell, open the
  per-column kebab field-visibility menu and confirm only Schedule-task
  fields appear (Date, Time slot, Completed, etc. — NOT workout/nutrition
  fields). Drop a new task with an unbound field; menu shows the new field
  unchecked in `hide` mode, checked in `show` mode.
- **Run**: `npm run dev` and exercise. No new test suite required;
  fold any tricky cases into existing Vitest if they emerge.

### Risk

- Memoization in `getFieldsPresentInScope` must not retain stale references.
  Use the same memo discipline as `getEffectiveFilterForOccurrence` (key on
  occurrencesById + modulesById + parentByChildId identity).
- Auto-append fires `updateOccurrence` from a drop handler — the user
  already sees server echo on every drop, so an additional one per
  show-mode ancestor is fine. Worst case (deeply nested show-mode chain)
  is 3-4 writes per drop, batched anyway by socket.
- Tables: `meta.table.columns[colIndex].fieldVisibility` is a Mixed-type
  Mongoose path. Existing writes elsewhere in `ContainerTable.jsx` already
  use the `meta.table.columns` mutation pattern — reuse that pattern; don't
  invent a new write path.
