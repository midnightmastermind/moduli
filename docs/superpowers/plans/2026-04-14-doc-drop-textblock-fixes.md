# Doc Drop & Textblock Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four doc editor bugs: (1) drop position snapping so module embeds land at the correct block boundary instead of inside/adjacent to the wrong node, (2) blank textblock appearing on drops, (3) backspace on empty instanceTextblock inserts an intermediate empty paragraph instead of jumping straight to the previous element, (4) Shift+Enter on empty instanceTextblock does the same.

**Architecture:** Drops of block nodes (moduleEmbed) need their insert position snapped to a top-level block boundary (before/after a block based on cursor Y vs block midpoint) — currently `posAtCoords` returns the inline offset inside a paragraph or inside an atom, producing wrong placements. The backspace/Shift+Enter changes are isolated to `InstanceTextblockNode.jsx` and one branch in `Editor.jsx`.

**Tech Stack:** TipTap v3 / ProseMirror, React, `@atlaskit/pragmatic-drag-and-drop`

---

## File Map

| File | Change |
|------|--------|
| `client/src/ui/Editor.jsx` | Modify `resolveInsertPos` (add `isBlock` param + snapping logic); update drop `onDrop` to pass `isBlock`; modify `Shift+Enter` handler in sub-editor mode |
| `client/src/docs/pills/InstanceTextblockNode.jsx` | Modify `handleNavigateBack` to replace textblock with empty paragraph instead of navigating away |

---

### Task 1: Fix block-embed drop position snapping

