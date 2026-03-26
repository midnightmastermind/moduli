# Page Module Integration Plan

## Context

This refactor adds a new `"page"` module role that sits between Panel and content. Currently Panel handles both grid placement AND content type routing (manifest tree, view type, containers). This conflation makes the system harder to extend. The fix: Panel becomes a pure window; Page becomes the navigable content unit.

The other key change is unifying the manifest into a single user manifest with a structured three-section folder tree, making ManifestTree a first-class workspace navigator rather than a sidebar bolt-on.

---

## New Architecture

### Hierarchy (Before → After)

```
BEFORE:
Grid → Panel occurrence (viewId → View) → Container occurrences → Instance occurrences

AFTER:
Grid → Panel occurrence (no viewId) → Page occurrences (viewId → View) → Container/Instance occurrences
```

### Role of Each Entity

| Entity | Role |
|--------|------|
| **Panel** | Pure window. Grid placement only. Holds page occurrence IDs. No viewId. |
| **Page** | New `role: "page"`. Navigable content unit. Has viewId → View. Lives in manifest tree. |
| **View** | Unchanged. Owner shifts from panel occurrence → page occurrence. |
| **Manifest** | One per user (not per panel). Structured three-section folder tree. |

### Page Kinds

| Kind | What it renders |
|------|----------------|
| `board` | Sortable containers + instances (what panels currently render by default) |
| `canvas` | Freeform drawing canvas |
| `doc` | TipTap rich text editor |
| `display` | Artifact viewer (images, PDFs, markdown files, etc.) |

---

## Manifest Tree Structure

One manifest per user. Fixed top-level structure:

```
User Manifest Root
├── Global/          ← folderType: "global" — user-managed, freely organizable
└── Grid/            ← folderType: "grid" — auto-created per grid, organizational only (not interactive)
     ├── [Panel A]/  ← folderType: "panel" — auto-created, CLICKABLE → stacks that panel
     ├── [Panel B]/  ← folderType: "panel" — auto-created, CLICKABLE → stacks that panel
     └── ...
```

**Rules:**
- Grid folder: not clickable, just groups panel folders
- Panel folders: clickable (stacks/opens that panel), auto-created with panel, auto-deleted with panel
- Panel folders cannot be manually renamed or deleted
- Deleting a panel → its folder deleted → pages move to Global automatically
- Pages exist in ONE location at a time (Global or a panel folder)

**ManifestTree sidebar per panel (three sections):**
```
├── Global/          ← same for all panels
├── Grid/            ← all panels' folders
│    ├── Panel A/   ← click → stack Panel A
│    └── Panel B/   ← click → stack Panel B
└── Local/           ← THIS panel's pages (permanent + transient pins)
```

- Clicking a page in Global or Grid → temporarily pins it to Local (visible in this panel until removed or panel closes)
- Clicking a page in Local → makes it the active content in the panel
- **Permanent pages**: `pageOcc.parentId === this panel's folder ID`
- **Transient pins**: `pageOcc.parentId !== this panel's folder`, but `pageOccId` is in `panelOcc.occurrences[]`

---

## Data Model Changes

### server/models/Folder.js
Add new folderType values and panelId field:
```js
folderType: {
  type: String,
  enum: ["normal", "trash", "templates", "day-pages", "category", "global", "grid", "panel"],
  default: "normal",
},
panelId: { type: String, default: null, index: true }, // links panel folder to its panel module
```

### server/models/Manifest.js
Add `"user"` to manifestType enum:
```js
manifestType: {
  type: String,
  enum: ["files", "day-pages", "templates", "user"],
  default: "files",
},
```

### server/models/Grid.js
Add manifestId field:
```js
manifestId: { type: String, default: null },
```

### server/models/Module.js
No schema changes. `role` and `kind` are already untyped strings. Just add `"page"` as a valid role value and `"display"` as a valid kind in comments/conventions.

### server/models/Occurrence.js
No changes. The existing fields handle everything:
- `viewId` — will be set on page occurrences (instead of panel occurrences)
- `occurrences[]` — panel holds page occ IDs; page holds container occ IDs
- `parentId` — page occurrences use this for folder position in manifest
- `sortOrder` — for ordering within manifest folders

### server/models/View.js
No changes. View model is untouched. Only the owner shifts.

---

## New Client State

### client/src/state/masterReducer.js
Update `deriveRoleArrays` to handle `"page"` role:
```js
function deriveRoleArrays(modules = []) {
  const panels = [], containers = [], instances = [], pages = [];
  for (const m of modules) {
    if (m.trashed) continue;
    if (m.role === "panel") panels.push(m);
    else if (m.role === "page") pages.push(m);      // NEW
    else if (m.role === "container") containers.push(m);
    else if (m.role === "instance") instances.push(m);
  }
  return { panels, containers, instances, pages };
}
```
Add `pages: []` to FULL_STATE and LOGOUT cases.

