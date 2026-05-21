# client/src — Source Root CLAUDE.md

_Updated: 2026-05-21. Check this file before re-reading source._

## Recent Changes (2026-05-21 — Multi-date filter cascade wiring)
- **`helpers/operationActions.js` (`evalRule DATE_IN_PERIOD`)** — new
  short-circuit branch BEFORE the period/span path: if rightVal is an
  object with `kind:"multi"` + `Array.isArray(dates)`, normalize
  leftVal to a day-key and OR-match against each entry. Empty
  `dates[]` always fails. Existing day/week/month/year/span paths
  unchanged. Driven by the `DrilldownDatePicker`'s non-consecutive
  selection now landing in `grid.activeFilterValues[fid]` as
  `{kind:"multi", unit:"day", value:firstISO, dates:[...]}`.
- **`state/selectors.js` (`isOccurrenceVisible`)** — `hasPeriod`
  detection in the condition-based path AND the legacy direct-equality
  path widened to also match `(rightVal.kind === "multi" &&
  Array.isArray(rightVal.dates))`. Without this, multi-shape values
  (whose `unit === "day"`) were falling through to bare SAME_DAY,
  passing an object as rightVal and silently failing every match.
  Both paths now route multi shapes through `evalRule
  DATE_IN_PERIOD`, which OR-matches across `dates[]`.
- **`ui/HeaderChevron.jsx` (`formatFilterValue`)** — multi-shape
  detection added BEFORE the period branch: a value with
  `kind:"multi"` and `Array.isArray(dates)` renders as
  `"N day" / "N days"`. Was previously falling into the period branch
  (since `"value" in object` is true) and rendering only the FIRST
  date. Empty `dates[]` returns null (no pill).
- **`$activePeriodDates` already enumerates multi shapes** — the
  executor's `expandPeriod` (operationExecutor.js ~line 935) already
  short-circuits on `kind:"multi"` and returns the flat dates list, so
  trackers / Build-Schedule ops that consume `$activePeriodDates`
  ingest multi-day selections without any changes here. `$activeDate`
  still resolves to the anchor (first date) for ops that want one
  representative day.
- **`NavPickerPopover.formatSummary`** already handles multi via its
  `kind === "multi"` branch ("Date1, Date2, Date3" / "FirstDate +N");
  no change needed for the trigger-button summary.
- **Regression coverage** — 4 new cases in
  `__tests__/operationActions.unified.test.js` (evalRule multi OR-
  match across dates / non-match / ISO normalization / empty dates[])
  + 3 new cases in `__tests__/filterCascade.test.js` (visibility on
  match / non-match / legacy direct-equality path with multi shape).
  108/108 in the two relevant suites; 733/738 client-wide (the 5
  unrelated failures are masterReducer's pre-existing
  `SET_COMPUTED_VALUES` test drift from the prior session's
  `color/icon/suffix/replaceValue` defaults — not touched here).

## Open docket (work still pending — handed off 2026-05-21)
This session built the rules / picker / pill scaffolding. The data-
authoring and integration passes remain:

- **Author more `$displayRules` in live data.** Six trackers now
  rule-decorated: Water (target met/notMet), Pages (Pages-style
  neutral), Spent (negative-money red ArrowDown), **Time Spent**
  (Pages-style neutral), **Pomodoros Today** (target met/notMet —
  daily target 3), **Earned** (positive complement to Spent —
  null/zero blue, positive green ArrowUp), **Pomodoro Time**
  (Pages-style neutral; see note below). Remaining per the user's
  spec:
  - **Pomodoro Time state-based rules deferred.** The docket spec'd
    blue-on-null / red-on-`state:"paused"` / green-on-`state:"running"`,
    but the Pomodoro instance carries `pomodoroPhase` with `"work"`/
    `"break"` values, not a `state: "running"|"paused"` sibling field.
    Authored a Pages-style neutral rule instead so the tracker still
    decorates. Adding the state-based rule needs either a new
    `pomodoroState` field on the Pomodoro template (and Pomodoro:
    Start / Pause / Resume ops to write it) OR rewiring the rule
    predicate to read `pomodoroPhase` with different colour
    semantics.
  - **Bills / negative-connotation money** — red on any positive,
    blue at 0/null. No standalone bills tracker exists yet — when
    one is added (e.g. "Total Bills Due"), use the Spent rule
    shape verbatim minus the ArrowDown icon (bills are owed amounts,
    not outflows yet).
  - **Countdowns to 0** — red while > 0 (`{ when: { value: "positive" },
    color: "rgb(252,165,165)", icon: "ArrowDown", suffix: "left" }`),
    green when `value: "zero"` with `icon: "Check"`. No countdown
    trackers exist yet (was on the docket as a template).
  - **Percentages without targets** — single catch-all rule
    `{ when: {}, color: "rgb(96,165,250)" }`. No percentage trackers
    exist yet.
  - **Books Read / Movies Watched / Podcasts / Courses** — these
    are PUSH_TO_ARRAY row-builders that write an array of
    `{label, date}` objects to a multi-column display field, NOT a
    numeric scalar. Display rules only meaningfully decorate
    scalar values (color/icon ride on the value); array writes
    have no "value: zero" semantic at the rule layer. If the user
    wants per-row colour coding, that's a different mechanism
    (column-level styling on the display field's
    `displayConfig.columns`, not `$displayRules`).
- **Date-stamp bug on goals/trackers.** The "Stamp Filter Date" op
  exists at `createLiveData.js:5634` and fires on filter changes +
  onLoad. Symptom: Date field on goal occurrences shows the literal
  field name "Date" because the value is null. Plausible causes
  (need run-log to confirm): goal occurrence's parent chain doesn't
  connect via `occurrences[]` so `_effectiveFilter` can't resolve;
  OR `onLoad` fires before `$allInstances` is populated. Open the
  op's run log in Command Center to see which.
- **Goals restructure Stage 2 (handoff item from 2026-05-20).**
  Split the single-occurrence-with-many-display-fields into per-goal
  occurrences with stable refs. Per the prior handoff, option (a) is
  to add `$allItemsById` to the executor (`operationExecutor.js`
  ~line 1172 area), verify the path resolver handles UUIDs via
  bracket notation `$allItemsById["abc-123-def"]`, then split goal
  instances + update tracker call sites in `createLiveData.js`.
- **Folder page renders no instances.** Separate from the breadcrumb
  click fix this session. Folder-page kind renders via
  `modules/pages/PageFolder.jsx`, which derives child cards from
  occurrences with `parentId === occurrence.parentId`. Newly minted
  folder pages come up empty — likely PageFolder's child-lookup
  filtering them (template flags / role-kind exclusions / `parentId`
  mismatch). Needs a focused trace through PageFolder.
