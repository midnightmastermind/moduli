# Next Plan — Handoff Document

## Status

**A1 FIXED** — Root cause found: `elementFromPoint` in `dragstart` interceptor was checking cursor position AFTER movement (not at pointerdown), so always returned elements outside the handle. Fixed with `_dragFromHandle` boolean flag in dragSystem.js.

**A2 FIXED** — Debounced textblock creation (300ms timer) in Editor.jsx + cursor placed at END of sub-editor via Selection API in DocContent.jsx.

**A3 FIXED** — Already was fontSize 20px in ModuleContainer.jsx (done in a previous session).

**A4 N/A** — RadialMenu was converted to linear strip in Apr 6 session. The arc edge alignment bug no longer applies.

**B1 DONE** — Trees now push content on desktop (flex row). Mobile stays as overlay.

**B2 DONE** — Local tree now groups pages by parent folder via `localTreeData` useMemo in ManifestTree.jsx.

**B3 DONE** — Replaced navHistory-based breadcrumbs with folder-path breadcrumbs computed from `occ.parentId → foldersById` chain. Always visible when active page has a parent folder. navHistory state + useEffect removed.

**B4 DONE** — X button in page header + X button in local tree PageTreeNode rows.

**C2 DONE** — "Make mini block" right-click context menu item in Editor.jsx. Creates instancePill block from selected text. Available when text is selected + dispatch/socket/occurrence are present.

**D1 DONE** — Day page sample data updated in createDefaultUserData.js. All bullet-list items in sampleJournalContent (Morning Intentions + Daily Log sections) converted to instancePill block textblocks. Each textblock is a separate module+occurrence with parentId=dayPageDocOccId, batch-saved via _dpTbMods/_dpTbOccs arrays. Brain Dump section also uses textblocks. dayPageDocOccId pre-generated early (before sampleJournalContent) to enable this.

---

## Original User Request

> okay keep working on that but ive seen a couple of issues. for one, none of the modules can be dragged at the moment fromn the drag handles. make a plan to fix that with high effort and add theese to the plan *other than what you were working on): make the trees not go over the content of the page anymore (on desktop), make it push the page over. also we need breadcrumbs for the local too and make it so both the root and local are setting the document we are on and both display the path to it (from their respective sections). i noticed that the local manifest tree is also not ordering correctly. it should be displayed correctly under the correct line. like lets say i open the tracking folder and i already had schedule open. the local should resolve that by putting it under the tracking folder in the tree. make the local push out from the right side too and the breadcrumbs move right to left from that side (for that breadcrumb tree). also we should have x buttons to close the page from local and the panel (but doesnt remove it from the root obviously, just doesnt have it opened anymore and reoved from the local tree). this should go on the local manifest trees nodes (except locals root folder), and an x button in the page header (to the right of the page name). i also want to introduce a smaller instance module like the pill we have except it looks like a smaller version of the manifest nodes. this will be for when i can highlight text inside of a textblock and make tinier draggables out of them (using a right click option). this makes the text i highlight, its own textblock (a smaller one, inside the textblock its in). I should be able to drag these anywhere since they are a module. it should be treated like how a textblock is contained (with pressing enter to leave or shift enter, i forgot what it is). the only difference is that its smaller and we dont start it by typing on en empty line. its like textblocks are required but these are not for text. its just a smaller wrapper. (i would edit it by clicking into it or using arrow keys of course). does this make sense? its like little blocks inside textblocks that i can move around. okay make a plan for all of this. also the typing gets screwed up when i type and it makes a textblock. i will type hello and it will end up elloh, like it put it in front of the h. also one last thing, remember to update the example data with these textcontainers especially with daypage. and also make all bulletpoints in the example data, each its own mini text block (after we implement that) and go through the daypage and make sure you are using doccontainers and textblocks for each section there. okay make a plan now.

## Pre-existing bugs from the previous session (also need fixing)

1. **Container header too tiny** — embedded container headers show label at fontSize 13. Should reflect H1 sizing (20px+). The `#` prefix is decorative but label should be heading-sized.
2. **Radial menu edge alignment** — when near screen edge, menu buttons form a diagonal instead of a straight line. The linear fallback code is wrong.

