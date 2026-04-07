# Textblock Auto-Create + Cursor Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user types on an empty line in a doc editor, seamlessly create a text module instance (textblock) wrapping that content. Fix cursor placement so clicking anywhere in doc content places the cursor exactly there. Update example data so text content lives inside textblock instances instead of raw paragraphs.

**Architecture:** The TipTap editor already has `instancePill` nodes with `pillDisplay: "block"` that render as textblocks (`InstancePillNode.jsx`). We add a new TipTap plugin that watches for typing on empty paragraphs — when the first character is typed, it creates a module instance via CommitHelpers, replaces the paragraph with an `instancePill` block node, and transfers focus into the textblock's own editor. The textblock instance uses `occurrence.textmap` for its content (existing pattern). Shift+Enter at the end or clicking away exits the textblock and returns focus to the parent doc. Example data (`createDefaultUserData.js`) is updated so `makeDocContent` wraps non-heading paragraphs in instancePill blocks.

**Tech Stack:** TipTap/ProseMirror, React, CommitHelpers (socket mutations), createDefaultUserData.js

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `client/src/ui/Editor.jsx` | Modify | Add auto-create plugin to TipTap extensions, fix wrapper click cursor |
| `client/src/modules/DocContent.jsx` | Modify | Fix cursor placement on click |
| `client/src/modules/ModuleInstance.jsx` | Already fixed | Removed `userSelect: none` and `no-select` from wrapper (done this session) |
| `client/src/docs/pills/InstancePillNode.jsx` | Modify | Add editable TipTap sub-editor inside block pills, handle Shift+Enter exit, show `cursor: text` on hover |
| `client/src/docs/InstancePillExtension.js` | Modify | Mark block pills as non-atom so cursor can enter them |
| `client/src/index.css` | Modify | Add `cursor: text` hover style for textblock areas |
| `server/utils/docBuilders.js` | Modify | Update `makeDocContent` to wrap paragraph runs in instancePill blocks |
| `server/utils/createDefaultUserData.js` | Modify | Create text instance modules for paragraph content, wire them into textmaps |

---

### Task 1: Fix cursor placement in DocContent and Editor wrapper

The cursor currently jumps to the top of the document when clicking inside a doc container. Two causes: (1) ProseMirror's native click works but parent event handlers interfere, (2) the wrapper click handler calls `focus("end")` as fallback.

**Files:**
- Modify: `client/src/modules/DocContent.jsx:36-46`
- Modify: `client/src/ui/Editor.jsx:826-848`
- Modify: `client/src/index.css:836-843`

- [ ] **Step 1: Ensure ProseMirror content area has `cursor: text` on hover**

In `client/src/index.css`, verify the `.doc-editor-content.ProseMirror` rule has `cursor: text`. It already does. Add `cursor: text` to the `.doc-editor-wrapper` as well so the entire editable area shows the text cursor:

```css
.doc-editor-wrapper {
  overflow: visible;
  display: flex;
  flex-direction: column;
  cursor: text;
}
```

- [ ] **Step 2: Fix DocContent wrapper click to use posAtCoords properly**

The current `onClick` in DocContent.jsx correctly uses `posAtCoords` but the guard `e.target !== e.currentTarget` means it only fires when clicking the outer div padding (not the editor content — ProseMirror handles that natively). This is correct behavior. The "cursor goes to top" issue is caused by ProseMirror receiving focus but not having a valid selection position.

Add an `onFocus` guard to the Editor component. In `client/src/ui/Editor.jsx`, add a `handleClick` editorProp that ensures clicks inside ProseMirror place the cursor at the click position:

```javascript
// Inside editorProps (after handleTextInput):
handleClick: (view, pos, event) => {
  // Let ProseMirror place cursor at the clicked position natively.
  // Return false so ProseMirror's default click handler runs.
  return false;
},
handleDOMEvents: {
  mousedown: (view, event) => {
    // Prevent focus without position — ensure click coordinates resolve
    const coords = { left: event.clientX, top: event.clientY };
    const pos = view.posAtCoords(coords);
    if (pos) {
      // Let ProseMirror handle it natively — it will place cursor correctly
      return false;
    }
    // Click is outside content bounds (padding area) — don't let ProseMirror steal focus
    return false;
  },
},
```

- [ ] **Step 3: Remove `tabIndex={0}` from instance wrapper to prevent focus stealing**