- **Value builder — typed array/object editor with CategoryPathPicker per row.**
  The current `ui/JsonStructureEditor.jsx` is a generic JSON editor
  (str / num / bool / null / [ ] / { } cycle). Grow it into a **value
  builder** where each row's "type" dropdown ALSO includes
  occurrence / template / field / module / operation / category path
  — picked via the same `CategoryPathPicker` that the operations
  editor already uses. The picked id becomes the row's stored value;
  the row chrome displays the resolved **label + breadcrumb / spot +
  type icon** so the author isn't staring at raw UUIDs. Distinct from
  the JSON primitive types — primitives stay as today; the new types
  store an id (or a dotted path like `$allItems.<id>.fields.<fid>.value`)
  and render a chip.
  - Replaces label-based matching everywhere. Today
    `helpers/displayRules.js` keys rules by occurrence **label**; many
    seed ops similarly FIND-by-label. Authoring against ids via the
    picker makes those comparisons stable across renames and
    duplicates. Migration is a one-pass — existing label-keyed rule
    objects keep working until rewritten.
  - **Row "card" display when the value is an id-path** (not a JSON
    primitive): resolve the id and render a *small two-line card*,
    not the raw type. Same card whether the picked thing is the
    whole occurrence (id) or a sub-path on it (e.g. `id`,
    `fields.<fid>.value`, `label`, `meta.X`). Anatomy:
    The entire card IS one continuous breadcrumb whose sections
    are a 1:1 visual representation of the **CategoryPathPicker's
    drilldown chain** — same levels the user walked to commit the
    pick, rendered after the fact so they can read back what
    they picked. Each picker level becomes one card crumb,
    separated by `›` glyphs. The crumb's rendering varies by what
    kind of thing the picker drilled into at that level (category
    badge / source pill / occurrence box / field crumb / sub-path
    crumb). The middle level that lands on an OCCURRENCE is the
    focal/expanded one (multi-row box with title + fields) because
    that's where the meat lives; surrounding levels are thinner
    inline crumbs. Reading the card left-to-right replays the
    picker's chain.

    **Crumb rendering, by picker-level type** (one section per
    level; separators `›` between them):
    - **Category crumb** (level 1 of picker — `Occurrences /
      Sources / Fields / Local Variables / Built-ins`): a small
      coloured pill with the category name and its icon. Matches
      the colour the picker tile uses.
      e.g. `[● Occurrences]`.
    - **Source / variable crumb** (level 2 — `$allItems` /
      `$schedPage` / etc.): plain text crumb showing the variable
      name (and friendly subtitle when there is one — e.g.
      `$schedPage  (Source: Schedule page)`).
    - **Ancestor crumbs** (any number of levels — picker walks
      `parent › grandparent › …`): plain text labels for each
      ancestor occurrence with its role/kind chip prefix.
      e.g. `[panel] Daily Toolkit › [container] Physical`.
    - **Occurrence crumb (the focal box)** — the level where the
      picker lands ON the target occurrence. Multi-row block with
      a thin border:
      - **Title (bold)**: occurrence label. e.g. `Drink Water`.
      - **Fields list UNDER the title** (rows, binding order, no
        highlight):
        ```
        water → 2
        completed → false
        timeslot → 6:00am
        date → May 21
        ```
      Date/datetime via `Field.jsx` formatters; arrays show
      `N selected`; nulls render as `—`. Caps at 8 fields with
      `+N more` tail. Hidden bindings excluded. NO field is
      highlighted here — the "you picked X" callout is the next
      crumb.
    - **Sub-path crumb** (final level — `fields › <fid> › value`
      / `_ancestors` / `meta.X` / `id`): rendered as a single
      `name → value` crumb. For the common
      `fields.<fid>.value` pattern, just `fieldName → value`.
      For `id`, `id → <shortId>`. For deeper paths like
      `meta.scheduleSlot`, `meta.scheduleSlot → true`. Slightly
      bolder than ancestor crumbs so it reads as the destination.
    - **More than one sub-path level** (rare — e.g. `fields ›
      <fid> › value` shows as ONE sub-path crumb collapsing the
      `fields › <fid> › value` chain into `fieldName → value`).
      The picker exposes the intermediate `fields` / value
      drilldown for navigation only; the card collapses them
      back into a meaningful single crumb.

    Whole-card flow example for picker chain
    `Occurrences › $allItems › <occId> › fields › <fid> › value`:
    ```
    [● Occurrences] › $allItems › [panel] Daily Toolkit › [container] Physical › ┌──────────────┐ › water → 2
                                                                                 │ Drink Water  │
                                                                                 │ water → 2    │
                                                                                 │ completed → … │
                                                                                 │ timeslot → … │
                                                                                 │ date → May 21│
                                                                                 └──────────────┘
    ```

    Card chrome: thin border around the occurrence box only — all
    other crumbs are inline. Whole row wraps if the parent context
    is narrow (< 320px); on wrap, each crumb sits on its own row
    with `›` preserved as a leading glyph (`› water → 2` for the
    bottom crumb).

    **Implementation hook**: the shared `resolvePickedRef(path,
    maps)` helper returns the level breakdown as
    `{ levels: [{ kind, label, sublabel?, role?, occurrence?,
    field?, value? }, ...] }` so the card just iterates. The
    picker's existing `CategoryPathPicker.segmentDisplay` already
    derives most of this — extract + return the structured form
    instead of a flat string.
    - **Leading swatch (12×12)**: type icon — page / container /
      instance / textblock / artifact / field — color matches the
      manifest tree's iconography so authors recognize it
      immediately.
    - Card chrome: thin border, rounded corners, ~2px vertical
      padding. Compact enough to live inside a ValueBuilder row
      (~320px wide max — bumped from 280 to fit the field strip).
      Wraps to extra lines if narrow.
    - Raw id + full resolved path stay in the `title` attribute for
      debug-hover.
    - Same resolution logic already exists in
      `CategoryPathPicker.segmentDisplay` for path segments —
      extract into a shared `resolvePickedRef({maps, path}) →
      {label, breadcrumb, role, kind, fieldName, value, icon}`
      helper consumed by both the picker's closed-state chip AND
      ValueBuilder row cards. One source of truth for "how a picked
      reference renders."
  - **Per-row controls**: `+` and `−` on every row. `+` underneath
    the container adds a new sibling at the end. The `+` opens a
    small menu: **"Insert one"** (single row, picks type + value as
    today) and **"Insert many via FIND"** (opens a mini-Find editor
    — pick collection + predicate via the existing
    `COLLECTION_PICKER_CONFIG` + `buildRecordKeyPickerConfig` shapes
    — and fans the matches out into N rows, one per match).
  - **Renames**: rename `JsonStructureEditor` →
    `ValueBuilder.jsx`. The `OperationsBuilder.jsx` `structured`
    mode in `ExprOrPath` now drives the ValueBuilder instead of the
    JSON-only editor. Wherever else an operation cfg accepts an
    array or object today (PUSH_TO_ARRAY's `value`, CREATE's
    `fields`, FIND's predicate rule lists, APPLY_TEMPLATE's
    `replacements`, every UPDATE object cfg, $displayRules), surface
    the same ValueBuilder. Where the cfg expects a SPECIFIC
    collection (e.g. `fields:{[fid]:val}`), seed the type dropdown
    to that picker scope so the author can't pick the wrong thing.
  - **Mongo-style feel** is the target: each row reads as
    `[type ▼] [key (if obj)] [value chip / picker]  [−] [+]`,
    container has a trailing `[ + add row ]`. Nested objects/arrays
    collapse/expand with the existing chevrons.

## Recent Changes (2026-05-21 — Display-rules system + filter pill + canvas TDZ + recursion cap + AM/PM)
- **NEW `helpers/displayRules.js`** — Pure rule evaluator. Operation
  pipelines INIT_VAR `$displayRules` (an object keyed by occurrence
  label, each value an array of `{ when, color?, icon?, suffix?,
  replaceValue? }` rules). `executePipeline` post-processes every
  computed-value update AND `UPDATE_ITEM_FIELD` value effect: looks
  up rules for the occurrence's label, evaluates the first-matching
  `when` clause against the value + target + sibling fields,
  attaches the rule body to the update. Predicate keys: `value`,
  `target` (`met`/`notMet`/`none`), or any sibling field's short
  name (case-insensitive). Expected value: keyword (`negative` /
  `zero` / `positive` / `null` / `met` / `notMet` / `filled` /
  `empty`) OR literal scalar (equality) OR `{comp:LT|LTE|GT|GTE|EQ|NEQ|CONTAINS, right}`.
