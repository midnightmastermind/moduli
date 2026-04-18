# Command Center Rework — Design

**Date:** 2026-04-18
**Author:** session with Josh
**Scope:** `client/src/ui/CommandCenter.jsx` + `client/src/ui/commandCenter/**`, plus a new `Shortcut` model on the server. Panel-side trees (`modules/ManifestTree.jsx`, page trees, `ModuleContainer.jsx`) are explicitly out of scope and stay as-is.

---

## Problem

The command center has four concrete problems:

1. **Slow-feeling open.** `max-height` transition reflows every frame. Lazy-loaded tabs then show a blank Suspense frame while the chunk downloads.
2. **Content stretches full-width on desktop.** No max-width on any tab. In particular, the Field detail editor's name input (`FieldsTab.jsx:152`) spans the whole screen.
3. **Dead / duplicated tabs.** `Components`, `Entities (tree)`, and `Files` duplicate functionality that already lives in the panel-side tree framework. `Recycle Bin` + `Templates` are embedded inside `EntityTreeTab` instead of being first-class tabs.
4. **Shortcuts are read-only doc.** The tab lists shortcuts but keystrokes are hardcoded in ~20 files. Users can't rebind.

Also: shared styles (`inputStyle`, `labelStyle`, section chrome) are copy-pasted across 13 tab files — DRY violation.

## Goals

- Open feels snappy (~200ms slide, content already present).
- Each tab's content is centered and width-capped appropriately.
- Field name input no longer stretches across the screen.
- Tab roster reflects what's actually useful; duplication removed.
- Users can rebind a curated set of global shortcuts.
- Shared primitives extracted into one file; each tab is smaller and consistent.

## Non-goals

- Breaking up the fat tabs (`OperationsTab` 873 lines, `FieldsTab` 533 lines) into per-concern sub-files. That's a follow-up.
- Refactoring all 20 inline keydown handlers. Only the curated shortcut actions move to the registry.
- Changing any panel-side tree, drag provider, socket handler (except the two new shortcut handlers), or editor behavior.
- Schema changes to Module. `trashed: boolean` already exists and already has server handlers — we only consume it.

---

## Section 1 — Slide-out animation

### Current behavior

`CommandCenter.jsx:72-86` uses `max-height: 0 → 50vh` transition. Drawer mounts lazily. `Suspense fallback={null}` — no placeholder while the active tab's chunk loads.

### New behavior

- Drawer always mounted at its natural height (50vh desktop / 70vh mobile). Wrapper uses `transform: translateY(-100%) → translateY(0)` with `will-change: transform`. Duration ~200ms, easing `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Parent wrapper gets `overflow: hidden` so the offscreen drawer doesn't paint above the toolbar.
- On close-transition-end, apply `visibility: hidden` so hit-tests don't hit the closed drawer. On open, clear visibility immediately.
- Keep the mobile `0.12s` quicker transition but still via transform.

### Preloading (kills the Suspense blank frame)

- `App.jsx` (root): on mount, schedule `requestIdleCallback(() => { import("./ui/commandCenter/FieldsTab"); import("./ui/commandCenter/OperationsTab"); import("./ui/commandCenter/FiltersTab"); import("./ui/commandCenter/GridSettingsTab"); })` — the 4 most-used tabs warm on first idle.
- `Toolbar.jsx`: the Command Center button fires a one-shot `onPointerEnter` / `onFocus` that imports the rest of the tab chunks. Guard with a `preloadedAllRef` so it fires once per session.

Net: opens with a GPU slide, the active tab's chunk is almost always cached, Suspense fallback stays `null`.

---

## Section 2 — Tab layout & centering

### New shared shell

```jsx
// client/src/ui/commandCenter/ui.jsx
export function TabShell({ width = "narrow", children }) {
  const max = width === "wide" ? 960 : 640;
  return (
    <div style={{ maxWidth: max, margin: "0 auto", padding: "14px 18px", width: "100%", boxSizing: "border-box" }}>
      {children}
    </div>
  );
}
```

### Width assignments

| Tab | Width | Reason |
|---|---|---|
| Grid | narrow (640) | Settings form |
| Appearance | narrow | Settings form |
| User Settings | narrow | Settings form |
| Shortcuts | narrow | List of rows |
| Connections | narrow | File-picker list |
| Lists | narrow | Short form |
| Fields | wide (960) | Category columns |
| Operations | wide | Editor + log split |
| Filters | wide | Condition groups |
| Templates | wide | List of pills |
| Trash | wide | Role-grouped list |

Mobile: `TabShell` is `width: 100%`; the max-width cap is naturally ineffective below the breakpoint.

### Fixing the field name input (and every other form input)

`FieldDetail` is reshaped into a labelled grid:

```jsx
<TabShell width="wide">
  <Section title="Field">
    <FormGrid>        {/* max-width: 480px */}
      <Field label="Name"><TextInput value={local.name} onChange={...} /></Field>
      <Field label="Type"><SelectInput ... /></Field>
      <Field label="Unit"><TextInput ... /></Field>
      ...
    </FormGrid>
  </Section>