### client/src/state/selectors.js
Update `createLookupsFromState` — traverse panel → page → container → instance:
```js
// After resolving panel occurrence:
for (const pageOccId of panelOcc.occurrences || []) {
  const pageOcc = occurrencesById[pageOccId];
  if (!pageOcc) continue;
  const page = modulesById[pageOcc.targetId];
  if (page?.role === "page") {
    pagesById[page.id] = page;
    for (const containerOccId of pageOcc.occurrences || []) {
      // existing container/instance traversal here
    }
  }
}
```
Update `computeRoleByModuleId` similarly.

### client/src/GridActionsContext.js
Add `pagesById: Object.create(null)` to context defaults.

### client/src/App.jsx
Add `pagesById` to `actionsValue` memo.

---

## Server Socket Handlers

### server/socketHandlers/crud.js — New handlers

**`create_page`**: Creates Module (role: "page") + View + Occurrence + adds occ ID to panel's occurrences[].
Emits: `module_created`, `view_created`, `occurrence_created`, `occurrence_updated` (panel).

**`delete_page`**: Removes page occ ID from panel's occurrences[], deletes occurrence, trashes module.
Emits: `occurrence_updated` (panel), `occurrence_deleted`, `module_updated`.

**`move_page`**: Updates page occurrence's `parentId` + `sortOrder` (manifest tree drag). Optionally removes/adds from panel occurrences[] when moving between panels.
Emits: `occurrence_updated`.

**`pin_page_to_panel`**: Adds page occ ID to panel's occurrences[] without changing `parentId` (transient pin).
Emits: `occurrence_updated` (panel).

**`unpin_page_from_panel`**: Removes page occ ID from panel's occurrences[] (only if transient pin).
Emits: `occurrence_updated` (panel).

### Modify existing panel deletion
When a panel occurrence is deleted: find its folder (by `panelId`), move all pages with `parentId === panelFolderId` to globalFolderId, then delete the panel folder.

### Modify existing panel creation
When `create_module` creates a panel: also create a panel folder in the Grid folder of the manifest.

---

## New Client Helpers

### client/src/helpers/CommitHelpers.js — New functions

```js
createPage({ dispatch, socket, page, occurrence, view, panelOccurrenceId, emit })
deletePage({ dispatch, socket, pageOccurrenceId, panelOccurrence, emit })
movePage({ dispatch, socket, pageOccurrenceId, targetFolderId, sortOrder, emit })
pinPageToPanel({ dispatch, socket, pageOccurrenceId, panelOccurrence, emit })
unpinPageFromPanel({ dispatch, socket, pageOccurrenceId, panelOccurrence, emit })
```

### client/src/helpers/LayoutHelpers.js — New functions

```js
getPanelPages(panel, occurrencesById, pagesById, panelOccurrence)
  // Returns [{page, occurrence}] for all pages in a panel

getPageContainers(pageOccurrence, occurrencesById, containersById)
  // Returns containers inside a page

createPageInPanel({ dispatch, socket, gridId, panel, panelOccurrence, page, view, userId, folderId, emit })
  // Creates page module + view + occurrence, adds to panel

addPageToPanel({ dispatch, socket, panelOccurrence, occurrenceId, index, emit })
removePageFromPanel({ dispatch, socket, panelOccurrence, occurrenceId, emit })
```

**Existing functions to rename** (containers now live in pages not panels):
- `createContainerInPanel` → add `pageOccurrence` parameter (page is the new parent)
- `moveContainerBetweenPanels` → `moveContainerBetweenPages`
- Keep old signatures with deprecation detection for backward compat during migration

---

## Drag System Changes

### client/src/helpers/dragSystem.js

Add `DragType.PAGE = "page"`.

Update DropAccepts:
```js
DropAccepts = {
  GRID_CELL:      [PANEL, MODULE, ARTIFACT],           // unchanged
  PANEL_CONTENT:  [PAGE, MODULE, ARTIFACT],             // was [CONTAINER, INSTANCE, ...]
  PAGE_CONTENT:   [CONTAINER, INSTANCE, MODULE, ARTIFACT, EXTERNAL, FILE, TEXT, URL],  // NEW
  CONTAINER_LIST: [INSTANCE, MODULE, ARTIFACT, EXTERNAL, FILE, TEXT, URL],  // unchanged
  INSTANCE:       [INSTANCE, ARTIFACT, FILE, TEXT, URL], // unchanged
};
```

### client/src/helpers/DragProvider.jsx

