# Undo/redo repair — the snapshot layer is sound, the STACK is not

_2026-08-01. Continues the rebuild recorded in CLAUDE.md 2026-08-01 (20) and the two
follow-up commits `a14fff58` / `f4eb222c`._

## What this is

The 2026-08-01 rebuild replaced inverse-ops with before/after document **snapshots**. That
decision is right and the capture layer works — snapshots persist, textmaps round-trip
compressed, `minimize: false` keeps empty objects. **The defects below are all in the layer
above it: which transaction Ctrl+Z targets, what counts as a step, and what order redo
replays in.** None of them require revisiting the snapshot design.

Everything in "Findings" was measured against the live `poms grid` transaction log, not
inferred from code.

---

## Findings

### A — Ctrl+Z undoes an OLD transaction, not the last one  ⛔ critical

`useUndoRedo` caches `lastUndoableId` from the server's `undo_state` and always sends it
explicitly (`useUndoRedo.js:100-105` → `undoTransaction({ transactionId: lastUndoableId })`).
The server honours an explicit id verbatim (`transactions.js:102-104`) — its `nextUndoable()`
stack resolution is only reached when `transactionId` is absent, which the keyboard path never
does.

`refreshUndoState` runs on exactly four things (`useUndoRedo.js:78-97`): mount, `gridId` change,
`undo_result`/`redo_result`, and `sync_state`. **A new `transaction_created` refreshes
nothing.** So after N edits, `lastUndoableId` still points at whatever was newest when the
component last synced.

Consequence: Ctrl+Z restores a document to a state several edits back and marks *that* old
transaction undone, while every newer transaction stays `applied`. Intermediate work is
discarded with no record. It also explains "Ctrl+Z does nothing": right after the first-ever
edit `canUndo` is still `false`, so `undo()` returns early.

### B — one keystroke = four undo steps, each with its own action id

Measured, `poms grid`, a single Enter in the Notes doc at 17:52:22:

```
seq  actionId  target              changed
 91  097cae…   Notes (container)   updatedAt                 ← no-op
 90  bed900…   Notes (container)   updatedAt, textmap
 89  ce74ca…   textblock           <CREATE>
 88  a6e313…   textblock           <DELETE>
```

Four distinct `actionId`s. The grouping mechanism exists but only ever engages for **drops** —
`beginDropBatch`/`endDropBatch` (`bindSocketToStore.js:1586-1596`) is the one place that holds
an action open across an async cascade. Everywhere else `withAction` closes synchronously in
its `finally` (`actionScope.js:77-84`), so sequential `CommitHelpers` calls from one gesture
each mint a fresh id.

This is worse than "too many presses": the four writes are one logical change, so undoing any
one of them alone leaves the doc structurally inconsistent (parent textmap reverted while the
textblock occurrence still exists, or vice versa).

### C — no-op writes are recorded as undo steps

`flushAction` drops a doc only when `JSON.stringify(before) === JSON.stringify(after)`
(`txRecorder.js:165-169`). `updatedAt` changes on every write, so nothing is ever dropped.
**Four of the last fourteen recorded docs changed `updatedAt` and nothing else** (seq 91, 87,
85, 81). Ctrl+Z on one of those is visibly nothing happening.

### D — redo replays in the wrong order

`nextRedoable` sorts `{ sequence: -1 }` (`transactions.js:91-94`) — the *highest* undone
sequence. Undo walks the stack high→low, so redo must walk the undone set low→high. Undo twice
then redo and it re-applies the older transaction's `after` snapshot first, on top of state
where the newer one is still reverted.

### E — the redo branch is never truncated

Nothing retires `undone` transactions when a new write lands. Undo, then make a fresh edit, then
Ctrl+Y: it re-applies a stale `after` snapshot straight over the newer work. Silent loss.

### F — a transaction isn't durable until 1.5 s after the write, and never on disconnect

`flushAction` has **zero call sites** and `flushAll` — whose own docstring says "socket
disconnect / shutdown" (`txRecorder.js:200-203`) — is wired nowhere. The `IDLE_FLUSH_MS = 1500`
timer is the only flush path. So an undo within 1.5 s of the edit targets the previous
transaction, and a reload inside that window loses the record entirely (the write persists,
unundoable).

### G — client action labels are thrown away

`safeEmit` stamps `__actionLabel` on every write (`offlineQueue.js:46-48`), but neither
`recordChange` in `crud.js:33-44` nor the `occurrences.js:210` call reads it. Descriptions fall
back to server-side strings or `describeDocs`, so the history panel reads "Updated occurrence"
for everything.