---

## Task List

### Phase A: Critical Bug Fixes

#### A1: Fix Drag Handles Not Working (INCOMPLETE — needs debugging)

**What was attempted:** A subagent widened the Editor.jsx `handleDOMEvents.dragstart` allowlist and added `data-dnd-handle="true"` to handle wrapper divs. But the user says it's still broken.

**Root cause analysis from research:**

The drag system uses Pragmatic DnD. The flow is:
1. `dragSystem.js` `useDraggable`/`useDragDrop` hooks: on mount, wrapper element has `draggable` attribute REMOVED. On `pointerdown` on the handle element, `draggable="true"` is re-added. On `pointerup`/`dragend`/`drop`, it's removed again.
2. Additionally, a `dragstart` listener on the wrapper element checks if the drag originated from the handle — if not, `preventDefault()` is called.
3. Editor.jsx has its OWN `handleDOMEvents.dragstart` that intercepts dragstart events on the ProseMirror view and blocks them unless from a handle element.

**The problem is likely multi-layered:**
- The Editor.jsx dragstart handler may be intercepting events before Pragmatic DnD sees them
- Events from inside `moduleEmbed` NodeViews (which have `stopEvent: () => true`) may still bubble to ProseMirror's DOM event handlers
- The `document.elementFromPoint()` check in dragSystem.js may fail if a portal or overlay is on top of the handle

**Files to investigate:**
- `client/src/ui/Editor.jsx` ~line 283-288 — the `handleDOMEvents.dragstart`
- `client/src/helpers/dragSystem.js` ~line 525-553 — the handle setup with `pointerdown`/`dragstart` interception
- `client/src/docs/pills/InstancePillNode.jsx` ~line 219-242 — same pattern for block pills
- `client/src/docs/ModuleEmbedExtension.js` line 13 — `draggable: false`

**What the subagent changed (verify these are actually in the files):**
- Editor.jsx: allowlist widened to include `.drag-handle-ball, .drag-handle-stem, .radial-handle, .radial-menu`
- ModuleContainer.jsx: `data-dnd-handle="true"` on 3 handle divs
- ModulePanel.jsx: `data-dnd-handle="true"` on panel handle div
- ModulePage.jsx: `data-dnd-handle="true"` on page handle div
- ModuleInstance.jsx: `data-dnd-handle="true"` on instance handle div

**Next steps:** Verify these changes are actually in the files. If they are and drag still doesn't work, the issue is deeper — likely the Editor.jsx handler fires BEFORE Pragmatic DnD can process the event. May need to check event ordering or remove the Editor.jsx handler entirely and rely solely on the `-webkit-user-drag: none` CSS (already in index.css) to prevent text drags.

#### A2: Fix Typing Order Bug in Textblocks (NOT STARTED)

**Problem:** Typing "hello" into an empty line creates a textblock after the first character. The cursor ends up at position 0 (before "h"), so subsequent characters insert before → "elloh".

**Root cause:** In `client/src/ui/Editor.jsx` `onUpdate` handler (~line 207-215):
```javascript
if (node.type.name === "paragraph" && node.textContent.length >= 1 && node.textContent.length <= 2) {
  const nodeStart = $pos.before(1);
  onAutoCreateTextblock(nodeStart, node.textContent, node.nodeSize);
}
```
This fires after just 1 character. The paragraph is replaced with an `instancePill` block node. The new sub-editor mounts with the text but cursor goes to position 0.

**Fix approach:**
1. Debounce the auto-creation — wait ~300ms after typing stops before converting
2. Use a ref-based timer that re-reads the node content when it fires (gets full typed text)
3. Ensure the new sub-editor in InstancePillNode.jsx focuses at END of initial content after mount

**Files:**
- `client/src/ui/Editor.jsx` — debounce the `onAutoCreateTextblock` call
- `client/src/docs/pills/InstancePillNode.jsx` — add `autoFocusEnd` behavior to sub-editor

#### A3: Fix Container Header H1 Sizing (NOT STARTED)

**File:** `client/src/modules/ModuleContainer.jsx`

Find the `embedded-hash` span (~line 611) and the contentEditable label span (~line 612-631).

