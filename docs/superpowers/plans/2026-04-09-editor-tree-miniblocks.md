# Editor, Tree Sidebar, and Mini-Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical drag/typing/UI bugs, overhaul tree sidebars to push content instead of overlaying, add mini text blocks for inline draggable content, and update example data.

**Architecture:** Five phases — (A) critical bug fixes for drag handles, typing order, container header sizing, and radial menu edge behavior; (B) tree sidebar overhaul with push layout, dual breadcrumbs, correct local ordering, and close buttons; (C) mini text block TipTap extension for inline draggable content within textblocks; (D) example data updates using doccontainers, textblocks, and mini blocks throughout day pages; (E) CLAUDE.md updates.

**Tech Stack:** React, TipTap/ProseMirror, Pragmatic DnD, CSS, Mongoose/MongoDB

---

## Phase A: Critical Bug Fixes

### Task A1: Fix Drag Handles Not Working

**Root Cause Analysis:** The Editor.jsx `handleDOMEvents.dragstart` handler (added Apr 9) intercepts ALL dragstart events on the ProseMirror view. It only allows dragstart from `[data-dnd-handle]` or `.module-drag-handle` elements. However:
1. Events from inside `moduleEmbed` NodeViews may bubble to the ProseMirror view despite `stopEvent: () => true` — the `stopEvent` only prevents ProseMirror from processing them, but DOM bubbling still occurs.
2. The `.radial-handle` button (the actual click target) is a CHILD of `.module-drag-handle`, so `.closest(".module-drag-handle")` should find it. BUT if the drag starts from the stem/ball children, those also need to match.
3. More critically: the `dragstart` interception in `dragSystem.js` sets `el.removeAttribute('draggable')` on the wrapper element. If the Editor's `handleDOMEvents.dragstart` fires FIRST and calls `event.preventDefault()`, the Pragmatic DnD system never sees the drag at all.

**Files:**
- Modify: `client/src/ui/Editor.jsx` (handleDOMEvents.dragstart)
- Modify: `client/src/helpers/dragSystem.js` (handle pointerdown → draggable attr)
- Modify: `client/src/docs/pills/InstancePillNode.jsx` (same pattern)

- [ ] **Step 1: Fix Editor.jsx dragstart handler to also allow `.drag-handle-ball`, `.drag-handle-stem`, `.radial-handle`**

In `client/src/ui/Editor.jsx`, find the `handleDOMEvents` section (around line 283-288):

```javascript
// BEFORE:
dragstart: (view, event) => {
  const target = event.target;
  if (target?.closest?.("[data-dnd-handle], .module-drag-handle")) return false;
  event.preventDefault();
  return true;
},

// AFTER:
dragstart: (view, event) => {
  const target = event.target;
  if (target?.closest?.("[data-dnd-handle], .module-drag-handle, .drag-handle-ball, .drag-handle-stem, .radial-handle, .radial-menu")) return false;
  event.preventDefault();
  return true;
},
```

- [ ] **Step 2: Add `data-dnd-handle` attribute to drag handle ball elements**

In `client/src/modules/ModuleContainer.jsx`, find the embedded container handle div (around line 565-571) and add `data-dnd-handle="true"` to the `.module-drag-handle` wrapper:

```jsx
// The module-drag-handle div should have data-dnd-handle
<div ref={containerHandleRef} className="module-drag-handle" data-dnd-handle="true" ...>
```

Do the same in `ModulePanel.jsx` and `ModulePage.jsx` for their handle divs.

- [ ] **Step 3: Verify by building**

Run: `npx vite build`
Expected: Clean build, no errors.

- [ ] **Step 4: Manual test — drag panels, containers, instances, textblocks**

