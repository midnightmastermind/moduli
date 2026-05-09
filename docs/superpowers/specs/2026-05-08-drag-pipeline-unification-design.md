# Drag Pipeline Unification + targetId→moduleId Rename — Design

_Date: 2026-05-08_

## 1. Problem

Two drag systems coexist in `client/src/helpers/`:

- **DragProvider.jsx** — React state coordinator + `monitorForElements` drop handler.
- **dragSystem.js** — `useDraggable` / `useDragDrop` / `useDroppable` hooks (Pragmatic DnD + a mobile touch fallback in each hook).

Both compute the same things in different places: hit-test walks, closest-edge math, drag-mode resolution, insert-position calculation. They funnel into `dropHandlers.js` but pass partial information — `dropTarget.context` carries different fields depending on which Pragmatic drop-target won the inner-most race.

A 100ms time-window dedup at `DragProvider.jsx:795-802` is the smell: it exists because both `monitorForElements` and per-element `dropTargetForElements` fire on the same drop and have to be reconciled after the fact.

### The user-visible bug

Dragging an instance and hovering over **another instance** in the same container does not produce a reorder. Dragging into an empty container, onto a panel, onto a grid cell — all work.

Trace:
- The instance's `dropTargetForElements` (dragSystem.js:1003-1047) fires `onDrop` with `context: { ...context, instanceId: id, closestEdge: edge }`. **`containerId` is only present if it was already in the parent `context` passed when the hook was registered.**
- `DragProvider.handleDrop` (DragProvider.jsx:786-793) reconciles: `containerId = dropTarget.context?.containerId || getHoveredContainerId()`.
- When the container's drop target wins the Pragmatic precedence (cursor lands in a gap, or container's drop zone is geometrically larger), `dropTarget.context.instanceId` is missing.
- `handleInstanceDrop` (dropHandlers.js:425) then takes the `else if (instanceId && toCOcc)` branch as false, falls through with `toIndex = null`, and the same-container path at line 502 silently returns: `if (toIndex === null) { clearSession(); return; }`.

The bug is not a one-line oversight — it's a symptom of "context is partially populated depending on which path wins."

### Additional code rot in scope

- **`nativeDnd.js`** — 43 lines, zero imports anywhere. Dead file.
- **`useDraggable` vs `useDragDrop`** — separate hooks in dragSystem.js with heavily duplicated mobile-touch handlers (~400 LOC parallel). One hook with a mode flag suffices.
- **`monitorForElements` in DragProvider** — duplicates per-element `dropTargetForElements` work. Stays commented out as a precision fallback (per user direction); no live duplicated code path.
- **`targetId` field on Occurrence** — used interchangeably with "moduleId" everywhere in the drag/runtime code. 474 occurrences across 64 files. The persistence-layer name leaks into runtime contracts.
- **`targetType` field on Occurrence** — redundant with `modulesById[occ.moduleId].role`. Inconsistent values in `LayoutHelpers.js` (`"module"` vs `"panel"`/`"instance"`/`"container"`).

## 2. Goal

One drag pipeline. One drop-context shape. One place where role-specific routing happens. Pure functions where possible. The drag/runtime code uses `moduleId`; `targetId` is gone from the codebase.

Pragmatic Programmer principles applied:

- **DRY** — a single `buildDropContext` is the only place hit-test + edge-math runs.
- **Orthogonality** — input adapters (Pragmatic, touch, TipTap) know nothing about the target model; routing knows nothing about input mechanics.
- **Contracts** — each module has a documented input/output shape, written in the source file's header.
- **Plain text** — `DropContext` is a flat object you can `console.log` and understand entirely.
- **Don't live with broken windows** — `nativeDnd.js`, the mobile-handler duplication, and `targetId` get fixed in this work, not deferred.
- **Tracer Bullets** — Phase 1 ships an end-to-end thin slice (drag pipeline only) before Phase 2's broad rename.
- **ETC** — the `DropContext` shape is the variation point. Adding a new drop type means adding a `kind` value and a router branch; the rest of the pipeline is untouched.

## 3. Architecture

```
                ┌────────────────────────────────────────┐
                │       INPUT ADAPTERS (thin)            │
                │                                        │
   Pragmatic ──►│  pragmaticAdapter   ──┐                │
   Mobile  ───►│  touchAdapter       ──┼──► RawDropEvent │
   TipTap  ───►│  tiptapAdapter      ──┘                 │
                └────────────────────────────────────────┘
                              │
                              ▼
              ┌──────────────────────────────────┐
              │  dragHitTesting.js (PURE)        │
              │  buildDropContext(rawEvent, env) │
              │  → DropContext | null            │
              └──────────────────────────────────┘
                              │
                              ▼
              ┌──────────────────────────────────┐
              │  dropHandlers.js                 │
              │  routeDrop(dropContext, ctx)     │
              │  → handleInstanceDrop / etc.     │
              └──────────────────────────────────┘
                              │
                              ▼
                       LayoutHelpers (commit)
                              │
                              ▼
                CommitHelpers → socket → server
```

