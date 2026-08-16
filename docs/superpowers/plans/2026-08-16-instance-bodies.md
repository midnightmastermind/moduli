# Instance Bodies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every instance row a hover button that opens its mini doc body, with exactly one body open at a time app-wide.

**Architecture:** The body itself already exists — `ModuleInstance` holds `showDoc`/`toggleDoc` and renders a real `DocContent` under the row, which (passing no `onExitBlock`) already mints textblocks under the doc rules. This plan adds a visible button, moves "which body is open" into a module-level exclusive claim so a row can close a sibling it cannot see, and leaves the state ephemeral.

**Tech Stack:** React 18, Vitest + @testing-library/react, plain CSS in `client/src/index.css`.

## Global Constraints

- **No persistence.** No schema change, no migration, no write on toggle. `showDoc` stays local state.
- **No change to textblock minting, saving or abandoning.** That is the doc path and is already covered by its own tests.
- **No change to linked-group propagation.** `update_occurrence` already fans `textmap` across a `linkedGroupId`; copy-linked siblings therefore already share a body.
- **Nothing closes a body on blur or outside click.** Only toggling it, or opening another, closes one.
- **The radial-menu "Toggle doc" item stays**, and must call the same handler as the button.
- Spec: `docs/superpowers/specs/2026-08-16-instance-bodies-design.md`.
- Run tests from `client/`: `npx vitest run <path>`.

---

### Task 1: The exclusive-open claim

One body open at a time, app-wide. A per-component boolean cannot do this: the row that should close is the one no longer receiving events. This mirrors `helpers/gapHover.js` (`claimExclusiveGap`), which solved the identical problem for doc insert-gaps on 2026-08-01 (9) — read that file first.

**Files:**
- Create: `client/src/helpers/bodyOpen.js`
- Test: `client/src/__tests__/bodyOpen.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `claimBodyOpen(occurrenceId: string): void` — publishes the open body.
  - `releaseBodyOpen(occurrenceId: string): void` — clears the claim only if `occurrenceId` currently holds it.
  - `getOpenBodyId(): string | null`
  - `subscribeBodyOpen(fn: (openId: string | null) => void): () => void` — returns an unsubscribe.

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/bodyOpen.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  claimBodyOpen, releaseBodyOpen, getOpenBodyId, subscribeBodyOpen,
} from "../helpers/bodyOpen.js";

beforeEach(() => { releaseBodyOpen(getOpenBodyId()); });

describe("bodyOpen — one open body, app-wide", () => {
  it("claiming publishes the id", () => {
    claimBodyOpen("occ-a");
    expect(getOpenBodyId()).toBe("occ-a");
  });

  it("a second claim REPLACES the first (that is the whole point)", () => {
    claimBodyOpen("occ-a");
    claimBodyOpen("occ-b");
    expect(getOpenBodyId()).toBe("occ-b");
  });

  it("notifies subscribers on every change", () => {
    const seen = [];
    const off = subscribeBodyOpen((id) => seen.push(id));
    claimBodyOpen("occ-a");
    claimBodyOpen("occ-b");
    releaseBodyOpen("occ-b");
    off();
    claimBodyOpen("occ-c");           // after unsubscribe — must not be seen
    expect(seen).toEqual(["occ-a", "occ-b", null]);
  });

  it("release is IGNORED when another body already holds the claim", () => {
    // Row A unmounts AFTER row B opened. Without this guard A's cleanup would
    // close B — a body closing itself by unmounting someone else.
    claimBodyOpen("occ-a");
    claimBodyOpen("occ-b");
    releaseBodyOpen("occ-a");
    expect(getOpenBodyId()).toBe("occ-b");
  });

  it("re-claiming the same id does not re-notify", () => {
    claimBodyOpen("occ-a");
    const seen = [];
    const off = subscribeBodyOpen((id) => seen.push(id));
    claimBodyOpen("occ-a");
    off();
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd client && npx vitest run src/__tests__/bodyOpen.test.js`
Expected: FAIL — `Failed to resolve import "../helpers/bodyOpen.js"`.

- [ ] **Step 3: Implement**

