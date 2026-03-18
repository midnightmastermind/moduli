# The Pragmatic Programmer — Project Philosophy

> Reference for every Claude session. Check this before writing code.

> Based on "The Pragmatic Programmer" by David Thomas & Andrew Hunt.

## The Core Rules (Non-Negotiable)

### 1. DRY — Don't Repeat Yourself

Every piece of knowledge must have a single, authoritative, unambiguous representation.

- One source of truth for state: `state.modules` → derived arrays are *caches*
- One place that talks to the socket: `CommitHelpers.js`
- One place for aggregation logic: `CalculationHelpers.js`
- If you write the same logic twice, one copy will go stale. That's a bug waiting to happen.

**How to catch violations**: If changing one thing requires changing another thing in a different file, those two things are duplicates of the same knowledge.

### 2. Orthogonality — Keep Modules Independent

A change in one module should NOT require changes in another.

- `DragProvider` should not know about `ContextMenu`
- `CommitHelpers` should not know about `CalculationHelpers`
- Reducers should not know about socket events
- UI components should not call `socket.emit` directly

**Test**: Can you change the internals of X without touching Y? If not, they're too coupled.

### 3. ETC — Easier to Change

Design for changeability. The "best" design is whichever is easiest to modify later.

- Prefer flat data structures over nested (easier to update by ID)
- Prefer small focused functions over monolithic ones
- Prefer explicit over clever — the cleverer the code, the harder to change

**Ask before writing**: "If requirements change tomorrow, how hard is this to modify?"

### 4. No Backward Compatibility (for non-live data)

**This is a core project rule, not a general principle.**

The data is not live in production. There are no users to break. Backward compatibility is technical debt for zero benefit.

- When changing a schema, change it completely. Delete the old fields.
- When unifying two concepts (Panel + Container + Instance → Module), remove the old paths.
- When a naming convention changes, update ALL call sites.
- Backward compat code = two things doing the same job = DRY violation = rot

**When you see a legacy fallback**: Delete it. It's a broken window.

### 5. Don't Live with Broken Windows

A broken window left unrepaired signals that no one cares. More windows get broken. The building decays.

In code: a hack left in place signals that hacks are acceptable. More hacks appear. The codebase rots.

- If you see an inconsistency while working on something else: fix it now, not later
- If a legacy path exists alongside a new path: delete the legacy path
- If a comment says "TODO: clean this up": clean it up, or delete the comment

**Examples of broken windows in this project:**

- `state.containers` updated independently from `state.modules` → now fixed
- `updatePanel` emitting `"update_panel"` when server only handles `"update_module"` → now fixed
- `targetType: "panel"` in Occurrence schema when only `"module"` is used → now fixed

### 6. Tracer Bullets — Build End-to-End First

Build a thin slice that works end-to-end before polishing.

- Wire Panel → Context → Socket → Reducer → Selector → UI before adding polish
- A feature isn't "done" until data flows both ways (client → server → back to client)
- Don't build a perfect UI for a socket event that doesn't exist yet

**Test**: Can you run `resetData` and see the feature work? If not, it's not done.

### 7. Don't Outrun Your Headlights

Only implement what you can test right now.

- Don't spec Phase 9 while Phase 6 is incomplete
- Don't add configuration options for scenarios that don't exist yet
- Don't add error handling for errors that can't happen
- Don't add "just in case" fallbacks for code paths that will never be hit

### 8. The Boyscout Rule — Leave It Cleaner

Always leave code cleaner than you found it.

- If you touch a file, fix the obvious problems nearby
- Update the folder's `CLAUDE.md` when you change files
- Remove dead code when you see it
- Rename misleading variables when you touch them

### 9. Power of Plain Text

Data in portable, readable formats.

- State is plain JS objects (no opaque class instances)
- Field values stored as `{ value, flow }` — readable, debuggable
- Socket events use named fields (not positional arrays)
- Operations stored as JSON block trees (inspectable, editable)

### 10. Fail Fast

Don't hide errors. Surface them early.

- Guard at the top of functions (`if (!id) return;`) rather than letting null propagate
- Schema validation on write (Mongoose required/enum) — not on read
