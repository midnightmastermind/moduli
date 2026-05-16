# Select Options Source — Design

_Date: 2026-05-16_

## Problem

`select`-type fields today carry a static `meta.options: string[]`. The old "pool" feature (`meta.sourceType: "pool"` + `meta.poolContainerIds[]` in `client/src/ui/FieldRenderer.jsx:46-68`) tried to make this dynamic by resolving children of named containers, but it's locked to that one shape — children-of-containers, label-only display, no predicate filtering, no other collections.

The user wants full **FIND-parity** with the operations system: a select field should be able to populate its options from any FIND query — same collection picker, same conditional rules, same record-shape path picker — except instead of binding results to a variable, the user picks a per-record path to extract as the option's value. They also want non-FIND modes: an integer range generator (start/end/step) and a manual literal list.

## Goals

1. Replace `meta.options` and the pool mechanism with a single `meta.optionsSource` discriminated union (manual / range / find).
2. The `find` mode reuses operations FIND machinery wholesale — no behavior fork.
3. Both `valuePath` and `labelPath` use the existing `CategoryPathPicker(recordShape:"occurrence")` so any reachable property (`label`, `id`, `fields.<fid>.value`, `parentId`, `_ancestors`, `meta.*`, `_effectiveFilter.<fid>`, etc.) is fair game.
4. Hard migrate the old shapes in one pass; delete dead pool code.
5. No backward-compat shims, no aliasing. Clean rewrite.

## Non-goals

- Quick-add ("create new movie inline from the select dropdown") — old pool feature had this because target container was unambiguous; FIND-mode has no obvious landing parent. Defer to a follow-up.
- Free-text values not in the FIND result. Conflicts with dedupe; adds storage ambiguity. Defer.
- Grouped/sectioned options. Overkill for v1.

## Data Model

```js
field.meta.optionsSource = {
  mode: "manual" | "range" | "find",

  // mode === "manual"
  values?: Array<string | number>,

  // mode === "range"
  range?: { start: number, end: number, step: number },

  // mode === "find"
  find?: {
    over: string,              // "$allInstances" | "$allOccurrences" | "$allContainers" | "$allPages" | "$allTemplates" | "$allFields"
    predicate: { rules: [...] }, // identical shape to operations FIND — supports nested groups
    valuePath: string,         // CategoryPathPicker path on the matched record
    labelPath?: string,        // optional; defaults to valuePath
    sortPath?: string,         // optional; empty = FIND iteration order
    sortDir?: "asc" | "desc",  // default "asc" when sortPath set
    limit?: number,            // default 100
  }
}
```

Exactly one mode active at a time. `meta.optionsSource` is the only options-related key on the field after migration — `meta.options`, `meta.sourceType`, `meta.poolContainerId`, `meta.poolContainerIds` are all deleted.

Stored value on the instance's field remains a primitive (the `value` of the chosen option). No schema change to `occurrence.fields[fid].value`. Snapshot semantics — same as native select today.

## Resolution Runtime

New helper at `client/src/helpers/optionsResolver.js`:

```js
resolveOptions(field, { occurrencesById, modulesById, fieldsById, foldersById })
  → Array<{ value: string|number, label: string }>
```

Branches on `field.meta.optionsSource.mode`:

- **manual**: `values.map(v => ({ value: v, label: String(v) }))`
- **range**: expand `[start, start+step, ..., end]` to `{value, label}` pairs (numeric values).
- **find**:
  1. Read the named collection from the pipeline context built the same way operations build `$allOccurrences` / `$allInstances` / etc. (`collectionBuilders.js`-equivalent — extract from `operationExecutor.js` if not already exported).
  2. Filter by `evaluatePredicate(predicate, record, vars, ctx)` — direct import from `operationExecutor.js`. Same code path as operations FIND; behavior parity by construction.
  3. Extract `valuePath` from each matched record via the same path-resolver operations uses (`resolveExpr` / `getRecordPath`).
  4. Extract `labelPath` if set; else mirror `valuePath`.
  5. Dedupe by `value` (last-write wins on label — predictable iteration order).
  6. Sort by `sortPath` if set, direction per `sortDir`.
  7. Slice to `limit` (default 100). Track total matched separately for overflow indicator.

Returns `{ options: [...], totalMatched: N }` from `resolveOptions` so the caller can show "and N more not shown" badges.

### Reactivity

`FieldRenderer.jsx`: replace the existing pool resolver `useMemo` (lines 30-70) with a single `effectiveField` memo that calls `resolveOptions`. Deps: `[field, occurrencesById, modulesById, fieldsById, foldersById]` — same shape as the current pool memo. Resolved options stored under `meta._resolvedOptions` (underscore-prefixed = runtime-only, never persisted).

`Field.jsx` and `FieldInput.jsx`: read `meta._resolvedOptions` instead of `meta.options`. Each option is `{value, label}` (was bare string before).

### Rendering changes

