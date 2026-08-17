# client/src/modules/ — New Module Rendering System

_Updated: 2026-08-11. This folder implements occurrence-based view routing._

## Recent Changes (2026-08-16 — instances get a BODY BUTTON; the feature was mostly already there)
- **User: *"i want to have instances have bodies again. a button that opens up a little doc. typing
  here would create a textblock here too so same rules as doc. it just is mini."***
- **MEASURING RETIRED THREE QUARTERS OF THE WORK.** `ModuleInstance` already held
  `showDoc`/`toggleDoc`, already offered **"Toggle doc"** in the radial menu, and already rendered a
  real `DocContent` under the row. And because it passes **no `onExitBlock`**, `DocContent` treats
  it as a PRIMARY doc editor — `onCaretMintTextblock`, `onAutoCreateTextblock` and insert-gaps are
  all wired — so **typing there already minted textblocks under the doc rules**. Separately, the
  server's linked-group fan-out already copies `textmap`, so **copy-linked siblings already shared
  one body**. What was missing was a way to find it.
- **`helpers/bodyOpen.js` (NEW) — the open body is a CLAIM, not per-row state.** A boolean per row
  cannot express *"someone else opened"*: the row that ought to close is precisely the one receiving
  no event. Same shape as `gapHover.js claimExclusiveGap` (2026-08-01 (9)), and for the same reason
  — at most one open **by construction** rather than by bookkeeping. Module state, not context: a
  context value would re-render every row on the grid whenever any body opened.
- **THE RELEASE GUARD IS LOAD-BEARING, NOT DEFENSIVE.** React commits the new row before running the
  old row's cleanup, so an unconditional release-on-unmount would close the body that just opened.
  A/B'd: making it unconditional fails exactly that case.
- **THE LOGIC LEFT `ModuleInstance` RATHER THAN BEING TESTED THROUGH IT.** The plan's test mounted
  the component; it is 1300 lines, needs the whole grid store, and **no existing test mounts it**.
  The plan named the fallback, so `useBodyOpen(occId)` was extracted and the hook is tested with
  `renderHook`. `ModuleInstance` now reads `const [showDoc, toggleDoc] = useBodyOpen(occId);`.
- **An EMPTY body was a ~100px slab** — `.doc-editor-wrapper` carries a Tailwind `min-h-[100px]`
  sized for a full doc page, which is the opposite of *"it just is mini"*. Floored at one line via
  `.instance-doc-body`, the same treatment `.table-td` already gives its cell editors. **Measured:
  100+ → 35px.** Only the screenshot showed this; every assertion passed either way.
- **Verified in a browser on live data** (`_instancebody.mjs`, repo root):
  ```
  button opacity   at rest 0        on hover 1
  open row 0       aria-expanded true    doc editors 4 -> 5
  outside click    still 5               (you must be able to drag into it)
  open row 1       row0 false, row1 true (the claim closes a sibling, in the real app)
  toggle closed    5 -> 4                empty body height 35px
  page errors      0
  ```
- **Spec check #1 PASSED structurally:** the body's editor has none of
  `.textblock-card` / `.instance-textblock-block` / `.table-td` as an ancestor, which are exactly
  what makes `Editor` SKIP drop-target registration — so it is on the registering path.
- **NOT VERIFIED, and it is the honest gap: nobody has DRAGGED an occurrence into an open body.**
  The mechanism is there (`DragProvider` bails on any drop over a `.doc-editor`, 2026-06-16, and the
  body is one), but a real drag has not been performed. That is spec check #2 and it remains open.
- 11 tests. Four A/Bs, each mutation verified to LAND before the result was believed.

## Recent Changes (2026-08-11 — BoundHeader: the question is a SPAN, the select is an invisible overlay)
- **User: *"the question shows up on daypage and picked, but cant be seen until i hover over it."***
- **MEASURED FIRST, AND THE LITERAL SYMPTOM DID NOT REPRODUCE — say so.** At 1440px the question
  IS painted at rest; the `<select>` renders **342px inside a 460px header** and simply truncates
  after ~7 words. What was actually broken is the recovery path: the rest of the text lived in a
  `.bound-header-fulltext` overlay that is `display:none` until `:hover`, **so on TOUCH it was
  unreachable at all.** The select measures 338px at 390px too — the day column has a 420px min
  width — so a phone shows the same truncation with no way to see the remainder.