### J — after you click off a textblock, Ctrl+Z hits the WRONG editor's history  ⛔ critical

User repro, 2026-08-01: *"that works if im already in the textblock but when i type something,
click off the textblock, and control z, it wont undo the typing."*

That splits the two undo systems cleanly. **In-editor Ctrl+Z never reaches our code at all** —
it is ProseMirror's own local history, and `useKeyboardShortcuts.js:45` returns on
`e.defaultPrevented`. Once you click off, the app stack is supposed to take over. It doesn't,
for two independent reasons:

**J1 — the "editor wins" heuristic is scoped to the FOCUSED editor, not the one holding your
typing.** Every `<Editor>` is its own ProseMirror instance with its own history: the doc page
mounts one, and each nested textblock mounts another via
`InstanceTextblockNode` → `DocContent` → `<Editor>` (a `NodeViewWrapper` inside the parent's
doc). Click off a textblock while staying on the page and focus moves to the **parent** editor.
Mod-Z now consults the parent's history — which has nothing to do with the text you just typed.

**J2 — the parent's history is not empty even if you never edited it.** The content-sync effect
calls `editor.commands.setContent(content, { emitUpdate: false })` (`Editor.jsx:1309`) with no
`addToHistory: false` meta, so **every server echo and every `full_state` sync pushes an entry
onto that editor's local undo history.** The same file already uses
`tr.setMeta("addToHistory", false)` for its migration transaction (`Editor.jsx:497`), so the
escape hatch exists and simply was not applied to the sync path.

Together: the parent editor consumes Mod-Z, ProseMirror calls `preventDefault`,
`useKeyboardShortcuts` returns, and app-level undo never runs. What actually got undone is the
parent's textmap reverting to a previously-synced state — which the debounce then persists.
That is a data regression, not just a dead shortcut.

And when focus lands on the page background instead of an editor, you fall through to app undo
— which is Finding A, so the typing still isn't undone. **Both paths reproduce the user's
symptom, so fixing A alone will not fix it.**

Related, same root: after an app-level undo the editor's local ProseMirror history still holds
the newer states. Refocus and Ctrl+Shift+Z can redo to content the app stack believes is
reverted. The forced-sync path (`editorSyncSignal`) should clear local history, not just push
content.

### H — post-undo op sweep can re-apply what was undone  ⚠ not reproduced

`applySnapshots` writes past the socket handlers, then broadcasts `sync_state`; the client
answers with `request_full_state`, which re-runs the onLoad op sweep. Any idempotent builder
(`Day Page: Build`, `Schedule: Build Schedule`) would re-create an undone occurrence. Those
writes are `derived` so they don't pollute the stack — but they'd undo the undo. **This is a
hypothesis from reading the flow; it has not been reproduced and must be tested before any fix
is written for it.**

### I — dead transactions accumulate

`pruneLater` only runs after a successful flush for that `(user, grid)`. Grids that stopped
being written never prune: one carries **6256** doc-less legacy transactions, `poms grid` 1070.

---

## Pass 1 — stack correctness  ✅ BUILT 2026-08-01 (items 1-7; 8 deferred, see below)

Each task is independently verifiable. Order matters: 1 before 2.

**1. Ctrl+Z targets the top of the stack.**
Stop sending a cached id from the keyboard path — `undo()`/`redo()` emit with no
`transactionId` and let the server resolve `nextUndoable`/`nextRedoable`. Keep the explicit-id
path for the history panel only. Additionally refresh `undo_state` on `transaction_created` so
`canUndo` is honest (otherwise the button and the shortcut disagree).

**2. Drop no-op steps.** In `flushAction`'s change filter, compare snapshots with volatile
bookkeeping keys excluded (`updatedAt`, `__v`, and anything else the server stamps
unconditionally). A doc whose only difference is a timestamp is not an undo step. Snapshots
still *store* `updatedAt` — this only affects whether the doc counts as a change.

**3. Redo order.** `nextRedoable` sorts `{ sequence: 1 }`.

**4. Truncate the redo branch.** When a transaction flushes, mark every `undone` transaction
for that `(user, grid)` dead so it can never be redone over newer work. Recommend a terminal
state (`superseded`) rather than deleting the rows — the history panel should still show them.

**5. Flush on close.** Call `flushAll()` from the socket `disconnect` handler and on shutdown,
and add an explicit `close_action` the client emits when `endAction` drops to depth 0, so the
common case doesn't wait out the idle timer.

**6. A remote sync is not a local edit.** `setContent` in the content-sync effect
(`Editor.jsx:1309`) dispatches with `addToHistory: false`. This is the J2 fix and stands on its
own merit — it also closes the "undo reverts the doc to an older synced state, then the debounce
persists it" data regression.

