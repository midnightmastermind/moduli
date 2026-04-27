# client/src/blocks — Blocks CLAUDE.md

_Updated: 2026-03-14. Check this file before re-reading source._

## Key Files

| File | Purpose | Last Changed |
|------|---------|--------------|
| `blockTypes.js` | Block type constants, shapes, colors, palette, `createBlock()`. createFieldBlocks/createFieldBlock updated for inputEnabled/displayEnabled. | **Feb 22** |
| `blockEvaluator.js` | Recursive block evaluator. `evaluateBlock(block, ctx)`, `evaluateBlockTree(root, ctx)`. Handles REPORTER types (FIELD, LITERAL, OPERATOR, AGGREGATION, etc.) | Stable |
| `operationExecutor.js` | **NEW** — Runtime executor for Operations pipeline. `shouldTrigger(op, txType)`, `executeOperation(op, txType, tx, ctx)`, `runMatchingOperations(ops, txType, tx, ctx)` | **Feb 22** |
| `Block.jsx` | Renders a single block (drag+drop, slots, inner slots) | Stable |
| `BlockPalette.jsx` | Sidebar toolbox of available blocks | Stable |
| `Slot.jsx` | Drop zone inside a block | Stable |
| `OperationsCanvas.jsx` | Canvas where blocks are dropped/connected. `rootBlock`/`onChange` props | Stable |
| `useBlockDnD.jsx` | Pragmatic DnD hooks for block dragging | Stable |

## Block Types (BlockType enum)

**Reporter (oval — returns value):**
`FIELD`, `LITERAL`, `VARIABLE`, `OPERATOR`, `COMPARISON`, `LOGICAL`, `AGGREGATION`, `FUNCTION`, `TRIGGER_DATA`

**Statement (rect — executes, no value):**
`SET_VARIABLE`, `ACTION`

**C_BLOCK (C-shape — contains inner blocks):**
`CONDITION`, `LOOP`

**HAT (trigger — operation starts here):**
`ON_DROP`, `ON_CHANGE`, `ON_LOAD`, `ON_ITERATION`, `ON_MANUAL`

## operationExecutor Architecture
```
Transaction fires → shouldTrigger(op, txType) → executeOperation()
  → if blockTree is reporter: evaluate it → {fieldId, value}
  → if blockTree has ACTION blocks: collect side-effects → [{fieldId, value}]
  → returns [{fieldId, occurrenceId?, value}] updates
```
computedValues key: `fieldId` (global) or `"fieldId:occurrenceId"` (occurrence-specific)

## Extended AGGREGATION block (executor only)
The executor's AGGREGATION handler supports extra `data` properties:
- `data.allowedFields: [{fieldId, flowFilter}]` — multiple source fields
- `data.scope: "grid"|"panel"|"container"` — filter scope
- `data.timeFilter: "daily"|"weekly"|"monthly"|"yearly"|"all"` — time filter
- `data.flowFilter: "in"|"out"|"any"` — single flow filter (if no allowedFields)

These are used by operations created in createDefaultUserData.js via `makeAggOp()`.

## ACTION block
- `data.actionType: "SEND_TO_DISPLAY"` → writes to computedValues[targetFieldId]
- `data.targetFieldId` — destination field
- `data.occurrenceId` — optional: occurrence-specific key
- slot `value` — the computed value to send

## Recent Changes (Apr 26 2026 — ExprOrPath crash fix)
- **OperationsBuilder.jsx**: `ExprOrPath` line 708 wrapped with `String(value ?? "").trim()`; line 728 type-guards `pathStringToChain(value)` with `typeof value === "string" && value`. Fixes editor crash (`.trim is not a function`) when an op step config carries a non-string value (boolean, number, object).

## Recent Changes (Mar 15 2026 — ADD_TO_POOL / REMOVE_FROM_POOL Config UI)
- **OperationsBuilder.jsx**: Added `ActionConfig` cases for `ADD_TO_POOL` (pool container picker + labelExpr input) and `REMOVE_FROM_POOL` (occurrenceIdExpr input). These action types were already in SYSTEM_ACTION_TYPES list but had no config UI.