- **Why the marquee this module explicitly asks for was inert.** `meta.labelOverflow: "marquee"` was
  set on the Daily Question deliberately (2026-08-01 (2): *"the question IS prose, reading it is the
  whole point"*), and `LabelShell` does wrap it in `AutoMarquee` — but AutoMarquee measures
  `inner.scrollWidth > box.clientWidth`, and a `<select>` capped at `max-width:100%` can never
  report overflow. **A native select truncates INTERNALLY, where nothing can measure it.** The
  marquee was switched on and could not fire, by construction.
- **THE FIX IS THE ONE THIS REPO WROTE DOWN TWICE AND NEVER BUILT** (2026-08-01 (9), and BoundHeader's
  own comment): the visible text is an ordinary `<span>` inside `.bound-header-pick`, and the real
  `<select>` sits over it at `opacity: 0` / `inset: 0`. The span overflows honestly, so it obeys
  whatever `labelOverflow` says — **no pointer involved** — while the select keeps focus, keyboard
  access and its native picker. The control's border/padding moved onto `.bound-header-pick`,
  because the element that DRAWS the chrome is no longer the element that carries it.
- **Two things that would have been silently lost, and are not.** An `opacity:0` select cannot draw
  its own caret, so `.bound-header-caret` is ours — without it nothing says the header is pickable.
  And the empty-pool diagnostic (#47) used to be the select's only `<option>`; it moves to the text
  layer, or a misconfigured predicate goes back to rendering a silently blank header.
- **A pre-existing HOOKS-ORDER BUG fixed in passing:** `selectedLabel`'s `useMemo` sat AFTER the
  `if (!hostOccurrence || !field) return` early return. The hook COUNT changes the first time this
  component renders without a host and then with one — a latent React crash. Moved above the return.
- **Verified in a browser at rest with no pointer** (`_dqfix.mjs`, local build on live data), which is
  the only thing that can settle a "cannot be seen" report:
  ```
  question 442px of text in a 316px box   marqueeArmed TRUE   textOpacity 1
  legacy .bound-header-fulltext in DOM    0
  elementFromPoint left/centre/right      SELECT.bound-header-native  (all three)
  ```
  3 tests, each A/B'd — removing the text layer fails 2, unwiring the overlay select fails 1,
  dropping the empty-pool fallback fails 1. **The first A/B-3 run "passed" because the mutation
  never applied (a non-breaking space in the source); the assert caught it.** Check the mutation
  landed before believing an A/B — for the Nth time.
- **NOT VERIFIED, and it is the honest gap:** nobody has TAPPED the control on a real touch device.
  The phone probe's hit-test returned null at every point because at 390px the Day Page cell is
  translated off-screen by the mobile slider — the documented trap. Its layout numbers are valid
  (the marquee arms at 390 too); its hit-test is not, and a zero there is a claim about the probe.

## Recent Changes (2026-08-10 — `ModuleTextblock`: role:"textblock" gets its own renderer)
- **THE TASK'S PREMISE WAS WRONG, and measuring is what found it.** It assumed a textblock inherits
  the ModuleInstance shell. Measured across three grids (`server/scripts/_textblockcensus.mjs`,
  read-only), that is true of **~5%**: on poms grid, of 1036 textblock occurrences, **721 render
  through `InstanceTextblockInlineNode`, 246 through `InstanceTextblockNode`, and only 45 + 6
  through `ModuleInstance` + `renderBody`.** Neither node view mounts ModuleInstance at all — the
  block one says *"Mirrors ModuleInstance"*, i.e. it RE-IMPLEMENTS the shell. So the thing to escape
  was never the shell; it was that **one role had three renderers**.
- **NO DATA CHANGE.** `role:"textblock"` is already first-class; module↔occurrence is **1:1 (0 of
  1036 modules reused)**; no children, no `viewId`, no `ownStyle`, no `linkedGroupId`. Purely a
  rendering split.
- **Fields are dead weight for textblocks:** 5.1% of modules bind one and **1.8% of occurrences hold
  a value** (instances: 100% / 97.9%); on test grid 2 it is **0%**. All 56 binders are `Daily Answer`.
- **`ModuleTextblock.jsx` (NEW)** dispatches by CONTEXT (`card` / `block` / `inline`) because the
  three have **disjoint feature sets** — only `block` has the BoundBody binding + the provisional
  lifecycle, only `card` has `listCapRows`, the chip exists on card and inline but not block. A union
  renderer would silently GRANT features, which is what *"works exactly the same"* forbids. An
  unknown context THROWS rather than rendering an arbitrary one.
- **`card` COMPOSES ModuleInstance** rather than reimplementing the shell (which is shared with
  ArtifactCard and is not going away), so the routing change is behaviour-identical by construction.
- **`floatHandle` PASSES THROUGH — do not hardcode it.** The five call sites disagree:
  ModuleContainer's canvas renderer, PageBoard and PageCanvas pass it; **ModuleContainer's list
  renderer and ModuleEmbedNode deliberately do not.** The plan's first draft supplied it inside
  ModuleTextblock, which would have changed the handle treatment at two of five sites. Pinned in
  both directions by a test.
- **`inline` is DELIBERATELY NOT ROUTED HERE** (it throws). Diffed at implementation time: on a card
  the whole chip IS the link, inline the chip is an editable text zone and only the arrow opens the
  target. Unifying changes what a click does for **709 of 1036** textblocks. Full table in
  `docs/superpowers/specs/2026-08-10-textblock-occurrence-type-design.md` §6.5.

## Recent Changes (2026-08-09 — a BOARD page renders its leaf children as themselves)
- **User: *"a board page can hold artifacts. as occurances in the page. so would canvases."*
  Right on both counts, and `PageCanvas` already did it — the BOARD page was the one surface that
  did not.**
- **What was actually wrong, and it was not the data model.** A page can host any role:
  `getPageChildrenModules` applies NO role filter, and `ModulePage` says so
  (*"Pages can host any module role (containers, artifacts, textblocks, nested pages)"*). But
  `PageBoard` handed EVERY child to `<Container>` — and `ModuleContainer` **never inspects its own
  role** (grep: zero references to `module.role` in 1600 lines), so it always draws container
  chrome. An artifact dropped straight onto a board page came out as an **EMPTY container shell
  wearing the file's name**.
- **`PageBoard` now does the leaf-role routing `PageCanvas` already had** — artifact →
  `ArtifactCard`, textblock → `TextblockCard`, both inside a `ModuleInstance` shell via
  `renderBody`. PageCanvas's own comment records why the shell is needed: ModuleInstance's default
  render has no field bindings to lay out, so a leaf comes out blank without it.
- **`pageChildRenderer(role)` is EXPORTED and tested** rather than left inline. Mounting PageBoard
  needs the whole grid store, and this predicate is exactly where the bug lived. A nested `page`
  child deliberately stays on the Container path (rendering it as a real nested page is the layout
  cascade's job, #45) and a role-less child keeps today's behaviour — both pinned, so neither
  changes by accident.
- 4 tests, A/B'd: reverting to always-Container fails the leaf case.
- **NOT verified in a browser.** The predicate and the wiring are asserted; nobody has yet dropped
  a file on a board page and looked at it.

## Recent Changes (2026-08-06 (5) — ModulePanel: chrome renders now, the BODY is staged)
- **`ModulePanel.jsx`** — the panel's chrome (header, page name, tree toggles, drag handle, border)
  renders immediately; only its BODY waits for `useStagedContent("panel:<id>")`. The gate is
  per-branch (page / artifact-tree / display), NOT around the whole CONTENT block — the first
  version wrapped everything and the mid-load screenshot showed a panel with no header, which is the
  opposite of "the grid shape paints first".
- While waiting it renders ONE circular loader — the same `Spinner`, at `size="sm"` — and **nothing
  at all for the first 150ms**, so a panel that lands quickly never flashes one.
- Priority is nearest-first: on mobile the distance from the ACTIVE CELL (`useActiveCell`), on
  desktop reading order. Engine + the two defects it took to get right: `helpers/CLAUDE.md`.
- `ModuleContainer` / `ModulePage` gained first-render and first-commit marks for the load
  instrument (inert unless `window.__loadDiag`).

## Recent Changes (2026-08-05 (4) — clicking a page in the tree opens the PAGE)
- **`ManifestTree.jsx` (`PageTreeNode` onClick)** — a page row now calls `onOpenPage(pageOccId)`.
  It used to open the page's FOLDER and animate a drilldown into the card
  (`onOpenPage(folderPageOccId, { drilldownTarget: pageOccId })`, the folder-first navigation from
  2026-04-02). User 2026-08-05: *"folders are opening before the pages when i click on them in the
  side bar … thats too many steps to get to what i want."* That reveal was worth it exactly once;
  every time after it is a detour on the way somewhere you already named by clicking it. The folder
  is still one click away — its own row opens it (`handleFolderClick`, untouched).
- The `folderPageOcc` memo and the `folderPageOccId` prop it fed are DELETED — that prop was their
  only consumer. `ModulePanel`'s `openPage(occId, { drilldownTarget })` option survives as an API
  (nothing passes it now); removing it is a wider cleanup than this change earns.

## Recent Changes (2026-08-05 (3) — DocContent: click an empty line, get a textblock)
- **`DocContent.jsx` `handleCaretMintTextblock` (NEW)** — the mint itself. Creates the
  textblock module + occurrence **LOCAL-ONLY** (`emit: false`, `fireTrigger: false`), replaces the
  empty line with an `instanceTextblock` node and requests the caret through the existing
  `pendingTextblockFocus` claim. The block carries the parent's filter values
  (`CommitHelpers.parentFilterFields`) so it is visible to the date filter the moment it stops
  being empty. Registered with `helpers/provisionalTextblock` under two closures:
  - **`commit(textmap)`** — emits `create_module` + `create_occurrence` with whatever has been
    typed, then explicitly writes the PARENT doc's textmap (Editor held it back while the block
    was provisional; without this write the textblock exists but nothing renders it).
  - **`discard()`** — local `removeOccurrence` + `deleteModule`, no emit. Nothing was ever sent,
    so there is nothing to race.
  **Register BEFORE dispatching the replace transaction** — that transaction fires the outer
  editor's onUpdate synchronously, and the save path asks the registry whether the doc now embeds
  a provisional block.
- Passed to Editor as `onCaretMintTextblock`, gated `onExitBlock ? null : …` — the same gate as
  auto-create, so PRIMARY doc editors only, never a textblock sub-editor or a table cell.
- An unmount still holding an uncommitted block discards it (local cleanup only; without it the
  empty module + occurrence linger in client state until reload).
- The old TYPING path (`handleAutoCreateTextblock` + Editor's merge window) is untouched and still
  covers paste, fast typing before the mint lands, and programmatic content.

## Recent Changes (2026-08-01 — EVERY artifact card is a figure: preview on top, name centered underneath)
User: *"center the artifact file names and make sure all artifacts are preview on top, and file
name stacked underneath it always."*
- **`ArtifactCard.jsx`** — the info block was gated `kind === "image"` (`showImgInfo`), so a
  video / pdf / audio / unknown file had NO name in its card and fell back to the row label
  instead. It is now `showInfo` for every kind (`fileName`/`fileDims`/`fileSize` — renamed from
  `img*`, they were never image-only in substance). Consequence worth knowing: the existing
  `.instance-content:has(.artifact-card--with-info) … .instance-label {display:none}` rule now
  suppresses the row label on ALL artifact rows, so the name reads once, under the preview —
  which is the point, but it does change how non-image artifact rows look.
- **`ArtifactCard.jsx renderThumbnail`** — the pdf / audio / unknown thumbnails no longer print
  the label themselves (they'd now show it twice). pdf keeps 📕, audio keeps 🎵 above its player,
  and unknown gained 📄 — without it that branch was ONLY the label text, so removing the text
  would have left an empty box with no preview at all.
- **`ArtifactCard.jsx` full-bleed card** — image now renders BEFORE its name bar (was a header
  ABOVE the image). It was the one artifact reading the other way round.
- **`index.css`** — base `.artifact-thumb-info` is `align-items:center` + `text-align:center`
  (was `text-align:left`); BOTH are needed because the name is a `-webkit-box` for line clamping.
  `.artifact-fullbleed-header` centers instead of right-aligning. The
  `.wrap-group … .artifact-thumb-info {display:none}` hide is REMOVED — it dated from when info
  sat BESIDE the image at 55% width and broke into 1-2-char lines in the narrow notch
  (2026-06-11); the card stacks now, so the reason is gone and it was the last place an artifact
  had no name. `.artifact-thumb--audio > span` centers the glyph (the row is stretch-aligned so
  the player can fill the width).
- **Verified** by measuring the real markup against the BUILT stylesheet in headless chromium
  (7 kinds incl. the doc-editor figure + full-bleed): preview above the name in every one, and
  the name box centered to within **0px** on all seven. `--expanded` (the lightbox) is untouched
  — its meta bar is a different piece of chrome and already sits under the media.

## Recent Changes (2026-07-25 — container header label one size up)
- **`ModuleContainer.jsx`** — the standard/board container header label went `0.75rem`/`0.8rem` →
  `0.9rem`/`0.95rem`. It rendered at 12px, the same size as the instance labels underneath it, so a
  container read as just another row (user: "it matches instances right now and it looks off").
  The EMBEDDED header is unaffected — it sizes off `meta.headingLevel` (HEADING_SIZES).

## Recent Changes (2026-07-18 — manifest tree: root indent matches local; no folder-page dupe row; tablet labels)
- **`ManifestTree.jsx` (`FolderNode`)** — root-tree folder rows indented at `depth * 14`; every
  other tree row (pages, the local/panel tree) uses `depth * 8`, so the root (FILES) tree stepped
  in noticeably deeper than the panels (LOCAL) tree. Changed to `depth * 8` → both trees match.
- **`ManifestTree.jsx` (`localTreeData`)** — the local page filter matched `mod.role === "page"`
  but NOT the folder-page NAV occurrences (`kind:"folder"` role:"page"). A pinned folder-page (e.g.
  the Interfaces folder's own nav occ) got grouped under its own folder and rendered as an empty
  duplicate row ("Interfaces inside Interfaces", 2026-07-18 screenshot). Now excludes
  `kind === "folder"` — same rule `FolderNode.pageOccs` already applies.
- **`ModuleInstance.jsx`** — instance label div gained `className="instance-label"` (was an unclassed
  inline-`fontSize:12` div) so tablet CSS can shrink it (see index.css tablet-label block).

## Recent Changes (2026-07-13 — + menu / gap inserts fire OccurrenceCreateOp with panel context)
- **`ModuleContainer.jsx`** — the header "+" QuickAdd (`handleQuickAdd`) and the router
  (`handleQuickCreate → createChildInContainer`) now pass `panelId` + `containerLabel` and go
  THROUGH `CommitHelpers.createOccurrence` (not a raw dispatch+emit). The new occ also carries
  `parentId` BEFORE the trigger fires. WHY: items added via the + menus / InsertGap never fired
  `OccurrenceCreateOp`, so the "Schedule: Stamp Date & Time Slot" op (panel-scoped trigger,
  timeslot from `$trigger.containerLabel`) never ran — the item had no Date and failed every
  tracker's date gate FOREVER ("history/courses don't update", 2026-07-13 repro). The between-item
  + trailing `<InsertGap>` calls also thread `panelId`/`containerLabel`. Paired with
  `CommitHelpers.createLeafInstanceInParent`/`createLeafInstanceAtIndex` (helpers/CLAUDE.md) and
  `InsertGap.jsx`.
- **`ModuleInstance.jsx` + `ui/FieldRenderer.jsx`** — the transient +N/−N goal-delta badge is now
  rendered in ONE place (FieldRenderer's `.delta-popup`, absolute superscript at the value's top
  right, colored by the field's flow direction). Field.jsx's duplicate `DeltaBadge`/`useFlowDelta`
  (a SECOND badge at the pill's right edge) is deleted, and `ui/FieldValueIndicator.jsx` + its test
  removed — the plus was showing twice (user: "remove the old little + … keep the higher one").

## Recent Changes (2026-07-12 LATE — simplify-audit: artifact pages carry a real View; shared create-page)
- **`ModulePage.jsx`** — the `kind:"display"` branch no longer synthesizes a fake view from an
  inline mediaKinds map: `ensureArtifactPageOcc` now mints a REAL View (importsFolder
  `viewFieldsForArtifactKind`) and sets `viewId` on the page occurrence, so `pageView` resolves
  normally. The "Add occurrence…" context row bumps the trigger in the SAME commit as the header
  reveal (QuickAddMenu now honors a positive openTrigger at mount — no 50ms deferral).
- **`ModulePanel.jsx`** — `handlePanelCreatePage` delegates to the shared
  `CommitHelpers.createPagePinnedToPanel` (ManifestTree's handleCreatePage uses the same helper);
  the hidden "Add page…" QuickAddMenu mounts LAZILY on first trigger (was permanently mounted in
  every panel).
- **`ManifestTree.jsx` / `pages/PageFolder.jsx`** — artifact-click call sites collapsed:
  `ensureArtifactPageOcc` owns the role gate, so both just call it and fall through on null.
  E2E-verified headless (tree click → Earthrise display page with the image-viewer chrome).

## Recent Changes (2026-07-10 — FIX: dragging a page from one panel to another never pinned)
- **`ModulePage.jsx`** — the page-shell drag (`useDragDrop` at ~167) built its payload via
  `createPayload`, which only surfaces `{type,id,data,context}`. `routeDrop`'s page→panel branch
  reads `role` from `payload.data.role` — which was unset — so the drag resolved role=undefined and
  fell into the LEAF path: the target panel highlighted (highlight keys off `type===PAGE`) but the
  page was never pinned. Fix: `data` now carries `role:"page"` (mirrors the tree-page drag's role
  tag). Paired with `dropHandlers.js` resolving the page occ id from `data.occurrence.id`. Tree-page
  drag (which already sets top-level role+occurrenceId) unaffected.

## Recent Changes (2026-07-08 — feeds: table child rows, canvas fallback positions, feed badge)
- **`containers/ContainerTable.jsx`** — child OCCURRENCES render as generated rows after the
  persisted cell rows (one per child; each column projects the same occurrence via StaticCellEmbed
  + its fieldVisibility). Ordered by table.sort via the sort column's projected field
  (`compareFieldValues` — time-aware). Feed copies hide the row remove button (engine owns their
  lifecycle). This is how the Schedule Table renders its feed (Table: Build op is gone).
- **`pages/PageCanvas.jsx`** — position-less children (feed copies) stack near the world CENTER
  (~1760/1850 — corner coords render off-screen in the 4000px world), wrapping into columns
  (8/column). First drag persists real meta.x/y.
- **`ModuleContainer.jsx` + `ModulePage.jsx`** — Rss feed badge next to the HeaderChevron when
  `occurrence.feed.enabled`; `<FeedSection>` mounted in both HeaderDropdowns.

## Recent Changes (2026-07-07 — PreviewNode: inline preview decoupled from the write commit)
- **`PreviewNode.jsx` InlinePreview** — `window.__moduli_state__` is now held in state and
  refreshed by a 500ms poll (same-ref setState no-ops), NOT re-read per render. The synchronous
  read meant every occurrence write re-rendered every preview card's whole subtree inside the
  write's own commit — 401 of 535 frame-1 field renders on a drop (measured). Sub-second preview
  staleness is invisible (cards are non-interactive). `window.__NO_PREVIEWS === true` renders the
  cards empty (probe diagnostics). Attribution instrumentation also added to ModuleContainer /
  ModuleInstance (`useRenderAttribution`, gated) — see helpers/CLAUDE.md.

## Recent Changes (2026-07-06 — ModuleInstance: op display widget extracted to OpDisplayPill)
- **`ModuleInstance.jsx`** — the operation "display" widget is its own `OpDisplayPill` component
  reading `useComputedValue(op.targetFieldId)` from the new `state/computedValuesStore`;
  `InstanceInner` no longer subscribes to computedValues at all (it used to re-render every
  instance on every op-drain batch via GridLiveContext). Details in client/src/CLAUDE.md.

## Recent Changes (2026-07-04 — GridMosaic reconcile keys off grid.occurrences, NOT the rendered panel set)
- **`GridMosaic.jsx` reconcile effect** — pruned/added tree leaves against the rendered
  `panelsRender` set, which goes transiently PARTIAL (filter cascade / hydration). One
  partial pass pruned live panels, re-added them as largest-pane splits, and PERSISTED
  the scrambled tree (corrupted the seeded Live Grid into a 4-column split — the user's
  "tablet layout is messed up"). Now reconciles against the authoritative
  `grid.occurrences` id list (deps swapped `panelByOccId` → `grid?.occurrences`).
  Behavior note: a panel hidden by filters keeps its pane and renders EMPTY (pane map
  already guards `if (!panel) return null`) — same semantic as a hidden panel's
  reserved rows×cols cell; only "Remove from grid" (which pulls the id from
  `grid.occurrences`) collapses a pane. The corrupted prod tree itself was repaired by
  a one-shot script this session (see client/src/CLAUDE.md).

## Recent Changes (2026-07-03 — panel header ALWAYS VISIBLE; tree toggles moved into it; Local/Root bar + autohide DELETED)
Per user: "keep the panel header visible at all times … put a button on each side …
get rid of the top bar that shows local and root."
- **`ModulePanel.jsx`** — the page-panel header is now permanently visible. REMOVED the
  whole autohide machinery: `headerRevealed`/`headerH`/`headerInnerRef` + measure effect,
  `autohide`/`toggleAutohide` (the persisted `meta.autohide` flag is now inert), the
  radial "Autohide header" extraItem, the hover strip + `.panel-header-lip` tab (CSS rules
  deleted too), and the `headerCluster` max-height slide wrapper — `pageHeader` renders
  inline. Mobile no longer force-retracts the header.
- **Nav bar (Local | breadcrumbs | cycle arrows | Root) DELETED** along with its helpers
  `pageBreadcrumbs` + `openFolderCrumb` (breadcrumb path lives in the Root tree; page
  cycling via the Local tree). The two tree toggles moved INTO the page header as icon
  buttons: **FileText right of the drag handle → Local tree** (left sidebar), **Folder
  replacing the + QuickAddMenu → Root tree** (right sidebar). Both keep the
  drag-enter-to-open affordance. The panel-header QuickAddMenu (`targetRole="page"`) +
  `handleQuickAddPage` + `globalFolderId` are gone — page creation lives in the trees'
  own + menus. Header order: `[drag handle][Local][page label][Root][stack][fullscreen]`.

## Recent Changes (2026-07-02 — drag context split: hot components drop reactive drag-state reads)
Part of the drag-start-lag fix (see helpers/CLAUDE.md 2026-07-02 for the full design).
- **`ModuleContainer.jsx`** — no longer destructures `isContainerDrag/isInstanceDrag/isExternalDrag/`
  `isPanelDrag` from the drag context (those fields moved to `DragStateContext`, which containers do
  NOT subscribe to — they're the 387-mount hot path). The three reactive `disabled:` props on its
  useDragDrop/useDroppable hooks are REMOVED: they flipped at drag start and re-registered every
  container's Pragmatic targets + touch listeners (the drag-start lag); the hooks' `accepts` lists
  already reject the same drag types, so behavior is identical. Shell `pointerEvents` inline style
  keeps only local `isDragging`; the panel-drag pass-through moved to CSS
  (`body[data-drag-kind="panel"] .container-shell{pointer-events:none!important}` in index.css).
  Header insert indicator now gates on `dragCtx.getActiveType()` (non-reactive read — `isHeaderOver`
  flipping already re-rendered the component).
- **`ModuleInstance.jsx`** — same treatment (193-mount hot path): dead `isDragging` context read in
  InstanceInner deleted; wrapper's `disabled: isContainerDrag` removed (accepts list already rejects
  container drags); `useDragContext` import dropped.
- **`ModulePanel.jsx`** — panels are few, so they're a sanctioned reactive consumer: booleans
  (`isContainerDrag/isInstanceDrag/isExternalDrag/isPanelDrag`) now come from
  `useDragStateContext()`; the stable `useDragContext()` is kept for stack helpers
  (`getStackForPanel`/`cyclePanelStack`). `isChildDrag → disabled:` flip on the panel's own
  useDragDrop stays (≈18 panels — cheap, and it must not be draggable mid-child-drag).
- **`ModulePage.jsx` / pages/** — unchanged: their `disabled:` flags are static (`!pageModule`), so
  they never had reactive drag-state reads; they benefit automatically from the stable context (no
  re-registration at drag start). New `isPageDrag` is available on DragStateContext for future
  page-drop affordances.

## Recent Changes (2026-06-28 LATE — logo → clean VECTOR lockup; empty-label editable; quick-add focuses new item)
- **Logo (`client/public/viafluere_lockup.svg`)** — switched from the speckle-repaired
  RASTER-embed to a pure **vector** lockup (interlocking double-knot, gradient ribbons woven
  over/under + "viafluere" wordmark). The raster repair couldn't fully clean the damaged
  upper-middle cluster (broken pixels persisted); vector = zero broken pixels. Tight viewBox
  (`42 20 748 124`, content measured x[49.5..781]) so it fills the card edge-to-edge (kills the
  right-side gap). Seed already points at `/viafluere_lockup.svg` → **no reseed needed**, just
  rebuild dist. (Header `moduli_logo.png` still raster — tiny at 18px, speckles not visible.)
- **`ModuleInstance.jsx` — empty labels are now editable.** The label slot was gated
  `effectiveShowLabel && hasLabel`, so a blank-label occurrence rendered nothing to click.
  Now gated on `effectiveShowLabel` alone; empty → a faint italic "Untitled" placeholder
  (double-click to name). Inline input gained `onFocus → select()` so renaming replaces.
- **Quick-add focuses the new item.** New `helpers/pendingLabelEdit.js` one-shot pub/sub:
  the create site (`App.addInstanceToContainer`, `InsertGap.insertNew`) calls
  `requestLabelEdit(moduleId)` after minting; `ModuleInstance` consumes it once on mount and
  opens the label editor focused (text selected) so you can type the name immediately.

## Recent Changes (2026-06-28 — full-bleed logo: scroll-to-center on load + tight lockup; multi-block description)
- **`ArtifactCard.jsx`** — the full-bleed logo card (`kind:"image"` + `meta.fullBleed`,
  the Viafluere top-middle cell) now scrolls itself vertically CENTERED in the nearest
  scrollable ancestor on first mount (140ms post-layout, fullBleed-only, runs once per `src`).
  So the cell "loads in" with the logo centered — the container header + filename bar scroll
  up out of view, the description below is reached by scrolling further (user ask). Added
  `useRef`/`useEffect` imports + `isFullBleed` guard.
- **Logo lockup (`client/public/viafluere_lockup.svg`)** — viewBox tightened from 760→678 wide
  (content measured at x[24.5..676]) + intrinsic `width=678` so the lockup fills its card
  edge-to-edge (was an ~11% dead gap on the right that read as left-aligned). `.artifact-fullbleed-img`
  stays `width:100%`.
- **Seed (`server/scripts/createLiveData.js`)** — the logo container's single description
  textblock is now SIX textblock occurrences (tagline + What it is / Anything you do can be
  measured / Totals & streaks / Build it your way), content from docs/original-vision.md +
  NEWOVERVIEW.md. Logo panel `scrollY` flipped `hidden`→`auto` so the expanded description is
  scrollable. **Re-seed required** to apply the description + panel-scroll changes.

## Recent Changes (2026-06-15 — PageFolder: briefly flash newly-arrived cards (fresh imports))
- **`pages/PageFolder.jsx`** — folder pages now pulse a card for ~1.3s when its
  occurrence id NEWLY appears in the folder (user: "since the import folder holds all
  the imports, highlight the new ones added just for a second"). `seenIdsRef` seeds
  silently on FIRST render (opening a populated folder doesn't strobe everything); only
  ids that show up afterwards flash. Per-id timers (cleared on unmount) drop each id from
  `flashIds` after 1.3s. `FolderItem` applies `.preview-node-flash` (new keyframe in
  `index.css` — blue ring + tint fading to nothing) to the grid card wrapper AND the list
  row. Generic — any folder page gets it; the Imports folder is the motivating case.

## Recent Changes (2026-06-12 — lead aside parent-float: `.is-lead-float` class on the root section)
- **`ModuleContainer.jsx`** — the container-shell className now appends `is-lead-float` when
  `module.meta.leadFloat` (the root section that HOSTS the Wikipedia lead aside as a parent-level
  right float — the aside floats at the front, prose flows down the left). Mirrors the existing
  `is-lead-aside` line. The CSS hook (`client/src/index.css`) makes the lead-float prose textblock
  cards plain non-BFC blocks with transparent chrome so they wrap beside-then-under the floated
  infobox (and don't draw a tinted box behind it). The importer stamps `meta.leadFloat` on the
  root module (server/CLAUDE.md); the embed wrappers are plain blocks via the reverted `alignStyle`
  default (docs/CLAUDE.md). Headless-validated. One line in the className IIFE.

## Recent Changes (2026-06-12 — TextblockCard/ModuleContainer drop the wrap-clip hook (block-wrap redesign))
- **`TextblockCard.jsx` + `ModuleContainer.jsx`** — removed the `useWrapNotchClip` calls (and
  TextblockCard's `--wraphost` class + `cardRef`). In the redesigned block-wrap (docs/CLAUDE.md
  + spec) the host card's L border is clipped by `WrapGroupNode` via the `--wrap-host-clip` CSS
  var (applied by the `.wrap-group--on … :last-child .textblock-card/.container-shell` rule) —
  the host renderer no longer measures a ghost spacer. No behavior change for non-wrapped cards.

## Recent Changes (2026-06-11 — artifact cards: strip the instance "keycap" frame so media reads edge-to-edge)
- **`index.css`** — a section/notch image rendered via `ModuleInstance(renderBody=ArtifactCard)`
  was wrapped in the instance-row keycap chrome (bg/border/shadow/padding), so it read as
  "an instance with a picture" (a thumbnail double-framed in an instance card). New rule
  `.instance-wrap > .instance-row:has(.artifact-card:not(--expanded):not(--quote))` strips
  that outer chrome (transparent / no border / no shadow / no padding) so the `.artifact-card`
  itself IS the visual box — a clean filled media block (it already has overflow:hidden +
  radius + `.artifact-thumb{width:100%;object-fit:cover}`). Added a subtle drop shadow to
  `.artifact-card` so it pops off the doc surface. The GripVertical drag handle stays
  (hover-only, absolute); expanded + quote cards keep their own chrome; the `--with-info`
  caption column is preserved. Per user (chose "edge-to-edge fill", keep info column).
  CSS-only; HMR + metric verified (instance-row bg transparent, border 0, card shadow on).
  NOTE: headless can't load Wikipedia images (no network) so the FILL itself shows live only.

## Recent Changes (2026-06-11 — lead aside: `.is-lead-aside` class + infobox column tint + BFC textblock cards)
- **`ModuleContainer.jsx`** — the container-shell className now appends `is-lead-aside`
  when `module.meta.leadAside` (the Wikipedia image+infobox sidebar). A CSS hook so the
  nested infobox table can be styled distinctly. One line in the className IIFE.
- **`index.css`** (see client/src/CLAUDE.md for the full list) —
  (1) `.textblock-card:not(--inline):not(--link)` → `display:flow-root` (BFC, so block
  textblock cards flow beside the floated aside; the real lever is the moduleEmbed
  wrapper change in docs/CLAUDE.md). (2) `.is-lead-aside .table-row > .table-td:first-child`
  → blue key-column tint (`rgba(120,180,230,0.13)`) + right border, distinct from the
  value column (user ask). (3) `.is-lead-aside .container-shell .embedded-container-header`
  → `display:none` so the empty-label infobox table doesn't render a generic "#Container"
  header — it reads as a bare facts card under the aside's own subject header.
  All HMR-verified in the live grid against a synthetic Eminem import.

## Recent Changes (2026-06-11 — wrapped NEIGHBOR is its own bordered "puzzle piece" + no crammed caption)
- **`index.css`** — a wrapGroup NEIGHBOR (image / infobox / any occurrence in the host's
  notch) now gets a clear visible border (`.wrap-group--on …:nth-child(n+2) .artifact-card`
  → `var(--border-default) !important`) so it reads as a **distinct interlocking occurrence**
  beside the morphing host (user: "puzzle / mosaic pieces with a wrap" — two separate boxes,
  NOT the image nested inside the textblock). The recent edge-to-edge artifact change had
  stripped the border (right for a standalone image, wrong for a wrap neighbor). Also: in a
  wrap, the artifact caption/info no longer sits crammed beside the photo in the narrow notch
  (broke into 1–2-char lines) — `.wrap-group .artifact-card--with-info` hides the side info
  and lets the image fill its box. Pairs with the importer making the lead aside a resizable
  wrap neighbor (server/CLAUDE.md). CSS-only; **in-browser glance** to confirm.

## Recent Changes (2026-06-11 — FIX: infobox/cell rows were ~110px tall (cell editor min-height never overridden))
- **`index.css`** — root cause of "infobox rows too tall for years active / children / other
  names": a plain-text table cell mounts `<Editor>`, whose DOM is `.doc-editor` (inline
  `minHeight:32`) **>** `.doc-editor-wrapper` (Tailwind `min-h-[100px]` + inline 5px top/bottom
  padding). The wrapper is a **grandchild** of `.table-td`, so the prior fix
  `.table-td > .doc-editor-wrapper { min-height:0 }` (direct-child `>`) never matched — every
  cell was forced ≥100px tall, so even one-line value rows read huge. New rules zero all three
  (`.table-td .doc-editor{min-height:0!important}` + descendant `.doc-editor-wrapper` with
  `min-height:0` + `padding-top/bottom:0!important`) so rows collapse to their content height.
  Applies to ALL tables (infobox + Schedule). CSS-only; **in-browser glance** to confirm
  Schedule text cells still read OK.

## Recent Changes (2026-06-11 — table rows size to content: `.table-td` vertical padding 8px→2px)
- **`index.css` `.table-td`** — vertical padding `8px` → `2px` (horizontal kept at
  8px). Rows now hug their content instead of reading too tall — applies to ALL
  tables (the imported Wikipedia infobox AND the Schedule table; user wanted both).
  Empty-cell `minHeight:18` (StaticCellEmbed) + the flex `align-items:stretch` row
  model are unchanged, so cells still size to the tallest occurrence — there was no
  hard row-min beyond the padding. **In-browser tune** if Schedule cards feel tight.

## Recent Changes (2026-06-10 — ArtifactCard: image-info column fills the gap beside the thumbnail)
- **`ArtifactCard.jsx`** — image cards now render an info column (name/alt, pixel
  dimensions, file size — whatever `module.meta` has; external Wikipedia images only
  carry the alt) in the empty space beside the thumbnail (user: "too much space
  between the drag handle and the image — put the image info there"). Gated on
  `kind==="image"` + at least one info field → adds `artifact-card--with-info` +
  `.artifact-thumb-info*`. CSS (`index.css`): the with-info card flips to
  `justify-content:flex-start`, info grows (`flex:1`), the image keeps its natural
  size (`max-width:55%`) on the right. Non-image / info-less cards unchanged.
  **Needs an in-browser glance** to tune the split.

## Recent Changes (2026-06-10 — block-wrap host generalized: TextblockCard + ModuleContainer share one clip hook)
- **`TextblockCard.jsx`** — the inline notch-clip (`findWrapSpacer` + ResizeObserver
  measure + `notchClipPath`) was extracted to `docs/wrapNotch.js` and is now consumed via
  `useWrapNotchClip(occurrence?.textmap, cardRef, !isInline)`. Behavior identical for
  textblock hosts; the hook is called before the link early-return so hook order is stable.
- **`ModuleContainer.jsx`** — calls the same `useWrapNotchClip(containerOccurrence?.textmap,
  containerRef, isDocContainer)` and merges `clipPath` into the container-shell style, so a
  `kind:"doc"` container can now HOST a wrapGroup and clip its own border into the L/C/
  hangman/J (the doc Editor renders the floated `wrapSpacer`, the shared measure finds it).
  Closes the CLAUDE_CHAT docket "generalize host beyond textblock". See docs/CLAUDE.md +
  the new `docs/wrapNotch.js`. Build clean; ResizeObserver→clip needs an in-browser glance.

## Recent Changes (2026-06-09 — retracted (autohide) panel header gets a visible "lip")
- **`ModulePanel.jsx`** — when a panel's header is retracted (`meta.autohide`), the
  reveal affordance was an INVISIBLE 8px top strip (nothing to aim at). Added a
  centered, visible **lip** tab at the top edge (rounded-bottom nub with a
  `ChevronDown`) alongside a now-10px forgiving invisible strip; both
  `setHeaderRevealed(true)` on hover (lip also on click). CSS `.panel-header-lip`
  in `index.css` (subtle at rest → brightens + grows on hover = pull-down handle).
  All seed panels are `autohide:true`, so every mosaic pane now shows the lip.

## Recent Changes (2026-06-09 — BSP "mosaic" layout (opt-in, Phase 1) + DnD)
- **`GridMosaic.jsx` (NEW)** — renderer for the opt-in split-tree ("mosaic") panel
  layout. When `grid.meta.layoutTree` is set, `Grid.jsx` renders this instead of
  the rows×cols `GridRender`. Panes are absolutely positioned from the tree;
  **splitter bars resize INDEPENDENTLY per axis** (resizing a row split in the
  right column never moves the left column's — the whole reason for BSP). Pure
  tree math lives in `helpers/bspTree.js` (23 unit tests); this component owns the
  React/DOM/persistence/DnD glue:
  - Measures its container (ResizeObserver) → `computeLayout(tree, rect)` → renders
    each pane as `<Panel mosaic>` + splitter bars (pointer-drag reuses the
    `Grid.jsx` resize pattern; on pointer-up persists `grid.meta.layoutTree` via
    `CommitHelpers.updateGrid`, read-modify-writing the whole `meta`).
  - **Reconcile effect** keeps the tree in sync with the live panel set: PRUNE
    leaves whose panel was removed ("Remove from grid" → pane collapses) + ADD new
    panels (+Panel button) by splitting the largest pane. Guarded (`size.w>0` +
    non-empty panel set) so a transient empty/partial load never wipes the tree.
  - **Drag-to-split DnD:** each pane is a Pragmatic `dropTargetForElements`
    accepting `DragType.PANEL` drags; `attachClosestEdge` → split direction
    (left/right→"v", top/bottom→"h"); on drop `removeLeaf(old)`+`splitLeaf(target)`
    re-homes the dragged panel. The old cell-based `handlePanelDrop`
    (`dropHandlers.js`) early-returns in mosaic mode so the two don't fight.
    Intra-panel content DnD (instances/containers) is unaffected — panels render
    normally.
- **`ModulePanel.jsx`** — new `mosaic` prop: skips the CSS-grid `gridRow`/
  `gridColumn` placement + grid margin (the GridMosaic pane wrapper positions it →
  fills 100%), and hides the corner cell-span `ResizeHandle` (splitter bars resize
  panes in mosaic). Non-mosaic path byte-identical.

## Recent Changes (2026-06-08 — ModuleContainer: insert-here gaps between list/board items)
- **`ModuleContainer.jsx`** — the standard list/board child render loop now
  interleaves `<InsertGap>` (`ui/InsertGap.jsx`) BEFORE each item plus a trailing
  gap after the last, gated on `containerOccurrence` resolving. Each gap inserts a
  new occurrence at that index via QuickAddMenu (see ui/CLAUDE.md +
  `CommitHelpers.createLeafInstanceAtIndex`). The map callback was refactored to
  build the item into a `node` var then return a keyed `React.Fragment` wrapping
  `[InsertGap, node]` (was returning the item directly). Doc-side gaps (Editor.jsx)
  are the pending next slice.

## Recent Changes (2026-06-06 — renderers honor occurrence.label override)
- **`ModuleInstance.jsx`** — the InstanceInner `label` prop is now
  `occurrence?.label ?? module.label` (was `module.label`).
- **`ModuleContainer.jsx`** — `displayLabel` is now
  `containerOccurrence?.label ?? computeScheduleColLabel(...) ?? module.label`
  (occurrence override wins over the schedule-col computed label and the base).
- Together these make a per-placement `occurrence.label` (written by ops via the
  `UPDATE_ITEM_LABEL` effect — e.g. "Today's Water" / "July 18th Water") render
  in place of the shared template label, WITHOUT mutating the module. Day-cols
  never set `occurrence.label`, so they keep `computeScheduleColLabel`. Inline
  rename still edits `module.label` (the stable base) — the override is the
  decorated view.

## Recent Changes (2026-06-06 — container header: label-overflow setting + top padding)
- **`ModuleContainer.jsx`** — embedded/doc container header label is now rendered
  through a module-scope `LabelShell({mode,style,children})` helper supporting
  three modes: `marquee` (AutoMarquee, default — inert when it fits), `wrap`
  (multi-line), `none` (single line + ellipsis). Mode resolves from
  `occurrence.meta.labelOverflow ?? module.meta.labelOverflow ?? "marquee"`.
  Applied to BOTH header branches (BoundHeader + contentEditable). Embedded header
  row top padding 0→4px. The picker UI is a select in `ui/ContainerForm.jsx`
  Settings tab (writes `occurrence.meta.labelOverflow` via onOccurrenceUpdate).

## Recent Changes (2026-06-06 — ArtifactCard: image render bug + inline audio player)
- **`ArtifactCard.jsx`** — fixed a `ReferenceError` that blanked EVERY image: the
  module-scope `renderThumbnail` / `renderExpanded` helpers referenced
  `thumb256Src` / `thumb1024Src`, which are `const`s declared INSIDE the
  `ArtifactCard` component (out of scope in the helpers). Helpers now take an
  `imgSrc` param (`= src` default); call sites pass `thumb256Src` / `thumb1024Src`.
  This was the root cause of "no images are showing up" (local uploads AND
  imported Wikipedia images).
- **`ArtifactCard.jsx`** — audio thumbnail (compact/inline) now renders a real
  `<audio controls preload="metadata">` instead of just a 🎵 emoji. Wrapped in
  `onClick stopPropagation` so the controls don't toggle the card's expand. CSS:
  `.artifact-thumb--audio` split out to `align-items:stretch` so the player fills
  the width (was centered/narrowed by the shared pdf/unknown rule).

## Recent Changes (2026-06-06 — ModuleContainer: section-hierarchy header sizing)
- **`ModuleContainer.jsx`** — the EMBEDDED container header now sizes by
  `module.meta.headingLevel` (module-scope `HEADING_SIZES`
  {1:26,2:21,3:18,4:16,5:15,6:14}; `headerFontSize` derived next to
  `displayLabel`, applied to the `#` hash + BoundHeader span + contentEditable
  span). Containers WITHOUT a level keep the default 20 (byte-identical). The
  Wikipedia importer stamps `headingLevel` per markdown heading depth (article
  H1 → sections H2 → …) so imported docs show a real heading hierarchy. Only the
  embedded variant (what imported sections render as) was changed.

## Recent Changes (2026-06-05 — TextblockCard: link mini-textblocks)
- **`TextblockCard.jsx`** — when the occurrence (or its module) carries
  `meta.link`, the textblock renders as a clickable CHIP instead of the editor:
  - `{ kind:"url", url }` → `<a target="_blank">` chip (opens a new tab).
  - `{ kind:"occurrence", occId }` / `{ target }` → button → `jumpToOccurrence`
    (scroll + flash) for in-app navigation.
  Per-placement `occurrence.meta.link` wins over template `module.meta.link`.
  The markdown importer emits these for every `[text](url)` link (see
  server/CLAUDE.md). NO settings UI to manually set/edit a link yet — the import
  path works; manual link-setting + an internal-target picker is the next piece.

## Recent Changes (2026-06-04 — PageBoard: generic `sortChildrenByField` (schedule day-col ordering bug))
- **`pages/PageBoard.jsx`** — new generic cascade rule `sortChildrenByField`
  (a field id, read off `layout` from the layout cascade). When set, the
  visible children are **stable-sorted** by each child occurrence's
  `fields[fieldId].value` via the new module-scope `childSortKey` helper
  (date-like strings → epoch ms, plain numbers → number, else `null` =
  unsorted/below the keyed ones). PageBoard stays domain-agnostic — it knows
  nothing about "schedule"; the seed op decides which field to sort by.
- **Bug it fixes:** schedule day-columns appear in the order they were appended
  to the Schedule page's `occurrences[]` (= date-picker SELECTION order, and
  idempotent re-adds append at the end), so a 3-day range picked as 28 → 29 →
  27 rendered as columns "28 29 27". The day-col occurrences each carry the
  date field (the Build Schedule per-day FIND matches on it), so sorting by
  that field reorders them chronologically regardless of insertion order.
- **Server side:** `makeScheduleBuildScheduleOp` (server/utils/liveSystemBuilders.js)
  now writes `sortChildrenByField: dateFieldId` into the Schedule page's
  `meta.layoutCascadeOverride` (alongside mode/columns/hideChildIds). **Re-seed
  required** to apply: `node --env-file=.env server/scripts/createLiveData.js`.

## Recent Changes (2026-05-20 — Canvas edges: DOM-rect anchors + unified undo)
- **`CanvasContent.cardCenterFor`** now queries each card's actual
  DOM rect (via `surfaceRef.current.querySelector("[data-occurrence-id=…],
  [data-occ-id=…]")` with `CSS.escape`) and translates to world coords
  by subtracting the world div's bounding rect. Edges anchor at the
  visual center of tall containers (200+ px) instead of 30px below
  their top. Falls back to fixed `CARD_W=180, CARD_H=60` when the card
  isn't in the DOM (mid-paste, off-screen, etc.).
- **Unified undo stack** — new typed `history` state alongside
  `redoStack`. Each entry is `{ type: "stroke-add" | "edge-add" |
  "edge-delete", payload }`. Undo button now rolls back the most
  recent action regardless of type; redo replays. `canUndo` gate is
  `history.length > 0` (was `strokes.length > 0`, which left undo
  grayed-out on canvases with only edge actions). Three sites push:
  stroke commit, connect-drag completion, connect-mode edge click.

## Recent Changes (2026-05-20 — Canvas connect tool + edge persistence)
- **`CanvasContent.jsx`**: Added a `connect` tool to `DRAW_TOOLS`
  (Link2 lucide icon). When active, pointer-press on a card starts an
  in-progress edge, pointer-move drags a dashed bezier to the cursor,
  and pointer-up on a different card persists a new edge entry. State:
  - `edges` (hydrated from `containerOccurrence.meta.edges`, re-synced
    on occurrence change) — array of `{ id, from: occurrenceId, to:
    occurrenceId }`.
  - `connectDrag` (`{ fromOccId, startX, startY, x, y }` in world
    coords) — the in-flight drag; null when not dragging.
  - `cardPosTick` — bumps when any card's `meta.x/y` changes (derived
    from `itemsKey`) so the SVG edge layer re-derives card centers
    without measuring the DOM.
- **Hit-test**: `hitTestOccId(clientX, clientY)` uses
  `document.elementFromPoint` + `.closest("[data-occurrence-id],
  [data-occ-id]")` to handle both instance and container card markers
  uniformly.
- **Persistence**: `saveEdges(next)` mirrors the existing `saveStrokes`
  pattern — sets local state and emits `update_occurrence` with the
  new `meta.edges` array. Dedup at write-time prevents the same edge
  in either direction.
- **Render**: New SVG layer inside the world (`zIndex: 2`, between
  the drawing canvas and the floating cards). Each edge draws a wide
  invisible hit path + a thin visible bezier; `pointer-events: stroke`
  on the hit path only when `drawTool === "connect"`, so edges
  intercept clicks only in connect mode. Clicking an edge in connect
  mode removes it. The in-flight drag renders as a dashed line.
- **Cursor**: `crosshair` for connect mode (matches the draw tools).
- **Cards stay pointer-active in connect mode** so `elementFromPoint`
  can find them; the world's pointer handlers run on bubble and
  short-circuit for `data-dnd-handle` targets so radial menus and drag
  handles still work in every tool.

## Recent Changes (2026-05-20 — BoundHeader + BoundBody (editor↔field binding))
- **NEW `BoundHeader.jsx`** — replaces container's static header label when the
  host occurrence (or its module) carries `meta.headerLink = { selfField, link }`.
  Reads `hostOccurrence.fields[selfField].value`. Type-dispatched:
  - select field OR text field with `optionsSource` → inline `<select>`
    dropdown (+ 🎲 dice button when `field.meta.randomizable`).
  - other types → plain inline readout (body editor owns edits).
  Writes go through `CommitHelpers.updateOccurrence` and then fan out via
  `propagateBoundFieldWrite` to any sibling occurrence whose link-field
  matches the host's link value (loop guard skips siblings already at the
  new value). Falls back to module label when no value and no options.
- **NEW `BoundBody.jsx`** — wraps `InstanceTextblockNode`'s inner DocContent
  when a `meta.bodyLink` binding is set. For `field.type === "text"` mounts a
  minimal TipTap editor (StarterKit + Placeholder) over the host's
  `fields[selfField].value` (string OR TipTap-JSON; normalized via
  `normalizeToDoc`). Edits debounce 500ms then commit + propagate. Non-text
  fields render as read-only extracted plain text. `makeFieldWriter` exported
  for unit tests.
- **Mounted from**:
  - `ModuleContainer.jsx` — `headerBinding` memo via `resolveEditorBinding({
    occurrence: containerOccurrence, module, slot: "header" })`. When set,
    BOTH header render sites (embedded + standard) swap in `<BoundHeader
    hostOccurrence={containerOccurrence} binding={headerBinding} />` in
    place of the contentEditable/static label.
  - `../docs/pills/InstanceTextblockNode.jsx` — `bodyBinding` memo wraps
    `DocContent` in `<BoundBody>` when set.
- **Binding badge (top-right)** — both components now render a small
  `<BindingBadge>` showing a `Link2`/`Unlink2` Lucide icon + the bound
  field's name. `isLinked` = host has link-field value set AND at least one
  sibling exists with matching link value + selfField present (probed via
  `findLinkedSiblings` with a `Symbol()` nextValue so the loop guard never
  drops matches). Badge is `position: absolute; top: 4; right: 6` on the
  body editor (relative wrapper) and `margin-left: auto` inline on the
  header. Tooltip reads "Linked: <field name>" or "Broken link: …".
- **Cascade**: `occurrence.meta.<slot>Link` → `module.meta.<slot>Link` →
  null. The string `"clear"` on the occurrence opts out of a module-level
  binding without re-setting it. Lives in `state/editorBindings.js`.
- **Tests**: `__tests__/BoundHeader.test.jsx` (4) and
  `__tests__/BoundBody.test.jsx` (7) cover dropdown writes to host,
  loop-prevention, and write-back round-trip.

## Recent Changes (May 19 2026 — Instance media section + artifact drop)
- **ModuleInstance.jsx**: New media section. A `fieldBindings` entry with
  `role:"media"` is now filtered OUT of the inline `instanceFields` row and
  instead rendered as a dedicated block UNDER label+fields. New memos:
  `mediaBinding` (first role:"media" binding+field), `mediaValue`
  (occurrence.fields[fid].value), `mediaTag` (img/video/audio sniffed from the
  value's extension), `showMedia = !renderBody && !cellEmbedCtx.__inCell &&
  !!mediaBinding` — board/list ONLY (doc-looking renderBody cards + table-cell
  `__inCell` embeds are excluded by design). The block is also a Pragmatic-DnD
  `dropTargetForElements` accepting artifact payloads
  (`{type:"artifact",occurrenceId}` from ManifestTree, `{type:"module",
  role:"artifact"}` from CC); on drop it resolves the artifact module's
  `fileRef` and writes `{value:fileRef}` to the media field via
  `CommitHelpers.updateOccurrence`. Added `modulesById` to the
  GridActionsContext destructure + `dropTargetForElements` import. Media src is
  `/uploads/<fileRef>` (same path ArtifactCard uses). Empty → dashed "Drop
  media here" placeholder; drag-over → blue outline (`mediaDragOver`).
- **index.css**: `.instance-media` / `.instance-media-el` /
  `.instance-media-empty` / `.instance-media-dragover` /
  `.instance-media-placeholder` (added just before the "+Row strip" block).
- STILL TODO (see `please continue.txt` HANDOFF): rich occurrence-select
  dropdown/picker (movie-search style: poster+fields+label per option) in
  ui/Field.jsx, the field-settings display config, and the `lastSeen` field +
  Stamp-op extension + seed wiring.

## Recent Changes (May 19 2026 — ContainerTable cell auto-append on fill-drag)
- **containers/ContainerTable.jsx**: After the fill-drag handler mints a new embed occurrence in `nextCells`, calls `autoAppendFieldsToTableColumnShowMode(...)` for the receiving column AND `autoAppendFieldsToAncestorsShowMode(...)` walking from the table occurrence itself. The first appends the new occurrence's fieldIds to `col.fieldVisibility.fieldIds` when the column is in `show` mode; the second surfaces those fieldIds to any ancestor (page/panel/grid) in `show` mode. Cell embeds aren't parented under the table in `occurrences[]` so the ancestor walk has to be anchored at the table occurrence — that's what the wrapper passes as `destinationOccurrence`. Pickers themselves (per-column kebab and the HeaderDropdown FieldVisibilitySection) still list every field via `Object.values(fieldsById)` — no scoping. The user wants to be able to pre-configure a field's visibility on an empty Schedule page before any descendant carries it.

## Recent Changes (May 18 2026 — Auto-marquee labels/pills + table alignment/fill + link icon)
- **ui/AutoMarquee.jsx (NEW)** — wraps content; ResizeObserver measures `inner.scrollWidth > box.clientWidth`; only when overflowing it runs a CSS `auto-marquee-scroll` ping-pong (`alternate`) translating by the exact overflow distance at ~35px/s. Inert (static) when it fits.
- **ModuleInstance.jsx** — every instance label is now `<AutoMarquee>{label}</AutoMarquee>` (label div → `flex:0 1 auto; minWidth:0; overflow:hidden`, dropped `overflowWrap:anywhere`); handle+label group → `minWidth:0` (default shrink, no grow) so the label can clip/marquee when space is tight, visually unchanged when wide. Each field pill in `.instance-fields` is wrapped in its own `<AutoMarquee className="instance-field-mq">` — row still `flex-wrap:wrap` (pills wrap normally); a single pill wider than the container scrolls instead of bleeding out. App-wide (per user: "any module labels … or any occurrence that has fields").
- **containers/ContainerTable.jsx** — `effectiveWidths` pushes the scaled-rounding remainder into the last column so columns sum to EXACTLY the container width (no right dead zone, header/body byte-identical). `StaticCellEmbed`/cell `<Editor>` providers now pass `__inCell:true` on `CellEmbedContext` (default `__inCell:false`).
- **index.css** — `.table-td` + `.table-th` got `min-width:0` (a flex item without it grows to content min-content and shoves the row out of line with the header — that was the header/body misalignment). `.table-th` changed `position:sticky`→`relative` (the header ROW is the sole sticky element now; per-cell sticky double-stuck and shifted columns). `.table-container` got `width:100%` (was shrinking to content, so the ResizeObserver measured content width and the responsive scaler had nothing to fill). `.linked-copy-badge` moved from right/middle to bottom-right of the instance. Added `@keyframes auto-marquee-scroll`.

## Recent Changes (May 18 2026 — Schedule Table: lazy-editor cells + flow rows, virtualization removed)
- **containers/ContainerTable.jsx** — Major rework to fix the Firefox crash + layout:
  1. **Lazy TipTap per cell**: new `StaticCellEmbed` renders a single-embed cell's occurrence DIRECTLY via `<ModuleInstance>`/`<ModuleContainer>` (wrapped in `CellEmbedContext.Provider` for fieldVisibility/hideLabel) with NO TipTap editor. `TableCell` only mounts `<Editor mode="cell">` when the cell is focused or hovered (`showEditor = !embedOccId || isFocused || hovered`). Cut ~24 live editors on the Schedule Table to ~1–2 → no more crash. Free-text (non-embed) cells still always use the editor.
  2. **Row/column virtualization REMOVED** (`useVirtualizer`, `rowVirtualizer`, `colVirtualizer`, `finalVirtualRows/Cols`, augmented/debounced focused-cell machinery, `measureElement`, `ROW_H`, `totalRowsHeight` — ~245 lines deleted). Rows are now normal-flow flex rows (`display:flex; align-items:stretch; width:totalColsWidth`). Each row sizes to its tallest cell and all cells stretch to match — fixes the "extra random line"/overlap and the non-uniform heights. Header is a flex row (`position:sticky top:0`) instead of absolute-positioned virtual columns. `totalColsWidth = sum(effectiveWidths)+ROW_ACTION_COL_W`. Body wrapper class renamed `table-body-virtual`→`table-body-flow`.
- **index.css** — Removed the `.table-td .instance-content {flex-wrap:nowrap}` / `.instance-fields` overrides (they blocked the normal wrap-fields-under-label behavior the user wants). Removed the rule that stripped `.instance-wrap/.instance-row` card chrome — embedded occurrences now look EXACTLY like instances anywhere else (border/bg/shadow). Kept only `.table-cell-static{width:100%}` + `.table-td .instance-wrap{width/max-width:100%;margin:0}` for containment. `.table-td` padding bumped to `8px` (the cell is the container/drop point). `.table-body-virtual:hover`→`.table-body-flow:hover` for the remove-row button.

## Recent Changes (May 18 2026 — ModuleInstance synthesizes bindings for "show"-mode fieldVisibility)
- **ModuleInstance.jsx (`instanceFields` useMemo)**: when `effectiveFieldVisibility.mode === "show"`, the renderer now SYNTHESIZES a `{fieldId, role:"input"}` binding for any fieldId in the show-list that isn't already in `instance.fieldBindings`. Without this, the Schedule Table's Date/Time projection columns rendered empty: schedule task modules don't formally bind `dateFieldId` / `timeslotFieldId` (those are stamped as VALUES on each occurrence by Build Day's APPLY_TEMPLATE `defaultFields`), so `instance.fieldBindings.filter(b => fieldPassesVisibility(b.fieldId, {mode:"show",fieldIds:[dateFid]}))` matched zero bindings → no FieldRenderer mounted → empty cell. Synthesizing fills the gap so any field with a value on the occurrence renders even when the module doesn't formally bind it. Hide-mode and null-mode paths unchanged.
- **index.css `.table-td`**: dropped `min-height`, dropped `display:flex/align-items:center`, dropped `overflow:hidden`. Now: `display:block`, `overflow-x:hidden / overflow-y:visible`. Rationale: with dynamic row heights via `measureElement`, content drives the row's height — vertical clipping defeats the purpose. Horizontal clipping is still on so wide content doesn't bleed across columns. Added `.table-td .instance-wrap, .table-td .instance-row { background:transparent; border:none; box-shadow:none }` to strip the inner ModuleInstance card chrome — without this the cell looked like a card-inside-a-card with a visible inner border (the "weird line in the middle of the rows" the user spotted).

## Recent Changes (May 18 2026 — Table responsive widths, dynamic row heights, hideLabel)
- **containers/ContainerTable.jsx** — three big changes:
  1. **Dynamic row heights**: rowVirtualizer now passes `measureElement` (uses `getBoundingClientRect().height`). Cells are no longer absolute-positioned individually; each row is wrapped in a single absolute-positioned `.table-row` flex container whose ref feeds `rowVirtualizer.measureElement(...)`. Rows grow to fit their tallest cell's natural content height (per user request: "always show the full content, height shouldn't be fixed"). `ROW_H` is now just the minimum (44px) so short rows don't collapse. Column virtualization dropped (4-col tables render cheaply; horizontal scroll still works via `colVirtualizer.getTotalSize()` width on the row wrapper).
  2. **Responsive column widths**: new `containerWidth` state fed by `ResizeObserver` on the scroll container. `effectiveWidths` proportionally scales the persisted `col.width` values up to fill the available container width (minus the trailing action column), but only when the sum is LESS than the viewport — never shrinks below the user's chosen widths (horizontal scroll handles narrow viewports).
  3. **`hideLabel` column property**: new optional bool on `column` config. When `true`, the cell embed's `ModuleInstance` skips the label row (the row's task name) so single-field projection columns (Date / Time) display only the targeted field. Threaded as `TableCell hideLabel` → `Editor hideLabel` → `CellEmbedContext.hideLabel` → `ModuleEmbedNode → ModuleInstance embedHideLabel`. `effectiveShowLabel = !embedHideLabel && showLabel` inside `InstanceInner` overrides the user's local toggle when set by the embed host. The fields-section condition also gained `embedHideLabel || showLabel` so fields stay visible when the embed forces label off (we want a fields-only view, not a fields-and-label-both-hidden view).

## Recent Changes (May 18 2026 — TableCell initial content reads from prop, not stale ref)
- **containers/ContainerTable.jsx (`TableCell`)** — `initialContent = useRef(initialDoc || emptyCellDoc())` (was `useRef(tableRef.current.cells[key] || emptyCellDoc())`). The parent now passes `initialDoc={cells[cellKey(r,c)] || null}` at the call site. Root cause of "table renders rows but every cell is empty" after the Schedule Table: Build op ran: `tableRef.current` is updated in a `useEffect` that runs AFTER commit, so during the first render where a cell mounts (e.g. row 0..5 transitioning from non-existent to existent), the ref still holds the previous snapshot's `cells` map. For brand-new keys, `tableRef.current.cells[key]` was always `undefined` → `emptyCellDoc()` → TipTap mounted uncontrolled with an empty paragraph → the later ref update couldn't repopulate the editor. Reading from the `initialDoc` prop captures the up-to-date cell content from the current render's `cells` closure, so the embed doc lands in TipTap correctly on first mount.

## Recent Changes (May 18 2026 — ContainerTable null-cells crash guard)
- **containers/ContainerTable.jsx (`table` useMemo)**: Normalizes `raw.cells / .columns / .rowCount` whenever the stored `occurrence.meta.table` has wrong-type values (e.g. `cells: null` from a partial earlier write, or Mongoose Mixed-type empty-subdoc quirks). Before the guard, `TableCell.initialContent = useRef(tableRef.current.cells[key] || emptyCellDoc())` threw "can't access property '0:0', t.current.cells is null" and the whole panel crashed on reload. Defaults: `cells → {}`, `columns → DEFAULT_TABLE().columns`, `rowCount → 0`. Behavior-preserving for well-formed tables.

## Recent Changes (May 18 2026 — Cell text vertical center + diagnostic rollup)
- **index.css `.table-td`** — added `display: flex; align-items: center` so single-line text typed into a cell vertically centers instead of hugging the cell's top border (screenshot showed "yikytk" flush with the top edge). Also added `.table-td > .doc-editor-wrapper { width: 100%; min-height: 0 }`, `.table-td .doc-editor-content.ProseMirror { min-height: 0; line-height: 1.3 }`, and `.table-td .doc-editor-content.ProseMirror p { margin: 0 }` to zero out the default ProseMirror block margin and tighten line-height so the centered text reads cleanly inside the 28px row height.
- **operationExecutor.js `[SCHED-TABLE]` log** — was emitting one entry per loop iteration (~204 lines per run). Replaced with: (1) a single `pipeline complete` summary that rolls up `outerIfThen/Else`, `innerIfThen/Else`, `copyLinkActions`, `cellUpdates`, `createItems`, `updateOccurrence`, `durationMs`; (2) `step` lines only for top-level FIND/INIT_VAR (`$tblId / $schedPageId / $goalOccId / $cg / $schedDate / $r / $goalTpl`) plus every COPY_LINK and any UPDATE whose path mentions `cells|rowCount`. Lets us read the run summary at a glance and see whether the inner dedup is bailing (rows already exist → `innerIfThen: 0`) or whether COPY_LINK / cell UPDATE actually ran.

## Recent Changes (May 18 2026 — Focused cell shows fill handle + Schedule Table tail tracker name)
- **containers/ContainerTable.jsx** — focused TableCell now gets `table-td-focused` class (alongside the existing `table-td`). New CSS rule `.table-td-focused { overflow: visible; z-index: 4; }` lifts the overflow clip on focus so the fill-handle nub (positioned `bottom: -4px`) and the Copy/CopyLink mode chip (`bottom: -18px`) — both intentionally outside the cell bounds so they don't eat content space — are visible. `.table-td`'s baseline `overflow: hidden` still clips cell content when the cell is NOT focused. Symptom this fixes: user reported the copy-link copy handle for cells was hidden; it was being cropped by the cell's `overflow: hidden`.
- **operationExecutor.js** — added `[SCHED-TABLE]` console diagnostics symmetric to `[BUILD-DAY]`: logs whether `Schedule Table: Build` is present in the loaded ops, whether it matches the current trigger, when it runs, full step-by-step pipeline trace (`action`/`if`/`loop_iter`), and pipeline completion summary (createItems + updateOccurrence counts). Useful for verifying that the seeded op fires on onLoad and resolving why the page renders empty cells beyond headers.
- **server/utils/liveSystemBuilders.js + server/scripts/createLiveData.js** — `makeScheduleBuildDayOp` gained `completedTrackerName` param (defaults to "Tracker: Tasks Completed Today" for createTestGrid compatibility). createLiveData passes `"Tracker: Completed Today"` (the name it actually seeds — confirmed by the `[RUN_OPERATION] operation not found: Tracker: Tasks Completed Today` console error from the user). Re-seed required for live grids: `node --env-file=.env server/scripts/createLiveData.js`.

## Recent Changes (May 18 2026 — Folder click → new page actually opens + table render diagnostics)
- **ManifestTree.jsx (`FolderNode.handleFolderClick`, `LocalFolderGroup.openFolderAsPage`, `ManifestTree.handleCreatePage`)** — newly minted folder/page occurrences now carry BOTH `moduleId` AND `targetId` set to the new module's id (was just `targetId`). Server's `createOccurrenceData` already wrote `moduleId` correctly when persisting, but its echo (`socket.to(userRoom).emit`) goes to OTHER sockets only — the originating client never received the corrected occurrence, so locally `occ.moduleId === undefined` forever. Downstream effect: `ModulePanel.pagesList` lookup `modulesById[occ.moduleId]` returned undefined, the new folder/page was excluded from `pagesList`, and `activePageEntry` fell through to `pagesList[0] || null` → user saw the panel snap back to whatever sat in slot 0 (the "Schedule" page, hence the symptom "clicking folders just resets back to schedule"). Schema-canonical name is `moduleId` (server `models/Occurrence.js:12`); `targetId` lingers as a legacy alias still read by some Layout helpers. Carry both — clean cut after the rest of the codebase migrates off `targetId`.
- **containers/ContainerTable.jsx** — added `[table]` diagnostic `console.log` on every meta.table change (occId, label, rowCount, columns, cellsPersisted, hasMetaTable) and a `[table] empty render` `console.warn` when rowCount > 0 but virtualizer returned 0 items (logs containerRef clientHeight/scrollHeight so we can see if it's a flex-collapse issue). Disable with `window.__moduliTableDiag = false`. Useful for distinguishing "Schedule Table page seeded with rowCount:0 → op didn't fill it" (cellsPersisted will also be 0) from "user-created table with rowCount:4 but body not rendering" (clientHeight will be 0).

## Recent Changes (May 18 2026 — fieldVisibility cascade + table-as-page)
- **Rename**: table `column.fieldFilter` → `column.fieldVisibility` everywhere (clean cut, no alias). Shape unchanged `{ mode:"show"|"hide", fieldIds:[] }`.
- **ModuleInstance.jsx** — `instanceFields` now filters bindings via `fieldPassesVisibility(fieldId, effectiveFieldVisibility)`. `effectiveFieldVisibility` = column override from `CellEmbedContext.fieldVisibility` (wins) ELSE `getEffectiveFieldVisibilityForOccurrence(occurrence,…)` (ancestor cascade). This is THE single render chokepoint — covers list/doc/board/canvas/table.
- **ContainerTable.jsx** — `tableFieldVisibility` memo resolves the table-container occ's cascaded visibility; each cell gets `col.fieldVisibility ?? tableFieldVisibility` (embedded cell occs are NOT parented under the table, so the column must pass it down explicitly). Kebab "All" relabeled "Inherit"; shows inherited/effective summary.
- **ModuleContainer / ModulePage / ModulePanel** — mount `<FieldVisibilitySection occurrence={…} />` next to `<FiltersSection>` in the chevron HeaderDropdown.
- **ModulePage.jsx** — new `kind === "table"` branch → renders `<ContainerTable occurrence=… />` (mirrors canvas/doc page delegation). Table is now a valid page kind.
- **ManifestTree.jsx** — added "Table page" to the page-create RadialMenu (`handleCreatePage("table")`), `Table` lucide import.

## Recent Changes (May 18 2026 — Table container, virtualized + sort/filter)
- **containers/ContainerTable.jsx (NEW)** — Layout-only `kind:"table"` container. Each visible cell is a live `<Editor mode="cell">` over a TipTap doc fragment stored in `occurrence.meta.table.cells["r:c"]`. Rows/cols/cells are NOT entities — pure positional data. Shape: `{ columns:[{id,title,width,displayFieldId,sort,filter}], rowCount, cells }`. TanStack-React-Table owns the column model + view-only sort/filter (cells map never rewritten); `@tanstack/react-virtual` owns row + column virtualization (overscan rows 8 / cols 2) so only on-screen cells mount a TipTap instance. Focused cell is pinned in the rendered set across scroll so the caret is never destroyed mid-edit. Spreadsheet nav (Tab/Enter/Shift+Tab/arrows-at-edge) via `<Editor>` cell mode. Excel-style copylink fill-drag (Copy/CopyLink chip + Alt-override) reuses `assignLinkedGroup` + existing optimistic linked fan-out; embed source mints a new occurrence with the same `targetId` + copied fields. Per-column "Show field" picker projects a single field from a cell-embedded occurrence; the embed renders compact via a CellEmbedContext provider (`docs/CellEmbedContext.js`).
- **ModuleContainer.jsx** — Added `kind:"table"` routing branch (alongside doc / canvas) that renders `<ContainerTable>` with the container occurrence.
- **ContainerKindSelector.jsx + QuickAddMenu.jsx** — `table` exposed as a creatable container kind (amber Table icon).
- **docs/ModuleEmbedNode.jsx** — When rendered inside a CellEmbedContext (table cell), reads `displayFieldId` from context and projects a single `<FieldRenderer compact hideName>` instead of the full embed.

## Recent Changes (May 16 2026 — Round 2: canvas center + edge bars + manifest X-in-pill + panel filter hide)
- **CanvasContent.jsx** — `snapToCenter` (and initial mount jump) now ALWAYS go to world center, regardless of card positions. Reasoning: "the entire point is expanding the canvas size" — landing on the bounding-box centroid kept cards visually pinned to the top-left, defeating the world-expansion. Cards near (0,0) are now visibly offset from center on first paint, which is the intended affordance.
- **CanvasContent.jsx** — Edge hover bars: 4 absolute-positioned strips (`.canvas-edge-top/bottom/left/right`) light up the instant the dragover pointer enters a 60px edge zone, BEFORE the 400ms autoscroll delay fires. Pulse animation (`canvas-edge-pulse`). Sticky to the surface (z:25, pointer-events:none) so they don't intercept the drag.
- **ManifestTree.jsx** — X close button moved INSIDE NodePill via the new `leadingSlot` prop on NodePill (rendered just before the GripVertical drag handle). `.manifest-row-x-slot` CSS collapses to width:0 on idle, expands on row hover. Expand-as-page buttons removed entirely from PageTreeNode (canvas + folder) AND from FolderNode/LocalFolderGroup — the folder pill itself opens the folder as a page on click; the chevron is now the sole expand/collapse toggle (no longer also toggles open in FolderNode.handleFolderClick).
- **NodePill.jsx** — new `leadingSlot` prop renders before the drag handle/icon. Depth indent bumped from `depth * 12` → `depth * 20` for stronger visual hierarchy.
- **ModulePanel.jsx** — `<HeaderChevron>` removed from the panel header (and the import). Comment explains: filter UI is intentionally hidden on panels but the `filterOverride` cascade and the local `filters[]` array still flow through unchanged, so descendants of a panel still inherit grid/ancestor filters even if the panel has all its local filters off (skip-generations — verified via `getEffectiveFilterForOccurrence` + `getLocalFilterConditions` in state/selectors.js).
- **Toolbar.jsx** — removed the `borderBottom: "2px solid var(--border-default)"` from the main toolbar (grid header bar) per user request.

## Recent Changes (May 16 2026 — Canvas world pan/autoscroll/center + manifest tree affordances)
- **CanvasContent.jsx** — rewritten around a pannable WORLD (4000×4000) inside an overflow:auto surface. New `grab` draw tool (Hand icon) pans by dragging the surface; cursor switches between `grab` and `grabbing`. Snap-to-center button (`Crosshair`) recentres the viewport on the card-bounding-box centroid (or world center if empty); also called on initial mount. Trash/Clear button **removed** per feedback.
- **CanvasContent.jsx** — drag-edge autoscroll: `onDragOver` on the surface tracks pointer position; if within 60px of an edge, a 400ms delay timer fires, then an interval pans the surface every 16ms toward that edge. Cancels on `dragleave`/`drop`. The 400ms grace stops accidental pan when the user just drags a card OUT toward the edge.
- **CanvasContent.jsx** — drawing canvas is now sized to the world (4000×4000 fixed) instead of resize-observed to viewport. Drawing pointer events are bound on the WORLD div so coords land directly in world space.
- **CanvasContent.jsx** — mobile (`useMobileDetect`): the horizontal toolbar collapses into a chevron-down dropdown button that opens a vertical grouped popout (`canvas-toolbar-dropdown` CSS). The desktop Hide button is replaced by this dropdown on mobile. Snap-to-center stays inline on mobile.
- **dropHandlers.js** — all 4 canvas drop sites now add `surface.scrollLeft/scrollTop` to the viewport-relative coords so dropped cards land at the cursor's WORLD position. Without this, dropping after panning would land cards in viewport-relative spots (wrong).
- **ManifestTree.jsx** — `PageTreeNode` X close button moved to the LEFT of NodePill (was right); pill stretches the full right edge now. `Maximize2` expand-page button added on the far right for canvas + folder kinds (revealed on row hover). `LocalFolderGroup` folder click now opens the folder as a page (mints a folder-page occurrence on demand, mirrors `FolderNode.handleFolderClick`); same expand-page button on the far right. `FolderNode` (root tree) also gets the expand-page button.
- **index.css** — `.manifest-row` hover pattern: `.page-tree-close-btn` + `.manifest-expand-btn` collapse to zero width when not hovered (`max-width: 0`) so they don't reserve right-side space. Hover expands them. New section 17 `CANVAS TOOLBAR & SURFACE` with `.canvas-toolbar`, `.canvas-toolbar-group`, `.canvas-toolbar-dropdown`, and slim scrollbar styling for `.canvas-surface`.

## Recent Changes (May 14 2026 — Local filter conditions included in visibility)
- **ModulePage.jsx** — `pageActiveFilterConditions` now combines the grid's active named-filter conditions with `getLocalFilterConditions(occurrence)` (synthesized IS-rows for `occurrence.filters[]` entries with `condition: null`). Required to make the schedule-page Time Slot select (`createTestGrid.js` seeds it as a local filter) actually filter child slot containers — without this, the dropdown wrote to `filterOverride[timeslotFieldId]` but `isOccurrenceVisible` had no condition to consult and returned early after passing the grid's date conditions.
- **ModuleContainer.jsx** — same combination on `activeFilterConditions` (mirrors ModulePage; covers container-level local filters down the tree).

## Recent Changes (May 13 2026 — HeaderDropdown chevron mounted on Panel/Page/Container)
- **ModuleContainer.jsx / ModulePage.jsx / ModulePanel.jsx** — each header now mounts a `<HeaderChevron>` (alongside QuickAddMenu / LocalFilterNav). Chevron opens `<HeaderDropdown>` rendered at the JSX bottom containing `<FiltersSection occurrence={...} />` + `<TemplatesSection occurrence={...} />`. Each file holds its own `dropdownAnchor` `useState` + `openDropdown`/`closeDropdown` callbacks. Occurrence variable per file: `containerOccurrence`, `occurrence`, `panelOccurrence`.
- **ModuleContainer.jsx** — also passes `hostOccurrence={containerOccurrence}` to QuickAddMenu so template tiles can apply directly under it. Same pattern in ModulePage (`hostOccurrence={occurrence}`) and ModulePanel (`hostOccurrence={panelOccurrence}`).
- **ModuleContainer.jsx legacy template plumbing — DELETED.** `gridTemplates` useMemo, `handleSaveAsTemplate`, `handleFillFromTemplate`, `templatePopupPos`, the radial "Save as Template" item, and all `onSaveAsTemplate`/`onFillFromTemplate`/`templates` prop wiring are gone. Save/Apply flows live in TemplatesSection.
- **containerPopups.jsx** — `TemplatePickerPopup` export removed.

## Recent Changes (May 11 2026 — Canvas toolbar: line tool + undo/redo + hide)
- **CanvasContent.jsx**: Added `line` tool (Minus icon) alongside pen/rect/circle/eraser. `renderStrokes` + `onPointerMove` (live preview) + `onPointerUp` (commit) each have a `line` branch that draws a single segment from `currentPath[0]` to the drop point.
- **CanvasContent.jsx**: Stroke history is now undoable. Added a `redoStack` state; `undo` pops the last stroke onto `redoStack` and persists the truncated list, `redo` reverses it. Drawing a new stroke clears `redoStack` (standard branch-cut semantics). Undo / Redo / Clear are three buttons in the toolbar's right cluster, with `disabled` states wired to `strokes.length === 0` / `redoStack.length === 0`.
- **CanvasContent.jsx**: Added an in-toolbar **Hide** button (ChevronUp) that flips `toolbarOpen` to false; while collapsed, a small `<Pencil> Tools` pill renders top-right of the canvas surface to re-open. `toolbarOpen` re-syncs from the `showToolbar` prop via `useEffect` so parents can still force the toolbar open/closed.

## Recent Changes (May 10 2026 — Local tree + instance field wrap + date picker)
- **ManifestTree.jsx**: Added `LocalFolderGroup` component that mirrors `FolderNode`'s render structure (chevron + folder NodePill, children indented `marginLeft` via depth). The `isPagePanel` branch now uses left-aligned layout — replaced the right-aligned "LOCAL 📁" banner + `justify-content: flex-end` folder headers + `reverseIndent={true}` PageTreeNodes with `LocalFolderGroup` for folder groups + plain `PageTreeNode depth={0}` for root pages. Local now visually matches Root.
- **ModuleInstance.jsx**: `.instance-content` flex row gains `flexWrap: "wrap"` + `rowGap: 4`; `.instance-fields` changes `flex: 1` → `flex: "1 1 160px"`. Together: when the parent panel is wide enough the fields stay inline-right of the label, but when the row would force fields to crush the label (e.g. narrow Schedule slots, mobile), the entire fields block wraps to a second row underneath the label at full width.

## Recent Changes (May 10 2026 — Page Header Tweaks)
- **ModulePanel.jsx**: Added `Layers` lucide import. Page panel header now includes the grid-cell stack switcher (`panel-stack-btn-inline` with Layers icon + count) inline to the RIGHT of QuickAddMenu, inside the existing actions div. Reads `dragCtx.getStackForPanel(module)` and only renders when `stack.length > 1`. Removed `marginLeft: 18` from the active page label `<span>` — handle and label now sit flush (gap is just the parent flex `gap: 6`).
- **Grid.jsx**: GridCell-level stack button now gated by `stackCount > 0 && !hasPanel` (was just `stackCount > 0`). When a panel occupies the cell, the switcher lives in the panel header instead — prevents double rendering.

## Recent Changes (Apr 26 2026 — Per-day Container/Occurrence Pairs)
- **ModulePage.jsx**: `containersList` (board pages) now returns `[{ container, occurrence }]` pairs instead of just containers. The lookup walks `occurrence.occurrences[]` and picks the FIRST child occurrence of each container module that passes `isOccurrenceVisible(occ, pageEffectiveFilters, …)`. When a container has no occurrence at all, falls back to `{ container, occurrence: null }` (preserves prior behavior for newly-created/empty containers).
- **pages/PageBoard.jsx**: Consumes the pair shape directly — `containersList.map(({ container, occurrence }) => …)` and forwards `occurrenceOverride={containerOcc}` to `<Container>`. Removed the redundant `find(targetId === ...)` lookup that picked the wrong-day occurrence when multiple per-day occurrences of the same slot module existed (root cause of stale radial-menu / popover anchors on the schedule).
- Fix scope: schedule slot containers now anchor to the correct per-day occurrence; container popover refs stay valid across day navigation.

## Recent Changes (Apr 25 2026 — Artifact + Textblock Roles)
- **ArtifactCard.jsx** (NEW): Pure renderer for `role:"artifact"` modules sitting in a container. Thumbnail mode (~120px tall, click to expand) and expanded mode that fills the parent `.instance-wrap` row. Video uses `<video controls autoPlay>`, image uses `<img>`, audio uses `<audio controls>`, pdf uses `<iframe>`. X button (`.artifact-expand-close`) collapses back. Reads `module.kind` (image/video/audio/pdf) and `module.fileRef`. No state in occurrence, no view, no panel involved — just an inline card.
- **TextblockCard.jsx** (NEW): Pure renderer for `role:"textblock"` modules. Wraps the existing `<Editor>` on `occurrence.textmap`. Save path is the same as DocContent (Editor's onChange → updateOccurrence). One CSS class `.textblock-card`.
- **ModuleContainer.jsx**: Child render loop routes by `module.role` — `<ModuleInstance renderBody=ArtifactCard>` for artifacts, `<ModuleInstance renderBody=TextblockCard>` for textblocks, plain `<ModuleInstance>` for instances. Reads merged `leafModulesById` from context and passes it to `getContainerItems` / `getContainerItemsWithOccurrences` (was passing `instancesById`). QuickAddMenu now has `onAddTextblock` callback that calls `CommitHelpers.createTextblockInContainer`.
- **ModuleInstance.jsx**: Added `renderBody = null` prop on `InstanceInner` and the outer wrapper. When provided, replaces the standard fields/operations layout (the old inline `instance.fileRef` `<img>/<video>/🎵` block was deleted — artifacts no longer reach this path; they go through `ArtifactCard` via `renderBody`).
- **ModulePanel.jsx**: `getContainerItems` call now uses `leafModulesById` instead of `instancesById`.

## Recent Changes (Apr 15 2026 — embedSourceType for Drag-Out)
- **ModuleInstance.jsx**: Added `embedSourceType = null` prop. Passed as `sourceType` in `useDragDrop` context so DragProvider knows the drag originated from a doc embed.
- **ModuleContainer.jsx**: Same — `embedSourceType = null` prop + `sourceType: embedSourceType` in `useDragDrop` context.

## Recent Changes (Apr 12 2026 — Container/Page Subtype Extraction)
- **modules/pages/PageBoard.jsx** (NEW): Board page — drop zone + sortable Container list with loading state + empty placeholder. Extracted from inline JSX in ModulePage.jsx.
- **modules/pages/PageDoc.jsx** (NEW): Doc page — thin wrapper around `DocEditorShell` in a scroll container.
- **modules/pages/PageCanvas.jsx** (NEW): Canvas page — thin wrapper delegating to `<Container occurrenceOverride>`.
- **modules/pages/PageDisplay.jsx** (NEW): Display page — thin wrapper around `<Artifact>`.
- **modules/pages/PageFolder.jsx** (NEW): Folder page — full drilldown grid (PreviewNodes, Windows 7 breadcrumb header, peer nav arrows, keyboard shortcuts). Extracted the `FolderContent` function from ModulePage.jsx.
- **ModulePage.jsx**: Old inline `FolderContent` function (195 lines) deleted. Kind routing replaced with clean 1-liner `<PageBoard>` / `<PageDoc>` / `<PageCanvas>` / `<PageDisplay>` / `<PageFolder>` calls.
- **modules/containers/ContainerPool.jsx** (NEW): Pool container content — manages own search/add state (`poolSearch`, `poolAddLabel`, `isPoolAdding`). Props: `itemsWithOccurrences`, `dispatch`, `socket`, `listDropRef`, `module`, `ctxState`. Extracted from ModuleContainer.jsx.
- **modules/containers/ContainerDoc.jsx** (NEW): Re-export alias — `export { DocEditorShell as default }` from DocContent.jsx.
- **modules/containers/ContainerCanvas.jsx** (NEW): Re-export alias — `export { default }` from CanvasContent.jsx.
- **ModuleContainer.jsx**: Pool state (`poolSearch`, `poolAddLabel`, `isPoolAdding`) removed from `useReducer`. Pool setters + `handlePoolAdd` deleted. Inline pool JSX replaced with `<ContainerPool>`. `Search` + `Plus` lucide imports removed (now only in ContainerPool). `PoolPill` import removed from containerHelpers (now in ContainerPool). `DocEditorShell` import updated to come from `./DocContent.jsx` directly.

## Recent Changes (Apr 11 2026 — Upfront Textmap Loading)
- **DocContent.jsx**: Removed lazy textmap fetch `useEffect` — no longer emits `request_textmap`. Server now sends all textmaps in `full_state` (decompressed, upfront). `hasValidTextmap` guard (`typeof textmap === "object"`) kept as safety net against any stale compressed strings.
- **ArtifactContent.jsx**: Added `typeof occurrence.textmap === "object"` guard on `content` prop passed to Editor — prevents TipTap from receiving a compressed base64 string as content (which would render as raw text).

## Recent Changes (Apr 10 2026 — DocContent draggable=false Fix)
- **DocContent.jsx**: Added `draggable={false}` to the `.doc-container` wrapper div. Root cause of click delay + beginning-of-doc cursor: Pragmatic DnD sets `draggable="true"` on parent container/page shells, and browsers intercept mousedown to check for drag. `draggable="false"` on the editor wrapper opts out. (Same fix as Editor.jsx's doc-editor-wrapper.)

## Recent Changes (Apr 10 2026 — DocContent Cursor Fix)
- **DocContent.jsx**: Fixed cursor placement bug. Wrapper `onClick` (fires when clicking padding area of `.doc-container` outside ProseMirror) now calls `editor.commands.focus()` instead of `posAtCoords(e.clientX, e.clientY)`. Root cause: `posAtCoords` in the padding area returns position 0 = beginning of document, overriding the user's intended cursor position. Same fix as Editor.jsx (Apr 10). Applies to all doc-capable contexts: main doc pages, mini textblock sub-editors, embedded containers.

## Recent Changes (Apr 9 2026 — Drag Fix + Local Tree + X Buttons)
- **ModuleInstance.jsx**: Removed `draggable={false}` from drag handle div (line ~259). This was preventing Chrome from finding `draggable="true"` on the wrapper via DOM walk-up. Instance dragging now works.
- **ManifestTree.jsx**: Local tree `PageTreeNode` now uses normal `row` flex direction (not `row-reverse`). `reverseIndent=true` on NodePill still makes label-left/icon-right (mirror of root tree). Chevron stays on far right. X button (`page-tree-close-btn`) inline style `opacity: 0` removed — CSS class handles it. X button color changed from `var(--text-faint)` to `var(--text-muted)` for visibility.
- **ModulePanel.jsx**: Page header X button color changed from `var(--text-faint)` to `var(--text-muted)`. Hover color changed to `var(--text-primary)`.

## Recent Changes (Apr 9 2026 — B2/B3 Tree Nesting + Folder Breadcrumbs)
- **ModulePanel.jsx**: Replaced navHistory-based breadcrumbs with `pageBreadcrumbs` useMemo — computes folder path by walking `occ.parentId → foldersById` chain from active page. Shows `Folder › Subfolder › Page` when page has parent folder. Always visible (not history-dependent). navHistory state + tracking useEffect removed. Also removed `ArrowLeft` import. (B3)
- **ManifestTree.jsx**: Local tree now groups pages by parent folder via `localTreeData` useMemo — `occ.parentId → foldersById` lookup, renders folder header rows + indented PageTreeNode items. (B2)

## Recent Changes (Apr 6 2026 — Phase E: Inline Preview + Tree Reorder + Folder Pages)
- **PreviewNode.jsx**: Completely rewritten — removed iframe-based `ThumbnailPreview` (was causing reload loops via extra socket connections). Replaced with `InlinePreview` that renders from store data: doc pages show text snippets from textmap, board/folder pages show child container bars with labels + counts, fallback shows file icon. Deleted `thumbnailCache.js` and `PagePreviewApp.jsx`.
- **ManifestTree.jsx**: DocNode file rows now act as drop targets for reorder. Dragging an artifact between DocNode rows shows a blue drop indicator (top/bottom edge). On drop, sets `sortOrder` to midpoint between siblings. Uses `dropEdgeRef` to avoid stale closure in onDrop. FolderNode auto-creates folder-page occurrence on click when one doesn't exist (fixes root folder not opening as page).
- **ModulePage.jsx**: Removed `thumbnailCache.js` prewarm useEffect (was loading iframes for child occurrences).

## Recent Changes (Apr 6 2026 — Delete Fix + Radial Delete)
- **ModuleInstance.jsx**: `deleteMe` changed from `CommitHelpers.deleteModule` (which deleted the module + ALL occurrences) to `CommitHelpers.removeOccurrence` (only removes this single occurrence). Root cause of "deleting one copy deletes all copies" bug. RadialMenu now has `onDelete` prop wired.
- **ModuleContainer.jsx**: All 3 RadialMenu instances now have `onDelete={removeMe}` — adds red "Remove" button to radial arc.
- **ModulePanel.jsx**: RadialMenu now has `onDelete={handleRemovePanel}` — adds red "Remove" button to radial arc.

## Recent Changes (Apr 3 2026 — Iframe Previews + Breadcrumbs + Spinner + Handle Left)
- **PreviewNode.jsx**: Replaced Puppeteer PNG approach with iframe pointing to `/preview-render/:occId`. Scale = 90/600 = 0.15, iframe 900×600 → visually 135×90px. Fade-in when loaded. Fallback settle timeout 6s. No more `…` per-card placeholder. `useCallback` + `useRef` for settle deduplication.
- **ModulePanel.jsx**: Added `navHistory` state + `prevActiveOccRef` to track page navigation. useEffect pushes to history on `currentView.activeOccurrenceId` change. Added `breadcrumbBar` JSX between sidebarToggleBar and pageContent — shows `← FolderName › PageName` when 2+ entries. Back button pops history. Breadcrumb labels click to navigate back. Added `ArrowLeft` import.
- **ModulePanel.jsx**: Root/local tree sidebars extended to full panel height on desktop (`bottom: 0`, `maxHeight: "100%"`). Mobile keeps `maxHeight: "50%"`.
- **ModulePanel.jsx**: Page panel drag handle moved to the LEFT of the label in pageHeader. Removed `padding-left: 30px`. Handle is now `[handle+radial] [label] [QuickAdd]`.
- **ModuleContainer.jsx**: Removed standalone chevron `<button>` from both embedded and standard container headers. Collapse/expand now only available via radial menu (`onToggleCollapse`).
- **spinner.jsx**: Added `xl: 96` size (was max `lg: 36`). Borders: `xl: 4`. Inner mark now uses `left/right: b+3, top: 50%, transform: translateY(-50%)` with `width: "100%", height: "auto"` on SVG — preserves natural aspect ratio instead of forcing square container.
- **ModulePage.jsx**: Loading overlay uses `size="xl"` (was `lg`).
- **App.jsx**: Loading spinner uses `size="xl"` (was `lg`).

## Recent Changes (Apr 3 2026 — PreviewNode Server Thumbnails)
- **PreviewNode.jsx**: Replaced hand-rolled mini-render with `ThumbnailPreview` — loads `/api/thumbnail/:occId` (server-generated PNG). Shows "…" while loading, "preview unavailable" on error. Removed all CSS-scale canvas code.
- **server/services/thumbnailService.js** (NEW): Puppeteer singleton service. `generateThumbnail(occId, baseUrl)` → screenshots `/preview-render/:occId`, caches to `uploads/thumbnails/{occId}.png`. `invalidateThumbnail(occId)` deletes cached PNG.
- **server/services/renderPreviewHTML.js** (NEW): Renders occurrence as styled dark-theme HTML. Doc pages: TipTap JSON + `.md` file fallback → HTML. Board pages: container cards with instance rows. Minimal markdown parser included.
- **server/server.js**: `GET /preview-render/:occId` (internal render page) + `GET /api/thumbnail/:occId` (cached PNG endpoint). Invalidation: occurrence update/create/delete all call `invalidateThumbnail` on the occurrence + its parent.
- **server/socketHandlers/occurrences.js**: Imports `invalidateThumbnail`, calls it on update.
- **server/socketHandlers/crud.js**: Imports `invalidateThumbnail`, calls it on create/delete.

## Recent Changes (Apr 3 2026 — PreviewNode + Back Button + Card Size)
- **PreviewNode.jsx**: CSS scale mini-render. Virtual canvas 280px wide, scale ≈ 0.464. `BoardMini` renders real container cards (border/background/header matching actual UI) + instance rows. `DocMini` renders headings (20/16/13px) + paragraphs from textmap.
- **ModulePage.jsx** `FolderContent`: Added `handleDrillDown` wrapper — primes `folderPageOccId` into stack before first drill-in so `canDrillOut` becomes true (stack length ≥ 2) and back button shows. `PreviewNode.onDrillDown` now uses `handleDrillDown` instead of raw `startDrillDown`.
- **index.css**: `.preview-node-grid` gets `align-items: start` so cards don't stretch to fill row height. `.preview-node-preview` is `position: relative; padding: 0`.

## Recent Changes (Apr 2 2026 — Folder Preview + Page Animation + Navigation Fixes)
- **PreviewNode.jsx**: Board/folder pages now show structural block preview — one row per child container with colored left-border, label, and instance count. Doc pages still show text preview. Replaced dot grid with this mini-replica layout. Single click now triggers drilldown (was double-click only).
- **ModulePanel.jsx**: `<Page>` now has `key={activePageEntry.occurrence.id}` — forces remount on page switch, triggering the page-enter animation. `openPage` with `drilldownTarget` now also pre-pins `drilldownTarget` to the panel so it appears in `pagesList` when `handleNavigate` switches to it (was silently failing — falling back to `pagesList[0]`).
- **index.css**: Added `.page-shell { animation: page-enter 300ms cubic-bezier(0.22,1,0.36,1) }` — zoom-from-below-fade-in on every page mount. Added `@keyframes page-enter`.
- **createDefaultUserData.js**: `journalPageOccId` now has `parentId: null` instead of `parentId: filesDayPagesFolderId`. Journal tab is a panel navigation artifact, not a user content page — should not appear in the tree.

## Recent Changes (Apr 2 2026 — Folder-First Navigation Fixes + Local Tree CSS + Cursor Fix)

### Folder-first navigation — one click, breadcrumb working
- **useDrilldown.js**: `ANIM_DURATION` increased 150ms → 220ms. Added `resetStack(initial=[])` to the hook's return value — primes the drilldown stack before `startDrillDown` fires.
- **ModulePage.jsx**: `FolderContent` now receives `panelView` prop directly (from `Page`, which receives it from `ModulePanel`). Removed `viewsById`/`panelOccurrence` lookup — was silently failing when view was on `module.viewId`. `handleNavigate` now uses `panelView` directly. Auto-navigate `useEffect` calls `resetStack([folderPageOccId])` BEFORE `startDrillDown` so stack is `[folderPage, targetPage]` → breadcrumb shows. Timeout reduced from 60ms → 10ms for near-instant switch.
- **FolderContent** no longer destructures `viewsById` (receives `panelView` directly). Also receives `folderPageOccId={occurrence?.id}` from `Page`.

### Local manifest tree CSS — same as root tree
- **ManifestTree.jsx**: Local tree `PageTreeNode` instances now receive `childrenByParentId`, `onSelect={handleSelect}`, `onScrollTo={handleScrollTo}`, `activeOccurrenceId`. Previously missing — local tree showed compact AnchorChips only. Now shows full DocNode rows with nested anchor structure, matching root tree treatment.

### Doc cursor exact positioning
- **index.css**: Removed `user-select: text` from `.doc-editor-content.ProseMirror` — was conflicting with ProseMirror's own selection management, causing cursor to jump to top/bottom only. Now has only `pointer-events: auto; cursor: text;`.

## Recent Changes (Apr 2 2026 — Folder-First Navigation + Anchor Scroll + Zoom Fix)

### Folder-first navigation from tree
- **ManifestTree.jsx**: `FolderNode` now computes `folderPageOcc` useMemo (finds the folder-page occurrence where `mod.kind === "folder" && mod.role === "page"`). Passes `folderPageOccId={folderPageOcc?.id}` to each `PageTreeNode`.
- **ManifestTree.jsx**: `PageTreeNode` updated `onClick` — when `folderPageOccId` exists and page is not already active, calls `onOpenPage(folderPageOccId, { drilldownTarget: pageOccId })` for folder-first flow. Otherwise navigates directly.
- **ModulePanel.jsx**: Added `pendingDrilldown` state. `openPage(occId, options)` now accepts `options.drilldownTarget`, stores it in `pendingDrilldown`. Passes `drilldownTarget={pendingDrilldown}` + `onDrilldownComplete={() => setPendingDrilldown(null)}` to `<Page>`.
- **ModulePage.jsx**: `Page` accepts `drilldownTarget` + `onDrilldownComplete` props, passes them to `FolderContent`.
- **ModulePage.jsx**: `FolderContent` accepts `autoNavigateTo` + `onAutoNavigateComplete` props. `useEffect` on `autoNavigateTo`: after 60ms delay, finds card by `[data-occurrence-id]` and calls `startDrillDown`. Shows breadcrumb trail (back arrow + folder › page labels) when `canDrillOut`.

### Anchor scroll + highlight (already-open page)
- **ManifestTree.jsx**: `handleScrollTo` now detects `pageAlreadyOpen = targetView.activeOccurrenceId === parentOccId`. If already open AND has anchorOccId: does DOM `scrollIntoView` + `.anchor-highlight` CSS animation (double-flash). Only calls `updateView` if page needs to be opened first.

### Zoom animation fix (Windows 7 style)
- **useDrilldown.js**: `ANIM_DURATION` reduced from 280ms → 150ms. `startDrillDown` now calls `onNavigate(occId)` IMMEDIATELY (before animation), so actual content renders during animation instead of a scaled preview. `cardElement` made optional. `getCardAnimStyle` simplified to fade-in animation on target card + opacity-0 on siblings.
- **index.css**: Added `@keyframes drilldown-fade-in` (scale 0.92→1, opacity 0→1). Added `@keyframes anchor-flash` + `.anchor-highlight` class.

### Doc cursor fix
- **Editor.jsx**: Added `useEffect` to call `editor.setEditable(editable, false)` when `editable` prop changes — fixes TipTap not auto-syncing `editable` after initialization.
- **index.css**: Added `pointer-events: auto; user-select: text; cursor: text;` to `.doc-editor-content.ProseMirror`.

## Recent Changes (Apr 2 2026 — Folder Preview Nodes + Tree Width + Day Page Flow)
- **ModulePage.jsx**: Added `folderChildOccs` useMemo at component top level — derives folder children from `occurrencesById` filtered by `parentId === occurrence.parentId` (the folder the page represents). Excludes self, `meta.isTemplate`, and `kind="folder"` nav-only occurrences. `FolderContent` now shows real preview nodes instead of empty "Drop items here".
- **ManifestTree.jsx**: Added `style={{ flex: 1 }}` to all NodePill instances in tree rows (DocNode file row, DocNode anchor, FolderNode, PageTreeNode) — all pills now stretch to the sidebar right edge for uniform visual width.
- **ManifestTree.jsx**: Fixed 2 bugs in FolderNode's `pageOccs` and `artifactOccs` useMemos:
  1. **Folder duplication**: `pageOccs` now excludes occurrences where `module.kind === "folder"` — these are "folder-page" navigation occurrences (created by folderPageDefs) that should NOT appear as tree rows. `handleFolderClick` still finds them via `allChildOccs` for navigation.
  2. **Template visibility**: Both `pageOccs` and `artifactOccs` now exclude `occ.meta?.isTemplate === true` — day page template occurrences no longer appear in the tree.

## Recent Changes (Apr 2 2026 — DocContent Simplification)
- **DocContent.jsx**: Removed `isEditing` state (was causing unnecessary re-renders on every click, and the `.is-editing` class had no CSS rules). Wrapper now always shows `cursor: text` when not locked (was `cursor: default` until first click). Added `showToolbar={!hideToolbar && !isLocked}` to Editor so the doc formatting toolbar appears on doc pages. Comment updated.

## Recent Changes (Apr 1 2026 — Folder PreviewNode + Drilldown + NodePill Entity Styling)
- **PreviewNode.jsx** (NEW): Preview card component for folder pages. Shows module content preview (text excerpt, child dots, or icon fallback). Double-click triggers drilldown. Draggable via Pragmatic DnD. Uses `.preview-node-card`/`.preview-node-preview`/`.preview-node-title` CSS classes.
- **NodePill.jsx**: Added `variant` prop (`"entity"` default, `"compact"` for tight spaces). Entity variant: `padding: "5px 8px"`, `borderRadius: 6`, `border: var(--border-default)`, `background: var(--input-bg)`, `fontSize: 11`, `GripVertical` icon. Depth indent: `depth * 12 + 8` for entity, `depth * 4 + 4` for compact.
- **ModulePage.jsx**: Folder branch now uses `FolderContent` component with `<PreviewNode>` CSS grid + `useDrilldown` hook for zoom animation. Added `ArrowLeft` import, `PreviewNode` import, `useDrilldown` import.
- **ManifestTree.jsx**: `handleSelect` simplified — uses `activePageView || view` as target, no `isPagePanel` check. Added `emit: true` to updateView calls. `PageTreeNode.containerOccs` now merges explicit `occurrences[]` with implicit `childrenByParentId` (deduped) — fixes pages whose children are linked via parentId instead of occurrences array.
- **ModulePanel.jsx**: Removed stray `console.log(activePageLabel)`.

## Recent Changes (Apr 1 2026 — Root Tree Anchors + Mobile Page Margin)
- **ManifestTree.jsx**: Root tree FolderNode changed `showAnchors={false}` → `showAnchors={true}` — anchors now nest properly under their parent docs instead of appearing as a flat list. PageTreeNode updated to accept `childrenByParentId`/`onSelect`/`onScrollTo`/`activeOccurrenceId` props — when present (root tree mode), renders container children as DocNode rows with proper nesting. FolderNode passes these extra props to PageTreeNode.
- **ModulePage.jsx**: Mobile board page horizontal padding reduced from 28px to 6px (`"6px 6px 80px 6px"`).

## Recent Changes (Mar 31 2026 — Folder CRUD + Touch Targets + Performance + Delete Confirm)
- **ManifestTree.jsx**: (1) FolderNode: double-click to rename inline (input with Enter/Escape/blur). Right-click context menu with Rename + Delete. Delete reparents children to parent folder. (2) Touch targets: all ChevronRight toggles, anchor ▾/▸ arrows, and folder `+` button get `padding: "4px 2px"` for minimum touch area. (3) `childrenByParentId` index from context replaces O(n) `Object.values(occurrencesById).filter(parentId)` scans in DocNode and FolderNode. (4) Added `ContextMenu`, `Pencil`, `Trash2` imports.
- **ModulePage.jsx**: `handleDelete` now shows `window.confirm()` before deleting — confirms page name + warns about content removal.

## Recent Changes (Mar 31 2026 — ManifestTree Compact Styling + Anchor Fix)
- **ManifestTree.jsx**: (1) Restored compact styling — `PILL_STYLE` now uses `padding: "1px 5px"`, `fontSize: 10`, `border: transparent`, `background: transparent` (was padded pill style). (2) Anchor chips use `borderRadius: 999` (full pill), `fontSize: 9`, `display: inline-flex` (was block pill). (3) Removed GripVertical icons from all rows. (4) `PageTreeNode.containerOccs` now filters out `role === "page"` children — day page template no longer shows sibling day-specific pages as anchor chips.

## Recent Changes (Mar 30 2026 — ManifestTree Fixes + Doc Page Direct Rendering)
- **ManifestTree.jsx**: (1) PageTreeNode now sorts containerOccs by `sortOrder`. (2) `handleNewDoc` and `handleCreateFolder` migrated from direct `socket.emit` to `CommitHelpers.createModule`/`createOccurrence`/`createFolder`. (3) FolderNode drop target `maxOrder` now considers ALL child occs (was only artifacts). (4) `handleNewDoc` `maxOrder` also uses `allChildOccs` for correct sort position.
- **ModulePage.jsx**: Doc pages (`kind === "doc"`) now render `<DocEditorShell>` directly instead of going through `<Artifact>`. Added `DocEditorShell` import from `./DocContent.jsx`. Artifact import retained for `isTreeView` and `kind === "display"` branches.

## Recent Changes (Mar 29 2026 — Mobile Spacing + Scroll Fixes)
- **ModulePanel.jsx**: (1) `paddingTop: 0` on mobile (was 22 — wasted space for panel cycler that's in GridCell). (2) `margin: "0px 2px 2px 2px"` on mobile (was `3px 6px 6px 6px`). (3) Page content wrappers: added `overflow: "hidden"` to the flex column + relative container divs — fixes scroll chain so boards/docs can scroll. (4) `pageContent` wrapper changed from `overflow: "auto"` to `overflow: "hidden"` + flex column (Page handles its own scroll). (5) Sidebar overlays `width: 100%` on mobile (was 80%), no side border, no border-radius.
- **ModulePage.jsx**: Added `GridLiveContext` import + `isMobile`. Board page padding on mobile: `6px 28px 80px 28px` (was `14px 5px 80px 5px`) — more horizontal padding for rail nav buttons.
- **ManifestTree.jsx**: (1) `showAnchors` prop on DocNode + FolderNode — root tree hides anchor chips/chevrons. (2) Width changed from fixed `154px` to `width: "100%", maxWidth: 180` when expanded — fills container on mobile.
- **ArtifactContent.jsx**: `scrollIntoView({ block: "start" })` → `block: "nearest"` — prevents viewport jumps.

## Recent Changes (Mar 29 2026 — Grid Mobile Spacing)
- **Grid.jsx**: `paddingTop: 0` and `borderRadius: 0` on mobile (was 10px and 12px).

## Recent Changes (Mar 28 2026 — Dual Sidebar + Pill Styling + Draggable Tree Items)
- **ModulePanel.jsx**: Dual `rootTreeOpen` + `localTreeOpen` states. Toggle bar with `📁 Root` (left) and `📄 Local` (right) buttons. Root tree: always uses `state.grid.manifestId` (user manifest), passes `onOpenPage` — shows user-defined folders with pages. Local tree: `<ManifestTree panelOccurrence={...} />` (panel pages only). Both sidebars `position: absolute`, `zIndex: 100`, `maxHeight: 25%`, overlay page content with rounded bottom corner. Touch drag-up-to-close (40px threshold). No `overflow: hidden` on wrapper divs (fixes scroll + popovers). **Panel drag handle moved into toggle bar** (between page switcher and filters) for page panels — old panel header hidden when `hasPages`. Active page label shown to left of drag handle. Toggle bar layout: `[Root] [Local] PageName [DragHandle] [QuickAdd] [Filters]`.
- **ManifestTree.jsx**: All items use shared `PILL_STYLE`/`PILL_ACTIVE`. `PAGE_KIND_ICON` mapping. **DocNode**: pill with FileText icon (blue). **FolderNode**: accepts `onOpenPage`, renders `pageOccs` (role="page" children) as `PageTreeNode` pills alongside artifact DocNodes. **PageTreeNode**: pill with kind icon (cyan), draggable. **AnchorChip**: draggable copy-mode. Local tree (`isPagePanel`) shows only panel pages, no folder tree. Hooks bugs fixed.
- **ModulePage.jsx**: Page shell `overflow: "hidden"` (was "visible", broke scroll). Removed `paddingTop` from page header. Border + borderRadius + background still applied.

## Recent Changes (Mar 28 2026 — Notebook Tree View in Pages)
- **ModulePage.jsx**: Pages with `pageView.hasTree && pageView.manifestId` now render only Artifact content (no sidebar — sidebar is handled by parent panel to avoid duplication). `isTreeView` flag skips `kind` routing, resolves `treeActiveOcc` from `pageView.activeOccurrenceId`, renders `<Artifact>` directly. QuickAddMenu hidden when `isTreeView`. Content wrapper uses `overflow: "hidden"` + no paddingBottom when isTreeView.
- **ModulePanel.jsx**: When `hasPages` and the active page has a tree view (`activePageView.hasTree && activePageView.manifestId`), passes the page's `manifestId` to the panel sidebar's ManifestTree (instead of grid's). Passes `activePageView` prop so doc clicks route through the page's view.
- **ManifestTree.jsx**: New `activePageView` prop. When `isPagePanel && activePageView`, doc clicks call `updateView({ activeOccurrenceId })` on the page's view instead of `onOpenPage()`. `handleScrollTo` and `handleSetDefault` also use `activePageView` when set. Active doc highlight reads `activePageView.activeOccurrenceId` first.

## Recent Changes (Mar 27 2026 — ViewType Rename: artifact→display, list→board, page→board)
- **ModulePanel.jsx**: `currentViewType` fallback `"list"` → `"board"`. Auto-create view for page panels now uses `viewType: "board"` (was `"page"`). `panelViewData` in QuickAdd also uses `"board"`. Artifact panel branch condition: `viewType === "artifact"` → `viewType === "display"`. Comment updated to "Display panel".
- **ManifestTree.jsx**: `panelViewData.viewType` `"page"` → `"board"` when creating a new page.
- **ModulePage.jsx**: Display page fallback `viewType ?? "artifact"` → `viewType ?? "display"`.
- **ModuleRouter.jsx**: `isArtifact` check `viewType === "artifact"` → `viewType === "display"`.
- **ArtifactContent.jsx**: `isArtifact` check `viewType === "artifact"` → `viewType === "display"`. Comment updated.
- **PreviewContent.jsx**: `fullViewType` fallback `"artifact"` → `"display"` (×2).

## Recent Changes (Mar 27 2026 — Centered Handles + Page Tabs Draggable + Sidebar)

### Drag handles centered in headers
- **ModulePanel.jsx** panel handle: added `style={{ position: "static", transform: "none", flexShrink: 0 }}` — handle is now in-flow inside the panel header flex row (was absolute at top:-9px).
- **ModuleContainer.jsx** container handles (both embedded row 1 and standard row): same `position: static` override — handle is now in-flow inside the container header. The `container-cog-handle` (shown when header is hidden) is **unchanged** — stays absolute.
- **ModulePage.jsx**: Removed standalone handle div. Combined handle + page name into one header row for ALL page kinds. Handle is first item in row (`position: static`). Doc pages show just the handle; board/canvas/display show handle + kind icon + label + (board only) QuickAddMenu. `padding: "3px 10px 2px 4px"` on the row.
- **index.css**: `.module-drag-handle` now has `z-index: 10` (fixes handles hiding behind sibling containers).

### Page tabs — draggable to reorder
- **ModulePanel.jsx** `PageTabStrip`: accepts `onReorder` prop. Each tab is `draggable={true}` with HTML5 handlers. Drag-over shows blue left border + bg. `handlePageTabReorder` callback reorders `panelOccurrence.occurrences` via `CommitHelpers.updateOccurrence({ emit: true })`. Tab cursor = `grab`.
- **ModulePanel.jsx**: Page content wrapper has `paddingTop: kind === "doc" ? 10 : 12` — gives handles room + breathing space below tab strip.
- **ModulePage.jsx**: Board content `paddingTop` = `14px` (5px visible gap above containers + 9px for handle at top:-9px).

### ManifestTree — local section + RadialMenu plus button
- Added `PageTreeNode` component — page occurrence as tree row; expands to show container anchor chips; clicking chip opens page + scrolls to container via `data-occ-id`.
- "Open" section below folder tree when `isPagePanel` and pages are open.
- Header `+` replaced with `<RadialMenu handleIcon={<Plus>} items={[Board page/Doc page/Canvas page/Folder]}>` when `isPagePanel`. `handleCreatePage(kind)` calls `CommitHelpers.createPage`. `handleCreateFolder` emits `create_folder` socket event.
- Added `state` to GridActionsContext destructure. Imported `RadialMenu`, `Plus, Layout, FileText, Paintbrush, FolderPlus`.

### Test checklist (Mar 27 2026)
**Drag handles centered**
- [ ] Panel: radial circle is inside the panel header row (not floating above)
- [ ] Container: radial circle is inside the container header row
- [ ] Page (board/canvas/display): handle is on the left of the page name row
- [ ] Page (doc): handle appears in a small header row alone (no name text)
- [ ] Instance handles unchanged (left side of instance rows)
- [ ] Container cog (hidden-header mode) still absolute-positioned at top-left

**Page tab drag reorder**
- [ ] Tab cursor is `grab`
- [ ] Dragging a tab over another shows blue left border on target
- [ ] Dropping reorders tabs immediately (optimistic)
- [ ] Order persists after page reload

**ManifestTree sidebar — page panel**
- [ ] `+` RadialMenu button visible in sidebar header
- [ ] Clicking `+` opens arc: Board page / Doc page / Canvas page / Folder
- [ ] Creating a page adds a new tab to the panel
- [ ] "Open" section appears below folder tree, lists current tabs
- [ ] Clicking a page in "Open" switches to that page
- [ ] Expanding a page node shows container anchor chips
- [ ] Clicking a chip opens the page and scrolls to that container

**Padding / spacing**
- [ ] ~5px visible gap above first container in board pages
- [ ] Non-doc pages: ~12px breathing room below tab strip
- [ ] Doc pages: ~10px breathing room below tab strip
- [ ] Handles not clipped by sibling containers (z-index: 10)

## Recent Changes (Mar 26 2026 — Page Drag Handle + Panel Page Sidebar)
- **ModulePage.jsx**: Page shell now has `data-page-occ-id={occurrence.id}` for scroll targeting. When `showHeader=false`, renders an absolute `.page-cog-handle` div (always-visible drag handle) with RadialMenu toggle. Mirrors the container-cog-handle pattern.
- **ModulePanel.jsx**: Added `PanelPageSidebar` component — collapsible sidebar (20px→150px) for page-based panels. Shows page names with kind glyphs. Clicking scrolls to the page via `data-page-occ-id`. Added `ChevronLeft/ChevronRight` imports and `pageSidebarCollapsed` state. The `hasPages` branch now wraps content in a flex row with `PanelPageSidebar` + existing scroll area.
- **index.css**: Added `.page-cog-handle` rules (position absolute, opacity reveal on `.page-shell:hover`, radial menu show pattern) — mirrors `.container-cog-handle`.

## Recent Changes (Mar 26 2026 — Rename Refactor)
- **ArtifactContent.jsx** (NEW): Implementation extracted from Artifact.jsx. Artifact.jsx is now a re-export stub.
- **PreviewContent.jsx** (NEW): Implementation extracted from PreviewCard.jsx. PreviewCard.jsx is now a re-export stub.
- **ModulePanel.jsx** (NEW): Implementation extracted from Panel.jsx. Panel.jsx is now a re-export stub.
- **ModulePage.jsx** (NEW): Implementation extracted from Page.jsx. Page.jsx is now a re-export stub.
- **ModuleRouter.jsx** (NEW): Merged Module.jsx + View.jsx into single router. Module.jsx and View.jsx are now re-export stubs.
- **ModuleContainer.jsx** (NEW): Implementation extracted from Container.jsx. Container.jsx is now a re-export stub.
- **DocContent.jsx** (NEW): DocEditorShell extracted from containerHelpers.jsx. Exports `DocContent` (default) + `DocEditorShell` (alias).
- **PoolContent.jsx** (NEW): PoolPill extracted from containerHelpers.jsx. Exports `PoolContent` (default) + `PoolPill` (alias).
- **CanvasContent.jsx** (NEW): CanvasDrawSection extracted from containerHelpers.jsx. Exports `CanvasContent` (default) + `CanvasDrawSection` (alias).
- **containerHelpers.jsx**: Now a re-export stub for DocContent/PoolContent/CanvasContent. CanvasCard still lives here (pending ModuleInstance canvas absorption).
- **ModuleInstance.jsx**: Merged with Instance.jsx — now contains both InstanceInner (inner row) and ModuleInstance (drag wrapper). Exports `MemoInstanceInner` as named export.
- **Instance.jsx**: Now a re-export stub for `MemoInstanceInner` (the inner row component).

**All old filenames still work via re-export stubs — no import sites need updating.**

## Recent Changes (Mar 26 2026 — Page Bug Fixes)
- **Page.jsx**: (1) Added `kind === "canvas"` handler — renders `<Container module={pageModule} occurrenceOverride={occurrence}>` so the page itself IS the canvas container. (2) Board rendering now passes `occurrenceOverride={containerOcc}` to each `<Container>` — fixes wrong occurrence lookup when same module appears in multiple pages. (3) Removed dead imports: `CanvasDrawSection`, `getContainerItems`, `instancesById`.
- **server/socketHandlers/crud.js `create_page`**: Fixed broadcast order — emits `module_created`/`view_created`/`occurrence_created` BEFORE `occurrence_updated` for the panel, so second-window clients have the new occurrence in their store before the panel reference arrives.
- **server/utils/createDefaultUserData.js**: Canvas sample data expanded — "Ideas Board" (8 cards), "Task Map" (9 cards), new "Mind Map" page (9 cards). Cards have varied positions across 3 rows.

## Recent Changes (Mar 26 2026 — Page Module Integration)
- **Page.jsx** (NEW): Page is a navigable content unit inside a panel. Shell has drag handle + radial menu + page name (like docs). Routes content by `kind`: board (sortable containers), canvas (free-form via Container), doc (TipTap via Artifact), display (artifact viewer). Supports inline label editing, context menu, QuickAddMenu for board pages.
- **View.jsx**: Added `Page` import. Added `role === "page"` routing — renders `<Page>` component for page occurrences.
- **Panel.jsx**: Added `Page` import. Panel now detects whether children are pages or containers (legacy). `hasPages`/`pagesList`/`containersList` computed from panel child occurrences. When `hasPages=true`, renders page list instead of container list. Panel header dynamically shows active page label (`pagesList[0]?.page?.label`), falls back to `layout.name`. QuickAdd: when `hasPages`, creates pages (`targetRole="page"`) with `parentId=globalFolderId`; legacy panels create containers. `globalFolderId` resolved from `grid.manifestId → manifest → rootFolder → folderType "global"`. Legacy container panels unchanged.

## Recent Changes (Mar 26 2026 — Canvas Cards Refactor)
- **containerHelpers.jsx**: `CanvasCard` now accepts `children` prop instead of custom label+chip rendering. Props renamed: `instance` → `module` (supports both instances and containers). DnD drag-out uses `DragType.CONTAINER` for containers, `DragType.INSTANCE` for everything else. `onPointerDown` now guards interactive elements (`input, button, textarea, [contenteditable], .radial-handle`). Card is a pure positioning/DnD wrapper — content comes from children.
- **containerHelpers.jsx**: Added `import Instance from "./Instance.jsx"` — no circular dep (Instance.jsx doesn't import containerHelpers).
- **containerHelpers.jsx**: `CanvasDrawSection` now accepts `renderCard` prop. Card rendering moved to caller (Container.jsx). Map iterates `{ module, occurrence }` (was `{ instance, occurrence }`).
- **Container.jsx**: Added `modulesById` to GridActionsContext destructuring. Added `canvasItemsWithOccurrences` useMemo — uses `modulesById` (not just `instancesById`) so both instances AND container modules can be placed on canvas. Added `renderCanvasCard` useCallback — renders `<CanvasCard>` with `<Instance>` (for instances) or `<Container embedded>` (for containers) as children. Updated CanvasDrawSection call to use `canvasItemsWithOccurrences` and `renderCard={renderCanvasCard}`.

## Recent Changes (Mar 26 2026 — Canvas Drag Fix)
- **containerHelpers.jsx**: `CanvasCard` — changed `draggable()` type from `"module"` to `DragType.INSTANCE`. Added `containerId` + `panelId` props and includes `context: { containerId, panelId, instanceId, occurrenceId }`. Drag-out now goes through INSTANCE handler (MOVE), not MODULE handler (COPY). Grip handle gets `pointerEvents: "auto"` to stay interactive in draw mode. Added `data-dnd-handle="true"` attr.
- **containerHelpers.jsx**: `CanvasDrawSection` — moved `onPointerDown/Move/Up` from `<canvas>` element to parent div (with `listDropRef`). Canvas element is now always `pointer-events: none` — drag-and-drop events reach the drop zone div in all draw modes. Drawing capture uses `e.currentTarget.setPointerCapture` on the div. Draw handler guards against grip handle clicks via `e.target.closest("[data-dnd-handle]")`. Added `panelId` prop, threads it to each CanvasCard.
- **Container.jsx**: Passes `containerId={module.id}` + `panelId={panelId}` to `CanvasDrawSection`.
- **Panel.jsx**: `CanvasTreePanelContent` passes `panelId={panelId}` to `CanvasDrawSection`.

## Recent Changes (Mar 25 2026 — Batch 3 Fixes)
- **Panel.jsx**: TreePanelContent: added mount-only `useEffect` that resets `activeOccurrenceId` to `resolvedView.defaultOccurrenceId` when configured (Bug 3 — daypage default page).
- **ManifestTree.jsx**: (1) Added `handleSetDefault` callback — right-click doc row sets `view.defaultOccurrenceId`. (2) Pin icon (📌) shown next to default page doc. (3) `onSetDefault` + `defaultOccurrenceId` threaded through FolderNode → DocNode. (4) Unified collapsed/expanded into single wrapper div with `transition: "width 0.2s ease-out"` — smooth slide animation. (5) Collapsed strip: vertically centered thumb bar (4×40px) + ChevronRight, `cursor: e-resize`. (6) `handleThumbTouchStart` — touch drag right (>50px) opens sidebar, drag left closes. (7) Expanded state: invisible drag-edge div on right border for touch-to-collapse.

## Recent Changes (Mar 23 2026 — 4 Bug Fixes)
- **Container.jsx**: Added `data-occ-id={containerOccurrence?.id}` to outer shell div (needed for IntersectionObserver scroll tracking). Moved containerFields (Q/A question select) from inline with label (Row 2) to its own row below (Row 3) — prevents mobile layout crush where field `flexShrink:0` squeezes label to vertical text.
- **View.jsx**: Both Artifact branches now pass `view={resolvedView}` explicitly (was relying on `...props` which didn't have it). Required for scroll auto-sync.
- **Artifact.jsx**: Added IntersectionObserver for auto-sync of `activeOccurrenceId` on scroll. Watches `[data-occ-id]` elements in `.artifact-markdown` scroll container. 200ms debounce, local-only updateView (emit:false). `suppressAutoSyncRef` prevents observer from fighting programmatic scrolls (scrollAnchor).

## Recent Changes (Mar 22 2026 — Notebook Continuous Scroll Fix)
- **Container.jsx**: `.container-doc` div now uses `overflow: "visible"` when `embedded=true` (was `overflow: "auto"`). Embedded doc containers no longer capture scroll independently — the parent `.artifact-markdown` div is the single scroll context. Fixes notebook continuous scroll between embedded sections.

## Architecture

The new system links views to occurrences (`occurrence.viewId → View`) instead of modules (`module.viewId → View`).

## File Map

| File | Purpose |
|------|---------|
| `ModuleRouter.jsx` | **PRIMARY ENTRY POINT** — merged Module.jsx + View.jsx. Routes occurrence by role to the correct renderer. |
| `Module.jsx` | Re-export stub → ModuleRouter.jsx |
| `View.jsx` | Re-export stub → ModuleRouter.jsx |
| `ModulePanel.jsx` | Panel shell renderer. Uses `occurrence.viewId || module.viewId` for view lookup. |
| `Panel.jsx` | Re-export stub → ModulePanel.jsx |
| `ModulePage.jsx` | Page router — routes by `kind` to `pages/Page*.jsx` subtypes. |
| `Page.jsx` | Re-export stub → ModulePage.jsx |
| `pages/PageBoard.jsx` | Board page subtype — sortable container list with drop zone. |
| `pages/PageDoc.jsx` | Doc page subtype — scroll wrapper + DocEditorShell. |
| `pages/PageCanvas.jsx` | Canvas page subtype — delegates to Container with occurrenceOverride. |
| `pages/PageDisplay.jsx` | Display page subtype — Artifact viewer. |
| `pages/PageFolder.jsx` | Folder page subtype — PreviewNode grid + drilldown animation + peer nav. |
| `ModuleContainer.jsx` | Container orchestrator — state, hooks, full render tree. |
| `Container.jsx` | Re-export stub → ModuleContainer.jsx |
| `containers/ContainerPool.jsx` | Pool container subtype — search/add UI with own state. |
| `containers/ContainerDoc.jsx` | Re-export alias → DocEditorShell from DocContent.jsx. |
| `containers/ContainerCanvas.jsx` | Re-export alias → CanvasDrawSection from CanvasContent.jsx. |
| `ModuleInstance.jsx` | Merged instance: InstanceInner (inner row) + ModuleInstance (drag wrapper). |
| `Instance.jsx` | Re-export stub → MemoInstanceInner from ModuleInstance.jsx |
| `ArtifactContent.jsx` | File content renderer. viewType="markdown"→TipTap, viewType="artifact"→file viewer. |
| `Artifact.jsx` | Re-export stub → ArtifactContent.jsx |
| `PreviewContent.jsx` | Preview view renderer. viewType="preview" → thumbnail card + "View Full" button. |
| `PreviewCard.jsx` | Re-export stub → PreviewContent.jsx |
| `DocContent.jsx` | DocEditorShell — TipTap editor wrapper with lock toggle. |
| `PoolContent.jsx` | PoolPill — draggable pool library item. |
| `CanvasContent.jsx` | CanvasDrawSection — draw toolbar + HTML5 canvas overlay + floating cards. |
| `containerHelpers.jsx` | Re-export stub for DocContent/PoolContent/CanvasContent + CanvasCard (not yet extracted). |
| `containerPopups.jsx` | **FilterOverridePopup** + **TemplatePickerPopup** portal popups used by ModuleContainer. |
| `ManifestTree.jsx` | Manifest/folder tree sidebar for artifact panels. |

## Key Differences from Legacy Module.jsx

- **Panel.jsx**: `resolvedViewId = panelOccurrence?.viewId || module.viewId` — checks occurrence first
- **View.jsx**: `resolvedView = viewsById[occurrence.viewId]` — occurrence is the source of truth
- **Container.jsx**: `isDocContainer` derived from `containerOccurrence?.viewId` (new) falling back to `module.kind === "doc"` (legacy)
- **ManifestTree**: placeholder in View.jsx — renders sidebar when `resolvedView.hasTree && resolvedView.manifestId`

## ModuleEmbed Extension (Mar 2026)
- `client/src/docs/ModuleEmbedExtension.js` — TipTap block node `{ name: "moduleEmbed", group: "block", atom: true }`. Attrs: `occurrenceId`. Renders `<Container embedded>` via ReactNodeViewRenderer(ModuleEmbedNode).
- `client/src/docs/ModuleEmbedNode.jsx` — NodeViewWrapper reads `occurrencesById[occurrenceId]` + `modulesById[occ.targetId]` from GridActionsContext, renders Container.
- `Editor.jsx` extensions now include `ModuleEmbed`.
- `Artifact.jsx`: removed `childOccs.map(<Container>)` — containers are now moduleEmbed TipTap nodes. Filename badge fixed (outer div `overflow:hidden`, inner div `overflowY:auto`).
- `Container.jsx` `DocEditorShell`: adds `is-editing` CSS class to `.doc-container` div. Passes `stickyToolbar={!hideToolbar}` to Editor.
- `Editor.jsx` new prop: `stickyToolbar` — wraps DocToolbar in `.doc-toolbar-sticky` div when true.
- `Instance.jsx`: label `flexShrink:0`, fields container `flex:1` — no wrapping around label.
- `ManifestTree.jsx`: anchor child block `paddingBottom: 6`.

## Recent Changes (Mar 20 2026 — Doc/Tree/Drag UI Overhaul)
- **View.jsx**: Sidebar now defaults to collapsed. Changed from flex push layout to absolute overlay — sidebar sits on top of doc content instead of pushing it right. Added `sidebarCollapsed` state (default `true`) + `toggleSidebar` callback. ManifestTree receives `collapsed` + `onToggleCollapse` props.
- **ManifestTree.jsx**: Reduced indentation from `depth * 8` to `depth * 4`. Anchor chip `maxWidth: 100px` (was `"100%"`). Collapsed strip gets `pointerEvents: "auto"` for overlay mode.

## Recent Changes (Mar 20 2026 — Module Lifecycle: Remove vs Trash)
- **Panel.jsx**: "Delete panel" → "Remove from grid". `handleRemovePanel` calls `CommitHelpers.removeOccurrence` (deletes occurrence, keeps module). LayoutForm receives `onDeletePanel={handleRemovePanel}`. Context menu uses same handler.
- **Container.jsx**: "Delete container" → "Remove from grid". `removeMe` replaces `deleteMe` — calls `removeOccurrence` with parent panel occurrence lookup. ContainerForm gets `onDeleteContainer={removeMe}`. Passes `containerOccurrence` to ModuleInstance.
- **ModuleInstance.jsx**: "Delete occurrence" → "Remove from container". Now calls `removeOccurrence` with `containerOccurrence` for parent cleanup. Added `containerOccurrence` prop.

## Recent Changes (Mar 20 2026 — Stack Cycler + Delete Fix)
- **Panel.jsx**: Stack cycler button moved from inside panel header to below header (flush right). Renders only when `stack.length > 1`. Uses `dragCtx.getStackForPanel(module)` + `dragCtx.cyclePanelStack`. Styled with `borderRadius: "0 0 4px 4px"`, no top border (seamless with header).

## Recent Changes (Mar 20 2026 — Post-Review Cleanup)
- **containerHelpers.jsx**: Wrapped `DocEditorShell`, `PoolPill`, `CanvasCard` in `React.memo`. These render inside Container (already consolidated via useReducer) — memo prevents re-renders when only Container's UI state changes.
- **Container.jsx**: Moved constant array `["top","bottom","left","right"]` from `useMemo(()=>[...], [])` to module-level `ALL_EDGES` const. Eliminates unnecessary memo overhead.

## Recent Changes (Mar 20 2026 — Phase C4+C5 Context Split + Reducer)
- **Container.jsx**: C5 — 13 `useState` hooks consolidated into single `useReducer`. Setter wrappers (useCallback) preserve API — 44 call sites unchanged. Paired updates batch through reducer.
- **Instance.jsx**: C4 — `computedValues` now from `GridLiveContext` (not GridActionsContext).
- **FieldRenderer.jsx**: C4 — same migration.

## Recent Changes (Mar 20 2026 — Phase C3 linkedGroupIndex)
- **Instance.jsx**: Replaced O(n) `Object.values(occurrencesById).filter()` scan with O(1) `linkedGroupIndex[linkedGroupId]` lookup. Destructures `linkedGroupIndex` from GridActionsContext.

## Recent Changes (Mar 19 2026 — Phase C1+C2 React.memo)
- **ModuleInstance.jsx**: `export default React.memo(ModuleInstance)` — prevents sibling re-renders when parent Container state changes.
- **Panel.jsx**: Changed from `export default function Panel(...)` to `function Panel(...) + export default React.memo(Panel)` — prevents sibling re-renders when parent Grid state changes.

## Recent Changes (Mar 19 2026 — Drag Handle + UI Fixes)
- **Panel.jsx, Container.jsx, Instance.jsx**: Replaced `.module-handle` + `.module-dot` with `.module-drag-handle` + `.drag-handle-stem` + `.drag-handle-ball` (knob-on-stem visual). All `RadialMenu` instances get `forceDirection="down"`. Cog handle also uses drag-handle visual (stem+ball visible, radial on hover).
- **Panel.jsx**: `forceDirection` changed from `"right"` to `"down"`.

## Recent Changes (Mar 18 2026 — Mobile Fixes)
- **Panel.jsx**: Removed panel cog handle entirely (`.panel-cog-handle` block deleted). Right-click context menu now includes "Show/Hide header" for the same functionality. `onContextMenu` added to panel shell div. ResizeHandle moved from absolute overlay to inline flex bottom bar.

## Recent Changes (Mar 17 2026 — Instance Row CSS Fix)
- **Instance.jsx**: Changed root div class from `dnd-instance` to `instance-row` to deconflict from the legacy inline chip `.dnd-instance` rule (which was applying `display: inline-flex` + `background: #4372ac` to all instance rows).
- **index.css**: Updated selectors `.instance-wrap > .dnd-instance` → `.instance-wrap > .instance-row` + `.dragging .instance-wrap:hover > .dnd-instance` → same. Added `display: block` to `.instance-wrap > .instance-row`. Raised card background opacity from `0.35` to `0.55` so `.instance-pocket` inset shadow doesn't bleed through. Added `instance-row` to the `.hidden` rule and the mobile responsive rule.

## Status (Mar 2026 — Latest Session)

### Changes Applied
- **Container.jsx**: `onInstanceFocus={null}` — drill-down disabled. Embedded header Row 2 padding changed from `"1px 8px 3px 8px"` to `"0px 8px 3px 12px"` (aligns `#` hash with editor body text, removes extra top space).
- **Instance.jsx**: Radial menu handle moved INSIDE the right-side flex div (grouped with label). No longer floats outside as a sibling. `alignSelf: "flex-start"` + `flexShrink: 0`.
- **createDefaultUserData.js**: (1) Documents folder sortOrder → 0, Day Pages → 1. (2) Notes+Phil parent docs consolidated into ONE "Philosopher's Stone" (philParentOccId) — removed notesParentModId/notesParentOccId. (3) morenotes sections now under philParentOccId. (4) phil section sortOrder = notesSectionOccIds.length + i. (5) Added `splitIntoBlocks`+`createBlockInstances` helpers — sections without H2 instances get paragraph-block docInstances. (6) Added root .md files to Notes folder: uses.md, PRAGMATIC.md, aispecs.md, banglespecs.md (sortOrders 1-4). (7) Journal Q&A container body changed from instancePill to direct fieldPill for answer field.

## Status (Mar 2026 — Session 3 Changes)

### Changes Applied
- **ManifestTree.jsx**: Added Pragmatic DnD drag-and-drop. DocNode file rows are draggable (`type: "artifact"`, payload: `{ occurrenceId, parentId }`). FolderNode is a drop target — on drop calls `CommitHelpers.updateOccurrence({ parentId: folder.id, sortOrder: maxOrder+1 })`. Folder header highlights teal (`isDragOver` state) when dragged over. Added `useRef`, `useEffect`, `draggable`, `dropTargetForElements` imports.
- **ManifestTree.jsx**: Anchor chip brightness increased: bg alpha 0.08→0.14, border alpha 0.25→0.42, text alpha 0.75→0.92 (inactive). Fallback colors also brightened.
- **Instance.jsx**: Radial handle (Popover) and label div wrapped in shared `<div flex row>` so they're visually grouped. Fixed radial menu going outside box bounds.
- **createDefaultUserData.js**: Removed `splitIntoBlocks` + `createBlockInstances` helpers. Sections WITH actual H2 instances → instancePill block nodes. Sections WITHOUT → plain markdown via `makeDocContent(entry.extraLines)` directly in textmap. This eliminates empty block instances in the notebook.

## Status (Mar 11 2026 — Session 4 Changes)

### Container.jsx + Panel.jsx — Hideable Header + Cog Handle
- **Container.jsx**: Added `showHeader` state (default `true`). When `false`: header div not rendered, absolute-positioned `.container-cog-handle` div appears (with `ref={containerHandleRef}` — drag still works). Cog has "Show Header" item in RadialMenu. When `true`: header shows "Hide Header" item in RadialMenu.
- **Panel.jsx**: Same pattern. `.panel-cog-handle` class. `dragRef` moved to outer `panel-shell` div (was on header div — was broken when header hidden). `headerDropRef` still on header.
- **RadialMenu.jsx**: Added `Eye`/`EyeOff` imports. Added `onToggleHeader`/`showHeader` props. Adds "Hide Header"/"Show Header" item to default items list when `onToggleHeader` is provided.
- **index.css**: Added `.container-cog-handle`/`.panel-cog-handle` CSS — absolute top-left, opacity 0, reveals on shell hover. Added `.container-cog-handle .radial-menu` show rules. Added ProseMirror `pre`/`code` codeblock styles.

### ManifestTree.jsx — Folder Indent + Anchor Ellipsis
- **Folder children indent**: Changed `depth={depth}` → `depth={depth + 1}` for artifact docs inside FolderNode. Now child docs are 12px more indented than folder label.
- **Anchor overflow**: Added `overflow: "hidden"` to anchor chip outer div and chip inner div. Long labels now truncate with `...`.

## Status (Mar 11 2026 — Session 5 Changes)

### Instance.jsx — Hideable Label
- **Instance.jsx**: Added `showLabel` state (default `true`). `{showLabel && hasLabel && <label>}` and `{showLabel && hasFields && <fields>}`. RadialMenu gets `onToggleHeader`/`showHeader` for non-linked occurrences (adds Eye/EyeOff item to default items). Linked occurrences include toggleLabelItem in custom radialItems array.

### Toolbar.jsx — Hideable Toolbar
- **Toolbar.jsx**: Added `toolbarVisible` state. Added "Hide Toolbar" to `cogRadialItems`. When `!toolbarVisible`: renders fixed-position small RadialMenu cog at top-left with single "Show Toolbar" item.

### index.css — Hash Spacing Collapse
- **index.css**: `.embedded-container-header .embedded-hash` now uses `max-width: 0; overflow: hidden; display: inline-block` (was just opacity 0). Transitions to `max-width: 14px` on hover so the space collapses when hidden.

### ManifestTree.jsx — Anchor Tree + Toggle Arrow
- **ManifestTree.jsx**: Anchor chips now have a ▾/▸ toggle arrow (separate from chip click). Clicking arrow toggles `open` state; clicking chip navigates. Child anchor chips use `parentOccId={occ.id}` (was `parentOccId={parentOccId}`) so child chips navigate to their parent container, not the root doc.

### createDefaultUserData.js — Q&A Fix + Anchor Instance parentId
- **createDefaultUserData.js**: Journal Q&A `containerDocContent` now shows BOTH questionFieldKey fieldPill (display, "Q: ") AND answerFieldKey fieldPill (input, "A: ") in the container body.
- **createDefaultUserData.js**: Instance occurrences inside doc containers (morenotes, phil sections) now have `parentId: contOccId` and `sortOrder: j` — so they appear as child anchor chips under their container anchor chip in ManifestTree.

### tests/e2e/dnd.spec.js — DnD Tests
- **tests/e2e/dnd.spec.js**: NEW file. Tests: handle visibility (panel/container/instance dots), instance intra-container drag, cross-container instance drag, container intra-panel drag, panel drag smoke test, hideable header smoke test, toolbar visibility.

## Status (Mar 2026 — C1-C3 Canvas + U2 File Preview + Pool Fix)

### Changes Applied
- **Container.jsx**: Added `isCanvasContainer = module.kind === "canvas"`. Added `CanvasCard` component (pointer-event drag, saves `occurrence.meta.x/y` on `pointerUp` via `updateOccurrence`). Canvas rendering branch: dot-grid background, double-click creates card at cursor position. Fixed canvas double-click to use `initialMeta: {x,y}`.
- **Instance.jsx**: Added inline file preview — when `instance.fileRef` exists, renders `<img>`/`<video>`/`🎵` (36px height) before the fields area.
- **server/socketHandlers/crud.js**: Added `create_instance_in_container` handler — creates Module + Occurrence, appends to container's `occurrences[]`, broadcasts `module_created`/`occurrence_created`/`occurrence_updated`. Also accepts optional `occurrenceId` + `meta` for canvas positioning. Fixes pool persistence bug (pool items added via UI were previously not persisted to DB).
- **client/src/helpers/CommitHelpers.js**: `createInstanceInContainer` now accepts `occurrenceId` + `initialMeta` params, passes them to socket event.

## Status (Mar 2026 — MP1 Embedded Module Resize + Alignment)

### Changes Applied
- **docs/ModuleEmbedExtension.js**: Added `align` (full/left/center/right, default "full") + `width` (nullable number) attrs to `moduleEmbed` node.
- **docs/ModuleEmbedNode.jsx**: Rewrote to show alignment toolbar (4 buttons: ◧/⊡/◨/⊞) when node is selected. Right-edge drag handle for resize (hidden for full-width). `alignStyle()` helper computes float/margin/width CSS. Positions persist to TipTap node attrs.

## Status (Mar 15 2026 — SL3 timeScale-aware target scaling)
- **Instance.jsx**: `fieldContext.currentIteration` now derived from `grid.activeFilterId → namedFilters.find(id).timeScale`. Was reading dead `grid.iterations[]` (always empty). Now correctly returns "daily"/"weekly"/"monthly" from the active named filter. `Field.jsx` already calls `scaleTarget(target, currentTimeFilter)` — so switching to Weekly filter auto-multiplies targets ×7.

## Status (Mar 14 2026 — R7 Module Disable)
- **modules/Instance.jsx**: Passes `disabled={!!instance?.meta?.disabled}` to FieldRenderer. When `instance.meta.disabled = true`, all fields render as display-only (no inputs).

## Status (Mar 14 2026 — Pool Container SL1)

### Changes Applied
- **Module.js (server)**: Added `"pool"` to kind enum — draggable pill library containers.
- **Container.jsx**: Added `isPoolContainer = module.kind === "pool"` detection. Added `PoolPill` component (draggable via `@atlaskit/pragmatic-drag-and-drop/element/adapter`, payload `{ type: "module", sourceType: "pool", role: "instance", id, data, occurrenceId }`). Added pool rendering branch: search bar + [+ Add] inline input + wrapped flex grid of PoolPill components. State: `poolSearch`, `poolAddLabel`, `isPoolAdding`. `handlePoolAdd` creates new instance via `CommitHelpers.createInstanceInContainer`. Delete on hover via PoolPill delete button.
- **index.css**: Added `.pool-pill:hover .pool-pill-delete { display: flex !important }` rule.
- **DragProvider.jsx**: Pool source handling — added `|| payload?.sourceType === "pool"` to the command-center module handler. Pool drags always copy (same path as CC instance drag).
- **operationActions.js**: Added `ADD_TO_POOL` (emits `{ _effect: "ADD_TO_POOL", poolContainerId, label }`) and `REMOVE_FROM_POOL` (emits `{ _effect: "REMOVE_FROM_POOL", occurrenceId }`) action cases.
- **bindSocketToStore.js**: Added `ADD_TO_POOL` effect handler (calls `createInstanceInContainer`) and `REMOVE_FROM_POOL` handler (calls `deleteOccurrence`). Added `createInstanceInContainer` to imports.
- **createDefaultUserData.js**: Added `movieRating` (rating, 1-5) + `lastWatched` (date) fields. Added `moviePoolInstances` (The Matrix, Parasite, EEAO, Arrival, Dune). Added `moviePool` (`kind: "pool"`) to toolkitContainers. Wires movies into pool in STEP 5. Movie instances use `defaultDragMode: "copy"`, included in `isToolkitInstance` check.

## Status (Mar 12 2026 — Tree DnD to Panel + S6)

### Changes Applied (Mar 12 — late session)
- **DragProvider.jsx**: Added `type: "artifact"` drop handler. Dragging artifact DocNode from ManifestTree onto a panel content area (no container) → calls `updateView({ activeOccurrenceId })` to switch the active document in that panel.
- **ExprPillExtension.js + pills/ExprPillNode.jsx** (NEW in docs/): S6 expression pills. Inline formula nodes in TipTap. `=` key trigger → field picker popup → inserts `exprPill` with formula. Node view evaluates `fieldName` expressions against computedValues + simple arithmetic.

## Status (Mar 13 2026 — Filter Visibility Extended to Panels + Day Pages)

### Panel.jsx — Container Occurrence Filtering
- **Panel.jsx**: Imported `resolveEffectiveFilters` + `isOccurrenceVisible` from `../state/selectors`.
- **Panel.jsx**: `panelEffectiveFilters` = `resolveEffectiveFilters(panelOccurrence, state.grid.activeFilterValues)`. `containersList` filters each container by looking up its occurrence ID from `panelOccurrence.occurrences` and calling `isOccurrenceVisible(containerOcc, panelEffectiveFilters)`. Containers without an occurrence (shouldn't happen but defensive) are treated as visible.
- **Effect**: Day page container occurrences with `scheduledDate` set only show on the matching day. Schedule slot containers (no `scheduledDate`) are always visible (persistent).

### dayPages.js — scheduledDate on New Day Page Occurrences
- **dayPages.js**: Added `findScheduledDateFieldId(uc, gridId)` helper — scans `uc.fieldsById` for `name === "Scheduled Date"`. Added `makeScheduledDateFields(fieldId, dateISO)` — builds `{ [fieldId]: { value: dateISO, flow: "in" } }`.
- **create_day_page_occurrence**: Sets `fields: { ...makeScheduledDateFields(...), ...(fields || {}) }` so new day page occurrences get `scheduledDate` matching their `meta.date`.
- **navigate_day_page**: New day page occurrences get `fields: makeScheduledDateFields(scheduledDateFieldId, dateISO)`. Existing occurrences already have it from creation.

## Status (Mar 13 2026 — Filter Visibility)

### Container.jsx — Occurrence Visibility Filtering
- **Container.jsx**: Imported `resolveEffectiveFilters` + `isOccurrenceVisible` from `../state/selectors`.
- **Container.jsx**: `allItemsWithOccurrences` = full list from `getContainerItemsWithOccurrences`. `effectiveFilters` = `resolveEffectiveFilters(containerOccurrence, ctxState?.grid?.activeFilterValues || {})`. `itemsWithOccurrences` = filtered by `isOccurrenceVisible`. Hidden occurrences (`occurrence.hidden = true`) and filter-mismatched occurrences are skipped. Occurrences with no field value pass (persistent behavior).

## Status (Mar 12 2026 — Latest)

### Changes Applied (Mar 12)
- **Artifact.jsx**: Added `viewType === "code"` → `CodeViewer` component (fetches `/uploads/{fileRef}`, renders `<pre><code>` with lang indicator). Added `viewType === "grid"` → `GridViewer` component (interactive spreadsheet, data stored as `{ type: "grid", cols, rows }` in occurrence.textmap, saves via debounced `updateOccurrence`).
- **server/server.js**: `mimeToViewType(mime, filename)` — now detects code files by extension (.js/.ts/.py/.sh/.json/etc.) and returns `{ viewType: "code" }`.
- **server/models/View.js**: Added `"code"` and `"grid"` to `viewType` enum.
- **createDefaultUserData.js**: Added "Sample Grid" module (viewType: "grid") in Notes folder with 8-column habit tracker example.
- **index.css**: Bug 16 fix — hover cog cascade. All `.panel-shell:hover`, `.container-shell:hover`, `.panel-header:hover`, `.container-header:hover` selectors now use `:not(:has(...))` to prevent showing cog on ancestor shells when a nested child is hovered.

## Status (Mar 11 2026)

### Fixes Applied (current session)
- **Container.jsx** embedded header: restructured to two-row layout: Row 1 = [RadialMenu dot][Link icon], Row 2 = [# Label]. Both embedded and non-embedded use conditional rendering.
- **Container.jsx** `lightenHex(hex, 0.7)` helper added — computes bright text color for embedded labels by blending 70% toward white
- **Container.jsx** `embeddedAccent` = `lightenHex(rawColor, 0.7)` (bright readable text) vs card/header bg which use `hexToRgba(rawColor, 0.18/0.42)`
- **Container.jsx** embedded card: background alpha 0.18, border 0.5, header bg 0.42, header border 0.55 (was 0.1/0.3/0.28/0.35)
- **Container.jsx** LocalIterationNav: `collapsible={embedded}` prop — shows only Link2 icon when collapsed, full nav in popover
- **Artifact.jsx** outer wrapper: applies `docAccentBg` (hexToRgba(module.ownStyle.bg, 0.10)) as background tint
- **LocalIterationNav.jsx**: added `collapsible` prop + `collapsibleOpen` state — when collapsible=true renders Link2 icon as Popover trigger with full nav inside
- **Editor.jsx**: removed `overflow-auto` from `doc-editor-wrapper` — outer containers handle scrolling, fixing sticky toolbar
- **createDefaultUserData.js**: brighter colors for all embedded section containers (green #1ac47a, blue #2a90e8, purple #9b4de0, gold #d4a010, etc.)

## Status (Mar 11 2026)

- All files build cleanly
- Embedded doc container styling complete (Container.jsx `embedded` prop)
- ManifestTree.jsx: compact file row (fontSize 10, `›` instead of 📄)
- Artifact.jsx: passes `embedded={true}` to child Container cards + shows module.label top-right badge

## Embedded Doc Container Pattern (Mar 11 2026)
- `Container.jsx` accepts `embedded` prop — renders teal `#`-prefix heading instead of standard panel header
- When `embedded=true`: header uses `embeddedCardStyle` (dark tinted bg + border), label is 15px/600 mono with color from `module.ownStyle.bg`, contentEditable for inline editing
- `#` hash prefix: always rendered but opacity 0 by default, shows on hover via `.embedded-container-header:hover .embedded-hash` CSS
- LocalIterationNav hidden when `embedded=true`
- Outer shell style: uses `embeddedCardStyle` (not `resolvedContainerCSS`) when embedded
- `Artifact.jsx` passes `embedded={true}` to all child Container cards in markdown view
- `hexToRgba` helper already at top of Container.jsx — no need to re-declare in ManifestTree

## Data Setup (Mar 11 2026 resetData)
- Stan sections: `ownStyle: { bg: "#0e3d32" }, styleMode: "own"` (dark teal)
- Notes sections: `ownStyle: { bg: "#1a2e40" }, styleMode: "own"` (dark navy)
- Gospel sections: `ownStyle: { bg: "#2a1f3d" }, styleMode: "own"` (dark purple)
- Journal Q&A sections: `ownStyle: { bg: "#2d200e" }, styleMode: "own"` (dark amber)
- Stan/Notes/Gospel body textmaps: NO heading nodes (label IS the heading via embedded header)
- Journal Q&A container textmap: just instancePill (no question fieldPill heading)
- Daily Journal parent doc REMOVED — journal Q&A containers live directly under `dayPageDocOccId`
- Parent docs sortOrder: Stan=0, Notes=1, Gospel=2
- `dayPageDocOccId` pre-declared before notebook wiring loop (used as parentId for journal Q&A)
- `activeOccurrenceId` defaults to `dayPageDocOccId` (day page open by default)
- `makeDocContent` now handles `![alt](url)` → TipTap image nodes

## Recent Changes (Mar 17 2026 — BUGS.md Fixes)

### Artifact.jsx — GridViewer Removed
- Removed `GridViewer` component, `defaultGridData()`, `cellStyle`, `headerCellStyle` constants
- Removed `viewType === "grid"` branch — Sample Grid now uses TipTap table in doc textmap
- Removed `useCallback` and `updateOccurrence` imports (only used by GridViewer)

### Container.jsx — Canvas Fix + Duplicate Cleanup
- Moved `isCanvasContainer` check BEFORE `focusedItem` in rendering ternary chain
- Removed duplicate (unreachable) old canvas block that was after `focusedItem`
- Added `module.kind` fallback for `isDocContainer`, `isPoolContainer`, `isCanvasContainer` — fixes Freepad/canvas panels that have no View record

### ManifestTree.jsx — Collapse Cascade + New Doc Button
- Added `collapseGen` prop to DocNode — children reset to collapsed when parent closes
- `toggleOpen` callback bumps `childCollapseGen` when closing, propagated to child DocNode renders
- Added `handleNewDoc` to FolderNode — creates new "Untitled" artifact module + occurrence in folder
- "+" button appears on folder header hover (CSS: `.folder-add-btn`)

### Panel.jsx + Container.jsx — QuickAddMenu (+) Button
- **Panel.jsx**: `<QuickAddMenu targetRole="container">` in panel header after name. `handleQuickAddContainer` creates occurrence of existing container module in panel. "New container" option calls `addContainerToPanel`.
- **Container.jsx**: `<QuickAddMenu targetRole="instance">` in standard container header after label. `handleQuickAddInstance` creates occurrence of existing instance module in container. "New instance" option calls `onAdd`.
- **QuickAddMenu** (ui/QuickAddMenu.jsx): Dropdown with search, role-colored dots, outside-click close. Filters `modulesById` by `targetRole`. Max 20 results.
- **index.css**: `.panel-header:hover .quick-add-btn` and `.container-header:hover .quick-add-btn` reveal on header hover.

## Recent Changes (2026-07-12 — "Add occurrence" in every right-click menu + body-rendered fields)
- **`ModuleInstance.jsx`** — body-rendered occurrences (textblock/artifact cards) now render
  their bound-field pills as a full-width `.instance-fields--under-body` strip UNDER the body
  (was: renderBody REPLACED the fields row entirely — a tags field bound to a textblock was
  invisible). Unbound cards render nothing extra, so default textblocks/wraps are unchanged.
- **`ModulePage.jsx`** — page right-click menu gains "Add occurrence…" (opens the header
  QuickAddMenu imperatively via a new `pageQuickAddTrigger` + `openTrigger`; reveals the header
  first when hidden, bump deferred 50ms so the fresh mount sees the change).
- **`ModulePanel.jsx`** — panel right-click menu gains "Add page…": a ZERO-SIZE QuickAddMenu
  (targetRole="page") is mounted next to the ContextMenu and opened imperatively (the header
  intentionally lost its + in the 2026-07-03 redesign). Picking an existing page pins it via
  `pinPageToPanel` + activates; create tiles mint a page via `createPage` (ManifestTree shapes).
  All four surfaces (container/page/panel/doc) E2E-verified headless.

## Recent Changes (2026-07-12 — artifact pages + category-folder de-dup + doc-open timing)
- **Artifact full-screen pages (user directive):** clicking an artifact in the MANIFEST TREE
  (`ManifestTree.handleSelect`) or a FOLDER PAGE card (`PageFolder.handleDrillDown`) now opens a
  `role:"page" kind:"display"` ARTIFACT PAGE via the new idempotent
  `helpers/importsFolder.ensureArtifactPageOcc` (meta.artifactPage = artifactOccId; parentId null
  so the viewer shell never shows as a tree row). Previously the click set the page panel's
  `activeOccurrenceId` to a bare artifact occurrence, which resolved to NO page and the panel
  snapped back to page 0 ("can't open image artifacts from the manifest/folder"). Artifact-tree
  panels (hasTree views) keep the inline viewer. `ModulePage` display branch resolves the page's
  artifact child (meta.artifactPage / occurrences[0]) reactively and derives viewType/artifactType
  from the artifact module kind; legacy display pages fall through unchanged. E2E-verified
  headless (tree click → display page with video player active in the panel). 3 tests in
  importsFolder.test.js.
- **Double folders fixed at the data level:** the seed parented all `folderType:"category"`
  folders (field/op groupings — Trackers, Projects, Library…) under the MANIFEST ROOT, so any
  folder listing without an explicit category filter showed them beside the real tree folders of
  the same name. Category folders are NOT tree nodes: seed now writes `parentId: null` (matches
  what FieldsTab/OperationsTab's "+ Category" creates), live DB patched (31 de-parented), and
  `ModulePage.folderChildOccs` gained a defensive `folderType !== "category"` filter.
- **`NodePill.jsx`** — root div stamps `data-node-occ-id` (probe/test targeting).
- **Doc-open timing measured** (user: "slow to open"): seeded docs open in ~290ms even @4x CPU
  throttle headless. The known heavy path is the eager-TipTap mount storm on BIG imported docs —
  that's the standing "editor static-until-focus" docket (client/src/CLAUDE.md), still deferred
  to its own session.

## Recent Changes (2026-08-06 (2) — ContainerGraph: fills its container, zooms, and hosts the wheel)
- **`containers/ContainerGraph.jsx`** — holds the zoom/pan view as LOCAL state and passes it to both
  `buildEChartsOption` and `<EChart>`. **Deliberately unpersisted:** a graph should open showing the
  whole thing, not wherever the last person left it. A reset pill renders only while zoomed (a chart
  at rest carries no chrome, and a zoomed one must never be a state you cannot get out of).
- **`index.css .container-graph`** carries `min-height: min(70vh, 620px)` as well as `flex: 1`.
  `flex` only fills when the parent is a definite-height flex column — a page IS one, a plain board
  container is NOT, and without the floor a graph there collapses to a coaster.
- **`touch-action: pan-y`** on the canvas, not `none`: the chart claims horizontal drags and pinches
  while a vertical swipe still scrolls the page underneath. `none` would make a graph a dead zone
  you cannot scroll past on a phone — the wheel is meant to sit on a day page, not own it.
- **`ModuleContainer` + `ModulePage` mount `<GraphSection>`** beside `<FeedSection>` in their
  HeaderDropdowns (see ui/CLAUDE.md).
