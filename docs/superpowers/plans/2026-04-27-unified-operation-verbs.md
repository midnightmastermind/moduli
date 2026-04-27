# Unified Operation Verbs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the grab-bag of action types in the operations engine (`FIND_OCCURRENCE`, `FIND_MODULE`, `CREATE_OCCURRENCE_FOR_MODULE`, `CREATE_MODULE`, `MOVE_OCCURRENCE_TO_PARENT`, `LINK_OCCURRENCE_TO_PARENT`, `SET_FIELD_VALUE`, `SHOW_VALUE`, `COMPUTE_TEXTMAP_FROM_TEMPLATE`, `FILL_FROM_TEMPLATE`) with a uniform vocabulary of **four CRUD verbs** (`FIND`, `CREATE`, `UPDATE`, `DELETE`) plus the existing flow primitives (`INIT_VAR`, `IF`, `LOOP`, arithmetic-var actions). All writes go through `UPDATE { path, value }` where `path` is a dotted expression authored with the existing PathPicker. The engine inspects the head of the path to dispatch the correct internal write (field write with onChange trigger, parentId move, meta patch, var assignment, `computedValues` write for display fields, etc.). The pipeline never differentiates "module" vs "occurrence" — to authors, both are *items*.

**Architecture:**

- **One mental model: items.** A user-facing "thing" (Drink Water, Schedule page, today's 7am slot) is a single *item* that carries the merged identity of its template (was Module) and its placement (was Occurrence). Internally storage stays split; the operation language collapses them.
- **Four data verbs, no special cases.** `FIND`, `CREATE`, `UPDATE`, `DELETE`. Move is `UPDATE { path: "$item.parentId", value: ... }`. Linking is gone (was a band-aid for E11000 — server retry now handles it). Field write is `UPDATE { path: "$item.fields.<id>.value", value }`. Display field write is `UPDATE { path: "$display.<fieldId>.<itemId>", value }`.
- **PathPicker is the differentiator.** The `path` config is a string built by the PathPicker UI walking `$item → fields → <fieldName> → value`, `$item → parentId`, `$item → meta → <key>`, `$myVar`, `$display.<fieldId>.<itemId>`, etc. The runtime `applyUpdate(path, value)` parses the path and routes to the right effect. This is how UPDATE handles fields, parents, meta, vars, and computed values without growing more verbs.
- **Flow primitives unchanged.** `INIT_VAR`, `IF`, `LOOP`, and the arithmetic-var family (`ADD_TO_VAR`, `INCREMENT_VAR`, `DECREMENT_VAR`, `MULTIPLY_VAR`, `DIV_VAR`) are kept as-is. They are not CRUD operations — they are read-modify-write math sugar on a `$var`. Folding them into UPDATE was considered and rejected; one-line `ADD_TO_VAR { name: "$total", expr: "..." }` reads cleaner than the equivalent UPDATE patch and matches existing operations.
- **No legacy.** Old action cases are deleted from `operationActions.js`. Old effect type strings are deleted from `bindSocketToStore.js`. Old config keys (`occurrenceIdExpr`, `moduleIdExpr`, `targetIdExpr`, `parentOccIdExpr`, `moduleLabelExpr`, `moduleMetaKey`, `moduleMetaSecondaryKey`, etc.) are deleted. All callers — seed scripts, tests, UI builders — are updated in this plan.
- **No schedule-specific logic in the engine.** The engine has zero knowledge of slots, schedules, todos, or due dates. The seed script's pipeline references its own meta-key conventions (`scheduleSlot`, `scheduleDueContainer`, `todoListContainer`) as opaque strings the engine does not interpret.

**Tech Stack:** React, MongoDB (Mongoose), socket.io, Vitest (client + server unit tests). No new dependencies.

**Spec:** This file is its own spec — no separate document.

---

## File Map

### Created

| Path | Responsibility |
|---|---|
| `client/src/helpers/applyUpdate.js` | Pure helper — `applyUpdate(path, value, context)`. Parses a dotted path, dispatches to the correct internal write: `$item.fields.<id>.value` → field write effect; `$item.parentId` → parent-move effect; `$item.meta.<k>` → meta-patch effect; `$item.textmap` → textmap effect (with optional template-substitution helper); `$<varName>` → write to `$vars` map; `$display.<fieldId>.<itemId>` → write to `computedValues`. Returns the effect object(s) the executor emits. |
| `client/src/__tests__/applyUpdate.test.js` | Vitest — covers every path head documented above plus error cases (unknown path head, missing `$item` in vars, etc.). |
| `client/src/__tests__/operationActions.unified.test.js` | Vitest — replaces obsolete tests in `operationActions.test.js`. Covers `FIND`, `CREATE`, `UPDATE`, `DELETE` with each path target. |

### Modified

| Path | What changes |
|---|---|
| `client/src/helpers/operationActions.js` | Delete cases: `FIND_OCCURRENCE`, `FIND_MODULE`, `CREATE_OCCURRENCE_FOR_MODULE`, `CREATE_MODULE`, `MOVE_OCCURRENCE_TO_PARENT`, `LINK_OCCURRENCE_TO_PARENT`, `SET_FIELD_VALUE`, `SHOW_VALUE`, `COMPUTE_TEXTMAP_FROM_TEMPLATE`, `FILL_FROM_TEMPLATE`. Add cases: `FIND`, `CREATE`, `UPDATE`, `DELETE`. Keep `INIT_VAR`, `SET_VAR`, `ADD_TO_VAR`, `INCREMENT_VAR`, `DECREMENT_VAR`, `MULTIPLY_VAR`, `DIV_VAR`, `PUSH_TO_VAR`, `SUBTRACT_FROM_VAR`. Doc comment for `resolveExpr` updated to describe `$item` (replaces both `$module` and `$occurrence`). Internal `$vars` key `_occurrencesById` renamed to `_itemsById`. Update `evalRule`/`evalGroup` only if a rule references the renamed special vars. |
| `client/src/helpers/operationExecutor.js` | Rename built-in source variables and context keys: `$allOccurrences` → `$allItems`, `_parentByChildId` keeps name (it is still parent → child id, semantics unchanged). Rename log messages that mention "occurrence." Confirm no schedule/legacy strings remain. |
| `client/src/state/bindSocketToStore.js` | Effect handlers — replace these named effect handlers with the four unified ones plus path-routed sub-effects: `CREATE_OCCURRENCE_FOR_MODULE` → `CREATE_ITEM`; `MOVE_OCCURRENCE_TO_PARENT` → emitted by `UPDATE { path: "$item.parentId" }` as effect type `UPDATE_ITEM_PARENT`; `LINK_OCCURRENCE_TO_PARENT` deleted; `SET_FIELD_VALUE` → `UPDATE_ITEM_FIELD` (still fires `MeasureOp` so onChange works); `SHOW_VALUE` → `UPDATE_DISPLAY_VALUE` (writes into `computedValues`, fires no transaction); `UPDATE_OCCURRENCE` → `UPDATE_ITEM`. The dispatch tables/switch statements get four arms (`FIND` is read-only — no effect), each dispatching a Redux action and emitting a socket event as today. |
| `client/src/state/actions.js` | No new action creators required if the existing `createOccurrenceAction`, `updateOccurrenceAction`, `removeOccurrenceAction`, `createModuleAction`, `updateModuleAction` cover the operations. Confirm — only rename if their internal payload keys leak the old vocabulary into UI consumers. |
| `client/src/state/masterReducer.js` | No changes expected. The reducer already operates on the underlying storage records; the verb collapse is at the action layer above it. Audit for any case literals that mention `OCCURRENCE_FOR_MODULE` etc. and remove them. |
| `client/src/state/useBroadcastSync.js` | Audit and remove any old effect-type strings. |
| `client/src/helpers/CommitHelpers.js` | Audit. CommitHelpers is the contract boundary for *user-driven* CRUD (not pipeline-driven). It should not reference operation effect names. If it does, the reference is dead and should be removed. No new exports expected. |
| `client/src/helpers/dropHandlers.js` | Audit. This file uses `MOVE_OCCURRENCE_TO_PARENT` only for an optimistic local update during drag — that internal usage stays, but the constant is renamed to `MOVE_ITEM` for consistency with the new vocabulary. |
| `client/src/blocks/OperationsBuilder.jsx` | Update the action-type picker: replace the dropdown of ten action names with a four-item dropdown (`FIND`, `CREATE`, `UPDATE`, `DELETE`) plus a flow-primitives sub-section. The action-config form for each verb uses the existing PathPicker and predicate builder. Delete config-renderers for the deleted verbs. |
| `client/src/ui/commandCenter/OperationsTab.jsx` | Confirm no string-matching against old action type names (e.g. for the "duplicate operation" duplicate-trigger check that searches for `SHOW_VALUE`). Update those checks to look at `UPDATE` patches whose path matches `$display.*`. |
| `server/scripts/createTestGrid.js` | Rewrite all five operations (`Schedule: Build Day`, `Schedule: Seed Daily Routine`, `Schedule: Stamp Date & Time Slot`, `Schedule: Clear Date on Move-Out`, `Water Today`, `Tasks Completed Today`) using the four-verb vocabulary. No `presetSeedSteps` helper; no schedule-specific actions. The seed script's pipeline references the schedule meta tags (`scheduleSlot`, `scheduleDueContainer`, `todoListContainer`) only via opaque `meta` keys in `FIND` predicates. |
| `server/scripts/inspectAutoBuild.js` | Update string matchers if it greps DB pipelines for old action names. |
| ~~`server/utils/createDefaultUserData.js`~~ | **Frozen — out of scope.** User decision: keep file, stop updating it. Its operations stay on the legacy vocabulary; the demo seed is no longer run during the migration. Add a leading comment to the file noting the freeze + the date + that the operations inside reference deleted action types and will need a rewrite if the file is ever re-activated. Do not run this seed in smoke tests. |
| `server/utils/operationBuilders.js` | Helper functions that emit operation step JSON (`makeLoopSumOp`, `makeLiteralOp`, etc.). Each must emit `UPDATE { path: "$display.<fieldId>", value: ... }` instead of `SHOW_VALUE`. |
| `server/socketHandlers/crud.js` | Audit. The server should not encode operation effect names — it only handles socket events like `create_occurrence` / `update_occurrence`. If any string match against effect names exists (legacy support), delete it. |
| `client/src/__tests__/operationActions.test.js` | Replace with `operationActions.unified.test.js` (new) and delete this file. |
| `client/src/__tests__/bindSocketToStore.test.js` | Update effect-type assertions to the new names. |
| `client/src/__tests__/masterReducer.test.js` | Audit; remove any tests pinned to deleted action types. |

### Deleted

| Path | Why |
|---|---|
| `client/src/__tests__/operationActions.test.js` | Replaced by `operationActions.unified.test.js`. |
| `server/scripts/fixScheduleOperations.js` | Stale ad-hoc script; `createTestGrid.js` is canonical. **User-confirmed delete.** |

---

## The Four Verbs — Authoritative Specification

### 1. `FIND`

**Purpose:** Locate one or more items by predicate; store the result(s) in a `$var`.

**Config shape:**
```js
{
  type: "FIND",
  predicate: { operator: "AND", rules: [...] },   // same shape as IF condition. Rules reference $item.* paths.
  scope: { dateFieldId?, dateExpr? },             // optional. If set, candidates filter to items whose date field equals the resolved date.
  multiple: false,                                // default false. If true, returns an array; otherwise the first match (or null).
  itemVar: "$myItem",                             // optional — stores the full item object.
  itemIdVar: "$myItemId",                         // optional — stores just the id.
}
```

**Predicate examples (built via PathPicker + predicate builder):**
- Find the Schedule page: `[{ left: "$item.label", comparator: "IS", right: "Schedule" }]`
- Find today's Due container: `[{ left: "$item.label", comparator: "IS", right: "Due" }, { left: `$item.fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$schedDate" }]`
- Find a slot by meta: `[{ left: "$item.meta.scheduleSlot", comparator: "IS", right: true }, { left: "$item.meta.slotLabel", comparator: "IS", right: "$preset.slotLabel" }]`

**Engine behavior:** Evaluate predicate against every entry in `$allItems`. If `scope.dateFieldId` is set, intersect with items whose `fields.<dateFieldId>.value` parses to the same date as `scope.dateExpr`.

### 2. `CREATE`

**Purpose:** Bring an item into existence. Idempotent on the template axis: if an item with the given `name` already exists at the template level, reuse it; otherwise mint one. Always creates a fresh per-instance record (one per call).

**Config shape:**
```js
{
  type: "CREATE",
  name: "Due",                          // human label. If a template exists with this label, reused. Otherwise mint a new template.
  role: "container",                    // template-level. Required when minting; ignored if reusing.
  kind: "list",                         // template-level. Required when minting; ignored if reusing.
  meta: { scheduleDueContainer: true }, // template-level meta. Merged into existing template if one is reused.
  parent: "$schedPageId",               // expr resolving to parent item id. Optional.
  date: { fieldId: dateFieldId, value: "$schedDate" }, // optional. Stamps fields[fieldId] = { value: resolvedDate, flow: "in" } on the new instance.
  fields: { [timeslotFieldId]: "literal:Due" },        // optional initial field values. Map of fieldId → expr.
  textmap: { fromTemplate: "$dueTemplate", tokens: { Date: "$schedDateLabel" } }, // optional. Resolves a textmap by cloning a template's textmap with token substitution.
  insertAtIndex: 0,                     // optional position in parent's child list.
  itemIdVar: "$dueId",                  // optional — stores the new item's id.
  itemVar: "$due",                      // optional — stores the new item object.
}
```

**Engine behavior:** Resolve `name` → look up an existing template by label. If not found, mint a new template (`{ id, label: name, role, kind, meta }`). Then mint a new instance (`{ id, targetId: templateId, parentId, fields, textmap, ... }`). Push instance id to parent's child list. Emit `CREATE_ITEM` effect with both records.

### 3. `UPDATE`

**Purpose:** Patch one piece of state at a specified path. The PathPicker on the UI side authors the `path` string; the engine routes the write based on the head of the path.

**Config shape:**
```js
{
  type: "UPDATE",
  path: "$item.fields.<fieldId>.value",   // string built by PathPicker.
  value: "literal:Due",                   // expr. Resolved before the write.
  // For arithmetic-on-existing patterns prefer the flow primitives (ADD_TO_VAR etc.).
}
```

**Path heads handled (set by `applyUpdate.js`):**
| Path pattern | Internal effect | Notes |
|---|---|---|
| `$item.fields.<fieldId>.value` | `UPDATE_ITEM_FIELD` (fires `MeasureOp` transaction → onChange triggers) | `$item` resolves from current iteration var or trigger payload. |
| `$item.fields.<fieldId>.flow` | `UPDATE_ITEM_FIELD` with flow patch | Does not fire onChange. |
| `$item.parentId` | `UPDATE_ITEM_PARENT` (replaces old MOVE) | Updates child lists on both source and destination parents. |
| `$item.meta.<key>` | `UPDATE_ITEM_META` | Merges into existing meta. |
| `$item.textmap` | `UPDATE_ITEM_TEXTMAP` | If `value` is `{ fromTemplate, tokens }`, the engine clones+substitutes; otherwise writes directly. |
| `$<varName>` (single-segment) | Sets `$vars[$varName]` — equivalent to `SET_VAR`. | No effect emitted; pipeline-internal. |
| `$display.<fieldId>.<itemId>` | `UPDATE_DISPLAY_VALUE` (writes to `computedValues`) | Replaces `SHOW_VALUE`. |
| anything else | Throws (caught by executor, logged as a step error) | Forces authors to use a recognized path. |

**Examples in the rewritten seed:**
- Stamp a slot's timeslot label: `UPDATE { path: "$item.fields.<timeslotFieldId>.value", value: "$slot.label" }`
- Move a todo into Due: `UPDATE { path: "$todoItem.parentId", value: "$dueId" }`
- Write a goal display value: `UPDATE { path: "$display.<totalWaterFieldId>.<itemId>", value: "$total" }`

### 4. `DELETE`

**Purpose:** Remove an item.

**Config shape:**
```js
{
  type: "DELETE",
  itemIdExpr: "$todoItem.id",
}
```

**Engine behavior:** Emit `DELETE_ITEM` effect. bindSocketToStore handles the cascade and the parent-list cleanup, mirroring today's `delete_occurrence` socket flow.

### Flow primitives (kept, not part of the four verbs)

`INIT_VAR`, `SET_VAR`, `ADD_TO_VAR`, `INCREMENT_VAR`, `DECREMENT_VAR`, `MULTIPLY_VAR`, `DIV_VAR`, `SUBTRACT_FROM_VAR`, `PUSH_TO_VAR`, `IF`, `LOOP`. Same semantics as today. The arithmetic-var family is read-modify-write on `$vars` and is *not* routed through `applyUpdate` because it is a pipeline-internal computation, not a CRUD verb.

---

## Task 1: `applyUpdate` helper

**Why first:** UPDATE is the verb that does most of the routing work. Building this as a tested pure helper before touching the engine prevents the rewrite from regressing every path target at once.

**Acceptance:**
- [ ] File `client/src/helpers/applyUpdate.js` exports `applyUpdate(path, value, ctx)` returning `{ effects: [...], varWrites: {...} }` (effects → bindSocketToStore; varWrites → executor merges into `$vars`).
- [ ] `applyUpdate.test.js` covers each path-head row in the table above. Tests include: field-value write resolves `$item` from `ctx.vars`; field-flow write does not emit a `MeasureOp`; parentId write emits `UPDATE_ITEM_PARENT`; meta write merges; textmap write with `fromTemplate` clones the referenced template's textmap and substitutes tokens; var write returns `varWrites` and no effects; display write returns `UPDATE_DISPLAY_VALUE` with `{ fieldId, itemId }`; unknown path heads throw.
- [ ] No coupling to operationExecutor — the helper is pure and re-exportable.

## Task 2: Rewrite `operationActions.js`

**Why second:** The executor's action switch is the next layer up. With `applyUpdate` in hand, the four new cases are thin.

**Acceptance:**
- [ ] Delete cases: `FIND_OCCURRENCE`, `FIND_MODULE`, `CREATE_OCCURRENCE_FOR_MODULE`, `CREATE_MODULE`, `MOVE_OCCURRENCE_TO_PARENT`, `LINK_OCCURRENCE_TO_PARENT`, `SET_FIELD_VALUE`, `SHOW_VALUE`, `COMPUTE_TEXTMAP_FROM_TEMPLATE`, `FILL_FROM_TEMPLATE`.
- [ ] Add `FIND` — evaluates `cfg.predicate` against `$allItems`, applies optional `scope.dateFieldId` filter, writes to `cfg.itemVar` / `cfg.itemIdVar`. `multiple: true` writes an array.
- [ ] Add `CREATE` — resolves `name` to an existing template or mints one; mints an instance; emits a `CREATE_ITEM` effect with `{ template, instance }`; writes `cfg.itemIdVar` / `cfg.itemVar`. Idempotent on template name.
- [ ] Add `UPDATE` — calls `applyUpdate(cfg.path, resolveExpr(cfg.value, $vars), { vars: $vars, occurrencesById })` and pushes returned effects + applies `varWrites` into `$vars`.
- [ ] Add `DELETE` — emits `DELETE_ITEM` effect with `{ itemId: resolveExpr(cfg.itemIdExpr, $vars) }`.
- [ ] All keep flow primitives unchanged.
- [ ] Comment block at top of file documents the four verbs and points to this plan.

## Task 3: Rename `$allOccurrences` → `$allItems` (and friends) in executor

**Why third:** Pipeline authors reference these vars in conditions. Once the engine routes through the new verbs, the source variables exposed to authors should match the new vocabulary.

**Acceptance:**
- [ ] In `operationExecutor.js`, every place that sets `$vars.$allOccurrences = ...` writes to `$vars.$allItems`.
- [ ] Any place that builds `_occurrencesById` for use inside `resolveExpr` writes `_itemsById` (or keep the underscore-prefixed key but document that *internally* it's the items map).
- [ ] Built-in source `$activeDate`, `$activeDateLabel`, `$activeDayOfWeek`, `$today`, `$nav` unchanged.
- [ ] Loop iteration variable defaults to `$item` (already true — confirm).
- [ ] `getTriggerVars(eventType, subjectType)` updated where it returns property names that include `occurrenceId` / `moduleId` — those become `itemId` and `templateId` respectively in the UI hint, and the runtime payload likewise.

## Task 4: Rewire `bindSocketToStore.js` effect handlers

**Why fourth:** The executor produces effects; bindSocketToStore consumes them. After Task 2, the produced effect names are new, so the consumer table must match.

**Acceptance:**
- [ ] Replace handlers for `CREATE_OCCURRENCE_FOR_MODULE`, `MOVE_OCCURRENCE_TO_PARENT`, `LINK_OCCURRENCE_TO_PARENT` (delete), `SET_FIELD_VALUE`, `SHOW_VALUE`, `UPDATE_OCCURRENCE` with handlers for: `CREATE_ITEM`, `DELETE_ITEM`, `UPDATE_ITEM_FIELD`, `UPDATE_ITEM_PARENT`, `UPDATE_ITEM_META`, `UPDATE_ITEM_TEXTMAP`, `UPDATE_DISPLAY_VALUE`.
- [ ] `UPDATE_ITEM_FIELD` fires `MeasureOp` transactions just as `SET_FIELD_VALUE` did.
- [ ] `UPDATE_ITEM_PARENT` updates source + destination parent child lists (mirrors today's MOVE behavior). Optimistically updates local cache before socket emit.
- [ ] `CREATE_ITEM` writes both the new template (if one was created) and the new instance to local state via existing `createModuleAction` / `createOccurrenceAction`. Emits the existing `create_module` and `create_occurrence` socket events.
- [ ] `DELETE_ITEM` emits `delete_occurrence`.
- [ ] No effect names referencing "occurrence" or "module" remain.

## Task 5: Audit and update remaining client callers

**Why:** Any file that strings against old effect names will silently no-op after Task 4.

**Acceptance:**
- [ ] `client/src/state/actions.js` — confirm no string match on old effect names. Action creator export names may stay (`createOccurrenceAction` etc.) since they map to socket events, not effect types.
- [ ] `client/src/state/masterReducer.js` — audit case literals. Remove any that refer to deleted effect types.
- [ ] `client/src/state/useBroadcastSync.js` — audit and rename.
- [ ] `client/src/helpers/CommitHelpers.js` — audit; remove string matches against old effect names.
- [ ] `client/src/helpers/dropHandlers.js` — rename `MOVE_OCCURRENCE_TO_PARENT` constant or imports to `UPDATE_ITEM_PARENT`. Internal optimistic-move logic unchanged.
- [ ] Run `grep -rn "OCCURRENCE_FOR_MODULE\|MOVE_OCCURRENCE_TO_PARENT\|LINK_OCCURRENCE_TO_PARENT\|FIND_OCCURRENCE\|FIND_MODULE\|CREATE_MODULE\|SHOW_VALUE\|SET_FIELD_VALUE\|COMPUTE_TEXTMAP_FROM_TEMPLATE\|FILL_FROM_TEMPLATE" client/src/` — should return nothing.

## Task 6: PathPicker exposes the new path heads

**Why:** Authors build `path` strings via PathPicker; the picker needs to offer the right targets.

**Acceptance:**
- [ ] `client/src/blocks/PathPicker.jsx` (already exists — see plan 2026-04-16-operations-overhaul) — extend `buildPathShape` to expose, under `$item`: `parentId`, `meta.<keys>`, `textmap`. Already exposes `fields.<fieldId>.value` / `.flow`.
- [ ] Add a top-level `$display` namespace yielding `$display.<fieldId>.<itemId>`. The fieldId list comes from grid display fields (`displayEnabled`).
- [ ] The action editor in `OperationsBuilder.jsx`, when the action type is `UPDATE`, renders a single PathPicker (no per-action custom forms) plus a value expression input.

## Task 7: Update `OperationsBuilder.jsx` action picker

**Acceptance:**
- [ ] Action-type dropdown shows: `FIND`, `CREATE`, `UPDATE`, `DELETE`, plus a separated section for flow primitives (`INIT_VAR`, `SET_VAR`, `ADD_TO_VAR`, `INCREMENT_VAR`, `DECREMENT_VAR`, `MULTIPLY_VAR`, `DIV_VAR`, `SUBTRACT_FROM_VAR`, `PUSH_TO_VAR`).
- [ ] Each verb has a dedicated config form: `FIND` uses the predicate builder + scope inputs + result-var fields; `CREATE` uses name + role + kind + meta + parent + date + fields + textmap inputs (collapsible — only show advanced ones on toggle); `UPDATE` uses PathPicker + value expression; `DELETE` uses item id expression.
- [ ] No config-form code remains for deleted action types.

## Task 8: Update `OperationsTab.jsx` duplicate-detection

**Acceptance:**
- [ ] The duplicate-trigger detection that today greps for `SHOW_VALUE` step + `targetFieldId` now greps for `UPDATE` step whose path matches `^\$display\.` and extracts the fieldId from the path. Same UX (warning chip on duplicate ops).

## Task 9: Rewrite `createTestGrid.js` operations

**Why:** Seed script must use the new vocabulary or the rewrite is moot.

**Acceptance:**
- [ ] Operation `Schedule: Build Day` (priority 1) — uses `FIND` to locate Schedule page; `FIND` (with `scope.dateFieldId`/`scope.dateExpr`) to check for today's Due; `CREATE` for Due if missing; `LOOP` over a 48-element `$slots` array of `{ moduleId, label }`; per-iteration `FIND` then `CREATE` then `UPDATE { path: "$item.fields.<timeslotFieldId>.value", value: "$slot.label" }`; `LOOP` over `$allItems` to sweep todos with `UPDATE { path: "$todoItem.parentId" }` and `UPDATE { path: "$todoItem.fields.<dateFieldId>.value" }`.
- [ ] Operation `Schedule: Seed Daily Routine` (priority 4) — single `LOOP` over 3-element `$presets` array; per-iteration `FIND` source by name, `FIND` for today's existing instance to enforce idempotency, `FIND` slot by meta + date scope, `CREATE` if both source resolved and slot found.
- [ ] Operation `Schedule: Stamp Date & Time Slot` (priority 2) — replace `SET_FIELD_VALUE` with `UPDATE { path: "$item.fields.<dateFieldId>.value" }` and `UPDATE { path: "$item.fields.<timeslotFieldId>.value" }`.
- [ ] Operation `Schedule: Clear Date on Move-Out` (priority 2) — same replacement; the `LOOP` over `$allItems` (was `$allOccurrences`) and `IF $item._ancestors NOT_HAS_ANCESTOR $schedPageId` are unchanged.
- [ ] Operation `Water Today` (priority 3) — `LOOP` over `$allItems`; `IF` predicate using `$item.fields.<waterFieldId>.value` etc.; aggregator uses `ADD_TO_VAR`; final write is `UPDATE { path: "$display.<totalWaterFieldId>.<gridId-or-empty>", value: "$total" }`. The aggregation field id resolution path is determined by what `applyUpdate` accepts for `$display.<fieldId>` without an itemId for grid-scoped totals — confirm shape during implementation; either omit the itemId segment or use a sentinel.
- [ ] Operation `Tasks Completed Today` (priority 3) — same as Water Today but on the count field.
- [ ] No `LINK_OCCURRENCE_TO_PARENT` calls. No schedule-specific helpers. No `presetSeedSteps` function. No `else: [LINK_*]` branches.

## Task 10: Update server-side helpers + tests

**Acceptance:**
- [ ] `server/utils/operationBuilders.js` — `makeLoopSumOp`, `makeLoopCountOp`, `makeLoopCountTrueOp`, `makeLoopLastOp`, `makeLoopMultiSumOp`, `makeNetBalanceOp`, `makeCompletionRateOp`, `makeLiteralOp` all emit `UPDATE { path: "$display.<targetFieldId>.<itemId>", value: "$total" }` instead of `SHOW_VALUE`. The `<itemId>` segment receives the goal-instance id passed in by the caller (Water Today / Tasks Completed Today supply the display occurrence id explicitly — see Task 9).
- [ ] `server/utils/createDefaultUserData.js` — **frozen, do not modify.** Add one leading comment block: `// FROZEN 2026-04-27 — Operations in this file reference the legacy action vocabulary (FIND_OCCURRENCE, SHOW_VALUE, SET_FIELD_VALUE, etc.) and will not run after the unified-verbs migration. Kept for future reference / data shape only. Re-activating requires rewriting all operations to FIND/CREATE/UPDATE/DELETE.` That is the only edit to this file.
- [ ] `server/scripts/fixScheduleOperations.js` — **delete.**
- [ ] `server/scripts/inspectAutoBuild.js` — update grep targets if it inspects pipelines.
- [ ] `server/socketHandlers/crud.js` — audit; remove any legacy effect-name handling.

## Task 11: Tests

**Acceptance:**
- [ ] `client/src/__tests__/operationActions.unified.test.js` — covers `FIND` (with and without date scope, single and multiple), `CREATE` (template-mint vs template-reuse), `UPDATE` (each path head), `DELETE`. Assertions inspect `$vars` and emitted effects.
- [ ] `client/src/__tests__/applyUpdate.test.js` — every path head + error cases.
- [ ] Delete `client/src/__tests__/operationActions.test.js`.
- [ ] Update `client/src/__tests__/bindSocketToStore.test.js` effect-name assertions.
- [ ] Update `client/src/__tests__/masterReducer.test.js` — remove cases pinned to deleted effect types.
- [ ] All client tests pass: `npm --prefix ./client run test`.
- [ ] All server tests pass: `npm --prefix ./server run test`.

## Task 12: Re-seed and smoke

**Acceptance:**
- [ ] Re-seed: `cd server && /home/joshpoms/.nvm/versions/node/v22.21.1/bin/node --env-file=.env scripts/createTestGrid.js`.
- [ ] First load: 48 slots + Due + 3 routine items render without a second reload.
- [ ] Day navigation: no E11000 in server logs; no duplicate slots.
- [ ] Field-value edit on a slot fires the Tasks Completed Today aggregation (display field updates without manual reload).
- [ ] Drag a todo from todo container into the schedule on a non-due-date — Schedule: Stamp Date & Time Slot fires (date + timeslot stamped).
- [ ] Drag the same item back out — Schedule: Clear Date on Move-Out fires (date + timeslot cleared).
- [ ] Operations list (CommandCenter → Operations) shows `FIND` / `CREATE` / `UPDATE` / `DELETE` in the action-type picker; old names are not selectable.

---

## Decisions (locked)

1. **`createDefaultUserData.js` is out of scope.** Frozen at current state with a leading comment block flagging the deprecated vocabulary. Not run during migration smoke tests. (Task 10.)
2. **`fixScheduleOperations.js` is deleted.** (Task 10.)
3. **Display-field write path** = `$display.<fieldId>.<itemId>` (the per-item shape). Grid-scoped totals (Daily Water, Tasks Completed Today) pass the goal-instance occurrence id explicitly so the path resolves. The operation does a `FIND` for the goal instance up front and stores its id in a `$var` referenced by the final `UPDATE { path: "$display.<fieldId>.${$goalId}" }`. No grid-level sentinel.

## Open Risks

1. **Path head namespace conflicts.** If a user names a `$var` `display`, the path parser's `$display.*` heuristic mis-routes. Resolution: reserve `$display` (and `$item`, `$trigger`, `$activeDate`, `$today`, etc.) as engine identifiers; the var picker UI rejects collisions. Document in `applyUpdate.js`.
2. **Nested item paths.** `$todoItem.parentId` works because `$todoItem` is a loop var. But `$item.parentId` from inside a nested loop might shadow. The current loop already overwrites `$item` per iteration, so `$item` always refers to the current loop item — which is correct behavior. Document in operationActions comment.

---

## Ordering Rationale

Tasks 1 → 4 walk bottom-up through the pipeline runtime: pure helper → action layer → executor source vars → effect consumer. After Task 4, the engine is fully migrated and the test grid still references the old vocabulary — so Task 5 sweeps remaining client callers, then Tasks 6–8 update the UI, then Task 9 rewrites the seed (which exercises the whole stack), then 10 cleans server helpers, 11 adds tests, 12 verifies end-to-end.

If a session runs out of tokens partway through, the safe stopping points are after Tasks 4, 8, and 11 — at each, the system is in a valid state (engine + UI consistent; seed still old but seed runs only on demand).