## Recent Changes (Mar 14 2026 — D5 Question Cycling + ADD/REMOVE_FROM_POOL UI)
- **operationActions.js**: Added `CYCLE_FIELD_VALUE` action — cycles through a select field's `meta.options` by `dayOfYear % options.length`. cfg: `{ sourceFieldId, targetFieldId }`. Returns `{ fieldId: targetFieldId, value: chosen.label }`.
- **OperationsBuilder.jsx**: Added `CYCLE_FIELD_VALUE`, `ADD_TO_POOL`, `REMOVE_FROM_POOL` to `SYSTEM_ACTION_TYPES`. Added `CYCLE_FIELD_VALUE` config UI (source select field picker + target field picker + note). Fixed `FieldPicker` reference (helper was already in file).
- **createDefaultUserData.js**: Replaced static `makeLiteralOp("Journal Question Label")` with `CYCLE_FIELD_VALUE` operation ("Daily Question Cycle", triggers: onNavigation + onLoad). Rotates the journalQuestion display field through journalQuestionPool options daily.

## Recent Changes (Mar 14 2026 — Node Input Calculator)
- **OperationsBuilder.jsx**: Added `localField` to `ENTITY_TYPES`. `SourceRow` shows field picker when `entityType === "localField"` (reuses `needsFieldId` check). Added `nodeInput` checkbox when entityType is `localField` → sets `src.nodeInput = true`. `+ Add Source` defaults unchanged.
- **OperationsBuilder.jsx**: Added `DISPLAY_LOCAL_FIELDS` to `SYSTEM_ACTION_TYPES`. Config UI: list of `{ label, expr }` rows with `+ Row` button. Rows evaluated by `resolveExpr` against `$vars`, results displayed on the op node card.
- **operationActions.js**: Added `DISPLAY_LOCAL_FIELDS` case in `executeActionItem` — evaluates each `{ label, expr }` row via `resolveExpr`, returns `{ _effect: "DISPLAY_LOCAL_FIELDS", rows: [{label, value}] }`. Also threads `context._extraVars` into `RUN_OPERATION` sub-calls.
- **operationExecutor.js**: `executePipeline` now takes optional 4th param `extraVars` (keyed by variableName). Added `localField` source handler: `$vars[varKey] = extraVars[variableName] ?? null`. `contextWithExecutors` now includes `_extraVars: extraVars` for pass-through.
- **OperationsTab.jsx**: Added `"onNodeInput"` to `EVENT_TYPES`. `OpItem` enhanced: reads `nodeInputSources` (localField + nodeInput=true) from op.pipeline.sources, renders `<Field>` inputs per source with transient `nodeInputValues` state. "Run" button fires `executePipeline` with synthetic `{ type: "nodeInput" }` trigger + `nodeInputValues` as `extraVars`. `DISPLAY_LOCAL_FIELDS` effects render result rows below inputs. All node input state resets on unmount.

## Recent Changes (Mar 2026 — LOOP Step + Variable Actions + onSchedule)
- **operationExecutor.js**: Added `loop` step type in `executeSteps()`. `gatherLoopItems()` helper filters occurrences by field/container/grid + timeFilter/flowFilter.
- **operationExecutor.js**: Variable actions: `INIT_VAR`, `SET_VAR`, `ADD_TO_VAR`, `SUBTRACT_FROM_VAR`, `MULTIPLY_VAR`, `INCREMENT_VAR`, `DECREMENT_VAR`, `DIV_VAR` (all mutate `$vars` in-place, no updates emitted). `DIV_VAR` uses `Math.round(a/b × 100)/100` for precision; guards against divide-by-zero.
- **operationExecutor.js**: `$iterationId`, `$iterationValue`, `$iterationFilter` added to `executePipeline $vars` setup.
- **operationExecutor.js**: `APPEND_TO_DOC` + `PREPEND_OCCURRENCE` action types added (return `_effect` objects).
- **operationExecutor.js**: `onSchedule` trigger type — fires when `transactionType === "ScheduleOp"`. `triggerConfig.onSchedule: { hour?, minute? }` — if both null fires every tick; otherwise matches current hour/minute.
- **bindSocketToStore.js**: `setInterval(60000)` fires `fireOperations("ScheduleOp")` every minute. Cleared in cleanup return.