- **`helpers/operationExecutor.js`** — imports `applyDisplayRules`;
  post-process pass right after `executeSteps`. Handles both write
  paths: (a) inline-decorates computed-value updates; (b) emits a
  parallel computed-value update alongside each
  `UPDATE_ITEM_FIELD` (the path trackers use) so Field.jsx's
  computedValues-first preference picks up the rule decorations
  while the persistent occurrence field write still lands. Targets
  for rule matching are resolved from the field's `displayConfig.targetValue`
  when not on the update.
- **`state/masterReducer.js`** — `SET_COMPUTED_VALUES` now carries
  `color / icon / suffix / replaceValue` on each computed-value
  slot. Always overwrites with explicit `?? null` defaults so a
  rule that no longer matches clears prior decorations.
- **`ui/FieldRenderer.jsx`** — extracts `computedDisplayRule` from
  the computed slot; threaded as `displayRule` prop to all three
  `<Field>` render sites (display-only, role=="display", both-mode
  display half).
- **`state/bindSocketToStore.js`** — **defensive recursion cap** on
  `fireOperations`. `_FIRE_DEPTH_LIMIT = 8`; past that the next
  recursive fire logs a `console.warn` and bails instead of
  blowing the stack. Triggered by op chains where an
  `UPDATE_ITEM_FIELD` effect calls `setOccurrenceFieldValue`,
  which fires `MeasureOp`, which re-matches the same op, etc.
  Surfaces the transactionType in the warning so cycles can be
  identified without a hard crash.
- **`modules/CanvasContent.jsx`** — fixed TDZ crash
  (`can't access lexical declaration 'ce' before initialization`):
  the stale-edge cleanup `useEffect` referenced `saveEdges` in its
  deps array before `saveEdges` was declared. Moved the
  `useEffect` to right after `saveEdges`'s declaration. Existing
  `classifyEdges` comment at line ~387 already documented this
  exact pattern — same trap, different hook.
- **`modules/ModulePanel.jsx`** — folder breadcrumb crumbs are now
  clickable. New `openFolderCrumb(folderId)` callback finds-or-
  mints a folder-page occurrence under the folder (mirrors
  `ManifestTree.openFolderAsPage`) and calls `openPage(occId)`.
  Wired onto the non-last folder breadcrumb spans. Resolves the
  prior "breadcrumb pointer cursor with no handler" dead-end.
- **`hooks/useSocketStatus.js`** — fixed a boot-race where the
  hook's `useState` initializer read `socket.connected === false`
  and seeded status="disconnected", then the `connect` event
  fired BEFORE the `useEffect` attached its listener (no one
  heard it), leaving the pill stuck on red forever. Now re-reads
  `socket.connected` inside the effect after attaching listeners
  and reconciles to `connected` if it became true in the gap.
- **NEW `ui/JsonStructureEditor.jsx`** + **`blocks/OperationsBuilder.jsx`**
  — generic recursive array/object/primitive editor wired into
  `ExprOrPath` as a new `structured` mode (alongside path / text /
  array / null). Any `INIT_VAR` (or other pipeline cfg) holding
  a `json:{...}` value defaults to the visual editor on open.
  The `array` raw-textarea mode is still in the dropdown for
  power users who want to type JSON by hand. Used for authoring
  `$displayRules` in tracker ops.
- **`ui/Field.jsx`** — Now field display switched from 24-hour to
  12-hour with AM/PM suffix. Compact / non-compact value colors
  now follow the rule: target-met colors when there's a target,
  value-direction colors (red <0 / blue 0/null / green >0/filled)
  when there's no target. Amount input's prior flow-arrow button
  is removed. New `displayRule` prop renders rule color (overrides
  default), lucide icon (before value), suffix (after), and
  replaceValue (substitute) when a tracker authored
  `$displayRules` and the post-processor matched.
- **`ui/HeaderChevron.jsx`** — inline filter-value pill next to the
  filter button in occurrence headers. Shows currently-applied
  filter values; formatted per unit (Thu, May 21 / wk May 19 /
  May 2026 / 2026). Multi-day shows "N selected". Click opens the
  same dropdown the filter icon does.
- **`ui/DrilldownDatePicker.jsx` (NEW)** + **`ui/NavPickerPopover.jsx`**
  — Calendar drilldown picker (day/week/month/year zoom, multi-
  select, step-shift arrows, increment input at day/week levels)
  replaces the prior `react-multi-date-picker` UI inside
  `NavPickerPopover`. The shared `classifySelection` /
  `formatSummary` exports + persisted shape (`{kind, value, span,
  dates, unit}`) are unchanged — only the picker chrome swapped.
- **`Toolbar.jsx`** — `SocketStatusBanner` moved from the left
  section to a center-of-toolbar absolutely-positioned overlay so
  the disconnected pill sits visually centered when shown.

## Recent Changes (2026-05-21 — Jarvis assistant drawer + socket retry countdown (branch: assistant-jarvis))
- **`ui/AssistantDrawer.jsx` (NEW)** — bottom-right floating "J"
  button, click → 380×560 slide-in chat drawer. State all local:
  `token` (Bearer, in localStorage `moduli_api_token`), `messages`
  (chat history, in localStorage `moduli_assistant_history`), `input`.
  POSTs `{ messages, gridId }` to `/api/v1/assistant/chat` and
  renders assistant + tool transcript bubbles. Settings (⚙) panel
  in the header for pasting the API token. Mounted in `App.jsx`
  alongside `<TransactionHistory>`.
- **`hooks/useSocketStatus.js`** now exposes `retryInMs` — a live
  countdown to the next socket.io reconnect attempt. Decremented
  every 100ms by an internal ticker. Reset to the predicted backoff
  delay on every `connect_error`; parked at 0 while an attempt is
  actively in flight (`reconnect_attempt` event); cleared on success.
  Computed from `socket.io.opts.reconnectionDelay` /
  `reconnectionDelayMax` (matches socket.io's actual backoff formula,
  minus jitter).
- **`ui/SocketStatusBanner.jsx`** label updated to show
  `"Disconnected — retry in 2s (attempt 3)"` while waiting, and
  `"Disconnected — trying now (attempt N)"` during an active attempt.

## Recent Changes (2026-05-20 — Removed temporary [BUILD-DAY]/[SCHED-TABLE]/[FILTER-DIAG]/[VIS-DIAG] console logs)
- Six files were emitting tagged diagnostic `console.log`s on every load,
  NavigationOp, filter change, and Schedule render (~50 lines per debug
  run, often firing many times per user interaction). They've been
  excised:
  - `helpers/operationExecutor.js` (~150 lines in `runMatchingOperations`)
  - `helpers/CommitHelpers.js` (`updateOccurrenceFilterOverride`)
  - `state/bindSocketToStore.js` (`onGridUpdated`)
  - `App.jsx` (`filterNavState` useEffect)
  - `ui/LocalFilterNav.jsx` (`makeOnNav`)
  - `modules/ModuleContainer.jsx` (slot-filter pass)
- All real instrumentation stays — the `logger.add()` calls in the
  executor still capture every step into the persisted `OperationRunLog`
  + the in-memory `runHistory` ring buffer, surfaced by
  `commandCenter/OperationLogPanel.jsx`. The console.logs were redundant
  with that pipeline.