In `client/src/modules/ModuleInstance.jsx`, the wrapper div has `tabIndex={0}` which makes it focusable. When clicking the DocContent inside an instance, the browser may focus the wrapper first (because it's a focusable ancestor), which steals focus from ProseMirror. Remove `tabIndex={0}` from the wrapper:

```jsx
// ModuleInstance.jsx line ~530 — remove tabIndex={0}
<div
  ref={ref}
  data-instance-id={module.id}
  data-occurrence-id={occurrence?.id}
  data-testid="instance-wrap"
  className="instance-wrap"
  style={{
    touchAction: "manipulation",
    opacity: isDragging ? 0.4 : 1,
    background: "transparent", borderRadius: 4,
    transition: "opacity 0.1s", marginBottom: 2, position: "relative",
  }}
  // NO tabIndex here
```

- [ ] **Step 4: Add cursor: text to doc-instance-block and doc-container areas**

In `client/src/index.css`, add hover cursor rules:

```css
.doc-instance-block {
  cursor: text;
}

.container-doc {
  cursor: text;
}
```

- [ ] **Step 5: Verify and commit**

```bash
cd /home/joshpoms/moduli/client && npx vite build --logLevel error
```

Test manually: click anywhere in a doc container's text content — cursor should appear at click position, not at top. Click text inside an instance textblock — should be editable with cursor at click position.

```bash
git add client/src/ui/Editor.jsx client/src/modules/DocContent.jsx client/src/modules/ModuleInstance.jsx client/src/index.css
git commit -m "fix: cursor placement in doc containers and instance textblocks"
```

---

### Task 2: Make instance textblocks (block pills) editable with inline TipTap sub-editor

Currently, block-mode instance pills render text content read-only via `extractPlainText()`. We need to make them fully editable with their own TipTap editor so the user can click inside and type, with the cursor appearing exactly where they click.

**Files:**
- Modify: `client/src/docs/pills/InstancePillNode.jsx:~100-220`

- [ ] **Step 1: Replace plain text rendering with DocContent editor**

The block pill currently extracts plain text from `occurrence.textmap` and renders it as a `<div>`. Replace this with `<DocContent>` which wraps a full TipTap editor. The textblock should be editable inline — no separate "edit mode" needed.

In `InstancePillNode.jsx`, change the block mode render:

```jsx
import { DocContent } from "../../modules/DocContent.jsx";

// Inside the component, in the isBlockMode branch:
// Replace the extractPlainText rendering with:
const occurrence = occurrencesById?.[occurrenceId] || null;

// Block mode render:
if (isBlockMode) {
  return (
    <NodeViewWrapper
      className="doc-instance-block"
      data-occ-id={occurrenceId}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "rgba(134,239,172,0.04)",
        border: "1px solid rgba(134,239,172,0.10)",
        borderRadius: 6,
        padding: "2px 6px 2px 16px",
        position: "relative",
        margin: "2px 0",
        cursor: "text",
      }}
    >
      {/* Radial dot handle — top-left, shows on hover */}
      {showMenu && (
        <div style={{ position: "absolute", top: 2, left: 0, zIndex: 5 }}>
          <RadialMenu
            handleIcon={GripVertical}
            size={8}
            forceDirection="right"
            items={radialItems}
          />
        </div>
      )}
      {occurrence ? (
        <DocContent
          occurrence={occurrence}
          dispatch={dispatch}
          socket={socket}
          hideToolbar={true}
        />
      ) : (
        <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "4px 0" }}>
          {displayLabel}
        </div>
      )}
    </NodeViewWrapper>
  );
}
```

- [ ] **Step 2: Handle Shift+Enter to exit the textblock**

When the cursor is at the end of the textblock content and the user presses Shift+Enter, focus should return to the parent doc editor (moving to the next line after the instancePill node).

This is handled by adding a `handleKeyDown` to the DocContent's Editor. In `DocContent.jsx`, add a new prop `onExitBlock`:

```jsx
// DocContent.jsx — add onExitBlock prop
export const DocContent = React.memo(function DocContent({ 
  occurrence, dispatch, socket, onConvertListToInstances, 
  hideToolbar = false, scrollAnchor, onExitBlock 
}) {
  // ... existing code ...
  
  return (
    <div ref={wrapRef} className="doc-container flex flex-col flex-1 min-h-0 relative" ...>
      {/* ... lock button ... */}
      <Editor
        ref={editorRef}
        content={occurrence?.textmap ?? null}
        occurrence={occurrence}
        dispatch={dispatch}
        socket={socket}
        editable={!isLocked}
        showToolbar={false}
        className="flex-1"
        onConvertListToInstances={onConvertListToInstances}
        onExitBlock={onExitBlock}
      />
    </div>
  );
});
```

In `Editor.jsx`, add `onExitBlock` prop handling inside `handleKeyDown`:

```javascript
// Inside editorProps.handleKeyDown, add before the return false:
if (event.key === "Enter" && event.shiftKey && onExitBlock) {
  const { from } = _view.state.selection;
  const docSize = _view.state.doc.content.size;
  // At end of content — exit block
  if (from >= docSize - 1) {
    event.preventDefault();
    onExitBlock();
    return true;
  }
}
```

In `InstancePillNode.jsx`, pass an `onExitBlock` callback that uses the TipTap NodeView API to move focus to the parent editor after the pill node:

```jsx
const handleExitBlock = useCallback(() => {
  if (!editor || !getPos) return;
  const pos = getPos();
  const nodeSize = node.nodeSize;
  // Move parent editor cursor to after this node
  editor.chain().setTextSelection(pos + nodeSize).focus().run();
}, [editor, getPos, node.nodeSize]);

// Pass to DocContent:
<DocContent
  occurrence={occurrence}
  dispatch={dispatch}
  socket={socket}
  hideToolbar={true}
  onExitBlock={handleExitBlock}
/>
```

- [ ] **Step 3: Commit**

```bash
git add client/src/docs/pills/InstancePillNode.jsx client/src/modules/DocContent.jsx client/src/ui/Editor.jsx
git commit -m "feat: make textblock instance pills editable with inline sub-editor"
```

---

### Task 3: Auto-create textblock on typing in empty paragraph

When the user starts typing on an empty paragraph line in a doc editor, automatically create a text module instance and replace the paragraph with an instancePill block node. The typing should be seamless — the character they typed should appear in the new textblock.

**Files:**
- Modify: `client/src/ui/Editor.jsx:202-220` (onUpdate handler)

- [ ] **Step 1: Add auto-create logic to the onUpdate handler**

In the `onUpdate` callback of `useEditor`, detect when the user has typed into a previously empty paragraph. Create a module + occurrence + instancePill replacement.

```javascript
// In Editor.jsx, add new prop:
// onAutoCreateTextblock — called when user types into empty paragraph
// Signature: onAutoCreateTextblock(pos, text) => occurrenceId

// In useEditor's onUpdate:
onUpdate: ({ editor, transaction }) => {
  const json = editor.getJSON();
  onChange?.(json);
  persistContent(json, false);

  // Auto-create textblock: if the transaction added text to a previously empty paragraph,
  // and onAutoCreateTextblock is provided, create a textblock instance
  if (onAutoCreateTextblock && transaction.docChanged && !transaction.getMeta("skipAutoCreate")) {
    const { from } = editor.state.selection;
    const $pos = editor.state.doc.resolve(from);
    // Check if we're in a top-level paragraph (depth 1) that just got its first character
    if ($pos.depth === 1) {
      const node = $pos.parent;
      if (node.type.name === "paragraph" && node.textContent.length >= 1 && node.textContent.length <= 2) {
        // This paragraph just received its first character(s)
        const nodeStart = $pos.before(1);
        const text = node.textContent;
        onAutoCreateTextblock(nodeStart, text, node.nodeSize);
      }
    }
  }

  // ... existing convert prompt logic ...
},
```

- [ ] **Step 2: Implement onAutoCreateTextblock in DocContent**

In `DocContent.jsx`, add the handler that creates the module + occurrence and replaces the paragraph with an instancePill:

```javascript
const handleAutoCreateTextblock = useCallback((nodeStart, typedText, nodeSize) => {
  if (!occurrence?.id || !socket || !dispatch) return;
  const editor = editorRef.current?.editor;
  if (!editor) return;

  const userId = occurrence.userId;
  const gridId = occurrence.gridId;
  const modId = crypto.randomUUID();
  const occId = crypto.randomUUID();

  // Create the text module (instance role, kind: doc)
  CommitHelpers.createModule({
    dispatch, socket,
    module: { id: modId, userId, gridId, role: "instance", kind: "doc", label: "" },
    emit: true,
  });

  // Create occurrence with the typed text as initial textmap
  const initialTextmap = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: typedText }] }],
  };
  CommitHelpers.createOccurrence({
    dispatch, socket,
    occurrence: {
      id: occId, userId, gridId,
      targetId: modId, targetType: "module",
      parentId: occurrence.id,
      iteration: { mode: "persistent" },
      textmap: initialTextmap,
      fields: {},
    },
    emit: true,
  });

  // Replace the paragraph with an instancePill block node
  const tr = editor.state.tr;
  tr.setMeta("skipAutoCreate", true);
  tr.replaceWith(nodeStart, nodeStart + nodeSize, editor.state.schema.nodes.instancePill.create({
    instanceId: modId,
    instanceLabel: "",
    occurrenceId: occId,
    pillDisplay: "block",
    showIcon: false,
    showHeader: false,
  }));
  editor.view.dispatch(tr);

  // Focus the new textblock's editor after a tick (let React render the pill)
  setTimeout(() => {
    const blockEl = editor.view.dom.closest(".doc-editor-wrapper")
      ?.querySelector(`[data-occ-id="${occId}"] .ProseMirror`);
    if (blockEl) {
      // Place cursor at end of the typed text
      const innerEditor = blockEl.pmViewDesc?.view;
      if (innerEditor) {
        const endPos = innerEditor.state.doc.content.size - 1;
        innerEditor.dispatch(innerEditor.state.tr.setSelection(
          innerEditor.state.selection.constructor.near(innerEditor.state.doc.resolve(endPos))
        ));
        innerEditor.focus();
      }
    }
  }, 50);
}, [occurrence, socket, dispatch]);

// Pass to Editor:
<Editor
  ref={editorRef}
  // ... existing props ...
  onAutoCreateTextblock={handleAutoCreateTextblock}
/>
```

- [ ] **Step 3: Only auto-create in doc pages, not in textblocks themselves**

The auto-create should NOT trigger inside textblock sub-editors (that would create nested textblocks). Only the top-level doc container editor should have this behavior. The `onAutoCreateTextblock` prop is only passed from `DocContent` when it's rendering a doc container (not when it's rendering inside an instance pill).

