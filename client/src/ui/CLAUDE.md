# client/src/ui — UI Components CLAUDE.md

_Updated: 2026-06-12. Check this file before re-reading source._

## Recent Changes (2026-06-17 — Editor: detectSideHost hoisted, picks a side everywhere, returns line-level anchorOffset + per-line drop highlight)
- **`Editor.jsx`** — `detectSideHost` (+ helper closures `isTextmappedHost` / `blockIndexAtY` / new
  `offsetFor`) HOISTED from inside the `onDrop` callback to component scope (a `useCallback`), so the
  native `onDragOver` can reuse it. It now uses `sideFromFrac(frac)` (from `docs/wrapAnchor`) — NO dead
  "middle third" that returned null (which had made the image fall through to a plain cross-doc move) —
  and returns `{ side, anchorOffset, … }` where `anchorOffset` is px from the host prose top (line-level,
  via `offsetFor` → `anchorOffsetForDrop`). `wrapHostWithNeighbor` / `wrapMoveBeside` / the in-group
  re-morph `setNodeMarkup` all write `anchorOffset` onto the `wrapGroup` node.
- **Per-line drop highlight** — new `wrapDrop` state set in `onDragOver` from `detectSideHost(e)`; renders
  `.wrap-drop-line.wrap-drop-line--{side}` (a bright blue segment on the side + at the exact visual line
  the pointer is on) as a sibling of the block-boundary `dragGap` element inside the `position:relative`
  `.doc-editor` wrapper. Cleared on drag-leave/drop. CSS in `index.css`. See docs/CLAUDE.md + the plan.

## Recent Changes (2026-06-16 — Editor: ONE editor per drop + auto-create gated on text change)
- **`Editor.jsx` (doc drop handler)** — two drop/resize regressions:
  - **Triple-fire drop fix.** Pragmatic DnD fires `onDrop` on EVERY registered drop target
    under the pointer (innermost-first). A textblock sub-editor that slipped past the
    nested-registration guard (line ~1260) ALSO ran the whole handler → a single drop became
    3 cross-doc inserts + 3 detaches (doc churned/"reloaded", stray copy, source didn't move —
    user dropped beside a textblock to form a C). Added an outermost-wins guard at the top of
    `onDrop`: `const docTargets = (location?.current?.dropTargets||[]).filter(t=>t.data?.type==="doc-editor"); if (docTargets.length>1 && docTargets.at(-1).element!==el) return;`
    Only the OUTERMOST doc editor (owns the embed/wrapGroup model) processes the drop.
  - **Resize no longer inserts an extra parent textblock.** A wrapGroup seam RESIZE writes
    `neighborWidth` (and re-morph writes `anchorIndex`/`side`) — these are `docChanged` but type
    no text, yet `onUpdate`'s auto-create-textblock fired and folded the whole wrapGroup into a
    new textblock on every column resize. The auto-create guard now also requires the text
    content to have changed: `const textChanged = transaction.before.textContent !== editor.state.doc.textContent;`
    added to the `if (!isCell && onAutoCreateTextblock && transaction.docChanged && textChanged && !…skipAutoCreate)` gate.
  - **Sub-editor drop guard hardened.** A textblock CARD editor (`TextblockCard.jsx`) passes no
    `onExitBlock`, and when its embed NodeView is portal-rendered the `.doc-editor`-ancestor check
    (line ~1266) misses it — so it registered as a top-level drop target and STOLE a page-level
    cross-doc move into itself (buried the embed inside the textblock + detached the source = "the
    move still doesn't happen"; logs showed a tiny `insertPos 0` editor processing the drop). Added
    `if (el.closest?.(".textblock-card, .instance-textblock-block, .table-td")) return;` to the
    drop-target registration — a card/cell editor never owns a page drop; the page editor does.

## Recent Changes (2026-06-12 — Editor: block-wrap groups form NEIGHBOR-first (redesign))
- **`Editor.jsx`** — part of the block-wrap redesign (docs/CLAUDE.md + spec). Removed the
  `WrapSpacer` import + extension registration (the ghost node is gone). `wrapHostWithNeighbor`
  and `wrapMoveBeside` now create the group as `[neighbor, host]` (was `[host, neighbor]`) —
  neighbor-first source order so the float wraps the host. `blockIndexAtY` no longer filters a
  `.wrap-spacer`. The grouped-member re-morph branch uses `isNeighborMember(grouped)` (host is
  now the last child, not index 0); `unwrapGroupAt(editor, groupPos)` drops its commit-args.
- **`detectSideHost` now handles the in-group RE-MORPH** — dropping the neighbor on a host line
  lands INSIDE the isolating wrapGroup, so `posAtCoords` resolves to the group (not a child
  moduleEmbed). New branch: when the resolved top node is a `wrapGroup`, take its last child as
  the host, recompute `side` (drop X vs group midline → flip) + `anchorIndex` (`blockIndexAtY`
  on the host embed's `.ProseMirror`). That drives the DYNAMIC shape — drag the neighbor up/down
  the host → `anchorIndex` changes → WrapGroupNode repositions the float (margin-top) → the
  wrap re-forms continuously (L → C → hangman; cross midline → J).

## Recent Changes (2026-06-12 — AssistantDrawer: don't wrap a DRY-RUN import → fixes "empty embed" page)
- **`AssistantDrawer.jsx` (`resolveConfirm`)** — the single-import branch wrapped the result
  whenever `j.output?.rootOccurrenceId` existed, WITHOUT checking `dryRun`. A dry-run import
  returns a planned root but persists nothing, so the wrap created a permanent Imports page
  whose `moduleEmbed` resolved to a missing module → the user's reported "empty embed." Now:
  a new `isImportTool(card.name) && j.output?.dryRun` branch surfaces "(planned only — nothing
  was imported …)" and the wrap branch is gated on `shouldWrapImportOutput(j.output)`
  (helpers/importsFolder.js: not-dryRun + has root). Batch path was already safe (never sends
  dryRun). Server also nulls the dry-run root (server/CLAUDE.md). Build clean.
- **Note for a follow-up:** the user's existing stale "Eminem" Imports page (created by an
  earlier dry-run import) still points at a phantom root — delete it / re-import to clear it;
  the guard only prevents NEW broken pages.

## Recent Changes (2026-06-11 — Editor: block-wrap is normal-drag + drop-on-line; no grip)
- **`Editor.jsx` (doc drop handler)** — the section-image wrap is now driven entirely by the
  occurrence's NORMAL radial drag handle (the `⠿` grip in `WrapGroupNode` is deleted):
  - `detectSideHost` only treats a top-level moduleEmbed as a host when its occurrence is
    **textmapped** (new `isTextmappedHost`: role:"textblock" OR kind:"doc" container) — never
    board/list/table → those fall through to a normal insert. It now also returns
    `anchorIndex` = the host's block index at the drop Y (new `blockIndexAtY`), so the notch
    morphs at the EXACT line dropped on (L at line 0, C/J mid-flow). Passed into
    `wrapHostWithNeighbor` / `wrapMoveBeside` group attrs.
  - New pre-branch block (after `sideHost`): if the dragged occ is already a `wrapGroup`
    member (`helpers/wrapGroupOps.findGroupMember`): a NEIGHBOR dropped on the SAME host →
    `setNodeMarkup` the group's `anchorIndex`+`side` (re-morph in place — replaces the grip);
    dropped anywhere else (or dragging the host) → `unwrapGroupAt` then recompute
    `insertPos`/`sideHost` on the flattened doc and fall through to the normal move/insert
    (guarded so it doesn't instantly re-wrap onto the host it just left). `insertPos`/`sideHost`
    are now `let`. New `modulesByIdRef` for the host-type lookup.
  Build clean, 1110/1110 client tests. **In-browser glance needed** (TipTap drop geometry).

## Recent Changes (2026-06-11 — SINGLE wikipedia import now lands in the Imports folder + asks where to open)
- **`AssistantDrawer.jsx` (`resolveConfirm`)** — root cause of "the importer didn't ask
  where to open, nor put it anywhere": only the `wikipedia_import_batch` branch eager-wrapped
  imported roots into the shared **Imports** folder. A SINGLE import (`wikipedia_import` /
  `import_markdown` / `import_html`) fell to the generic `else`, which only appended a
  `panel_pick` on the RAW root — the Imports-folder wrap happened later in
  `PanelPickCard.openInPanel` ONLY if the user interacted with that card. If the card didn't
  render (occurrence not yet synced) or was dismissed, the import stayed loose
  (`parentId:null`) and showed up nowhere (verified in the DB: fresh import root parentId NULL,
  no Imports folder). New branch: `isImportTool(card.name) && j.output?.rootOccurrenceId` →
  `ensureImportsFolderAndPage(...)` + `createImportsDocPage(...)` (same as batch), then a
  `panel_pick` on the Imports **folder page** so it always lands somewhere visible AND asks
  where to open. New module-scope `isImportTool(name)` helper. Build clean; importsFolder
  helper tests 6/6. (Existing already-loose imports aren't retroactively moved — re-import or
  delete the loose one.)

## Recent Changes (2026-06-11 — InsertGap: the whole highlight strip is clickable + shows a pointer)
- **`index.css` `.insert-gap*` / `.doc-insert-gap*`** — the insert-here affordance used
  to put the click target + pointer ONLY on the centered `+` button; the blue highlight
  strip itself was inert (the doc variant's container is `pointer-events:none`, and the
  strip had no click handler). Now the QuickAddMenu trigger fills the whole gap:
  `.insert-gap-btn` is `width:100%` (flex-centered) and
  `.insert-gap .quick-add-btn, .doc-insert-gap .quick-add-btn` get
  `width:100% !important; cursor:pointer !important` (overriding QuickAddMenu's inline
  20px trigger). So hovering anywhere on the strip shows a pointer and clicking anywhere
  on it opens the add menu — the `+` glyph stays centered. Fixes "can't highlight between
  textblocks / pointer only on the +; need it for both" (the strip appeared but was
  non-interactive). Applies to BOTH the list/board gap and the doc-block gap (imported
  doc containers get `enableInsertGaps` since they pass no onExitBlock/onDeleteBlock).
  Build clean; **needs an in-browser glance** to confirm the strip reveals between
  embedded textblocks.