</TabShell>
```

`Field` is `display: grid; grid-template-columns: 120px 1fr;`. `FormGrid` wraps the set with `max-width: 480px`. The name input is no longer the first bare `<input width:100%>` eating the viewport.

Same pattern goes into `OperationEditor`, `FilterEditor`, `GridSettingsTab`, `UserSettingsTab`.

### Shared primitives (all in `commandCenter/ui.jsx`)

- `TabShell({ width, children })`
- `Section({ title, children })` — title + top border + inner padding
- `FormGrid({ children, maxWidth = 480 })` — stacks `Field`s
- `Field({ label, children })` — 120px label + 1fr input
- `Row({ gap, children })` — horizontal flex with gap
- `TextInput`, `NumberInput`, `SelectInput`, `Toggle` — wrappers around native `<input>` / `<select>` that pull a single shared `inputStyle` object
- `TemplatePill` — moved here (used by Templates tab)

Tabs import from `./ui`. Each tab's local `inputStyle` / `labelStyle` constants are deleted.

---

## Section 3 — Tab roster

### Final list (11 tabs)

| id | Label | Icon | Source |
|---|---|---|---|
| `grid` | Grid | LayoutGrid | existing |
| `fields` | Fields | Settings2 | existing (rewrapped) |
| `operations` | Operations | Workflow | existing (rewrapped) |
| `filters` | Filters | Filter | existing (rewrapped) |
| `templates` | Templates | BookMarked | **NEW** |
| `appearance` | Appearance | Palette | existing |
| `connections` | Connections | Link2 | existing |
| `trash` | Trash | Trash2 | **NEW** |
| `lists` | Lists | List | existing |
| `settings` | User Settings | User | existing |
| `shortcuts` | Shortcuts | Keyboard | **REWRITTEN** |

### Removed tabs

- `tree` (EntityTreeTab) — duplicates panel-side root/local trees.
- `files` (FilesTab) — duplicates panel-side tree framework.
- Components (already being replaced in this rework).

`EntityTreeTab.jsx`, `FilesTab.jsx`, `ComponentsTab.jsx` are deleted. Their tab entries and lazy imports are removed from `CommandCenter.jsx`.

### New: Templates tab

- Source: `grid.templates` (existing).
- UI: list of `TemplatePill` rows (drag-to-container to fill).
- Renaming + deleting lifted from ComponentsTab. Same `update_grid` commit path.

### New: Trash tab

- Source: `Object.values(modulesById).filter(m => m.trashed)`.
- Grouped by role: Panels / Containers / Instances / Pages. Empty groups hidden.
- Row: role icon + label + **Restore** (RotateCcw, calls `CommitHelpers.restoreModule`) + **Permanently delete** (Trash2 red, `window.confirm` then `CommitHelpers.deleteModule`).
- Empty state: "Nothing in the trash."
- Auto-purge is explicitly deferred.

### What stays untouched (panel-side)

- `modules/ManifestTree.jsx` — root/local tree sidebars.
- `modules/pages/*` — page tree.
- `modules/ModuleContainer.jsx` / `ModulePanel.jsx` / `ModulePage.jsx` — rendering.
- `DragProvider.jsx` — drag wiring.

---

## Section 4 — Shortcuts (editable, curated set)

### Server

**New file `server/models/Shortcut.js`:**

```js
{
  id: String,           // uid
  userId: String,       // owner
  actionId: String,     // e.g. "undo", "redo", "openCommandCenter"
  binding: String,      // serialized key combo, e.g. "Ctrl+Z", "Shift+Alt+K"
  enabled: Boolean,     // default true
}
```

Index: `{ userId: 1, actionId: 1 }` unique.

**Defaults** seeded via `createDefaultUserData.js` (new users) AND a one-shot `ensureDefaultShortcuts(userId)` helper called during login (existing users). The helper iterates the defaults table below and inserts any missing `(userId, actionId)` pair — it's idempotent and safe to run on every login.

| actionId | default binding | purpose |
|---|---|---|
| `undo` | `Ctrl+Z` | global undo |
| `redo` | `Ctrl+Y` | global redo |
| `redoAlt` | `Ctrl+Shift+Z` | alt redo |
| `openCommandCenter` | `Ctrl+.` | toggle CC |
| `closeAll` | `Escape` | close CC / dialogs |
| `prevFilter` | `Ctrl+[` | cycle filters |
| `nextFilter` | `Ctrl+]` | cycle filters |
| `togglePomodoro` | `Ctrl+Shift+P` | pomodoro |
| `zoomOutGrid` | `Ctrl+Shift+M` | minigrid toggle |
| `focusSearch` | `Ctrl+K` | seeded only — no consumer yet; first rebindable shortcut we wire once a global search lands |

**Socket handlers (`server/socketHandlers/shortcuts.js`, new):**

- `update_shortcut`: `{ actionId, binding, enabled }` → upsert. Broadcasts `shortcut_updated` to user room.
- `reset_shortcut`: `{ actionId }` → reverts to default. Broadcasts.

Load: `full_state` includes `shortcutsById` keyed by `actionId`.

### Client

- `state/masterReducer.js`: handle `shortcut_updated`, store under `state.shortcutsById[actionId]`.
- `helpers/CommitHelpers.js`: `updateShortcut({ actionId, binding })`, `resetShortcut({ actionId })`.
- `hooks/useShortcut.js` (new):

  ```jsx
  useShortcut("undo", (e) => { e.preventDefault(); undo(); }, [undo]);
  ```

  Reads the binding from `GridLiveContext` (shortcuts change infrequently, piggybacking on the existing live context is fine). Installs a document-level `keydown` listener, matches on the binding string, skips when focus is in input/textarea/contentEditable (unless `allowInFields: true`).

- `App.jsx`: replace inline `e.key === "z" && (e.ctrlKey||e.metaKey)` handlers with `useShortcut("undo", undo)` / `useShortcut("redo", redo)` / `useShortcut("redoAlt", redo)`.
- `App.jsx`: the global Escape handler (closes CC / dialogs) becomes `useShortcut("closeAll", ...)`. Inline Escape handlers inside `RadialMenu.jsx` and `QuickAddMenu.jsx` stay local — they're component-internal dismiss logic, not a global action.
- `Toolbar.jsx`: `Ctrl+[` / `Ctrl+]` become `useShortcut("prevFilter", ...)` / `useShortcut("nextFilter", ...)`.
- `Toolbar.jsx`: CC button uses `useShortcut("openCommandCenter", toggle)`.

### Editable UI

`ShortcutsTab.jsx` rewrite:

- Rows list the curated action set. Each row:
  - Action label (`"Undo"`, `"Redo"`, etc. — hardcoded action-label map in the tab file since there's ~10 of them).
  - Current binding shown as a keycap-styled span.
  - Click binding → enters "press keys…" state. Next `keydown` captures modifier set + key, formats to `"Ctrl+Shift+Z"`. Enter/Escape cancels.
  - Commit via `CommitHelpers.updateShortcut`.
  - "Reset" button per row.
- Conflict detection: before saving, check no other action has the same binding. If yes, show inline warning + offer "Swap" (reassign the other to its default).
- Static-doc sections for TipTap shortcuts and drag shortcuts stay, marked "built-in — not rebindable" under the editable list.

---

## Data flow summary

### Trash

- Delete module → existing `trash_module` socket handler sets `trashed: true`.
- Trash tab reads `modulesById` live, filters by `trashed`.
- Restore → `restoreModule` helper → `trashed: false`.
- Permanently delete → existing `deleteModule` helper → hard delete.

### Templates

- Read `grid.templates` live.
- Rename → `CommitHelpers.updateGrid` with new templates array.
- Delete → same.
- Drag → `draggable` with `{ type: "template", ... }`. DragProvider handles drop.

### Shortcuts

- Load → `full_state.shortcutsById`.
- Rebind → `CommitHelpers.updateShortcut` → server upsert → broadcast → reducer updates `shortcutsById` → every `useShortcut` consumer re-binds.

---

## Testing plan

### Unit
- `TabShell` width caps at 640 / 960.
- `Field` renders label + input in grid.
- Shortcut binding matcher: `"Ctrl+Shift+Z"` matches `{ ctrlKey, shiftKey, key: "z" }`; rejects plain `"z"`.
- Conflict detection returns a conflicting action when two map to same binding.

### Integration
- Open CC → confirm slide + active tab content visible (no blank frame).
- Trash a module from a panel → appears in Trash tab. Restore → reappears in grid.
- Rename a template in Templates tab → persists after reload.
- Rebind `undo` to `Ctrl+Shift+Z` → Undo works on new keys; old `Ctrl+Z` no longer triggers Undo.
- Reset all shortcuts → defaults restored.

### Manual
- Resize window from 320px (mobile) → 2560px (4K) on Fields/Operations tabs; confirm centering.
- Field name input no longer spans past 480px.
- Dev server runs, no console errors, existing Playwright suite passes.

---

## Rollout

Single branch. Order:

1. Server: add `Shortcut` model + handlers + defaults in `createDefaultUserData`. Add to `full_state` payload.
2. Client state: reducer + context + `useShortcut` hook.
3. Client primitives: `commandCenter/ui.jsx`.
4. Client: slide animation + preload.
5. Tab roster: delete 3 files, add Templates + Trash, update `CommandCenter.jsx`.
6. Rewrap existing tabs with `TabShell` + primitives.
7. Rewrite `ShortcutsTab` + migrate inline keydowns to `useShortcut` call sites.
8. Update `client/src/ui/CLAUDE.md` + `client/src/CLAUDE.md` + `server/CLAUDE.md` with deletions, new files, and tab list.
9. Ship behind no flag — no risky surface area; regressions caught by running the app.

---

## Open follow-ups (out of scope)

- Auto-purge trashed modules after N days.
- Broad shortcut refactor (every keydown through the registry).
- Splitting `OperationsTab`, `FieldsTab`, `EntityTreeTab` into sub-files.
- Tab drag-reorder / user-pinned tabs.