In `InstancePillNode.jsx`, do NOT pass `onAutoCreateTextblock` to the DocContent:

```jsx
<DocContent
  occurrence={occurrence}
  dispatch={dispatch}
  socket={socket}
  hideToolbar={true}
  onExitBlock={handleExitBlock}
  // NO onAutoCreateTextblock — prevents nested auto-create
/>
```

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/Editor.jsx client/src/modules/DocContent.jsx
git commit -m "feat: auto-create textblock instance when typing on empty paragraph"
```

---

### Task 4: Update example data — wrap text content in textblock instances

Currently, `makeDocContent` in `docBuilders.js` creates raw paragraph nodes in the textmap. Update it to wrap consecutive paragraph runs (not headings, not lists) in instancePill block nodes, each backed by a real module + occurrence.

**Files:**
- Modify: `server/utils/docBuilders.js:33-120` (`makeDocContent`)
- Modify: `server/utils/createDefaultUserData.js` (pass userId/gridId context for module creation)

- [ ] **Step 1: Add `wrapTextInBlocks` function to docBuilders.js**

This function takes a TipTap doc content array and replaces runs of paragraph nodes with instancePill block nodes. It needs a `createTextblock` callback to create the module + occurrence.

```javascript
/**
 * Wrap runs of paragraph nodes in instancePill block nodes.
 * Headings, lists, tables, and other block types are left as-is.
 * Each run of consecutive paragraphs becomes one textblock.
 * 
 * @param {Array} nodes - TipTap doc content array
 * @param {Function} createTextblock - (textmapContent) => { moduleId, occurrenceId }
 * @returns {Array} - Modified content array with instancePill blocks
 */
