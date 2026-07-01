# Mobile / Touch Optimization — Design

_Date: 2026-06-30 · Branch: `mobile-touch-optimization`_

## Problem

On a tablet, occurrences don't drag and the mobile grid-cell switch buttons are
missing. Root cause: "mobile" is defined by a single width test —
`MOBILE_BREAKPOINT = 600`, i.e. `matchMedia("(max-width: 600px)")` in
`hooks/useMobileDetect.js`. Every mobile behavior hangs off that one `isMobile`
flag, which is lifted in `App.jsx` and distributed via `GridLiveContext`.

A tablet is wider than 600px, so it reports as **desktop** and gets neither the
touch-drag path nor the mobile grid nav:

- **Touch-drag** (`helpers/dragSystem.js`) only activates when `_isMobile()` is
  true; otherwise desktop HTML5 drag is used, which does nothing under a finger.
  → dragging an occurrence's radial handle on the tablet does nothing.
- **`MobileGridNav`** (the single-cell viewport + switch buttons) only renders
  when `isMobile` is true. → gone on the tablet.

Everything mobile already exists and works — it is just locked behind a
phone-width threshold the tablet never crosses.

The drag handle itself is **not** the problem. The handle is the **RadialMenu**,
the single uniform affordance on every occurrence (panel / container / instance
alike) — `.module-drag-handle .radial-menu`. Its touch listeners already attach
in `dragSystem.js` (`triggerEl = handleEl`); they simply never run on the tablet
because `_isMobile()` is false there.

## Goals

1. Touch input (drag, tap targets) works on any touch device — phone **and**
   tablet — in **both** orientations.
2. Layout adapts by orientation on the tablet: **landscape → desktop grid**,
   **portrait → mobile** single-cell nav. Phones stay mobile in both
   orientations.
3. The specific reported gaps are closed: occurrences drag, panels resize by
   touch with a forgiving grab zone, menus have finger-sized targets, the
   retracted panel header has a tappable lip, and quick-add is reachable from the
   long-press menu (no hover affordances on touch).

## Non-goals

- No change to the drag/drop data model, occurrence architecture, or the
  RadialMenu's identity as the shared handle.
- No new desktop behavior beyond keeping today's narrow-window degradation.
- Not redesigning the mobile single-cell nav (`MobileGridNav`) itself — only
  re-gating when it shows.

---

## Core change: split one flag into two

`hooks/useMobileDetect.js` returns two orthogonal signals instead of one
`isMobile`:

- **`isTouch`** = `matchMedia("(pointer: coarse)")`. "This is a finger device."
  Drives touch-drag + finger-sized targets. On in both orientations on a tablet.
- **`isMobileLayout`** = `(isTouch && (isPortrait || width < 980)) || width <= 600`.
  Drives the single-cell nav / switch buttons / stacked panels / mobile spacing.
  The `width <= 600` fallback preserves today's narrow-desktop-window
  degradation.

`isPortrait` derives from `matchMedia("(orientation: portrait)")`. All three
listen for changes (orientation flip, window resize, pointer change) and update
state, same pattern as the current hook.

### Behavior matrix

| Device / orientation | isTouch | isMobileLayout | Result |
|---|---|---|---|
| Tablet landscape | ✅ | ❌ | Desktop grid; drag & resize by touch |
| Tablet portrait | ✅ | ✅ | Mobile single-cell nav |
| Phone (either) | ✅ | ✅ | Mobile single-cell nav |
| Desktop | ❌ | ❌ | Desktop, mouse |
| Desktop narrow (≤600) | ❌ | ✅ | Mobile layout (legacy degradation) |

### Distribution

`App.jsx` computes both from `useMobileDetect()` and provides both through
`GridLiveContext` (today it provides only `isMobile`). Direct props that pass
`isMobile` (App.jsx lines ~819, ~831) pass whichever flag that consumer needs.

### Consumer audit

Every current `isMobile` reader is routed to the correct flag. **Touch
behaviors → `isTouch`. Layout switches → `isMobileLayout`.**

| File | Current use | New flag |
|---|---|---|
| `helpers/dragSystem.js` (`_isMobile()`, 2 sites) | choose touch-drag path | **isTouch** |
| `helpers/DragProvider.jsx` | `touch-action:none` on drag start, edge autoscroll | **isTouch** |
| `Grid.jsx` | wrap in `MobileGridNav`; hide resize handles | **isMobileLayout** (nav); resize handle visibility keyed to desktop-grid + made touch-capable — see §Resize |
| `mobile/MobileGridNav.jsx` | the nav itself | **isMobileLayout** |
| `mobile/MiniGridMap.jsx` + `Toolbar.jsx` | mini-map toggle for the nav | **isMobileLayout** |
| `modules/ModulePanel.jsx` | autohide force-off, sidebar overlay vs push, margins, header lip | **isMobileLayout** (+ lip tap → §Header lip) |
| `modules/ModulePage.jsx`, `pages/PageBoard.jsx`, `pages/PageFolder.jsx` | padding, rail nav | **isMobileLayout** |
| `modules/CanvasContent.jsx` | collapse toolbar to dropdown | **isMobileLayout** (targets via `isTouch` CSS) |
| `ui/CommandCenter.jsx`, `ui/FilterNav.jsx` | responsive chrome | **isMobileLayout** |
| `App.jsx` | app-root padding/border | **isMobileLayout** |
| `PagePreviewApp.jsx` | preview chrome | **isMobileLayout** |
| `__tests__/*` | existing mobile tests | update to new flags |