**7. Scope the "editor wins" heuristic.** With 6 in place, an editor the user never typed in has
a genuinely empty history and correctly declines Mod-Z, so `defaultPrevented` becomes an honest
signal again and the blurred case falls through to app undo. Verify that is sufficient before
adding anything cleverer — the fix may be entirely 6.

**8. Clear local editor history on a forced sync.** ⏸ **DEFERRED to pass 2.** After an
app-level undo, `editorSyncSignal`'s forced path should reset the editor's ProseMirror history
alongside the content, so an in-editor undo/redo cannot act on content the app stack has already
reverted. Item 6 shrinks this a lot — the sync no longer *adds* history, and ProseMirror's redo
stack only fills from ProseMirror undos — so what remains is the narrow case of refocusing an
editor after an app-level undo and pressing Ctrl+Z, where PM rebases its own stored inverse
steps against a doc that no longer contains them. Not shipped because TipTap v3 exposes no
supported "reset history" command: the routes are `editor.unregisterPlugin("undoRedo")` +
re-registering the plugin, or importing `prosemirror-history` directly (a transitive dep).
Neither is worth shipping unverified inside a correctness pass.

**Verification for pass 1** — against a real database, diffing state before/after, per the
lesson already recorded in CLAUDE.md (in-memory tests missed `minimize` last time). On **test
grid 2**, never poms grid:
- Make 5 distinct edits, then Ctrl+Z five times → the five newest transactions go `undone` in
  reverse order and the document returns byte-identical to the pre-edit snapshot.
- A save that changes only `updatedAt` produces no transaction at all.
- Undo ×2 → redo ×2 → state matches pre-undo byte for byte.
- Undo, then a new edit, then Ctrl+Y → nothing is re-applied.
- Kill the socket 200 ms after an edit → the transaction still exists and is undoable.
**Result, 2026-08-01** — run against real Mongo on **test grid 2**, scratch occurrence + its
transactions removed afterwards (verified: test grid 2 back to 0 transactions, both protected
grids untouched at 0 superseded). All twelve checks passed, driving the REAL socket handlers:
3 edits → 3 ascending sequences · an `updatedAt`-only write records nothing · undo ×3 reverts
`2,1,0` and marks all three undone · redo ×3 replays `1,2,3` (descending sort would have given
`3,2,1`) · undo then a new edit marks the undone one `superseded` and the subsequent redo is
refused with "Nothing to redo", new edit intact. 1504 client + 371 server tests, build clean
with the documented chunk sanity check holding (tiptap 435 / highlight 969 / CommandCenter 203
/ PagePreviewApp 919).

**STILL UNVERIFIED — needs you, in a real browser:**
- **The user's repro** (jsdom cannot arbitrate ProseMirror focus + keymaps):
  type in a textblock, click off it onto the parent doc, Ctrl+Z → the typing is reverted and the
  parent's textmap is untouched. Then Ctrl+Z again → the step before it. Repeat with the click
  landing on the page background instead of the parent editor; both must behave identically.

---

## Pass 2 — grouping and labels

**6. One editing burst = one undo step** (user's call, 2026-08-01). Consecutive writes to the
same occurrence from the same editor coalesce until the user pauses (~1 s idle) or the target
changes. The buffer already collapses repeated writes to one doc correctly (first `before` +
latest `after`), so the work is on the client: hold the action open across the editing burst
instead of closing it per `CommitHelpers` call.

**7. Structural gestures get one enclosing scope.** The Enter-in-a-doc case (B) must open one
action around the delete + create + parent-textmap writes, the way `beginDropBatch` already
does for drops. Audit the other multi-write gestures (quick-add, InsertGap, paste, wrap/unwrap)
for the same gap.

**8. Reconsider `MAX_ACTION_MS = 4000`.** It is a backstop against a leaked scope, but it also
force-closes a legitimately long cascade mid-drain — the tail writes then land as `derived` and
fall out of the undo step, and any write from a *different* gesture inside those 4 s gets
swallowed into the open one. Needs a real decision, not a bigger number.

**9. Carry `__actionLabel` through to `description`.** The client already sends it.

**10. Prune dead grids' transactions.** A one-shot sweep for the doc-less legacy rows, plus a
retention pass that isn't gated on that grid still being written to.

---

## Not in scope

- The snapshot format, `minimize: false`, or textmap compression — verified working.
- Finding H, until it is reproduced.
- Deploy. Undo/redo records a transaction on every write to live data; when to turn it on is
  the user's call, same as it was at the end of the 2026-08-01 session.