export function wrapTextInBlocks(nodes, createTextblock) {
  const result = [];
  let paragraphRun = [];

  function flushParagraphRun() {
    if (paragraphRun.length === 0) return;
    const textmapContent = [...paragraphRun];
    paragraphRun = [];
    const { moduleId, occurrenceId } = createTextblock(textmapContent);
    result.push({
      type: "paragraph",
      content: [{
        type: "instancePill",
        attrs: {
          instanceId: moduleId,
          instanceLabel: "",
          occurrenceId,
          pillDisplay: "block",
          showIcon: false,
          showHeader: false,
        },
      }],
    });
  }

  for (const node of nodes) {
    if (node.type === "paragraph") {
      paragraphRun.push(node);
    } else {
      flushParagraphRun();
      result.push(node);
    }
  }
  flushParagraphRun();
  return result;
}
```

- [ ] **Step 2: Update createDefaultUserData.js to use wrapTextInBlocks**

Where `makeDocContent(lines)` is called and the result is used as a container's textmap, wrap the content:

```javascript
import { wrapTextInBlocks } from "./docBuilders.js";

// Helper at top of createDefaultUserData:
function makeTextblockCreator(userId, gridId, parentOccId) {
  return (paragraphNodes) => {
    const modId = uid();
    const occId = uid();
    // Queue module + occurrence for batch save
    textblockModules.push({
      id: modId, userId, gridId,
      role: "instance", kind: "doc", label: "",
    });
    textblockOccurrences.push({
      id: occId, userId, gridId,
      targetId: modId, targetType: "module",
      parentId: parentOccId,
      iteration: { mode: "persistent" },
      textmap: { type: "doc", content: paragraphNodes },
      fields: {},
    });
    return { moduleId: modId, occurrenceId: occId };
  };
}
```

Then at each section wiring point (stan, morenotes, gospel, etc.), replace:

```javascript
// Before:
textmap: { type: "doc", content: makeDocContent(section.lines).content }

