# Mobile / Touch Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make touch devices (phones and tablets) fully usable — occurrences drag, panels resize, menus open and are finger-sized, the panel header has a tappable lip, and quick-add is reachable — by decoupling "is a touch device" from "use the mobile layout."

**Architecture:** Replace the single width-based `isMobile` flag with two orthogonal signals — `isTouch` (`pointer: coarse`) and `isMobileLayout` (orientation/width). Touch behaviors key off `isTouch`; layout switches key off `isMobileLayout`. Long-press opens the existing context menus on touch via a new `useLongPress` hook. Everything else is re-gating existing, already-built mobile code.

**Tech Stack:** React, `window.matchMedia`, `@atlaskit/pragmatic-drag-and-drop` (desktop), custom touch-drag in `helpers/dragSystem.js`, Vitest/jsdom for unit tests.

## Global Constraints

- Mobile-layout formula (verbatim): `isMobileLayout = (isTouch && (isPortrait || width < 980)) || width <= 600`.
- `isTouch = matchMedia("(pointer: coarse)").matches`; `isPortrait = matchMedia("(orientation: portrait)").matches`.
- No shipped backwards-compat shims: the transitional `isMobile` context key introduced in Task 2 MUST be removed in Task 5. No `isMobile` reader may remain after Task 5.
- All mutations go through `CommitHelpers` — never call `socket.emit` directly from a component.
- Leave the app runnable (`npm run dev`) and the test suite green after every task.
- Run client tests from `client/`: `npx vitest run <path>`.

---

### Task 1: `useMobileDetect` returns `{ isTouch, isMobileLayout }`

**Files:**
- Modify: `client/src/hooks/useMobileDetect.js`
- Test: `client/src/__tests__/useMobileDetect.test.jsx` (create)

**Interfaces:**
- Produces: `useMobileDetect() → { isTouch: boolean, isMobileLayout: boolean }`. Exports unchanged `MOBILE_BREAKPOINT = 600`.

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/useMobileDetect.test.jsx`:

```jsx
import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMobileDetect } from "../hooks/useMobileDetect";