Change:
- Hash span: `fontSize: 12` → `fontSize: 20`, add `fontWeight: 700`
- Label span: `fontSize: 13` → `fontSize: 20`, `fontWeight: 600` → `fontWeight: 700`, `lineHeight: 1.3` → `lineHeight: 1.2`

#### A4: Fix Radial Menu Edge Alignment (NOT STARTED)

**File:** `client/src/ui/RadialMenu.jsx`

Find the `anyClipped` fallback in the IIFE inside the portal render. The current code positions items diagonally because both axes change with `i`:

```javascript
if (openDirection === 'right') { x = (i + 1) * spacing; y = lineOffset; }
```

Fix: use a FIXED offset for the primary axis, only spread along perpendicular:

```javascript
const fixedOffset = s.radius * 0.75;
if (openDirection === 'right') { x = fixedOffset; y = linePos; }
else if (openDirection === 'left') { x = -fixedOffset; y = linePos; }
else if (openDirection === 'down') { y = fixedOffset; x = linePos; }
else if (openDirection === 'up') { y = -fixedOffset; x = linePos; }
```

The spin animation (wrapper rotates from `startRot` to 0°, icons counter-rotate) is already implemented — keep it.

---

### Phase B: Tree Sidebar Overhaul

#### B1: Trees Push Content Instead of Overlay (desktop)

**Problem:** Both root (left) and local (right) tree sidebars use `position: absolute` which overlays page content. On desktop, they should push content using flex layout.

**File:** `client/src/modules/ModulePanel.jsx`

**Current state (from research):**
- `rootTreeOpen`/`localTreeOpen` are boolean states (~line 278-279)
- Sidebar divs use `position: "absolute", top: 0, left/right: 0, bottom: 0, zIndex: 100`
- Root tree is on the LEFT, local tree is on the RIGHT

**Fix:** Change the content wrapper from `position: relative` to `display: flex`. Sidebars become flex items with `flexShrink: 0, width: 180`. On mobile, keep absolute overlay.

```jsx
<div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
  {/* Root tree — left, push */}
  {rootTreeOpen && (
    <div style={{
      flexShrink: 0, width: isMobile ? "100%" : 180,
      borderRight: "1px solid var(--border-default)",
      overflowY: "auto",
      ...(isMobile ? { position: "absolute", top: 0, left: 0, bottom: 0, zIndex: 100 } : {}),
    }}>...
  )}
  {/* Page content — flex grow */}
  <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>...</div>
  {/* Local tree — right, push */}
  {localTreeOpen && (
    <div style={{
      flexShrink: 0, width: isMobile ? "100%" : 180,
      borderLeft: "1px solid var(--border-default)",
      overflowY: "auto",
      ...(isMobile ? { position: "absolute", top: 0, right: 0, bottom: 0, zIndex: 100 } : {}),
    }}>...
  )}
</div>
```

#### B2: Local Tree Correct Ordering/Nesting

**Problem:** Local tree doesn't group pages under parent folders. If "Schedule" is open under "Tracking" folder, local tree should show it nested.

**File:** `client/src/modules/ModulePanel.jsx`

Compute `localTreeData` from `pagesList` — group pages by their parent folder occurrence:

```javascript
const localTreeData = useMemo(() => {
  const folderGroups = new Map();
  const rootPages = [];
  for (const entry of pagesList) {
    const occ = entry.occurrence;
    const parentOcc = occ?.parentId ? occurrencesById[occ.parentId] : null;
    const parentMod = parentOcc ? modulesById[parentOcc.targetId] : null;
    if (parentMod?.kind === "folder") {
      const folderId = parentOcc.id;
      if (!folderGroups.has(folderId)) folderGroups.set(folderId, { folderModule: parentMod, pages: [] });
      folderGroups.get(folderId).pages.push(entry);
    } else {
      rootPages.push(entry);
    }
  }
  return { folderGroups, rootPages };
}, [pagesList, occurrencesById, modulesById]);
```

Render folder headers with indented children in the local tree.

#### B3: Dual Breadcrumbs for Both Trees

**Problem:** Only root tree has breadcrumbs. Both trees need breadcrumb trails showing path to active document. Root breadcrumbs flow L→R, local breadcrumbs flow R→L.

