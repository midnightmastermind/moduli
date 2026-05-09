# Drag Pipeline Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the two drag systems (DragProvider + dragSystem) behind a pure `buildDropContext` pipeline, fix the instance-over-instance reorder bug, rename `Occurrence.targetId` → `moduleId` everywhere, and drop the redundant `targetType` field.

**Architecture:** Input adapters (Pragmatic / touch / TipTap) emit `RawDropEvent`. A pure `dragHitTesting.js` module turns that into a unified `DropContext`. `dropHandlers.routeDrop` dispatches to per-type handlers. Per-type handlers call `LayoutHelpers` to commit. Role is derived from `module.role` — never stored in the drop context.

**Tech Stack:** React, Pragmatic DnD (`@atlaskit/pragmatic-drag-and-drop`), Vitest, Mongoose, Socket.io.

**Spec:** `docs/superpowers/specs/2026-05-08-drag-pipeline-unification-design.md`

---

## File Structure

### Phase 1 — Drag pipeline (this work)
- **NEW** `client/src/helpers/dragHitTesting.js` — pure functions: `resolveEdgeToIndex`, `resolveDragMode`, `walkHoveredOccurrence`, `buildParentMap`, `buildDropContext`.
- **NEW** `client/src/__tests__/dragHitTesting.test.js` — Vitest tests for the pure functions.
- **MOD** `client/src/helpers/dragSystem.js` — emit `RawDropEvent` instead of partial `dropTarget.context`.
- **MOD** `client/src/helpers/DragProvider.jsx` — `handleDrop` calls `buildDropContext` + `routeDrop`. `monitorForElements` block kept commented as a precision fallback.
- **MOD** `client/src/helpers/dropHandlers.js` — handler signatures: `(dropContext, ctx)`. New `routeDrop(dropContext, ctx)` entry point.
- **DELETE** `client/src/helpers/nativeDnd.js`.

### Phase 2 — `targetId` → `moduleId` rename
- **NEW** `server/scripts/renameTargetIdToModuleId.js` — DB migration.
- **MOD** `server/models/Occurrence.js` — schema field rename.
- **MOD** 64 files containing `targetId` (full list discovered via grep at execution time).

### Phase 3 — `targetType` removal
- **NEW** `server/scripts/removeTargetType.js` — DB migration.
- **MOD** `server/models/Occurrence.js` — drop field.
- **MOD** ~10 files containing `targetType`.

---

## Test Runner

```bash
cd client && npm run test          # full vitest
cd client && npx vitest run client/src/__tests__/dragHitTesting.test.js
```

Use the second form for fast inner-loop iteration.

---

# PHASE 1 — DRAG PIPELINE UNIFICATION

## Task 1.1 — Scaffold `dragHitTesting.js` and its test file

**Files:**
- Create: `client/src/helpers/dragHitTesting.js`
- Create: `client/src/__tests__/dragHitTesting.test.js`

- [ ] **Step 1: Create the empty module with header**

```js
// helpers/dragHitTesting.js
// ============================================================
// PURE drag hit-testing + DropContext builder.
//
// CONTRACT: every function here is pure — no React, no socket,
// no module-scope state. Inputs in, outputs out.
//
// Bridge line `moduleId = occ.targetId` is removed in Phase 2.
// ============================================================

export const DROP_TARGET_KIND = Object.freeze({
  OCCURRENCE: "occurrence",
  GRID_CELL: "grid-cell",
  DOC_CURSOR: "doc-cursor",
});
```

- [ ] **Step 2: Create the test file with one smoke test**

```js
// __tests__/dragHitTesting.test.js
import { describe, it, expect } from "vitest";
import { DROP_TARGET_KIND } from "../helpers/dragHitTesting";

describe("dragHitTesting smoke", () => {
  it("exports DROP_TARGET_KIND", () => {
    expect(DROP_TARGET_KIND.OCCURRENCE).toBe("occurrence");
  });
});
```

- [ ] **Step 3: Run the smoke test**

```bash
cd /home/joshpoms/moduli/client && npx vitest run src/__tests__/dragHitTesting.test.js
```

Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add client/src/helpers/dragHitTesting.js client/src/__tests__/dragHitTesting.test.js
git commit -m "scaffold(drag): dragHitTesting.js module + smoke test"
```

---

## Task 1.2 — `resolveEdgeToIndex` (pure math, TDD)

**Files:**
- Modify: `client/src/helpers/dragHitTesting.js`
- Modify: `client/src/__tests__/dragHitTesting.test.js`

- [ ] **Step 1: Write failing tests**

Append to `__tests__/dragHitTesting.test.js`:

```js
import { resolveEdgeToIndex } from "../helpers/dragHitTesting";