```js
// client/src/helpers/bodyOpen.js
// WHICH instance body is open — exactly one, app-wide.
//
// A per-component boolean cannot enforce this: the row that ought to close is
// precisely the one no longer receiving events, so it can never know a sibling
// opened. Same shape as `helpers/gapHover.js claimExclusiveGap`, which solved
// this for doc insert-gaps on 2026-08-01 (9); at most one is open BY
// CONSTRUCTION rather than by bookkeeping.
//
// Deliberately module state, not context: every instance row on the grid would
// otherwise re-render whenever any body opened.
let openId = null;
const subs = new Set();

function publish() {
  for (const fn of Array.from(subs)) {
    try { fn(openId); } catch { /* a bad subscriber must not stop the rest */ }
  }
}

export function getOpenBodyId() {
  return openId;
}

export function claimBodyOpen(occurrenceId) {
  if (!occurrenceId || openId === occurrenceId) return;
  openId = occurrenceId;
  publish();
}

/**
 * Clear the claim — but ONLY if this id still holds it. A row that unmounts
 * after another body opened must not close the new one.
 */
export function releaseBodyOpen(occurrenceId) {
  if (openId === null || openId !== occurrenceId) return;
  openId = null;
  publish();
}

export function subscribeBodyOpen(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd client && npx vitest run src/__tests__/bodyOpen.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: A/B each guard — and verify the mutation LANDED before believing the result**

For each mutation: apply it, `grep` the file to confirm the new text is present and the old is gone, run the suite, then restore.

1. `if (openId === null || openId !== occurrenceId) return;` → `openId = null; publish();` (unconditional release) — expect the "release is IGNORED" test to fail.
2. `if (!occurrenceId || openId === occurrenceId) return;` → `if (!occurrenceId) return;` — expect "re-claiming the same id does not re-notify" to fail.

Each must fail **exactly one** test. If a mutation fails none, the test does not discriminate — fix the test, not the code.

- [ ] **Step 6: Commit**

```bash
git add client/src/helpers/bodyOpen.js client/src/__tests__/bodyOpen.test.js
git commit -m "feat(instance-body): one open body app-wide, via an exclusive claim"
```

---

### Task 2: Wire the claim into ModuleInstance

**Files:**
- Modify: `client/src/modules/ModuleInstance.jsx` (the `showDoc` state at ~:1010 and `toggleDoc` at ~:1211)
- Test: `client/src/__tests__/instanceBodyExclusive.test.jsx`

**Interfaces:**
- Consumes: `claimBodyOpen` / `releaseBodyOpen` / `subscribeBodyOpen` / `getOpenBodyId` from Task 1.
- Produces: `toggleDoc()` — unchanged signature, now claim-backed. Task 3's button calls exactly this.

- [ ] **Step 1: Write the failing test**

Render two `ModuleInstance` rows, open A, then open B, and assert A closed. Mock the heavy children so the test is about the claim, not about DocContent.

```jsx
// client/src/__tests__/instanceBodyExclusive.test.jsx
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("../modules/DocContent", () => ({
  __esModule: true,
  default: ({ occurrence }) =>
    React.createElement("div", { "data-testid": `body-${occurrence.id}` }),
  DocContent: ({ occurrence }) =>
    React.createElement("div", { "data-testid": `body-${occurrence.id}` }),
}));

import ModuleInstance from "../modules/ModuleInstance";
import { releaseBodyOpen, getOpenBodyId } from "../helpers/bodyOpen";

// NOTE TO THE IMPLEMENTER: ModuleInstance pulls a lot from GridActionsContext
// and the drag system. Mock whatever it needs to mount — but do NOT mock
// `helpers/bodyOpen`; the claim is the thing under test. If mounting proves
// impractical, split the body toggle into a `useBodyOpen(occurrenceId)` hook
// and test the hook with renderHook instead. Do NOT delete the case.

beforeEach(() => { releaseBodyOpen(getOpenBodyId()); });
afterEach(() => { cleanup(); });