## Recent Changes (Mar 2026 — resolveExpr Bug Fixes + SHOW_VALUE Target)
- **operationExecutor.js**: Fixed `resolveExpr` top guard: `if (!expr) return null` → `if (expr == null) return null` + added `if (typeof expr !== "string") return expr`. Fixes crash when `expr` is a boolean (`true`/`false`) or number (`-1`, `100`) — previously called `.startsWith()` on a non-string and threw TypeError. This broke ALL operations using `MULTIPLY_VAR`/`makeLoopCountTrueOp`/`makeCompletionRateOp`.
- **operationExecutor.js**: Fixed falsy-zero bug in `$vars` lookup: `if (!varData) return null` → `if (varData == null) return null`. Previously `resolveExpr("$total", $vars)` returned `null` when `$total = 0`, causing all 0-value goals to show blank instead of `0`.
- **operationExecutor.js**: `SHOW_VALUE` and `SET_VALUE` now pass `target` to updates: `{ fieldId, value, target }`. Previously targetValue/targetPeriod in step config were silently dropped — progress bars never showed on LOOP-based goal operations.

## Recent Changes (Mar 2026 — Date Action Types + Built-in Vars)
- **operationExecutor.js**: Added `$now`, `$today`, `$currentDate`, `$currentHour`, `$currentTime` built-in vars to `$vars` in `executePipeline`.
- **operationExecutor.js**: New date comparators in `evalRule`: `DATE_BEFORE_TODAY`, `DATE_IS_TODAY`, `DATE_AFTER_TODAY`, `DATE_WITHIN_DAYS` (normalizes to midnight, uses `Math.round`).
- **operationExecutor.js**: New action types in `executeActionItem`:
  - `DATE_DIFF` — computes days from today to an occurrence's date field. `perOccurrence: true` writes per-occurrence `{ fieldId, occurrenceId, value }` tuples; `false` returns closest upcoming date globally.
  - `COUNT_DATE_OVERDUE` — counts occurrences where `dateFieldId` field value < today. Writes count to `targetFieldId`.
  - `COUNT_DATE_UPCOMING` — counts occurrences where date field is >= today and <= `withinDays` days out. Default `withinDays: 7`.
- **operationExecutor.test.js**: 10 new tests added for DATE_DIFF, COUNT_DATE_OVERDUE, COUNT_DATE_UPCOMING, DATE_BEFORE_TODAY, DATE_AFTER_TODAY, DATE_WITHIN_DAYS. Total: 258 tests.

## Recent Changes (Mar 2026 — Comprehensive Triggers + Sources)
- **operationExecutor.js**: New trigger types in `matchesTrigger`: `onCreate` (OccurrenceCreateOp), `onDelete` (OccurrenceDeleteOp), `onMove` (OccurrenceMoveOp), `onComplete` (MeasureOp where value is truthy), `onModuleUpdate` (ModuleOp), `onLoad` (null transactionType). Each supports optional `triggerConfig` filters.
- **operationExecutor.js**: New comparators in `evalRule`: `GREATER_OR_EQUAL`, `LESS_OR_EQUAL`, `IS_NOT_EMPTY`, `NOT_CONTAINS`.
- **executePipeline source types**: Added `panel` (id/label/kind/defaultDragMode/iteration), `occurrence` (all field values + _iterationTimeValue), `field` (aggregated value/flow + metadata). Existing: `instance`, `container`, `grid`.
- **OperationsBuilder.jsx ENTITY_TYPES**: Expanded to 6 types: instance, container, panel, occurrence (by ID — text input or $trigger.occurrenceId), field (aggregated — field picker dropdown), grid. Each shows `hint` text for available `$var.*` properties.
- **OperationsBuilder.jsx SourceRow**: Updated to handle all 6 entity types. Panel shows panel picker. Occurrence shows text ID input. Field shows field dropdown. Hint text displayed below each row.