Test: Open localhost:3000, try dragging each entity type from its handle. All should be draggable. Text selection inside editors should still work (no accidental drags).

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/Editor.jsx client/src/modules/ModuleContainer.jsx client/src/modules/ModulePanel.jsx client/src/modules/ModulePage.jsx
git commit -m "fix: restore drag handles by widening Editor dragstart allowlist + adding data-dnd-handle attrs"
```

---

### Task A2: Fix Typing Order Bug in Textblocks

**Root Cause:** When a user types "hello" into an empty paragraph, `onAutoCreateTextblock` fires after the first character ("h"). This:
1. Creates a new instance module + occurrence with textmap containing "h"
2. Replaces the paragraph node with an `instancePill` block node
3. The new sub-editor mounts with "h" as content
4. But the cursor is at position 0 (before "h"), so subsequent keystrokes ("ello") insert before "h" → "elloh"

**Fix:** After the textblock is created and the paragraph is replaced, the sub-editor needs to place its cursor at the END of the initial text. The `onAutoCreateTextblock` callback in `DocContent.jsx` (or wherever it's defined) needs to signal the new sub-editor to focus at end.

**Files:**
- Modify: `client/src/ui/Editor.jsx` (onUpdate → onAutoCreateTextblock call)
- Modify: `client/src/docs/DocContent.jsx` or parent component that defines `onAutoCreateTextblock`
- Modify: `client/src/docs/pills/InstancePillNode.jsx` (sub-editor initial focus)

- [ ] **Step 1: Find where onAutoCreateTextblock is defined**

Search for `onAutoCreateTextblock` definition in the codebase to find where the callback creates the textblock and what happens after.

- [ ] **Step 2: Delay the auto-create trigger to let the user finish typing a word**

In `client/src/ui/Editor.jsx`, the `onUpdate` handler fires after every character. Change the threshold from `length >= 1 && length <= 2` to use a debounced approach — wait ~300ms after typing stops before converting to a textblock. This prevents mid-word conversion:

```javascript
// In the onUpdate handler, replace the immediate onAutoCreateTextblock call:
// BEFORE:
if (node.type.name === "paragraph" && node.textContent.length >= 1 && node.textContent.length <= 2) {
  const nodeStart = $pos.before(1);
  onAutoCreateTextblock(nodeStart, node.textContent, node.nodeSize);
  handled = true;
}

// AFTER — use a ref-based debounce:
if (node.type.name === "paragraph" && node.textContent.length === 1) {
  // Schedule textblock creation after 300ms of no typing
  if (autoCreateTimerRef.current) clearTimeout(autoCreateTimerRef.current);
  const capturedStart = $pos.before(1);
  autoCreateTimerRef.current = setTimeout(() => {
    // Re-read the node at this position to get full text
    try {
      const currentDoc = editor.state.doc;
      const currentNode = currentDoc.nodeAt(capturedStart);
      if (currentNode && currentNode.type.name === "paragraph" && currentNode.textContent.length > 0) {
        onAutoCreateTextblock(capturedStart, currentNode.textContent, currentNode.nodeSize);
      }
    } catch (_) {}
  }, 300);
  handled = true;
} else if (node.type.name === "paragraph" && node.textContent.length > 1) {
  // Keep the timer running — don't reset on subsequent chars if already scheduled
  // (the timer callback re-reads current text)
  handled = !!autoCreateTimerRef.current;
}
```

Add the ref at the top of the component:
```javascript
const autoCreateTimerRef = useRef(null);
```

And cleanup on unmount:
```javascript
useEffect(() => () => { if (autoCreateTimerRef.current) clearTimeout(autoCreateTimerRef.current); }, []);
```

- [ ] **Step 3: Ensure sub-editor focuses at end of initial content**

In `InstancePillNode.jsx`, the sub-editor (DocContent/Editor) receives the textmap with the initial text. Add an `autoFocusEnd` prop that, when true, calls `editor.commands.focus("end")` after mount:

```javascript
// In the sub-editor's useEffect after mount:
useEffect(() => {
  if (autoFocusEnd && editor && !editor.isDestroyed) {
    requestAnimationFrame(() => {
      editor.commands.focus("end");
    });
  }
}, [editor, autoFocusEnd]);
```

- [ ] **Step 4: Build and test**

Run: `npx vite build`
Test: Type "hello" in an empty line — should create textblock with "hello" (not "elloh"). Cursor should be at end of text after conversion.

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/Editor.jsx client/src/docs/pills/InstancePillNode.jsx
git commit -m "fix: debounce textblock auto-creation to prevent typing order reversal"
```

---

### Task A3: Fix Container Header H1 Sizing

**Problem:** Embedded container headers show the label at `fontSize: 13` regardless of heading intent. The `#` prefix is decorative but the label should render at heading-appropriate size since these containers represent document sections.

**Fix:** Increase the embedded container header label to a proper heading size. The `#` already indicates this is a heading — make the text match.

**Files:**
- Modify: `client/src/modules/ModuleContainer.jsx` (embedded header label style)

- [ ] **Step 1: Increase label font size and adjust layout**