describe("instance bodies are mutually exclusive", () => {
  it("opening B closes A", () => {
    /* render two rows, click A's body button, assert body-A present,
       click B's, assert body-A gone and body-B present */
  });

  it("an outside click does NOT close an open body", () => {
    /* open A, fireEvent.mouseDown(document.body), assert body-A still present
       — you must be able to drag into it */
  });

  it("unmounting a row with an open body releases the claim", () => {
    /* open A, unmount, expect getOpenBodyId() === null */
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd client && npx vitest run src/__tests__/instanceBodyExclusive.test.jsx`
Expected: FAIL — there is no body button to click yet.

- [ ] **Step 3: Implement**

Replace the local-only `showDoc` with claim-backed state:

```jsx
// near the existing `const [showDoc, setShowDoc] = useState(false);`
import {
  claimBodyOpen, releaseBodyOpen, subscribeBodyOpen, getOpenBodyId,
} from "../helpers/bodyOpen";

const occId = occurrence?.id ?? null;
// The claim is the source of truth; local state only mirrors it so this row
// re-renders. Subscribing is what lets a row close when a SIBLING opens —
// the row being closed gets no event of its own.
const [showDoc, setShowDoc] = useState(() => !!occId && getOpenBodyId() === occId);
useEffect(() => {
  if (!occId) return undefined;
  const off = subscribeBodyOpen((openId) => setShowDoc(openId === occId));
  return () => { off(); releaseBodyOpen(occId); };
}, [occId]);

const toggleDoc = useCallback(() => {
  if (!occId) return;
  if (getOpenBodyId() === occId) releaseBodyOpen(occId);
  else claimBodyOpen(occId);
}, [occId]);
```

Leave the `{occurrence && showDoc && (...)}` render block and the radial `toggleDoc={toggleDoc}` wiring exactly as they are.

- [ ] **Step 4: Run it and watch it pass**

Run: `cd client && npx vitest run src/__tests__/instanceBodyExclusive.test.jsx`
Expected: PASS.

- [ ] **Step 5: Guard the whole suite**

Run: `cd client && npx vitest run`
Expected: 2584+ passing, 0 failing. `ModuleInstance` renders every row on the grid — a regression here is broad.

- [ ] **Step 6: Commit**

```bash
git add client/src/modules/ModuleInstance.jsx client/src/__tests__/instanceBodyExclusive.test.jsx
git commit -m "feat(instance-body): the open body is a claim, so opening one closes the others"
```

---

### Task 3: The hover button

**Files:**
- Modify: `client/src/modules/ModuleInstance.jsx` (inside the `.instance-wrap` return, alongside the existing linked-copy badge)
- Modify: `client/src/index.css` (near `.linked-copy-badge`)
- Test: `client/src/__tests__/instanceBodyExclusive.test.jsx` (extend)

**Interfaces:**
- Consumes: `toggleDoc` from Task 2.
- Produces: a button carrying `data-testid="instance-body-btn"` and `aria-expanded`.

- [ ] **Step 1: Write the failing test**

```jsx
it("the button and the radial item drive the IDENTICAL handler", () => {
  // Render one row. Assert the button exists, is aria-expanded=false,
  // opens the body on click, and reports aria-expanded=true.
  // Then assert the RadialMenu received the same function reference as the
  // button's onClick — one handler, two entry points, so they cannot drift.
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd client && npx vitest run src/__tests__/instanceBodyExclusive.test.jsx -t "IDENTICAL"`
Expected: FAIL — no `instance-body-btn` in the DOM.

- [ ] **Step 3: Implement**

```jsx
{occurrence && (
  <button
    type="button"
    className="instance-body-btn"
    data-testid="instance-body-btn"
    aria-expanded={showDoc}
    aria-label={showDoc ? "Hide notes" : "Show notes"}
    title={showDoc ? "Hide notes" : "Show notes"}
    onClick={(e) => { e.stopPropagation(); toggleDoc(); }}
  >
    <ChevronDown style={{ width: 12, height: 12 }} />
  </button>
)}
```

`stopPropagation` matters: `.instance-wrap` has its own `onClick` (selection) and its own context menu.

```css
/* client/src/index.css — beside .linked-copy-badge */

/* Opens this row's mini doc. Bottom-right, revealed on row hover — the same
   affordance the drag handle uses, so it costs no layout and cannot push
   content. Absolute so a row without a body reads exactly as it does today. */
.instance-body-btn {
  position: absolute;
  right: 4px;
  bottom: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-faint);
  opacity: 0;
  transition: opacity 120ms ease-out, color 120ms ease-out;
  cursor: pointer;
  z-index: 3;
}
.instance-wrap:hover > .instance-body-btn,
.instance-body-btn[aria-expanded="true"] {
  opacity: 1;                     /* an OPEN body keeps its button visible */
}
.instance-body-btn:hover { color: var(--text-primary); }
.instance-body-btn[aria-expanded="true"] { transform: rotate(180deg); }

/* Coarse pointers have no hover: always show, thumb-sized. */
@media (pointer: coarse) {
  .instance-body-btn { opacity: 1; width: 26px; height: 26px; }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd client && npx vitest run src/__tests__/instanceBodyExclusive.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/modules/ModuleInstance.jsx client/src/index.css client/src/__tests__/instanceBodyExclusive.test.jsx
git commit -m "feat(instance-body): a hover button on the row opens the mini doc"
```

---

### Task 4: Verify the two assumptions in a browser

These are **checks, not features**. The spec names both; neither can be observed in jsdom, and "it should work" is how inert features ship in this repo. If either fails, STOP and file it — do not absorb the fix here.

**Files:**
- Create: `_instancebody.mjs` (repo root; `_*.mjs` is gitignored)

- [ ] **Step 1: Build and probe**

Model the probe on `_spreadgrid.mjs` (same auth + navigation shape; it takes `CREDS_FILE`, `PAGE`, `SEL`, `NTH`). Mint a fresh JWT — the tokens in older probes expire in 7 days.

```bash
cd client && npm run build
CREDS_FILE=<creds.json> node ../_instancebody.mjs
```

The probe must report, on the live grid:
1. the button is invisible at rest and visible on row hover;
2. clicking it opens a body, and clicking a second row's button closes the first;
3. a click on empty page chrome does **not** close an open body;
4. the open body registers a doc drop zone — `document.querySelector(".instance-wrap .doc-editor")` exists and `getDocTouchDropZone` resolves it (**spec verification #1**);
5. dragging an occurrence onto the body lands it IN the body, not re-parented onto the row (**spec verification #2** — `DragProvider` bails on any drop over a `.doc-editor`, 2026-06-16).

- [ ] **Step 2: Screenshot the open body**

A hover affordance and a nested editor are visual. Take a screenshot and LOOK at it — this surface has been settled by looking three times.

- [ ] **Step 3: Record the outcome**

Update `client/src/modules/CLAUDE.md` with what was measured, and state plainly anything NOT verified. If checks 4 or 5 fail, record the failure and open a separate bug rather than growing this plan.

- [ ] **Step 4: Sweep and commit**

Confirm no probe debris: `cd server && node --env-file=.env scripts/checkGrid.js --grid "poms grid"` → expect **0 errors**.

```bash
git add client/src/modules/CLAUDE.md
git commit -m "docs(instance-body): browser verification of the button, exclusivity and drop-into-body"
```

---

## Self-review

**Spec coverage.** Button → Task 3. Radial item retained and sharing one handler → Tasks 2–3. Per-placement body with linked siblings sharing → no task, and that is correct: `textmap` is already occurrence-level and the server already fans it across a `linkedGroupId`; the spec records this as existing behaviour. Every instance, on hover → Task 3. Ephemeral → Global Constraints, and no task writes. One at a time → Tasks 1–2. No close-on-blur → asserted in Task 2. "Mini" styling → no task; the spec resolved it as the treatment the body already has. Both spec verifications → Task 4.

**Placeholders.** Task 2 Step 1 and Task 3 Step 1 give test *shapes* rather than finished bodies, because mounting `ModuleInstance` needs a context double whose exact surface the implementer will discover. Both name the assertion and the fallback (extract a `useBodyOpen` hook) so the case cannot be quietly dropped. Every code step that ships code shows the code.

**Type consistency.** `claimBodyOpen` / `releaseBodyOpen` / `getOpenBodyId` / `subscribeBodyOpen` are spelled identically in Tasks 1 and 2; `toggleDoc` keeps its existing name and signature across Tasks 2 and 3.