Two new modules:

### `dragHitTesting.js` (NEW, pure, no React)

```js
export function buildDropContext(rawEvent, env) → DropContext | null
export function walkHoveredOccurrence(x, y, env) → { occurrenceId, parentOccurrenceId } | null
export function resolveEdgeToIndex(edge, hoveredIndex, fromIndex)
export function resolveDragMode(modifiers, payloadDefault) → "move" | "copy" | "copylink"
```

`env = { occurrencesById, modulesById, baseContainers }`. Functions are pure: same inputs, same outputs. Unit-testable without DOM mocks (modulo `walkHoveredOccurrence` which uses `elementsFromPoint` — that one takes a stub-able DOM port).

### Adapter additions inside `dragSystem.js`

The existing `useDraggable` / `useDragDrop` hooks become thin shells that produce `RawDropEvent` and delegate. `RawDropEvent`:

```
{
  source: { occurrenceId, moduleId, sourceKind, payload },
  hover: { x, y, dropTargetData },     // dropTargetData = Pragmatic's self.data, or touch-walk result
  modifiers: { shift, alt, ctrl, meta },
  phase: "start" | "move" | "drop" | "end",
}
```

Mobile and desktop produce the same shape. The `if (_isMobile()) { ... }` branches collapse: a single shared touch driver lives next to the hook and produces RawDropEvents identical to Pragmatic's.

### `dropHandlers.js` signatures change

From `handleInstanceDrop(ctx, drop)` to `handleInstanceDrop(dropContext, ctx)`. The `drop` shape is gone; everything the handler needs is on `dropContext`.

## 4. The DropContext data contract

```
DropContext {
  payload: {
    occurrenceId,          // null when source is outside the grid (CC, file, OS)
    moduleId,              // null for files / external / fields / operations
    sourceKind,            // "in-grid" | "command-center" | "doc-embed"
                           // | "file" | "external" | "field" | "operation"
                           // | "tree-anchor" | "tree-page" | "canvas" | "pool"
  },
  target: {
    occurrenceId,          // the innermost hovered occurrence
    moduleId,              // = occurrencesById[occurrenceId].moduleId  (post-Phase-2)
    parentOccurrenceId,    // immediate parent in the occurrence tree
    kind,                  // "occurrence" | "grid-cell" | "doc-cursor"
    gridCell,              // { row, col } when kind === "grid-cell", else null
    docCursor,             // { editorPos, occurrenceId } when kind === "doc-cursor", else null
  },
  position: {
    edge,                  // "top" | "bottom" | "left" | "right" | null
    insertIndex,           // always a number when target.kind === "occurrence"
  },
  mode,                    // "move" | "copy" | "copylink"
  modifiers,               // { shift, alt, ctrl, meta }
  pointer: { x, y },
}
```

**Two ID-shaped fields, only:** `occurrenceId` and `moduleId`. No `instanceId` / `containerId` / `panelId` anywhere. Routing derives role on demand: `modulesById[target.moduleId].role`.

**`insertIndex` is always set** when `target.kind === "occurrence"`. `buildDropContext` falls back to `parent.occurrences.length` (append-to-end) only when no edge data is available, never to `null`. The "silent return on null" anti-pattern is gone by construction.

**Why this fixes the bug:** the buggy code at `dropHandlers.js:425` checks `if (instanceId && toCOcc)`. After this refactor, the equivalent check is `if (target.kind === "occurrence" && target.parentOccurrenceId)` — and `target.parentOccurrenceId` is filled by `buildDropContext` walking the occurrence tree from the hit-tested `target.occurrenceId`. No reliance on which Pragmatic drop-target happened to populate which field.

## 5. Phasing

### Phase 1 — Drag pipeline unification (this PR)

Files touched:

- **NEW** `client/src/helpers/dragHitTesting.js` — pure functions per Section 3.
- **`client/src/helpers/dragSystem.js`** — collapse `useDraggable` + `useDragDrop` into one hook with a `mode: "draggable" | "dragdrop"` flag; merge mobile/desktop branches behind a shared touch driver; emit `RawDropEvent` to `DragProvider`.
- **`client/src/helpers/DragProvider.jsx`** — replace `handleDrop` body with `buildDropContext` + `routeDrop` calls. Comment out `monitorForElements` block (kept as precision-fallback per user direction). Delete the 100ms dedup `lastDropRef`. Delete `getHoveredPanelId` / `getHoveredContainerId` / `getHoveredInstanceId` / `getHoveredIds` (moved into `dragHitTesting.js` as `walkHoveredOccurrence`).
- **`client/src/helpers/dropHandlers.js`** — change all 13 handler signatures from `(ctx, drop)` to `(dropContext, ctx)`. Inline the per-handler `instanceId`/`containerId`/`toCOcc` reconciliation, replaced by `dropContext.target.*` reads. Add `routeDrop(dropContext, ctx)` as the dispatch entry point.
- **DELETE** `client/src/helpers/nativeDnd.js` (43 lines, zero imports).
- **Bridge line in `dragHitTesting.js`**: `const moduleId = occ.targetId;` — single boundary translation. Removed in Phase 2.