// Configure matchMedia for a given viewport shape.
function setMedia({ coarse, portrait, width }) {
  window.matchMedia = vi.fn().mockImplementation((query) => {
    let matches = false;
    if (query.includes("pointer: coarse")) matches = coarse;
    else if (query.includes("orientation: portrait")) matches = portrait;
    else if (query.includes("max-width")) matches = width <= 600;
    return {
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
  });
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
}

describe("useMobileDetect", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("tablet landscape: touch but desktop layout", () => {
    setMedia({ coarse: true, portrait: false, width: 1180 });
    const { result } = renderHook(() => useMobileDetect());
    expect(result.current.isTouch).toBe(true);
    expect(result.current.isMobileLayout).toBe(false);
  });

  it("tablet portrait: touch and mobile layout", () => {
    setMedia({ coarse: true, portrait: true, width: 834 });
    const { result } = renderHook(() => useMobileDetect());
    expect(result.current.isTouch).toBe(true);
    expect(result.current.isMobileLayout).toBe(true);
  });

  it("phone landscape: touch and mobile layout (narrow)", () => {
    setMedia({ coarse: true, portrait: false, width: 844 });
    const { result } = renderHook(() => useMobileDetect());
    expect(result.current.isTouch).toBe(true);
    expect(result.current.isMobileLayout).toBe(true);
  });

  it("desktop: neither", () => {
    setMedia({ coarse: false, portrait: false, width: 1440 });
    const { result } = renderHook(() => useMobileDetect());
    expect(result.current.isTouch).toBe(false);
    expect(result.current.isMobileLayout).toBe(false);
  });

  it("desktop narrow (<=600): mobile layout via legacy fallback", () => {
    setMedia({ coarse: false, portrait: false, width: 500 });
    const { result } = renderHook(() => useMobileDetect());
    expect(result.current.isTouch).toBe(false);
    expect(result.current.isMobileLayout).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/__tests__/useMobileDetect.test.jsx`
Expected: FAIL — `result.current.isTouch` is `undefined` (hook still returns `{ isMobile }`).

- [ ] **Step 3: Rewrite the hook**

Replace the entire body of `client/src/hooks/useMobileDetect.js`:

```jsx
import { useState, useEffect } from "react";

export const MOBILE_BREAKPOINT = 600;

const COARSE = "(pointer: coarse)";
const PORTRAIT = "(orientation: portrait)";
const NARROW = `(max-width: ${MOBILE_BREAKPOINT}px)`;

function compute() {
  if (typeof window === "undefined") return { isTouch: false, isMobileLayout: false };
  const isTouch = window.matchMedia(COARSE).matches;
  const isPortrait = window.matchMedia(PORTRAIT).matches;
  const width = window.innerWidth;
  const isMobileLayout = (isTouch && (isPortrait || width < 980)) || width <= MOBILE_BREAKPOINT;
  return { isTouch, isMobileLayout };
}

export function useMobileDetect() {
  const [flags, setFlags] = useState(compute);

  useEffect(() => {
    const recompute = () => setFlags(compute());
    const mqls = [COARSE, PORTRAIT, NARROW].map((q) => window.matchMedia(q));
    mqls.forEach((mql) => mql.addEventListener("change", recompute));
    window.addEventListener("resize", recompute);
    // Reconcile once after mount in case a query flipped during the first paint.
    recompute();
    return () => {
      mqls.forEach((mql) => mql.removeEventListener("change", recompute));
      window.removeEventListener("resize", recompute);
    };
  }, []);

  return flags;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/__tests__/useMobileDetect.test.jsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useMobileDetect.js client/src/__tests__/useMobileDetect.test.jsx
git commit -m "feat(mobile): split useMobileDetect into isTouch + isMobileLayout"
```

---

### Task 2: Provide both flags via context (transitional `isMobile` alias)

**Files:**
- Modify: `client/src/App.jsx` (hook destructure ~269; `liveValue` memo ~765-790; `<Toolbar>` ~819; `<CommandCenter>` ~831; app-root className ~859)
- Modify: `client/src/modules/CanvasContent.jsx` (its `const { isMobile } = useMobileDetect()`)

**Interfaces:**
- Produces: `GridLiveContext` value now carries `isTouch`, `isMobileLayout`, and (transitional) `isMobile` (= `isMobileLayout`). Consumed by every downstream reader until Task 5 removes `isMobile`.

- [ ] **Step 1: Update the hook destructure in App.jsx**

At `client/src/App.jsx:269`, replace:

```jsx
  const { isMobile } = useMobileDetect();
```

with:

```jsx
  const { isTouch, isMobileLayout } = useMobileDetect();
  // Transitional alias — removed in the final routing task. Downstream layout
  // consumers still read `isMobile` until they are migrated to isMobileLayout.
  const isMobile = isMobileLayout;
```

- [ ] **Step 2: Add both flags to the `liveValue` memo**

In the `liveValue = useMemo(...)` object (App.jsx ~774) add `isTouch` and `isMobileLayout` alongside the existing `isMobile`, and add both to the dependency array (~788):

```jsx
      isProcessing,
      isMobile,
      isTouch,
      isMobileLayout,
      activeCell,
```

and in the deps array:

```jsx
      isProcessing,
      isMobile,
      isTouch,
      isMobileLayout,
      activeCell,
```

- [ ] **Step 3: Update CanvasContent destructure**

In `client/src/modules/CanvasContent.jsx`, find `const { isMobile } = useMobileDetect();` and replace with:

```jsx
  const { isMobileLayout: isMobile } = useMobileDetect();
```

(CanvasContent's mobile toolbar collapse is a layout concern; alias locally so the rest of the file is untouched here — Task 5 leaves it as-is.)

- [ ] **Step 4: Verify the app builds and existing tests pass**

Run: `cd client && npx vitest run src/__tests__/mobile-fixes.test.jsx src/__tests__/MobileGridNav.test.jsx`
Expected: PASS (unchanged behavior — `isMobile` still equals the old width semantics for ≤600, plus tablet portrait now true).

- [ ] **Step 5: Commit**

```bash
git add client/src/App.jsx client/src/modules/CanvasContent.jsx
git commit -m "feat(mobile): provide isTouch + isMobileLayout via GridLiveContext"
```

---

### Task 3: Activate touch-drag on all touch devices (THE drag fix)

**Files:**
- Modify: `client/src/helpers/dragSystem.js` (`_isMobile` helper ~41; both `_isMobile()` call sites ~563, ~792; the `getInitialDataForExternal` `!_isMobile()` guard ~792)
- Modify: `client/src/helpers/DragProvider.jsx` (`isMobile` prop → drives `touch-action:none` on drag start + edge autoscroll)

**Interfaces:**
- Consumes: nothing new.
- Produces: touch-drag path runs whenever `pointer: coarse`, in both orientations.

- [ ] **Step 1: Replace the `_isMobile` helper in dragSystem.js**

At `client/src/helpers/dragSystem.js:41`, replace:

```jsx
const _isMobile = () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
```

with:

```jsx
// Touch-drag replaces HTML5 DnD on any coarse-pointer device (phone OR tablet),
// independent of orientation/layout. Width is irrelevant — a landscape tablet
// still needs finger dragging even while it shows the desktop grid.
const _isTouch = () => window.matchMedia("(pointer: coarse)").matches;
```

- [ ] **Step 2: Update the two call sites**

At `dragSystem.js:563` change `if (_isMobile()) {` → `if (_isTouch()) {`.

At `dragSystem.js:792` (inside `getInitialDataForExternal`) change `if (!_isMobile()) {` → `if (!_isTouch()) {`.

Confirm no other `_isMobile()` references remain: `grep -n "_isMobile" client/src/helpers/dragSystem.js` should return nothing. If the import of `MOBILE_BREAKPOINT` is now unused, remove it from the import line.

- [ ] **Step 3: Route DragProvider's touch behaviors to isTouch**

In `client/src/helpers/DragProvider.jsx`, the `isMobile` prop currently guards `document.documentElement.style.touchAction = 'none'` on drag start and the drag-to-edge autoscroll. Change the prop the component receives from `isMobile` to `isTouch`.

In `client/src/App.jsx` where `<Grid ... />` is rendered (Grid forwards to DragProvider), pass `isTouch`. Find the Grid render in App.jsx and add/replace so DragProvider receives touch semantics. In `Grid.jsx` at the `<DragProvider ... isMobile={isMobile}>` site (~684) add `isTouch={isTouch}` (destructure `isTouch` from context in `GridRender`/`GridInner` alongside `isMobile`), and in `DragProvider.jsx` rename the internal usage from `isMobile` to `isTouch` for the two touch-behavior sites (leave any layout-specific use, if present, on `isMobileLayout`).

Concretely in `DragProvider.jsx`:
- Change the function signature prop `isMobile` → `isTouch`.
- Replace each `isMobile` usage that gates `touchAction`/`overscrollBehavior`/edge-autoscroll with `isTouch`.

In `Grid.jsx`, destructure `isTouch` from `useContext(GridLiveContext)` where `isMobile` is destructured (~141 in `GridRender`, ~393 in `GridInner`) and pass `isTouch={isTouch}` to `<DragProvider>`.

- [ ] **Step 4: Verify existing DragProvider test still passes**

Run: `cd client && npx vitest run src/__tests__/DragProvider.test.js`
Expected: PASS. If the test constructs `<DragProvider isMobile>`, update it to `isTouch` in the same commit.

- [ ] **Step 5: On-device check (manual, note in commit)**

On the tablet, drag an occurrence by its radial handle in BOTH orientations — it now lifts and drops. (No automated coverage for real touch; verify by hand.)

- [ ] **Step 6: Commit**

```bash
git add client/src/helpers/dragSystem.js client/src/helpers/DragProvider.jsx client/src/Grid.jsx client/src/__tests__/DragProvider.test.js
git commit -m "fix(mobile): activate touch-drag on any coarse-pointer device (tablet drag)"
```

---

### Task 4: Restore the grid-cell nav + track resizers by layout, not touch

**Files:**
- Modify: `client/src/Grid.jsx` (`MobileGridNav` gate ~712; the two `!isMobile` track-resizer blocks ~223, ~253; `isMobile` destructures ~141, ~393)
- Modify: `client/src/Toolbar.jsx` (`MiniGridMap` gate)
- Modify: `client/src/mobile/MobileGridNav.jsx` (reads `isMobile` — accept `isMobileLayout`)

**Interfaces:**
- Consumes: `isMobileLayout` from context.
- Produces: `MobileGridNav` renders when `isMobileLayout`; the grid track resizers render when NOT `isMobileLayout` (so tablet landscape shows them).

- [ ] **Step 1: Point Grid.jsx layout gates at isMobileLayout**

In `client/src/Grid.jsx`, in both `GridRender` (~141) and `GridInner` (~393) destructure `isMobileLayout` from context. Replace the layout-driving `isMobile` reads:
- The `MobileGridNav` branch selector (`isMobile ?` / `layoutTree && isMobile ?` at ~699/~712) → `isMobileLayout`.
- The two track-resizer guards `{!isMobile && [...]}` (~223, ~253) → `{!isMobileLayout && [...]}`.
- The className/margin cosmetics (~202, ~215) → `isMobileLayout`.
- Pass `isMobileLayout={isMobileLayout}` to `<MobileGridNav>` (~713-718) instead of `isMobile`.

Keep `isTouch` (from Task 3) for the DragProvider prop only.

- [ ] **Step 2: Update MobileGridNav to read isMobileLayout**

In `client/src/mobile/MobileGridNav.jsx`, rename the incoming `isMobile` prop to `isMobileLayout` and update its internal desktop-passthrough check (`if (!isMobile) return children` → `if (!isMobileLayout) return children`).

- [ ] **Step 3: Update Toolbar's MiniGridMap gate**

In `client/src/Toolbar.jsx`, the `MiniGridMap` (mobile grid mini-map, left section) is gated on `isMobile`. Destructure `isMobileLayout` from context (or from props if passed) and gate `MiniGridMap` on `isMobileLayout`.

- [ ] **Step 4: Update MobileGridNav test**

Run: `cd client && npx vitest run src/__tests__/MobileGridNav.test.jsx`
Expected: FAIL if the test passes `isMobile`. Update the test to pass `isMobileLayout` and re-run → PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/Grid.jsx client/src/Toolbar.jsx client/src/mobile/MobileGridNav.jsx client/src/__tests__/MobileGridNav.test.jsx
git commit -m "fix(mobile): gate grid nav + track resizers on isMobileLayout (portrait nav returns)"
```

---

### Task 5: Route remaining layout consumers + delete the transitional alias

**Files:**
- Modify: `client/src/modules/ModulePanel.jsx`, `client/src/modules/ModulePage.jsx`, `client/src/modules/pages/PageBoard.jsx`, `client/src/modules/pages/PageFolder.jsx`, `client/src/ui/FilterNav.jsx`, `client/src/ui/CommandCenter.jsx`, `client/src/PagePreviewApp.jsx`
- Modify: `client/src/App.jsx` (remove the `isMobile` alias + context key)
- Modify: `client/src/__tests__/mobile-fixes.test.jsx` (rename any `isMobile` context stubs)

**Interfaces:**
- Consumes: `isMobileLayout` from context everywhere a layout decision is made.
- Produces: no `isMobile` reader remains anywhere in `client/src`.

- [ ] **Step 1: Rename layout reads in each consumer**

In each file below, where it does `const { ..., isMobile } = useContext(GridLiveContext)` (or receives `isMobile` as a prop), rename to `isMobileLayout` and update every `isMobile` usage in that file to `isMobileLayout`. These are all layout/spacing decisions (padding, sidebar overlay-vs-push, autohide default, rail nav, responsive chrome):
- `modules/ModulePanel.jsx` (~115, ~336, ~412 autohide, sidebar overlays)
- `modules/ModulePage.jsx` (~277 guard handled in Task 6; layout paddings)
- `modules/pages/PageBoard.jsx`
- `modules/pages/PageFolder.jsx`
- `ui/FilterNav.jsx`
- `ui/CommandCenter.jsx` (also the `isMobile` prop from App — rename the prop to `isMobileLayout` at both the `<CommandCenter isMobile={...}>` call site in App.jsx and the component)
- `PagePreviewApp.jsx`

Also the `<Toolbar isMobile={isMobile}>` prop in App.jsx (~819) — rename to `isMobileLayout` at the call site and in `Toolbar.jsx`'s prop (the MiniGridMap already uses it from Task 4; keep the whole Toolbar prop consistent).

- [ ] **Step 2: Remove the transitional alias from App.jsx**

In `client/src/App.jsx`:
- Delete `const isMobile = isMobileLayout;` (added in Task 2).
- Remove `isMobile,` from the `liveValue` object and its deps array (leave `isTouch` and `isMobileLayout`).
- The app-root className (~859) uses `isMobile` — change to `isMobileLayout`.

- [ ] **Step 3: Verify no `isMobile` readers remain**

Run: `grep -rn "\bisMobile\b" client/src --include=*.jsx --include=*.js | grep -v "isMobileLayout"`
Expected: only matches inside `hooks/useMobileDetect.js` comments (if any) — no live variable named `isMobile`. If a live reader remains, migrate it.

- [ ] **Step 4: Run the mobile test suite**

Run: `cd client && npx vitest run src/__tests__/mobile-fixes.test.jsx src/__tests__/MobileGridNav.test.jsx src/__tests__/DragProvider.test.js src/__tests__/useMobileDetect.test.jsx`
Expected: PASS (update `mobile-fixes.test.jsx` stubs that pass an `isMobile` context value → `isMobileLayout`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(mobile): route all layout consumers to isMobileLayout; drop isMobile alias"
```

---

### Task 6: Long-press opens the context menu on touch

**Files:**
- Create: `client/src/hooks/useLongPress.js`
- Test: `client/src/__tests__/useLongPress.test.jsx` (create)
- Modify: `client/src/modules/ModuleContainer.jsx` (~803 handler), `client/src/modules/ModuleInstance.jsx` (~801), `client/src/modules/ModulePage.jsx` (~277), `client/src/modules/ModulePanel.jsx` (~529)

**Interfaces:**
- Produces: `useLongPress(onLongPress, { delayMs = 450, moveTolerance = 10 }) → handlers` where `handlers` is `{ onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }`. `onLongPress` is called with `{ x, y }` (clientX/clientY of the touch) after the finger is held `delayMs` without moving beyond `moveTolerance`px.

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/useLongPress.test.jsx`:

```jsx
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useLongPress } from "../hooks/useLongPress";

function touch(x, y) {
  return { touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] };
}

describe("useLongPress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires after the hold delay with the touch position", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { delayMs: 450 }));
    act(() => result.current.onTouchStart(touch(100, 200)));
    act(() => vi.advanceTimersByTime(450));
    expect(cb).toHaveBeenCalledWith({ x: 100, y: 200 });
  });

  it("cancels when the finger moves beyond tolerance", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { delayMs: 450, moveTolerance: 10 }));
    act(() => result.current.onTouchStart(touch(100, 200)));
    act(() => result.current.onTouchMove(touch(100, 230))); // moved 30px
    act(() => vi.advanceTimersByTime(450));
    expect(cb).not.toHaveBeenCalled();
  });

  it("cancels when the finger lifts before the delay", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { delayMs: 450 }));
    act(() => result.current.onTouchStart(touch(0, 0)));
    act(() => result.current.onTouchEnd(touch(0, 0)));
    act(() => vi.advanceTimersByTime(450));
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/__tests__/useLongPress.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `client/src/hooks/useLongPress.js`:

```jsx
import { useRef, useCallback } from "react";

// Fires onLongPress({x,y}) after the finger is held `delayMs` without moving
// beyond `moveTolerance` px. Used to open the same context menu on touch that
// right-click opens on desktop (native long-press → contextmenu is unreliable
// across tablets, so we detect it ourselves).
export function useLongPress(onLongPress, { delayMs = 450, moveTolerance = 10 } = {}) {
  const timer = useRef(null);
  const start = useRef({ x: 0, y: 0 });

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  const onTouchStart = useCallback((e) => {
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
    clear();
    timer.current = setTimeout(() => {
      timer.current = null;
      onLongPress({ x: start.current.x, y: start.current.y });
    }, delayMs);
  }, [onLongPress, delayMs, clear]);

  const onTouchMove = useCallback((e) => {
    if (!timer.current || !e.touches || !e.touches.length) return;
    const t = e.touches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    if (dx * dx + dy * dy > moveTolerance * moveTolerance) clear();
  }, [moveTolerance, clear]);

  return { onTouchStart, onTouchMove, onTouchEnd: clear, onTouchCancel: clear };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/__tests__/useLongPress.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into ModuleContainer**

In `client/src/modules/ModuleContainer.jsx`:
- Import: `import { useLongPress } from "../hooks/useLongPress";`
- The existing `onContextMenu` handler (~803) builds `setCtxMenu({ x, y, items })`. Extract its body into a callback that takes `{ x, y }`:

```jsx
  const openContextMenu = useCallback(({ x, y }) => {
    const clip = selection.clipboard;
    const pasteLabel = clip
      ? clip.mode === "move" ? `Move ${clip.ids.length} here`
        : clip.mode === "copylink" ? `Paste linked ${clip.ids.length} here`
          : `Paste ${clip.ids.length} here`
      : null;
    setCtxMenu({ x, y, items: buildContainerMenuItems({ clip, pasteLabel }) });
  }, [selection.clipboard, /* plus the deps the items closure already uses */]);
```

If refactoring the items array into `buildContainerMenuItems` is too invasive, instead keep the inline object but call a shared function: change the `onContextMenu` prop to:

```jsx
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openContextMenu({ x: e.clientX, y: e.clientY });
        }}
```

and REMOVE the `if ("ontouchstart" in window) return;` guard (line ~804). Move the entire item-array construction into `openContextMenu` so both the mouse handler and the long-press hook produce the same menu.

- Add the long-press handlers to the same container shell element that has `onContextMenu`:

```jsx
  const longPress = useLongPress(openContextMenu);
```

Spread `{...longPress}` onto the container shell div (the element currently carrying `onContextMenu`).

- [ ] **Step 6: Wire into ModuleInstance, ModulePage, ModulePanel**

Repeat the Step-5 pattern in each:
- `modules/ModuleInstance.jsx` (~801): extract the menu body into `openContextMenu({x,y})`, remove the `"ontouchstart" in window` bail, add `const longPress = useLongPress(openContextMenu);` and spread `{...longPress}` on the instance row element that owns `onContextMenu`.
- `modules/ModulePage.jsx` (~277): same.
- `modules/ModulePanel.jsx` (~529): same.

For each, the mouse `onContextMenu` becomes:

```jsx
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openContextMenu({ x: e.clientX, y: e.clientY }); }}
```

- [ ] **Step 7: On-device check + full suite**

Run: `cd client && npx vitest run src/__tests__/useLongPress.test.jsx`
Expected: PASS. On the tablet, long-press a container/instance/page/panel → the context menu opens at the finger.

- [ ] **Step 8: Commit**

```bash
git add client/src/hooks/useLongPress.js client/src/__tests__/useLongPress.test.jsx client/src/modules/ModuleContainer.jsx client/src/modules/ModuleInstance.jsx client/src/modules/ModulePage.jsx client/src/modules/ModulePanel.jsx
git commit -m "feat(mobile): long-press opens context menus on touch (useLongPress)"
```

---

### Task 7: "Add item…" opens the QuickAddMenu from the long-press menu

**Files:**
- Modify: `client/src/modules/ModuleContainer.jsx` (the menu items built in Task 6 + a QuickAddMenu open flag)

**Interfaces:**
- Consumes: existing `QuickAddMenu` (already mounted in the container header ~1128) and `onAdd` / `handleQuickAddPick` (~445-458).
- Produces: `QuickAddMenu` gains an `openTrigger` prop (a number; incrementing it opens the menu). A context-menu row `Add item…` increments it, distinct from the existing direct-create `Add new item here`.

Note: `QuickAddMenu` owns its `open` state internally (`useState(false)` at ~63) and has no controlled `open` prop — it exposes `onOpenChange` only and repositions relative to its own anchor button. So add an imperative `openTrigger` rather than lifting state.

- [ ] **Step 1: Add an `openTrigger` prop to QuickAddMenu**

In `client/src/ui/QuickAddMenu.jsx`, add `openTrigger = 0` to the destructured props (the signature at ~57 — `export default function QuickAddMenu({ targetRole, onSelect, onCreateNew, createLabel, onAddTextblock, hostOccurrence = null, onOpenChange, openTrigger = 0 })`). Then, after the existing `handleOpen`/`reposition` definitions, add an effect that opens the menu when `openTrigger` changes (skipping the initial mount):

```jsx
  const firstTriggerRef = useRef(true);
  useEffect(() => {
    if (firstTriggerRef.current) { firstTriggerRef.current = false; return; }
    if (!open) { reposition(); setOpen(true); }
  }, [openTrigger]); // eslint-disable-line react-hooks/exhaustive-deps
```

(`useRef`, `useEffect`, `reposition`, `open`, `setOpen` all already exist in the file.)

- [ ] **Step 2: Wire it in ModuleContainer**

In `client/src/modules/ModuleContainer.jsx` add state:

```jsx
  const [quickAddTrigger, setQuickAddTrigger] = useState(0);
```

Pass it to the existing `<QuickAddMenu ... />` (~1128): add `openTrigger={quickAddTrigger}`.

In the `openContextMenu` items array (from Task 6), directly after the existing `Add new item here` entry, add:

```jsx
              {
                label: "Add item…",
                icon: Plus,
                onClick: () => setQuickAddTrigger((n) => n + 1),
              },
```

(`Plus` is already imported.) Caveat: the QuickAddMenu anchors to its header `+` button; when the header is retracted on mobile it still opens but may anchor near the top edge — acceptable, the menu is a fixed-position portal.

- [ ] **Step 3: Verify build + on-device**

Run: `cd client && npx vitest run src/__tests__/mobile-fixes.test.jsx`
Expected: PASS. On the tablet, long-press a container → "Add item…" → the QuickAddMenu module picker opens.

- [ ] **Step 4: Commit**

```bash
git add client/src/modules/ModuleContainer.jsx client/src/ui/QuickAddMenu.jsx
git commit -m "feat(mobile): 'Add item…' in long-press menu opens QuickAddMenu"
```

---

### Task 8: Panel header lip — tap-to-toggle on mobile layout

**Files:**
- Modify: `client/src/modules/ModulePanel.jsx` (autohide gate ~412; retracted-lip affordance ~1197-1223)

**Interfaces:**
- Consumes: `isMobileLayout` (from Task 5), existing `headerRevealed` state + `.panel-header-lip`.
- Produces: on `isMobileLayout`, the header retracts and a tappable lip toggles it.

- [ ] **Step 1: Stop force-disabling autohide on mobile**

At `client/src/modules/ModulePanel.jsx:412`, replace:

```jsx
  const autohide = isMobileLayout ? false : !!panelOccurrence?.meta?.autohide;
```

with:

```jsx
  // On touch/mobile the header retracts like desktop autohide, revealed by a
  // tappable lip (hover doesn't exist). Desktop keeps the per-panel setting.
  const autohide = isMobileLayout ? true : !!panelOccurrence?.meta?.autohide;
```

- [ ] **Step 2: Make the lip tap-to-toggle**

In the retracted-lip block (~1197-1223), the visible lip currently has `onMouseEnter`/`onClick` → `setHeaderRevealed(true)`. Add an `onClick` that TOGGLES (so a second tap retracts), and ensure it responds to touch (an `onClick` fires on tap). Replace the lip's `onClick={() => setHeaderRevealed(true)}` with:

```jsx
                    onClick={() => setHeaderRevealed((v) => !v)}
```

Also, when `isMobileLayout` is true, the header cluster's `onMouseLeave` auto-retract (~1170) should NOT fire on touch (there is no mouse-leave; keep the header open until the lip is tapped again). Guard it:

```jsx
              onMouseLeave={() => { if (autohide && !isMobileLayout) setHeaderRevealed(false); }}
```

- [ ] **Step 3: Ensure a revealed header on mobile shows a re-hide affordance**

When `headerRevealed` is true on `isMobileLayout`, the top invisible strip + lip are not rendered (guarded by `!headerRevealed`). Add a small always-present chevron toggle inside the header cluster on mobile so the user can retract without a hover-out. Simplest: render the lip regardless of `headerRevealed` on mobile, flipping its chevron:

At the affordance guard (~1197) change `{autohide && !headerRevealed && (` to:

```jsx
              {autohide && (!headerRevealed || isMobileLayout) && (
```

and make the chevron reflect state:

```jsx
                    <ChevronDown size={10} style={{ opacity: 0.55, transform: headerRevealed ? "rotate(180deg)" : "none" }} />
```

- [ ] **Step 4: Verify build + on-device**

Run: `cd client && npx vitest run src/__tests__/mobile-fixes.test.jsx`
Expected: PASS. On the tablet, the panel header is retracted with a lip; tap reveals, tap again retracts.

- [ ] **Step 5: Commit**

```bash
git add client/src/modules/ModulePanel.jsx
git commit -m "feat(mobile): tap-to-toggle panel header lip on mobile layout"
```

---

### Task 9: Panel resize — touch-friendly, grab-anywhere edge zone

**Files:**
- Modify: `client/src/ResizeHandle.jsx` (grab-zone size + pointer events)

**Interfaces:**
- Consumes: existing `handleStart` (already binds mouse AND touch — verified at `ResizeHandle.jsx:85-88, 92-94`).
- Produces: a larger, finger-friendly grab area; unchanged resize math.

- [ ] **Step 1: Widen the grab zone**

In `client/src/ResizeHandle.jsx`, the handle is an 18×18 corner. Enlarge the touch target without moving the visual nub. Replace the wrapper `<div>` style block (the `width: 18, height: 18, ...` object) with a larger transparent hit area that keeps the visible chevron in the corner:

```jsx
      style={{
        width: 44,
        height: 44,
        cursor: "nwse-resize",
        background: "transparent",
        touchAction: "none",
        pointerEvents: "auto",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "flex-end",
        flexShrink: 0,
        marginLeft: "auto",
        // Pull the oversized hit area partly off the panel's inner edge so it
        // straddles the bottom-right corner without eating panel content.
        marginRight: -6,
        marginBottom: -6,
      }}
```

and wrap the existing SVG nub in a small visible chip so the enlarged zone stays discoverable:

```jsx
      <div style={{
        width: 18, height: 18,
        background: "rgba(100,120,150,0.6)",
        borderTopLeftRadius: 6,
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: 0.7,
      }}>
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.5 }}>
          <path d="M10 0 L10 10 L0 10 Z" fill="white" />
        </svg>
      </div>
```

Remove the now-redundant `onMouseEnter`/`onMouseLeave` opacity toggles on the outer div (the outer div is transparent).

- [ ] **Step 2: Confirm touch events already flow**

Verify `handleStart` reads `e.touches?.[0]` (it does, line ~17-18) and that `document` listeners include `touchmove`/`touchend` (they do, lines ~85-88). No change needed — the enlarged zone + existing touch binding is the fix.

- [ ] **Step 3: Verify build + on-device**

Run: `cd client && npx vitest run` (full suite, to catch any snapshot referencing ResizeHandle)
Expected: PASS. On the tablet in landscape (desktop grid), drag the panel's bottom-right corner region — resize follows the finger.

- [ ] **Step 4: Commit**

```bash
git add client/src/ResizeHandle.jsx
git commit -m "feat(mobile): enlarge panel resize grab zone for touch"
```

---

### Task 10: Finger-sized menu targets under coarse pointers

**Files:**
- Modify: `client/src/index.css` (append a `@media (pointer: coarse)` block)

**Interfaces:**
- Consumes: existing menu class names — `.radial-menu`/`.radial-handle`/radial arc items, `ContextMenu` rows (portal `div` children), `.quick-add-btn`/QuickAddMenu rows, `.panel-header-lip`.
- Produces: ≥44px hit areas on touch; visuals unchanged on desktop.

- [ ] **Step 1: Add a class to ContextMenu rows**

The context-menu rows are class-less `<button>` elements (inline-styled, `ui/ContextMenu.jsx` ~76). Add `className="context-menu-item"` to that per-item `<button>` so the media query can reach it:

```jsx
          <button
            key={item.label}
            className="context-menu-item"
            onClick={() => { item.onClick?.(); onClose(); }}
```

The radial handle uses `.module-drag-handle .radial-handle`, quick-add uses `.quick-add-btn`, and the lip uses `.panel-header-lip` (all confirmed present in `index.css`).

- [ ] **Step 2: Add the coarse-pointer block**

Append to `client/src/index.css`:

```css
/* =============================================================================
   Touch targets — enlarge interactive affordances on coarse-pointer devices.
   Desktop (fine pointer) is unaffected.
   ============================================================================= */
@media (pointer: coarse) {
  .module-drag-handle .radial-handle {
    width: 30px !important;
    height: 30px !important;
    max-width: 30px !important;
  }
  .radial-menu .radial-item,
  .radial-menu button {
    min-width: 40px;
    min-height: 40px;
  }
  .context-menu-item {
    min-height: 40px;
    display: flex;
    align-items: center;
  }
  .quick-add-btn {
    min-width: 34px;
    min-height: 34px;
  }
  .panel-header-lip {
    width: 64px;
    height: 16px;
  }
}
```

- [ ] **Step 3: Verify build + on-device**

Run: `cd client && npx vitest run src/__tests__/mobile-fixes.test.jsx`
Expected: PASS. On the tablet, radial arc items, context-menu rows, and quick-add are comfortably tappable.

- [ ] **Step 4: Commit**

```bash
git add client/src/index.css client/src/ui/ContextMenu.jsx
git commit -m "feat(mobile): finger-sized menu targets under coarse pointers"
```

---

## Final verification

- [ ] Run the full client suite: `cd client && npx vitest run`. Expected: green (or only pre-existing unrelated failures, noted).
- [ ] `grep -rn "\bisMobile\b" client/src --include=*.jsx --include=*.js | grep -v isMobileLayout` → no live readers.
- [ ] On-device (tablet) end-to-end: portrait shows grid-switch buttons; landscape shows desktop grid; drag an occurrence by its radial handle in both orientations; long-press opens the context menu; "Add item…" opens QuickAddMenu; tap the header lip to reveal/hide; resize a panel by touch in landscape; menu items are comfortably tappable.
- [ ] Update `client/src/CLAUDE.md` + `client/src/hooks`/`mobile` notes with the `isTouch`/`isMobileLayout` split.