This audit is the bulk of the work. Symptoms resolve the moment
`helpers/dragSystem.js` and `helpers/DragProvider.jsx` read `isTouch` (drag works
on the tablet, both orientations) and `Grid.jsx` reads `isMobileLayout` (switch
buttons return in portrait).

---

## Feature slices (build on the core change)

### 1. Occurrences drag — verify the shared radial handle

With touch-drag active on the tablet, the radial handle's existing touch
listeners fire. Confirm the tap-vs-drag split on that one handle:

- **Quick tap → opens the RadialMenu** (no drag).
- **Press-and-drag → moves the occurrence** (existing 80ms hold + 8px threshold
  in `dragSystem.js`).

If a tap still fails to open the menu or a drag opens the menu instead, fix the
collision (likely the RadialMenu's own pointer/click handler vs. the touch-drag
listener on the same element). Verify on-device in both orientations.

### 2. Resize panels — touch + grab-anywhere

`ResizeHandle.jsx` today binds only `mousemove`/`mouseup` and presents a tiny
corner target; `Grid.jsx` hides it entirely on mobile.

- Add **pointer/touch events** (`pointermove`/`pointerup` or
  `touchmove`/`touchend`) alongside mouse so it drags under a finger.
- Widen the grab affordance from a corner pixel to a generous **bottom edge +
  right edge + corner** zone (invisible hit area, ~16–24px band), so "grab
  anywhere" on the panel's resize edges works.
- Show the handle whenever the **desktop grid** shows (so: tablet landscape).
  Portrait single-cell nav has no panel resize (one cell fills the viewport).

### 3. Menus — finger-sized targets

Gated on `@media (pointer: coarse)` (i.e. `isTouch`), raise hit areas to ≥44px:
RadialMenu arc items, `ContextMenu` rows, `HeaderDropdown` / `QuickAddMenu` /
`Select` / drilldown picker rows. Mostly CSS; a few components may need a
`data-touch` hook if a media query can't reach them.

### 4. Panel header lip on mobile

Today `ModulePanel.jsx` force-disables autohide on mobile
(`autohide = isMobile ? false : ...`). Change so that on `isMobileLayout` the
header **retracts** like desktop autohide, and the existing centered
`.panel-header-lip` tab renders at the top-center as a **tap-to-toggle** button
(not hover). Tapping the lip reveals the header; tapping again (or tapping a
close affordance) retracts it. This is the "button lip where the hover spot is."

### 5. Quick-add via long-press

Hover affordances (`InsertGap`'s `+` lines, header `+` reveal) never appear on
touch. Add an **"Add item"** row to the container/page long-press `ContextMenu`
that opens the existing `QuickAddMenu` anchored at that occurrence. (Note: a
related menu redesign spec exists at
`docs/superpowers/specs/2026-06-28-add-occurrence-menu-redesign-design.md` —
reuse its add-menu wiring where it overlaps.)

---

## Testing

- **Unit**: `useMobileDetect` returns correct `{ isTouch, isMobileLayout }` for
  each matchMedia combination (portrait/landscape × coarse/fine × width bands).
  Update `__tests__/mobile-fixes.test.jsx`, `MobileGridNav.test.jsx`,
  `DragProvider.test.js` to the new flags.
- **On-device (tablet)**: drag an occurrence by its radial handle in landscape
  (desktop grid) and portrait (mobile nav); tap the handle opens the radial
  menu; resize a panel by touch in landscape; switch grid cells in portrait;
  tap the header lip to reveal/hide; long-press a container → "Add item" opens
  quick-add; menu items are comfortably tappable.
- Desktop regression: no mobile layout at normal widths; ≤600px still degrades.

## Rollout / order

1. **Flag split + consumer audit** (`useMobileDetect`, `App.jsx`,
   `GridLiveContext`, `dragSystem.js`, `DragProvider.jsx`, `Grid.jsx`, all
   layout consumers, tests). Unblocks drag + grid buttons on the tablet.
2. Radial-handle tap-vs-drag verification/fix.
3. Panel header lip tap-to-toggle on mobile.
4. Resize touch + grab zone.
5. Menu touch targets.
6. Quick-add in long-press menu.