describe("resolveEdgeToIndex", () => {
  it("edge=top returns hoveredIndex (different container)", () => {
    expect(resolveEdgeToIndex("top", 2, -1)).toBe(2);
  });
  it("edge=bottom returns hoveredIndex+1 (different container)", () => {
    expect(resolveEdgeToIndex("bottom", 2, -1)).toBe(3);
  });
  it("edge=left returns hoveredIndex", () => {
    expect(resolveEdgeToIndex("left", 2, -1)).toBe(2);
  });
  it("edge=right returns hoveredIndex+1", () => {
    expect(resolveEdgeToIndex("right", 2, -1)).toBe(3);
  });
  it("null edge defaults to hoveredIndex", () => {
    expect(resolveEdgeToIndex(null, 2, -1)).toBe(2);
  });
  it("same-container forward move shifts by -1", () => {
    // Dragging A from idx 0 over B at idx 2, edge=bottom → naive 3, adjusted 2.
    expect(resolveEdgeToIndex("bottom", 2, 0)).toBe(2);
  });
  it("same-container backward move stays put", () => {
    // Dragging A from idx 5 over B at idx 2, edge=top → 2 (no shift).
    expect(resolveEdgeToIndex("top", 2, 5)).toBe(2);
  });
  it("clamps to 0 when adjustment underflows", () => {
    expect(resolveEdgeToIndex("top", 0, -1)).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /home/joshpoms/moduli/client && npx vitest run src/__tests__/dragHitTesting.test.js
```

Expected: 8 failures, "resolveEdgeToIndex is not a function".

- [ ] **Step 3: Implement**

Append to `dragHitTesting.js`:

```js
export function resolveEdgeToIndex(edge, hoveredIndex, fromIndex) {
  let toIndex;
  if (edge === "top" || edge === "left") toIndex = hoveredIndex;
  else if (edge === "bottom" || edge === "right") toIndex = hoveredIndex + 1;
  else toIndex = hoveredIndex;
  if (fromIndex !== -1 && fromIndex < hoveredIndex) {
    toIndex = Math.max(0, toIndex - 1);
  }
  return toIndex;
}
```

- [ ] **Step 4: Run — expect pass**

Same command. Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add client/src/helpers/dragHitTesting.js client/src/__tests__/dragHitTesting.test.js
git commit -m "feat(drag): resolveEdgeToIndex pure function + tests"
```

---

## Task 1.3 — `resolveDragMode`

**Files:** same.

- [ ] **Step 1: Tests**

```js
import { resolveDragMode } from "../helpers/dragHitTesting";

describe("resolveDragMode", () => {
  it("default returns the payload default", () => {
    expect(resolveDragMode({}, "move")).toBe("move");
    expect(resolveDragMode({}, "copy")).toBe("copy");
  });
  it("alt forces copy", () => {
    expect(resolveDragMode({ alt: true }, "move")).toBe("copy");
  });
  it("alt+shift forces copylink", () => {
    expect(resolveDragMode({ alt: true, shift: true }, "move")).toBe("copylink");
  });
  it("shift alone keeps default", () => {
    expect(resolveDragMode({ shift: true }, "move")).toBe("move");
  });
  it("falsy default falls back to move", () => {
    expect(resolveDragMode({}, null)).toBe("move");
  });
});
```

- [ ] **Step 2: Implement**

```js
export function resolveDragMode(modifiers = {}, payloadDefault) {
  if (modifiers.alt && modifiers.shift) return "copylink";
  if (modifiers.alt) return "copy";
  return payloadDefault || "move";
}
```

- [ ] **Step 3: Run + commit**

```bash
cd /home/joshpoms/moduli/client && npx vitest run src/__tests__/dragHitTesting.test.js
git add -p client/src/helpers/dragHitTesting.js client/src/__tests__/dragHitTesting.test.js
git commit -m "feat(drag): resolveDragMode pure function + tests"
```

---

## Task 1.4 — `buildParentMap` (occurrence tree reverse-index)

**Files:** same.

- [ ] **Step 1: Tests**

```js
import { buildParentMap } from "../helpers/dragHitTesting";

describe("buildParentMap", () => {
  it("indexes parent by child via .occurrences[]", () => {
    const occs = {
      p1: { id: "p1", occurrences: ["c1", "c2"] },
      c1: { id: "c1", occurrences: ["i1"] },
      c2: { id: "c2", occurrences: [] },
      i1: { id: "i1", occurrences: [] },
    };
    expect(buildParentMap(occs)).toEqual({ c1: "p1", c2: "p1", i1: "c1" });
  });
  it("returns empty object for empty input", () => {
    expect(buildParentMap({})).toEqual({});
  });
  it("ignores occurrences without .occurrences[] arrays", () => {
    const occs = { a: { id: "a" }, b: { id: "b", occurrences: ["a"] } };
    expect(buildParentMap(occs)).toEqual({ a: "b" });
  });
});
```

- [ ] **Step 2: Implement**

```js
export function buildParentMap(occurrencesById) {
  const map = Object.create(null);
  for (const occ of Object.values(occurrencesById)) {
    if (!Array.isArray(occ.occurrences)) continue;
    for (const childId of occ.occurrences) map[childId] = occ.id;
  }
  return map;
}
```

- [ ] **Step 3: Run + commit**

```bash
cd /home/joshpoms/moduli/client && npx vitest run src/__tests__/dragHitTesting.test.js
git add -p client/src/helpers/dragHitTesting.js client/src/__tests__/dragHitTesting.test.js
git commit -m "feat(drag): buildParentMap reverse index + tests"
```

---

## Task 1.5 — `walkHoveredOccurrence` (DOM walk via `elementsFromPoint`)

**Files:** same.

- [ ] **Step 1: Tests using a stubbed `elementsFromPoint`**

```js
import { walkHoveredOccurrence } from "../helpers/dragHitTesting";

function makeEl(attrs = {}) {
  const el = {};
  el.getAttribute = (k) => attrs[k] ?? null;
  return el;
}

describe("walkHoveredOccurrence", () => {
  it("returns null when no occurrence is hit", () => {
    const elementsFromPoint = () => [makeEl({})];
    expect(walkHoveredOccurrence(0, 0, { elementsFromPoint })).toBeNull();
  });
  it("returns the innermost data-occurrence-id", () => {
    const elementsFromPoint = () => [
      makeEl({ "data-occurrence-id": "inner" }),
      makeEl({ "data-occurrence-id": "outer" }),
    ];
    expect(walkHoveredOccurrence(0, 0, { elementsFromPoint }))
      .toEqual({ occurrenceId: "inner" });
  });
  it("falls back to data-occ-id and data-instance-id", () => {
    const elementsFromPoint = () => [makeEl({ "data-occ-id": "x" })];
    expect(walkHoveredOccurrence(0, 0, { elementsFromPoint }))
      .toEqual({ occurrenceId: "x" });
  });
  it("ignores elements without occurrence attributes", () => {
    const elementsFromPoint = () => [makeEl({}), makeEl({ "data-occurrence-id": "y" })];
    expect(walkHoveredOccurrence(0, 0, { elementsFromPoint }))
      .toEqual({ occurrenceId: "y" });
  });
});
```

- [ ] **Step 2: Implement**

```js
const _OCC_ATTRS = ["data-occurrence-id", "data-occ-id", "data-instance-id"];

export function walkHoveredOccurrence(x, y, env = {}) {
  const efp = env.elementsFromPoint
    || (typeof document !== "undefined" ? document.elementsFromPoint.bind(document) : null);
  if (!efp) return null;
  const stack = efp(x, y) || [];
  for (const el of stack) {
    if (!el?.getAttribute) continue;
    for (const attr of _OCC_ATTRS) {
      const id = el.getAttribute(attr);
      if (id) return { occurrenceId: id };
    }
  }
  return null;
}
```

- [ ] **Step 3: Run + commit**

```bash
cd /home/joshpoms/moduli/client && npx vitest run src/__tests__/dragHitTesting.test.js
git add -p client/src/helpers/dragHitTesting.js client/src/__tests__/dragHitTesting.test.js
git commit -m "feat(drag): walkHoveredOccurrence DOM hit-test + tests"
```

---

## Task 1.6 — `buildDropContext` (the big one)

**Files:** same.

- [ ] **Step 1: Tests for the core paths**

```js
import { buildDropContext, DROP_TARGET_KIND } from "../helpers/dragHitTesting";

const FIXTURE = {
  occs: {
    container: { id: "container", moduleId: "mC", targetId: "mC", occurrences: ["b", "x", "a"] },
    a: { id: "a", moduleId: "mI", targetId: "mI", occurrences: [] },
    b: { id: "b", moduleId: "mI", targetId: "mI", occurrences: [] },
    x: { id: "x", moduleId: "mI", targetId: "mI", occurrences: [] },
  },
  modules: {
    mC: { id: "mC", role: "container" },
    mI: { id: "mI", role: "instance" },
  },
};

function buildEnv() {
  return {
    occurrencesById: FIXTURE.occs,
    modulesById: FIXTURE.modules,
  };
}

describe("buildDropContext", () => {
  it("returns null when there is no target", () => {
    const raw = {
      source: { occurrenceId: "a", moduleId: "mI", sourceKind: "in-grid" },
      hover: { x: 0, y: 0, dropTargetData: null },
      modifiers: {},
    };
    expect(buildDropContext(raw, buildEnv())).toBeNull();
  });

  it("instance-over-instance same container fills insertIndex", () => {
    const raw = {
      source: { occurrenceId: "a", moduleId: "mI", sourceKind: "in-grid" },
      hover: { x: 0, y: 0, dropTargetData: { occurrenceId: "x", closestEdge: "top" } },
      modifiers: {},
    };
    const ctx = buildDropContext(raw, buildEnv());
    expect(ctx.target.kind).toBe(DROP_TARGET_KIND.OCCURRENCE);
    expect(ctx.target.occurrenceId).toBe("x");
    expect(ctx.target.parentOccurrenceId).toBe("container");
    expect(ctx.position.edge).toBe("top");
    // x is at idx 1; a is at idx 2. fromIndex (2) > hoveredIndex (1) → no shift, toIndex = 1.
    expect(ctx.position.insertIndex).toBe(1);
  });

  it("dragging from idx 0 over idx 2 with edge bottom in same container resolves to 2", () => {
    const raw = {
      source: { occurrenceId: "b", moduleId: "mI", sourceKind: "in-grid" },
      hover: { x: 0, y: 0, dropTargetData: { occurrenceId: "a", closestEdge: "bottom" } },
      modifiers: {},
    };
    const ctx = buildDropContext(raw, buildEnv());
    // b is at idx 0, a is at idx 2. fromIndex < hoveredIndex → naive 3 → adjusted 2.
    expect(ctx.position.insertIndex).toBe(2);
  });

  it("falls back to append when hover is on container with no closestEdge", () => {
    const raw = {
      source: { occurrenceId: "a", moduleId: "mI", sourceKind: "command-center" },
      hover: { x: 0, y: 0, dropTargetData: { occurrenceId: "container" } },
      modifiers: {},
    };
    const ctx = buildDropContext(raw, buildEnv());
    expect(ctx.target.occurrenceId).toBe("container");
    expect(ctx.target.kind).toBe(DROP_TARGET_KIND.OCCURRENCE);
    expect(ctx.position.insertIndex).toBe(3); // append-to-end of container.occurrences (length 3)
  });

  it("propagates grid-cell kind", () => {
    const raw = {
      source: { occurrenceId: null, moduleId: "mC", sourceKind: "command-center" },
      hover: { x: 0, y: 0, dropTargetData: { kind: "grid-cell", gridCell: { row: 1, col: 2 } } },
      modifiers: {},
    };
    const ctx = buildDropContext(raw, buildEnv());
    expect(ctx.target.kind).toBe(DROP_TARGET_KIND.GRID_CELL);
    expect(ctx.target.gridCell).toEqual({ row: 1, col: 2 });
    expect(ctx.target.occurrenceId).toBeNull();
  });

  it("propagates doc-cursor kind", () => {
    const raw = {
      source: { occurrenceId: "a", moduleId: "mI", sourceKind: "in-grid" },
      hover: { x: 0, y: 0, dropTargetData: { kind: "doc-cursor", editorPos: 42, occurrenceId: "container" } },
      modifiers: {},
    };
    const ctx = buildDropContext(raw, buildEnv());
    expect(ctx.target.kind).toBe(DROP_TARGET_KIND.DOC_CURSOR);
    expect(ctx.target.docCursor).toEqual({ editorPos: 42, occurrenceId: "container" });
  });

  it("derives mode from modifiers", () => {
    const raw = {
      source: { occurrenceId: "a", moduleId: "mI", sourceKind: "in-grid", defaultMode: "move" },
      hover: { x: 0, y: 0, dropTargetData: { occurrenceId: "x", closestEdge: "top" } },
      modifiers: { alt: true },
    };
    const ctx = buildDropContext(raw, buildEnv());
    expect(ctx.mode).toBe("copy");
  });
});
```

- [ ] **Step 2: Implement**

Append to `dragHitTesting.js`:

```js
import { resolveEdgeToIndex as _resolveEdge, resolveDragMode as _resolveMode, buildParentMap as _buildParents } from "./dragHitTesting"; // (unused — placeholder kept simple)

// (Actually no import needed since these live in this file. The implementation:)
export function buildDropContext(rawEvent, env) {
  if (!rawEvent || !env) return null;
  const { source, hover, modifiers = {}, pointer } = rawEvent;
  const dtd = hover?.dropTargetData;
  if (!dtd) return null;

  const occurrencesById = env.occurrencesById || {};
  const modulesById = env.modulesById || {};

  // Decide kind first.
  let kind = dtd.kind;
  if (!kind && dtd.occurrenceId) kind = DROP_TARGET_KIND.OCCURRENCE;

  if (kind === DROP_TARGET_KIND.GRID_CELL) {
    return {
      payload: { ...source },
      target: {
        occurrenceId: null,
        moduleId: null,
        parentOccurrenceId: null,
        kind: DROP_TARGET_KIND.GRID_CELL,
        gridCell: dtd.gridCell || null,
        docCursor: null,
      },
      position: { edge: null, insertIndex: 0 },
      mode: _resolveModeLocal(modifiers, source?.defaultMode),
      modifiers,
      pointer: pointer || { x: hover.x, y: hover.y },
    };
  }

  if (kind === DROP_TARGET_KIND.DOC_CURSOR) {
    return {
      payload: { ...source },
      target: {
        occurrenceId: dtd.occurrenceId || null,
        moduleId: dtd.occurrenceId ? (occurrencesById[dtd.occurrenceId]?.moduleId
          ?? occurrencesById[dtd.occurrenceId]?.targetId  // bridge — Phase 2 removes
          ?? null) : null,
        parentOccurrenceId: null,
        kind: DROP_TARGET_KIND.DOC_CURSOR,
        gridCell: null,
        docCursor: { editorPos: dtd.editorPos ?? null, occurrenceId: dtd.occurrenceId || null },
      },
      position: { edge: null, insertIndex: 0 },
      mode: _resolveModeLocal(modifiers, source?.defaultMode),
      modifiers,
      pointer: pointer || { x: hover.x, y: hover.y },
    };
  }

  // OCCURRENCE kind
  if (!dtd.occurrenceId) return null;
  const targetOcc = occurrencesById[dtd.occurrenceId];
  if (!targetOcc) return null;

  const parents = buildParentMap(occurrencesById);
  const parentId = parents[targetOcc.id] || null;
  const parentOcc = parentId ? occurrencesById[parentId] : null;

  // Insert position: if target is a leaf, insert into its parent at edge-relative index;
  // if target itself has children, append to end.
  let insertIndex = 0;
  let edge = dtd.closestEdge ?? null;
  if (parentOcc && Array.isArray(parentOcc.occurrences)) {
    const hoveredIndex = parentOcc.occurrences.indexOf(targetOcc.id);
    const fromIndex = source?.occurrenceId
      ? parentOcc.occurrences.indexOf(source.occurrenceId)
      : -1;
    insertIndex = hoveredIndex !== -1
      ? _resolveEdgeLocal(edge, hoveredIndex, fromIndex)
      : (parentOcc.occurrences.length);
  } else if (Array.isArray(targetOcc.occurrences)) {
    insertIndex = targetOcc.occurrences.length; // append-to-end
    edge = null;
  }

  const targetModuleId = targetOcc.moduleId ?? targetOcc.targetId ?? null; // bridge
  return {
    payload: { ...source },
    target: {
      occurrenceId: targetOcc.id,
      moduleId: targetModuleId,
      parentOccurrenceId: parentId,
      kind: DROP_TARGET_KIND.OCCURRENCE,
      gridCell: null,
      docCursor: null,
    },
    position: { edge, insertIndex },
    mode: _resolveModeLocal(modifiers, source?.defaultMode),
    modifiers,
    pointer: pointer || { x: hover.x, y: hover.y },
  };
}

// Local references to keep buildDropContext self-contained — these names match the exports.
function _resolveEdgeLocal(edge, hoveredIndex, fromIndex) {
  return resolveEdgeToIndex(edge, hoveredIndex, fromIndex);
}
function _resolveModeLocal(modifiers, defaultMode) {
  return resolveDragMode(modifiers, defaultMode);
}
```

(Implementation note: drop the bogus `import` from the snippet header; `resolveEdgeToIndex`, `resolveDragMode`, `buildParentMap` are already defined above in the same file.)

- [ ] **Step 3: Run + commit**

```bash
cd /home/joshpoms/moduli/client && npx vitest run src/__tests__/dragHitTesting.test.js
git add -p client/src/helpers/dragHitTesting.js client/src/__tests__/dragHitTesting.test.js
git commit -m "feat(drag): buildDropContext + full unit test suite"
```

---

## Task 1.7 — Add `routeDrop` to `dropHandlers.js`

**Files:**
- Modify: `client/src/helpers/dropHandlers.js`

- [ ] **Step 1: Add routeDrop**

Add near the top of `dropHandlers.js` (after imports):

```js
import { DROP_TARGET_KIND } from "./dragHitTesting";

export function routeDrop(dropContext, ctx) {
  if (!dropContext) { ctx.clearSession?.(); return; }
  const { payload, target } = dropContext;
  const sourceModule = payload.moduleId ? ctx.state?.modulesById?.[payload.moduleId] : null;
  const sourceRole = sourceModule?.role || null;

  // Adapt to existing handlers: build the legacy `drop` shape from dropContext
  // so handlers can be migrated to (dropContext, ctx) incrementally.
  const legacyDrop = _toLegacyDrop(dropContext, ctx);

  if (payload.sourceKind === "file") return handleFileDrop(ctx, legacyDrop);
  if (payload.sourceKind === "external") return handleExternalDrop(ctx, legacyDrop);
  if (payload.sourceKind === "field") return handleFieldDrop(ctx, legacyDrop);
  if (payload.sourceKind === "operation") return handleOperationDrop(ctx, legacyDrop);
  if (payload.sourceKind === "command-center" || payload.sourceKind === "pool"
      || payload.sourceKind === "doc" || payload.sourceKind === "canvas"
      || payload.sourceKind === "tree-anchor" || payload.sourceKind === "tree-page") {
    return handleModuleDrop(ctx, legacyDrop);
  }
  if (payload.sourceKind === "doc-embed") return handleInstanceDrop(ctx, legacyDrop);
  if (legacyDrop.payload?.type === "template") return handleTemplateDrop(ctx, legacyDrop);
  if (legacyDrop.payload?.type === "artifact") return handleArtifactDrop(ctx, legacyDrop);
  if (legacyDrop.payload?.type === "folder") return handleFolderDrop(ctx, legacyDrop);

  // In-grid by role
  if (sourceRole === "panel") return handlePanelDrop(ctx, legacyDrop);
  if (sourceRole === "container") return handleContainerDrop(ctx, legacyDrop);
  if (sourceRole === "instance" || sourceRole === "page" || sourceRole === "artifact" || sourceRole === "textblock") {
    return handleInstanceDrop(ctx, legacyDrop);
  }

  ctx.clearSession?.();
}

function _toLegacyDrop(dropContext, ctx) {
  const { payload, target, position, pointer } = dropContext;
  const occs = ctx.occurrencesById || {};
  const targetOcc = target.occurrenceId ? occs[target.occurrenceId] : null;
  const parentOcc = target.parentOccurrenceId ? occs[target.parentOccurrenceId] : null;
  const targetModule = ctx.state?.modulesById?.[target.moduleId];
  const targetRole = targetModule?.role;

  // Map back to the historical "instanceId / containerId / panelId / containerOccurrenceId"
  // shape until per-handler refactors land. Single translation point.
  let instanceId = null, containerId = null, panelId = null;
  let containerOccurrenceId = null, instanceOccurrenceId = null;

  if (target.kind === DROP_TARGET_KIND.OCCURRENCE && targetOcc) {
    if (targetRole === "instance" || targetRole === "page" || targetRole === "artifact" || targetRole === "textblock") {
      instanceId = target.moduleId;
      instanceOccurrenceId = target.occurrenceId;
      const parentRole = parentOcc ? ctx.state?.modulesById?.[parentOcc.moduleId ?? parentOcc.targetId]?.role : null;
      if (parentRole === "container") {
        containerId = parentOcc.moduleId ?? parentOcc.targetId ?? null;
        containerOccurrenceId = parentOcc.id;
      } else if (parentRole === "panel" || parentRole === "page") {
        panelId = parentOcc.moduleId ?? parentOcc.targetId ?? null;
      }
    } else if (targetRole === "container") {
      containerId = target.moduleId;
      containerOccurrenceId = target.occurrenceId;
      if (parentOcc) panelId = parentOcc.moduleId ?? parentOcc.targetId ?? null;
    } else if (targetRole === "panel" || targetRole === "page") {
      panelId = target.moduleId;
    }
  }

  const legacyPayload = {
    type: payload.payloadType || _inferLegacyType(payload, ctx),
    id: payload.moduleId || payload.occurrenceId || null,
    data: payload.data || null,
    context: {
      ...(payload.context || {}),
      containerId: payload.sourceContainerId || null,
      containerOccurrenceId: payload.sourceContainerOccurrenceId || null,
      occurrenceId: payload.occurrenceId || null,
      sourceType: payload.sourceKind === "in-grid" ? undefined : payload.sourceKind,
    },
  };

  return {
    payload: legacyPayload,
    dropTarget: { context: { closestEdge: position.edge, insertAt: position.insertIndex, occurrenceId: containerOccurrenceId } },
    panelId, containerId, instanceId, containerOccurrenceId, instanceOccurrenceId,
    x: pointer.x, y: pointer.y,
    getCellFromPoint: ctx.getCellFromPoint,
  };
}

function _inferLegacyType(payload, ctx) {
  if (payload.sourceKind === "file") return "file";
  if (payload.sourceKind === "external" || payload.sourceKind === "text" || payload.sourceKind === "url") return payload.sourceKind;
  if (payload.sourceKind === "field") return "field";
  if (payload.sourceKind === "operation") return "operation";
  if (payload.sourceKind === "command-center" || payload.sourceKind === "pool"
      || payload.sourceKind === "doc" || payload.sourceKind === "canvas"
      || payload.sourceKind === "tree-anchor" || payload.sourceKind === "tree-page") return "module";
  // In-grid: derive from module role
  const role = ctx.state?.modulesById?.[payload.moduleId]?.role;
  if (role === "panel") return "panel";
  if (role === "container") return "container";
  if (role === "page") return "page";
  return "instance";
}
```

- [ ] **Step 2: Run existing tests to ensure nothing broke**

```bash
cd /home/joshpoms/moduli/client && npm run test 2>&1 | tail -50
```

Expected: same number of passing tests as before.

- [ ] **Step 3: Commit**

```bash
git add client/src/helpers/dropHandlers.js
git commit -m "feat(drag): routeDrop entry point + legacy adapter shim"
```

---

## Task 1.8 — Wire `DragProvider.handleDrop` to use `buildDropContext` + `routeDrop`

**Files:**
- Modify: `client/src/helpers/DragProvider.jsx`

- [ ] **Step 1: Add imports**

Add to the top of DragProvider.jsx:

```js
import { buildDropContext } from "./dragHitTesting";
import { routeDrop } from "./dropHandlers";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
```

(Skip any of these that are already imported.)

- [ ] **Step 2: Replace `handleDrop` body**

Find `const handleDrop = useCallback((dropTarget) => {` (around line 775). Replace the whole function body:

```js
const handleDrop = useCallback((dropTarget) => {
  const s = sessionRef.current;
  const payload = s?.payload || dropTarget?.source;
  if (!s.dragging && !payload) { clearSession(); return; }

  if (dropTarget.clientX !== undefined && dropTarget.clientY !== undefined) {
    pointerRef.current = { x: dropTarget.clientX, y: dropTarget.clientY };
  }
  const { x, y } = pointerRef.current;

  // Build RawDropEvent from the legacy dropTarget shape (transitional).
  const dtd = dropTarget.context || dropTarget.dropTargetData || null;
  const closestEdge = dtd?.closestEdge
    ?? (dropTarget.self?.data ? extractClosestEdge(dropTarget.self.data) : null);

  const rawEvent = {
    source: {
      occurrenceId: payload?.context?.occurrenceId
        || payload?.context?.containerOccurrenceId
        || payload?.occurrenceId
        || null,
      moduleId: payload?.id || null,
      sourceKind: payload?.context?.sourceType || payload?.sourceType || "in-grid",
      defaultMode: s?.mode || "move",
      payloadType: payload?.type,
      data: payload?.data,
      context: payload?.context,
      sourceContainerId: payload?.context?.containerId,
      sourceContainerOccurrenceId: payload?.context?.containerOccurrenceId,
    },
    hover: {
      x, y,
      dropTargetData: dtd ? {
        occurrenceId: dtd.occurrenceId
          || dtd.containerOccurrenceId
          || dtd.instanceOccurrenceId
          || null,
        closestEdge,
        kind: dtd.kind,
        gridCell: dtd.gridCell,
        editorPos: dtd.editorPos,
      } : null,
    },
    modifiers: {
      shift: dropTarget.shiftKey ?? false,
      alt: dropTarget.altKey ?? false,
      ctrl: dropTarget.ctrlKey ?? false,
      meta: dropTarget.metaKey ?? false,
    },
    pointer: { x, y },
  };

  const env = {
    occurrencesById,
    modulesById: state?.modulesById || {},
  };

  const dropContext = buildDropContext(rawEvent, env);

  const ctx = {
    dispatch, socket, state, occurrencesById, baseAllPanels, baseContainers,
    clearSession, sessionRef, getCellFromPoint,
    getHoveredPanelId, getHoveredContainerId, getHoveredInstanceId,
  };

  if (!dropContext) {
    // No clean target — fall back to legacy routing for cases the new pipeline
    // doesn't yet model (file drops on grid cell with cell-from-point lookup, etc).
    _legacyHandleDrop(dropTarget, ctx, payload, x, y);
    clearSession();
    return;
  }

  routeDrop(dropContext, ctx);
  clearSession();
}, [dispatch, socket, getCellFromPoint, getHoveredPanelId, getHoveredContainerId, getHoveredInstanceId, baseAllPanels, baseContainers, occurrencesById, clearSession, state]);
```

Then preserve the previous body as `_legacyHandleDrop` directly above it (rename the old body, keep all behavior). This protects file/external/grid-cell flows during transition.

- [ ] **Step 3: Run full client test suite**

```bash
cd /home/joshpoms/moduli/client && npm run test 2>&1 | tail -80
```

Expected: same tests pass.

- [ ] **Step 4: Manually exercise** — `npm run dev`, drag instance over another instance in the same container. Confirm reorder works.

- [ ] **Step 5: Commit**

```bash
git add client/src/helpers/DragProvider.jsx
git commit -m "feat(drag): DragProvider.handleDrop uses buildDropContext + routeDrop"
```

---

## Task 1.9 — Comment out `monitorForElements` in DragProvider

**Files:**
- Modify: `client/src/helpers/DragProvider.jsx`

- [ ] **Step 1: Find the `monitorForElements` block** and wrap it in `/* ... */` with a header:

```js
// PHASE-1-DISABLED: monitorForElements duplicated per-element dropTargetForElements.
// Kept commented out as a precision fallback per spec §3.
/*
monitorForElements({ ... entire original block ... })
*/
```

- [ ] **Step 2: Run dev + full client test suite**

```bash
cd /home/joshpoms/moduli/client && npm run test 2>&1 | tail -40
```

- [ ] **Step 3: Manual regression** — repeat the regression checklist from spec §7 (Phase 1 acceptance). At minimum:
  - Instance over instance — reorder works.
  - Drag into empty container — append works.
  - Drag panel onto grid cell — placement works.
  - File drop onto grid cell — artifact panel created.

- [ ] **Step 4: Commit**

```bash
git add client/src/helpers/DragProvider.jsx
git commit -m "refactor(drag): comment out monitorForElements (precision fallback)"
```

---

## Task 1.10 — Delete `nativeDnd.js`

**Files:**
- Delete: `client/src/helpers/nativeDnd.js`

- [ ] **Step 1: Confirm no callers**

```bash
grep -rn "nativeDnd" /home/joshpoms/moduli/client/src --include="*.js" --include="*.jsx"
```

Expected: zero hits (or only the file itself).

- [ ] **Step 2: Delete and commit**

```bash
git rm client/src/helpers/nativeDnd.js
git commit -m "chore(drag): remove unused nativeDnd.js"
```

---

## Task 1.11 — Phase 1 final regression

- [ ] **Step 1: Full client test suite green**

```bash
cd /home/joshpoms/moduli/client && npm run test 2>&1 | tail -40
```

- [ ] **Step 2: Server tests green**

```bash
cd /home/joshpoms/moduli/server && npm run test 2>&1 | tail -40
```

(If no server test script, skip — no server changes in Phase 1.)

- [ ] **Step 3: Manual regression checklist** (full list from spec §7).

- [ ] **Step 4: Commit summary**

```bash
git commit --allow-empty -m "test(drag): Phase 1 regression checklist passed"
```

---

# PHASE 2 — `targetId` → `moduleId` RENAME

## Task 2.1 — Migration script

**Files:**
- Create: `server/scripts/renameTargetIdToModuleId.js`

- [ ] **Step 1: Write the script**

```js
// server/scripts/renameTargetIdToModuleId.js
// One-shot migration: Occurrence.targetId → Occurrence.moduleId
// Run: node --env-file=.env scripts/renameTargetIdToModuleId.js
import mongoose from "mongoose";

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const Occurrence = mongoose.connection.collection("occurrences");
  const before = await Occurrence.countDocuments({ targetId: { $exists: true } });
  console.log(`[migrate] ${before} occurrences with targetId`);
  const res = await Occurrence.updateMany({ targetId: { $exists: true } }, { $rename: { targetId: "moduleId" } });
  console.log(`[migrate] modified ${res.modifiedCount}`);
  const after = await Occurrence.countDocuments({ targetId: { $exists: true } });
  if (after !== 0) throw new Error(`[migrate] ${after} docs still have targetId`);
  console.log("[migrate] done");
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Commit**

```bash
git add server/scripts/renameTargetIdToModuleId.js
git commit -m "chore(migration): rename targetId→moduleId script"
```

- [ ] **Step 3: User-run** (the user runs this against their dev DB; assistant does not run database migrations without explicit go-ahead).

---

## Task 2.2 — Schema rename

**Files:**
- Modify: `server/models/Occurrence.js`

- [ ] **Step 1: Find the `targetId` field definition and rename to `moduleId`. Update any indexes that reference it.**

- [ ] **Step 2: Run server**

```bash
cd /home/joshpoms/moduli/server && node --check models/Occurrence.js
```

Expected: no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add server/models/Occurrence.js
git commit -m "feat(schema): Occurrence.targetId → moduleId"
```

---

## Task 2.3 — Server-side rename (socket handlers + scripts)

**Files (modify all in batch):**
- `server/socketHandlers/crud.js`
- `server/socketHandlers/templates.js`
- `server/scripts/*.js` (15 files)
- `server/models/Operation.js`

- [ ] **Step 1: Run sed across the directory**

```bash
cd /home/joshpoms/moduli/server
grep -rln "targetId" --include="*.js" socketHandlers scripts models | xargs sed -i 's/\btargetId\b/moduleId/g'
```

- [ ] **Step 2: Eyeball-review the diff**

```bash
git diff server/ | less
```

Confirm no false positives (e.g., `event.targetId` from DOM contexts — none expected on server, but verify).

- [ ] **Step 3: Commit**

```bash
git add server/
git commit -m "refactor(server): rename targetId→moduleId across socket handlers + scripts"
```

---

## Task 2.4 — Client state/helpers rename

**Files (modify all in batch):**
- `client/src/state/*.js`
- `client/src/helpers/*.js`
- `client/src/helpers/*.jsx`

- [ ] **Step 1: Run sed**

```bash
cd /home/joshpoms/moduli/client/src
grep -rln "targetId" --include="*.js" --include="*.jsx" state helpers | xargs sed -i 's/\btargetId\b/moduleId/g'
```

- [ ] **Step 2: Remove the bridge line in `dragHitTesting.js`**

Open `client/src/helpers/dragHitTesting.js`. Replace `targetOcc.moduleId ?? targetOcc.targetId ?? null` with `targetOcc.moduleId ?? null`. Same in the doc-cursor branch.

- [ ] **Step 3: Run client tests**

```bash
cd /home/joshpoms/moduli/client && npm run test 2>&1 | tail -60
```

Fix any breakages.

- [ ] **Step 4: Commit**

```bash
git add client/src/state client/src/helpers
git commit -m "refactor(client/state+helpers): rename targetId→moduleId"
```

---

## Task 2.5 — Client modules / UI / docs rename

**Files:**
- `client/src/modules/*`
- `client/src/ui/*`
- `client/src/docs/*`
- `client/src/blocks/*`
- `client/src/App.jsx`, `client/src/Grid.jsx`, etc.

- [ ] **Step 1: Run sed**

```bash
cd /home/joshpoms/moduli/client/src
grep -rln "targetId" --include="*.js" --include="*.jsx" modules ui docs blocks App.jsx Grid.jsx PagePreviewApp.jsx 2>/dev/null | xargs sed -i 's/\btargetId\b/moduleId/g'
```

- [ ] **Step 2: Run tests**

```bash
cd /home/joshpoms/moduli/client && npm run test 2>&1 | tail -60
```

- [ ] **Step 3: Commit**

```bash
git add client/src
git commit -m "refactor(client/ui): rename targetId→moduleId"
```

---

## Task 2.6 — Test-fixtures rename

**Files:**
- `client/src/__tests__/*.js`

- [ ] **Step 1: Run sed**

```bash
cd /home/joshpoms/moduli/client/src/__tests__ && sed -i 's/\btargetId\b/moduleId/g' *.js
```

- [ ] **Step 2: Run tests + commit**

```bash
cd /home/joshpoms/moduli/client && npm run test
git add client/src/__tests__
git commit -m "test: rename targetId→moduleId in test fixtures"
```

---

## Task 2.7 — Final Phase 2 sweep

- [ ] **Step 1: Confirm zero hits**

```bash
grep -rn "\btargetId\b" /home/joshpoms/moduli/client/src /home/joshpoms/moduli/server --include="*.js" --include="*.jsx"
```

Expected: zero (or only legitimate non-Occurrence uses, audited individually).

- [ ] **Step 2: Tag commit**

```bash
git commit --allow-empty -m "milestone(rename): targetId→moduleId complete"
```

---

# PHASE 3 — `targetType` REMOVAL

## Task 3.1 — Audit reads

- [ ] **Step 1: List all reads**

```bash
grep -rn "targetType" /home/joshpoms/moduli/client/src /home/joshpoms/moduli/server --include="*.js" --include="*.jsx" | grep -v "// "
```

- [ ] **Step 2: For each branching read, plan replacement** with `modulesById[occ.moduleId]?.role`. Put the mapping in a comment in `server/scripts/removeTargetType.js` (next task).

---

## Task 3.2 — Migration script

**Files:**
- Create: `server/scripts/removeTargetType.js`

- [ ] **Step 1: Write**

```js
// server/scripts/removeTargetType.js
// One-shot migration: drop Occurrence.targetType (redundant with module.role).
import mongoose from "mongoose";

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const Occurrence = mongoose.connection.collection("occurrences");
  const before = await Occurrence.countDocuments({ targetType: { $exists: true } });
  console.log(`[migrate] ${before} occurrences with targetType`);
  const res = await Occurrence.updateMany({ targetType: { $exists: true } }, { $unset: { targetType: 1 } });
  console.log(`[migrate] modified ${res.modifiedCount}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Commit**

```bash
git add server/scripts/removeTargetType.js
git commit -m "chore(migration): remove targetType from occurrences"
```

---

## Task 3.3 — Replace reads with module-role lookups

**Files:** every file from the audit in Task 3.1.

- [ ] **Step 1:** Replace each `occ.targetType === "X"` with `modulesById[occ.moduleId]?.role === "X"` (or equivalent in the local context). Examples likely include `Grid.jsx:356` comment update.

- [ ] **Step 2: Remove writes from `LayoutHelpers.js`** (lines 215, 259, 309, 392, 475, 674, 742, 814 in pre-rename numbering — re-grep at execution time).

- [ ] **Step 3: Remove `targetType` from `server/models/Occurrence.js` schema.**

- [ ] **Step 4: Run full test suite + manual regression.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: drop redundant Occurrence.targetType (use module.role)"
```

---

## Task 3.4 — Final Phase 3 sweep

- [ ] **Step 1: Confirm zero hits**

```bash
grep -rn "targetType" /home/joshpoms/moduli/client/src /home/joshpoms/moduli/server --include="*.js" --include="*.jsx"
```

Expected: zero.

- [ ] **Step 2: Tag commit**

```bash
git commit --allow-empty -m "milestone(cleanup): targetType removal complete"
```

---

# Phase Completion Acceptance

- [ ] All client tests pass (`cd client && npm run test`).
- [ ] Server tests pass (if any).
- [ ] Manual drag regression checklist (spec §7) green.
- [ ] `grep -rn "\btargetId\b" client/src server` returns zero.
- [ ] `grep -rn "targetType" client/src server` returns zero.
- [ ] `grep -rn "nativeDnd" client/src` returns zero.
- [ ] `monitorForElements` block remains commented (precision fallback).
- [ ] User confirms instance-over-instance reorder works in browser.