- **Compact mode**: native `<select>` already renders `{value, label}` cleanly. No new UI beyond the value/label split.
- **Full / Popover mode**: when `_resolvedOptions.length > 10`, the open popover gets a search input at the top filtering on `label.toLowerCase().includes(query)`. Applies to manual and range modes too — pure UX win.
- **Overflow indicator**: when `totalMatched > limit`, dropdown footer shows `… N more not shown — raise limit in field settings`.
- **Empty state**: when `_resolvedOptions.length === 0` and mode is `find`, dropdown shows `No matches — check the field's options source` instead of an empty box.

## Field Settings UI

Replaces the chip-based options editor in `FieldsTab.jsx` lines 267-303. Renders only when `field.type === "select"`.

```
┌─ Options source ────────────────────────────────┐
│  ⦿ Manual   ◯ Range   ◯ Find                    │  three-way pill toggle
├─────────────────────────────────────────────────┤
│  [mode-specific body]                           │
└─────────────────────────────────────────────────┘
```

**Manual body** (preserves today's UX):
```
[Apples ✕] [Oranges ✕] ...
[Add option ⏎________________] [Add]
```

**Range body**:
```
Start: [  1 ]   End: [ 10 ]   Step: [  1 ]
Preview: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
```

**Find body**:
```
Search in:    [ $allInstances ▾ ]               COLLECTION_PICKER_CONFIG from categoryRegistry.js
Where:        ┌──────────────────────────────┐
              │  + Add rule   + Add group    │ <ConditionGroup> from blocks/ConditionGroup.jsx
              │  fields.medium.value IS      │ Each rule's left-path uses
              │      "movies"                │ CategoryPathPicker(recordShape:"occurrence")
              └──────────────────────────────┘
Grab value:   [ label ▾ ]                       CategoryPathPicker(recordShape:"occurrence")
Grab label:   [ — same as value ▾ ]             optional
Sort by:      [ label ▾ ]  [ ↑ asc ▾ ]          optional, both paths via picker
Limit:        [ 100 ]

Preview: ▾ 12 matches (3 deduped)
  • Arrival
  • Inception
  • The Matrix
  • … 9 more
```

The live preview block calls the same `resolveOptions` helper against `local` (the in-progress draft, not the saved field), so the user sees results update as they edit the predicate.

## Migration

Lazy client-side migration in `client/src/state/bindSocketToStore.js` `full_state` handler. Per-field check on ingestion:

```js
function migrateFieldOptionsSource(field) {
  if (field.type !== "select") return field;
  if (field.meta?.optionsSource) return field;  // already migrated

  const next = { ...field, meta: { ...field.meta } };

  if (field.meta?.sourceType === "pool" && field.meta?.poolContainerIds?.length) {
    next.meta.optionsSource = {
      mode: "find",
      over: "$allInstances",
      predicate: { rules: [{
        left: "_ancestors",
        comparator: "HAS_ANCESTOR_ANY",
        right: field.meta.poolContainerIds,
      }]},
      valuePath: "id",
      labelPath: "label",
    };
  } else {
    next.meta.optionsSource = {
      mode: "manual",
      values: Array.isArray(field.meta?.options) ? field.meta.options : [],
    };
  }

  delete next.meta.options;
  delete next.meta.sourceType;
  delete next.meta.poolContainerId;
  delete next.meta.poolContainerIds;

  CommitHelpers.updateField({ dispatch, socket, field: next });
  return next;
}
```

Runs once per old field on first `full_state` after deploy. Persists via existing `updateField`. Subsequent loads short-circuit on `optionsSource` check. No server-side script; no data download.

## Dead Code to Delete in the Same PR

- `FieldRenderer.jsx:30-70` — old pool resolver `useMemo`
- `FieldRenderer.jsx:71-80` — old `handleQuickAddPool` quick-add
- `FieldRenderer.jsx:172-180` — `isPoolSourced` check + Randomize button. **Decision**: re-purpose the Randomize button to apply to *any* `find`-mode select (and arguably any select with > 1 option). Pure UX, no behavior risk — keep.
- `FieldsTab.jsx:267-303` — chip-based options editor (replaced by new three-mode UI)
- Any other `field.meta.options` reads. Grep before deleting.

## Reactivity Note

When occurrences change (create/update/delete), the relevant `*ById` map updates, the `FieldRenderer` memo recomputes, the select re-renders with fresh options. Matches current pool behavior. No new socket events; no operation triggers.

A select's *stored value* (the instance field's value) does NOT auto-update when the source occurrence's `labelPath` changes — that's snapshot behavior, intentional. If the user wants live-tracking, they can pick `valuePath: "id"` + a `labelPath: "label"` and treat the field semantically like a reference; rendered options will reflect the live label, but values stored on existing instances stay as IDs and resolve via the FIND result on each render.

## Testing

- Unit: `optionsResolver.test.js` — manual/range/find branches, dedupe, sort, limit.
- Unit: `migrateFieldOptionsSource.test.js` — pool→find, options→manual, idempotency, edge cases (missing keys).
- Component: `FieldsTab.test.jsx` — three-mode toggle, preview block re-renders on predicate edit.
- Integration: drag a movie occurrence into a "Watch movie" select-bound instance; verify select renders updated options after the change.

## Open Questions

None — design is final pending implementation.