In `client/src/modules/ModuleContainer.jsx`, find the contentEditable label span (around line 612-631). Change the style:

```javascript
// BEFORE:
style={{ outline: "none", cursor: "text", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color: embeddedAccent, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}

// AFTER:
style={{ outline: "none", cursor: "text", fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, color: embeddedAccent, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}
```

Also increase the `#` hash to match:
```javascript
// BEFORE:
<span className="embedded-hash" style={{ fontSize: 12, color: embeddedAccent, flexShrink: 0, fontFamily: "var(--font-mono)" }}>#</span>

// AFTER:
<span className="embedded-hash" style={{ fontSize: 20, fontWeight: 700, color: embeddedAccent, flexShrink: 0, fontFamily: "var(--font-mono)" }}>#</span>
```

- [ ] **Step 2: Build and verify**

Run: `npx vite build`
Check screenshot: embedded container header should look like a proper H1 heading.

- [ ] **Step 3: Commit**

```bash
git add client/src/modules/ModuleContainer.jsx
git commit -m "fix: increase embedded container header to H1-appropriate size (20px, bold)"
```

---

### Task A4: Fix Radial Menu Edge Alignment

**Problem:** When near a screen edge, the radial menu buttons don't all line up — they "stop early" in the animation. The linear fallback positions items diagonally instead of in a straight line.

**Root Cause:** The linear fallback code uses BOTH `(i + 1) * spacing` for the primary axis AND `lineOffset` for the perpendicular axis, creating a diagonal. When near an edge, ALL items should form a straight line along the perpendicular axis at a fixed offset.

**Files:**
- Modify: `client/src/ui/RadialMenu.jsx` (linear fallback positioning)

- [ ] **Step 1: Fix the linear fallback to be a straight line**

In `client/src/ui/RadialMenu.jsx`, find the `anyClipped` fallback section and rewrite:

```javascript
// When clipped, redistribute ALL items in a straight line perpendicular to edge
let finalPositions;
if (anyClipped) {
  const spacing = 28;
  const count = menuItems.length;
  const halfSpan = ((count - 1) * spacing) / 2;
  // Fixed offset along open direction, spread along perpendicular axis
  const fixedOffset = s.radius * 0.75;
  finalPositions = menuItems.map((_, i) => {
    const linePos = -halfSpan + i * spacing;
    let x = 0, y = 0;
    if (openDirection === 'right') { x = fixedOffset; y = linePos; }
    else if (openDirection === 'left') { x = -fixedOffset; y = linePos; }
    else if (openDirection === 'down') { y = fixedOffset; x = linePos; }
    else if (openDirection === 'up') { y = -fixedOffset; x = linePos; }
    // Clamp to viewport
    const ax = anchor.x + x;
    const ay = anchor.y + y;
    if (ax - btnHalf < pad) x += (pad + btnHalf - ax);
    if (ax + btnHalf > window.innerWidth - pad) x -= (ax + btnHalf - window.innerWidth + pad);
    if (ay - btnHalf < pad) y += (pad + btnHalf - ay);
    if (ay + btnHalf > window.innerHeight - pad) y -= (ay + btnHalf - window.innerHeight + pad);
    return { x, y };
  });
} else {
  finalPositions = arcPositions;
}
```

- [ ] **Step 2: Build and verify**

Run: `npx vite build`
Test: Open radial menu near left edge — all buttons should form a vertical column at a fixed distance from the handle, not a diagonal.

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/RadialMenu.jsx
git commit -m "fix: radial menu edge fallback uses straight line instead of diagonal"
```

---

## Phase B: Tree Sidebar Overhaul

### Task B1: Trees Push Content Instead of Overlay (Desktop)

**Problem:** Both root and local tree sidebars use `position: absolute` which overlays page content. On desktop, they should push the content aside using flex layout.

**Files:**
- Modify: `client/src/modules/ModulePanel.jsx` (sidebar rendering + flex layout)
- Modify: `client/src/index.css` (sidebar transition styles)

- [ ] **Step 1: Change sidebar from absolute overlay to flex push**

In `ModulePanel.jsx`, find the panel content wrapper that contains sidebars + page content. Change from:

```jsx
// BEFORE — absolute overlay:
<div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
  {rootTreeOpen && (
    <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, zIndex: 100, ... }}>