// After:
textmap: (() => {
  const raw = makeDocContent(section.lines);
  const creator = makeTextblockCreator(userId, gridId, contOccId);
  return { type: "doc", content: wrapTextInBlocks(raw.content, creator) };
})()
```

- [ ] **Step 3: Batch-save textblock modules and occurrences**

After all section wiring, save all queued textblocks:

```javascript
// After all section wiring loops:
if (textblockModules.length > 0) {
  await Module.insertMany(textblockModules);
}
if (textblockOccurrences.length > 0) {
  await Occurrence.insertMany(textblockOccurrences);
}
```

- [ ] **Step 4: Run resetData and verify**

```bash
cd /home/joshpoms/moduli/server && node scripts/resetData.js
```

Verify the generated data has instancePill nodes in the textmaps where plain paragraphs used to be.

- [ ] **Step 5: Commit**

```bash
git add server/utils/docBuilders.js server/utils/createDefaultUserData.js
git commit -m "feat: wrap example data text content in textblock instances"
```

---

### Task 5: Polish — hover cursor and visual feedback

Ensure all text-editable areas show `cursor: text` on hover, and textblocks have subtle visual feedback when hovered/focused.

**Files:**
- Modify: `client/src/index.css`

- [ ] **Step 1: Add CSS rules for textblock hover and focus states**

```css
/* Textblock instance pills — cursor and hover */
.doc-instance-block {
  cursor: text;
  transition: border-color 0.15s, background 0.15s;
}

.doc-instance-block:hover {
  border-color: rgba(134, 239, 172, 0.20);
  background: rgba(134, 239, 172, 0.06);
}

.doc-instance-block:focus-within {
  border-color: rgba(134, 239, 172, 0.30);
  background: rgba(134, 239, 172, 0.08);
}

/* Doc container areas — text cursor */
.container-doc {
  cursor: text;
}

/* Doc editor wrapper — text cursor on padding areas */
.doc-editor-wrapper {
  cursor: text;
}

/* Instance textblock sub-editors — remove min-height to keep compact */
.doc-instance-block .doc-editor-wrapper {
  min-height: 0;
}

.doc-instance-block .doc-editor-wrapper .ProseMirror {
  min-height: 0;
  padding: 2px 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "style: text cursor and hover states for textblocks and doc areas"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Fix cursor placement (click → cursor at position) | Editor.jsx, DocContent.jsx, ModuleInstance.jsx, index.css |
| 2 | Editable textblocks with Shift+Enter exit | InstancePillNode.jsx, DocContent.jsx, Editor.jsx |
| 3 | Auto-create textblock on typing in empty paragraph | Editor.jsx, DocContent.jsx |
| 4 | Update example data to use textblocks | docBuilders.js, createDefaultUserData.js |
| 5 | Polish hover cursor and visual states | index.css |