## Recent Changes (2026-06-10 — Editor: spellcheck squiggles only while focused)
- **`Editor.jsx` (`editorProps`)** — the ProseMirror contenteditable now starts
  `spellcheck="false"` (in `attributes`), and new `handleDOMEvents.focus`/`blur`
  handlers flip it to `"true"` on focus and back to `"false"` on blur. So an
  UNFOCUSED textblock no longer shows red misspelling squiggles — they appear only
  when the user clicks into the block (user: "only show the misspelling squiggles
  if i click on the textblock"). Toggling the attr re-runs / clears the browser's
  native check. Applies to every Editor instance (doc pages, textblock sub-editors,
  cells). Build clean.

## Recent Changes (2026-06-09 — AssistantDrawer: reseed clears the chat history)
- **`AssistantDrawer.jsx`** — new `SEED_KEY` (`moduli_assistant_seed`) effect: reads
  `state.grid.meta.assistantSeedId` (stamped fresh by `createLiveData` every run —
  see server/CLAUDE.md) and, when it differs from the marker stored in localStorage,
  clears `messages` + removes `moduli_assistant_history`, then records the new
  marker. The FIRST sighting (no stored value) only records it — so shipping this
  doesn't nuke an existing conversation. `seedId` arrives with `full_state`, so the
  `[seedId]` dep re-runs once the grid loads. Net: running `createLiveData` now also
  resets the Jonah chat history (the server can't touch browser localStorage, so the
  grid marker is the bridge — same idea as the bootstrap-token auto-fill).

## Recent Changes (2026-06-09 — QuickAddMenu: stop closing on scroll/hover-off + InsertGap polish)
- **`QuickAddMenu.jsx`** — the menu "randomly disappeared" because a
  **close-on-scroll** effect (capture phase) fired on the menu's OWN internal
  `overflowY:auto` list scroll AND any incidental page/trackpad scroll. Replaced
  with a **reposition-on-scroll** (follows the anchor button) — the menu now
  closes ONLY on an outside `mousedown` or Escape. New optional `onOpenChange(open)`
  prop so a host can react to open/close.
- **`InsertGap.jsx`** — the `+` lives in the hover-only `.insert-gap-btn`, so moving
  the pointer to the portal menu collapsed the gap. Now tracks the menu's open
  state via `onOpenChange` and adds an `insert-gap--open` class that FORCES the
  gap revealed (height + line + button) for as long as the menu is open.
- **`index.css`** — `.insert-gap-line` now matches the drag-and-drop drop indicator
  EXACTLY (`.drop-indicator.drop-indicator-inst-*`: solid `rgb(50,150,255)`, full
  opacity, 3px, 1px radius, edge-to-edge — was a washed-out `--accent-blue` @ .55).
  `.insert-gap--open` reveal rules added beside the `:hover` ones.

## Recent Changes (2026-06-08 — Editor: block-wrap forms on MOVE-beside (not just copy))
- **`Editor.jsx` (doc drop handler)** — block-wrap pairs now form when you DRAG an
  embed already in the doc BESIDE a host embed (the natural gesture), not only when
  a fresh COPY lands beside one. Previously `wrapHostWithNeighbor` was wired only in
  the copy branches; the move branches fell through to a plain sibling insert.
  - `detectSideHost` now also returns `hostOccId`.
  - New `findTopEmbedPos(doc, occId)` (top-level/depth-1 only, so it never reaches
    inside an existing wrapGroup) + `wrapMoveBeside(occurrenceId, sideHost)`: in ONE
    transaction it deletes the source node from its old spot and replaces the host
    with a `wrapGroup` `[host, neighbor]` (re-resolving the host position on the
    post-delete `tr.doc`). Same-doc only — cross-doc sources return false → normal
    move runs.
  - Wired into the instance MOVE branch and the container/module MOVE branch (before
    `tryMoveEmbedNodeInDoc`). Build clean, 1090/1090 tests. Formation is a TipTap
    drop event — **needs an in-browser glance** (drag an embed onto the left/right
    third of another → they fold into an L/C wrap).

## Recent Changes (2026-06-09 — AssistantDrawer: batch import surfaces folder card + where-to-open prompt)
- **`AssistantDrawer.jsx` (`resolveConfirm` `wikipedia_import_batch` branch)** — two
  fixes for "import no longer asks where to open, nor lands in an Imports folder":
  - Uses the new `ensureImportsFolderAndPage(...)` (helpers/importsFolder.js) which,
    besides the Imports Folder record, mints a `role:"page" kind:"folder"` occurrence
    for it so the Imports folder shows as a CARD on the root folder page (a bare
    Folder record is invisible there — only the Local/Root TREE lists it).
  - Re-adds the where-to-open prompt: appends a `panel_pick` message targeting the
    Imports **folder page** so the user can pin it to a panel + drill into the
    imported pages (the batch path previously skipped this on purpose).
  - `PanelPickCard.openInPanel` now passes `occurrencesById` into `createImportsDocPage`.
  Build clean, importsFolder tests 6/6.

## Recent Changes (2026-06-08 — AssistantDrawer: one-card linked-import (wikipedia_import_batch))
- **`AssistantDrawer.jsx`** — linked Wikipedia imports ("X AND the surrounding
  links") now go through ONE summary confirm card instead of N separate ones. New
  server tool `wikipedia_import_batch({ titles })` (requires_confirm) imports each
  title + auto-relinks cross-references (see server/CLAUDE.md). `ConfirmCard` gains
  an `isImportBatch` branch: a checklist of titles (default all checked, deselect
  to drop), Approve gated on ≥1, sends the selected `titles`. `resolveConfirm`
  wraps EACH imported root in a doc page under the shared "Imports" folder
  (ensures the folder ONCE, then `createImportsDocPage({ folderId })` per root — no
  per-page panel-pick prompt). `renderToolBody` shows an "Imported N pages ·
  relinked M links" summary. Needs an in-browser glance + server restart.

## Recent Changes (2026-06-08 — AssistantDrawer: editable create_field confirm card)
- **`AssistantDrawer.jsx` (`ConfirmCard`)** — `create_field` is now a
  `requires_confirm` tool (server), and its confirm card renders an EDITABLE form
  (name text input + type `<select>` over `FIELD_TYPES` = number/text/boolean/
  select/date/duration/rating/occurrence + optional unit) seeded from the model's
  guess. Approve sends the edited `{ name, type, unit }` (gated on a non-empty
  name); decline still aborts. Lets the user fix the LLM's field guess in the UI
  before it's created (mirrors the create_occurrence location picker + page-kind
  picker pattern). Needs an in-browser glance.

## Recent Changes (2026-06-08 — assistant imports land in an "Imports" folder)
- **`AssistantDrawer.jsx` (`PanelPickCard.openInPanel`)** — the no-ancestor-page
  (imported container) wrap branch now parents the wrapped DOC page under a
  dedicated **"Imports"** folder (was `parentId: null` → a loose root page). The
  Local tree buckets a page by `foldersById[occ.parentId]`, so imports now show
  grouped under an "Imports" header instead of scattered at root. The wrap +
  folder-ensure logic moved to the shared `helpers/importsFolder.js`
  (`createImportsDocPage` / `ensureImportsFolder`) — the drag-from-browser import
  path (`dropHandlers.handleExternalDrop`, empty-cell case) reuses the same helper
  so both import surfaces land in the same folder. See helpers/CLAUDE.md.

## Recent Changes (2026-06-08 — randomize dice now INSIDE the occurrence pills too)
- **`Field.jsx`** — completes the dice-in-pill docket item for the OCCURRENCE half
  (select half done earlier same day). New shared `RandomizeSegment` helper (a
  divided trailing 🎲/Shuffle button with a `borderLeft` divider; parent owns the
  border + `overflow-hidden`). Applied to all FOUR occurrence input paths:
  - **`MultiSelectWithAdd`** restructured — border moved off the shadcn trigger
    `Button` onto a `flex items-stretch … rounded border overflow-hidden` wrapper
    (cyan border when `fieldName`); trigger is now `border-0 rounded-none`; the old
    ghost `Shuffle` sibling Button is replaced by `RandomizeSegment`. Used by both
    occurrence-multi callers (compact + non-compact), which now pass
    `randomize={randomize}` (was hardcoded `false`).
  - **occurrence single pills** (compact rounded-full + non-compact radius-5): the
    cyan border/bg moved onto a wrapping `inline-flex items-stretch overflow-hidden`
    container; the trigger button is borderless/transparent; `RandomizeSegment`
    appended inside, gated `randomize && options.length > 1`.
  - Select-multi (`randomize={!!meta?.randomize}`) is unchanged in gating but now
    also renders its dice via the in-border `RandomizeSegment`.
- **`FieldRenderer.jsx`** — the appended side-segment 🎲 button is DELETED (it only
  ever fired for occurrence; `canRandomize` is true only for select|occurrence and
  both now render inside). `randomize={canRandomize && inputEnabled}` is passed to
  `<Field>` for ALL types (was `field?.type === "select"` only). Unused
  `handleRandomize` removed.
- Verified via the headless-chromium pill harness (dice sits inside the border with
  a left divider, full height, clipped to the pill radius — all 3 occurrence shapes).
  Build clean, 1086/1086 client tests pass.

## Recent Changes (2026-06-08 — randomize dice now INSIDE the select pill border)
- **`Field.jsx`** — new `randomize` prop (default false). The single-select INPUT
  branch's pill border moved onto a wrapper `div` (`items-stretch` + `rounded
  border overflow-hidden`); the PopoverTrigger button is now borderless/transparent
  and the randomize dice (gated `meta?.randomize || randomize`, was a `Shuffle`
  ghost `Button` sibling) is a divided trailing segment INSIDE that border. So the
  dice reads as part of the pill, not a tacked-on button. Occurrence-multi randomize
  (MultiSelectWithAdd) is unchanged.
- **`FieldRenderer.jsx`** — the appended side-segment 🎲 button (the "attached
  pill-side segment" the user flagged) now renders ONLY for `field.type !==
  "select"` (i.e. occurrence fields); SELECT fields pass `randomize={canRandomize
  && inputEnabled}` into `<Field>` so the dice renders inside the pill instead.
  Docket leftover "make the dice truly inside the pill border" — select half done.
  **Needs an in-browser glance** (border/divider/height alignment isn't unit-testable).

## Recent Changes (2026-06-08 — InsertGap: "insert here" affordance between items)
- **`InsertGap.jsx` (NEW)** — thin hover zone placed BETWEEN sibling items
  (list/board column rows). Collapsed to a 4px hit zone; on hover reveals a blue
  highlight bar (`.insert-gap-line`) + a centered **QuickAddMenu "+"**
  (`.insert-gap-btn`). Picking/creating inserts the new occurrence at THIS index
  rather than appending. Reuses QuickAddMenu wholesale: `onSelect(moduleId)` →
  fresh placement of an existing module; `onCreateNew({fieldIds})` → new
  `role:"instance"` module with the picked fields bound. Both call the new
  `CommitHelpers.createLeafInstanceAtIndex({ parentOccurrence, index, ... })`
  (synchronous splice into `occurrences[]` — no async-id race). Reads
  `gridId`/`userId` from `useGridActions()` (falls back to `state.grid`).
- **Wired from** `modules/ModuleContainer.jsx` list render (interleaved before
  each item + a trailing gap; gated on `containerOccurrence` resolving). CSS in
  `index.css` (`.insert-gap*`). Docket item from the block-wrap session; user
  picked "reuse QuickAddMenu" + "highlight like the board".
- **DOC HALF SHIPPED 2026-06-08** — the same gap-highlight now works between
  top-level doc blocks. `Editor.jsx` gained an opt-in `enableInsertGaps` prop
  (passed by `DocContent.jsx` only for PRIMARY doc editors — gated
  `!onExitBlock && !onDeleteBlock` so cell/textblock sub-editors don't get gaps).
  `onMouseMove` on `.doc-editor-wrapper` → `handleGapMove` resolves the nearest
  top-level block boundary via `view.posAtCoords` + `$pos.before(1)` and stores
  `docGap = { top, pos }` (top = wrapper-relative px, pos = PM insert position).
  A floating `.doc-insert-gap` renders the same `insert-gap-line` + QuickAddMenu
  "+"; `gapFrozenRef` keeps it from recomputing while the pointer is over the
  affordance. Picking/creating calls `insertDocItemAt(pos, …)` which mints a
  STANDALONE occurrence (parentId = the doc occurrence, NOT into any
  `occurrences[]` — doc embeds are standalone) + `insertContentAt(pos,
  moduleEmbed)`. CSS `.doc-insert-gap*` in `index.css`.
- **BUGFIX (same session):** `QuickAddMenu.onSelect` hands back the full MODULE
  OBJECT `m`, not a moduleId. Both `InsertGap.jsx` (board half) and the doc-half
  `onSelect` were passing it straight through as `existingModuleId`, so picking
  an EXISTING module wrote an object into `occurrence.moduleId`. Both now
  normalize `m?.id ?? m`. (Was latent in the board half — the existing-module
  path isn't unit-tested; only insert-at-index is.)
- **Still needs in-browser check** — hover-reveal gap + insert-at-block-pos +
  the existing-module pick path aren't unit-testable.

## Recent Changes (2026-06-05 — AssistantDrawer: import opens as a DOC page (was a board))
- **`AssistantDrawer.jsx` (`PanelPickCard.openInPanel` wrap branch)** — the
  no-ancestor-page case (imported container) now wraps in a `role:"page"
  kind:"doc"` page whose `textmap` is a single `moduleEmbed` of the content
  occurrence (was `kind:"board"` with `occurrences:[occId]`, which rendered the
  article as kanban columns). Needs the server `create_page` textmap passthrough
  (see server/CLAUDE.md). Pairs with the importer's section containers now being
  `kind:"list"` (vertical) so the embedded tree reads like a document.

## Recent Changes (2026-06-06 — AssistantDrawer ConfirmCard: readable args + page-kind picker)
- **`AssistantDrawer.jsx` (`ConfirmCard`)** — two confirmation-UX upgrades:
  - **Readable generic cards:** non-create/non-wiki confirmables (create_field,
    create_operation, apply_template, update_grid, …) now show the tool's one-line
    `description` + per-arg rows where id-shaped values (parent/occurrence/target/
    field/module) resolve to labels/names from the live store, objects/arrays
    summarize ("N fields/items"), and noisy keys (gridId/dryRun/userId) hide.
    Module-scope helpers `prettyArgKey` / `friendlyArgValue` / `HIDDEN_ARG_KEYS`.
  - **Page-kind picker:** for `create_module` with `role:"page"`, the card shows
    doc/board/canvas/table buttons (pre-selected from the model's guess) + a
    one-line description each; Approve sends the chosen `kind`. Makes "what kind
    of page" a UI choice. Full client build clean.

## Recent Changes (2026-06-05 — InstanceForm: textblock Link settings (URL + in-app target))
- **`InstanceForm.jsx` (new `LinkSettingsSection`)** — for `role:"textblock"`
  instances the Settings tab now has a **Link** section that writes
  `occurrence.meta.link` (which `TextblockCard` renders as a clickable chip):
  - **None** → `meta.link = null` (normal editable textblock).
  - **URL** → `{ kind:"url", url }` (text input; opens in a new tab).
  - **In-app** → `{ kind:"occurrence", occId }` — a search box over every
    occurrence's label (pages/containers/items); pick one → clicking the chip
    `jumpToOccurrence`s (scroll + flash). This is the internal-target picker.
  Saves via `CommitHelpers.updateOccurrence`. Reached via the textblock's
  RadialMenu → settings popover (already mounted in `ModuleInstance`). Full vite
  build clean. (Note: `accent-green` isn't a registered Tailwind token — only
  `accent-green-text/-bg` — so selected styles use the registered `accent-blue`.)

## Recent Changes (2026-06-05 — AssistantDrawer: wiki preview-confirm + indeterminate ThinkingBar)
- **`AssistantDrawer.jsx` (`ConfirmCard`)** — `wikipedia_import` is now a
  `requires_confirm` tool (server), so its confirm card shows a PREVIEW: a
  mount effect fetches `GET /api/v1/research/wikipedia/summary?title=<title|query>`
  (Bearer from localStorage) and renders thumbnail + title + extract, with the
  title as a link that opens the Wikipedia page in a NEW TAB (`target=_blank`).
  Approve runs the import (existing `resolveConfirm` path → output → panel_pick).
  Falls back to an "Open on Wikipedia ↗ — import anyway?" line on fetch failure.
- **`AssistantDrawer.jsx` (`ThinkingBar`)** — once a run overruns its learned ETA
  (`elapsedMs > typical`, or >30s with no history) the bar no longer freezes near
  100% with a misleading `/~Ns` estimate; it switches to an honest INDETERMINATE
  sliding nub (`.assistant-indeterminate`, keyframe in index.css) and the label
  reads "… still working". Fixes "the bar stopped close to the end and kept
  counting" on long multi-step (tool-calling) runs.

## Recent Changes (2026-06-04 — AssistantDrawer: "show it in a panel" grid-map picker — targets the ANCESTOR PAGE)
- **`AssistantDrawer.jsx` (new `PanelPickCard` + `extractCreatedOccId`)** — after a
  create/import tool runs, the drawer offers a grid-map panel picker (the settled
  **Option 1**: open the new content as a tab in the chosen panel). Wiring:
  - `extractCreatedOccId(name, output)` pulls the new occurrence id from a tool
    result (`create_occurrence` → `output.occurrence` id/obj; importers →
    `output.rootOccurrenceId`; generic `pageOccurrenceId`/`occurrenceId`).
  - Appended as a `{role:"panel_pick", occId}` message in BOTH `send()` (for
    non-confirm tools like `wikipedia_import`/`import_markdown`) and
    `resolveConfirm()` (for `create_occurrence`, which is `requires_confirm`).
  - **Targets the new item's ANCESTOR PAGE, not the item itself.** The created
    item is usually a LEAF (an instance dropped into a Schedule slot), so
    `PanelPickCard` walks UP the `occurrences[]` tree (parentId fallback) to the
    nearest `role:"page"` ancestor (inclusive — a created page resolves to
    itself). Then:
    - **page already visible** (it's some panel view's `activeOccurrenceId`) →
      NO prompt; a one-shot `useEffect` immediately `jumpToOccurrence(occId)`
      (scroll + `.anchor-highlight` flash = "here's the new one").
    - **page not visible** → grid-map picker; on pick, open the ANCESTOR PAGE as
      a tab in the chosen panel, then `jumpToOccurrence(occId)` to scroll +
      highlight the new item inside it.
  - The map is `<MiniGridMap onCellClick enabledCell cellSize={22}>` — each grid
    cell that hosts a panel is clickable; plus a **"Don't show"** button.
  - On pick: the ancestor page is `pinPageToPanel`'d (if not already a tab there)
    + `updateView({activeOccurrenceId})` on the panel's existing view. The
    no-ancestor-page fallback (e.g. an **imported container** at root — the
    markdown importer roots imports as `role:"container"`, NOT a page) wraps it
    in a fresh `role:"page" kind:"board"` page whose `occurrences:[occId]`
    multi-parents the content (Notes-page pattern) via `CommitHelpers.createPage`,
    then activates + scrolls.
  - Gate to render the picker: `occ && (pageOcc || role==="container") &&
    !alreadyVisible`. So create-a-task on Schedule DOES prompt (it has a Schedule
    ancestor page); a homeless leaf with no page ancestor is skipped.
  - **`mobile/MiniGridMap.jsx`** gained per-cell selection (`onCellClick`,
    `enabledCell`, `cellSize`) — legacy whole-svg `onMapClick` path unchanged.
  - Bundle-clean via esbuild. Behavior needs in-browser verification (already-
    visible auto-scroll; pick→open ancestor page + scroll; container wrap).

## Recent Changes (2026-06-04 — AssistantDrawer: auto-bootstrap token after reseed)
- **`AssistantDrawer.jsx`** — the token input was empty after a reseed because
  it's filled from `localStorage`, which the server-side reseed can't populate.
  New mount-only effect: when there's NO saved token, fetch
  `GET /api/v1/assistant/bootstrap-token` and auto-fill it (the server hands the
  stable `ASSISTANT_API_TOKEN` to localhost only — see server/CLAUDE.md). A token
  the user already pasted is never overwritten (`if (token) return`). So "run
  createLiveData → open the drawer → it's connected" now holds with no paste.
  Requires a **server restart** if the env token value changed (server reads it
  at boot).

## Recent Changes (2026-06-04 — AssistantDrawer: graceful stale-token recovery ("clear my cookies"))
- **`AssistantDrawer.jsx`** — the Bearer token lives ONLY in `localStorage`
  (`moduli_api_token`). The SERVER already persists the token across reseeds
  (`server/.env ASSISTANT_API_TOKEN` re-upserted into the same userId every
  `createLiveData` run — see server/CLAUDE.md / utils/assistantToken.js), so the
  printed value keeps working. The remaining friction was purely client-side: a
  stale cached token had no recovery path except manually clearing site data.
  Now:
  - `send()` treats a **401/403** from `/assistant/chat` as "token invalid" →
    posts a recovery message AND auto-opens ⚙ Settings (was a raw
    `(error 401) …`).
  - New `clearToken()` + a **"Clear saved token"** button in the Settings panel
    (one-click `localStorage.removeItem` + state reset) — the in-app equivalent
    of "clear my cookies", so the user can drop a stale token and re-paste.
  - Settings hint rewritten to say the token is stable across reseeds (lives in
    `server/.env` as `ASSISTANT_API_TOKEN`).

## Recent Changes (2026-06-04 — AssistantDrawer: grid-scoped locations + best-guess reads the request text)
- **`AssistantDrawer.jsx` (`useLocations`)** — the placeable-location list
  (containers + pages the confirm card offers/best-guesses) is now scoped to the
  CURRENT grid: occurrences whose `occ.gridId` differs from `state.grid` are
  skipped (and `labelOf` returns null for them). Per user: "the ai should be
  geared toward the current grid … just the ones in the current grid." The store
  is single-grid today (FULL_STATE replaces all occurrences), so this is mostly
  defensive — but it's the surface the user hit (best-guess offering an
  off-grid container) and now can't regress. `curGridId` reads
  `state.grid._id || state.grid.id || state.gridId`.
- **`AssistantDrawer.jsx` (`bestGuessLocation` + `ConfirmCard`)** — the
  best-guess now folds the user's REQUEST text (`msg.userText`, already carried
  on the confirm card) into the fuzzy-match haystack, BEFORE the tool args. The
  destination usually lives in the request ("put X in the **6:30pm** container"),
  not in `input.label`/`input.parentId`. Combined with the existing
  longest-label-match rule this lands on "6:30pm container" instead of the item
  label "testing ai" fuzzily hitting a container named "Test". `ConfirmCard`
  seeds `parentId` with `bestGuessLocation(msg.input, options, labelOf, msg.userText)`.

## Recent Changes (2026-06-04 — AssistantDrawer: editable location on the confirm card)
- **`AssistantDrawer.jsx` (`ConfirmCard` + `useLocations` + `bestGuessLocation`)**
  — for `create_occurrence` (now a `requires_confirm` tool) the card renders an
  editable **location picker** instead of raw args: a best-guess destination
  (real `parentId` if valid, else fuzzy-matched from the LLM's placeholder/label
  against container+page labels built from `useGridActions().occurrencesById`/
  `modulesById`), a searchable list of all containers/pages, and Approve gated
  on a chosen location. `resolveConfirm(idx, approve, editedInput)` now forwards
  the corrected input (with the picked `parentId`) to `/assistant/confirm`.
  Lets the user confirm/fix WHERE a new item lands — so the LLM only has to
  best-guess, not produce a perfect id. Non-create confirmables keep the plain
  arg summary.

## Recent Changes (2026-06-04 — AssistantDrawer: live token streaming)
- **`AssistantDrawer.jsx`** — the `assistant_progress` handler now also handles
  `phase:"token"` deltas: appends to a new `streamingText` state rendered as a
  live assistant bubble (with a `▋` cursor) below the transcript while busy, so
  the model's words appear as it writes (Claude-style) instead of a silent wait.
  `phase:"thinking"` resets the buffer for each fresh generation; cleared on
  send-start and in `finally`. A second scroll effect follows `streamingText`
  (messages[] doesn't change mid-stream). Server streams via Ollama
  `stream:true` → `onProgress` token deltas (see server/CLAUDE.md).

## Recent Changes (2026-06-04 — AssistantDrawer: no-hang + live progress)
- **`AssistantDrawer.jsx`** — three fixes for the offline-assistant "… thinking
  forever / printed the tool call but did nothing" report (server-side root
  causes in `server/CLAUDE.md`):
  - `send()` fetch now uses an `AbortController` with a `CHAT_TIMEOUT_MS` (240s)
    ceiling so the drawer always resolves to a visible error
    (`(timed out after 240s) …`) instead of an endless spinner.
  - Subscribes to the new `assistant_progress` socket event (`ctx.socket`) and
    renders a live status line via `formatProgress` — `… thinking (step N)` /
    `… running wikipedia import` — replacing the static `… thinking`. Cleared on
    send-start, completion, and the server's `{phase:"done"}`.
  - `progress` state reset in `finally`.

## Recent Changes (2026-05-27 — Field.jsx: arbitrary array-cell content via ArrayCell)
- **`Field.jsx` (NEW exported `ArrayCell`)** — the columnar array-display
  branch (`displayConfig.columns` + array value) used to render every cell as
  `String(row[c.path])`. Now each cell value can be EITHER a scalar (text, as
  before — fully back-compat) OR a descriptor object `{ kind, ... }` so any cell
  can hold arbitrary content independent of its column:
  - `{ kind: "occurrence", id }` → `RepresentationView` chip (icon + label +
    click-to-jump via `jumpToOccurrence`). Falls back to the raw id when the occ
    is missing.
  - `{ kind: "field", id, fieldId }` → projects a field value off the referenced
    occurrence (`occ.fields[fieldId].value`; arrays render `N selected`).
  - `{ kind: "media", src } | { id, fieldId? }` → image thumbnail (explicit URL,
    or a media-role field on the occ — resolved via `resolveOccCard` +
    `resolveFileRef`).
  - `{ kind: "text", text }` → explicit free text / note.
  - anything else → `String(value)`.
  The array branch passes `occMaps` (occurrencesById/modulesById/fieldsById,
  already in scope) and relaxes the clip style for rich (object) cells. New
  imports: `RepresentationView` (default), `jumpToOccurrence`.
- **Consumer (seed):** the Media goal's Movies/Books/Podcasts history trackers
  in `server/scripts/createLiveData.js` now `PUSH_TO_ARRAY` descriptor rows
  (`label` = occurrence chip, `poster` = media) instead of flat strings —
  `deepResolveExpr` resolves the `$movie.id`/`$book.id`/`$podcast.id` leaves
  inside the nested descriptor objects.
- **Tests:** `__tests__/ArrayCell.test.jsx` — 9 cases (scalar/null/text/
  occurrence/missing-occ/field-scalar/field-array/media-explicit/media-from-
  field). Mocks `RepresentationView` + `jumpToOccurrence` to isolate the
  dispatch. Build green; `viewMode` 14/14 still pass.

## Recent Changes (2026-05-26 — Date picker "on/link/off" model + day/range listing)
- **`daySelectionCycle.js` (NEW)** — pure tri-state day-selection reducer for
  the filter calendar. Each day cycles by repeated clicks:
  `unselected → distinct → range → off`. `cycleDay(state, isoDay)` is the core;
  state is `{ keys: sortedISO[], kind: {iso: "distinct"|"range"} }`. Rules:
  clicking a fresh day → distinct; clicking a distinct day → fills to the
  nearest selected neighbor on EACH side (bridges both if both exist; if none →
  off); clicking a ranged day → removes just that day (trim/punch-hole), and a
  lone range remnant demotes to distinct. `seedSelection(dates)` re-derives
  state from a flat ISO list (contiguous≥2 → range, isolated → distinct).
  `barPosition` reports start/mid/end for bar rendering. 12 tests in
  `__tests__/daySelectionCycle.test.js` encode every confirmed scenario.
- **`filterSummary.js` (NEW)** — `summarizeDays(isoList)` / `summarizeSelection(shape)`
  list distinct days + contiguous ranges ("May 6, May 9–12, May 20") instead of
  "N selected". Caps at `maxSegments` with "+N more". 11 tests in
  `__tests__/filterSummary.test.js`.
- **`NavPickerPopover.jsx`** — REWRITTEN interaction. Dropped the
  `range multiple` Calendar mode (which made click-to-deselect impossible and
  single-day awkward). Now `multiple` mode + `mapDays`: day clicks are handled
  by us via `cycleDay` (the library's default selection is bypassed); a
  `clickGuard` ref keeps the library's `onChange` (fired only by the side-panel
  × / toolbar deselect) from clobbering our click. `mapDays` also stamps
  per-day classes (`moduli-today` / `moduli-distinct` / `moduli-ranged` +
  `moduli-range-start|mid|end`). Working state seeded from the persisted shape
  on open; commits classify back to the existing `{kind,value,span,dates,unit}`
  shape (mixed selections → multi). `formatSummary` now uses `summarizeSelection`.
  Fixed a latent bug: `hydrateSelection` referenced `DateObject` which was never
  imported (now imported).
- **`HeaderChevron.jsx` + `FilterNavWidgets.jsx`** — both summary spots now call
  `summarizeSelection` for multi / multi-day selections (header pill: maxSegments 2;
  arrow-nav label: 3). Single day keeps the weekday form; week/month/year keep
  their period labels.
- **`filterCalendar.css`** — new selection visual language driven by the
  moduli-* classes: TODAY = square marker (reserved), DISTINCT = bright circle,
  RANGED = connected bar (cell bg = connector, end-caps are bright circles).
  Replaced the old rmdp-selected/rmdp-range styling.
- **NEEDS IN-BROWSER VERIFICATION**: the `mapDays` onClick override behavior and
  the connected-bar CSS are not unit-testable; the pure reducer + formatter ARE
  fully tested. Build clean, 1063/1063 client tests pass.


## Recent Changes (2026-05-21 — Panel own-style + cascade wiring on LayoutForm)
- **`LayoutForm.jsx`** — pulls `state` from GridActionsContext and
  memoizes two cascades via `resolveStyleCascade`:
  `cascadeForPanelOwn` (Grid → Panel chain ending at panel) and
  `cascadeForPanelChildren` (Grid → Panel chain ending at instance,
  shared by both child-default editors). All three StyleEditors
  in the Style tab now receive the cascade prop so the user sees
  what's pushing down before overriding. New "Panel Style"
  editor (`kind="panel"`) added at the top writing
  `panel.styleMode` + `panel.ownStyle` — was missing.

## Recent Changes (2026-05-21 — StyleEditor kind-aware + grid-default cascade root)
- **`StyleEditor.jsx`** — Now accepts `kind`
  (`"grid"|"panel"|"page"|"container"|"instance"|"textblock"|
  "artifact"`) and conditionally renders only the controls listed in
  `STYLE_FIELDS_BY_KIND` for that kind. New `cascade` prop accepts
  the output of `resolveStyleCascade` and renders a read-only
  "Inherited cascade" stack at the top of the form showing every
  ancestor's contribution (one row per Grid / Panel / Page /
  Container / Instance level that touched the style). Added
  granular border (`borderColor` / `borderWidth` / `borderStyle`),
  `fontFamily`, `fontWeight`, `lineHeight` controls; legacy `border`
  shorthand kept for back-compat. Default `kind="container"` so
  existing callers that don't opt in keep their current control
  set.
- **`commandCenter/GridSettingsTab.jsx`** — Added new section "Grid
  default style" (right under the rows/cols grid, before Sort
  panels). `kind="grid"` StyleEditor writes to
  `grid.meta.defaultStyle` — the root of the cascade that pushes
  down to every panel / page / container / instance unless
  overridden at a lower level. `inherit` mode deletes the meta key;
  `own` mode persists the style object via `CommitHelpers.updateGrid`.
- **`LayoutForm.jsx`** — Panel "Container Defaults" + "Instance
  Defaults" StyleEditors now pass `kind="panel"` / `kind="instance"`
  + clarified inherit labels.
- **`ContainerForm.jsx`** — All three StyleEditors (container,
  child-instance defaults, per-placement overlay) now pass `kind` +
  a memoized `cascade` from `resolveStyleCascade`. Child-instance
  editor includes the container itself in the chain.
- **`InstanceForm.jsx`** — Instance StyleEditor: `kind` derives from
  instance role (textblock / artifact / instance); cascade walks all
  the way from this occurrence up through Container → Page → Panel
  → Grid.

## Recent Changes (2026-05-21 — Drilldown date picker + filter pill + value-direction display colors + Now AM/PM)
- **`DrilldownDatePicker.jsx` (NEW)** — Calendar-style multi-select
  picker with four-level zoom (day → week → month → year). Self-
  contained; no library deps. Header has chevron-up (zoom out) /
  chevron-down (zoom in) + clickable title. Nav row has ◀ / ▶
  arrows + a `step` integer input (only rendered at day & week
  levels; months and years always step ±1). When ≥1 dates are
  selected, arrows shift each selected date by `step` days
  (consecutive AND non-consecutive — same operation per-date). With
  no selection, arrows just step the anchor month. Multi-select via
  click-toggle at day level; Shift+click range-selects. Week level
  is a stack of 7-day strips with N/7 counts; clicking a strip
  toggles all 7 days. Month/year levels are 4×3 grids that drill
  DOWN on click. Emits `onChange(["YYYY-MM-DD", ...])` (sorted).
  Replaces the prior `react-multi-date-picker`-based UX per the
  earlier "(c) Picker redesign" handoff item.
- **`NavPickerPopover.jsx`** — swapped `react-multi-date-picker` →
  `DrilldownDatePicker`. The outer D/M/Y zoom toolbar is gone (the
  new picker has its own zoom chevrons). `handleChange` rewrote to
  convert ISO string arrays → Date[] for `classifySelection`. New
  `pickerValue` memo flattens the persisted shape (dates[] →
  value-array). Removed unused `zoom` state, `datePickerRef`,
  `initialSelection`, `mapDays`. `classifySelection` /
  `formatSummary` / `hydrateSelection` exports retained (callers
  still consume the same `{ kind, value, span, dates, unit }` shape).
- **`HeaderChevron.jsx`** — filter button in occurrence headers now
  ALSO renders a small inline pill per active filter entry showing
  the currently-applied value (e.g. `Thu, May 21` for day-unit
  dates, `wk May 19` for week unit, `May 2026` for month, `2026`
  for year). Multi-select → "N selected". Only renders when the
  filter is effectively ACTIVE on the occurrence (no pill on
  deactivated/none states). Clicking the pill opens the same
  HeaderDropdown as the icon. Pills consume `fieldsById` from
  GridActionsContext to type-dispatch the formatter. The inline
  LocalFilterNav arrows were already removed from headers in an
  earlier session; the pill + chevron pair completes the
  "filter button + applied filters, no nav" look.
- **`Field.jsx` — display rule rendering**:
  - New `displayRule` prop (default `null`) carries the operation-
    authored `{ color, icon, suffix, replaceValue }` output of
    `helpers/displayRules.js`. When set:
    - `color` overrides the value-sign / target-met defaults
    - `icon` (lucide name) renders before the value
    - `suffix` appends after the value (`10 left`)
    - `replaceValue` substitutes the value entirely (Pomodoro
      "paused" instead of a number)
  - Compact display pill and non-compact display box both honor it.
  - Curated lucide icon map `RULE_ICONS`: ArrowUp/Down/Left/Right,
    Check, X, Pause, Play, Square, Star, Minus, Plus, Equal,
    AlertCircle, AlertTriangle. Unknown names render no icon.
- **`Field.jsx` — value-direction colors (fallback under rules)**:
  - New helpers `valueSignColor(value)` + `valueSignPillTint(value)`
    return red (negative), blue (null/0/empty), green (positive /
    filled). Used as the default in compact display pill +
    non-compact roBox + Amount input click-to-edit pill WHEN there's
    no target and no `displayRule.color`. Goals with a target keep
    the target-met (green) / not-met (red) colors. The Amount
    input's prior flow-arrow button + flow-cycling click handler
    are removed entirely.
- **`Field.jsx` — Now field shows AM/PM** — `formatTimeOfDay` no
  longer outputs 24-hour clock. `3:45 PM` (minute granularity) or
  `3:45:22 PM` (seconds granularity).
- **`JsonStructureEditor.jsx` (NEW)** — Generic recursive editor
  for arbitrary JS values. Each node has a type pill
  (str / num / bool / null / [ ] / { }) that swaps types with a
  click-cycle dropdown; primitive editors per type; object keys
  rename inline with key-order preservation; array indices have ↑↓
  arrows (disabled at boundaries) and indexed prefix. Add/remove
  buttons per container. Collapsible chevrons with count badges.
  No knowledge of operations / rules / fields — reusable
  wherever structured cfg data needs editing. Used by
  `OperationsBuilder.jsx` as the new `structured` mode in
  `ExprOrPath`.
- **`Toolbar.jsx`** — moved `SocketStatusBanner` out of the left
  section (next to the logo) and into a center-of-toolbar
  absolutely-positioned wrapper so the disconnected pill sits in
  the middle of the header regardless of left/right section
  widths. `pointer-events-none` on the wrapper + `pointer-events-
  auto` on the pill so it doesn't block clicks elsewhere when
  showing.

## Recent Changes (May 19 2026 — Selected chip display config + resolver regression coverage)
- **Field.jsx**: `resolveOccCard(occId, maps, chipDisplay = null)` honors
  the field's `meta.optionsSource.chipDisplay` config. Explicit
  `fieldIds` order wins over the legacy "first 3 non-hidden bindings"
  heuristic. `showLabel:false` hides the label row; `showMedia:false`
  collapses the media slot entirely (zero-width — not just a Link2
  placeholder). `OccurrenceOption` accepts `chipDisplay` prop. All
  four call sites thread `field?.meta?.optionsSource?.chipDisplay`
  through.
- **commandCenter/SelectOptionsSourceEditor.jsx**: New
  `ChipDisplayBody` subcomponent rendered only when `fieldType ===
  "occurrence"` (passed as new prop from FieldsTab). Two toggles
  (Label / Media) + a sorted, multi-select chip list of every grid
  field. Selection is ORDERED (each picked field shows its index
  badge "1.", "2.", …); re-click toggles off. "✕ auto" button
  clears the config to re-enable auto-derive.
- **commandCenter/FieldsTab.jsx**: passes `fieldType={local.type}`
  to the editor.
- **__tests__/optionsResolver.test.js**: 6 new regression tests
  covering the live-seed flat shape (handoff task #8). Confirms the
  resolver correctly filters $allInstances, excludes records with
  missing left-path values (returns null → IS fails), excludes
  container-role records, ignores `predicate.conjunction`, returns
  empty for missing optionsSource (no fall-through to "show all"),
  and respects empty `predicate.rules:[]` as an intentional open
  pool. 28/28 optionsResolver tests + 675/675 total green.

## Recent Changes (May 19 2026 — Daily Question 🎲 randomize button)
- **FieldRenderer.jsx**: `resolveOptions` gate widened to also run
  for any field with `meta.randomizable === true` (was previously
  gated to `select` / `occurrence` types only). Display-only branch
  surfaces a 🎲 button when `canRandomizeDisplay` is true.
  `handleRandomizeDisplay` writes via `CommitHelpers.updateOccurrence`
  with `triggerField` so downstream ops fire as if a user edited it.

## Recent Changes (May 19 2026 — QuickAddMenu field picker on New X)
- **QuickAddMenu.jsx**: Two new states `pickingFields` (null = normal /
  Array = picker open with selected fieldIds) and `fieldSearch`. The
  "New X" button's click handler (`handleClickNew`) opens the picker
  only when `targetRole === "instance"` AND the grid has at least one
  non-trashed field; everything else (containers / panels / pages /
  empty-grid case) short-circuits to immediate `onCreateNew({ fieldIds:
  [] })`. Picker UI takes over the entire menu body: back chevron, count
  header, search input, then a checkable list of every field on the
  grid (read from `fieldsById` via `GridActionsContext`). Footer pinned
  to bottom — `[Skip]` calls `onCreateNew({ fieldIds: [] })`,
  `[Create]` calls `onCreateNew({ fieldIds })`. Both close the menu.
  Category tiles / module list / template tiles all gated on
  `pickingFields == null` so they're hidden while picking.
- **Switch (`components/ui/switch.jsx`)**: Track `h-4 w-7 → h-3 w-5`,
  thumb `h-3 w-3 → h-2 w-2`, `translate-x-3 → translate-x-2.5`. ~28%
  smaller end-to-end. Used by ~every boolean field, Filters/Sort/Field-
  Visibility section toggles. Parent pill padding unchanged so the
  tap target stays roughly the same.

## Recent Changes (May 19 2026 — Rich occurrence-select picker)
- **Field.jsx**: New module-scope `OccurrenceOption` component + `resolveOccCard`
  helper. `resolveOccCard(occId, {occurrencesById,modulesById,fieldsById})`
  resolves the referenced occurrence's module, its `role:"media"` binding value
  (poster, served `/uploads/<val>`), label, and up to 3 non-hidden field
  values. `OccurrenceOption` renders a 34×46 poster (or Link2 placeholder) +
  bold label + tiny field-value chips. `MultiSelectWithAdd` gained an optional
  `renderOption(o)` prop (falls back to the old `<span>{label}</span>`). All
  FOUR occurrence-type paths now render rich rows: compact multi, compact
  single list, non-compact multi, and the non-compact single path — the native
  `<select>` was REPLACED with a rich `<Popover>` list (reuses the existing
  `selectOpen`/`setSelectOpen` state; single-click sets value + closes; trigger
  button shows the selected card). Added `modulesById`+`fieldsById` to the
  `GridActionsContext` destructure; `occMaps` useMemo + `renderOccurrenceOption`
  useCallback. Build exit 0, 669/669 tests green.
- **Field.jsx (task #8 client half — DONE)**: `MultiSelectWithAdd` gained a
  `fieldName` prop; occurrence multi calls pass `fieldName={name}`. When set,
  the compact trigger always shows `name:` prefix + cyan field-pill chrome
  (background/border/color rgba(6,182,212,...)), fixing "occurrence selects
  show no field name / no pill". Select-multi unaffected (no fieldName passed).
- KNOWN-PENDING (task #8 seed/resolver half — see HANDOFF): occurrence dropdowns
  "select anything" even though seed predicates ARE scoped — likely Library
  instances missing the libraryFieldId value OR optionsResolver passing on a
  missing left-path. Per-field chips display config also still TODO.
  Per-field config of which fields the selected chips show — still TODO.

## Recent Changes (May 19 2026 — Operation introspection in CategoryPathPicker)
- **`CategoryPathPicker.jsx`** — Added three new SHAPES (`operation`, `triggerObject`, `sourceBinding`). The `operation` shape exposes raw op keys (id/name/description/enabled/priority/folderId/targetFieldId/triggerObjects/pipeline.sources) plus the ten static-analysis sets the analyzer computes (fields_written / fields_read / occurrences_written / occurrences_read / triggered_by_fields / triggered_by_occurrences / ancestor_scopes / invokes_operations / templates_used / created_modules). Each set drills via `childShape` to the matching array shape so authors can pick e.g. `$op.fields_written.<fid>`. `BUILTIN_VAR_SHAPES.$allOperations = "operationArray"`. `arrayItemsAsKeys` + `descendShape` extended to handle `operationArray / triggerObjectArray / sourceBindingArray`. `segmentDisplay` resolves `op:<id>` tokens to operation names (mirrors `field:<id>` handling).
- **`categoryRegistry.js`** — New top-level "Operations" CATEGORY (amber, Zap icon, between Local Variables and Built-ins). Exposes `$allOperations` plus individual `op:<id>` rows for every operation on the grid (sorted by name). `$allOperations` added to `COLLECTION_ITEMS` so it appears in Loop / Find pickers. `recordShapeForCollection` returns `"operation"` when iterating `$allOperations` so the Find-predicate left-picker drills into operation keys.

## Recent Changes (May 18 2026 — FieldVisibilitySection + fieldVisibility rename)
- **FieldVisibilitySection.jsx (NEW)** — HeaderDropdown section, sibling to FiltersSection, mounted in container/page/panel chevron dropdowns. One mode control: Inherit (`fieldVisibility=null`) / Off (`{mode:"off"}` — show all, ignore ancestor) / Show / Hide (`{mode,fieldIds}` local override). Shows an "Effective: … · Local|Ancestor" readout + field checklist when Show/Hide. Writes `occurrence.fieldVisibility` via `CommitHelpers.updateOccurrence`. Cascade resolved via `getEffectiveFieldVisibilityForOccurrence` (selectors).
- **Editor.jsx** — cell prop `fieldFilter` → `fieldVisibility`; `CellEmbedContext.Provider value={{ displayFieldId, fieldVisibility }}`.
- **CategoryPathPicker.jsx** — tableColumn shape key `fieldFilter` → `fieldVisibility`.
- **Field.jsx** — fixed pre-existing build break: `import GridActionsContext` (default) → `import { GridActionsContext }` (named; the module only has a named export). Was breaking `npm run build` (rollup); unrelated to fieldVisibility work.

## Recent Changes (May 18 2026 — Editor cell mode + ContainerKindSelector table + shared comparators)
- **`Editor.jsx`** — Added opt-in `mode="cell"` prop. When set, doc-only behaviors are gated off (block handle / block menu / auto-create-textblock / onUpdate merge pre-pass all skip) and a cell keymap is layered in: `Enter` → `onCellCommitMove("down")`, `Shift+Enter` allows soft break, `Tab` / `Shift+Tab` → right/left, `Escape` → blur, `ArrowUp/Down` at first/last line → `up/down`. Pill/embed/field extensions and the drop pipeline remain fully enabled. Default `mode="doc"` path is untouched — opt-in only.
- **`ContainerKindSelector.jsx` + `commandCenter/GridSettingsTab.jsx`** — Selector lists `table` alongside list/doc/board/canvas (amber `Table` icon). GridSettingsTab's local `COMPARATOR_OPTIONS` extracted to `helpers/comparators.js` so the table container's per-column filter popover and the grid named-filter editor share one authoritative list.

## Recent Changes (2026-05-17 — D/W/M/Y unit toggle on FilterNav + LocalFilterNav)
- **`FilterNav.jsx` (toolbar variant)**: `formatDateDisplay`/`stepDate` switched from `timeScale` ("daily"/"weekly"/...) to `unit` ("day"/"week"/...). Active filter values can be either a bare `"YYYY-MM-DD"` string OR `{value, unit}` — the value's own unit wins over `activeFilter.timeScale`. Adds a D/W/M/Y pill toggle (rendered when `activeFilter.units?.length > 1` or no `units` declared) that writes the unit back into the filter value via `onFilterValueChange`. Label switches per unit: day → "Thu, May 17", week → "Week of May 12", month → "May 2026", year → "2026". Both mobile and desktop paths render the toggle.
- **`FilterNavWidgets.jsx` (`ArrowsWidget`)**: New `readValueShape` / `stepByUnit` / `formatPeriodLabel` helpers + `UNIT_LABELS` / `UNIT_ORDER` constants. Stepping uses `Date#setDate`/`setMonth`/`setFullYear` (NOT fixed ms — month/year length varies). Unit toggle renders inline next to the prev/next arrows. Writes back as object form `{value, unit}` when unit !== "day" or the incoming value was already object-shaped; otherwise preserves bare-string form for byte-identical day-only paths.

## Recent Changes (2026-05-17 — Multi-dim display fields with columns)
- **`Field.jsx`**: Array display branch added before the default number/text/date fallback. When `field.displayConfig.columns` is a non-empty array AND `rawDisplayValue` is an array, renders a CSS-grid table with column headers + rows. Each column entry: `{ path: string, header: string, width?: number }`. `path` is the key to read from each row object. Falls back transparently to scalar rendering in all other cases.
- **`commandCenter/FieldsTab.jsx`**: New `ColumnEditor` inline component (module-scope, before FieldPill). Renders per-column rows of `[path] [header] [px-width] [↑] [↓] [✕]` inputs + "Add column" button. Wired into `FieldDetail`'s `displayEnabled === true` block as a separate "Columns (for array values)" section. Changes write to `local.displayConfig.columns` and are persisted with the normal save.

## Recent Changes (2026-05-17 — Occurrence multi-select add-new wiring)
- **`Field.jsx`**: Added `createLeafInstanceInParent` import from CommitHelpers + `GridActionsContext` import. Inside `Field`, reads `{ dispatch, socket, gridId, userId, occurrencesById }` from context. Derives `occurrenceAddNewCfg` from `field.meta.optionsSource.addNew` (only for occurrence+multiSelect fields). New `handleOccurrenceAddNew({ label })` `useCallback` (declared AFTER `handleChange` to avoid TDZ): resolves parent occurrence from `occurrencesById[addNew.parentOccurrenceId]`, calls `createLeafInstanceInParent` with `addNew.stampFields`, then uses `Promise.resolve().then(...)` to overwrite the intermediate slug that `MultiSelectWithAdd` pushes synchronously. Both compact and non-compact occurrence multi-select paths pass `occAddNew = occurrenceAddNewCfg ? handleOccurrenceAddNew : null` to `onAddOption`.

## Recent Changes (2026-05-17 — $this in find-mode option predicates)
- **`FieldRenderer.jsx`**: `resolveOptions` call now passes `occurrence ?? null` as third arg (`ownerOccurrence`). Dep array gains `occurrence` so options re-resolve when the owner's field values change. Owner occurrence is already available as the `occurrence` prop on `FieldRenderer`.
- **`CategoryPathPicker.jsx` (`BUILTIN_VAR_SHAPES`)**: Added `$this: "occurrence"` so the path picker drills into occurrence-shape keys when the user picks `$this` (fields, label, id, _ancestors, etc.).
- **`categoryRegistry.js` (Built-ins category)**: Added `$this` entry — title `$this`, sub `occurrence`, description "The current instance — the row this field is bound to (available in find-mode option predicates)", `hasChildren: true`. Users can now discover `$this` in the picker's Built-ins tile.

## Recent Changes (2026-05-17 — Select options source refactor + occurrence field type)
- **`commandCenter/SelectOptionsSourceEditor.jsx` (NEW)**: three-mode editor (Manual / Range / Find) written into `field.meta.optionsSource`. Find mode wires `CategoryPathPicker` (collection + path + value/label/sort paths), `ConditionGroup` (predicate), and a live preview via `resolveOptions`. Used by both select and occurrence field types via `FieldsTab.jsx`'s `["select", "occurrence"].includes(local.type)` conditional.
- **`Field.jsx`**: all `meta.options` reads swapped to `meta._resolvedOptions` (Task 6). Non-compact select branch rewritten from Radix `<Select>` to `<Popover>` to host the search-when-many input (Task 12 — Radix Select doesn't accept a custom input child cleanly). Compact + non-compact occurrence branches added, with `meta.multiSelect: true` support (uses `MultiSelectWithAdd`). The `formattedValue` switch handles array values for occurrence.
- **`FieldRenderer.jsx`**: the old `_moduleOptions` resolution branch is GONE. Both select and occurrence types flow through one `resolveOptions` call exposed under `field.meta._resolvedOptions`. Randomize button gated on `(select || occurrence) && resolvedOptions.length > 1`.
- **`FilterNavControl.jsx` + `FilterNavWidgets.jsx`**: now pull `occurrencesById / modulesById / fieldsById / foldersById` from `GridActionsContext` and pass them to `resolveOptions` — needed for find-mode filter widgets to resolve.

## Recent Changes (May 15 2026 — Cascade-aware nav widget rendering + HeaderChevron filter-state color)
- **LocalFilterNav.jsx + FiltersSection.jsx (`navItems`)**: Both now consult the occurrence's own `getEffectiveFilterForOccurrence` and skip rendering a nav widget when the field isn't in it (cascade cleared by own override or any ancestor). Solves the "deactivated container still shows the date nav" complaint — non-Schedule/Goals pages and their containers now render zero nav widgets.
- **FiltersSection.jsx (per-row Nav switch)**: `navOn = navOnRaw && effectivelyActive` — the Nav switch reflects effective state, not just the persisted `filterNavConfig.visible` flag. A deactivated filter shows Nav=OFF here even before any explicit hide is written.
- **HeaderChevron.jsx**: Now accepts `occurrence` prop and computes filter state internally (`active` / `deactivated` / `none`). The `Filter` icon is `fill`+`stroke` colored:
  - `active` (any contributing fieldId in `ownEffectiveFilter`) → muted green `rgba(80, 150, 100, 0.85)`
  - `deactivated` (filters declared but all cleared at this level) → muted red `rgba(170, 90, 90, 0.85)`
  - `none` (no filters touch this occurrence) → default outline (no fill)
  Uses muted swatches per user request — readable signal without bright shouting. Wired through ModuleContainer (`occurrence={containerOccurrence}`), ModulePanel (`occurrence={panelOccurrence}`), and ModulePage (`occurrence={occurrence}`).

## Recent Changes (May 15 2026 — FiltersSection: cascade-aware Active toggle + auto-hide nav on deactivate)
- **FiltersSection.jsx**: Active toggle on each ancestor row now reads from THIS occurrence's OWN effective filter (`getEffectiveFilterForOccurrence(occurrence, ...)`) instead of just checking the local mute. Catches every "off" path uniformly: own `filterOverride: {}` (page clears all — Daily Toolkit / Todo / Notes / Canvas pages from the seed), own `filterOverride[fid] = null` (per-field mute), AND any ancestor that cleared above. Toggle behavior:
  - **OFF → ON**: if locally muted, drop the null (cascade flows again). If page-wide cleared OR ancestor-cleared, write today (`localDayISO()`) to local override to force-re-enable on this occurrence.
  - **ON → OFF**: mute via null AND auto-hide the nav widget (`setNavVisible(navFilterId, false)`) — per user request, deactivating a filter shouldn't leave its nav widget visible. Two switches stay semantically linked. User can re-show Nav independently after re-activating.
  - Value column: shows `—` when the field isn't in `ownEffectiveFilter` AND no local override exists (rather than misleadingly falling back to today).

## Recent Changes (May 15 2026 — FiltersSection uses shared parent resolver)
- **FiltersSection.jsx**: `parentEffectiveFilter` and the `ancestorRows` walk no longer do their own `occurrence.parentId`-only walk (which returned the grid default for any occurrence linked via `occurrences[]` instead of `parentId` — e.g. the Physical goal container under Daily Goals → child filter row showed today instead of the page's tomorrow override). Both now use the shared `getParentOccurrence` (selectors.js) + a single `buildParentMap` (`helpers/dragHitTesting`) reverse map memoized once per `occurrencesById`. Cascade display now reflects ancestor filter overrides correctly.

## Recent Changes (May 15 2026 — Lists tab removed from Command Center)
- **CommandCenter.jsx**: Removed the "Lists" tab — `ListsTab` import, the `{ id: "lists", label: "Lists", icon: List }` TABS entry, the `{activeTab === "lists" && <ListsTab />}` render line, and the now-unused `List` lucide import. Command Center is now 9 tabs (was 10): grid / fields / operations / templates / appearance / files / connections / settings / shortcuts.
- **commandCenter/ListsTab.jsx — DELETED.** It managed `grid.iterations[].categoryOptions` (compound-iteration category value lists); user is taking a different route and won't use it. No other file imported it (only CommandCenter.jsx). The `commandCenter/ Subfolder` table below still lists it for history — entry is stale.

## Recent Changes (May 14 2026 — FilterNavWidgets: select style + FiltersSection local filter wiring)
- **FilterNavWidgets.jsx** — added `SelectWidget` (native `<select>` with a leading "— any —" option that writes `null` to clear). Routed via `style === "select"` in the main dispatch. Used by the schedule-page Time Slot filter, which has 48 slot labels — too many for the default pills layout. Authors opt in via either `filter.style` on a local `occurrence.filters[]` entry or `occurrence.filterNavConfig[id].style`.
- **FiltersSection.jsx** — the nav-widget loop now sources widgets from BOTH `grid.namedFilters` AND `occurrence.filters[]`. Local entries qualify when `active && showNav && fieldId`. Each local entry's `style` / `options` synthesize an inline `navConfig` so `FilterNavWidget` reads them. Dedupes by `fieldId` against grid widgets — prevents the schedule page's legacy `schedFilterId` (date) from rendering a duplicate widget next to grid `filter_daily` (also date). `handleNav` writes `filterOverride[fieldId]` via plain `updateOccurrence` (NO descendant-cascade NavigationOp burst — visibility resolves through the cascade at render time).

## Recent Changes (May 13 2026 — HeaderDropdown + Templates v2)
- **HeaderChevron.jsx (NEW)** — tiny `ChevronDown` button mounted in module headers. Opens HeaderDropdown.
- **HeaderDropdown.jsx (NEW)** — overlay shell, portal-rendered with `position: fixed` (no reflow), ESC + outside-click close. Hosts FiltersSection + TemplatesSection.
- **FiltersSection.jsx (NEW)** — inside HeaderDropdown. Per-filter Active toggle (writes `filterOverride[fieldId] = null` to mute), Show-nav switch + style picker (writes `occurrence.filterNavConfig[filterId] = { visible, style?, options?, step? }`), inline FilterNavWidget when visible.
- **TemplatesSection.jsx (NEW)** — inside HeaderDropdown. Kind-matched template radio list + Apply, "Save as new template" input + Save, "Save over <name>" button (only when `occurrence.meta.appliedFromTemplateId` is set).
- **FilterNavWidgets.jsx (NEW)** — type-dispatched (arrows/pills/input/custom). Default export `FilterNavWidget` plus helpers `defaultStyleForFilter`/`derivedOptionsForFilter`. Used by FiltersSection's inline preview AND by LocalFilterNav.
- **LocalFilterNav.jsx (REWRITE)** — now reads `occurrence.filterNavConfig` and renders one FilterNavWidget per visible filter. Old `isNav` condition reading + Lock/Unlock affordance fully removed.
- **FilterButton.jsx + LocalFilterButton.jsx — DELETED.** All filter access lives in HeaderDropdown's chevron.
- **QuickAddMenu.jsx** — accepts `hostOccurrence` prop, surfaces template tiles for allowed child kinds; click → `commitApplyTemplate(socket, { templateOccurrenceId: tpl.id, targetOccurrenceId: hostOccurrence.id, mode: "append" })`.
- **commandCenter/TemplatesTab.jsx (NEW + replaces old stub)** — two-pane: left = templates manifest tree, right = Apply To… picker (flat select keyed off template kind→target role mapping) + Apply button.
- **CommandCenter.jsx** — registers `templates` tab between `operations` and `appearance`.

## Recent Changes (May 11 2026 — QuickAddMenu kind filter + tile-style "New X" buttons)
- **QuickAddMenu.jsx**: Added `ALLOWED_KINDS_BY_ROLE` — when adding to a container (`targetRole="instance"`) the picker filters out anything that isn't `list / textblock / artifact`. Was: doc-kind instance modules (mini-blocks minted by Editor's "Make mini block") showed up as a "Documents" tile under the container's add menu, which the user could not actually drop in a list container.
- **QuickAddMenu.jsx**: The "New ${role}" + "New Textblock" buttons (shown in category-tile mode) are now rendered as the same 24×24 icon-block + title + sub tile layout as the category rows, with an accent-blue icon background instead of role color. The bottom of the category view is now visually consistent — no more flat blue text rows mixed with rich tiles.

## Recent Changes (May 11 2026 — Instance popover crash + ContainerKindSelector vocab)
- **InstanceForm.jsx**: Added `Plus` to the lucide-react import. `SiblingLinksSection`'s "Link sibling" button (line ~429) renders `<Plus />` outside the `showPicker` conditional — so opening the instance settings popover at all blew up with "type is invalid: expected a string but got undefined". The crash made the Fields tab inaccessible; now the popover renders cleanly. No tab-level reshuffle needed.
- **ContainerKindSelector.jsx**: Replaced the legacy `list / doc / log / smart` kind set with the canonical `list / doc / board / canvas` set so the add-container surface matches the QuickAddMenu category vocabulary (Lists / Documents / Boards / Artifacts / Textblocks). `log` and `smart` were unused dead options. Icon for Canvas is `PenTool`; Board is `LayoutGrid` (was the old smart icon).

## Recent Changes (May 10 2026 — Compact date pill: picker actually opens)
- **Field.jsx (compact `type === "date"`)**: Two fixes for "Due field isn't being set":
  1. Stored seed values are full ISO timestamps (`2026-05-12T15:34:56.789Z`); `<input type="date">` silently rejects anything that isn't `yyyy-MM-dd`, so the picker opened with no current value. Added a `toInputDate(v)` normalizer (uses local-tz `getFullYear/Month/Date`) that runs every render before passing `value` to the hidden input. Display layer (`formatted`) now also uses this normalized form.
  2. The hidden input is `position:absolute; opacity:0; width:0; height:0; pointer-events:none` (so it doesn't visually appear) — label-click forwarding wasn't reliably triggering Chrome/Firefox's date picker on a 0×0 invisible input. Wired `inputRef` to the input and added `onClick={openPicker}` on the wrapping `<label>` that calls `inputRef.current.showPicker()` (with try/catch in case it's already open). Reuses the existing `inputRef` declared at the top of the Field component (only used by click-to-edit number/text/duration branches, which never overlap with date type).

## Recent Changes (May 6 2026 — FIND candidate rows show ancestor breadcrumb)
- **commandCenter/OperationLogPanel.jsx (`FindCandidates` candidate row)**: When the executor attaches `c.ancestorLabels` (root → leaf), the candidate row now renders the chain joined with ` › ` between the candidate's `NameRef` and the score badge. Without this, multiple occurrences of the same template (e.g. several "Drink Water" instances seeded across schedule slots) all read identically — only short ID disambiguated them. The path lets the user tell "Drink Water in Daily Toolkit" from "Drink Water in Center Hub › Schedule › 6:00am" at a glance and confirm whether seeded items are actually in the iteration pool.

## Recent Changes (May 6 2026 — Path picker exposes $allPanels + uncapped candidates)
- **categoryRegistry.js (`COLLECTION_ITEMS`)**: Added `$allPanels` (after `$allPages`) so the picker exposes both the page-role and panel-role slices. `$allPages` description updated to "Every page-role occurrence (Schedule, Daily Toolkit, …)" — was misleadingly labelled "page-role panel".
- **CategoryPathPicker.jsx (`BUILTIN_VAR_SHAPES`)**: Added `$allPanels: "occurrenceArray"` so the path picker drills into panel records correctly.
- **commandCenter/OperationLogPanel.jsx (`FindCandidates`)**: No longer capped — the executor now retains every iterated record's evaluation. Header still surfaces total iterated; "and N more not shown" footer auto-hides when totals match.

## Recent Changes (May 6 2026 — FIND log row reads boundVars + per-candidate breakdown)
- **commandCenter/OperationLogPanel.jsx (`ActionBody` FIND branch)**: Threaded `boundVars` and `candidates` props through the entry → ActionBody chain. The FIND row now derives its "found" display from `boundVars[cfg.itemVar]` / `boundVars[cfg.itemIdVar]` (single record, single id, multiple records, or multiple ids) and falls back to the legacy `result?.[0]` only if `boundVars` is absent. Multi-result FINDs render `✓ N matches · Name + (N-1) more`. No-match still renders `(no match)`.
- **commandCenter/OperationLogPanel.jsx (`FindCandidates` component)**: New collapsible "comparisons" row appears under each FIND. Header reads `not found · show all N comparisons` (or `show all N comparisons` on match). Expanding lists each iterated record with a `score/total` badge (green when full match, amber on near-miss). Each candidate is itself expandable to render every leaf rule with `✓/✗`, the record's actual leftValue, the comparator, and the resolved rightValue. Matched record gets a green left-border + sorts to the top. Caps to top 25 by score with a "and N more not shown" footer to keep the run log small.

## Recent Changes (May 3 2026 — Specialized picker configs for Find + Loop)
- **CategoryPathPicker.jsx (`config.recordShape`)**: New config option that bypasses the category-picking step entirely. When set, level 0 lists the keys of the named shape (`occurrence` / `templateArray` / `fieldArray`); subsequent levels drill via each item's `childShape`. Committed values are dotted record paths with no `$`-prefix and no leading category id (`label`, `fields.<fid>.value`, `_ancestors`). Used by Find's predicate left-picker, which iterates a chosen collection and evaluates each rule against the current record. The breadcrumb root shows "Record" instead of "Categories" in this mode.
- **categoryRegistry.js (`COLLECTION_PICKER_CONFIG`)**: New exported config — single "Collections" category whose items are the seven iterable built-ins ($allOccurrences / $allItems / $allContainers / $allPages / $allInstances / $allTemplates / $allFields), each as a `hasChildren: false` leaf so picking commits in one click. Used by Loop's `overExpr` and Find's `over`.
- **categoryRegistry.js (`buildRecordKeyPickerConfig(over)`)**: Factory that returns `{ recordShape: "occurrence" | "templateArray" | "fieldArray" }` based on the chosen collection. Wired into Find's predicate left-picker.
- **categoryRegistry.js (`recordShapeForCollection`)**: Pure helper mapping `$allTemplates`→`templateArray`, `$allFields`→`fieldArray`, everything else→`occurrence`.

## Recent Changes (May 3 2026 — Path picker: built-in collections + friendly chip rendering)
- **categoryRegistry.js**: "Occurrences" category now always exposes `$allItems` and `$allTemplates` at the top (executor populates these unconditionally), plus any source-bound collections. "Fields" category now leads with `$allFields`. "Built-ins" category gained `$trigger` and `$parentFilter` — both are runtime-built scalars/objects so the picker exposes them without needing a Source row. Fixes "selecting Occurrences sends me to an empty menu" when no Source binds an `allOccurrences/allContainers/...` type.
- **CategoryPathPicker.jsx (`BUILTIN_VAR_SHAPES`)**: New constant maps `$allItems` / `$allOccurrences` / `$allContainers` / `$allInstances` / `$allPages` → `occurrenceArray`, `$allTemplates` → `templateArray`, `$allFields` → `fieldArray`, `$parentFilter` → `filter`, `$trigger` → `occurrence`, `$grid` → `grid`. `itemsForLevel` checks this map BEFORE falling through to source/permissive resolution, so built-ins drill correctly even without a matching Source binding. Same map handles `$parentFilter.<fieldId>` paths so the user can drill into ancestor-filter values directly. Replaces the prior hard-coded `if (variable === "$grid")` / `"$trigger"` branches.
- **CategoryPathPicker.jsx (`arrayItemsAsKeys` + `descendShape`)**: New `fieldArray` shape — drilling `$allFields[*]` exposes id / name / type / meta / folderId. `arrayItemsAsKeys` now takes `ctx` so `occurrenceArray` can drill the full SHAPES.occurrence keys (was passing `undefined` previously, harmless because `SHAPES.occurrence.keys()` ignores ctx for everything except `_effectiveFilter`'s child filter map).
- **CategoryPathPicker.jsx (`segmentDisplay`)**: New helper resolves a chip segment to a friendly display label — `field:abc123` → field name, raw fieldId (filter-map key) → field name, raw module/occurrence id → module label. Falls back to the raw segment when nothing matches. Wired into the closed-state chip render so paths like `$page._effectiveFilter.<fieldId>` or `field:abc.value` show `[Page] [_effectiveFilter] [Date]` instead of the raw IDs. The chip's `title` attribute keeps the raw segment so hovering shows the underlying value for debugging.
- **__tests__/categoryRegistry.test.js**: Updated to assert built-ins now appear: "Occurrences" includes `$allItems`+`$allTemplates` even with empty sources; "Fields" includes `$allFields`; "Built-ins" includes `$trigger`+`$parentFilter`.

## Recent Changes (Apr 30 2026 — Path picker: solid surface + permissive `$var` drilling + `_effectiveFilter`)
- **CategoryPathPicker.jsx (`itemsForLevel`)**: Level-2+ shape resolution now defaults to `"occurrence"` for any unrecognized `$var` (was: only when `chain[0] === "localVars"`). `$grid` still maps to `"grid"`, `$trigger` maps to `"occurrence"` (its enriched payload is occurrence-shaped). Eliminates "Nothing to drill into here" dead-ends when picking a local var declared by an INIT_VAR / loop-as out of normal localVars context.
- **CategoryPathPicker.jsx (`SHAPES.occurrence`)**: New drillable key `_effectiveFilter` (childShape: `"filter"`) so users can pick e.g. `$schedPage._effectiveFilter.<dateFieldId>` directly instead of typing the path.
- **CategoryPathPicker.jsx (`SHAPES.filter`)**: Now surfaces every grid field from `ctx.fields` as a per-key item (was just a virtual `date` accessor). Filter map is keyed by fieldId so the picker has to expose them.
- **CategoryPathPicker.jsx (styles)**: Dropdown bg upgraded to `var(--surface, #1f2125)` with a heavier shadow, breadcrumb gets its own `--input-bg` band, and tiles render with a solid bg + subtle border (was `transparent`). The open panel was reading as see-through against the editor; now it's a real surface.
- **categoryRegistry.js**: Removed dev `console.log("hit"); console.log(ctx)` from `resolveCategoryItems`.

## Recent Changes (Apr 30 2026 — LocalFilterNav/Button → ancestor-scoped NavigationOp)
- **LocalFilterNav.jsx**, **LocalFilterButton.jsx**: Both now read `modulesById` from `GridActionsContext` and forward `occurrencesById` + `modulesById` (plus `navFieldId` + `date`) into `updateOccurrenceFilterOverride`. The helper-side NavigationOp fire — which carries `_ancestorIds` / `_ancestorLabels` — now runs on every local-filter change, so `onFilterChange` triggers configured with `ancestorId` / `ancestorLabel` actually match. Removed the manual `operationsBridge.fireOperations("NavigationOp", …)` calls that used to follow the override write — they had no ancestor data, so per-page goal/seed ops were silently ignored. Removed the now-unused `operationsBridge` import from LocalFilterNav.

## Recent Changes (Apr 30 2026 — Operations editor overhaul)
- **CategoryPathPicker.jsx (NEW)**: Config-driven, category-first path / entity picker. Closed: fluffed-out chip chain joined with `›` (no dots) + clear button. Open: level-1 renders 5 category tiles (Sources / Occurrences / Fields / Local Variables / Built-ins) — rich rows (icon block / title / sub / description). Drill-in walks a SHAPES map; every row with `hasChildren` exposes a "Pick this" chevron (`data-testid="pick-this-{value}"`) so any level is stoppable. Accepts a `config` prop with custom categories — used by SourceRow for entity/effective-filter selection. 7 unit tests cover every interaction. (B1, B2, B3, B4, B17)
- **categoryRegistry.js (NEW)**: Pure data layer for the picker. Five top-level categories, each with `resolveItems(ctx)` that produces rich items (title, sub, description, hasChildren). Occurrences items only render when a Source binds an `allOccurrences/allContainers/allPages/allInstances/allTemplates` entity type — no more auto-exposed `$allItems`. (B5, B6)
- **SelectDrilldown.jsx (`buildPathConfig`)**: Removed auto-exposed `$allItems`/`$allTemplates`/`$parentFilter` from `shapeByVar`. `shapeByVar` now derives entirely from the source list (each source maps to a shape per its entityType). `localVars` still register as permissive occurrence-shaped vars. (B5, B6)
- **QuickAddMenu.jsx**: Two-tier picker — when matching modules span more than one `kind`, level-1 shows category tiles (Lists / Documents / Boards / Artifacts / Textblocks) with the same row layout as CategoryPathPicker; click drills into the filtered list. Single-kind targets skip the category step. Categories ← back button on level 2. (B18)
- **commandCenter/OperationsTab.jsx**: Sticky-header Save button (accent-blue) returns to operations list (live-saving stays on every edit). onFilterChange triggers gain `ancestorId` + `ancestorLabel` text inputs — visible only when eventType is onFilterChange. (B10, B16)
- **commandCenter/OperationLogPanel.jsx**: No code changes; the inlineLiteral / JsonNode tree was already array-aware. The fix for B13 was removing the executor-side stringification (`[Array(N)]`) that was bypassing this. (B13)

## Recent Changes (Apr 29 2026 — Path picker: full path + clear button + no $trigger drilldown)
- **SelectDrilldown.jsx**: `chipChainSt` no longer truncates — `whiteSpace: normal` + `wordBreak: break-word` + `maxWidth: 100%`. The chip-chain wraps to multiple lines if the path is long but every segment stays legible end-to-end. `resolveSegmentLabel` no longer abbreviates unresolved IDs; segments render verbatim when `labelForId` can't resolve them.
- **SelectDrilldown.jsx (closed-state trigger)**: Once a value is selected, the chip area is **not** clickable — clicks no longer reopen the drilldown. To change the value the user clicks the new × button on the chip (clears that chain) and then clicks the empty-state placeholder pill to pick a new path. Fixes "the path field is still clickable even when I have a path selected" complaint.
- **SelectDrilldown.jsx (`buildPathConfig`)**: `$trigger` removed from `shapeByVar`. Trigger data is no longer drillable in the path picker — to use a trigger property in a pipeline, the user must add a Source row of `entityType: "trigger"` with a `triggerProp`, which promotes it to a named `$var`. That `$var` then appears in the picker. Forces explicit declaration of which trigger props the pipeline needs.
- **SelectDrilldown.jsx (`shapeByVar`)**: Iteration vars dropped (`$iterationValue`); added `$activeDate` / `$activeDateLabel` / `$activeDayOfWeek` so date pickers can drill those.

## Recent Changes (Apr 29 2026 — OperationsTab: onLoad in event-type dropdown, no toggle)
- **commandCenter/OperationsTab.jsx**: Removed the standalone "Run on load" pill toggle that lived above the trigger rows. `onLoad` is now a normal entry in the event-type `<select>` for each trigger row. Switching a trigger to `onLoad` (or `onFilterChange`) auto-snaps `subjectType` to `grid` (or `filterNav`) and clears any stale `subjectRole`/`targetId`. Removed `hasOnLoad`/`toggleOnLoad` helpers. The short-symbol map for event-type chips lost `onIteration: "⟳"`.
- **commandCenter/OperationsTab.jsx (`getTriggerVars`)**: `filterNav` subject's hint vars updated from `$trigger.iterationId / iterationValue / categoryValue / previousValue` to `$trigger.activeFilterValues / date / previousValue` — matches what `bindSocketToStore.onGridUpdated` actually puts on the NavigationOp transaction.

## Recent Changes (Apr 28 2026 — OperationLogPanel: vertical params + JSON tree + resolved values)
- **commandCenter/OperationLogPanel.jsx**: Second pass on the rewrite. Goals: parameters stack vertically, all JSON is an expandable tree (not a single `<pre>` blob), and resolved variable values appear inline next to the original expressions.
  - **Vertical params**: each step body now uses a `display: grid; grid-template-columns: max-content 1fr` layout via `ParamRow`. FIND shows `where:` (predicate rules), `scope:`, `result id →`, `found:` etc. on separate rows. CREATE shows `name`, `role`, `kind`, `parent`, `fields`, `date` each on its own line. INIT_VAR splits into `name` + `value` rows with the resolved value indented underneath when different.
  - **Predicate readout** (`GroupRows` + `RuleRow`): each rule is its own block with a left-border accent. Renders `$item.label IS "$preset.moduleLabel"` on the first line, then `→ resolves to: "Drink Water" IS "Drink Water"` underneath when the executor's `resolvedPredicate._leftValue` / `_rightValue` differ from the raw expr. ID-shaped strings are routed through `NameRef` so they appear as friendly names instead of long IDs.
  - **JSON tree** (`JsonNode` + `JsonTree`): replaces the old `<pre>JSON.stringify(...)</pre>` raw block. Every object/array becomes a click-to-expand chevron with a header like `Array(48)` / `Object{5}`. Children indent recursively. ID strings inside the tree render as `Name …shortId`. `<details>`-based wrapper at the step level so the user can quickly drill into `step JSON`, `iteration value`, `all changes`, etc.
  - **Per-iteration loop rows**: new entry kind `loop_iter` from the executor renders as `#3/4` badge + `$preset = {2 fields}` with the iteration's full value behind a JSON tree expander. Lets the user see what the loop variable actually held on each pass.
  - **Var snapshot per step**: each action/if step has a `variables when this ran` expander. Lists every user-facing `$var` at that moment using the same `JsonNode` tree. This is what surfaces "$schedDate is empty here, that's why nothing happened."
  - **Outcome lines** (`OutcomeLine`): green-checked rows for `Created item / Updated field / Linked to parent`, with `field:`, `on:`, `under:` references using `NameRef`. Now used both inline (under the producing action) and in the `DONE` summary.
  - `inlineLiteral(v, maps)` helper: pretty-prints a single primitive — wraps strings in quotes, formats arrays/objects as `[N items]`/`{K fields}`, and routes ID-shaped strings to `NameRef` so they render as friendly names everywhere.

## Recent Changes (Apr 28 2026 — OperationLogPanel: plain-English readout)
- **commandCenter/OperationLogPanel.jsx**: Full rewrite of the visual layer (data layer untouched). Goals: a non-developer should be able to read a run and tell what each step did and why nothing came out. Changes:
  - Action types render with a verb + icon (`FIND` → "Look up" 🔍, `CREATE` → "Create" ➕, `INIT_VAR` → "Set" 𝑥, `LOOP` → "Loop" 🔁, `IF` → "IF · YES/NO"). The raw action type name is gone from the primary line.
  - Each action shows a one-line description derived from its `cfg` — e.g. `where $item.label IS "Schedule" → $schedPageId ✓ found`, `$schedDate = $today`, `Created item Due under $schedPageId`. No JSON in the primary view.
  - "Effects" renamed to "changes" / "outcomes". `OutcomeRow` (was `EffectRow`) shows "Created item", "Updated field", "Linked to parent", etc. — never raw `_effect` constants. Green checkmark + icon per outcome.
  - Status badge per run is now wordy: "3 changes" / "no-op" / "FAILED" (was a number or "ERR").
  - Loop entries show `over $allItems as $item — 80 items` in plain English.
  - Trigger details line breaks out `date / occurrence / field` for the trigger, with the rest tucked into a `RawDetail` toggle labelled "trigger details".
  - All raw JSON is hidden behind a small `‹/›ᴿ raw data` toggle; when expanded, indented 2-space JSON in a scrollable `<pre>`. Default-collapsed everywhere except the start row.
  - Indent prop added to `Row` so future nested loop bodies can shift right (currently flat — depth comes from logger entries when populated).

## Recent Changes (Apr 24 2026 — isNav replaces primaryDateFieldId)
- **LocalFilterNav.jsx**: Rewrote to use `navConditions = conditions.filter(c => c.isNav && c.fieldId)`. Shows whenever any condition has `isNav: true`. Navigates all nav condition fields at once. Removed `primaryDateFieldId` dependency.
- **LocalFilterButton.jsx**: Same — replaced `primaryDateFieldId` with `primaryNavFieldId` (first nav condition's fieldId). `navigate()` and `setDate()` update all nav condition fields in the override.
- **commandCenter/GridSettingsTab.jsx**: `FilterRow` redesigned — removed `primaryDateFieldId` select. Added expandable conditions panel (chevron toggle) with per-condition rows: field picker, comparator picker, `isNav` toggle button (Navigation icon, blue when active), delete. `addFilter` seeds new filters with a `[{fieldId, comparator: "SAME_DAY", isNav: true}]` condition using first date field found. Added `COMPARATOR_OPTIONS` constant (11 comparators). Imports: added `ChevronDown, ChevronRight, Navigation`.


## Recent Changes (Apr 18 2026 — Phase F: Sources Consolidation)
- **commandCenter/OperationsTab.jsx**: Removed duplicate outer Sources section from `OperationEditor` (was writing `varName` — orphaned, not read by executor). Removed `SOURCE_ENTITY_TYPES` constant. The `PipelineEditor` (in blocks/OperationsBuilder.jsx) is now the single source UI — it uses `variableName`, which matches what `operationExecutor.js` and `PathPicker.buildPathShape` both read.

## Recent Changes (Apr 17 2026 — OperationLogPanel: Run History)
- **commandCenter/OperationLogPanel.jsx** (NEW): Renders run history for an operation — list of past runs (newest first), each row collapsible to show step entries. Subscribes to `subscribeToOpLog(opId, fn)` so trigger-fired runs append live. "Run" button calls `executePipeline` with a synthetic manual trigger to append a fresh entry. Capped at 20 runs in executor (RUN_HISTORY_LIMIT). RunRow shows time, status badge (update count or ERR), trigger type, relative timestamp, duration. LogEntry renders per-step breakdown (start/sources/action/if/loop/end/error) with color-coded badges.
- **commandCenter/OperationsTab.jsx**: Drill-down view (when an operation is selected) now renders OperationEditor + OperationLogPanel side-by-side (60% / 40%). Log panel sticky-positioned at top: 50.

## Recent Changes (Apr 15 2026 — OperationEditor hooks violation fix)
- **commandCenter/OperationsTab.jsx**: Fixed React Rules of Hooks violation in `OperationEditor`. Moved `if (!operation) return null;` from line 336 (before all hooks) to line 369 (after all hooks: `useContext`, `useState`, `useMemo`, `useCallback`, `useMemo`×2). Also fixed state-update-during-render in `OperationsTab`: converted `if (selectedOpId && !selectedOp) { setSelectedOpId(null); }` (inline guard before JSX) to a `useEffect` — prevents double-render and React `WeakMap key undefined` crash when selected op is deleted.

## Recent Changes (Apr 15 2026 — Container Deep Copy into Doc)
- **Editor.jsx**: Container drops in copy mode now perform a **deep copy** — `deepCopyOcc()` recursive helper creates new occurrences for the container AND all its descendants (children, grandchildren, etc.), copying `fields`, `meta`, `dragMode`, `textmap`, and `occurrences[]` (with newly assigned IDs). The embed node gets the new root occurrence ID. Deleting/editing a child in the embedded copy no longer affects the original.

## Recent Changes (Apr 15 2026 — Three Drop Bug Fixes)
- **Editor.jsx**: Instance copy now carries `fields`, `meta`, and `dragMode` from `sourceOcc` (was creating blank occurrence with empty `fields: {}`).
- **Editor.jsx**: `dropTargetForElements` now has `getData: () => ({ type: "doc-editor" })` for downstream identification.
- **Editor.jsx**: Container drop move logic now checks `context.pageOccurrenceId` BEFORE `context.panelId`. Containers in page-based board panels live in a page occurrence, not the panel occurrence — the old code found the panel occurrence but failed to remove the container (filter was no-op). Root cause of "container auto-copies" bug.
- **Editor.jsx**: Container drop handler now has copy/move logic. On move: if `context.sourceType === "doc-embed"` calls `embedDeleteRegistry.get(occurrenceId)?.()` to remove old embed node; if from page (`context.pageOccurrenceId`), removes from page occurrence; if from panel (`context.panelId`), removes from panel occurrence.

## Recent Changes (Apr 15 2026 — Textblock Drop Fix + Embed Radial Menu)
- **Editor.jsx**: Fixed drops into textblock sub-editors. Bug: the `onDrop` guard (`closest('.instance-textblock-block')`) also fired inside the sub-editor's OWN `onDrop`, silently returning before insertion. Fix: added `el.contains(textblock)` check — only the OUTER editor (whose wrapper `el` actually contains the textblock as a descendant) skips; the inner sub-editor (whose wrapper is itself inside the textblock) proceeds normally.
- **docs/ModuleEmbedNode.jsx**: Removed selection-based alignment toolbar (`{selected && ...}` popup). Replaced with always-present `RadialMenu` handle in the top-left corner of the embed. RadialMenu `items` prop: Float left / Center / Float right / Full width (AlignLeft/Center/Right/AlignJustify icons) + Convert to pill (Box icon). Delete via `onDelete`. No popup opens by default on selection. `selected` prop removed from component destructuring.

## Recent Changes (Apr 14 2026 — Doc Drop Bug Fixes: No Duplicate, No Double-Insert)
- **Editor.jsx**: Added `NATIVE_DND_MIME` import from `helpers/dragSystem`. `handleFileDrop` now returns early when `dt.types` includes `NATIVE_DND_MIME` — prevents Pragmatic DnD drags from being processed as native text/file drops. Root cause of "blank textblock" / duplicate instance bug: `text/plain` from drag payload was creating a new module + `instancePill` alongside the `moduleEmbed`.
- **Editor.jsx**: Outer `onDrop` now checks `document.elementFromPoint` at drop coordinates and returns early if the point is inside a textblock that is a DESCENDANT of this editor's wrapper (`el.contains(textblock)`). Prevents the outer doc from creating a second `moduleEmbed` when the drop lands inside a textblock sub-editor.

## Recent Changes (Apr 14 2026 — Shift+Enter Empty Textblock Fix)
- **Editor.jsx**: `handleDOMEvents.keydown` Shift+Enter branch now checks `onDeleteBlockRef.current` first. If the sub-editor doc is empty (`_view.state.doc.textContent.length === 0`), calls `onDeleteBlockRef.current(true)` to replace the textblock with an empty paragraph. Only falls through to `onExitBlockRef.current()` (exit to next block) when doc is non-empty. Uses existing stable refs — no new refs added.

## Recent Changes (Apr 14 2026 — Block-Embed Drop Position Snapping)
- **Editor.jsx**: `resolveInsertPos` now accepts `isBlock = false` param. For block drops, snaps raw `posAtCoords` result to top-level block boundary via `$pos.before(1)` / `$pos.after(1)`, then checks DOM bounding rect mid-point to decide insert before vs after. Field pill drops use `isBlock=false` (raw pos unchanged). `onDrop` sets `isBlockDrop = type !== "field"` before calling `resolveInsertPos`.

## Recent Changes (Apr 14 2026 — Drop Fixes: No Popup + Container Embed)
- **Editor.jsx**: Removed `pendingDrop` state and pill/embed choice popup for instance drops. Instance drops now insert `moduleEmbed` directly (same as containers). The existing ModuleEmbedNode selection toolbar (Pill button when selected) provides pill conversion. Mirrors Apr 6 behavior that was re-reverted.
- **Editor.jsx**: Container drops in docs now work — `context.occurrenceId` is set by ModuleContainer (see helpers/CLAUDE.md). The stale-closure fallback `Object.values(occurrencesById).find()` was failing; direct occurrenceId in context fixes it.

## Recent Changes (Apr 14 2026 — Sub-Editor Arrow + Enter Fix)
- **Editor.jsx**: Added `onExitBlockRef` + `onDeleteBlockRef` (`useRef`) before `useEditor`. Updated every render: `onExitBlockRef.current = onExitBlock`. All `handleDOMEvents.keydown` and `handleKeyDown` handlers now reference `.current` — fixes stale closure bug where Shift+Enter did nothing (callback was captured at `useEditor` init time).
- **Editor.jsx**: Fixed multi-line textblock arrow skipping. `ArrowUp` handler now guards with `$anchor.index(0) === 0` (only exit when cursor is in the first top-level block). `ArrowDown` guards with `$anchor.index(0) === doc.childCount - 1`. Previously `endOfTextblock("up"/"down")` fired at every block boundary, causing the cursor to jump out of the sub-editor instead of moving line-by-line through multi-paragraph content.

## Recent Changes (Apr 12 2026 — InstanceTextblock Integration + Enter/Shift+Enter)
- **Editor.jsx**: Registered `InstanceTextblock` extension (imported from `docs/InstanceTextblockExtension.js`). Added to `useEditor` extensions array alongside existing pill extensions.
- **Editor.jsx**: Added `onCreate` migration callback — on first open, scans doc for `instancePill` nodes with `pillDisplay: "block"` wrapped in lone paragraphs, replaces them with `instanceTextblock` nodes. Migration marks `skipAutoCreate` + `addToHistory: false` and immediately persists. Lazy DB migration — no server script needed.
- **Editor.jsx**: Fixed Enter/Shift+Enter in `handleKeyDown`. Enter (no shift) + `onExitBlock` prop → exits textblock (moves outer cursor to after node). Shift+Enter → stays inside sub-editor (inserts newline). Previously reversed.
- **Editor.jsx**: Updated 3 references from `instancePill+pillDisplay:block` to `instanceTextblock`: (1) list-merge detection, (2) block handle hide on node exit, (3) "Make mini block" context menu item.
- **Editor.jsx**: Auto-create textblock (`handleAutoCreateTextblock` in DocContent.jsx) now inserts `instanceTextblock` node instead of `instancePill+pillDisplay:block`.

## Recent Changes (Apr 11 2026 — Auto-Create Textblock Instant Response)
- **Editor.jsx**: Reduced `onAutoCreateTextblock` debounce from 300ms to 0ms. Timer now fires on the next event loop tick (still re-reads full paragraph text at fire time, so fast typing is captured). Eliminates the ~300ms lag before a typed paragraph converts to a textblock.

## Recent Changes (Apr 11 2026 — Editor Drop/Click/Embed Fixes)
- **Editor.jsx**: Fixed drop ordering — `onDrop` now uses `location.current.input` from Pragmatic DnD (exact drop coords) instead of `lastNativeEvent` from `dragover`, which could be stale.
- **Editor.jsx**: Fixed cursor reset on click — content sync `setContent` now saves selection before call and restores it after (clamps to new docSize). Prevents server echoes arriving between mousedown and focus event from resetting cursor to position 0.
- **Editor.jsx**: Fixed TipTap v3 `setContent` API — now passes `{ emitUpdate: false }` options object instead of bare `false`.
- **docs/pills/InstancePillNode.jsx**: Fixed "Convert to Embed" leaving both pill and embed — replaced `deleteRange + insertContentAt` chain (inserts block into inline context incorrectly) with a single atomic `replaceWith` on the pill's parent paragraph.

## Recent Changes (Apr 10 2026 — Editor Click Delay + Cursor Placement Fix)
- **Editor.jsx**: Added `draggable={false}` to `doc-editor-wrapper` div AND `draggable: "false"` to ProseMirror element via `editorProps.attributes`. Root cause: Pragmatic DnD sets `draggable="true"` on parent container/page shells, causing browsers to intercept `mousedown` to check for drag initiation. This produced a ~250ms delay before cursor appeared, and placed it at position 0 (beginning) because ProseMirror got focus without a positional mousedown. `draggable="false"` on the editor wrapper explicitly opts out of the drag system, restoring immediate click response and correct cursor placement.

## Recent Changes (Apr 10 2026 — Editor Padding + Click Position Fix)
- **Editor.jsx**: Reduced doc-editor-wrapper top/bottom padding from `py-3` (12px) to 5px via inline style `{ paddingTop: 5, paddingBottom: 5 }`.
- **Editor.jsx**: Fixed "beginning of line" cursor placement bug. Wrapper `onClick` (fires when clicking padding area outside ProseMirror) now calls `editor.commands.focus()` instead of `posAtCoords(nudgedX)`. Root cause: nudging `x` to `pmRect.left + 2` (2px into PM left edge, still left of text) caused `posAtCoords` to return position 0 of the nearest paragraph = beginning of line.

## Recent Changes (Apr 10 2026 — Empty Textblock Fix on Module Drop)
- **Editor.jsx**: Fixed empty textblock appearing after moduleEmbed drops. `insertAtPos` now checks if the inserted node is a block-type (`editor.schema.nodes[type].spec.group.includes("block")`). Block nodes (like `moduleEmbed`) skip the trailing `" "` insertion — inline nodes (fieldPill, instancePill) still get the trailing space.

## Recent Changes (Apr 9 2026 — C2: Make Mini Block + Breadcrumbs + Cursor & Drag Fix)
- **Editor.jsx**: Added "Make mini block" right-click context menu item. When text is selected + dispatch/socket/occurrence available: captures selection range at menu-open time, creates module (role: "instance", kind: "doc") + occurrence with selection content as textmap, then replaces selection with `instancePill` block node. Updated `handleContextMenu` deps: `[..., dispatch, socket, occurrence]`. (C2)
- **Editor.jsx**: Added `handleDOMEvents.dragstart` in TipTap `editorProps` — prevents native text-selection drags from starting inside the editor. Only allows dragstart from elements with `data-dnd-handle` or `.module-drag-handle` classes. Text can be selected/highlighted but never dragged.

## Recent Changes (Apr 6 2026 — RadialMenu Linear Strip + Delete + Editor Drops)
- **RadialMenu.jsx**: Items now render as a linear strip instead of radial arc. Direction determines line orientation (right=horizontal right, down=vertical down, etc.). Items spaced 30px apart. Removed rotary animation (wrapper no longer rotates, icons no longer counter-rotate). Added `Trash2` import, `onDelete` prop — when provided, adds red "Remove" button as last item.
- **Editor.jsx**: Removed `pendingDrop` state and pill/embed choice popup. All module drops (instance, container, artifact) now default to `moduleEmbed` (block embed) — no popup dialog. Content sync useEffect now preserves cursor position across `setContent` calls (saves `from/to`, restores after).

## Recent Changes (Apr 2 2026 — Editor Cursor Fix)
- **Editor.jsx**: Added `useEffect` after `useEditor` initialization to call `editor.setEditable(editable, false)` when `editable` prop changes. TipTap's `useEditor` hook doesn't auto-sync `editable` after mount in some v2 versions, causing the editor to remain read-only even after the prop becomes `true`.

## Recent Changes (Apr 2 2026 — Block Menu Portal + Cursor Fix)
- **Editor.jsx**: Block handle menu now renders via `createPortal` to `document.body` at `position: fixed` using viewport coords from `getBoundingClientRect()`. Fixes menu being clipped by `overflow: auto/hidden` ancestor containers (page-shell). Added `blockMenuPortalRef` + `blockMenuPos` state. `blockHandleBtnRef` added to capture button position. `cancelBlockHide()` called on button `onMouseDown` to prevent hide timer from closing handle. Outside-click handler updated to check both `blockHandleRef` and `blockMenuPortalRef`. Import `createPortal` from `react-dom`.

## Recent Changes (Apr 1 2026 — Instance Drop Pill/Embed Choice)
- **Editor.jsx**: Instance drops into doc now show a small popup with "Pill" (inline `instancePill`) vs "Embed" (block `moduleEmbed`) choice. `pendingDrop` state stores `{ occurrenceId, insertPos, dropX, dropY, label }`. Popup appears at drop coordinates, auto-positioned relative to wrapper. Non-instance drops (container, artifact, module) still go straight to `moduleEmbed`. "Turn into instance" context menu item remains commented out.

## Recent Changes (Mar 30 2026 — Uniform Doc Drops + Remove DropReformatPopup)
- **Editor.jsx**: Drop handler rewritten. Instance/container/artifact/module drops now insert `moduleEmbed` TipTap nodes (same component rendering everywhere). Removed `DropReformatPopup` component and `dropReformat` state entirely. Field drops still insert `fieldPill` as before. `canDrop` filter expanded to accept `"artifact"` and `"module"` types. **Fix**: `occurrenceId` resolution now checks `context?.occurrenceId || data?.occurrenceId || sd.occurrenceId` (root-level, for doc pills and tree items). CC drops with no occurrenceId fall back to finding an existing occurrence of the module via `occurrencesById`.

## Recent Changes (Mar 25 2026 — Module Reference Field Type)
- **Field.jsx**: Added `type: "module"` rendering. Compact input: cyan-tinted Popover pill with Link2 icon, searchable module list. Full input: native `<select>` dropdown from `meta._moduleOptions`. Display: `formattedValue` resolves moduleId → label via `_moduleOptions`, with optional `meta.label` prefix. Compact display: cyan pill with Link2 icon.
- **FieldRenderer.jsx**: Extended `effectiveField` useMemo to handle `type === "module"` — builds `_moduleOptions` from `modulesById` (filtered by optional `meta.roleFilter`).
- **commandCenter/FieldsTab.jsx**: Added `"module"` to type dropdown. Module-specific meta config: Label prefix input (`meta.label`) + optional Role filter select (`meta.roleFilter`). FieldPill cyan color for module-type fields.

## Recent Changes (Mar 25 2026 — onLoad Switch in Operations UI)
- **commandCenter/OperationsTab.jsx**: `handleCreate` now defaults new operations to `triggerType: "onChange", triggerTypes: ["onChange", "onLoad"]` (was `triggerType: "manual"`). `OperationEditor` trigger section now has a separate toggle switch for "Run on load" above the trigger rows — green toggle, defaults ON for new ops. `onLoad` filtered out of the configurable trigger row list and the event type dropdown to avoid duplication.

## Recent Changes (Mar 25 2026 — Escape Key Handlers)
- **RadialMenu.jsx**: Added `keydown` listener for Escape inside outside-click `useEffect`. Calls `e.preventDefault()` so parent handlers know it was consumed. Menu now closable via Escape key.
- **QuickAddMenu.jsx**: Added `keydown` listener for Escape inside outside-click `useEffect`. Same `preventDefault` pattern. Menu now closable via Escape key.

## Recent Changes (Mar 23 2026 — Pool Randomize Button)
- **FieldRenderer.jsx**: Added `handleRandomize` callback — picks random option from pool-sourced select fields. Dice button (&#x1F3B2;) renders inline next to pool-sourced select input fields when `inputEnabled`. Input Field now wrapped in `inline-flex` div with the randomize button.

## Recent Changes (Mar 20 2026 — Editor Block Handle + CSS)
- **Editor.jsx**: Increased left padding on `doc-editor-wrapper` from `p-3` to `py-3 pr-3 pl-10` (40px left) — creates space for the block handle buttons so they don't overlap content. Added "Insert module" item to block menu — triggers the existing `@:` embed container picker, positioned at the block handle location.
- **index.css**: Drag handle ball increased from 7×7 to 24×24px (matches radial menu button size). Stem scaled from 3×5 to 5×8px. `.module-drag-handle` top offset changed from -10px to -20px. `.module-drag-handle .radial-handle` increased from 10×10 to 24×24px — flush with ball position.

## Recent Changes (Mar 20 2026 — Pool Lookup Performance)
- **FieldRenderer.jsx**: Pool-sourced select fields had O(n) `Object.values(occurrencesById).find()` inside a loop over pool IDs. Replaced with O(1) `byTargetId` map built once inside the useMemo (only for pool fields — non-pool fields early-return before map construction).

## Recent Changes (Mar 18 2026 — Mobile Fixes)
- **RadialMenu.jsx**: Arc item viewport clamping — each item's final absolute position is clamped to stay within viewport bounds (prevents off-screen items near edges). Arc spread capped to `min(45, 180/(count-1))` degrees to prevent wraparound with 5+ items.

## Recent Changes (Mar 16 2026 — History + CS6b)
- **TransactionHistory.jsx**: Added `moduleId` prop for per-module filtering. When set, only shows transactions where ops match panelId/containerId/moduleId. Updated title to "Module History" when moduleId provided. Added `transaction_created` socket listener for live updates (auto-refreshes when open).
- **RadialMenu.jsx**: Added `onHistory` prop — when provided adds `{ label: "History", icon: Clock, color: amber }` item to default arc.
- **commandCenter/AppearanceTab.jsx**: Replaced "Custom tokens (coming soon)" stub with real localStorage-persisted token editor. Preset tokens: --text-primary, --accent-blue, --accent-green, --border-default, --input-bg. Add/remove arbitrary custom rows. "Apply" saves to localStorage["moduli-token-overrides"] + injects `<style id="moduli-token-overrides">`. "Reset" clears all. Load on mount wired in App.jsx.
- **NotificationsPanel.jsx**: DELETED — bell icon removed per user request.

## Key Files

| File | Purpose | Last Changed |
|------|---------|--------------|
| `ContextMenu.jsx` | **NEW** Portal-based right-click context menu. Props: `ctx={x,y,items}`, `onClose`. Items: `{label,icon?,onClick,danger?,separator?,disabled?}`. Dismisses on outside click or Escape. Viewport-clamped. | **Feb 21** |
| `CommandCenter.jsx` | **Thin shell** — tab bar + conditional render only. 11 tabs including Grid + Appearance (new). | **Mar 16** |
| `commandCenter/` | **Subfolder** — each tab in its own file. See below. | **Mar 16** |
| `PomodoroTimer.jsx` | **CREATED, NOT WIRED**. 25/5/15min pomodoro cycle with SVG ring, play/pause/reset/skip. Deferred to end Phase 6. | **Feb 20** |
| `LayoutForm.jsx` | Panel settings popover. Layout (display/flex/grid/columns), iteration, drag mode, style overrides, **Panel Actions** (Copy/Link/Split/Merge buttons). | **Feb 21** |
| `ContainerForm.jsx` | Container settings. Layout, iteration, drag mode, style overrides, templates (save/fill). | Recent |
| `InstanceForm.jsx` | Instance settings. Fields (allowedFields config), style overrides, autocheck on drop, siblingLinks. | Recent |
| `Field.jsx` | **NEW** Unified field display (replaces FieldDisplay.jsx + FieldPillDisplay.jsx). One look everywhere — no "pill" variant. Props: field, binding, value, target, state, context, compact, hideName, hidePrefix, hidePostfix. | **Mar 9** |
| `FieldRenderer.jsx` | Routes field to Field.jsx (display) or FieldInput/FieldPillInput (input). Now imports Field.jsx instead of FieldDisplay + FieldPillDisplay. | **Mar 9** |
| `RadialMenu.jsx` | Circular action menu. Props: dragMode, onToggleDragMode, onSettings, onAddChild, addLabel, size. | Stable |
| `LocalIterationNav.jsx` | Local iteration arrows on panels/containers. `alwaysExpanded` prop shows without toggle. | Stable |
| `GridFieldsBank.jsx` | Global field management dialog. | Stable |
| `GridRadialMenu.jsx` | Grid-level cog menu (Undo/Redo/Fields/History). | Stable |
| `TransactionHistory.jsx` | Transaction history dialog. z-index: 1100. | Stable |
| `IterationNav.jsx` | Global iteration navigation (time-based). | Stable |
| `IterationSettings.jsx` | Persistence mode selector (persistent/specific/untilDone). | Stable |

## commandCenter/ Subfolder (Mar 12 2026)
Each tab extracted into its own file. CommandCenter.jsx is now a thin shell (~130 lines) that only renders tab bar + conditionally renders each tab.

| File | Exports |
|------|---------|
| `FieldsTab.jsx` | `FieldsTab`, `FieldPill`, `FieldDetail` |
| `OperationsTab.jsx` | `OperationsTab`, `OperationPill`, `OperationEditor`, `TriggerDataHint`, `OpItem`, `getTriggerVars` |
| `ComponentsTab.jsx` | `ComponentsTab`, `ModulePill`, `TemplatePill` |
| `ConnectionsTab.jsx` | `ConnectionsTab`, `fileIcon`, `formatBytes` |
| `FilesTab.jsx` | `FilesTab`, `ArtifactPill`, `fileIcon`, `formatBytes` |
| `ListsTab.jsx` | `ListsTab` |
| `ShortcutsTab.jsx` | `ShortcutsTab` |
| `UserSettingsTab.jsx` | `UserSettingsTab` — userId + displayName only. ThemePicker moved to AppearanceTab. |
| `GridSettingsTab.jsx` | `GridSettingsTab` — **NEW** grid name/rows/cols/template/delete. Self-contained via GridActionsContext. No props needed. |
| `AppearanceTab.jsx` | `AppearanceTab` — **NEW** theme picker (moved from UserSettingsTab) + CSS token stub section. |
| `EntityTreeTab.jsx` | `EntityTreeTab`, `DraggableInstanceRow`, `DraggableEntityRow` |
| `FiltersTab.jsx` | `FiltersTab` — named filter presets CRUD. FilterRow (name/timeScale/active circle/expand/delete), ConditionRow (field + remove). Reads grid.namedFilters, saves via CommitHelpers.updateGrid, activates via update_grid_filter socket. |

Note: `EntityTreeTab.jsx` imports `TemplatePill` from `ComponentsTab.jsx`.

## Patterns
- Dialog z-index = 1100 (above fullscreen panels at z=1000)
- Context menus: `createPortal(menu, document.body)` — always on top
- Popovers use shadcn `<Popover>` with `align="start" side="right"`
- All buttons use shadcn `<Button>` variants
- CommandCenter: `position: fixed, top: toolbar_height, left: 0, right: 0` — slide down animation

## Recent Changes (Mar 17 2026 — TDZ Crash Fixes + Field.jsx onChange Bug)
- **Editor.jsx**: Fixed 3 TDZ bugs (all same pattern — hooks declared before `const editor = useEditor(...)` but referencing `editor` in deps):
  1. `handleEditorMouseMove` (was at line 156) — moved to after `useEditor` ends
  2. `filteredExprFields` useMemo (was at line 635) — moved to line 115 (after `filteredFields`)
  3. `handleSelectExpr` useCallback (was at line 613) — moved to after `useEditor`
  Root cause: React evaluates `useCallback`/`useMemo` deps synchronously at render time — if a `const` is referenced in deps before its declaration line, JavaScript TDZ fires on every render.
- **Field.jsx**: Fixed compact click-editing `onChange` bug — `onChange={handleChange.bind(null, undefined)}` was wiping `localValue` to `undefined` on every keystroke (fires after `onChangeCapture` in bubble phase). Changed to `onChange={(e) => handleChange(Number(e.target.value))}`. Also fixed `extractValue` to return `undefined` (not the whole object) when an object lacks a `value` key — prevents `value="[object Object]"` in controlled inputs.

## Recent Changes (Mar 14 2026 — D12 Doc Block Handle)
- **Editor.jsx**: Added Notion-style per-block drag handle + options menu. `blockHandle` state `{ top, nodeStart }` tracks hovered block. `handleEditorMouseMove` on outer div: uses `editor.view.posAtCoords` → `$pos.before(1)` to find top-level node start → `editor.view.domAtPos` to find DOM element → computes `top` relative to outer wrapper. Hide timer pattern (200ms) prevents flicker when moving between handle and content. Block handle renders absolutely at `left: 0, top: blockHandle.top` with ⠿ (GripVertical) drag button + ⋮ (MoreVertical) options button. Options menu: Text / H1 / H2 / H3 / Bullet list / Quote / Duplicate / Delete. Each calls `editor.chain().focus().setTextSelection(nodeStart+1).setNode(...)`. Duplicate uses `node.toJSON()` inserted at `nodeStart + node.nodeSize`. Delete uses `deleteRange`. Menu closes on outside click via `useEffect`. Handle only shown when `editable=true`.

## Recent Changes (Mar 16 2026 — CS1+CS2 Color Purge + Light Theme Pass)
- **ALL commandCenter/ tabs**: `labelStyle`/`inputStyle` object colors converted to CSS vars. All `rgba(255,255,255,x)` → `var(--text-primary/muted/faint)`, `var(--input-bg/border)`, `var(--border-default/subtle)`.
- **FieldsTab.jsx**, **OperationsTab.jsx**: Converted labelStyle/inputStyle + all inline `rgba(255,255,255,...)`. Save button → `var(--accent-blue-*)`. Delete button → `var(--danger-*)`. Column hover → `var(--accent-blue-*)`.
- **FiltersTab, EntityTreeTab, ComponentsTab, ListsTab, ShortcutsTab, ConnectionsTab, FilesTab**: Same pattern. All green/purple/blue/danger actions use semantic tokens.
- **Field.jsx**: Star rating, progress bar, toggle pill → CSS vars.
- **ContextMenu.jsx**, **PomodoroTimer.jsx**, **Editor.jsx**: Remaining `rgba(255,255,255,...)` → CSS vars.
- **StyleEditor.jsx**: Selection outline → `var(--accent-blue)`.
- **index.css**: Added `--danger-bg`, `--danger-border`, `--danger-text` tokens to all 3 themes.
- **Result**: 0 hardcoded semantic `rgba()` colors in any component file. Only index.css token definitions and intentional swatch values remain.

## Recent Changes (Mar 16 2026 — Phase 6 UI Restructuring)
- **GridSettingsTab.jsx** (NEW in commandCenter/): Grid name/rows/cols/template/delete self-contained tab. Reads `state.grid` from GridActionsContext, owns its own local state + sync effect. Calls CommitHelpers directly. No props needed. Replaces toolbar cog popover.
- **AppearanceTab.jsx** (NEW in commandCenter/): Theme picker (ThemePicker moved from UserSettingsTab) + stub for CSS token editor. Uses Tailwind classes.
- **UserSettingsTab.jsx**: Removed ThemePicker + `useTheme`/`SYSTEM_THEMES` imports. Converted inline styles to Tailwind. Now shows redirect note pointing to Appearance tab.
- **CommandCenter.jsx**: Added `LayoutGrid` + `Palette` icons. Added `GridSettingsTab` + `AppearanceTab` imports. TABS array now has 11 tabs: `"grid"` (LayoutGrid) and `"appearance"` (Palette) inserted after `"filters"`. Content renders both.
- **Toolbar.jsx**: Removed cog RadialMenu + floating GridLayoutForm popover. Removed `gridSettingsOpen` state + outside-click effect + `cogAreaRef`. Removed grid settings props from signature (gridName, setGridName, rowInput, setRowInput, colInput, setColInput, onDeleteGrid, onCommitGridName, onUpdateRows, onUpdateCols, onSetDefaultDayPageTemplate, canUndo, canRedo, onUndo, onRedo, onHistory). Removed `GridLayoutForm` import. Added inline `PlusSquare` button for Add Panel. Added `EyeOff` hide button on right side.
- **App.jsx**: Removed gridName/rowInput/colInput states + sync useEffect. Removed commitGridName/updateRows/updateCols/setDefaultDayPageTemplate/deleteGridFinal callbacks. Removed all grid settings props from Toolbar call.
- **index.css**: Added semantic tokens to all 3 themes (`--text-primary/muted/faint`, `--input-bg/border`, `--border-default/subtle`, `--accent-blue*`, `--danger`).
- **tailwind.config.js**: Registered semantic tokens as Tailwind color names (`text-text-primary`, `bg-input-bg`, `text-text-muted`, `bg-accent-blue-bg`, etc.).

## Recent Changes (Mar 15 2026 — F3 Day Page Template Picker)
- **GridLayoutForm.jsx**: Added `grid` + `onSetDefaultDayPageTemplate` props. When `grid.templates` has entries, shows "Day page template" section with a `<select>` picker (None + template options). On change calls `onSetDefaultDayPageTemplate(templateId | null)`.
- **Toolbar.jsx**: Added `onSetDefaultDayPageTemplate` prop, passed through to `GridLayoutForm` alongside `grid`.
- **App.jsx**: Added `setDefaultDayPageTemplate` useCallback — calls `CommitHelpers.updateGrid({ defaultDayPageTemplateId })`. Passed as `onSetDefaultDayPageTemplate` to Toolbar.

## Recent Changes (Mar 14 2026 — R6 Field Hide + R7 Module Disable)
- **InstanceForm.jsx**: `FieldBindingRow` header restructured — now has Eye/EyeOff button on right side. Click calls `onUpdateBinding({ hidden: !binding.hidden })`. When hidden, pill is 40% opacity. Import `Eye, EyeOff` from lucide.
- **InstanceForm.jsx**: Added "Disabled" Switch in Settings tab (after Auto-check on drop). Saves `instance.meta.disabled = true/false` via `CommitHelpers.updateModule`.
- **FieldRenderer.jsx**: Added `disabled` prop (default `false`). When `disabled=true`, `inputEnabled` is forced to `false` → all fields render as display-only.
- **modules/Instance.jsx**: Passes `disabled={!!instance?.meta?.disabled}` to every `<FieldRenderer>`.

## Recent Changes (Mar 13 2026 — FiltersTab Added)
- **FiltersTab.jsx** (NEW in commandCenter/): Named filter preset management. FilterRow: active-circle (blue = active, click to activate via `update_grid_filter`), inline name input (onBlur saves), timeScale select (daily/weekly/monthly/yearly/all), expand/collapse for conditions, delete. ConditionRow: field pill + remove. Add condition: dropdown of non-bound fields. Saves via `CommitHelpers.updateGrid({ namedFilters })`. Added `"filters"` tab (Filter icon) to CommandCenter.jsx TABS array.

## Recent Changes (Mar 13 2026 — GridLayoutForm Cleanup)
- **GridLayoutForm.jsx**: Rewrote — removed Iterations section (dead UI, `onCommitIterations` was never being called after filter system rework). Now only has Grid Name + Rows/Cols + Delete. Removed `TIME_FILTER_OPTIONS`, `uid`, `Select*`, `Plus`, `Trash2`, `Input`, `Label` imports.

## Recent Changes (Mar 2026 — Files Tab + Operations Taxonomy)
- **CommandCenter.jsx**: `FilesTab` rewritten — reads artifact modules from `modulesById` (kind="artifact"), flat list, upload button + file input, native drag-drop zone onto tab. `ArtifactPill` draggable as `type: "module"`, `defaultDragMode: "copy"` so DragProvider copies to container.
- **CommandCenter.jsx**: Added `createModuleAction`/`createOccurrenceAction` imports. After upload response, dispatches both actions to update state without waiting for socket.
- **CommandCenter.jsx**: `EVENT_TYPES` (14 items) + `SUBJECT_TYPES` (9 items) + `SOURCE_ENTITY_TYPES` (12 items). Triggers use two-step row (event + subject + role filter). Sources = variable assignments (`$varName = entityType [filter]`).
- **server/server.js**: Artifact upload now creates module with `role: "instance"` (not "container") + `defaultDragMode: "copy"` — lets DragProvider create copy occurrence when dragged to container.
- **client/src/__tests__/LayoutHelpers.test.js**: Fixed `getContainerItemsWithOccurrences` tests — pass separate `containerOcc` object as 5th arg (matching new API).
- **server/__tests__/operationSchema.test.js**: Updated `triggerType` test — now tests that any string is valid (open enum, not restricted).

## Recent Changes (Mar 2026 — Per-Occurrence Display Flags + Drag Mode)
- **FieldRenderer.jsx**: Extracts `hideName`/`hidePrefix`/`hidePostfix` from `occurrence.fields[field.id]` alongside `value`/`flow`. Passes `hideName` to `FieldDisplay`, `hideName`+`hidePrefix`+`hidePostfix` to `FieldPillDisplay`, `hidePrefix`+`hidePostfix` to `FieldPillInput`.
- **FieldDisplay.jsx**: Added `hideName` prop (default: false). Integrated into `showLabel` — `showLabel = !compact && !hideName && binding?.display?.showLabel !== false`.
- **FieldPillDisplay.jsx**: Added `hideName`/`hidePrefix`/`hidePostfix` props. `prefix = hidePrefix ? "" : (field?.meta?.prefix||"")`. Same for postfix. `fieldName = hideName ? null : (rawFieldName||null)`.
- **FieldPillInput.jsx**: Added `hidePrefix`/`hidePostfix` props. Same pattern.
- **Instance.jsx (helpers)**: `entityDragMode = occurrence?.dragMode ?? instance?.defaultDragMode ?? "move"`. `toggleEntityDragMode` writes to occurrence (via `updateOccurrence`) if occurrence has explicit `dragMode`, else updates instance template.
- **dragSystem.js (helpers)**: `mode = data?.occurrence?.dragMode ?? data?.defaultDragMode ?? 'move'` at drag start in `useDragDrop`.

## Recent Changes (Mar 2026 — data-testid + CSS Classes)
- **CommandCenter.jsx**: Added `data-testid="command-center"` to root wrapper div (line 140).
- **RadialMenu.jsx**: Added `data-testid="radial-handle"` to central handle button (line 386).
- **LayoutForm.jsx, ContainerForm.jsx, InstanceForm.jsx**: No changes this session.
- **New CSS classes in index.css** (drop-indicator series, module-header-row, module-grab-zone, empty-placeholder, linked-copy-badge, flex-center, abs-fill, scroll-y, truncate-text).

## Recent Changes (Mar 2026 — RadialMenu handleToggle Batch Fix)
- **RadialMenu.jsx**: Fixed `handleToggle` — moved `updateAnchor()` OUT of the `setIsOpen()` updater. Now called directly before `setIsOpen(prev => !prev)`. Root cause: calling `setState` from inside a `setState` updater creates a separate React batch, so `setOpenDirection` from `updateAnchor` wasn't applied in the same render as `isOpen=true`. Result: arc now opens with correct direction on FIRST render.

## Recent Changes (Mar 2026 — RadialMenu Viewport-Center Direction)
- **RadialMenu.jsx**: Replaced threshold-based edge detection with viewport-center approach. Extracted `calcOpenDirection(centerX, centerY, vw, vh, spread)` as a named export for testability. Left-half handles → open right; right-half → open left; near top/bottom edge → open down/up. No more threshold tuning needed.
- **RadialMenu.test.js (NEW)**: 9 tests covering all direction cases (left column, right column, bottom edge, top edge, corners). Tests caught the previous threshold bug.

## Recent Changes (Mar 2026 — Tabbed Forms + Off-Screen Fix)
- **ContainerForm.jsx**: Redesigned with shadcn `<Tabs>` — 3 tabs: Settings (label+drag+behavior+persistence+iteration), Style (container+child instance style), Templates. Delete is sticky footer outside tabs. Fixed width `w-72` (288px). `max-h-[55vh] overflow-y-auto` per tab content.
- **InstanceForm.jsx**: Redesigned with shadcn `<Tabs>` — 3 tabs: Settings (label+drag+autocheck+sibling links+iteration+behavior), Style, Fields. Delete is sticky footer outside tabs. Same width/scroll pattern.
- **LayoutForm.jsx**: Redesigned with shadcn `<Tabs>` — 4 tabs: Basic (name+viewtype+drag+iteration+persistence+child behavior toggle), Layout (presets+display/flow/wrap+width+height+alignment+grid/gap+scroll), Style (child container/instance defaults+insets/padding/variant), Actions (lock/permissions+panel actions). Delete is sticky footer. Fixed width 320px. Added panel-level **Child Behavior** section in Basic tab — Own/Inherit toggle + sortable/droppable checkboxes; uses existing `onPanelStyleUpdate` prop.
- **Module.jsx**: Added `collisionPadding={8}` and `p-0` to panel + container PopoverContent. Radix avoids viewport edges.
- **Instance.jsx**: Added `collisionPadding={8}` and `p-0` to instance PopoverContent.
- **RadialMenu.jsx**: Improved edge detection — uses actual `s.radius + 14` instead of hardcoded 60. Added `topEdge` check (`dir = 'down'`). Added 4 diagonal corner cases (bottom-left→right, bottom-right→up, top-left→right, top-right→left). Renamed inner `pad` to `clampPad` to avoid variable collision.
- **DragProvider.jsx**: Added sortable check before reorder — if `toC?.behaviorMode === "own" && toC?.behavior?.sortable === false` and same container, `clearSession()` and return.

## Recent Changes (Mar 2026 — Behavior Toggle + Instance Behavior)
- **FieldInput.jsx**: Date type now shows relative badge next to input — "today" (green), "in N days" (yellow/gray), "N days overdue" (red). Uses `useMemo` to compute day diff from today.
- **FieldDisplay.jsx**: Date type now shows "Jun 15 · in 3d" / "Jun 15 · overdue" format instead of plain `toLocaleDateString()`.
- **ContainerForm.jsx**: Added "Behavior" section — `behaviorMode` Own/Inherit toggle + sortable/draggable/droppable checkboxes (Phase 5.2). Calls `onContainerUpdate({ behavior, behaviorMode })`.
- **InstanceForm.jsx**: Added behavior toggle — Own/Inherit toggle + draggable checkbox when Own selected. Uses `CommitHelpers.updateInstance`.

## Recent Changes (Mar 2026 — OperationsTab Category + Preview Run)
- **CommandCenter.jsx**: `OperationsTab` now has `handleCreateCategory` (same as FieldsTab) + `+ Category` toolbar button with `FolderPlus` icon. Toolbar row appears above the columns.
- **CommandCenter.jsx**: `handleRun` changed from executing `executePipeline` to just calling `setPreviewOp(op)`. Removed `executePipeline` + `setComputedValuesAction` imports (no longer needed).
- **CommandCenter.jsx**: Preview panel renders in OperationsTab list view when `previewOp` is set — shows operation name, trigger types with `$trigger.*` property hints (via `TRIGGER_TYPES` lookup), sources list (`$varName(entityType)`), and steps summary (with `if (N rules) → N actions` descriptions). Close with ✕.
- **CommandCenter.jsx**: OperationEditor's Run button relabeled "Preview" (purple styling). Clicking it in the drill-down view calls `setSelectedOpId(null)` + `handleRun(op)` — navigates back to list view and shows preview.
- **CommandCenter.jsx**: Inline Play button in `renderOpColumn` tooltip changed from "Run now" to "Preview operation".

## Recent Changes (Mar 2026 — EntityTreeTab Unsorted + Ancestry + Grid Drop)
- **CommandCenter.jsx**: `DraggableInstanceRow` gains optional `ancestry` prop — renders as muted 9px text below the label (`Panel › Container` breadcrumb). Passed at the tree call site: `ancestry={panelNode.label + " › " + contNode.label}`.
- **CommandCenter.jsx**: `EntityTreeTab` computes `placedInstanceIds` (Set of instance IDs that appear in the grid tree via occurrences). "Unsorted" collapsible section renders all instances NOT in that set — shows count, uses `DraggableInstanceRow` at depth 0.
- **DragProvider.jsx**: Added `MODULE FROM COMMAND CENTER → CONTAINER` handler — when a `type: "module"` drag (sourceType: "command-center") is dropped on a container, calls `LayoutHelpers.copyInstanceToContainer` with `iterationMode: "persistent"` to create a new occurrence of the existing instance.

## Recent Changes (Mar 2026 — CommandCenter Drill-down)
- **CommandCenter.jsx**: FieldsTab + OperationsTab now use **drill-down pattern** — when field/op is selected, entire pane is replaced by FieldDetail/OperationEditor. Sticky "← Fields" / "← Operations" back bar at top of detail view. Removed stacked (columns + editor below) layout.
- **CommandCenter.jsx**: `ChevronLeft` added to lucide imports.
- **Module.jsx**: `ModulePanel` now uses `useDragHotContext()` for `hotTarget` + `useDragHotContext` added to imports. This prevents ModuleContainers from re-rendering during drag hover.
- **Grid.jsx**: `GridCell` uses `useDragHotContext()` for `panelOverCellId`.

## Recent Changes (Mar 2026 — CommandCenter UX + Module Handle CSS)
- **CommandCenter.jsx**: FieldsTab unified drag — removed separate "DRAG TO INSTANCE" pill strip. Category column chips now use `<FieldPill compact>` (Pragmatic DnD draggable). `monitorForElements` tracks dragged fieldId so HTML5 column `onDrop` still works for category reassignment. Single chip drag works for both category reassignment AND instance field binding.
- **CommandCenter.jsx**: Category columns now have `maxHeight: 180, overflowY: "auto"` so long field lists scroll.
- **CommandCenter.jsx**: Entity Tree tab and Components tab merged. "Components" tab removed. `EntityTreeTab` now includes: collapsible tree, `DraggableInstanceRow` components (Pragmatic DnD draggable with `type: "module"` data), templates section below the tree. `DraggableInstanceRow` uses `GripVertical + Box` icon + field count.
- **FieldPill**: Added `compact` prop — renders as flat list-item style (not pill) when `compact=true`. Used in category columns.
- **index.css**: Module handle (cog) now uses `opacity: 0.08` (dot-like indicator) instead of `display: none`. Shows at full opacity via `.panel-header:hover > .module-handle` and `.container-header:hover > .module-handle` (HEADER hover only, not whole shell). Prevents text shift on hover. `.dragging .module-handle` uses `opacity: 0`.

## Recent Changes (Mar 2026 — Field/Operation Categories)
- **CommandCenter.jsx**: FieldsTab redesigned to category-column layout. `categoryFolders` = folders where `folderType === "category"` for current grid. Fields grouped by `field.folderId`. Columns have HTML5 drag/drop for category reassignment (set `dragFieldId` → `handleDropOnFolder` → `updateField({ folderId })`). "DRAG TO INSTANCE →" pill strip below columns keeps existing Pragmatic DnD FieldPill behavior. `renderCategoryColumn` helper renders each column. "+ Category" button creates new Folder (folderType: "category").
- **CommandCenter.jsx**: OperationsTab redesigned same way — `opsByFolder` groups by `op.folderId`. `renderOpColumn` helper with inline Run button. Drag to column → `updateOperation({ folderId })`.
- **CommandCenter.jsx**: `FieldDetail` gets `categoryFolders` prop + Category dropdown (`field.folderId` select). `OperationEditor` gets `categoryFolders` prop + Category dropdown (`op.folderId` select).
- **CommandCenter.jsx**: Added `FolderPlus` to lucide imports.
- **server/models/Field.js**: Added `folderId: { type: String, default: null }`.
- **server/models/Operation.js**: Added `folderId: { type: String, default: null }`.
- **server/models/Folder.js**: Added `"category"` to `folderType` enum.
- **createDefaultUserData.js**: `fitnessFolderId`/`nutritionFolderId` UIDs generated before STEP 1. Fitness fields (workoutReps/Sets/muscleGroup/chestMin-cardioMin) get `folderId: fitnessFolderId`. Nutrition fields (protein/carbs/fats/mealCategory/totalProtein-Fats) get `folderId: nutritionFolderId`. 6 fitness ops + 3 nutrition ops get matching `folderId`. Two Folder records saved in STEP 6. Reset: 7 folders.

## Recent Changes (Mar 2026 — Comprehensive Triggers UI)
- **CommandCenter.jsx**: `TRIGGER_TYPES` expanded to 11 types: onChange, onDrop, onCreate, onDelete, onMove, onComplete, onModuleUpdate, onIteration, onLoad, onWebhook, manual. Each has `triggerData: [...]` listing available `$trigger.*` properties.
- **CommandCenter.jsx**: `TriggerDataHint` component — shows `$trigger: prop1 · prop2 · ...` for the active trigger type. Displayed inline below trigger config sections.
- **CommandCenter.jsx**: New trigger config sections for `onCreate` (container + panel filter), `onDelete` (container filter), `onMove` (from/to container filter), `onComplete` (field filter — boolean fields only).
- **CommandCenter.jsx**: `OperationPill` trigger short-label map updated for all 11 types.
- **CommandCenter.jsx**: Bug fix — `handleCreate` pipeline format changed from `{ sources: [], conditions: [], actions: [] }` to `{ sources: [], steps: [] }`. `PipelineEditor` prop default same fix.

## Recent Changes (Feb 22 Session 2)
- **DocToolbar.jsx**: N15 — `Unlink` button appears when cursor on fieldPill/instancePill; replaces with `#FieldName` / label text. S5 — `MD` download button; `tiptapToMarkdown()` recursive JSON→Markdown converter (headings/lists/marks/pills/hr/blockquote). `Download` + `Unlink` lucide icons added.
- **CommandCenter.jsx**: S2 — `EntityTreeTab` (new "Entity Tree" tab). Grid→Panels→Containers→Instances collapsible tree with search filter and badge counts (Nc/Ni/Nf). Icons: `Network` (tab), `LayoutPanelLeft` (panel), `Layers` (container), `Box` (instance). S7 — `FieldDetail` enhanced: unit field, select options editor (add/remove pills), displayConfig section (aggregation dropdown, targetValue, targetPeriod, showArrows checkbox).
- **FieldInput.jsx**: Bug #5 — boolean fields default to `false` when value is null (`defaultValue = field?.type === "boolean" ? false : undefined`).

## Recent Changes (Feb 22 Late — N12/N14/N16/N17)
- **CommandCenter.jsx**: N14 — In-flow element (no position:fixed). `max-height: (open && !isDragging) ? "50vh" : 0`. Tab bar always visible. Content transitions.
- **PomodoroTimer.jsx**: N13 — Compact ring+time bar. Slide-down panel at fixed position. Outside click + Escape close.
- **FieldPillNode.jsx**: N16 — Pencil/BarChart2 mode icons. PILL_COLORS 4 modes. resolvedMode from live field.inputEnabled/displayEnabled.
- **FieldRenderer.jsx**: Updated for inputEnabled/displayEnabled + computedValues from context.
- SortableContainer.jsx: N12 — Focused view 3-tab layout (Notes/Fields/History). `historyExpanded` → `focusedTab`. History tab shows field values per entry.

## Recent Changes (Feb 22)
- ContextMenu.jsx: CREATED — portal-based right-click menu
- LayoutForm.jsx: Added Panel Actions section (Copy/Link/Split/Merge buttons)
- CommandCenter.jsx: Implemented ListsTab, ShortcutsTab, UserSettingsTab (was stubs)
- CommandCenter.jsx: ConnectionsTab LIVE — GET /api/connections lists file_storage+notebook, browse files, import into manifest via /api/connections/:id/import, upload via /api/upload
- CommandCenter.jsx: FieldDetail updated to inputEnabled/displayEnabled checkboxes (removed legacy mode select)
- Panel.jsx: Focused instance view now includes DocContainer below fields — instance doc notes stored in occurrence.docContent