```

To flex push layout:

```jsx
// AFTER — flex push:
<div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
  {/* Root tree — left sidebar, pushes content right */}
  {rootTreeOpen && (
    <div style={{
      flexShrink: 0,
      width: isMobile ? "100%" : 180,
      maxHeight: isMobile ? "50%" : "100%",
      borderRight: "1px solid var(--border-default)",
      overflowY: "auto",
      transition: "width 200ms ease-out",
      ...(isMobile ? { position: "absolute", top: 0, left: 0, bottom: 0, zIndex: 100 } : {}),
    }}>
      {/* tree content */}
    </div>
  )}

  {/* Page content — flex-grows to fill remaining space */}
  <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
    {/* breadcrumb bar + page content here */}
  </div>

  {/* Local tree — right sidebar, pushes content left */}
  {localTreeOpen && (
    <div style={{
      flexShrink: 0,
      width: isMobile ? "100%" : 180,
      maxHeight: isMobile ? "50%" : "100%",
      borderLeft: "1px solid var(--border-default)",
      overflowY: "auto",
      transition: "width 200ms ease-out",
      ...(isMobile ? { position: "absolute", top: 0, right: 0, bottom: 0, zIndex: 100 } : {}),
    }}>
      {/* local tree content */}
    </div>
  )}