## Recent Changes (Mar 2026 — Option 1: $lastCreatedOccurrenceId + New Action Types)
- **operationActions.js**: `CREATE_OCCURRENCE_WITH_ITERATION` now pre-generates UUID via `globalThis.crypto?.randomUUID?.()`, sets `$vars["$lastCreatedOccurrenceId"] = uuid`, and includes `occurrenceId` in effect. Server uses provided ID on new creation; on existing-find emits back with `_requestedId` for client reconciliation.
- **operationActions.js**: New `NAVIGATE_DAY_PAGE` action type — atomic shortcut for day-page workflow. Emits `navigate_day_page` socket event (find-or-create occurrence + update view.activeOccurrenceId in one server call). cfg: `{ moduleId, viewId, iterationValue? }`.
- **operationActions.js**: New `UPDATE_VIEW` action type — updates a view record patch (e.g. `activeOccurrenceId`). cfg: `{ viewId, activeOccurrenceId?, patch? }`. Emits `update_view` socket event.
- **operationActions.js**: New `RESET_RECURRING_TASK` action type — resets completion field to false + advances dueDate by recurrenceDays. cfg: `{ completionFieldId, dueDateFieldId, recurrenceDays }`. Triggered by `onComplete`.
- **bindSocketToStore.js**: `applyOperationEffect` extended — `CREATE_OCCURRENCE_WITH_ITERATION` now passes `occurrenceId`. Added `NAVIGATE_DAY_PAGE` case (emits `navigate_day_page`), `UPDATE_VIEW` case (emits `update_view`).

## Recent Changes (Mar 2026 — Steps Model + PipelineEditor Redesign)
- **operationExecutor.js**: Steps model only. `executePipeline` uses `{ sources, steps }`. NO legacy `conditions+actions`.
- **OperationsBuilder.jsx PipelineEditor**: Complete redesign — Sources (collapsible) + Steps list. Steps can be Action (`{ type: "action", config: { type, ... } }`) or If/Else (`{ type: "if", condition, then, else }`), nested. All 13 action types with full config UI.
- **Action types**: SHOW_VALUE, AGGREGATE, SET_FIELD_VALUE, INCREMENT_FIELD, MARK_COMPLETE, MOVE_OCCURRENCE, REMOVE_OCCURRENCE, CREATE_OCCURRENCE, UPDATE_MODULE, DELETE_MODULE, NOTIFY, RUN_OPERATION.
- **Condition comparators**: IS, IS_NOT, GREATER, LESS, GREATER_OR_EQUAL, LESS_OR_EQUAL, CONTAINS, IS_EMPTY, IS_NOT_EMPTY.

## Recent Changes (Feb 22)
- blockTypes.js: Added ON_LOAD, ON_ITERATION, ON_MANUAL, **ON_WEBHOOK** HAT types
- blockTypes.js: Added TRIGGER_DATA reporter (reads transaction property)
- blockTypes.js: Added ACTION statement (SEND_TO_DISPLAY, UPDATE_OCCURRENCE_FIELD, **HTTP_REQUEST**)
- blockTypes.js: Updated createFieldBlocks/createFieldBlock for inputEnabled/displayEnabled
- blockTypes.js: Added BLOCK_PALETTE.actions category
- blockTypes.js: Added LOOP `while` variant (loopType: "while" — condition slot, max 10000 iterations guard)
- operationExecutor.js: CREATED — full pipeline executor
- operationExecutor.js: LOOP execution added (foreach/repeat/while — all with 10000-iteration guard)
- operationExecutor.js: HTTP_REQUEST action (fire-and-forget fetch to external URL)
- operationExecutor.js: `onWebhook` trigger type → `WebhookOp` transactionType

## Operation Widget Instances (Feb 22)
- Drag operation from Command Center → drops on container → creates new instance with `operationBindings`
- Instance.js model: `operationBindings: [{ operationId, widgetType, displayName }]`
- widgetType: "trigger" (run button) | "display" (computedValues output) | "input" (future)
- Instance.jsx renders operation widgets inline alongside field pills
- Webhook URL shown in operation editor (triggerType === "onWebhook")