- Add `DragType.PAGE` drop handler: page dropped on PANEL_CONTENT → adds page occ to panel's occurrences[], moves page to panel's folder if from different location
- Update container drop handler: containers now drop on PAGE_CONTENT (not PANEL_CONTENT directly)
- Drop context for page content zones includes `pageId` alongside `panelId`

---

## New UI Components

### client/src/modules/Page.jsx (NEW)

Routes to the right content based on page kind:
```jsx
function Page({ occurrence, panelId, dispatch, socket }) {
  const pageModule = modulesById[occurrence.targetId];
  const pageView = viewsById[occurrence.viewId];
  switch (pageModule?.kind) {
    case "board":   return <BoardPage ...>;
    case "canvas":  return <CanvasPage ...>;
    case "doc":     return <DocPage ...>;
    case "display": return <DisplayPage ...>;
    default:        return <BoardPage ...>;
  }
}
```

**BoardPage**: Renders sortable containers + instances. Moves the current Panel.jsx "default container list" branch into here. Drop zone is `PAGE_CONTENT`.

**CanvasPage**: Extracts from `CanvasTreePanelContent` in Panel.jsx. Same CanvasDrawSection + CanvasCards.

**DocPage**: Wraps Artifact.jsx with `viewType: "markdown"`. Has TipTap editor, can embed containers via ModuleEmbed.

**DisplayPage**: Wraps Artifact.jsx with `viewType: "artifact"` and `artifactType` from the View record.

---

## Panel.jsx Refactor

### client/src/modules/Panel.jsx

**Remove:**
- `resolvedViewId` / `resolvedView` / `currentViewType` resolution from panel occurrence
- `TreePanelContent` component (becomes Page-level)
- `CanvasTreePanelContent` component (becomes CanvasPage)
- Direct container list rendering branch
- `handleViewTypeChange` (view belongs to page now)
- `containersList` computation (replaced by `pagesList`)

**Add:**
- `activePageOccId` state (which page is currently shown in the content area)
- `pagesList` computation from `panelOccurrence.occurrences[]`
- `<Page>` rendering for the active page
- `<EmptyPageState>` when no pages exist
- ManifestTree sidebar with three-section layout

**Keep unchanged:**
- Header (label, drag handle, radial menu, QuickAddMenu)
- Grid placement / drop zones
- Panel stack cycling
- Context menu
- Style / layout / custom CSS
- Fullscreen, split panel, copy panel logic

**Legacy detection** (backward compat during migration):
```js
const isLegacyPanel = panelOccurrence?.viewId != null ||
  (panelOccurrence?.occurrences || []).some(occId => {
    const occ = occurrencesById[occId];
    return occ && modulesById[occ.targetId]?.role === "container";
  });
// If legacy: render old container-list branch. If new: render Page branch.
```

---

## ManifestTree.jsx Refactor

### client/src/modules/ManifestTree.jsx

**New props:**
```js
{
  manifestId,        // user manifest ID
  panelId,           // current panel's module ID
  panelOccurrence,   // current panel's occurrence
  localFolderId,     // this panel's folder ID
  globalFolderId,    // the Global folder ID
  gridFolderId,      // the Grid folder ID
  activePageOccId,   // currently active page
  onSelectPage,      // page clicked in Local → make active
  onPinPage,         // page clicked in Global/Grid → pin to Local
  onUnpinPage,       // remove transient pin
  onStackPanel,      // panel folder clicked → stack/open that panel
  collapsed,
  onToggleCollapse,
}
```

**Three-section rendering:**

*Global section*: Standard FolderNode tree rooted at `globalFolderId`. Clicking a page calls `onPinPage` then `onSelectPage`.

*Grid section*: Lists folders with `folderType: "panel"` and `parentId === gridFolderId`. Grid folder header is NOT clickable. Each panel sub-folder IS clickable → `onStackPanel(folder.panelId)`. Pages inside panel folders are visible; clicking pins them to current panel's Local.

*Local section*: Shows pages whose occurrence IDs are in `panelOccurrence.occurrences[]`. Distinguishes permanent vs transient by checking `pageOcc.parentId === localFolderId`. Transient pins show a pin icon + remove button. Clicking calls `onSelectPage`.

**New PageNode component** (replaces DocNode for pages):
```jsx
function PageNode({ pageOcc, isTransientPin, isActive, onSelect, onUnpin }) {
  // Shows kind icon, label, active indicator, unpin button if transient
}
```

---

## createDefaultUserData.js Migration

### server/utils/createDefaultUserData.js

