# Moduli

**A modular, event-driven workspace for habit tracking, scheduling, and data visualization.**

---

## Test checklist — 2026-05-20

Re-seed live data first: `node --env-file=.env server/scripts/createLiveData.js`.
Test results last refresh: **37 files / 731 tests passing** (see `test-results.txt`).

### Multi-day Schedule (carryover from earlier this session)
- [ ] Single-day view renders byte-identical to the pre-refactor single-day Schedule
- [ ] Pick a 3-day range in the date picker → 3 day-columns appear, shared slot containers multi-parented into each
- [ ] Pick week / month / year via picker → format flips between `timeslot` (≤7 days, columns side-by-side) and `shortened` (>7 days, wrapped grid)
- [ ] Drag a task into one day's column → task appears only in that day, slot persists
- [ ] Switch back to single-day → no data loss; instances still on their original dates
- [ ] Tracker totals aggregate across the active period (`$activePeriodDates` / `$activePeriodCount`)

### Editor↔field bindings (BoundHeader / BoundBody)
- [ ] Container header bound to a select field with options → dropdown renders inline; pick value → fires write + propagates via link field
- [ ] Textblock body bound to a text field → typing in editor debounce-commits + syncs siblings
- [ ] Link badge in top-right of bound editor shows the bound field name; tooltip reads `Linked: <field name>`
- [ ] Daily Question container in day-page template → click 🎲 dice → random question loads; answer textblock writes back to today's instance

### Multi-select + paste (shipped this session)
- [ ] Shift+click an instance → selection chip overlay highlights it
- [ ] Shift+click more instances → count grows; right-click any selected one shows bulk items at top
- [ ] Choose "Copy N selected" → right-click target container → "Paste N here" mints fresh occurrences with same moduleId
- [ ] Choose "Move N selected" → right-click target → "Move N here" re-parents (no fresh occurrences; originals move)
- [ ] Choose "Copy-link N selected" → right-click target → "Paste linked N here" mints fresh occurrences sharing `linkedGroupId`; toggling a field in one ticks the others
- [ ] Paste-here also surfaces on a page right-click (destination is the page occurrence)
- [ ] Self-paste (target = source) is silently skipped

### Canvas connect tool (shipped this session)
- [ ] Open any canvas page → toolbar shows new chain-link icon between Hand and Pen
- [ ] Click connect → cursor switches to crosshair
- [ ] Press on card A, drag a dashed bezier, release on card B → solid bezier persists
- [ ] Reload → connection still there (persisted to `pageOccurrence.meta.edges`)
- [ ] Move either card → bezier follows
- [ ] In connect mode, click on an edge → deletes it
- [ ] Switching to any other tool → edges still render but become click-through (no accidental deletion)
- [ ] Drawing tools, drop targets, world pan, mobile toolbar, autoscroll still all work in their respective modes
- [ ] **Undo (Undo button)** undoes both edge additions AND edge deletions (mixed with strokes — most recent action regardless of type)
- [ ] **Redo** replays the undone action

