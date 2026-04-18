# client/src/modules/ — New Module Rendering System

_Updated: Apr 12 2026. This folder implements occurrence-based view routing._

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