**Problem:** `resolveInsertPos` calls `editor.view.posAtCoords(...)` which returns an inline position (inside a paragraph's content, or adjacent to an atom). When `insertContentAt(inlinePos, moduleEmbedNode)` is called, TipTap places the block at an unexpected position — often above the intended target, sometimes inside a textblock.

**Fix:** When inserting a block node, snap the raw `posAtCoords` result to a top-level block boundary. Use the DOM bounding rect of the enclosing top-level block to decide before (upper half) vs after (lower half).

**Files:**
- Modify: `client/src/ui/Editor.jsx` — `resolveInsertPos` (~line 666), drop `onDrop` handler (~line 714)

- [ ] **Step 1: Read the current `resolveInsertPos` and `onDrop` handler to confirm line numbers**

```
Read client/src/ui/Editor.jsx lines 665–760
```

- [ ] **Step 2: Replace `resolveInsertPos` with a block-aware version**

Replace the existing `resolveInsertPos` useCallback (starting at ~line 666) with:

```javascript
const resolveInsertPos = useCallback((nativeEvent, isBlock = false) => {
  if (!editor?.view || !nativeEvent) return null;
  const { clientX, clientY } = nativeEvent;
  if (clientX == null || clientY == null) return null;
  const result = editor.view.posAtCoords({ left: clientX, top: clientY });
  if (!result) return null;

  const rawPos = result.pos;
  if (!isBlock) return rawPos; // inline nodes: use raw position as-is

  // Block nodes: snap to the boundary before/after the enclosing top-level block.
  // posAtCoords returns an inline offset inside the nearest block — we want
  // the gap between top-level blocks so insertContentAt places the embed correctly.
  const $pos = editor.state.doc.resolve(rawPos);
  if ($pos.depth === 0) return rawPos;

  const blockStart = $pos.before(1); // position of the gap before the top-level block
  const blockEnd = $pos.after(1);   // position of the gap after the top-level block

  // Use the DOM rect to decide: upper half → insert before, lower half → insert after
  const domNode = editor.view.nodeDOM(blockStart);
  if (domNode) {
    const rect = domNode.getBoundingClientRect();
    const mid = (rect.top + rect.bottom) / 2;
    return clientY < mid ? blockStart : blockEnd;
  }
  return blockEnd; // safe fallback: insert after
}, [editor]);
```

- [ ] **Step 3: Update the `onDrop` handler to pass `isBlock` to `resolveInsertPos`**

In the `onDrop` callback, change the single `resolveInsertPos` call to two variants:

```javascript
// Before (around line 721):
const insertPos = resolveInsertPos(dropInput || lastNativeEvent);

// After — field drops use inline position; all others (embeds) use block-snapped position:
const isBlockDrop = type !== "field";
const insertPos = resolveInsertPos(dropInput || lastNativeEvent, isBlockDrop);
```

- [ ] **Step 4: Remove the block-check trailing space guard from `insertAtPos` (it's now correct by default)**

The existing `insertAtPos` already skips trailing space for block nodes. Verify no changes needed there — the guard at line ~688 (`if (!isBlock) chain.insertContentAt(pos + 1, " ")`) is still correct. No edit needed.

- [ ] **Step 5: Test drop placement**

Open the app (`npm run dev` is already running). Open a doc container. Drag an instance or container into the doc:
- Drop in upper half of a paragraph → embed appears BEFORE that paragraph
- Drop in lower half of a paragraph → embed appears AFTER that paragraph
- Drop on an `instanceTextblock` → embed appears before/after that block (not inside it)
- No blank textblock appears alongside the embed

- [ ] **Step 6: Commit**

```bash
git add client/src/ui/Editor.jsx
git commit -m "fix: snap moduleEmbed drops to top-level block boundary in doc editor"
```

---

### Task 2: Fix Shift+Enter on empty instanceTextblock → intermediate empty line

**Problem:** `Shift+Enter` inside a sub-editor (instanceTextblock's DocContent) currently calls `onExitBlockRef.current()` (from `Editor.jsx` line ~348), which moves the outer cursor to the NEXT block. The user wants: if the textblock is empty, Shift+Enter should delete the textblock and leave an empty paragraph with cursor there (same "intermediate step" as the planned backspace fix).

**Files:**
- Modify: `client/src/ui/Editor.jsx` — `handleDOMEvents.keydown` (~line 344)

- [ ] **Step 1: Read the existing `handleDOMEvents.keydown` handler to confirm exact lines**

```
Read client/src/ui/Editor.jsx lines 340–360
```

- [ ] **Step 2: Change the Shift+Enter handler to detect empty sub-editor**

Replace the current Shift+Enter block:

```javascript
// CURRENT (~line 348):
if (event.key === "Enter" && event.shiftKey && onExitBlockRef.current) {
  event.preventDefault();
  onExitBlockRef.current();
  return true;
}
```

With:

```javascript
// NEW:
if (event.key === "Enter" && event.shiftKey) {
  // Empty sub-editor: Shift+Enter → replace textblock with empty paragraph (same as backspace)
  if (onDeleteBlockRef.current) {
    const docIsEmpty = _view.state.doc.textContent.length === 0;
    if (docIsEmpty) {
      event.preventDefault();
      onDeleteBlockRef.current(true); // triggers the "intermediate empty line" behavior
      return true;
    }
  }
  // Non-empty sub-editor: Shift+Enter → exit to next block (original behavior)
  if (onExitBlockRef.current) {
    event.preventDefault();
    onExitBlockRef.current();
    return true;
  }
  return false;
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/Editor.jsx
git commit -m "fix: Shift+Enter on empty textblock creates intermediate empty paragraph"
```

---

### Task 3: Fix backspace on empty instanceTextblock → intermediate empty line

**Problem:** `handleNavigateBack(deleteIfEmpty=true)` in `InstanceTextblockNode.jsx` immediately calls `handleDeleteBlock()`, which removes the TipTap node and calls `CommitHelpers.removeOccurrence`. The outer cursor jumps directly to the previous element with no intermediate step.

**Desired:** Backspace on empty textblock → remove the instanceTextblock node, insert an empty `paragraph` at that position, focus cursor there. The occurrence IS still deleted. User can then backspace again from the empty paragraph using normal TipTap behavior.

**Files:**
- Modify: `client/src/docs/pills/InstanceTextblockNode.jsx` — `handleNavigateBack` (~line 72)

- [ ] **Step 1: Read `handleNavigateBack` to confirm exact implementation**

```
Read client/src/docs/pills/InstanceTextblockNode.jsx lines 72–107
```

- [ ] **Step 2: Modify `handleNavigateBack` to insert an intermediate empty paragraph**

Replace the `if (deleteIfEmpty)` branch:

```javascript
// CURRENT:
const handleNavigateBack = useCallback((deleteIfEmpty = false) => {
  if (!editor || !getPos) return;

  if (deleteIfEmpty) {
    handleDeleteBlock();
    return;
  }
  // ...rest unchanged
```

With:

```javascript
const handleNavigateBack = useCallback((deleteIfEmpty = false) => {
  if (!editor || !getPos) return;

  if (deleteIfEmpty) {
    // Replace the textblock with an empty paragraph and place cursor inside it.
    // This gives the user an intermediate "empty line" step before navigating further.
    const pos = getPos();
    const nodeSize = node.nodeSize;
    editor.chain().focus()
      .deleteRange({ from: pos, to: pos + nodeSize })
      .insertContentAt(pos, { type: "paragraph" })
      .setTextSelection(pos + 1)
      .run();
    // Clean up the occurrence
    if (occurrenceId && dispatch && socket) {
      CommitHelpers.removeOccurrence({ dispatch, socket, occurrenceId, emit: true });
    }
    return;
  }
  // ...rest of function unchanged (navigate to prev sibling)
```

- [ ] **Step 3: Test backspace behavior**

1. Create an instanceTextblock in a doc (type in a paragraph to auto-create it)
2. Delete all content inside the textblock → sub-editor is empty
3. Press Backspace → textblock disappears, cursor is on a new empty paragraph line
4. Press Backspace again → empty paragraph merges with previous block (normal TipTap behavior)
5. Verify the occurrence is removed from the server (it should no longer appear in the grid after refresh)

- [ ] **Step 4: Commit**

```bash
git add client/src/docs/pills/InstanceTextblockNode.jsx
git commit -m "fix: backspace on empty textblock inserts intermediate empty paragraph"
```

---

## Self-Review

**Spec coverage:**
- ✅ Drop placement wrong (above target / inside textblock) → Task 1 snaps to block boundary
- ✅ Blank textblock on drop → Fixed by Task 1 (correct boundary position prevents spurious empty node creation by TipTap)
- ✅ Drop inside textblock should embed outside → Fixed by Task 1 (atom node at drop point: `nodeDOM` gives the block rect, snap goes before/after)
- ✅ Pill inside textblock on drop → Fixed by Task 1 (block-snapped pos is never inside an atom)
- ✅ Backspace on empty textblock → intermediate empty line → Task 3
- ✅ Shift+Enter on empty textblock → intermediate empty line → Task 2

**Placeholder scan:** No TBDs or placeholders — all code blocks are complete.

**Type consistency:**
- `resolveInsertPos(nativeEvent, isBlock?)` — `isBlock` defaults to `false`, non-breaking
- `onDeleteBlockRef.current(true)` — matches existing call signature `onDeleteBlock(deleteIfEmpty: boolean)` in `handleNavigateBack`
- `editor.chain().deleteRange().insertContentAt().setTextSelection().run()` — standard TipTap v3 chain API

**Edge cases considered:**
- Drop at doc level (`$pos.depth === 0`): returns rawPos directly (shouldn't happen in practice)
- `nodeDOM` returns null (e.g., node not yet rendered): falls back to `blockEnd` (insert after)
- Non-empty textblock + Shift+Enter: hits the `if (onExitBlockRef.current)` branch — original exit behavior preserved
- ArrowLeft/ArrowUp at start of empty textblock: still calls `onDeleteBlockRef.current(false)` (navigate back without deletion) — unchanged