**File:** `client/src/modules/ModulePanel.jsx`

Compute `activePageBreadcrumbs` by walking up `parentId` chain from active occurrence. Render:
- Left side of breadcrumb bar: root crumbs flowing left-to-right (`Folder › Subfolder › Page`)
- Right side: local crumbs flowing right-to-left (using `flexDirection: "row-reverse"`)

Both should be clickable to navigate.

#### B4: X Buttons to Close Pages

**Problem:** Need X buttons on local tree nodes (except root folder) and in page header to close/unpin pages without deleting them.

**Files:**
- `client/src/modules/ModulePanel.jsx` — close handler + local tree X buttons
- `client/src/modules/ModulePage.jsx` — page header X button

Close handler removes page from panel's `occurrences` array (unpin, not delete). If closing the active page, switch to first remaining page.

---

### Phase C: Mini Text Blocks

#### C1: Create MiniBlock TipTap Extension

**Concept:** Small inline-block nodes inside textblock sub-editors. Created by highlighting text and right-clicking → "Make mini block". Each mini block is its own module/occurrence, draggable anywhere.

**New files:**
- `client/src/docs/MiniBlockExtension.js` — TipTap node: `{ name: "miniBlock", group: "block", atom: true, selectable: true, draggable: false }`
- `client/src/docs/MiniBlockNode.jsx` — React NodeView with GripVertical handle, DocContent sub-editor, Pragmatic DnD

**Modify:**
- `client/src/ui/Editor.jsx` — register `MiniBlock` in extensions array
- `client/src/index.css` — `.mini-block` CSS (compact blue-tinted wrapper, 12px font, 4px border-radius)

Behavior: Shift+Enter exits to parent editor. Backspace on empty deletes. Draggable via handle.

#### C2: Right-Click Context Menu for Mini Blocks

**File:** `client/src/ui/Editor.jsx`

Add context menu handler: when text is selected and user right-clicks, show "Make mini block" option. On click:
1. Get selected content as JSON
2. Create module (role: "instance", kind: "doc") + occurrence (with textmap from selection)
3. Replace selection with `{ type: "miniBlock", attrs: { occurrenceId } }`

---

### Phase D: Example Data Updates

#### D1: Update Day Page Example Data

**File:** `server/utils/createDefaultUserData.js`

- Ensure each day page section is a doccontainer (moduleEmbed in parent doc textmap)
- Convert bullet point content to textblocks (instancePill with pillDisplay="block")
- Add mini block examples inside textblocks
- Go through day page and ensure doccontainers + textblocks for every section

---

### Phase E: Documentation

#### E1: Update CLAUDE.md Files

Update `client/src/ui/CLAUDE.md`, `client/src/modules/CLAUDE.md`, `client/src/CLAUDE.md` with all changes from Phases A-D.

---

## Key Architecture Notes

- **Drag system:** Pragmatic DnD (`@atlaskit/pragmatic-drag-and-drop`). `useDraggable`/`useDragDrop` hooks in `dragSystem.js`. Handle pattern: remove `draggable` attr on mount, re-add on `pointerdown` on handle, remove on `pointerup`/`dragend`/`drop`.
- **TipTap extensions:** All custom nodes in `client/src/docs/`. Block instancePills (`pillDisplay: "block"`) are the current "textblock" system. ModuleEmbed is for embedded containers.
- **Tree sidebars:** `ManifestTree.jsx` renders folder/doc tree. `ModulePanel.jsx` manages `rootTreeOpen`/`localTreeOpen` state and sidebar positioning.
- **Mutations:** Everything through `CommitHelpers.js` — never call socket directly.
- **State:** Redux-like via `GridActionsContext` (stable) and `GridLiveContext` (frequently changing).
- **CSS:** Global styles in `client/src/index.css`. Semantic tokens (`--text-primary`, `--border-default`, etc.).
- **Build:** `npx vite build` from `client/` dir. Dev: `npm run dev` from root.
- **Data reset:** `cd server && node scripts/resetData.js`

## Full Plan File

The detailed plan with complete code snippets is at: `docs/superpowers/plans/2026-04-09-editor-tree-miniblocks.md`
