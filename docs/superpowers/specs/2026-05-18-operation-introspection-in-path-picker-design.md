# Operation Introspection in CategoryPathPicker — Design + Plan

_Date: 2026-05-18. Status: ready to implement._

## Problem

Operations carry rich relational data — what fields they write, what
occurrences they read from, what triggers them, what other ops they invoke —
but none of it is exposed to the path picker. Authors writing predicates or
filter conditions that want to reason about operations (e.g. "filter goal
items to those whose display field is written by this tracker") have to
guess at internals or hard-code IDs. There's no equivalent of `$allFields`
or `$allOccurrences` for the operations layer.

User example: in the Schedule Table's Goal column, they want each row's Goal
cell to show only the display fields that the row's task affects. The
relationship between "this task" and "that display field" exists only inside
the tracker operation's pipeline — so the picker needs introspection
primitives over the operations to surface it.

## Goal

Expose `$allOperations` as a collection in the picker, with each operation
drillable to a rich set of static-analysis-derived introspection sets that
authors can use in predicates and expressions the same way they use
`$item.fields` or `$item._effectiveFilter`.

This is **not**:
- A change to operation execution semantics. The introspection is a
  read-only derived view computed by walking the pipeline structure.
- Feature B (auto-populated field visibility). Separate spec.
- A reverse index on `$allFields` / `$allOccurrences` ("which ops affect
  me?"). Possible follow-up but not in scope here — the user expression
  for that is `$allOperations` filtered by `fields_written CONTAINS X`,
  which the primary direction already supports.

## Architecture

### Static analyzer (new file `client/src/helpers/operationIntrospection.js`)

```js
analyzeOperation(op) → IntrospectionRecord
```

Pure function. Walks `op.pipeline.steps[]` recursively (LOOP body, IF
then/else) plus `op.triggerObjects[]` and `op.pipeline.sources[]`. Returns:

```js
{
  fields_written:           Set<fieldId>,   // UPDATE / CREATE_ITEM.fields / SET_FIELD_VALUE
  fields_read:              Set<fieldId>,   // predicates, expressions, scope.dateFieldId
  occurrences_written:      Set<occId>,     // hard-coded occIds in CREATE_ITEM.parentId,
                                            // UPDATE_ITEM target, DELETE_ITEM, APPLY_TEMPLATE.target
  occurrences_read:         Set<occId>,     // hard-coded occIds in FIND.itemId, source bindings,
                                            // expression $-refs
  triggered_by_fields:      Set<fieldId>,   // triggerObjects[].targetId where subjectType="field"
  triggered_by_occurrences: Set<occId>,     // triggerObjects[].targetId where subjectType="occurrence"
                                            // | "instance" | "container" | "panel"
  ancestor_scopes:          string[],       // triggerObjects[].ancestorLabel values
  invokes_operations:       Set<opId>,      // RUN_OPERATION.operationName resolved to opIds
  templates_used:           Set<occId>,     // APPLY_TEMPLATE.templateOccurrenceId
  created_modules:          string[],       // "role:kind" strings produced by CREATE_ITEM
}
```

Implementation notes:
- Step types walked: `FIND`, `INIT_VAR`, `SET_VAR`, `LOOP`, `IF`,
  `CREATE_ITEM`, `COPY_LINK`, `APPLY_TEMPLATE`, `UPDATE_ITEM_FIELD`,
  `UPDATE_ITEM_META`, `SET_FIELD_VALUE`, `DELETE_ITEM`, `RUN_OPERATION`,
  `ADD_CHILD`, `LINK_OCCURRENCE_TO_PARENT`, plus any other step types in
  `operationExecutor.js`. Unknown step types are walked into via shape
  (descend into anything that looks like a nested step array).
- Expression scanning: any string value in a config recursively scanned for
  `field:<id>` tokens and `$<varname>.fields.<fid>` patterns → adds to
  `fields_read`. Direct `$<varname>` references to source-bound entities
  contribute to `occurrences_read` if the source's `entityType` is
  occurrence-shaped.
- Hard-coded ID detection: if a string config value matches an occurrence
  ID in `occurrencesById` (passed in via ctx), counts as a literal
  occurrence reference. Same for fieldIds and operation names.
- Operations referenced by NAME (`RUN_OPERATION.operationName`) are
  resolved against `operationsByName` to produce IDs in `invokes_operations`.

A second function `analyzeAllOperations(operationsById, ctx) → Map<opId, IntrospectionRecord>`
memoizes the per-op analysis keyed on the operation's identity.

### Runtime exposure

In `client/src/helpers/operationExecutor.js`, where `$allOccurrences` /
`$allItems` are populated for each pipeline run: add `$allOperations` as an
array of "enriched operations" — each entry is the raw operation merged
with its introspection record fields. This makes drilling
`$allOperations[*].fields_written` work in expressions and predicates.

### Picker integration — `client/src/ui/CategoryPathPicker.jsx`

1. **New `BUILTIN_VAR_SHAPES` entry**:
   ```js
   $allOperations: "operationArray",
   ```

2. **New `SHAPES.operation`** with these keys:
   - Direct fields: `id`, `name`, `description`, `enabled`, `priority`,
     `folderId`, `targetFieldId`
   - Structural: `triggerObjects` (childShape: `triggerObjectArray`),
     `pipeline.sources` (childShape: `sourceBindingArray`),
     `pipeline.steps` (childShape: `stepArray` — optional, mostly for
     debugging since steps are recursive)
   - Introspection (derived sets; each is an array, drillable to the
     element shape):
     - `fields_written` (childShape: `fieldArray`)
     - `fields_read` (childShape: `fieldArray`)
     - `occurrences_written` (childShape: `occurrenceArray`)
     - `occurrences_read` (childShape: `occurrenceArray`)
     - `triggered_by_fields` (childShape: `fieldArray`)
     - `triggered_by_occurrences` (childShape: `occurrenceArray`)
     - `invokes_operations` (childShape: `operationArray`)
     - `templates_used` (childShape: `occurrenceArray`)
     - `ancestor_scopes` (childShape: `stringArray`)
     - `created_modules` (childShape: `stringArray`)

3. **`arrayItemsAsKeys` extended** to handle `operationArray`:
   returns the `SHAPES.operation.keys(ctx)` list — drilling
   `$allOperations[*]` shows operation keys.

4. **New shapes for trigger/source elements**:
   - `triggerObjectArray` → drills `{ eventType, subjectType, subjectRole, targetId, ancestorLabel, priority }`
   - `sourceBindingArray` → drills `{ variableName, entityType, entityId, triggerProp }`

### Picker integration — `client/src/ui/categoryRegistry.js`

1. **Add `$allOperations` to `COLLECTION_ITEMS`** so Loop / Find pickers
   can iterate it:
   ```js
   {
     value: "$allOperations", title: "$allOperations", sub: "operationArray",
     description: "Every operation on the grid (with introspection metadata)",
     hasChildren: false,
   }
   ```

2. **Add a top-level "Operations" category** to `CATEGORIES` (with the
   Operations icon and a sensible color), exposing `$allOperations` plus
   per-operation entries (each operation rendered as a row whose value is
   `op:<id>` and drilling exposes the same `SHAPES.operation` keys). This
   mirrors the way `field:<fid>` rows appear under the Fields category.

3. **Update `recordShapeForCollection`**:
   ```js
   if (over === "$allOperations") return "operation";
   ```

4. **`buildRecordKeyPickerConfig`** picks up `"operation"` automatically
   via that addition.

### Predicate / query usage

Once exposed, authors can write:

- `$op.fields_written CONTAINS field:<fid>` — filter ops by written field
- `$op.triggered_by_occurrences HAS_ANCESTOR $somePage` — find ops scoped
  to a page
- `$op.invokes_operations CONTAINS $someOpId` — find ops that call another
  op
- `$allOperations[*]` as a LOOP source, with predicate
  `fields_written CONTAINS $myField` — find all ops touching a field

The existing `evalGroupAgainstRecord` already handles array `CONTAINS` /
membership comparators against record fields.

### Edge cases

- **Empty pipeline**: returns empty sets, no errors.
- **Legacy `blockTree` ops** (pre-pipeline): not introspected — their
  introspection record is all empty sets. Reasonable for legacy data; the
  user can migrate by re-saving.
- **Operations that reference fieldIds by `field:<fid>` tokens AND by
  direct string id**: both paths captured in `fields_read`.
- **Self-invoking ops** (`RUN_OPERATION` calling self): captured in
  `invokes_operations` — no special handling. Authors who care can detect
  via `op.id IN op.invokes_operations`.
- **Operation deleted while a pipeline references it**: stale opId
  remains in `invokes_operations`. Same robustness as stale moduleIds in
  `occurrences`.

## Implementation Plan

### Tasks

1. **Create `helpers/operationIntrospection.js`** with `analyzeOperation`
   and `analyzeAllOperations`. Pure functions, no React dependencies.
   - Walk all step types. Use a generic "scan any string for
     `field:<id>` / `$.fields.<id>`" helper that's run on every config
     leaf. Recurse through `then`/`else`/`body`/`steps` arrays.
   - Detect step type from `step.type` (or `step.action` — check what
     `operationExecutor.js` actually uses).
   - Skip silently on unrecognized step types but still descend into
     nested arrays — defensive.

2. **Vitest cover** the analyzer with a handful of representative
   pipelines (a tracker op, a builder op with APPLY_TEMPLATE, an op with
   nested IF/LOOP). 5–8 tests is plenty. Assert each output set matches
   expectations. File: `client/src/__tests__/operationIntrospection.test.js`.

3. **Expose `$allOperations` in the executor** (`helpers/operationExecutor.js`).
   - Find the spot that populates `$allOccurrences` / `$allItems`. Add a
     parallel `$allOperations` populated from `operationsById`, with each
     entry merged with its introspection record (computed lazily via
     `analyzeAllOperations`).
   - Memoize the analysis result on the executor's context so each
     pipeline run doesn't re-analyze.

4. **Add operation shapes to `CategoryPathPicker.jsx`**:
   - `BUILTIN_VAR_SHAPES.$allOperations = "operationArray"`.
   - New `SHAPES.operation` with the keys listed above.
   - New `SHAPES.triggerObject`, `SHAPES.sourceBinding`.
   - `arrayItemsAsKeys("operationArray")` → `SHAPES.operation.keys(ctx)`.
   - `descendShape("operation"/"triggerObject"/"sourceBinding")` wired.

5. **Add Operations to picker categories** (`categoryRegistry.js`):
   - `COLLECTION_ITEMS` gets `$allOperations`.
   - `recordShapeForCollection` returns `"operation"` for `$allOperations`.
   - Add a new "Operations" CATEGORY exposing `$allOperations` at level 1
     plus individual operations as drillable rows (`op:<id>` value tokens).

6. **Update `segmentDisplay`** in CategoryPathPicker.jsx to resolve
   `op:<id>` tokens to operation names (mirrors the existing `field:<id>`
   handling).

7. **Smoke test** in the operations editor: open an OperationEditor,
   open its predicate / value path picker, and verify:
   - `$allOperations` appears under both Built-ins and Operations
     category
   - Picking `$allOperations` and drilling shows operation keys including
     the introspection sets
   - Picking `fields_written` and drilling exposes field-array keys
   - Closed-state chip path renders `[op:foo] [fields_written]` with
     friendly labels via `segmentDisplay`

8. **Update folder CLAUDE.md files**:
   - `client/src/ui/CLAUDE.md` — CategoryPathPicker gains operation shape.
   - `client/src/helpers/CLAUDE.md` — new operationIntrospection module +
     `$allOperations` exposure in operationExecutor.

### Tracer bullet order

1 → 2 → 3 (analyzer working, executor exposes the collection, no UI yet).
Verify via dev console: `window.__moduli_state__.operationsById` plus a
manual call to `analyzeOperation` returns expected sets.

Then 4 → 5 → 6 (picker integration; can author predicates referencing
`$allOperations.fields_written`).

Then 7 → 8 (smoke + docs).

### Risk

- **Step type drift**: if `operationExecutor.js` adds new step types in
  the future, the analyzer needs to learn them. Mitigation: the generic
  string-scanning helper catches most cases regardless of step type; the
  per-type contribution to write-sets needs explicit handling.
- **Expression parsing ambiguity**: a string config that happens to
  contain a substring `field:abc123` but isn't a field reference would
  produce a false positive in `fields_read`. Mitigation: only count tokens
  whose suffix matches a real fieldId in `fieldsById` (lookup, not regex
  match). Same trick for occurrence IDs.
- **Performance**: analyzing dozens of ops on every pipeline run could
  add latency. Mitigation: memoize per-op analysis keyed on the operation
  object identity (which changes only on edit). Recompute only the op
  that changed.

### Out of scope (possible follow-ups)

- Reverse indices on `$allFields[*]` and `$allOccurrences[*]` (e.g.
  `myField.operations_writing_to_me`). Achievable via the primary direction
  with a LOOP, so not urgent.
- Transitive closure on `invokes_operations` (chase chains). Currently
  one-hop only.
- Field-level write/read with predicate context (e.g. "writes this field
  IF condition X"). The analyzer treats writes as unconditional.