## Recent Changes (2026-05-20 — Socket status pill in toolbar)
- **NEW `hooks/useSocketStatus.js`** — subscribes to `socket.on("connect"
  / "disconnect" / "connect_error")` and `socket.io.on("reconnect_attempt")`,
  returning `{ status: "connected" | "disconnected" | "recovered", attempts }`.
  Initial status mirrors `socket.connected` so first paint reflects reality
  for a tab restored offline. The "recovered" state holds for 3s after a
  successful reconnect, then flips to "connected".
- **NEW `ui/SocketStatusBanner.jsx`** — small inline pill rendered only when
  status ≠ "connected". Red w/ pulsing dot + WifiOff icon while disconnected
  (label includes the retry attempt count when ≥1), green + Wifi icon for
  the 3s recovered window. Tooltip on the red pill explains that writes are
  being buffered locally (the offline queue handles this — the pill is just
  visibility).
- **`Toolbar.jsx`** — imports `SocketStatusBanner` and renders it
  immediately to the right of the logo block (still inside the left-side
  shrink-0 group), so it's the first thing the user sees when their
  connection drops on either desktop or mobile.
- **`index.css`** — added `@keyframes socket-status-pulse` (opacity +
  scale dip every 1.2s) used by the red-state dot.

## Recent Changes (2026-05-19 — Editor↔field binding (self-field + sync))
- **NEW**: `state/editorBindings.js` — `resolveEditorBinding({ occurrence, module, slot })`
  cascade (occurrence.meta wins → module.meta next → null). String "clear"
  on the occurrence opts out of a module binding without re-setting.
  `findLinkedSiblings({ binding, hostOccurrence, occurrencesById, nextValue })`
  returns all occurrences sharing host's link-field value AND carrying the
  selfField (loop guard: skip if value already matches nextValue). `sameLinkValue`
  has SAME_DAY semantics for ISO date strings.
- **NEW**: `helpers/boundFieldSync.js` — `propagateBoundFieldWrite(...)` writes
  the new value to every linked sibling via `CommitHelpers.updateOccurrence`.
  Called after every host-field write by BoundHeader / BoundBody.
- **NEW**: `modules/BoundHeader.jsx` + `modules/BoundBody.jsx` — render the
  HOST occurrence's own selfField (no remote lookup). Header is type-dispatched
  (dropdown when field has options — covers `select` AND `text` with optionsSource;
  plain inline text otherwise). Body uses minimal TipTap (StarterKit + Placeholder)
  for text fields; debounced 500ms write-back + sync.
- **ModuleContainer.jsx**: `headerBinding` memo (`resolveEditorBinding`) at
  component top; both header render sites (embedded + standard) check it and
  swap in `<BoundHeader hostOccurrence={containerOccurrence} ... />` when set.
  Falls back to the existing contentEditable/static label path otherwise.
- **docs/pills/InstanceTextblockNode.jsx**: `bodyBinding` memo similarly gates
  whether the inner `DocContent` is wrapped by `<BoundBody>` or rendered raw.
- **NEW**: `ui/EditorBindingSection.jsx` — picker UI (two selects: Self field /
  Link field, scope toggle module|occurrence, Clear binding). Mounted in
  `ContainerForm` Settings tab (header binding) and `InstanceForm` Fields tab
  inside `BodyBindingPicker` (textblock-role only).
- **Binding shape**: `{ selfField: fieldId, link: fieldId }` stored at
  `module.meta.<slot>Link` or `occurrence.meta.<slot>Link`. Slot ∈ {"header","body"}.
- The op layer (e.g. drag-to-Schedule date stamp) does the JOIN setup; the
  binding layer auto-propagates writes between any occurrences with matching
  link value + selfField. No explicit linkedGroupId.

## Recent Changes (2026-05-19 — Grid-level sort with row-major reflow)
- **Grid.jsx**: `visiblePanels` useMemo gains a reflow path. When
  `grid.meta.localSort.fieldId` is set AND there are ≥2 panels, panels
  are wrapped as `{ instance, occurrence }` items, sorted via
  `applyLocalSort` (the same helper used by container/page/panel
  sorts), and re-emitted with row-major placement (`row: i/cols, col:
  i%cols, width: 1, height: 1`). Occurrence `placement` is NOT
  mutated — clearing sort restores the original 2D placement +
  rowSpan/colSpan. Imports `applyLocalSort` from `./helpers/LayoutHelpers`.
- **ui/SortSection.jsx**: Refactored to accept `entity` prop +
  optional `onPersistSort(next)` callback. Falls back to occurrence-
  based persist when only `occurrence={...}` is passed (back-compat).
  New `labelOverride` prop. Used by `commandCenter/GridSettingsTab.jsx`
  with `entity={grid}` + `onPersistSort` that writes through
  `CommitHelpers.updateGrid({ grid: { meta: { ...grid.meta, localSort: next } } })`.

## Recent Changes (2026-05-19 — LoginScreen redesign + new lockup SVG + addInstanceToContainer fieldIds)
- **LoginScreen.jsx**: Layout switched from a centered single column over
  `#1D2125` to a flex row. Left 2/3 of the viewport: `background-image:
  url(/login_bg.jpg)` (cover/center/no-repeat) with a left-to-right
  gradient scrim `rgba(14,33,64,0.25) → rgba(29,33,37,0.55)` so the dark
  login box reads against the photo. Right 1/3: centered column wrapping
  the existing login box (input/button styles unchanged). `minWidth: 280`
  on the right column so the form never compresses below its inputs. The
  logo `<img>` was swapped from `/moduli_logo.png` (36px) to
  `/moduli_lockup.svg` (56px) — the new ribbon-style mark + wordmark.
- **public/login_bg.jpg** (NEW): copy of root-folder `20260209_083212.jpg`
  (architecture-diagram screenshot, ~147 KB) so Vite serves it. The PNG
  in the root folder is left in place.
- **public/moduli_mark_clean.svg + public/moduli_wordmark.svg +
  public/moduli_lockup.svg** (NEW): clean redraw of the infinity-knot
  mark (no `stroke-dasharray`, single continuous ribbon, dark backer +
  specular highlight + over/under knot) plus a "moduli" wordmark where
  each letter is drawn in the same ribbon-stroke style (rounded caps,
  blue gradient, mini interlocking knot between `d` and `u`). Lockup
  combines both. Existing PNGs / older SVGs left in place for A/B.
- **App.jsx**: `addInstanceToContainer(containerId)` now accepts an
  optional second arg `opts = { fieldIds }`. When fieldIds is a non-empty
  array, the new module is created with `fieldBindings: [{ fieldId,
  role:"input", hidden:false }]` pre-stamped. Empty / missing fieldIds
  is byte-identical to before. Used by the QuickAddMenu field-picker
  flow. Added `occurrencesById` to the useCallback dep array (was
  previously read inside the callback without being declared — small
  pre-existing freshness bug fixed in passing).