</div>
```

- [ ] **Step 2: Build and verify**

Run: `npx vite build`
Test: Open root tree — page content should shift right. Open local tree — page content should shift left. Mobile: sidebars still overlay.

- [ ] **Step 3: Commit**

```bash
git add client/src/modules/ModulePanel.jsx
git commit -m "feat: tree sidebars push content on desktop instead of overlaying"
```

---

### Task B2: Local Tree Correct Ordering and Nesting

**Problem:** The local manifest tree doesn't order pages under their correct parent folders. If "Schedule" is open and then "Tracking" folder is opened, "Schedule" should appear nested under "Tracking" in the local tree.

**Fix:** The local tree should build a proper hierarchy from the panel's open pages, grouping them under their parent folders.

**Files:**
- Modify: `client/src/modules/ModulePanel.jsx` (local tree data computation)
- Modify: `client/src/modules/ManifestTree.jsx` (local tree rendering with folder nesting)

- [ ] **Step 1: Compute local tree hierarchy from open pages**

In `ModulePanel.jsx`, compute a tree structure from `pagesList` that groups pages under their parent folders:

```javascript
const localTreeData = useMemo(() => {
  if (!pagesList?.length) return [];
  // Group pages by their parent folder
  const folderGroups = new Map(); // folderId -> { folder, pages: [] }
  const rootPages = []; // pages with no folder parent

  for (const entry of pagesList) {
    const occ = entry.occurrence;
    const parentOcc = occ?.parentId ? occurrencesById[occ.parentId] : null;
    const parentMod = parentOcc ? modulesById[parentOcc.targetId] : null;

    if (parentMod?.kind === "folder") {
      const folderId = parentOcc.id;
      if (!folderGroups.has(folderId)) {
        folderGroups.set(folderId, { folderOcc: parentOcc, folderModule: parentMod, pages: [] });
      }
      folderGroups.get(folderId).pages.push(entry);
    } else {
      rootPages.push(entry);
    }
  }

  return { folderGroups, rootPages };
}, [pagesList, occurrencesById, modulesById]);
```

- [ ] **Step 2: Render local tree with folder nesting**

Pass `localTreeData` to the local tree sidebar. Render folder headers with their child pages indented beneath:

```jsx
{/* Inside local tree sidebar */}
{localTreeData.rootPages.map(entry => (
  <LocalTreeNode key={entry.occurrence.id} entry={entry} onClose={handleClosePage} active={isActivePage(entry)} onSelect={handleSelectPage} />
))}
{[...localTreeData.folderGroups.entries()].map(([folderId, { folderModule, pages }]) => (
  <div key={folderId}>
    <div style={{ padding: "2px 6px", fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>
      {folderModule.label}
    </div>
    {pages.map(entry => (
      <LocalTreeNode key={entry.occurrence.id} entry={entry} depth={1} onClose={handleClosePage} active={isActivePage(entry)} onSelect={handleSelectPage} />
    ))}
  </div>
))}
```

- [ ] **Step 3: Build and test**

Run: `npx vite build`
Test: Open multiple pages from different folders — they should appear nested correctly in the local tree.

- [ ] **Step 4: Commit**

```bash
git add client/src/modules/ModulePanel.jsx client/src/modules/ManifestTree.jsx
git commit -m "feat: local tree groups open pages under parent folders"
```

---

### Task B3: Breadcrumbs for Both Trees

**Problem:** Only the root tree has breadcrumbs. The local tree needs its own breadcrumb trail too. Both trees should display the path to the currently active document.

**Files:**
- Modify: `client/src/modules/ModulePanel.jsx` (dual breadcrumb bars)

- [ ] **Step 1: Add breadcrumb computation for active page path**

Compute the breadcrumb path from the active page occurrence up to the root folder:

```javascript
const activePageBreadcrumbs = useMemo(() => {
  if (!currentView?.activeOccurrenceId) return [];
  const crumbs = [];
  let occId = currentView.activeOccurrenceId;
  let safety = 10;
  while (occId && safety-- > 0) {
    const occ = occurrencesById[occId];
    if (!occ) break;
    const mod = modulesById[occ.targetId];
    crumbs.unshift({ occId, label: mod?.label || "Untitled", kind: mod?.kind });
    occId = occ.parentId;
  }
  return crumbs;
}, [currentView?.activeOccurrenceId, occurrencesById, modulesById]);
```

- [ ] **Step 2: Render left breadcrumbs (root tree) flowing left-to-right**

The existing breadcrumb bar stays left-to-right for the root tree section:

```jsx
{/* Root breadcrumbs — left side, L→R */}
<div style={{ display: "flex", alignItems: "center", gap: 3, overflow: "hidden", flex: 1 }}>
  {activePageBreadcrumbs.map((crumb, i) => (
    <React.Fragment key={crumb.occId}>
      {i > 0 && <span style={{ color: "var(--text-faint)", fontSize: 9 }}>›</span>}
      <span
        onClick={() => openPage(crumb.occId)}
        style={{ fontSize: 10, cursor: "pointer", color: i === activePageBreadcrumbs.length - 1 ? "var(--text-primary)" : "var(--text-muted)", whiteSpace: "nowrap" }}
      >
        {crumb.label}
      </span>
    </React.Fragment>
  ))}
</div>
```

- [ ] **Step 3: Render right breadcrumbs (local tree) flowing right-to-left**

Add a mirrored breadcrumb section on the right side of the breadcrumb bar, flowing right-to-left:

```jsx
{/* Local breadcrumbs — right side, R→L */}
<div style={{ display: "flex", alignItems: "center", gap: 3, overflow: "hidden", flexDirection: "row-reverse" }}>
  {activePageBreadcrumbs.map((crumb, i) => (
    <React.Fragment key={crumb.occId}>
      {i > 0 && <span style={{ color: "var(--text-faint)", fontSize: 9 }}>‹</span>}
      <span
        onClick={() => openPage(crumb.occId)}
        style={{ fontSize: 10, cursor: "pointer", color: i === 0 ? "var(--text-primary)" : "var(--text-muted)", whiteSpace: "nowrap" }}
      >
        {crumb.label}
      </span>
    </React.Fragment>
  ))}
</div>
```

- [ ] **Step 4: Both trees set the active document**

Ensure both root tree `onSelect` and local tree `onSelect` call `CommitHelpers.updateView({ activeOccurrenceId: occId })` so both trees navigate to the selected document.

- [ ] **Step 5: Build and test**

Run: `npx vite build`
Test: Navigate to a nested page — root breadcrumbs flow L→R, local breadcrumbs flow R→L. Both show same path. Clicking a crumb navigates.

- [ ] **Step 6: Commit**

```bash
git add client/src/modules/ModulePanel.jsx
git commit -m "feat: dual breadcrumbs — root (L→R) and local (R→L) both show active page path"
```

---

### Task B4: X Buttons to Close Pages

**Problem:** Need X buttons on local tree nodes (except root folder) to close pages without removing them from the root tree. Also need an X button in the page header.

**Files:**
- Modify: `client/src/modules/ModulePanel.jsx` (local tree node close button + page header close button)
- Modify: `client/src/modules/ModulePage.jsx` (page header X button)

- [ ] **Step 1: Add close handler that unpins page from panel**

```javascript
const handleClosePage = useCallback((pageOccId) => {
  // Remove page from panel's occurrences array (unpin, don't delete)
  const currentOccs = panelOccurrence.occurrences || [];
  const updated = currentOccs.filter(id => id !== pageOccId);
  CommitHelpers.updateOccurrence({
    dispatch, socket,
    occurrence: { ...panelOccurrence, occurrences: updated },
    emit: true,
  });
  // If closing the active page, switch to first remaining page
  if (currentView?.activeOccurrenceId === pageOccId && updated.length > 0) {
    CommitHelpers.updateView({
      dispatch, socket,
      view: { ...currentView, activeOccurrenceId: updated[0] },
      emit: true,
    });
  }
}, [panelOccurrence, currentView, dispatch, socket]);
```

- [ ] **Step 2: Add X button to local tree nodes**

In the local tree rendering, add an X button to each page node (NOT the root folder):

```jsx
const LocalTreeNode = ({ entry, depth = 0, onClose, active, onSelect }) => (
  <div style={{ display: "flex", alignItems: "center", padding: "2px 4px 2px " + (depth * 12 + 4) + "px", background: active ? "rgba(100,180,255,0.1)" : "transparent", cursor: "pointer" }}>
    <span onClick={() => onSelect(entry.occurrence.id)} style={{ flex: 1, fontSize: 11, color: active ? "var(--text-primary)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {entry.page?.label || "Untitled"}
    </span>
    <button
      onClick={(e) => { e.stopPropagation(); onClose(entry.occurrence.id); }}
      style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", color: "var(--text-faint)", fontSize: 10, flexShrink: 0, opacity: 0.5 }}
      title="Close page"
    >
      <X size={10} />
    </button>
  </div>
);
```

- [ ] **Step 3: Add X button to page header**

In `ModulePage.jsx`, add a close button to the right side of the page header row:

```jsx
{/* In the page header flex row, after the page name */}
{onClose && (
  <button
    onClick={(e) => { e.stopPropagation(); onClose(occurrence.id); }}
    style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: "var(--text-faint)", flexShrink: 0 }}
    title="Close page"
  >
    <X size={12} />
  </button>
)}
```

Pass `onClose={handleClosePage}` from `ModulePanel.jsx` to `<Page>`.

- [ ] **Step 4: Build and test**

Run: `npx vite build`
Test: X button appears on local tree nodes. Clicking it removes the page from local tree but it stays in root tree. X button in page header also closes.

- [ ] **Step 5: Commit**

```bash
git add client/src/modules/ModulePanel.jsx client/src/modules/ModulePage.jsx
git commit -m "feat: X buttons to close pages from local tree and page header"
```

---

## Phase C: Mini Text Blocks

### Task C1: Create MiniBlock TipTap Extension

**Concept:** A mini text block is a smaller inline-block node inside a textblock's sub-editor. It's like a textblock-within-a-textblock but smaller, creates its own module/occurrence, and is draggable anywhere. Created by highlighting text and right-clicking → "Make mini block".

Behavior:
- Rendered as a compact bordered wrapper inside the textblock content
- Has its own sub-editor (TipTap) for the highlighted text
- Shift+Enter (or Enter, matching textblock convention) exits to parent
- Draggable via handle to anywhere in the app (creates module occurrence)
- Looks like a smaller version of manifest tree nodes — compact pill-like appearance

**Files:**
- Create: `client/src/docs/MiniBlockExtension.js` (TipTap node spec)
- Create: `client/src/docs/MiniBlockNode.jsx` (React NodeView renderer)
- Modify: `client/src/ui/Editor.jsx` (register extension + context menu)
- Modify: `client/src/index.css` (mini block styling)

- [ ] **Step 1: Create MiniBlockExtension.js**

```javascript
// client/src/docs/MiniBlockExtension.js
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import MiniBlockNode from "./MiniBlockNode.jsx";

export default Node.create({
  name: "miniBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false, // Pragmatic DnD handles this
  
  addAttributes() {
    return {
      occurrenceId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-mini-block="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-mini-block": "true" }, 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MiniBlockNode, {
      stopEvent: () => true,
    });
  },
});
```

- [ ] **Step 2: Create MiniBlockNode.jsx**

```javascript
// client/src/docs/MiniBlockNode.jsx
import React, { useContext, useRef, useEffect } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { GridActionsContext } from "../GridActionsContext";
import DocContent from "../modules/DocContent.jsx";
import { GripVertical } from "lucide-react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

export default function MiniBlockNode({ node, editor, getPos }) {
  const { occurrencesById, modulesById, dispatch, socket } = useContext(GridActionsContext);
  const occurrenceId = node.attrs.occurrenceId;
  const occurrence = occurrencesById?.[occurrenceId];
  const module = occurrence ? modulesById?.[occurrence.targetId] : null;

  const wrapperRef = useRef(null);
  const handleRef = useRef(null);

  // Pragmatic DnD setup
  useEffect(() => {
    const el = wrapperRef.current;
    const handleEl = handleRef.current;
    if (!el || !handleEl || !occurrence) return;

    const cleanup = draggable({
      element: el,
      dragHandle: handleEl,
      getInitialData: () => ({
        type: "module",
        sourceType: "doc",
        role: "instance",
        id: occurrence.targetId,
        occurrenceId: occurrence.id,
        data: { ...module, occurrence },
      }),
    });
    return cleanup;
  }, [occurrence, module]);

  if (!occurrence || !module) {
    return <NodeViewWrapper as="div" contentEditable={false}><div style={{ padding: 4, color: "var(--text-faint)", fontSize: 10 }}>Missing mini block</div></NodeViewWrapper>;
  }

  const handleExitBlock = () => {
    const pos = getPos();
    if (pos != null) {
      const after = pos + node.nodeSize;
      editor.chain().focus().setTextSelection(after).run();
    }
  };

  return (
    <NodeViewWrapper as="div" contentEditable={false} className="mini-block-wrapper">
      <div ref={wrapperRef} className="mini-block" data-dnd-handle="true">
        <div ref={handleRef} className="mini-block-handle" data-dnd-handle="true">
          <GripVertical size={8} />
        </div>
        <div className="mini-block-content">
          <DocContent
            occurrence={occurrence}
            hideToolbar
            onExitBlock={handleExitBlock}
            onDeleteBlock={() => {
              const pos = getPos();
              if (pos != null) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
            }}
          />
        </div>
      </div>
    </NodeViewWrapper>
  );
}
```

- [ ] **Step 3: Add CSS for mini blocks**

In `client/src/index.css`:

```css
/* Mini blocks — compact draggable text containers inside textblocks */
.mini-block-wrapper {
  margin: 2px 0;
}
.mini-block {
  display: flex;
  align-items: flex-start;
  background: rgba(100, 180, 255, 0.06);
  border: 1px solid rgba(100, 180, 255, 0.15);
  border-radius: 4px;
  padding: 1px 4px 1px 0;
  font-size: 12px;
  transition: border-color 0.15s, background 0.15s;
}
.mini-block:hover {
  border-color: rgba(100, 180, 255, 0.3);
  background: rgba(100, 180, 255, 0.08);
}
.mini-block-handle {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 2px 1px;
  cursor: grab;
  color: var(--text-faint);
  opacity: 0.4;
}
.mini-block:hover .mini-block-handle {
  opacity: 0.8;
}
.mini-block-content {
  flex: 1;
  min-width: 0;
}
.mini-block-content .ProseMirror {
  min-height: 0 !important;
  padding: 1px 2px !important;
  font-size: 12px;
  line-height: 1.4;
}
```

- [ ] **Step 4: Register extension in Editor.jsx**

In `client/src/ui/Editor.jsx`, add the import and register the extension:

```javascript
import MiniBlock from "../docs/MiniBlockExtension.js";

// In the extensions array:
extensions: [
  // ... existing extensions ...
  MiniBlock,
],
```

- [ ] **Step 5: Build and verify**

Run: `npx vite build`
Expected: Clean build. Mini blocks can be inserted programmatically (context menu comes next).

- [ ] **Step 6: Commit**

```bash
git add client/src/docs/MiniBlockExtension.js client/src/docs/MiniBlockNode.jsx client/src/ui/Editor.jsx client/src/index.css
git commit -m "feat: add MiniBlock TipTap extension — compact draggable text containers inside textblocks"
```

---

### Task C2: Right-Click Context Menu to Create Mini Blocks

**Problem:** User needs to highlight text inside a textblock, right-click, and choose "Make mini block" to wrap the selection in a mini block.

**Files:**
- Modify: `client/src/docs/pills/InstancePillNode.jsx` (add context menu to sub-editor)
- Modify: `client/src/ui/Editor.jsx` (add context menu item for mini block creation)

- [ ] **Step 1: Add "Make mini block" to editor context menu**

In `Editor.jsx`, add a handler for creating a mini block from selected text:

```javascript
const handleCreateMiniBlock = useCallback(() => {
  if (!editor) return;
  const { from, to } = editor.state.selection;
  if (from === to) return; // No selection

  // Get selected content as JSON
  const slice = editor.state.doc.slice(from, to);
  const selectedContent = slice.content.toJSON();

  // Create module + occurrence for the mini block
  const moduleId = uid();
  const occurrenceId = uid();

  CommitHelpers.createModule({
    dispatch, socket,
    module: { id: moduleId, role: "instance", kind: "doc", label: "Mini Block", gridId: state.grid.id },
    emit: true,
  });

  CommitHelpers.createOccurrence({
    dispatch, socket,
    occurrence: {
      id: occurrenceId,
      targetId: moduleId,
      gridId: state.grid.id,
      textmap: { type: "doc", content: selectedContent },
    },
    emit: true,
  });

  // Replace selection with miniBlock node
  editor.chain()
    .focus()
    .deleteRange({ from, to })
    .insertContentAt(from, { type: "miniBlock", attrs: { occurrenceId } })
    .run();
}, [editor, dispatch, socket, state?.grid?.id]);
```

- [ ] **Step 2: Wire into context menu**

Add the context menu item. In the editor's `onContextMenu` handler (or create one):

```javascript
// In the editor wrapper's onContextMenu:
const handleEditorContextMenu = useCallback((e) => {
  if (!editor) return;
  const { from, to } = editor.state.selection;
  if (from === to) return; // No selection, let default menu show

  e.preventDefault();
  setEditorContextMenu({
    x: e.clientX,
    y: e.clientY,
    items: [
      { label: "Make mini block", icon: Box, onClick: handleCreateMiniBlock },
    ],
  });
}, [editor, handleCreateMiniBlock]);
```

- [ ] **Step 3: Build and test**

Run: `npx vite build`
Test: Highlight text in a textblock → right-click → "Make mini block" → text becomes a compact bordered mini block inside the textblock.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/Editor.jsx client/src/docs/pills/InstancePillNode.jsx
git commit -m "feat: right-click 'Make mini block' creates draggable wrapper from selected text"
```

---

## Phase D: Example Data Updates

### Task D1: Update Day Page Example Data

**Problem:** Day pages in example data should use doccontainers and textblocks for each section. All bullet points should become mini text blocks.

**Files:**
- Modify: `server/utils/createDefaultUserData.js`

- [ ] **Step 1: Audit current day page structure**

Read `createDefaultUserData.js` to find current day page setup. Identify all sections that should use doccontainers/textblocks.

- [ ] **Step 2: Ensure each day page section is a doccontainer**

Update the day page template to use doccontainers for: Schedule, Tasks, Notes, Journal. Each section should be an embedded container (moduleEmbed in the parent doc's textmap).

- [ ] **Step 3: Convert bullet point content to textblocks**

Where the example data has bullet lists, wrap each bullet item as its own textblock (instancePill with pillDisplay="block"). This demonstrates the textblock pattern.

- [ ] **Step 4: Add mini block examples**

Inside at least one textblock, add mini block nodes to demonstrate the feature. Example: a "Morning Routine" textblock with mini blocks for each step.

- [ ] **Step 5: Build and verify**

Run: `cd server && node scripts/resetData.js` then `npx vite build`
Test: Load app — day pages should show properly structured doccontainers with textblocks and mini blocks.

- [ ] **Step 6: Commit**

```bash
git add server/utils/createDefaultUserData.js
git commit -m "feat: update example data with doccontainers, textblocks, and mini blocks for day pages"
```

---

## Phase E: Documentation Updates

### Task E1: Update CLAUDE.md Files

- [ ] **Step 1: Update client/src/ui/CLAUDE.md** with RadialMenu fixes, Editor dragstart fix
- [ ] **Step 2: Update client/src/modules/CLAUDE.md** with container header fix, sidebar push layout, close buttons, breadcrumbs
- [ ] **Step 3: Update client/src/docs/CLAUDE.md** (or create if missing) with MiniBlockExtension, MiniBlockNode
- [ ] **Step 4: Update client/src/CLAUDE.md** with typing fix, new extension registration
- [ ] **Step 5: Commit**

```bash
git add client/src/ui/CLAUDE.md client/src/modules/CLAUDE.md client/src/CLAUDE.md
git commit -m "docs: update CLAUDE.md files with Phase A-D changes"
```