Acceptance:
- Instance-over-instance reorder works (the bug).
- All drag/drop interactions still work: panels into grid cells, containers into panels, instances into containers, doc embeds, file uploads, command-center drags, board kanban moves, copy/copylink modifiers, mobile touch.
- Tests pass: `client/src/__tests__/operationActions.unified.test.js`, `LayoutHelpers.test.js`, plus new tests added per Section 7.
- `monitorForElements` block compiles when uncommented (keep precision fallback viable).

### Phase 2 — `targetId` → `moduleId` rename (separate PR)

Mechanical rename across 64 files / 474 occurrences. Order:

1. **DB migration** (`server/scripts/renameTargetIdToModuleId.js`):
   ```js
   await Occurrence.collection.updateMany({}, { $rename: { targetId: "moduleId" } });
   ```
2. **Schema** — `server/models/Occurrence.js`: rename `targetId` → `moduleId`. Add no virtual alias; we want a clean cut, no compat shim.
3. **Server socket handlers + scripts** — find/replace `targetId` → `moduleId`. Files: `server/socketHandlers/crud.js`, `server/socketHandlers/templates.js`, `server/scripts/*` (15 files).
4. **Client state ingest** — `state/bindSocketToStore.js`, `state/initialState.js`, `state/selectors.js`. The translation that bridge-line did in `dragHitTesting.js` happens nowhere anymore.
5. **Client helpers** — `helpers/CommitHelpers.js`, `helpers/LayoutHelpers.js`, `helpers/CalculationHelpers.js`, `helpers/operationActions.js`, `helpers/operationExecutor.js`, `helpers/labelHelpers.js`, `helpers/dragHitTesting.js` (remove bridge line), `helpers/dropHandlers.js`, `helpers/DragProvider.jsx`.
6. **Client modules + UI** — `modules/*`, `ui/*`, `docs/*`, `blocks/*`, `App.jsx`.
7. **Tests** — every test fixture and assertion. Run full client + server test suites green.

Diff per file is grep-and-replace plus eyeball review for non-occurrence uses (e.g. `targetType: "module"` is unaffected, `event.targetId` in DOM contexts is unaffected — the rename is bounded to `Occurrence.targetId` reads/writes).

Acceptance:
- DB migration runs cleanly on a fresh dump.
- Full test suite green.
- `grep -rn "targetId" client/src server` returns zero hits inside `Occurrence` contexts.

### Phase 3 — `targetType` deprecation (separate PR)

The field is redundant. Steps:

1. Audit every `targetType` read for branches that depend on it being something other than `"module"`. Specifically `LayoutHelpers.js:475` (`"panel"`), `:742` (`"instance"`), `:814` (`"container"`), and `Grid.jsx:356`'s comment about autofill. Each becomes "look up `module.role` instead."
2. Remove writes from `LayoutHelpers.js` and any other site that sets `targetType`.
3. Remove field from `server/models/Occurrence.js`.
4. DB migration: `db.occurrences.updateMany({}, { $unset: { targetType: 1 } })`.
5. Remove all reads. Replace with `modulesById[occ.moduleId]?.role` where role-checks were happening.
6. Update tests.

Acceptance:
- Full suite green.
- `grep -rn "targetType" client server` returns zero hits.

## 6. Bug fix walkthrough — instance-over-instance reorder

Concrete trace under the new pipeline, dragging instance A from index 0 over instance B at index 2 in the same container, edge "top":

1. **Instance B's `useDroppable`** (refactored hook) registers Pragmatic `dropTargetForElements` with `getData: ({ input, element }) => attachClosestEdge({ occurrenceId: B.id, kind: "occurrence" }, { input, element, allowedEdges })`.
2. On drop, hook builds `RawDropEvent { source: A, hover: { x, y, dropTargetData: self.data }, modifiers, phase: "drop" }`.
3. `DragProvider.onDrop(rawEvent)` calls `buildDropContext(rawEvent, env)`.
4. **`buildDropContext`**:
   - Reads `dropTargetData.occurrenceId = B.id` → `target.occurrenceId = B.id`.
   - Looks up `B`'s parent in `occurrencesById` (every occurrence is in some `parent.occurrences[]`; reverse-map cached) → `target.parentOccurrenceId = container.id`.
   - `target.moduleId = occurrencesById[B.id].moduleId`.
   - `target.kind = "occurrence"`.
   - `position.edge = extractClosestEdge(dropTargetData) = "top"`.
   - `hoveredIndex = container.occurrences.indexOf(B.id) = 2`.
   - `fromIndex = container.occurrences.indexOf(A.id) = 0`.
   - `position.insertIndex = resolveEdgeToIndex("top", 2, 0)`. Function: edge top → 2; same container + fromIndex<hoveredIndex → 2 - 1 = 1. Returns 1.
   - `mode = resolveDragMode(modifiers, payload.defaultMode)`.
   - Returns the full `DropContext`.