## Recent Changes (2026-05-18 — Grid-switch loading overlay + auto-retry)
- **App.jsx**: Grid-frame div now has `position: relative` + a conditional overlay child rendered when `state.gridId && state.grid?._id && state.gridId !== state.grid._id` (i.e. the user picked a new grid in the toolbar but `request_full_state` hasn't returned yet). Overlay is `position:absolute inset:0`, flex-column centered (gap:12) over a semi-transparent black w/ 2px backdrop blur, `zIndex:900`, with `<Spinner size="xl" />` plus a "Retrying..." label that appears underneath the spinner once the retry timer kicks in. Clears automatically when `FULL_STATE` lands and `state.grid._id` catches up to `state.gridId`. Initial app load still uses the existing full-frame spinner (the early branch where `state.grid?._id` is falsy) — the overlay only kicks in for grid-to-grid switches.
- **App.jsx**: `gridSwitchRetrying` state + a useEffect keyed on the derived `isSwitchingGrid` flag. While switching, a `setInterval` every 8s re-emits `socket.emit("request_full_state", { gridId: targetGridId })` and flips `gridSwitchRetrying=true`. Resets to false whenever switching ends (cleanup runs on dep change). Motivation: server-side Mongo timeouts (e.g. `MongoNetworkTimeoutError` to 89.192.237.102:27017) silently swallow the first `request_full_state` socket emit — without the retry the spinner would hang forever.

## Recent Changes (2026-05-17 — Select options source refactor + occurrence field type)
- **Field type "module" replaced by "occurrence"**: `field.meta.options` (string[]) + `meta.sourceType: "pool"` both gone. Replaced by discriminated `field.meta.optionsSource = { mode: "manual" | "range" | "find", ... }`. The "find" mode reuses operations FIND machinery (`evalGroupAgainstRecord` + `resolveRecordPath`) so any reachable record path can be used as the option's value/label.
- **Field type "occurrence"**: stores an occurrence id, displays its label (or any path). Replaces the prior "module" field type. Supports `meta.multiSelect: true` like select fields do.
- **Migration**: lazy at `full_state` ingestion in `bindSocketToStore.js`. Legacy `meta.options` → manual mode; legacy pool → find mode with OR-grouped HAS_ANCESTOR rules; legacy `type: "module"` → `type: "occurrence"` with auto-mapped collection.
- **Settings UI**: `client/src/ui/commandCenter/SelectOptionsSourceEditor.jsx` is the new three-mode editor (Manual / Range / Find) used by both select and occurrence fields. Find mode reuses `CategoryPathPicker`, `COLLECTION_PICKER_CONFIG`, `buildRecordKeyPickerConfig`, and `ConditionGroup` from existing operations primitives. Includes live preview.
- **Search-when-many**: `Field.jsx`'s non-compact select Popover now renders a filter input above the option list when `_resolvedOptions.length > 10`. (Note: the non-compact occurrence path still uses a native `<select>` — possible follow-up for parity.)

## Recent Changes (May 15 2026 — Mobile instance cards no longer giant)
- **index.css** `@media (max-width:600px)`: added `.instance-content { justify-content: flex-start !important }` and `.instance-fields { flex: 0 0 auto !important; justify-content: flex-start !important }`. Root cause: ModuleInstance inline styles assume a ROW — `.instance-content` has `justify-content:space-between`, `.instance-fields` has `flex:1 1 160px`. The existing mobile rule flips `.instance-content` to `flex-direction:column`, which turned the `160px` into a tall, *growing* flex-basis and made `space-between` push label/fields to opposite ends → ~250px empty cards. Pinning justify-content to start + stopping the fields block from growing collapses cards to natural height. (Verified against screenshots.)

## Recent Changes (May 11 2026 — Toast offset)
- **App.jsx**: `<Toaster position="top-center" offset={4} />` (was no offset). Sonner's default top offset (~32px) pushed toasts below the toolbar; with offset 4 they land inside the toolbar band so notifications read as part of the chrome instead of floating below.

## Recent Changes (May 10 2026 — Local tree styling + field wrap + date picker)
- **modules/ManifestTree.jsx**: Local tree (page-panel sidebar) refactored to look identical to the root tree. Added `LocalFolderGroup` (chevron + folder NodePill + indented `PageTreeNode` children, mirrors `FolderNode`). Removed the right-aligned "LOCAL 📁" header, the right-aligned folder header rows, and `reverseIndent={true}` on PageTreeNode. Local entries now sit on the left edge with the same chevron/pill style as root.
- **modules/ModuleInstance.jsx**: Instance row `.instance-content` gains `flexWrap: wrap` + `rowGap: 4`, and `.instance-fields` uses `flex: 1 1 160px`. Fields wrap to a new row underneath the label whenever the row is too narrow to keep them inline (fixes squished fields on Schedule slots / narrow panels).
- **ui/Field.jsx**: Compact date pill — normalizes ISO timestamps to `yyyy-MM-dd` before binding to `<input type="date">` (seed values are full ISO strings, which the date input silently dropped). Wires `inputRef` to that hidden input and adds an `onClick` on the wrapping `<label>` that calls `inputRef.current.showPicker()` so the native date picker actually opens (the input is `pointer-events:none, 0×0` — label-click forwarding wasn't reliably triggering the picker).

## Recent Changes (May 10 2026 — Panel Header Switcher Move)
- **modules/ModulePanel.jsx**: Grid cell stack switcher (`panel-stack-btn-inline`) now lives inside the page panel header, inline-right of QuickAddMenu (Layers icon + count, only when `stack.length > 1`). Removed the `marginLeft: 18` spacer from the active page label so it sits flush against the drag handle (only the parent flex `gap: 6` remains).
- **Grid.jsx**: GridCell stack button gated by `stackCount > 0 && !hasPanel` so it stops rendering when the cell has a panel (header takes over).

## Recent Changes (Apr 9 2026 — B2/B3/C2: Local Tree Nesting + Folder Breadcrumbs + Mini Block)
- **modules/ModulePanel.jsx**: Replaced navHistory breadcrumbs with `pageBreadcrumbs` useMemo (walks `occ.parentId → foldersById`). Shows `Folder › Page` trail when page has parent folder. navHistory state + useEffect removed. (B3)
- **ui/Editor.jsx**: Added "Make mini block" right-click context menu item. Captures selection at menu-open time; on click creates module (role:"instance", kind:"doc") + occurrence with selection as textmap, then replaces selection with instancePill block node. (C2)

## Recent Changes (Apr 9 2026 — Plan A1/A2/B1/B4: Drag Fix + Typing Fix + Tree Push + Close Buttons)
- **helpers/dragSystem.js**: Fixed drag handle `dragstart` interceptor — replaced `elementFromPoint` with `_dragFromHandle` boolean flag. Root cause: `dragstart` fires at current cursor pos (after movement), not pointerdown pos. Now drag handles work reliably. (A1)
- **ui/Editor.jsx**: Debounced `onAutoCreateTextblock` trigger — waits 300ms after first char before creating textblock, re-reads full text when timer fires. Added `autoCreateTimerRef` + cleanup on unmount. (A2)
- **modules/DocContent.jsx**: After auto-creating textblock, places cursor at END of sub-editor content (Selection API `range.collapse(false)`). Fixes "elloh" ordering bug. (A2)
- **modules/ModulePanel.jsx**: Root/local tree sidebars now push content on desktop (flex row siblings) instead of overlay (absolute). On mobile, stays as absolute overlay. Added X button in page header to close/unpin active page. (B1, B4)
- **modules/ManifestTree.jsx**: `PageTreeNode` accepts `onClosePage` prop — shows X button on row hover in local tree. `onClosePage` threaded from ManifestTree to PageTreeNode for local pages. (B4)
- **index.css**: Added `.page-tree-close-btn` CSS — opacity 0 by default, shows on parent div hover. (B4)

## Recent Changes (Apr 9 2026 — Editor Cursor Placement + Text Drag Fix)
- **index.css**: Added `-webkit-user-drag: none` / `user-drag: none` to `.doc-editor-content.ProseMirror` and all children. Prevents native text-selection dragging while preserving text selection/highlighting.
- **ui/Editor.jsx**: Added `handleDOMEvents.dragstart` in TipTap editorProps — cancels dragstart unless from a drag handle element.
- **helpers/dragSystem.js**: `useDraggable` + `useDragDrop` drag handle cleanup now intercepts `dragstart` on the wrapper. If drag didn't start from handle, cancels it and removes `draggable` attribute. Added `drop` event listener for robust cleanup.
- **docs/ModuleEmbedExtension.js**: `draggable: true` → `false`. Prevents ProseMirror from treating embeds as native draggable nodes.
- **docs/pills/InstancePillNode.jsx**: Block pill handle cleanup mirrors dragSystem.js fix (dragstart interception + drop listener).

## Recent Changes (Apr 6 2026 — Phase E: Iframe Removal + Dead Code Cleanup)
- **main.jsx**: Removed `previewOcc` URL param check and `PagePreviewApp` dynamic import. Always loads `App` directly. Removed dynamic import pattern.
- **PagePreviewApp.jsx**: DELETED — was the iframe preview app entry point creating extra socket connections.
- **helpers/thumbnailCache.js**: DELETED — iframe pool manager for preview thumbnails.

## Recent Changes (Mar 26 2026 — Panel Cycler Empty State)
- **Grid.jsx**: `GridCell` now accepts `hasHiddenStack` prop. When `!hasPanel && hasHiddenStack`, shows a "show" button (Layers icon) in the pocket that calls `cyclePanelStack({ cellKey, dir: 1 })`. Pocket `pointerEvents: "auto"` when hasHiddenStack. `cellsData` now computes `hasHiddenStack = !hasPanel && cellPanels.length > 1`.

## Key Files

| File | Purpose | Last Changed |
|------|---------|--------------|
| `App.jsx` | Root component. Socket.io setup, GridActionsContext/GridDataContext providers, undo/redo lifted here. Filter handlers. **Mobile: isMobile + activeCell + zoomedOut state lifted here, passed via actionsValue context.** | Mar 18 |
| `Grid.jsx` | Main grid layout. Panel placement via CSS grid. **Mobile: wraps GridRender in MobileGridNav, hides resize handles, clamps activeCell on dimension change. StackOverlay component renders AFTER panels for z-index stacking.** | Mar 18 |
| `modules/Module.jsx` | **PRIMARY RENDERING COMPONENT.** Unified Panel/Container/Instance/Canvas in one file. Replaces old Panel.jsx, SortableContainer.jsx, SortableInstance.jsx. Has context menus (right-click) for all entity types. | Mar 2026 |
| `modules/` | Module.jsx + supporting files. Active rendering system for all entity types. | Mar 2026 |
| `ResizeHandle.jsx` | Panel resize corner handle | Stable |
| `Toolbar.jsx` | Top toolbar: logo, `+Panel` button, grid select, filter nav, Pomodoro, Clock (history), CC button, EyeOff hide, account avatar. **Mobile: MiniGridMap SVG in left section — click toggles zoomed-out mode.** | Mar 18 |
| `GridActionsContext.js` | Context: dispatch, socket, all entity maps (modulesById, occurrencesById, fieldsById, manifestsById, viewsById, operationsById, foldersById, computedValues) | Mar 2026 |
| `GridDataContext.js` | Context: read-only state for components that don't dispatch | Stable |
| `index.css` | Global CSS. Semantic tokens. **Section 14: Mobile Grid Nav CSS (viewport, slider, lip buttons, edge glow, zoom-out overlay). Section 15: Responsive (was 13).** | Mar 18 |
| `hooks/useMobileDetect.js` | **NEW** — `useMobileDetect()` hook. Returns `{ isMobile }` via `matchMedia(max-width: 600px)`. Exports `MOBILE_BREAKPOINT`. | Mar 18 |
| `mobile/MobileGridNav.jsx` | **NEW** — Zelda-style viewport wrapper. Transform-based cell navigation with lip buttons. **Zoomed-out mode**: scales grid to fit viewport with CellOverlay for selection, animated transition. Desktop passthrough. | Mar 18 |
| `mobile/MiniGridMap.jsx` | **NEW** — Tiny SVG grid indicator for toolbar. Click toggles zoomed-out mode. Returns null for 1x1. | Mar 18 |
| `ui/FilterNav.jsx` | Named filter dropdown + conditional date nav. Replaces old IterationNav.jsx. compact=true for toolbar. | Mar 2026 |
| `ui/CommandCenter.jsx` | **11-tab** command center: Fields/Operations/Filters/Grid/Appearance/Components/Files/Connections/Lists/UserSettings/Shortcuts. | Mar 16 |
| `ui/ContextMenu.jsx` | Right-click context menu portal. Pattern: `useState(null)` + `onContextMenu` + `<ContextMenu ctx={...} onClose={...} />` | Mar 2026 |
| `ui/Editor.jsx` | General-purpose TipTap editor. FieldPill/InstancePill/DocLink/ExprPill/ModuleEmbed extensions. Drop reformat dialog. Block handles. Click-to-focus. | Mar 14 |

## Architecture Rules
- **modules/Module.jsx** is the primary rendering component — NOT the old Panel.jsx/SortableContainer.jsx/SortableInstance.jsx (those files are DELETED).
- Panel/Container/Instance drag handles = the RadialMenu wrapper div (ref=handleRef). NOT separate GripVertical for panels/containers.
- Instance drag handle = GripVertical at `left: 0` inside `.instance-wrap`. Shows on hover via CSS, hidden during `.dragging`.
- Context menus use `<ContextMenu>` portal. Pattern: `useState(null)` + `onContextMenu` + `<ContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />`.
- No component calls socket directly — all mutations go through CommitHelpers.
- Filter system (not iteration): `grid.namedFilters`, `grid.activeFilterId`, `grid.activeFilterValues`. FilterNav.jsx is the nav component.

## Recent Changes (Mar 25 2026 — Batch 3: Escape + Default Page + Tree Thumb)
- **App.jsx**: Added global Escape key `useEffect` — closes history dialog first (if open), then CommandCenter. Checks `e.defaultPrevented` so inner menus (RadialMenu, QuickAddMenu) get priority. Skips when focus is in input/textarea/contentEditable.

## Recent Changes (Mar 20 2026 — C4 Context Split + Post-Review Fixes)
- **GridLiveContext.js** (NEW): Frequently-changing values split from GridActionsContext: `computedValues`, `canUndo/canRedo/undo/redo/isProcessing`, `isMobile/activeCell/setActiveCell/zoomedOut/setZoomedOut`.
- **App.jsx**: `actionsValue` dep array uses granular state subfields (`state.grid`, `state.occurrences`, etc.) instead of full `state` — deliberately excludes `state.computedValues` so computedValues changes don't force all GridActionsContext consumers to re-render. `liveValue` useMemo provides the live values. `GridLiveContext.Provider` wraps children alongside existing providers.
- **GridActionsContext.js**: Removed `computedValues`, undo/redo, mobile state from defaults.
- **Grid.jsx**: Split context consumption — stable values from GridActionsContext, live values from GridLiveContext.
- **docs/pills/ExprPillNode.jsx**: Migrated `computedValues` read from GridActionsContext → GridLiveContext (was broken — reading empty default).
- **docs/hooks/useDocFieldValues.js**: Same migration for both `useDocFieldValues()` and `useFieldValue()` hooks.
- **Impact**: When `computedValues` changes (every operation run), only Instance.jsx + FieldRenderer.jsx + doc pills re-render — not all 200+ context consumers.

## Recent Changes (Mar 19 2026 — Mobile Drag + UI Fixes)
- **dragSystem.js**: Fixed 3 mobile touch issues: (1) Removed `e.preventDefault()` from `onStart` — native click/pointer events now fire for taps (fixes RadialMenu/Popover). (2) Cache `getBoundingClientRect()` at touchstart (fixes clone stuck at top-left). (3) Only `preventDefault` in `onMove` after threshold. Removed synthetic click dispatch. Removed `touchStartTime`.
- **Panel.jsx, Container.jsx, Instance.jsx**: `.module-handle` + `.module-dot` replaced with `.module-drag-handle` + `.drag-handle-stem` + `.drag-handle-ball` (knob-on-stem). All RadialMenu `forceDirection` set to `"down"`.
- **App.jsx**: Removed `cc-drawer-handle` div (Terminal button in Toolbar already toggles CC).
- **MobileGridNav.jsx**: `LipButton` replaced with `RailButton` — full-height/width edge rails, inset 4px from screen edges (avoids Samsung back-gesture zone).
- **index.css**: (1) `.module-handle`/`.module-dot` → `.module-drag-handle`/`.drag-handle-stem`/`.drag-handle-ball` with updated hover selectors. (2) `.cc-drawer-handle` removed. (3) `.mobile-lip-btn` replaced with `.mobile-rail-btn` (full-length, fixed, inset from edges). (4) Cog handle now shows stem+ball at rest, radial on hover.

## Recent Changes (Mar 18 2026 — Mobile UX Fixes v4)
- **Panel.jsx**: Stack cycler button added INSIDE panel header, left of QuickAddMenu (+). Uses `dragCtx.getStackForPanel(module)` for count. Only renders when `stack.length > 1`. Added `Layers` import. Added `forceDirection="right"` to panel RadialMenu. Label span gets `minWidth: 0` for proper truncation.
- **Grid.jsx**: StackOverlay component REMOVED entirely. GridCell empty pocket now shows `.panel-stack-btn-inline` button (same style as panel header button) with `isEmpty: true` for correct cycling. Button positioned top-right of pocket (`justifyContent: flex-end`).
- **DragProvider.jsx**: `cyclePanelStack` speed fix — `emit: idx === stack.length - 1` (only emits on last panel, cutting N socket calls to 1).
- **index.css**: Replaced `.panel-stack-btn` (absolute positioned overlay) with `.panel-stack-btn-inline` (inline flex button, 20px height, used in both panel header and empty cell pocket).

## Recent Changes (Mar 18 2026 — Mobile UX Fixes v3)
- **RadialMenu.jsx**: `calcOpenDirection` now ALWAYS returns 'right' (handles are on left wall). Default direction state changed from 'left' to 'right'. Removed viewport clamping code (was squishing items). Spread stays at 45°. Removed "Add" button from default menu items.
- **DragProvider.jsx**: 3-layer Android split-screen prevention: `dragover`/`dragenter` + `touchmove` (all `passive:false`). `cyclePanelStack` now accepts `isEmpty` flag for proper empty-slot cycling.

## Recent Changes (Mar 18 2026 — Mobile UX Fixes v2)
- **Grid.jsx**: StackOverlay extracted as separate component rendered AFTER panels in CSS grid (z-index: 80, pointer-events: none wrapper, pointer-events: auto on buttons). Removed z-index: 65 from GridCell (was blocking all panel interaction). GridRadialMenu conditionally hidden on mobile (`{!isMobile && <GridRadialMenu>}`).
- **index.css**: Removed `.module-handle .module-dot { display: none !important; }` from mobile media query — was breaking drag handles. Down lip button CSS retained (safe-area offset + 24px height).
- **DragProvider.jsx**: `touch-action: none` on `document.documentElement` during drags (mobile only) to prevent Android split-screen interception.
- **RadialMenu.jsx**: Arc item viewport clamping (per-item position clamped to viewport bounds). Spread capped to prevent 360-degree wraparound.
- **E2E tests**: `tests/e2e/mobile-fixes.spec.js` — verifies no z-index blocking, drag handles visible, GridRadialMenu hidden on mobile, stack overlay z-index/pointer-events, down lip button.

## Recent Changes (Mar 18 2026 — Mobile UX Refinements)
- **MobileGridNav.jsx**: Removed swipe-to-navigate (swipe now scrolls cell content). Navigation is now lip buttons + minigridmap + drag-to-edge only. Lip button icons shrunk from `size={14}` to `size={10}`.
- **ModuleInstance.jsx**: Changed `touchAction: "none"` → `touchAction: "manipulation"` on `.instance-wrap` — allows normal scrolling through instance elements.
- **index.css**: Lip buttons shrunk from 28x72px to 16x40px. Added `.panel-stack-overlay` CSS (absolute bottom-right, two small prev/next arrows). Removed mobile rules that hid radial menus. Removed duplicate `.panel-scroll` bottom padding, bumped `.panel-content` to 48px. Added `.mobile-lip-btn-down` safe-area offset + bigger tap target. Added `.mobile-grid-viewport` safe-area padding.
- **Panel.jsx**: Panel cog handle removed entirely — right-click context menu has "Show/Hide header" option instead. `onContextMenu` added to panel shell div. ResizeHandle now in a flex bottom bar (inline flow, not overlayed).
- **ResizeHandle.jsx**: Changed from `position: absolute` to inline flow (`flexShrink: 0`, `marginLeft: auto`). No longer overlays panel content.
- **Panel.jsx**: Removed stack nav from header (moved to Grid overlay). Removed `showStackHint` state + useEffect.
- **App.jsx**: CC drawer handle height same on mobile/desktop (14px, was 24px on mobile). Grid-frame `onTouchStart` — swipe up (dy < -30) closes CC when open.

## Recent Changes (Mar 13-14 2026 — Filter System Cleanup)
- **App.jsx**: Removed all old iteration state/handlers (selectedIterationId, currentIterationValue, iterations, categoryDimensions, etc.). Added `handleSelectFilter` + `handleFilterValueChange` to actionsValue.
- **Toolbar.jsx**: Added `useEffect` for `Ctrl+[` / `Ctrl+]` — cycles through `grid.namedFilters` by index. Skips when focus is in input/textarea/contentEditable. Removed dead `selectedDim`/`categoryValueOpts` lines.
- **GridLayoutForm.jsx**: Rewrote — removed entire Iterations section. Now only: Grid Name + Rows/Cols + Delete + Day Page Template picker.
- **ui/Editor.jsx**: `doc-editor-wrapper` onClick calls `editor.commands.focus("end")` when clicking empty space below content (D8 — click & type anywhere).

## Recent Changes (Mar 2026 — U1 Undo Animations)
- **App.jsx**: Added `useAnimations` import. `captureAllPositions()` called before `_undo()` via wrapped `undo` function. `onUndoAnimation` callback passed to `useUndoRedo` → calls `animateToNewPositions + flashElement` after 100ms (waits for sync_state re-render). Duplicate Grid.jsx `undo_result` listener removed.
- **Grid.jsx**: Removed `useAnimations` import + `socket.on("undo_result")` duplicate handler. Now a comment: "Animation hook moved to App.jsx".

## Recent Changes (Mar 14 2026 — F5 + D8)
- **Toolbar.jsx**: Added `useEffect` for `Ctrl+[` / `Ctrl+]` keyboard shortcut — cycles through `grid.namedFilters` by index, calls `onSelectFilter`. Skips when focus is in an input/textarea/contentEditable. Dependency on `grid.namedFilters`, `grid.activeFilterId`, `onSelectFilter`.
- **ui/Editor.jsx**: `doc-editor-wrapper` div now has `onClick` handler — when `e.target === e.currentTarget` (clicked empty space below content) and editor is editable, calls `editor.commands.focus("end")`. Enables clicking anywhere in the doc area to position cursor.

## Recent Changes (Mar 2026 — Toolbar + Font + EntityTree)
- **Toolbar.jsx**: Removed `ButtonPopover` + separate `toolbarRadialItems` RadialMenu. Settings cog is now a `RadialMenu` handle with 5 items: Grid Settings, Add Panel, Undo, History, Redo. Grid Settings item opens a floating `<div>` with `GridLayoutForm` (absolute positioned, outside-click to close via `useEffect`). Removed right-side PlusSquare RadialMenu. Removed `ButtonPopover` import.
- **index.css**: `body` font-family changed from `system-ui, -apple-system...` to `var(--font-mono)` (JetBrains Mono, matches site name).
- **CommandCenter.jsx**: Added `DraggableEntityRow` component (before `EntityTreeTab`). Panels and containers in EntityTreeTab now use `DraggableEntityRow` — when collapsed: renders as draggable pill (same style as `DraggableInstanceRow`), when open: renders as tree header. Collapsed panels/containers are draggable via Pragmatic DnD (type: "module", role: "panel"|"container", sourceType: "command-center"). DragProvider already handles all three roles.

## Recent Changes (Mar 2026 — CSS Organization + data-testid)
- **App.jsx**: Added `data-testid="app-root"` to grid-frame root div (line 788).
- **Toolbar.jsx**: Added `data-testid="toolbar"` to toolbar wrapper div (line 121).
- **Module.jsx**: Added `data-testid="panel-shell"`, `"container-shell"`, `"instance-wrap"`. Replaced 10 drop indicator inline styles with CSS classes (`drop-indicator drop-indicator-top/bottom/left/right`, inst variants, `drop-indicator-insert`). Replaced `module-handle` grab zones with `module-grab-zone`. Replaced empty placeholders with `empty-placeholder` / `empty-placeholder-inline`. Replaced linked-copy badge style with `linked-copy-badge`.
- **index.css**: Fully reorganized into 14 numbered sections. Dead `App.css` deleted. New classes: `drop-indicator` series, `module-header-row`, `module-grab-zone`, `empty-placeholder`, `empty-placeholder-inline`, `linked-copy-badge`, `flex-center`, `flex-center-gap`, `abs-fill`, `scroll-y`, `truncate-text`.

## Recent Changes (Mar 17 2026 — Instance Collapse/Expand + Doc Anchor Fix)
- **Instance.jsx**: Added `isExpanded` (default `true`) + `onToggleExpand` (default `null`) props. ChevronRight/ChevronDown before label when collapsible. Fields + ops wrapped with `(isExpanded || !onToggleExpand)`. Collapsed shows `···` placeholder; fields area click-to-expand.
- **ModuleInstance.jsx**: Added `isDocContainer = false` prop + `isExpanded` state (default `false`). Doc container instances always expanded (no toggle). List instances start collapsed, click chevron or `···` to reveal fields.
- **Container.jsx**: Added `occurrenceOverride` prop → `containerOccurrence` uses it directly when provided. Passes `isDocContainer` to `ModuleInstance`.
- **ModuleEmbedNode.jsx**: Passes `occurrenceOverride={occurrence}` to `<Container>` so embedded containers use their specific occurrence (not first-found by targetId).
- **ManifestTree.jsx**: Fixed anchor chip `parentOccId` propagation bug. Nested anchors were passing `parentOccId={occ.id}` (wrong — container occ) to children. Now passes `parentOccId={parentOccId}` (root doc occ) at all depths. Fixes "opens as new thing" — clicking nested anchor now scrolls to embedded container in parent doc instead of switching active doc.

## Recent Changes (Mar 13 2026 — Filter System Cleanup)
- **App.jsx**: Removed all old iteration state/handlers (`selectedIterationId`, `currentIterationValue`, `iterations`, `categoryDimensions`, `selectedCategoryId`, `currentCategoryValue`, `handleCommitIterations`, `handleSelectIteration`, `handleIterationValueChange`, `handleSelectCategory`, `handleCategoryValueChange`, `handleCommitCategoryDimensions`) from `dataValue` and `actionsValue` useMemos and their dependency arrays. Added `handleSelectFilter` + `handleFilterValueChange` to `actionsValue`.
- **Toolbar.jsx**: Removed dead `selectedDim`/`categoryValueOpts` lines (referenced old `categoryDimensions` prop). Removed `onCommitIterations` prop passed to `GridLayoutForm`.
- **GridLayoutForm.jsx**: Rewrote — removed entire Iterations section (old UI). Now only shows Grid Name + Rows/Cols + Delete. No more iteration CRUD.

## Recent Changes (Mar 12 2026 — E2E State Exposure)
- **App.jsx**: Added `window.__moduli_state__ = state` (inline after stateRef.current update). Exposes Redux state to Playwright E2E tests for data verification. Does NOT affect production behavior — only sets a window property.

## Recent Changes (Mar 2026 — CommandCenter Auto-Collapse on Drag)
- **App.jsx**: Added `monitorForElements` (Pragmatic DnD) at app level — `onDragStart` sets `commandCenterOpen(false)`. CC auto-collapses when any drag starts, revealing the grid as drop target.
- **App.jsx**: Added `commandCenterEverOpened` flag. CommandCenter stays mounted once opened (`{commandCenterEverOpened && <CC>}` instead of `{commandCenterOpen && ...}`). This enables the slide-up animation on close because CC stays in DOM with `maxHeight` transition.

## Recent Changes (Feb 22 Session 3 — Toolbar redesign + loading fix)
- **Toolbar.jsx**: Complete redesign. Left: Logo+gear+GridSelect+inline[+]. Center: IterationNav+CategoryFilter. Right: Pomodoro+Terminal+RadialMenu(AddPanel/Undo/History/Redo). Removed separate +Panel, +Grid, Undo/History/Redo buttons. Uses `RadialMenu` with `items` prop + `forceDirection="down"`.
- **App.jsx**: Loading state redesigned — logo+spinner inside the bordered grid-frame box (no more absolute SpinnerOverlay). DrawerHandle redesigned to pill-style (36px horizontal pill, blue when CC open). Removed ChevronDown import.
- **DocEditor.jsx**: TDZ fix applied — `handleContextMenu` moved to AFTER `const editor = useEditor(...)` (line 218).

## Recent Changes (Feb 22 Late — Bug Fixes)
- Module.jsx: Removed `display: "flex"` from inline styles on module-handle divs (panel + container). CSS now controls display fully.
- index.css: Changed `.module-handle` from `opacity: 0` to `display: none`; hover shows `display: flex`. No layout space when hidden.
- ui/RadialMenu.jsx: Changed `action?.()` → `action?.(e)` in `handleAction`. Event is now passed to onAddChild/onSettings/onToggleDragMode so they can use getBoundingClientRect() for positioning.

## Recent Changes (Feb 22 — Operations Pipeline)
- App.jsx: Added stateRef (useRef), passed to bindSocketToStore as 3rd arg
- App.jsx: computedValues exposed in GridActionsContext.Provider value
- GridActionsContext.js: computedValues: Object.create(null) added to context defaults
- FieldRenderer.jsx: Rewritten to use inputEnabled/displayEnabled + reads computedValues from context
- FieldDisplay.jsx: Updated displayValue to handle new displayEnabled schema + displayConfig target support
- FieldPillDisplay.jsx: Updated to accept `value` prop (executor-computed) + displayConfig target support