### Multi-select deep-paste (added in review fixups)
- [ ] Shift-select a CONTAINER with children → Copy → paste into another container → new container appears with copies of all its children (not an empty shell)
- [ ] Pasted children preserve fields + iteration mode from source
- [ ] Move-mode on a container still re-parents the existing container (children come along because they're parented to it)

### Socket status pill (shipped this session)
- [ ] Throttle Network → Offline in DevTools → red pulsing pill appears right of logo: "Disconnected — retrying (N)" with N incrementing
- [ ] Hover the pill → tooltip explains writes are buffered locally
- [ ] Edit a field / drag a card while offline → no error toasts, no UI freeze
- [ ] Throttle back to Online → green "Reconnected" pill for ~3s → fades to nothing
- [ ] Buffered changes have synced server-side after the pill fades

---

## Handoff — Session 2026-05-20 → Next session

Multi-day Schedule shipped (hybrid architecture: shared slots persist under Schedule, day-col wrappers come/go via multi-parent — zero data loss). New picker (react-multi-date-picker) supports single/range/multi/week/month/year. `$activePeriodDates` + `$activePeriodCount` available in op pipelines. Container-in-container primitive via `module.meta.allowChildContainers`. Test grid byte-identical to before (uses original `makeScheduleBuildDayOp`); live data uses new `makeScheduleBuildScheduleOp`. **Re-seed live data required to test:** `node --env-file=.env scripts/createLiveData.js`.

### Testing feedback fixes (in progress this session)

User tested the multi-day Schedule and reported:
- ✅ Hourly chime disabled (was firing every second — `lastFiredAt` sync race; see `state/useScheduler.js` debug TODO).
- ✅ **Build Schedule perf (d)** — Phase 4 was `LOOP $allContainers` PER day. Refactored to Phase 4a (one-time slot ID collection via PUSH_TO_VAR) + Phase 4b (per-day ADD_CHILD from precomputed list). Cuts from O(days × containers) to O(containers + days × slots).
- ✅ **(a) Multi-day rendering polish** — `client/src/modules/pages/PageBoard.jsx` now detects `meta.scheduleDayColumn` children and (1) hides `meta.scheduleSlot` / `meta.scheduleDueContainer` from page-level render (they're multi-parented into day-cols), (2) switches to horizontal `flex-direction: row` with 280-360px min/max width per column when ≥2 day-cols exist. Single day-col still renders vertically (looks like the original single-day Schedule).
- 🟡 **(b) Goals restructure — Stage 1 done, Stage 2 pending.**
  - **Stage 1 (done):** `makeTrackerOp` in `server/utils/liveSystemBuilders.js` accepts a new `goalOccurrenceId` param. When provided, the goal-lookup step replaces FIND-by-label with `INIT_VAR $goalId = literal:<id>` + `FIND $allItems where id IS $goalId → $goalItem`. Back-compat: legacy `goalLabel`-only callers still work (test grid + currently-unique-label goals in createLiveData).
  - **Stage 2 (pending — user direction needed):** User said "i dont like label compare", "use the category picker to pick a specific occurrence", "i just dont want to write out the id in the operation", "we have grab direct ref" — the seed should use whatever the UI's CategoryPathPicker outputs for an occurrence pick, NOT a literal id baked into the op. CategoryPathPicker outputs are dotted paths like `$<var>.<path>` resolved via `resolveExpr`. For occurrences, no id-indexed map exists in the executor today — there's `$allItems` (array), `$allInstances`, etc. but no `$allItemsById`. Two paths forward:
    - (a) **Add `$allItemsById` to executor** — plain object `{ [id]: item }` exposed in $vars. Reference syntax `$allItemsById.<id>`. Picker emits that path. Tracker's $goalItem = `$allItemsById.<id>` via INIT_VAR with expr. Note: UUIDs contain `-` which probably trips dot-notation path resolver — may need `["<id>"]` bracket-notation support or use a hash-friendly id format.
    - (b) **Deterministic IDs** for seed-stable occurrences (goal items, schedule slots) — generate via hash of stable key like `goalOcc("physical-water")` instead of random `uid()`. Op embeds the deterministic id as literal; survives re-seed because same key → same id. More invasive but eliminates the resolver question.
  - Recommendation: (a) is the smaller change. Implement `$allItemsById` in `operationExecutor.js:1172` area, verify path resolver handles UUIDs (probably needs bracket notation: `$allItemsById["abc-123-def"]`). Then Stage 3: actually split the multi-field goalInstances entries + update tracker call sites in createLiveData.
  - **Why deferred this session:** This needs careful integration with the picker UI's existing output format. Picking the wrong reference shape means an executor change AND a picker change later. Best done in a focused session that touches `CategoryPathPicker.jsx`, `operationExecutor.js`, `liveSystemBuilders.js`, and `createLiveData.js` together.
- ⏳ **(c) Picker redesign** — user wants calendar-style with zoom drilldown (month grid → year grid). Current `react-multi-date-picker` UX doesn't match. See memory `project-pending-features` for options.

Other already-queued items below (folder-page defaults, Pomodoro, GET_USER_INPUT, multi-select, mindmap) remain valid.

### Next steps (in order)

1. **User re-seeds + verifies multi-day Schedule end-to-end** — open Schedule, try single-day (should look exactly like before), then pick a 3-day range / week. Day-cols should appear; instances persist across view changes; trackers aggregate over the period.
2. **D1(a) op rename** — strip "Tracker:" prefix from local createLiveData ops (now redundant with `opCategoryIds.trackers` folder). About 27 ops. Update `waterTrackerName` + `completedTrackerName` params passed to `makeScheduleBuildScheduleOp`. Test grid untouched.
3. **Folder-page defaults for Daily Toolkit + Center Hub panels** — see memory `project-pending-features`. Set the panels' default view to a folder-page (card grid of child pages) instead of a single tab. ~30 lines per panel in createLiveData.
4. **Pomodoro → Schedule** — see memory `project-pending-features`. Pomodoro template instance in Daily Toolkit, Pomodoro goal (3/day), trackers (current pomo + time + history), 3 ops (Start / Complete / Stop) firing from PomodoroTimer.jsx.
5. **Month view page** — see memory `project-pending-features`. Separate page kind with 30 day-containers, no slots. Own `Build Month` op constrained to month-unit filter. Bidirectional with Schedule (drag-into-month creates task w/ null timeslot, picks slot later via select).
6. **GET_USER_INPUT op action** — see memory `project-pending-features`. General-purpose action that opens a modal asking the user for input; chained THENs ask follow-up questions; each step's result lands in `$vars` for downstream steps.
7. **Multi-select system** — see memory `project-multiselect-plan`. Shift+click, shift+arrow tree-walking, rubber-band drag, ContextMenu with copy/move/edit/copylink, paste-here on empty space, radial menu mode icon. Multi-session implementation.
8. ~~**Canvas mindmap (React Flow)**~~ — **DONE 2026-05-20** as a tool added to the existing canvas (not a new page kind, no React Flow). New `connect` tool in `CanvasContent.jsx` lets the user drag from one card to another to draw a bezier edge. Edges persist on `containerOccurrence.meta.edges = [{ id, from, to }]`. SVG overlay sized to the world (4000×4000); clicking an edge in connect mode deletes it. Plays clean with every existing canvas feature (drawing tools, drop targets, world pan, autoscroll, mobile toolbar, filters). `@xyflow/react` removed from package.json. See memory `project-canvas-mindmap-plan` (now slightly out of date — edges live on the page occurrence the same way, but no separate kind exists).
9. ~~**Socket connection status indicator in grid header**~~ — **DONE 2026-05-20**. `hooks/useSocketStatus.js` subscribes to `connect` / `disconnect` / `connect_error` / `reconnect_attempt` and returns `{ status: "connected" | "disconnected" | "recovered", attempts }`. `ui/SocketStatusBanner.jsx` renders an inline pill in the toolbar (right of the logo) — red w/ pulsing dot + "Disconnected — retrying (N)" while down, green + "Reconnected" briefly when restored, nothing when normal. Tooltip on the red pill spells out that writes are buffered (offline queue already handles the buffering — this is just visibility). Pulse keyframe `socket-status-pulse` added to `index.css`. Tied through socket lifecycle events; queue replay continues to happen elsewhere (App.jsx-level on full_state).
9.5. **Offline-queue-aware "Reconnected" fade** — the green pill currently fades after a fixed 3s regardless of whether buffered writes have been server-acknowledged. `flushOfflineQueue` empties the local queue synchronously on reconnect, but the server-roundtrip ack is unknown. Tighten by: (a) capturing pre-flush queue length, (b) listening for the next N entity-updated events from the server, (c) holding the pill until those land or a 10s upper cap fires. Cosmetic — the existing 3s works for typical session lengths.

10. **Assistant LLM chatbox (last item)** — design + spec out an in-app assistant that can perform real actions through a conversational chatbox: create operations (full pipeline w/ trigger + steps), create occurrences/modules/containers/pages, attach fields, navigate filters, save templates, run ops on demand, explain why an op didn't fire, etc. **Read `docs/aispecs.md` first** — the user has a written-out spec there covering the offline LLM stack (Ollama + qwen2.5-coder / deepseek-coder), tool router pattern, sandboxed command executor, OCR layer, and a "frog Jeeves" persona. The plan should incorporate (or supersede) that doc, not duplicate it. The API layer should be a first-class part of the plan — likely a thin Express/route layer on the server that the local LLM (or a hosted Anthropic SDK fallback) calls through, with each tool mapping to a CommitHelpers function or operation-action effect (CREATE, UPDATE, APPLY_TEMPLATE, RUN_OPERATION, etc.). Probably a side-drawer or floating panel that wraps the tool-use loop. Will need: (a) a curated tool catalog with JSON schemas mirroring our pipeline action shapes, (b) state snapshotting so the LLM sees the current grid/modules/fields/operations, (c) confirmation UX before destructive actions, (d) prompt caching against the static system prompt + tool catalog. This is the BIG ticket — full plan to be drafted at the end of the queue.

---

## Handoff — Session 2026-05-11 (late) → Next session

This session was a long thread of drag-and-drop work (mostly textblocks + canvas) plus the original punch-list below. Pick up here.

### ✅ Landed this session

- **InstanceForm popover crash** — `client/src/ui/InstanceForm.jsx` was missing the `Plus` lucide import; the popover blew up on open. Added the import.
- **Hidden Date / Time Slot bindings preserved through CREATE ops** — `client/src/helpers/operationActions.js` `buildBindings` no longer un-hides an existing `hidden: true` binding unless `cfg.fieldHidden[fid]` explicitly says to. The test-grid Schedule ops in `server/scripts/createTestGrid.js` (Build Day Due CREATE, slot CREATE, todo sweep CREATE, Seed Daily Routine CREATE) now pass `fieldHidden: { [dateFieldId]: true, [timeslotFieldId]: true }`.
- **Due field on swept todos** — sweep CREATE now stamps both `[dateFieldId]: "$schedDate"` and `[dueFieldId]: "$schedDate"`. (Original handoff todo #4.)
- **Canvas page filter** — added `filterOverride: {}` on the canvas test page occurrence so canvas notes don't get hidden by the daily date filter.
- **Canvas-to-Schedule date stamp** — `client/src/helpers/dropHandlers.js` `handleOccurrenceMove` canvas-source branch now calls `stampPageFilterFields` before `fireMoveTrigger` so trackers' `SAME_DAY $goalDate` matches dragged-in canvas notes.
- **Canvas toolbar features** — `client/src/modules/CanvasContent.jsx` gains a straight-line tool, an undo/redo pair (`redoStack` state + Undo2/Redo2 buttons; new strokes cut redo branch), and a `ChevronUp` hide button that collapses to a small `Pencil Tools` show-pill at top-right.
- **Toolbar toast offset** — `<Toaster position="top-center" offset={4} />` in `App.jsx`.
- **QuickAddMenu category filter** — `ALLOWED_KINDS_BY_ROLE` map in `client/src/ui/QuickAddMenu.jsx` hides irrelevant kinds (e.g. doc/board no longer appear under a list-container add menu). "New X" / "New Textblock" buttons restyled as tile cards matching the category tiles.
- **`ContainerKindSelector` vocabulary** — canonicalized to `list / doc / board / canvas` (was `list / doc / log / smart`).
- **`DropAccepts.GRID_CELL` accepts INSTANCE** — and `handleOccurrenceMove` in `dropHandlers.js` got a new GRID_CELL branch so instances/textblocks dragged from a container can be dropped onto an empty grid cell (creates a new panel + container at `{row, col}`).
- **`handleContainerDrop`** — added two new branches: **canvas as destination** (stamps `meta.x/y` from pointer, re-parents to the canvas page; container's `kind` is preserved) and **canvas as source** (strips canvas-only `meta.x/y` and re-parents into the board panel/page).
- **`handleDocEmbedDrop`** — extended to also handle canvas-page and grid-cell destinations (was list-container only). Each destination has both move + copy branches that operate on the existing occurrence (`textmap` + `fields` preserved); copy mode mints a new occurrence with the same content.
- **Textblock drag-out wired** — `client/src/docs/pills/InstanceTextblockNode.jsx` now:
  - registers `deleteNode` with `embedDeleteRegistry`
  - wires Pragmatic DnD `draggable({ element, dragHandle })` with payload `{ type: "module", sourceType: "doc-embed", role: "textblock", id, occurrenceId, context: { occurrenceId, sourceType: "doc-embed" }, ... }`
  - exposes `dragMode` + `onToggleDragMode` on the RadialMenu (Move↔Copy toggle now usable; reads/writes `occurrence.dragMode`)
- **Textblock role unification** — `client/src/modules/DocContent.jsx` `handleAutoCreateTextblock` now mints `role: "textblock"` (was `role: "instance"`). All textblocks (typed-in OR QuickAddMenu-created) share one shape.
- **Editor.jsx textblock-aware drop branch** — when `payload.role === "textblock"`, inserts an `instanceTextblock` TipTap node (instead of falling through to `moduleEmbed`, which was rendering as an empty ModuleInstance row — the "empty module everywhere" bug).
- **Atomic same-doc node moves** — new module-scope helper `tryMoveEmbedNodeInDoc(editor, nodeTypeName, match, insertPos)` in `Editor.jsx`. Scans the editor's doc for a matching node, then does `tr.delete(from, to)` + `tr.insert(adjustedPos, sameNodeObject)` in **one** transaction (position-adjusted, with a self-drop guard inside the source range). Used by all three same-doc move branches (instance, textblock, container/artifact/module). Was: two separate transactions with no position adjustment → off-by-`nodeSize` placement on downward drops + visual flicker / NodeView remount.
- **`.textblock-card` CSS matches `.instance-textblock-block`** — same teal tint, radius, inner ProseMirror padding. Textblocks created by the QuickAddMenu look the same as typed-in ones.

### ⚠️ Still broken / needs verification

1. ✅ **Auto-create textblock by typing is finicky** — RESOLVED 2026-05-12. Editor.jsx `onUpdate` now runs a merge pre-pass that absorbs any paragraph positioned immediately after an `instanceTextblock` into that textblock's occurrence textmap (single `skipAutoCreate` tr, cancels any pending auto-create timer). DocContent's `tryFocus` rAF cap raised 10 → 60. See "Carryover Open Todos" entry below for the full notes.

2. ✅ **List container becomes doc-looking when dropped on canvas** — RESOLVED 2026-05-12. `client/src/modules/pages/PageCanvas.jsx` `renderCard` now passes `embedded={mod.kind === "doc"}` instead of unconditional `embedded`. Doc containers keep the teal "embedded card" treatment on canvas; list/board/canvas-kind containers render with their normal panel chrome.

3. ✅ **Self-drop highlighting on dragged textblock** — RESOLVED 2026-05-12. `client/src/ui/Editor.jsx` `dropTargetForElements.canDrop` now rejects drops whose `source.context.occurrenceId === occurrence.id` (this editor's wrapping occurrence). Dragging a textblock OUT of its own sub-editor no longer lights up that sub-editor's drop highlight. The drop into the source range was already a silent no-op via `tryMoveEmbedNodeInDoc`'s self-guard — this hides the visible half. `useEffect` dep array gained `occurrence?.id` so the canDrop closure re-registers when the wrapping occurrence changes.

4. **Container dragged out of canvas back to board** — partially fixed via `handleContainerDrop`'s canvas-source branch this session, but needs end-to-end testing now that other paths have shifted. Verify that meta.x/y is stripped and the container lands in the destination panel/page's `occurrences[]` cleanly.

5. **Cross-doc / from-CC textblock paste**
   - Same-doc move is atomic now. Cross-doc and CC-sourced drops still go through `embedDeleteRegistry` + `insertAtPos` (necessarily — different editors don't share node objects). Verify the new `instanceTextblock` node lands with the same occurrence and textmap intact when source is in a different doc.

6. **Verify drag-mode toggle persists** — `InstanceTextblockNode`'s radial menu Move↔Copy toggle writes `occurrence.dragMode` via `CommitHelpers.updateOccurrence`. Spot-check that the next render of the same textblock reads the new mode.

---

## Carryover Open Todos (from prior 2026-05-11 session)

The previous session worked through a longer punch-list and got 5 of them done. The remaining 6 items below describe the bug, the suspected file(s), and the acceptance criteria — pick any and run.

### ✅ Drop-outside-target deletes instance — RESOLVED (2026-05-12)
- `client/src/ui/Editor.jsx` — three drop branches (instance/textblock/container) reordered: destination is inserted FIRST via the new boolean return from `insertAtPos`, then source detached (`embedDeleteRegistry.get(...)?.()` or parent-occurrence filter) only when insertion confirmed via `insertAtPos` returning `true`. Stale dead-code `insertAtPos(insertPos, ...)` after the early return in the container branch removed. Also tightened the `insertPos == null` guard to bail unconditionally (was scoped to `sourceType === "doc-embed"`, which let CC-sourced drops silently re-parent on a missed drop). Result: if the destination insertion silently fails for any reason (invalid pos, editor in bad state, missed-drop heuristic), the source remains in place — no orphaned occurrences.

### ✅ Auto-create textblock finickiness when typing fast — RESOLVED (2026-05-12)
- `client/src/ui/Editor.jsx` `onUpdate` auto-create — added a pre-pass that scans the doc for paragraphs positioned immediately after an `instanceTextblock` and merges them in (appends paragraph JSON onto the textblock's occurrence textmap, deletes the outer paragraph in a single `skipAutoCreate` tr, cancels any pending auto-create timer). Catches both the race (auto-create runs, focus has to round-trip into the sub-editor, the next keystroke lands in a fresh paragraph) and the Enter-exit-then-type case. No more paragraph-per-char while typing fast.
- `client/src/modules/DocContent.jsx` `tryFocus` rAF cap raised from 10 (~166 ms) to 60 (~1 s) so the focus eventually lands in the sub-editor even on slow renders. The merge pre-pass above is the safety net that catches whatever falls through.

### 1. ✅ Doc drop sometimes lands on the line *below* the targeted line — RESOLVED 2026-05-12
- `client/src/ui/Editor.jsx` `resolveInsertPos` block-bias logic now:
  - Adds a **left-edge heuristic** (before the midline math): if `clientX < blockDom.left + 10`, return `blockStart` unconditionally. Hover in the leading margin of a paragraph now reads as "insert above" regardless of vertical position within the line.
  - When the resolved line is on a DIFFERENT line than the cursor's y (the empty area to the left of a line can spill upward into the previous line's rect via posAtCoords), compares `clientY` to `lineCoords.top` / `lineCoords.bottom` before falling through to the midpoint, so the bias doesn't flip to "after" because of a wrong-line caret rect.

### 2. ✅ Dropping outside the blue highlighted area while moving an instance deletes the instance — see "Carryover Open Todos" entry above (RESOLVED 2026-05-12).

### 3. ✅ Local manifest tree node sizes are uneven — RESOLVED 2026-05-12
- Root cause was the chevron, not pill width. `FolderNode` / `PageTreeNode` / `LocalFolderGroup` always render a chevron placeholder (opacity 0 when inert) so their `NodePill` starts at a consistent `~14px` offset. `DocNode` file rows only rendered the chevron when `showAnchors && hasChildren`, which left anchor-less docs without that offset — their pill started at the row's left edge while sibling folder/page rows were indented 14px. Looked like folders were wider; actually the doc pills were just shifted left.
- Fix: `client/src/modules/ManifestTree.jsx` `DocNode` file row branch now always renders the chevron span with opacity / cursor / pointerEvents tied to `showAnchors && hasChildren`. Matches the pattern used by every other tree row component.

### 4. ✅ "Due" field shows "Due: date" — RESOLVED (2026-05-11 late session)
- Sweep CREATE in `server/scripts/createTestGrid.js` now stamps both `[dateFieldId]: "$schedDate"` and `[dueFieldId]: "$schedDate"`. Verify after re-seed.

### 5. ✅ Canvas Notes don't affect goal calculations — RESOLVED (2026-05-11 late session)
- `client/src/helpers/dropHandlers.js` `handleOccurrenceMove` canvas-source MOVE branch now calls `stampPageFilterFields` against the destination container before `fireMoveTrigger`. The dragged-in canvas note picks up the destination's effective date, so trackers' `SAME_DAY $goalDate` matches on completion. Verify by dragging a Canvas Note into a Schedule slot, toggling `Completed`, and confirming the goal totals tick.

### 6. ✅ Module-editor "Fields" tab should be a *picker*, not a creator/editor — RESOLVED (already in code; verified 2026-05-12)
- `InstanceForm.jsx` `FieldsSection` already uses `CategoryPathPicker` configured as a single-category "fields" picker for attach. `FieldBindingRow` is read-only on field name/type and only exposes hide-toggle (Eye/EyeOff) and unbind (X). No inline create/edit affordance exists.
- `ContainerForm.jsx` has no field CRUD UI — only the "Attached Fields" header/body picker for markdown containers, which uses existing fields via `fieldsById`.
- Field creation, renaming, type changes, and deletion live exclusively in `client/src/ui/commandCenter/FieldsTab.jsx`. Acceptance criteria met.

### 7. ✅ End-to-end audit of date-stamp behavior — RESOLVED (already in code; verified 2026-05-12)
- The acceptance criterion ("short doc or comment block describing when date is stamped/cleared and which op owns each transition") is satisfied by the **Date-stamp ownership map** comment block at the top of `client/src/helpers/dropHandlers.js` (lines 11-82, last updated 2026-05-11). It covers all 8 ownership paths:
  1. Drop into Schedule container → `computePageFilterFields` (pre-create stamp)
  2. Move into Schedule container → `stampPageFilterFields` (post-move stamp + bridge cache mirror)
  3. Move out of Schedule → `Schedule: Clear Date on Move-Out` op (onMove trigger)
  4. Drop into canvas page → meta.x/y only, never date
  5. Per-day creation → `Schedule: Seed Daily Routine` CREATE with `$schedDate` resolution chain (`$parentFilter.<dateFieldId>` → `$schedPage._effectiveFilter.<dateFieldId>` → `$trigger.date` → `$today`)
  6. Per-todo copy → `Schedule: Build Day` sweep CREATE with same chain
  7. `Schedule: Stamp Date & Time Slot` op — timeslot only (date intentionally not rewritten; drop side already pre-stamps)
  8. Auto-attach safety net in `bindSocketToStore.applyOperationEffect` so any field write also binds the field if the module's `fieldBindings` lacks it.
- Verified key op names exist in `server/scripts/createTestGrid.js` and predicate references (`fields.<dateFieldId>.value SAME_DAY $goalDate`) match the doc. No contradictions found — but actual runtime behavior still needs spot-checking after re-seed.

---

## Claude Session Directives (ALWAYS FOLLOW)

### Token Efficiency — Read Less, Do More
- **Check folder-level `CLAUDE.md` files FIRST** before re-reading source files. Every folder I've touched has a `CLAUDE.md` with a file map and recent changes summary. Use it.
- **Never re-read a file you already touched this session** unless the user explicitly changed it. Track what you've modified.
- **When you touch files in a folder**, update/create that folder's `CLAUDE.md` with the changes made, so future sessions don't re-read the source.
- Key folders with CLAUDE.md: `client/src/`, `client/src/ui/`, `client/src/helpers/`, `client/src/state/`, `server/`
- Memory files are at: `/home/joshpoms/.claude/projects/-home-joshpoms-dndtest2/memory/`

### Pragmatic Programmer Philosophy (ALWAYS APPLY)
- **DRY** — Don't Repeat Yourself. Every piece of knowledge has a single authoritative source. No duplicate logic.
- **Orthogonality** — Keep modules independent. A change in DragProvider shouldn't require changes in ContextMenu.
- **ETC (Easier to Change)** — Design for changeability. Prefer patterns that are easy to modify over ones that are prematurely clever.
- **Tracer Bullets** — Build end-to-end thin slices first, then fatten. Wire Panel → Context → Socket → Reducer before polishing UI.
- **Don't Live with Broken Windows** — Fix bad designs immediately. Don't patch on top of wrong abstractions.
- **The Boyscout Rule** — Leave code cleaner than you found it. Small improvements add up.
- **Contracts (interfaces)** — Each module has a clear public contract. CommitHelpers is the only layer that talks to socket. Components never call socket directly.
- **Power of Plain Text** — Data in plain, portable formats. No magic string formats that only one place understands.
- **Don't Outrun Your Headlights** — Implement one phase at a time. Don't spec Phase 9 while Phase 6 is incomplete.
- **Good Enough Software** — Ship working features before polishing. Don't let perfect block good.

### Session Rules
- Each time you touch files in a folder, update that folder's `CLAUDE.md`
- Start each session by reading `MEMORY.md` and relevant folder `CLAUDE.md` files — not source files
- At 80% context: stop new features, wrap up current task, update MEMORY.md
- At 90% context: only review/cleanup — no new work
- Always leave system in a testable state (`npm run dev` must work)

---

## How the Data Works

### Server (MongoDB via Mongoose)

There are two things stored in the DB for every piece of content: a **Module** and an **Occurrence**.

**Module** is the template — it defines what something is. It has a `role` (panel, container, instance) and a `kind` (list, doc, artifact, board). For file-backed content it also has a `fileRef` path (e.g. `notes/morenotes.md`). Modules don't store position, order, or any per-session state. They are reusable.

**Occurrence** is the placement — it's what actually appears on screen. Every occurrence points at a module via `targetId`. It stores:
- `fields: {}` — field values for this specific placement (e.g. how many reps you did *today* in *this context*)
- `textmap` — TipTap JSON for rich text containers/artifacts
- `parentId` — which parent occurrence or folder this lives inside
- `occurrences: [ids]` — ordered list of child occurrence IDs (this is how ordering works — NOT on the module)
- `viewId` — points to a View record (only when this occurrence needs rendering config)
- `iteration` — time filter + category filter + persistence mode

**View** is a separate record. Occurrences that need rendering config (e.g. a panel showing an artifact file tree) have a `viewId` that points here. View stores `viewType`, `hasTree`, `manifestId`, `activeOccurrenceId`, `layout`. Modules have no viewId — only occurrences do.

**Manifest + Folder** handle the file tree sidebar. A Manifest has a `rootFolderId`. Folders form a tree via `parentId`. Artifact occurrences place themselves in the tree by setting `parentId = folderId`.

**Field** records define what data an instance can collect (number, text, boolean, select, date, duration, rating). Fields are shared templates — instances bind to them via `fieldBindings`.

**Operation** records define automation pipelines. Each has a `pipeline: { sources, steps }` where steps are a top-down code flow: INIT_VAR → LOOP → IF → ADD_TO_VAR → SHOW_VALUE. No black-box aggregations — the math is explicit.

```
Grid
 └── occurrences: [panelOccId, ...]       grid owns the panel occurrence IDs

Panel Occurrence  (viewId → View or null)
 ├── targetId → Module [role: "panel"]
 └── occurrences: [containerOccId, ...]

Container Occurrence  (textmap if kind=doc/artifact)
 ├── targetId → Module [role: "container", kind: "list"|"doc"|"artifact"|"board"]
 └── occurrences: [instanceOccId, ...]

Instance Occurrence
 ├── targetId → Module [role: "instance"]
 └── fields: { fieldId: { value, flow } }

Artifact Panel → View { viewType:"artifact", hasTree:true, manifestId }
  Manifest → rootFolder → Folder children
    └── Artifact Occurrence (parentId = folderId)
         ├── targetId → Module [kind: "artifact", fileRef: "notes/x.md"]
         └── textmap: TipTap JSON  (synced to artifacts/notes/x.md on save)
```

### Client (React + Socket.io)

On connect the server sends `full_state` — a flat dump of all modules, occurrences, views, manifests, folders, fields, operations, computedValues for the user's grid. The client stores these in Redux-like state maps (`modulesById`, `occurrencesById`, `viewsById`, etc.).

**Rendering**: `Grid.jsx` reads the grid's occurrence list, renders a `modules/Panel` for each panel occurrence. Panel reads its child occurrence IDs, renders `modules/Container` for each. Container renders `modules/Instance` for each instance occurrence. If the panel occurrence has a viewId pointing to an artifact view, Panel renders `modules/View` which shows `ManifestTree` sidebar + `modules/Artifact` content.

**Mutations**: Everything goes through `CommitHelpers.js` — the only place that calls `socket.emit`. Components call CommitHelper functions, which dispatch to local state immediately (optimistic) and emit to server. Server persists and broadcasts to other windows.

**Operations**: Triggered by field changes, drops, or iteration changes. `bindSocketToStore.js` catches the trigger event, calls `executePipeline` in `operationExecutor.js`, which runs LOOP/IF/action steps and returns effects. Effects (SET_FIELD_VALUE, SHOW_VALUE, etc.) are applied via CommitHelpers. `computedValues` in state holds display field outputs keyed by `[occurrenceId][fieldId]`. `FieldRenderer` reads from computedValues when `field.displayEnabled`.

**Drag**: `DragProvider.jsx` handles all drag events. Copy = new occurrence with same targetId. Move = update occurrence.parentId + reorder parent.occurrences array. Doc container drop = insert pill at cursor position in TipTap editor.

### Field Values and Flow

Field values are stored as `{ value, flow }` where flow is `"in"`, `"out"`, or `"replace"`. Operations loop over occurrences and aggregate based on flow direction — `"out"` values are negated (expenses, time lost). This lets you have one `amount` field serve both income and expenses in the same operation.

### Module Kinds
| Kind | What it renders | Notes |
|------|----------------|-------|
| `list` | Drag-sortable instance list | Default |
| `doc` | TipTap rich text editor | Field pills, instance embeds |
| `board` | Containers as columns | Kanban-style |
| `artifact` | File content by viewType | Markdown / image / PDF / audio / video |

### Transactions (Audit Trail)

Every change produces a **Transaction** record. Transaction types:

- **MeasureOp** — a field value changed on an occurrence: who (instance), what (field + value), where (container context), when (timestamp)
- **OccurrenceListOp** — an occurrence moved from one container to another: captures source/destination and a field snapshot at the time of move
- **EntityOp** — a module was created, updated, or deleted
- **DocEditOp** — a doc container's textmap changed (TipTap steps)

Transactions have a `state` field: `"applied"`, `"undone"`, or `"redone"`. Undo/redo flips the state and re-applies or reverses the change. The full history is queryable — you can ask "what was the value of this field last Tuesday?" by replaying transactions up to a point.

### Iterations (Time + Category Filtering)

**Iterations** control what data each occurrence "belongs to". Every occurrence has an `iteration` object:

```
iteration: {
  timeFilter: "daily" | "weekly" | "monthly" | "yearly" | "all"
  timeValue:  Date   — specific date/week/month this occurrence is pinned to
  categoryKey: String  — e.g. "context" (optional)
  categoryValue: Mixed — e.g. "work" (optional)
  mode: "persistent" | "specific" | "untilDone"
}
```

**Modes:**
- `persistent` — shows in every iteration (e.g. a recurring habit)
- `specific` — only shows on a particular date/week
- `untilDone` — shows until its `completionFieldId` field goes truthy

**Grid.iterations** defines named iteration configurations (e.g. "Daily Work", "Weekly Personal"). Each has a `timeFilter` and optional `categoryKey`. The grid has a `selectedIterationId` and `currentIterationValue` (the active date/week/month). Panels, containers, and instances can each `inherit` the parent's iteration or set their `own`. This cascades: Grid → Panel → Container → Instance.

**IterationNav** (Toolbar) lets you advance the global time position (prev/next day, week, etc.). Panels with `mode: "own"` show their own local arrows independently.

### Templates

Modules are already templates — the same module can have many occurrences in different places. But there's also an explicit **Templates** feature:

- `grid.templates: [{ id, name, moduleIds, occurrenceIds }]` — saved workspace snapshots
- `save_template` socket event — captures a container (+ its instances) as a reusable template
- `fill_from_template` socket event — stamps a new set of occurrences from the template into a target container
- Templates let you define a "Morning Routine" layout once, then stamp it into any time slot on any day
- Drag a saved template from the Command Center into any container to fill it

---

## Implementation Roadmap

### Phase 1: Occurrences & Core DnD — 98% Complete

| Feature | Status |
|---------|--------|
| Occurrence-based architecture | ✅ Done |
| Pragmatic Drag and Drop integration | ✅ Done |
| Panel/Container/Instance hierarchy | ✅ Done |
| Grid-based cell placement | ✅ Done |
| Copy vs Move modes (per-entity) | ✅ Done |
| Session ref for sync drop handling | ✅ Done |
| RadialMenu with portal z-index | ✅ Done |
| Panel stacking and navigation | ✅ Done |
| Sorting within parents | ✅ Done |
| Drop indicators with edge detection | ✅ Done |
| Live preview during drag | ✅ Done |
| Auto-scroll during drag | ✅ Done |
| Cross-window copy (basic) | ✅ Done |
| Socket.io real-time sync | ✅ Done |
| External file/URL drops | ✅ Done |
| Touch/mobile drag support | ✅ Done |
| Resize touch support | ✅ Done |
| Multi-window sync | ⬜ Not started |

**Remaining (2%)**: Multi-window sync (optional enhancement).

---

### Phase 2: Fields & Calculations — 97% Complete

| Feature | Status |
|---------|--------|
| Field model (input/derived modes) | ✅ Done |
| Field types: number, text, boolean, select, date | ✅ Done |
| Field types: rating, duration | ✅ Done |
| Checkbox inputs (boolean variant) | ✅ Done |
| Toggle switch inputs | ✅ Done |
| Number inputs with increment/decrement | ✅ Done |
| Text inputs | ✅ Done |
| Select dropdowns | ✅ Done |
| Date inputs | ✅ Done |
| Rating inputs (1-5 stars) | ✅ Done |
| Duration inputs (hours + minutes) | ✅ Done |
| Field bindings on instances | ✅ Done |
| Value storage as `{ value, flow }` | ✅ Done |
| Flow-based aggregation (in/out/any) | ✅ Done |
| All 15 aggregations (sum, count, avg, median, mode, etc.) | ✅ Done |
| Scope filtering (grid/panel/container/instance) | ✅ Done |
| Time filtering (today, thisWeek, thisMonth, etc.) | ✅ Done |
| Target scaling across time periods | ✅ Done |
| Progress bar display (in FieldDisplay) | ✅ Done |
| FieldRenderer routing to correct component | ✅ Done |
| FieldPillInput/FieldPillDisplay compact mode | ✅ Done |
| Schema enum for all 15 aggregations | ✅ Done |
| Select field multi-select mode | ✅ Done |
| Select field quick-add options | ✅ Done |
| Select field removeOnComplete | ✅ Done |
| Emotion wheel mood selector | ✅ Done |
| Watchlist/reading list with completion hiding | ✅ Done |
| UI for flow direction selection | ✅ Done |
| UI for configuring allowedFields | ⬜ Not started |
| **Future: Select Field Aggregations** | |
| Count occurrences of each select value | ⬜ Not started |
| "Most common emotion this week" aggregation | ⬜ Not started |
| Select value distribution charts | ⬜ Not started |

**Remaining (3%)**: allowedFields UI.

---

### Phase 3: Transactions & Block System — 88% Complete

**Transaction System** captures WHO, WHAT, WHERE, WHEN for every change:
- Time-travel queries for historical aggregations
- Audit trail with timestamp, previousValue, flow direction
- Undo/redo via transaction state (applied/undone/redone)

**Block System** (Snap!/Scratch inspired visual programming):
- Block types: FIELD, LITERAL, VARIABLE, OPERATOR, COMPARISON, LOGICAL, AGGREGATION, FUNCTION, CONDITION, LOOP
- Block shapes: REPORTER (oval), STATEMENT (rect), C_BLOCK, HAT
- Full visual editor with drag & drop

| Feature | Status |
|---------|--------|
| **Transaction System** | |
| Transaction model (MeasureOp, OccurrenceListOp, EntityOp, DocEditOp) | ✅ Done |
| Undo/redo system (useUndoRedo hook) | ✅ Done |
| TransactionHistory.jsx UI | ✅ Done |
| Server undo/redo socket handlers | 🟡 Partial |
| Undo slide-back animations (FLIP) | ⬜ Not started |
| **Block System** | |
| blockTypes.js (all block types & shapes) | ✅ Done |
| blockEvaluator.js (recursive evaluation) | ✅ Done |
| useBlockDnD.jsx hooks | ✅ Done |
| Block.jsx, Slot.jsx components | ✅ Done |
| BlockPalette.jsx (toolbox) | ✅ Done |
| OperationsBuilder.jsx + OperationsCanvas.jsx | ✅ Done |
| **Notifications & Feedback** | |
| Toast notifications (sonner) | ✅ Done |
| FieldValueIndicator (green/red arrows) | ✅ Done |
| useAnimations hook (FLIP animations) | ✅ Done |
| GridRadialMenu (Undo/Redo/History/Fields) | ✅ Done |
| **Future** | |
| Offline support with sync queue | ⬜ Not started |
| Conflict resolution | ⬜ Not started |
| Achievement badges | ⬜ Not started |

**Remaining (12%)**: Server undo handlers completion, slide-back animations.

---

### Phase 4: Rich Editor, Iterations & Artifact System — Complete

**Rich text with embedded field/instance pills + compound iterations + unified artifact model.**

| Feature | Status |
|---------|--------|
| **Editor (ui/Editor.jsx)** | |
| TipTap editor with @ mentions (FieldPill, InstancePill, DocLink) | ✅ Done |
| DocToolbar (Bold/Italic/Strike/Code, H1-H3, Lists, Unlink, MD export) | ✅ Done |
| FieldPillExtension + InstancePillExtension + DocLinkExtension | ✅ Done |
| Drag instances into doc → inserts pill | ✅ Done |
| **Artifact System (modules/)** | |
| modules/Artifact.jsx — pure content renderer (markdown/image/pdf/audio/video) | ✅ Done |
| modules/View.jsx — layout + ManifestTree sidebar routing | ✅ Done |
| ManifestTree — folder tree, click to set activeOccurrenceId | ✅ Done |
| occurrence.textmap replaces docContent (TipTap JSON in DB) | ✅ Done |
| textmap → artifacts/[fileRef] sync on save | ✅ Done |
| POST /api/artifacts/upload — creates Module + Occurrence + View | ✅ Done |
| artifacts/ static middleware | ✅ Done |
| **Three-Concept Model** | |
| occurrence.viewId → View (separate model, NOT on module) | ✅ Done |
| occurrence.parentId + occurrence.occurrences (tree ordering) | ✅ Done |
| module.fileRef for artifact file reference | ✅ Done |
| Doc.js + Artifact.js deleted (replaced by textmap + fileRef) | ✅ Done |
| panels/ folder deleted (replaced by modules/) | ✅ Done |
| ui/Field.jsx — merged FieldDisplay + FieldPillDisplay | ✅ Done |
| **Iteration System** | |
| IterationNav.jsx, IterationSettings.jsx | ✅ Done |
| Compound iterations (time + category), cascading | ✅ Done |
| Local iteration arrows on panels/containers | ✅ Done |
| **Remaining** | |
| ModuleEmbed TipTap extension (@:(id) universal embed node) | ⬜ Not started |
| Day pages auto-creation operation | ⬜ Not started |
| Live value calculation in field pills | ⬜ Not started |

---

## Compound Iteration System (Phase 4 Enhancement)

### Current State
The system uses `occurrence.iteration` with:
- `key: "time"` - time-based filtering
- `value: Date` - specific date
- `mode: "persistent" | "specific" | "untilDone"`

### Enhanced Design: Compound Iterations

Iterations can be BOTH time-based AND category-based simultaneously. Categories work like tags/contexts that can filter independently of time.

**Enhanced Schema:**
```javascript
// Occurrence iteration
iteration: {
  // Primary axis: time (always present)
  timeKey: { type: String, default: "time" },
  timeValue: { type: Date },
  timeFilter: { type: String, enum: ["daily", "weekly", "monthly", "yearly", "all"] },

  // Secondary axis: category (optional)
  categoryKey: { type: String },    // "context", "project", "area", null
  categoryValue: { type: Mixed },   // "work", "personal", ["health", "fitness"], null

  // Persistence mode (applies to both axes)
  mode: { type: String, enum: ["persistent", "specific", "untilDone"] },

  // Completion tracking (for untilDone mode)
  completedOn: { type: Date },
  completionFieldId: { type: String },
}

// Grid iteration definitions (user-configured)
Grid.iterations: [{
  id: String,
  name: String,                     // "Daily Work", "Weekly Personal"
  timeFilter: String,               // "daily", "weekly", etc.
  categoryKey: String,              // "context", "project", or null
  categoryOptions: [String],        // ["work", "personal", "health"]
}]

Grid.selectedIterationId: String,   // Current iteration definition
Grid.currentTimeValue: Date,        // Current time position
Grid.currentCategoryValue: Mixed,   // Current category filter (or null for all)
```

### Cascading Iterations

Iteration settings can be overwritten as you go down the hierarchy:

```
Grid: Daily + All Categories
  └─ Panel (inherit): Daily + All Categories
      └─ Container (own: Work only): Daily + Work
          └─ Instance (inherit): Daily + Work
  └─ Panel (own: Weekly): Weekly + All Categories
      └─ Container (inherit): Weekly + All Categories
```

**Key Principle**: Each level can either:
- `inherit` - Use parent's iteration settings
- `own` - Override with specific settings

### Local Iteration Navigation

Each panel/container with `mode: "own"` can have its own iteration arrows:

```
┌─────────────────────────────────────────┐
│ Schedule Panel                    [⚙️]  │
│ ◀ Mon, Feb 10  [📅] ▶   [Work ▼]       │
├─────────────────────────────────────────┤
│                                         │
│  • 9:00am Meeting                       │
│  • 10:00am Code review                  │
│                                         │
└─────────────────────────────────────────┘
```

The panel can navigate its own iteration independently of the grid's global iteration.

### Use Cases

1. **Daily Schedule + Work Context**: See only work items for today
2. **Weekly Goals + Personal**: See personal goals for this week
3. **Panel with Different Time**: Grid is daily, but one panel shows weekly view
4. **Category-Only Filter**: Same day, but filtered to "Health" context

---

## Summary: Phase Status

| Phase | Name | Completion |
|-------|------|------------|
| 1 | Occurrences & Core DnD | **100%** |
| 2 | Fields & Calculations | **97%** |
| 3 | Transactions & Operations Pipeline | **100%** |
| 4 | Rich Editor, Iterations & Artifact System | **92%** |
| 5.1 | Cascading Style Overrides | **100%** |

**Phases 1-3, 5.1: Complete. Phase 4: 92% (ModuleEmbed + day-page auto-creation remaining).**

---

## Known Issues

### Priority 1 — Bug Fixes
- [x] ~~**Field schema enum mismatch**: Fixed - all 15 aggregations now in schema~~
- [x] ~~**Panel backgrounds missing**: Fixed - added @config directive for Tailwind v4~~
- [x] ~~**Copy/move drag glitchy**: Fixed - session ref for immediate mode access~~
- [x] ~~**Container fields missing**: Fixed - spread `...obj` in loadUserIntoCache~~
- [ ] **React child error**: forwardRef icon components (intermittent)

### Priority 2 — Polish
- [ ] Touch gesture optimization for mobile
- [ ] Performance optimization for 100+ items

---

## Quick Reference

### Running the App
```bash
# Development (runs client + server)
npm run dev

# Reset sample data
cd server && node scripts/resetData.js
```

### Key Files
| File | Purpose |
|------|---------|
| `client/src/helpers/DragProvider.jsx` | Drag state coordinator |
| `client/src/helpers/CalculationHelpers.js` | All calculation/aggregation logic |
| `client/src/helpers/CommitHelpers.js` | CRUD operations |
| `client/src/ui/FieldRenderer.jsx` | Field display routing |
| `client/src/ui/IterationNav.jsx` | Time navigation controls |
| `client/src/ui/IterationSettings.jsx` | Persistence mode selector |
| `client/src/state/selectors.js` | Occurrence resolution helpers |
| `client/src/blocks/` | Visual block programming system |
| `client/src/docs/` | Rich text editor & pills |
| `server/models/Occurrence.js` | Occurrence schema with iteration |
| `server/models/Transaction.js` | Audit trail schema |

### Architecture Patterns
- **Occurrence-based**: Entities are templates, occurrences are placements
- **Session refs**: Immediate state access during async operations
- **Flow values**: `{ value, flow: "in"|"out"|"replace" }` for aggregation
- **Per-entity drag mode**: `defaultDragMode` on panels/containers/instances
- **Panel placement**: Position stored in `occurrence.placement` (not panel.row/col)
- **Iteration inheritance**: Grid → Panel → Container → Instance cascading
- **Compound iterations**: Time + Category filtering simultaneously

---

## Original Vision (Day Planner Explanation)

### What it is (in plain English)

A **drag-and-drop daily command center** where:
- You plan your day by **dragging tasks into time slots**
- You can also **track what you actually did**
- It can **calculate totals, streaks, progress, and stats automatically** from whatever you log

Think: **calendar + to-do list + habit tracker + budget/nutrition/workout tracker**, all in one.

### The big idea: "Anything you do can be measured"

A normal planner: "I did laundry ✅"

This planner:
- "I ran ✅ **for 25 minutes**"
- "I ate ✅ **42g protein**"
- "I saved ✅ **$20**"
- "I studied ✅ **2 pomodoros**"

Every task can be just a checkbox **or** a checkbox plus numbers/text.

### How scheduling works

**1) Build a "Task Bank"** - Your library of stuff you do (work, gym, meals, finance, routines)

**2) Drag tasks into your day** - Single task, multiple tasks, or preset bundles

**3) The schedule becomes your plan AND your log** - Same slots represent intent and reality

### How calculations work

The app calculates anything based on:
- **What task it was** (Protein vs Savings vs Meditation)
- **What value you entered** (42g, $20, 15 minutes)
- **What time "lens"** (Today, This week, This month)
- **What category filter** (Work only, Personal only, All)

So it can answer:
- "How much protein did I log **today**?"
- "How much did I save **this month**?"
- "How many **work** tasks did I complete **this week**?"
- "What's my streak for journaling?"

### One-liner

A **drag-and-drop day timeline** where every task can be a **checkbox or a measurement**, and the app can **sum/count/track progress across any time window AND category** without needing separate trackers.






##