**STEP 0 additions** (after grid creation):
1. Create one `Manifest` (`manifestType: "user"`, `name: "Pages"`)
2. Create root folder (manifest's `rootFolderId`)
3. Create Global folder (`folderType: "global"`, `parentId: rootFolderId`)
4. Create Grid folder (`folderType: "grid"`, `parentId: rootFolderId`)
5. Create panel folder per panel (`folderType: "panel"`, `parentId: gridFolderId`, `panelId`)
6. Set `grid.manifestId = manifest.id`

**For each existing panel:**
- Create ONE `board` page module + occurrence + view
- Page occurrence `occurrences[]` = the container occ IDs that used to be in the panel
- Page occurrence `parentId` = that panel's folder ID
- Panel occurrence `occurrences[]` = `[pageOccId]` (just the one board page)
- Panel occurrence `viewId` = null

**Notebook panel special case:**
- Each notebook doc/section becomes a separate `doc` page occurrence
- Panel occurrence holds all doc page occ IDs
- The existing per-panel manifest content moves into Global folder or panel's panel folder

---

## Implementation Order

### Phase A — Schema & State (no UI changes)
1. `server/models/Folder.js` — add folderType values + panelId field
2. `server/models/Manifest.js` — add "user" to manifestType enum
3. `server/models/Grid.js` — add manifestId field
4. `client/src/state/masterReducer.js` — add pages to deriveRoleArrays
5. `client/src/state/selectors.js` — add pagesById to lookups
6. `client/src/GridActionsContext.js` — add pagesById default
7. `client/src/App.jsx` — add pagesById to actionsValue

### Phase B — Server Handlers
8. `server/socketHandlers/crud.js` — add create_page, delete_page, move_page, pin_page_to_panel, unpin_page_from_panel
9. `server/socketHandlers/crud.js` — modify panel creation/deletion to manage panel folders

### Phase C — Client Helpers
10. `client/src/helpers/CommitHelpers.js` — add createPage, deletePage, movePage, pinPageToPanel, unpinPageFromPanel
11. `client/src/helpers/LayoutHelpers.js` — add getPanelPages, getPageContainers, createPageInPanel, addPageToPanel, removePageFromPanel
12. `client/src/helpers/dragSystem.js` — add DragType.PAGE, update DropAccepts
13. `client/src/helpers/DragProvider.jsx` — add PAGE drag handler, update container drop targets

### Phase D — UI Components
14. `client/src/modules/Page.jsx` — NEW: BoardPage / CanvasPage / DocPage / DisplayPage routing
15. `client/src/modules/ManifestTree.jsx` — three-section layout (Global / Grid / Local)
16. `client/src/modules/Panel.jsx` — refactor to render pages, add legacy detection
17. `client/src/state/bindSocketToStore.js` — wire new page socket events

### Phase E — Sample Data
18. `server/utils/createDefaultUserData.js` — create user manifest + panel folders + wrap existing containers in board pages
19. Run `node scripts/resetData.js` to verify

### Phase F — Cleanup
20. Remove legacy detection once migration is confirmed working
21. Update CLAUDE.md files for affected folders
22. Update BUGS.md

---

## Key Files (Quick Reference)

| File | Change Type |
|------|-------------|
| `server/models/Folder.js` | Add folderType values + panelId |
| `server/models/Manifest.js` | Add "user" manifestType |
| `server/models/Grid.js` | Add manifestId |
| `server/socketHandlers/crud.js` | Add 5 new page handlers, modify panel lifecycle |
| `server/utils/createDefaultUserData.js` | Full migration to pages + user manifest |
| `client/src/state/masterReducer.js` | Add pages to deriveRoleArrays |
| `client/src/state/selectors.js` | Add pagesById traversal |
| `client/src/GridActionsContext.js` | Add pagesById default |
| `client/src/helpers/CommitHelpers.js` | Add 5 page CRUD functions |
| `client/src/helpers/LayoutHelpers.js` | Add page-aware layout helpers |
| `client/src/helpers/dragSystem.js` | Add PAGE drag type + updated DropAccepts |
| `client/src/helpers/DragProvider.jsx` | Add PAGE drop handler |
| `client/src/modules/Page.jsx` | NEW — routes to board/canvas/doc/display |
| `client/src/modules/Panel.jsx` | Refactor: renders pages not containers |
| `client/src/modules/ManifestTree.jsx` | Rewrite: three-section layout |
| `client/src/App.jsx` | Add pagesById to context |

---

## Verification

After `node scripts/resetData.js`:
1. Each panel has a ManifestTree sidebar with Global / Grid / Local sections
2. Grid section shows a folder per panel; clicking a panel folder stacks that panel
3. Each panel has at least one board page showing its containers/instances
4. Clicking a page in Local makes it the active content in the panel
5. Clicking a page in Global pins it to Local (transient pin with unpin button)
6. Dragging a page onto a different panel moves it there
7. Deleting a panel moves its pages to Global automatically
8. Notebook panel shows multiple doc pages navigable via the tree