5. `routeDrop(dropContext, ctx)` looks up `modulesById[target.moduleId].role === "instance"` and `modulesById[payload.moduleId].role === "instance"` → dispatches to `handleInstanceDrop(dropContext, ctx)`.
6. `handleInstanceDrop` reads `target.parentOccurrenceId`, `position.insertIndex = 1`, `mode = "move"` → calls `LayoutHelpers.reorderInstancesInContainer({ containerOccurrence: parent, fromIndex: 0, toIndex: 1, ... })`.
7. Done. Same flow regardless of which Pragmatic drop-target won the precedence: even if the **container's** drop target won, `walkHoveredOccurrence(x, y, env)` falls through `elementsFromPoint` to find the closest `[data-occurrence-id]` ancestor of the cursor, populates `target.occurrenceId = B.id`, and the math runs identically.

## 7. Testing strategy

New file `client/src/__tests__/dragHitTesting.test.js`:

- `buildDropContext` returns `null` when no valid target.
- `buildDropContext` populates `target.parentOccurrenceId` from the occurrence tree.
- `buildDropContext` fills `position.insertIndex` from `closestEdge` for instance-over-instance.
- `buildDropContext` falls back to `append-to-end` when only the container is hit (no edge data).
- `resolveEdgeToIndex("top", 2, 0)` === 1 (same-container forward move).
- `resolveEdgeToIndex("bottom", 2, 0)` === 2 (same-container forward move past target).
- `resolveEdgeToIndex("top", 2, 5)` === 2 (same-container backward move).
- `resolveDragMode({ alt: true }, "move")` === "copy"; `{ shift: true, alt: true }` → "copylink"; default → "move".
- `walkHoveredOccurrence` returns the inner-most `[data-occurrence-id]` ancestor (DOM stub).

Update `client/src/__tests__/operationActions.unified.test.js` and `LayoutHelpers.test.js` for any signature changes touching public surfaces.

Manual regression checklist (the user's "drag works in the other cases" baseline must stay green):

- [ ] Instance into empty container.
- [ ] Instance over another instance — same container (the bug).
- [ ] Instance over another instance — different container.
- [ ] Container into panel.
- [ ] Panel into grid cell.
- [ ] Command-center module → grid cell (drilldown panel creation).
- [ ] Doc embed instance → drag out to board.
- [ ] OS file → grid cell (artifact panel creation).
- [ ] Board column reorder.
- [ ] Mobile touch drag — instance-over-instance.
- [ ] Copy mode (Alt held).
- [ ] Copylink mode (Alt+Shift held).
- [ ] TipTap doc — drag instance pill from doc back to a container (doc-cursor → occurrence routing).

Per the user's CLAUDE.md "Testing workflow" preference: each new test in its own JSON-fixture-friendly form, individually runnable.

## 8. What is NOT in scope

- Server-side undo/redo for the new drop types — the existing transaction system already covers reorder/move via `OccurrenceListOp`; no change needed.
- Performance work — the `dragHitTesting.js` walk uses the same `elementsFromPoint` pattern as today; perf is preserved, not improved.
- TipTap's own drop handling (Editor.jsx's `dropTargetForElements` for moduleEmbed insertion) — it stays self-owned. The unified pipeline detects `target.kind === "doc-cursor"` and dispatches to `handleDocDrop`, which calls into Editor.jsx's existing insertion helper unchanged.
- Multi-window drag (cross-window copy) — `handleCrossWindowDrop` keeps its current implementation, just gets fed `DropContext` instead of `drop`.
- Block-system drag (`blocks/useBlockDnD.jsx`) — out of scope; the visual block editor's drag logic is parallel infra and doesn't share the bug.

## 9. Open questions

None. The user has confirmed:

- Option B (full unification) over Option A (targeted fix).
- Mobile path in scope.
- `monitorForElements` stays in DragProvider commented out as a precision fallback.
- All three phases in this spec.
- Pragmatic Programmer principles as the guiding philosophy.
- Dead code (`nativeDnd.js`, mobile-handler duplication) cleaned up alongside the unification.
- `targetId` → `moduleId` rename happens (Phase 2), no compat alias.
