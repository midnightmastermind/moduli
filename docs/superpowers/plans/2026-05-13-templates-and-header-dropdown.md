# Templates & Header Dropdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragmented filter UI with a single header dropdown that hosts filter and template controls; rebuild templates as deep-cloneable nested subtrees; rewrite `Schedule: Build Day` to use APPLY_TEMPLATE.

**Architecture:** A new `HeaderDropdown` portal lives on Panel/Page/Container headers. Templates become real occurrence subtrees inside a per-grid Templates manifest; `apply_template` deep-clones them into normal hierarchy. A new `APPLY_TEMPLATE` pipeline action enables ops to seed structure from a template instead of looping a hardcoded array.

**Tech Stack:** React 18, TipTap, Pragmatic DnD, Redux-like reducer, Socket.io, Mongoose, MongoDB.

**Spec:** `docs/superpowers/specs/2026-05-13-templates-and-header-dropdown-design.md`

**Test command (server):** `npm --prefix ./server run test`
**Test command (client):** `npm --prefix ./client run test`
**Dev command:** `npm run dev`

---

## Phase 1 — Schema extensions + Templates manifest seeding

Adds the fields the rest of the work depends on. Does not change behavior yet — pure data-model and seed.

### Task 1.1: Add `filterNavConfig` and `meta.appliedFromTemplateId` to Occurrence schema

**Files:**
- Modify: `server/models/Occurrence.js`
- Test: `server/__tests__/occurrenceSchema.test.js`

- [ ] **Step 1: Write failing schema test**

Append to `server/__tests__/occurrenceSchema.test.js`:

```javascript
test("Occurrence accepts filterNavConfig", () => {
  const occ = new Occurrence({
    id: "test-1", userId: "u1", targetId: "m1", targetType: "module",
    filterNavConfig: { f1: { visible: true, style: "pills", options: ["a","b"] } },
  });
  expect(occ.filterNavConfig.f1.style).toBe("pills");
});

test("Occurrence meta accepts appliedFromTemplateId", () => {
  const occ = new Occurrence({
    id: "test-2", userId: "u1", targetId: "m1", targetType: "module",
    meta: { appliedFromTemplateId: "tpl-123" },
  });
  expect(occ.meta.appliedFromTemplateId).toBe("tpl-123");
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npm --prefix ./server run test -- occurrenceSchema`
Expected: FAIL — `filterNavConfig` undefined.

- [ ] **Step 3: Add field to schema**

In `server/models/Occurrence.js`, add inside the schema definition near `filterOverride`:

```javascript
filterNavConfig: { type: mongoose.Schema.Types.Mixed, default: {} },
```

`meta` is already `Mixed`, so no change needed for `appliedFromTemplateId`.

- [ ] **Step 4: Run test, expect pass**

Run: `npm --prefix ./server run test -- occurrenceSchema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/models/Occurrence.js server/__tests__/occurrenceSchema.test.js
git commit -m "feat(occurrence): add filterNavConfig field for type-dispatched nav widgets"
```

### Task 1.2: Add `meta.templateModule` understanding to Module

**Files:**
- Modify: `server/models/Module.js` (no-op; meta is already Mixed)
- Test: `server/__tests__/moduleSchema.test.js`

- [ ] **Step 1: Add a passing assertion test**

Append to `server/__tests__/moduleSchema.test.js`:

```javascript
test("Module meta accepts templateModule flag", () => {
  const m = new Module({ id: "m-tpl-1", userId: "u1", meta: { templateModule: true } });
  expect(m.meta.templateModule).toBe(true);
});
```

- [ ] **Step 2: Run test, expect pass**

Run: `npm --prefix ./server run test -- moduleSchema`
Expected: PASS (since meta is Mixed).

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/moduleSchema.test.js
git commit -m "test(module): document templateModule meta flag"
```

### Task 1.3: Add `APPLY_TEMPLATE` to Operation pipeline action enum

**Files:**
- Modify: `server/models/Operation.js`

- [ ] **Step 1: Find existing action enum**

Run: `grep -n "APPLY_TEMPLATE\|SET_FIELD_VALUE\|enum:" server/models/Operation.js`

- [ ] **Step 2: Add APPLY_TEMPLATE to whichever list/enum gates the pipeline action type**

If the action types are gated by an explicit enum, add `"APPLY_TEMPLATE"` to it. If pipeline is stored as `Mixed`, no schema change is needed — just confirm and skip to step 3.

- [ ] **Step 3: Commit (only if change made)**

```bash
git add server/models/Operation.js
git commit -m "feat(operation): add APPLY_TEMPLATE to pipeline action enum"
```

### Task 1.4: Seed a per-grid Templates manifest on grid creation

**Files:**
- Modify: `server/socketHandlers/crud.js` (or wherever `Grid` is created in `request_full_state` / `create_grid`)
- Reference: `server/utils/createDefaultUserData.js` (for an example of manifest+folder creation)

- [ ] **Step 1: Identify Grid creation path**

Run: `grep -n "new Grid\|Grid.findOneAndUpdate\|create_grid" server/server.js server/socketHandlers/*.js server/utils/*.js | head -20`

- [ ] **Step 2: Add helper `ensureTemplatesManifest(gridId, userId, uc)` in `server/utils/templatesManifest.js`**

```javascript
// server/utils/templatesManifest.js
import Manifest from "../models/Manifest.js";
import Folder from "../models/Folder.js";

export async function ensureTemplatesManifest({ gridId, userId, uc }) {
  const existing = Object.values(uc.manifestsById || {}).find(
    m => m.gridId === gridId && m.manifestType === "templates"
  );
  if (existing) return existing;

  const folderId = `tpl-root-${gridId}`;
  const manifestId = `tpl-mfst-${gridId}`;

  const folder = await Folder.findOneAndUpdate(
    { id: folderId },
    { id: folderId, name: "Templates", userId, gridId, folderType: "templates", parentId: null, sortOrder: 0 },
    { upsert: true, new: true }
  ).lean();

  const manifest = await Manifest.findOneAndUpdate(
    { id: manifestId },
    { id: manifestId, name: "Templates", userId, gridId, manifestType: "templates", rootFolderId: folderId },
    { upsert: true, new: true }
  ).lean();

  uc.foldersById = uc.foldersById || {};
  uc.manifestsById = uc.manifestsById || {};
  uc.foldersById[folderId] = folder;
  uc.manifestsById[manifestId] = manifest;
  return manifest;
}
```

- [ ] **Step 3: Call from grid bootstrap**

In `server/server.js` (or wherever the grid is established for a user), after the user cache is loaded and gridId resolved:

```javascript
import { ensureTemplatesManifest } from "./utils/templatesManifest.js";
// ...inside the connect/full_state path, after uc is ready:
await ensureTemplatesManifest({ gridId: socket.data.activeGridId, userId: socket.userId, uc });
```

- [ ] **Step 4: Write integration test**

Create `server/__tests__/templatesManifest.test.js`:

```javascript
import mongoose from "mongoose";
import Manifest from "../models/Manifest.js";
import Folder from "../models/Folder.js";
import { ensureTemplatesManifest } from "../utils/templatesManifest.js";

describe("ensureTemplatesManifest", () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/moduli-test");
  });
  afterAll(async () => { await mongoose.disconnect(); });
  beforeEach(async () => {
    await Manifest.deleteMany({ gridId: "g-test" });
    await Folder.deleteMany({ gridId: "g-test" });
  });

  test("creates manifest + root folder when missing", async () => {
    const uc = { manifestsById: {}, foldersById: {} };
    const m = await ensureTemplatesManifest({ gridId: "g-test", userId: "u1", uc });
    expect(m.manifestType).toBe("templates");
    expect(m.rootFolderId).toBeTruthy();
    const folder = uc.foldersById[m.rootFolderId];
    expect(folder.folderType).toBe("templates");
  });

  test("is idempotent", async () => {
    const uc = { manifestsById: {}, foldersById: {} };
    const m1 = await ensureTemplatesManifest({ gridId: "g-test", userId: "u1", uc });
    const m2 = await ensureTemplatesManifest({ gridId: "g-test", userId: "u1", uc });
    expect(m1.id).toBe(m2.id);
  });
});
```

- [ ] **Step 5: Run test**

Run: `npm --prefix ./server run test -- templatesManifest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/utils/templatesManifest.js server/server.js server/__tests__/templatesManifest.test.js
git commit -m "feat(templates): seed Templates manifest on grid bootstrap"
```

### Task 1.5: Surface templates manifest in `full_state`

**Files:**
- Modify: `server/socketHandlers/state.js` (or wherever `full_state` is built)

- [ ] **Step 1: Confirm manifests already shipped**

Run: `grep -n "manifestsById\|manifests" server/socketHandlers/state.js server/server.js | head -10`

- [ ] **Step 2: If templates manifest isn't included in the payload, add it**

Verify `full_state` includes every `uc.manifestsById` entry, not just the file manifest. If a filter exists, broaden it.

- [ ] **Step 3: Restart server, log in, verify in browser DevTools**

Run: `npm run dev`
In browser DevTools console after login:
```javascript
window.__STORE__.getState().manifestsById  // should include the templates manifest
```

- [ ] **Step 4: Commit (if changes made)**

```bash
git add server/socketHandlers/state.js
git commit -m "feat(templates): include templates manifest in full_state payload"
```

---

## Phase 2 — HeaderDropdown shell + FiltersSection + filter nav widgets

UI-only. Replaces FilterButton + radial-menu filter items + LocalFilterNav with one unified dropdown.

### Task 2.1: Create `HeaderChevron` button

**Files:**
- Create: `client/src/ui/HeaderChevron.jsx`

- [ ] **Step 1: Write component**

```jsx
// client/src/ui/HeaderChevron.jsx
import React from "react";
import { ChevronDown } from "lucide-react";

export default function HeaderChevron({ onClick, isOpen }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="header-chevron"
      aria-expanded={isOpen}
      title="Filters & templates"
      style={{
        background: "transparent", border: 0, padding: "2px 4px",
        cursor: "pointer", display: "inline-flex", alignItems: "center",
        opacity: isOpen ? 1 : 0.6,
      }}
    >
      <ChevronDown size={14} />
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/ui/HeaderChevron.jsx
git commit -m "feat(ui): add HeaderChevron button"
```

### Task 2.2: Create `HeaderDropdown` overlay shell

**Files:**
- Create: `client/src/ui/HeaderDropdown.jsx`

- [ ] **Step 1: Write component**

```jsx
// client/src/ui/HeaderDropdown.jsx
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function HeaderDropdown({ anchorRect, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  if (!anchorRect) return null;
  const top = anchorRect.bottom + 4;
  const left = anchorRect.left;

  return createPortal(
    <div
      ref={ref}
      className="header-dropdown"
      role="dialog"
      style={{
        position: "fixed", top, left, zIndex: 1000,
        minWidth: 280, maxWidth: 360,
        background: "var(--panel-bg, #1f2937)",
        color: "var(--panel-fg, #f3f4f6)",
        border: "1px solid var(--panel-border, #374151)",
        borderRadius: 8, padding: 12,
        boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/ui/HeaderDropdown.jsx
git commit -m "feat(ui): add HeaderDropdown overlay shell with portal + outside-click close"
```

### Task 2.3: Create `FilterNavWidgets` (type-dispatched)

**Files:**
- Create: `client/src/ui/FilterNavWidgets.jsx`
- Reference: `client/src/state/actions.js` (`setFilterNavAction`)

- [ ] **Step 1: Write component**

```jsx
// client/src/ui/FilterNavWidgets.jsx
import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { setFilterNavAction } from "../state/actions";

const stepByUnit = { day: 86400000, week: 86400000 * 7, month: 86400000 * 30, year: 86400000 * 365 };

function ArrowsWidget({ filter, value, dispatch }) {
  const unit = filter.timeUnit || "day";
  const stepMs = stepByUnit[unit] || stepByUnit.day;
  const onPrev = () => {
    const d = value ? new Date(value).getTime() : Date.now();
    dispatch(setFilterNavAction(filter.id, new Date(d - stepMs).toISOString()));
  };
  const onNext = () => {
    const d = value ? new Date(value).getTime() : Date.now();
    dispatch(setFilterNavAction(filter.id, new Date(d + stepMs).toISOString()));
  };
  const label = value ? new Date(value).toLocaleDateString() : "—";
  return (
    <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button onClick={onPrev} title="Prev" style={{ background: "transparent", border: 0, color: "inherit", cursor: "pointer" }}><ChevronLeft size={14} /></button>
      <span style={{ minWidth: 80, textAlign: "center", fontSize: 12 }}>{label}</span>
      <button onClick={onNext} title="Next" style={{ background: "transparent", border: 0, color: "inherit", cursor: "pointer" }}><ChevronRight size={14} /></button>
    </div>
  );
}

function PillsWidget({ filter, value, options, dispatch }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {(options || []).map(opt => (
        <button
          key={String(opt)}
          onClick={() => dispatch(setFilterNavAction(filter.id, opt))}
          style={{
            padding: "2px 8px", borderRadius: 999, fontSize: 11,
            border: "1px solid var(--panel-border, #374151)",
            background: opt === value ? "var(--accent, #14b8a6)" : "transparent",
            color: "inherit", cursor: "pointer",
          }}
        >{String(opt)}</button>
      ))}
    </div>
  );
}

function InputWidget({ filter, value, dispatch }) {
  const [local, setLocal] = useState(value || "");
  const timer = useRef(null);
  useEffect(() => { setLocal(value || ""); }, [value]);
  const onChange = (e) => {
    const v = e.target.value;
    setLocal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => dispatch(setFilterNavAction(filter.id, v)), 250);
  };
  return (
    <input
      value={local} onChange={onChange}
      style={{
        padding: "2px 6px", fontSize: 11,
        background: "transparent", color: "inherit",
        border: "1px solid var(--panel-border, #374151)", borderRadius: 4, width: 140,
      }}
    />
  );
}

export default function FilterNavWidget({ filter, navConfig, value, fieldsById, dispatch }) {
  const style = navConfig?.style || defaultStyleForFilter(filter, fieldsById);
  const options = navConfig?.options || derivedOptionsForFilter(filter, fieldsById);
  if (style === "arrows") return <ArrowsWidget filter={filter} value={value} dispatch={dispatch} />;
  if (style === "pills" || style === "custom") return <PillsWidget filter={filter} value={value} options={options} dispatch={dispatch} />;
  if (style === "input") return <InputWidget filter={filter} value={value} dispatch={dispatch} />;
  return null;
}

export function defaultStyleForFilter(filter, fieldsById) {
  const fieldId = filter?.primaryDateFieldId;
  const fld = fieldId ? fieldsById?.[fieldId] : null;
  if (fld?.type === "date") return "arrows";
  if (fld?.type === "select" || fld?.type === "boolean") return "pills";
  if (fld?.type === "number") return "arrows";
  return "input";
}

export function derivedOptionsForFilter(filter, fieldsById) {
  const fld = filter?.primaryDateFieldId ? fieldsById?.[filter.primaryDateFieldId] : null;
  if (fld?.type === "boolean") return [true, false];
  if (fld?.type === "select") return (fld.meta?.options || []).map(o => o.value ?? o);
  return [];
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/ui/FilterNavWidgets.jsx
git commit -m "feat(filters): type-dispatched filter nav widgets (arrows/pills/input)"
```

### Task 2.4: Create `FiltersSection`

**Files:**
- Create: `client/src/ui/FiltersSection.jsx`
- Reference: `client/src/ui/FilterEditor.jsx`, `client/src/helpers/LayoutHelpers.js` (`getEffectiveFilterForOccurrence`)

- [ ] **Step 1: Write component**

```jsx
// client/src/ui/FiltersSection.jsx
import React, { useMemo } from "react";
import { X, Plus } from "lucide-react";
import FilterNavWidget from "./FilterNavWidgets";
import { useStore } from "../state/StoreProvider";
import { updateOccurrenceAction } from "../state/actions";
import { commitOccurrenceUpdate } from "../helpers/CommitHelpers";

function ancestorChain(occ, occurrencesById) {
  const chain = [];
  let cur = occ;
  while (cur) {
    chain.push(cur);
    cur = cur.parentId ? occurrencesById[cur.parentId] : null;
  }
  return chain.slice(1); // exclude self
}

function collectActiveAncestorFilters(occ, occurrencesById, grid) {
  const filters = grid?.namedFilters || [];
  const active = filters.filter(f => f.id === grid.activeFilterId);
  return active; // For now, all active grid filters cascade; per-occurrence overrides handled separately.
}

export default function FiltersSection({ occurrence }) {
  const { state, dispatch, socket } = useStore();
  const { occurrencesById, fieldsById, gridsById, activeGridId } = state;
  const grid = gridsById[activeGridId];
  const filters = grid?.namedFilters || [];

  const overrides = occurrence.filterOverride || {};
  const navConfig = occurrence.filterNavConfig || {};
  const navValues = grid?.activeFilterValues || {};

  const setOverride = (fieldId, value) => {
    const next = { ...overrides, [fieldId]: value };
    dispatch(updateOccurrenceAction(occurrence.id, { filterOverride: next }));
    commitOccurrenceUpdate(socket, occurrence.id, { filterOverride: next });
  };
  const clearOverride = (fieldId) => {
    const next = { ...overrides };
    delete next[fieldId];
    dispatch(updateOccurrenceAction(occurrence.id, { filterOverride: next }));
    commitOccurrenceUpdate(socket, occurrence.id, { filterOverride: next });
  };
  const setNavConfig = (filterId, patch) => {
    const next = { ...navConfig, [filterId]: { ...(navConfig[filterId] || {}), ...patch } };
    dispatch(updateOccurrenceAction(occurrence.id, { filterNavConfig: next }));
    commitOccurrenceUpdate(socket, occurrence.id, { filterNavConfig: next });
  };

  return (
    <section style={{ marginBottom: 8 }}>
      <header style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>Filters</header>
      {filters.map(f => {
        const fieldId = f.primaryDateFieldId;
        const muted = overrides[fieldId] === null;
        const ownValue = overrides[fieldId];
        const cfg = navConfig[f.id] || {};
        return (
          <div key={f.id} style={{ padding: "6px 0", borderTop: "1px solid var(--panel-border, #374151)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12 }}>{f.name || "(unnamed)"}</span>
              <label style={{ fontSize: 11, display: "inline-flex", gap: 4 }}>
                <input
                  type="checkbox"
                  checked={!muted}
                  onChange={(e) => e.target.checked ? clearOverride(fieldId) : setOverride(fieldId, null)}
                />
                Active
              </label>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <label style={{ fontSize: 11, display: "inline-flex", gap: 4 }}>
                <input
                  type="checkbox"
                  checked={!!cfg.visible}
                  onChange={(e) => setNavConfig(f.id, { visible: e.target.checked })}
                />
                Show nav
              </label>
              <select
                value={cfg.style || ""}
                onChange={(e) => setNavConfig(f.id, { style: e.target.value })}
                style={{ fontSize: 11, background: "transparent", color: "inherit", border: "1px solid var(--panel-border, #374151)", borderRadius: 4 }}
              >
                <option value="">auto</option>
                <option value="arrows">arrows</option>
                <option value="pills">pills</option>
                <option value="input">input</option>
                <option value="custom">custom</option>
              </select>
            </div>
            {cfg.visible && (
              <div style={{ marginTop: 6 }}>
                <FilterNavWidget
                  filter={f}
                  navConfig={cfg}
                  value={ownValue !== undefined ? ownValue : navValues[fieldId]}
                  fieldsById={fieldsById}
                  dispatch={dispatch}
                />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 2: Verify `commitOccurrenceUpdate` exists in `CommitHelpers.js`, else add a thin wrapper**

Run: `grep -n "commitOccurrenceUpdate\|update_occurrence" client/src/helpers/CommitHelpers.js | head -5`

If missing, add to `CommitHelpers.js`:

```javascript
export function commitOccurrenceUpdate(socket, occurrenceId, patch) {
  safeEmit(socket, "update_occurrence", { id: occurrenceId, patch });
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/FiltersSection.jsx client/src/helpers/CommitHelpers.js
git commit -m "feat(filters): FiltersSection — ancestor list + own overrides + nav config"
```

### Task 2.5: Mount HeaderChevron + HeaderDropdown on ModuleContainer

**Files:**
- Modify: `client/src/modules/ModuleContainer.jsx`

- [ ] **Step 1: Add state + handlers**

Near the top of the component body, alongside existing UI state:

```javascript
import HeaderChevron from "../ui/HeaderChevron";
import HeaderDropdown from "../ui/HeaderDropdown";
import FiltersSection from "../ui/FiltersSection";
// ...
const [dropdownAnchor, setDropdownAnchor] = useState(null);
const openDropdown = useCallback((e) => {
  setDropdownAnchor(e.currentTarget.getBoundingClientRect());
}, []);
const closeDropdown = useCallback(() => setDropdownAnchor(null), []);
```

- [ ] **Step 2: Render the chevron in the header row**

Locate the container's header JSX (around line 595, `Embedded: single-row header — handle + #label + filter`). Insert next to existing handle/label/filter:

```jsx
<HeaderChevron onClick={openDropdown} isOpen={!!dropdownAnchor} />
```

Remove the existing `<FilterButton />` JSX from this same header.

- [ ] **Step 3: Render the dropdown at component bottom**

Near the end of the JSX (after the body), add:

```jsx
{dropdownAnchor && (
  <HeaderDropdown anchorRect={dropdownAnchor} onClose={closeDropdown}>
    <FiltersSection occurrence={containerOccurrence} />
  </HeaderDropdown>
)}
```

- [ ] **Step 4: Smoke-test in browser**

Run: `npm run dev`. Open app. Click chevron on a container header. Dropdown should appear, not push layout. Toggle filter active state and verify the container's visible children update.

- [ ] **Step 5: Commit**

```bash
git add client/src/modules/ModuleContainer.jsx
git commit -m "feat(container): mount HeaderDropdown chevron; drop FilterButton from header"
```

### Task 2.6: Mount HeaderChevron + HeaderDropdown on ModulePage and ModulePanel

**Files:**
- Modify: `client/src/modules/ModulePage.jsx`
- Modify: `client/src/modules/ModulePanel.jsx`

- [ ] **Step 1: Apply same pattern to ModulePage header (~line 343)**

Same imports, same state, same JSX — but pass `occurrence={occurrence}` (the page occurrence). Remove `FilterButton` if present.

- [ ] **Step 2: Apply same pattern to ModulePanel header (~line 694)**

Same imports, same state. Pass the panel occurrence. Remove `FilterButton`.

- [ ] **Step 3: Smoke-test**

Run: `npm run dev`. Verify chevron appears on Panel and Page headers; dropdown works the same way.

- [ ] **Step 4: Commit**

```bash
git add client/src/modules/ModulePage.jsx client/src/modules/ModulePanel.jsx
git commit -m "feat(page,panel): mount HeaderDropdown chevron; drop FilterButton"
```

### Task 2.7: Retire `FilterButton` and radial-menu filter items

**Files:**
- Delete: `client/src/ui/FilterButton.jsx`
- Modify: any radial-menu definitions in `ModulePanel.jsx` / `ModulePage.jsx` / `ModuleContainer.jsx` that include filter-related items

- [ ] **Step 1: Find all FilterButton usages**

Run: `grep -rn "FilterButton" client/src`

- [ ] **Step 2: Confirm only imports remain (no JSX usages from Task 2.5/2.6)**

If any `<FilterButton />` JSX remains, delete it.

- [ ] **Step 3: Delete the file + imports**

Run: `git rm client/src/ui/FilterButton.jsx`
Remove the now-unused `import FilterButton from ...` lines.

- [ ] **Step 4: Find radial-menu filter items**

Run: `grep -n "label.*[Ff]ilter\|onClick.*[Ff]ilter" client/src/modules/Module*.jsx`

For each radial menu `items={[...]}` that contains a filter-related entry, remove the entry.

- [ ] **Step 5: Smoke-test**

Run: `npm run dev`. Open a radial menu — confirm no filter items. Confirm chevron is the only filter entry point.

- [ ] **Step 6: Commit**

```bash
git rm client/src/ui/FilterButton.jsx
git add client/src/modules/Module*.jsx
git commit -m "refactor(filters): retire FilterButton and radial-menu filter items"
```

### Task 2.8: Make `LocalFilterNav` dispatch on `filterNavConfig.style`

**Files:**
- Modify: `client/src/ui/LocalFilterNav.jsx`

- [ ] **Step 1: Read current implementation**

Run: `cat client/src/ui/LocalFilterNav.jsx`

- [ ] **Step 2: Rewrite to render `FilterNavWidget` per visible filter from `occurrence.filterNavConfig`**

```jsx
import React from "react";
import FilterNavWidget from "./FilterNavWidgets";
import { useStore } from "../state/StoreProvider";

export default function LocalFilterNav({ occurrence, compact = false }) {
  const { state, dispatch } = useStore();
  const { gridsById, activeGridId, fieldsById } = state;
  const grid = gridsById[activeGridId];
  const filters = grid?.namedFilters || [];
  const navConfig = occurrence?.filterNavConfig || {};
  const overrides = occurrence?.filterOverride || {};
  const visible = filters.filter(f => navConfig[f.id]?.visible);
  if (!visible.length) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "2px 6px" }}>
      {visible.map(f => {
        const fieldId = f.primaryDateFieldId;
        const value = overrides[fieldId] !== undefined ? overrides[fieldId] : grid.activeFilterValues?.[fieldId];
        return (
          <FilterNavWidget
            key={f.id}
            filter={f}
            navConfig={navConfig[f.id]}
            value={value}
            fieldsById={fieldsById}
            dispatch={dispatch}
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Smoke-test**

Run: `npm run dev`. Open a page header dropdown → enable "Show nav" for the daily filter → verify the date arrows appear in the page header row.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/LocalFilterNav.jsx
git commit -m "feat(filters): LocalFilterNav dispatches by filterNavConfig.style"
```

---

## Phase 3 — Server template flows + client helpers + migration

Backend + plumbing. After this lands, save/apply/save-over all work via socket events (UI surfaces in Phase 4).

### Task 3.1: Write `cloneSubtree` server helper

**Files:**
- Create: `server/utils/cloneSubtree.js`

- [ ] **Step 1: Write the helper**

```javascript
// server/utils/cloneSubtree.js
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Clone a subtree rooted at `rootOccurrenceId`. For each node:
 *   - mint new module (carries over module fields; optional metaPatch)
 *   - mint new occurrence (regenerated id, new module id, regenerated occurrences[])
 * Returns { rootClonedOccurrenceId, occurrenceIds: [...], moduleIds: [...] }.
 *
 * options:
 *   moduleMetaPatch:  shallow object merged into each cloned module.meta
 *   occMetaPatch:     shallow object merged into the ROOT clone's meta only
 *   newParentId:      parentId for the cloned root
 */
export async function cloneSubtree({ rootOccurrenceId, userId, gridId, uc, moduleMetaPatch = {}, occMetaPatch = {}, newParentId = null }) {
  const created = { occurrenceIds: [], moduleIds: [] };

  async function walk(occId, parentId, isRoot) {
    const src = uc.occurrencesById[occId];
    if (!src) return null;
    const srcMod = uc.modulesById[src.targetId];
    if (!srcMod) return null;

    const cloneModId = newId();
    const cloneOccId = newId();

    const newMod = {
      ...srcMod,
      id: cloneModId,
      meta: { ...(srcMod.meta || {}), ...moduleMetaPatch },
    };
    delete newMod._id;
    uc.modulesById[cloneModId] = newMod;
    await Module.findOneAndUpdate({ id: cloneModId }, newMod, { upsert: true });
    created.moduleIds.push(cloneModId);

    const childIds = [];
    for (const childOccId of src.occurrences || []) {
      const childClone = await walk(childOccId, cloneOccId, false);
      if (childClone) childIds.push(childClone);
    }

    const newOcc = {
      ...src,
      id: cloneOccId,
      targetId: cloneModId,
      parentId,
      occurrences: childIds,
      meta: { ...(src.meta || {}), ...(isRoot ? occMetaPatch : {}) },
    };
    delete newOcc._id;
    delete newOcc.linkedGroupId;
    uc.occurrencesById[cloneOccId] = newOcc;
    await Occurrence.findOneAndUpdate({ id: cloneOccId }, newOcc, { upsert: true });
    created.occurrenceIds.push(cloneOccId);

    return cloneOccId;
  }

  const rootClonedOccurrenceId = await walk(rootOccurrenceId, newParentId, true);
  return { rootClonedOccurrenceId, ...created };
}
```

- [ ] **Step 2: Write unit test**

Create `server/__tests__/cloneSubtree.test.js`:

```javascript
import mongoose from "mongoose";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import { cloneSubtree } from "../utils/cloneSubtree.js";

describe("cloneSubtree", () => {
  beforeAll(async () => { await mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/moduli-test"); });
  afterAll(async () => { await mongoose.disconnect(); });
  beforeEach(async () => {
    await Module.deleteMany({ userId: "u-clone" });
    await Occurrence.deleteMany({ userId: "u-clone" });
  });

  test("clones a 2-level tree, regenerates ids, sets parent + meta patches", async () => {
    const uc = { modulesById: {}, occurrencesById: {} };
    // Parent module + occ
    uc.modulesById["m-p"] = { id: "m-p", userId: "u-clone", role: "container", label: "P", meta: {} };
    uc.modulesById["m-c"] = { id: "m-c", userId: "u-clone", role: "instance", label: "C", meta: {} };
    uc.occurrencesById["o-p"] = { id: "o-p", userId: "u-clone", targetId: "m-p", targetType: "module", occurrences: ["o-c"], meta: {} };
    uc.occurrencesById["o-c"] = { id: "o-c", userId: "u-clone", targetId: "m-c", targetType: "module", occurrences: [], meta: {} };

    const r = await cloneSubtree({
      rootOccurrenceId: "o-p", userId: "u-clone", gridId: "g1", uc,
      moduleMetaPatch: { templateModule: true },
      occMetaPatch: { appliedFromTemplateId: null },
      newParentId: "folder-x",
    });

    expect(r.occurrenceIds).toHaveLength(2);
    expect(r.moduleIds).toHaveLength(2);
    const newRoot = uc.occurrencesById[r.rootClonedOccurrenceId];
    expect(newRoot.parentId).toBe("folder-x");
    expect(newRoot.occurrences).toHaveLength(1);
    const cloneChildOcc = uc.occurrencesById[newRoot.occurrences[0]];
    expect(cloneChildOcc.parentId).toBe(r.rootClonedOccurrenceId);
    const cloneRootMod = uc.modulesById[newRoot.targetId];
    expect(cloneRootMod.meta.templateModule).toBe(true);
    // Children also get the template marker (moduleMetaPatch applies to all)
    expect(uc.modulesById[cloneChildOcc.targetId].meta.templateModule).toBe(true);
  });
});
```

- [ ] **Step 3: Run**

Run: `npm --prefix ./server run test -- cloneSubtree`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/utils/cloneSubtree.js server/__tests__/cloneSubtree.test.js
git commit -m "feat(templates): cloneSubtree helper with module + occ id regeneration"
```

### Task 3.2: Rewrite `server/socketHandlers/templates.js` with new handlers

**Files:**
- Modify: `server/socketHandlers/templates.js`

- [ ] **Step 1: Replace file contents**

```javascript
// server/socketHandlers/templates.js
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import Manifest from "../models/Manifest.js";
import { cloneSubtree } from "../utils/cloneSubtree.js";

export function registerTemplateHandlers(socket, { ensureUserCache, userCacheReady, loadUserIntoCache, userRoom }) {
  const userId = socket.userId;
  const getUc = async () => {
    const gId = socket.data.activeGridId;
    if (!userCacheReady(userId, gId)) await loadUserIntoCache(userId, gId);
    return ensureUserCache(userId, gId);
  };

  function broadcastClones(uc, gridId, occIds, modIds) {
    for (const mId of modIds) {
      const m = uc.modulesById[mId];
      socket.emit("module_created", { module: m });
      socket.to(userRoom(userId)).emit("module_created", { module: m });
    }
    for (const oId of occIds) {
      const o = uc.occurrencesById[oId];
      socket.emit("occurrence_created", { occurrence: o });
      socket.to(userRoom(userId)).emit("occurrence_created", { occurrence: o });
    }
  }

  socket.on("clone_subtree_as_template", async ({ sourceOccurrenceId, name, parentFolderId } = {}) => {
    try {
      if (!userId || !sourceOccurrenceId) return;
      const uc = await getUc();
      const gridId = socket.data.activeGridId;
      const r = await cloneSubtree({
        rootOccurrenceId: sourceOccurrenceId, userId, gridId, uc,
        moduleMetaPatch: { templateModule: true },
        occMetaPatch: { templateName: name },
        newParentId: parentFolderId,
      });
      broadcastClones(uc, gridId, r.occurrenceIds, r.moduleIds);
      socket.emit("template_created", { templateOccurrenceId: r.rootClonedOccurrenceId });
    } catch (err) {
      console.error("clone_subtree_as_template error:", err);
    }
  });

  socket.on("apply_template", async ({ templateOccurrenceId, targetOccurrenceId, mode = "append" } = {}) => {
    try {
      if (!userId || !templateOccurrenceId || !targetOccurrenceId) return;
      const uc = await getUc();
      const gridId = socket.data.activeGridId;
      const target = uc.occurrencesById[targetOccurrenceId];
      if (!target) return;
      const r = await cloneSubtree({
        rootOccurrenceId: templateOccurrenceId, userId, gridId, uc,
        moduleMetaPatch: { templateModule: false },  // strip on apply
        occMetaPatch: { appliedFromTemplateId: templateOccurrenceId },
        newParentId: targetOccurrenceId,
      });

      if (mode === "replace") target.occurrences = [r.rootClonedOccurrenceId];
      else target.occurrences = [...(target.occurrences || []), r.rootClonedOccurrenceId];
      await Occurrence.findOneAndUpdate({ id: target.id }, target, { upsert: true });
      uc.occurrencesById[target.id] = target;
      socket.emit("occurrence_updated", { occurrence: target });
      socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: target });

      broadcastClones(uc, gridId, r.occurrenceIds, r.moduleIds);
      socket.emit("template_applied", { rootOccurrenceId: r.rootClonedOccurrenceId, newOccurrenceIds: r.occurrenceIds, newModuleIds: r.moduleIds });
    } catch (err) {
      console.error("apply_template error:", err);
    }
  });

  socket.on("save_over_template", async ({ sourceOccurrenceId, templateOccurrenceId } = {}) => {
    try {
      if (!userId || !sourceOccurrenceId || !templateOccurrenceId) return;
      const uc = await getUc();
      const gridId = socket.data.activeGridId;
      const oldRoot = uc.occurrencesById[templateOccurrenceId];
      if (!oldRoot) return;

      // Collect old subtree
      const toDelete = [];
      (function walk(id) {
        const o = uc.occurrencesById[id];
        if (!o) return;
        toDelete.push(o);
        (o.occurrences || []).forEach(walk);
      })(templateOccurrenceId);

      // Delete old modules + occurrences
      for (const o of toDelete) {
        await Occurrence.deleteOne({ id: o.id });
        delete uc.occurrencesById[o.id];
        if (o.targetId && uc.modulesById[o.targetId]) {
          await Module.deleteOne({ id: o.targetId });
          delete uc.modulesById[o.targetId];
          socket.emit("module_deleted", { id: o.targetId });
          socket.to(userRoom(userId)).emit("module_deleted", { id: o.targetId });
        }
        socket.emit("occurrence_deleted", { id: o.id });
        socket.to(userRoom(userId)).emit("occurrence_deleted", { id: o.id });
      }

      // Re-clone from source
      const r = await cloneSubtree({
        rootOccurrenceId: sourceOccurrenceId, userId, gridId, uc,
        moduleMetaPatch: { templateModule: true },
        occMetaPatch: { templateName: oldRoot.meta?.templateName },
        newParentId: oldRoot.parentId,
      });
      broadcastClones(uc, gridId, r.occurrenceIds, r.moduleIds);
      socket.emit("template_saved_over", { oldTemplateId: templateOccurrenceId, newTemplateId: r.rootClonedOccurrenceId });
    } catch (err) {
      console.error("save_over_template error:", err);
    }
  });
}
```

- [ ] **Step 2: Verify registration in server.js**

Run: `grep -n "registerTemplateHandlers" server/server.js`

If signature has changed (no longer needs `createOccurrenceData`), update the call site to pass only the four required helpers.

- [ ] **Step 3: Smoke test via socket from browser console**

Run: `npm run dev`. In the browser DevTools, after login:

```javascript
window.__SOCKET__.emit("clone_subtree_as_template", {
  sourceOccurrenceId: "<some-occ-id>", name: "Test Template", parentFolderId: "<templates-root-folder-id>"
});
```

Wait for `template_created` event, confirm clones appear in the templates manifest folder.

- [ ] **Step 4: Commit**

```bash
git add server/socketHandlers/templates.js server/server.js
git commit -m "feat(templates): clone_subtree_as_template + apply_template + save_over_template handlers"
```

### Task 3.3: Add client CommitHelpers + templateHelpers

**Files:**
- Modify: `client/src/helpers/CommitHelpers.js`
- Create: `client/src/helpers/templateHelpers.js`

- [ ] **Step 1: Add commit helpers**

In `CommitHelpers.js`, add (replace the old `save_template` / `fill_from_template` helpers — those are retired):

```javascript
export function commitCloneSubtreeAsTemplate(socket, { sourceOccurrenceId, name, parentFolderId }) {
  safeEmit(socket, "clone_subtree_as_template", { sourceOccurrenceId, name, parentFolderId });
}
export function commitApplyTemplate(socket, { templateOccurrenceId, targetOccurrenceId, mode = "append" }) {
  safeEmit(socket, "apply_template", { templateOccurrenceId, targetOccurrenceId, mode });
}
export function commitSaveOverTemplate(socket, { sourceOccurrenceId, templateOccurrenceId }) {
  safeEmit(socket, "save_over_template", { sourceOccurrenceId, templateOccurrenceId });
}
```

- [ ] **Step 2: Find existing `save_template` / `fill_from_template` call sites and remove them**

Run: `grep -rn "save_template\|fill_from_template" client/src`

For each, remove the call. (Save UI flow lands in Phase 4; nothing should depend on the old shape after this.)

- [ ] **Step 3: Add `templateHelpers.js`**

```javascript
// client/src/helpers/templateHelpers.js
export function templatesManifestFor(state, gridId) {
  return Object.values(state.manifestsById || {})
    .find(m => m.gridId === gridId && m.manifestType === "templates");
}

export function rootFolderForTemplates(state, gridId) {
  const m = templatesManifestFor(state, gridId);
  return m ? state.foldersById?.[m.rootFolderId] : null;
}

export function templateOccurrencesInFolder(state, folderId) {
  return Object.values(state.occurrencesById || {})
    .filter(o => o.parentId === folderId && o.meta?.templateName);
}

export function templateKindOf(state, templateOccurrence) {
  if (!templateOccurrence) return null;
  const m = state.modulesById?.[templateOccurrence.targetId];
  return m?.role || m?.kind || null;
}

export function templatesByKind(state, gridId, kindOrRole) {
  const root = rootFolderForTemplates(state, gridId);
  if (!root) return [];
  const acc = [];
  (function walk(folderId) {
    Object.values(state.occurrencesById || {})
      .filter(o => o.parentId === folderId && o.meta?.templateName)
      .forEach(o => {
        if (templateKindOf(state, o) === kindOrRole) acc.push(o);
      });
    Object.values(state.foldersById || {})
      .filter(f => f.parentId === folderId)
      .forEach(f => walk(f.id));
  })(root.id);
  return acc;
}
```

- [ ] **Step 4: Commit**

```bash
git add client/src/helpers/CommitHelpers.js client/src/helpers/templateHelpers.js
git commit -m "feat(templates): client commit + traversal helpers; remove legacy template emits"
```

### Task 3.4: Write migration script for legacy `Grid.templates[]`

**Files:**
- Create: `server/scripts/migrateLegacyTemplates.js`

- [ ] **Step 1: Write script**

```javascript
// server/scripts/migrateLegacyTemplates.js
// One-shot: convert Grid.templates[] (flat instance-only) into nested subtrees in the Templates manifest.
// Idempotent: skips templates whose name already exists in the templates manifest.

import mongoose from "mongoose";
import Grid from "../models/Grid.js";
import Folder from "../models/Folder.js";
import Manifest from "../models/Manifest.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

async function ensureManifest(grid) {
  let m = await Manifest.findOne({ gridId: grid._id.toString(), manifestType: "templates" });
  if (m) return m;
  const folderId = `tpl-root-${grid._id}`;
  await Folder.findOneAndUpdate({ id: folderId }, {
    id: folderId, name: "Templates", userId: grid.userId, gridId: grid._id.toString(),
    folderType: "templates", parentId: null, sortOrder: 0
  }, { upsert: true });
  const manifestId = `tpl-mfst-${grid._id}`;
  m = await Manifest.findOneAndUpdate({ id: manifestId }, {
    id: manifestId, name: "Templates", userId: grid.userId, gridId: grid._id.toString(),
    manifestType: "templates", rootFolderId: folderId,
  }, { upsert: true, new: true });
  return m;
}

async function run() {
  await mongoose.connect(process.env.MONGO_URL);
  const grids = await Grid.find({ "templates.0": { $exists: true } });
  for (const grid of grids) {
    const manifest = await ensureManifest(grid);
    const existing = await Occurrence.find({
      userId: grid.userId, gridId: grid._id.toString(), parentId: manifest.rootFolderId,
    });
    const haveNames = new Set(existing.map(o => o.meta?.templateName).filter(Boolean));

    for (const t of grid.templates) {
      if (haveNames.has(t.name)) continue;

      // Create a container module to host the template
      const tplModId = newId();
      await Module.create({
        id: tplModId, userId: grid.userId, gridId: grid._id.toString(),
        role: "container", kind: "list", label: t.name || "Untitled",
        meta: { templateModule: true },
      });
      const tplOccId = newId();

      // For each legacy item, mint a child occurrence pointing at the existing instance module
      const childIds = [];
      for (const item of (t.items || [])) {
        if (!item.instanceId) continue;
        const childOccId = newId();
        await Occurrence.create({
          id: childOccId, userId: grid.userId, gridId: grid._id.toString(),
          targetId: item.instanceId, targetType: "module",
          parentId: tplOccId,
          fields: item.fieldDefaults || {},
          occurrences: [],
        });
        childIds.push(childOccId);
      }

      await Occurrence.create({
        id: tplOccId, userId: grid.userId, gridId: grid._id.toString(),
        targetId: tplModId, targetType: "module",
        parentId: manifest.rootFolderId,
        occurrences: childIds,
        meta: { templateName: t.name || "Untitled" },
      });
      console.log(`Migrated template "${t.name}" → ${tplOccId} (${childIds.length} items)`);
    }
  }
  await mongoose.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run on dev DB**

Run: `node --env-file=.env server/scripts/migrateLegacyTemplates.js`
Expected: prints one line per migrated template; rerun prints zero lines (idempotent).

- [ ] **Step 3: Commit**

```bash
git add server/scripts/migrateLegacyTemplates.js
git commit -m "feat(templates): migration script for legacy Grid.templates[] -> nested subtrees"
```

---

## Phase 4 — Templates UI surfaces

### Task 4.1: Build `TemplatesSection` for HeaderDropdown

**Files:**
- Create: `client/src/ui/TemplatesSection.jsx`
- Reference: `client/src/ui/CategoryPathPicker.jsx`

- [ ] **Step 1: Write component**

```jsx
// client/src/ui/TemplatesSection.jsx
import React, { useState, useMemo } from "react";
import { useStore } from "../state/StoreProvider";
import { templatesByKind, rootFolderForTemplates } from "../helpers/templateHelpers";
import { commitApplyTemplate, commitCloneSubtreeAsTemplate, commitSaveOverTemplate } from "../helpers/CommitHelpers";

export default function TemplatesSection({ occurrence }) {
  const { state, socket } = useStore();
  const { activeGridId, modulesById } = state;
  const myModule = modulesById[occurrence.targetId];
  const myKind = myModule?.role || myModule?.kind;
  const templates = useMemo(() => templatesByKind(state, activeGridId, myKind), [state, activeGridId, myKind]);
  const appliedFrom = occurrence.meta?.appliedFromTemplateId;

  const [selectedId, setSelectedId] = useState(null);
  const [saveName, setSaveName] = useState("");

  const root = rootFolderForTemplates(state, activeGridId);

  const apply = () => {
    if (!selectedId) return;
    commitApplyTemplate(socket, { templateOccurrenceId: selectedId, targetOccurrenceId: occurrence.id, mode: "append" });
  };
  const saveNew = () => {
    if (!saveName.trim() || !root) return;
    commitCloneSubtreeAsTemplate(socket, { sourceOccurrenceId: occurrence.id, name: saveName.trim(), parentFolderId: root.id });
    setSaveName("");
  };
  const saveOver = () => {
    if (!appliedFrom) return;
    commitSaveOverTemplate(socket, { sourceOccurrenceId: occurrence.id, templateOccurrenceId: appliedFrom });
  };

  return (
    <section style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--panel-border, #374151)" }}>
      <header style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>Templates</header>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
        {templates.length === 0 && <div style={{ fontSize: 11, opacity: 0.5 }}>No templates for this kind yet.</div>}
        {templates.map(t => (
          <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input type="radio" name="tpl" checked={selectedId === t.id} onChange={() => setSelectedId(t.id)} />
            <span>{t.meta?.templateName || "(unnamed)"}</span>
          </label>
        ))}
      </div>
      <button onClick={apply} disabled={!selectedId} style={{ fontSize: 11, marginBottom: 8 }}>Apply</button>

      <div style={{ display: "flex", gap: 4 }}>
        <input
          value={saveName} onChange={(e) => setSaveName(e.target.value)}
          placeholder="Save as new template..."
          style={{ flex: 1, fontSize: 11, background: "transparent", color: "inherit", border: "1px solid var(--panel-border, #374151)", borderRadius: 4, padding: "2px 6px" }}
        />
        <button onClick={saveNew} disabled={!saveName.trim()} style={{ fontSize: 11 }}>Save</button>
      </div>
      {appliedFrom && (
        <button onClick={saveOver} style={{ fontSize: 11, marginTop: 6 }}>Save over template</button>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Wire into HeaderDropdown hosts**

In each of `ModuleContainer.jsx`, `ModulePage.jsx`, `ModulePanel.jsx`, inside the `<HeaderDropdown>` block, add below `FiltersSection`:

```jsx
<TemplatesSection occurrence={containerOccurrence /* or page/panel occurrence */} />
```

- [ ] **Step 3: Smoke test**

Run: `npm run dev`. Open chevron on a container, type a name, click Save. Open chevron on another container of the same kind → that template should appear in the radio list. Apply → child subtree appears.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/TemplatesSection.jsx client/src/modules/Module*.jsx
git commit -m "feat(templates): TemplatesSection in HeaderDropdown — apply / save / save-over"
```

### Task 4.2: Add template tiles to QuickAddMenu

**Files:**
- Modify: `client/src/ui/QuickAddMenu.jsx`

- [ ] **Step 1: Locate kind tile rendering**

Run: `grep -n "ALLOWED_KINDS_BY_ROLE\|New Textblock\|categories\|tiles" client/src/ui/QuickAddMenu.jsx`

- [ ] **Step 2: Add template lookup near the tile loop**

```jsx
import { templatesByKind } from "../helpers/templateHelpers";
import { commitApplyTemplate } from "../helpers/CommitHelpers";
// ...
const templates = useMemo(
  () => allowedKinds.flatMap(k => templatesByKind(state, activeGridId, k).map(t => ({ kind: k, tpl: t }))),
  [state, activeGridId, allowedKinds]
);
```

- [ ] **Step 3: Render template tiles below the "New X" tiles**

```jsx
{templates.length > 0 && (
  <div className="quickadd-templates" style={{ marginTop: 8 }}>
    <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>Templates</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {templates.map(({ tpl }) => (
        <button
          key={tpl.id}
          onClick={() => {
            commitApplyTemplate(socket, { templateOccurrenceId: tpl.id, targetOccurrenceId: hostOccurrence.id, mode: "append" });
            onClose?.();
          }}
          style={{ fontSize: 11, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--panel-border, #374151)", background: "transparent", color: "inherit", cursor: "pointer" }}
          title={`Add ${tpl.meta?.templateName}`}
        >
          📋 {tpl.meta?.templateName}
        </button>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 4: Smoke test**

Run: `npm run dev`. Save a template (Task 4.1), then open the QuickAddMenu on a same-kind parent — template tile should appear and apply on click.

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/QuickAddMenu.jsx
git commit -m "feat(quickadd): show template tiles for each allowed child kind"
```

### Task 4.3: Add TemplatesTab to Command Center

**Files:**
- Create: `client/src/ui/commandCenter/TemplatesTab.jsx`
- Modify: `client/src/ui/CommandCenter.jsx`

- [ ] **Step 1: Read CommandCenter to see existing tab pattern**

Run: `grep -n "Tab\|FieldsTab\|tabs" client/src/ui/CommandCenter.jsx | head -20`

- [ ] **Step 2: Write TemplatesTab**

```jsx
// client/src/ui/commandCenter/TemplatesTab.jsx
import React, { useState } from "react";
import { useStore } from "../../state/StoreProvider";
import { rootFolderForTemplates } from "../../helpers/templateHelpers";
import { commitApplyTemplate } from "../../helpers/CommitHelpers";
import CategoryPathPicker from "../CategoryPathPicker";

function TemplateRow({ occ, onSelect, selected }) {
  return (
    <div
      onClick={() => onSelect(occ.id)}
      style={{
        padding: "4px 6px", cursor: "pointer",
        background: selected ? "rgba(20,184,166,0.2)" : "transparent",
      }}
    >📋 {occ.meta?.templateName || "(unnamed)"}</div>
  );
}

function walk(state, folderId, depth, acc) {
  Object.values(state.occurrencesById || {})
    .filter(o => o.parentId === folderId && o.meta?.templateName)
    .forEach(o => acc.push({ kind: "tpl", occ: o, depth }));
  Object.values(state.foldersById || {})
    .filter(f => f.parentId === folderId)
    .forEach(f => {
      acc.push({ kind: "folder", folder: f, depth });
      walk(state, f.id, depth + 1, acc);
    });
}

export default function TemplatesTab() {
  const { state, socket } = useStore();
  const root = rootFolderForTemplates(state, state.activeGridId);
  const [selectedId, setSelectedId] = useState(null);
  const [pickingTarget, setPickingTarget] = useState(false);

  const rows = [];
  if (root) walk(state, root.id, 0, rows);

  const selected = selectedId ? state.occurrencesById[selectedId] : null;

  const onApplyTo = (targetOccurrenceId) => {
    commitApplyTemplate(socket, { templateOccurrenceId: selectedId, targetOccurrenceId, mode: "append" });
    setPickingTarget(false);
  };

  return (
    <div style={{ display: "flex", gap: 12, height: "100%" }}>
      <div style={{ flex: "0 0 240px", overflowY: "auto", borderRight: "1px solid var(--panel-border, #374151)", paddingRight: 8 }}>
        {!root && <div style={{ fontSize: 11, opacity: 0.5 }}>No templates manifest yet.</div>}
        {rows.map((r, i) => r.kind === "folder"
          ? <div key={r.folder.id} style={{ paddingLeft: r.depth * 12, fontSize: 11, opacity: 0.7 }}>📁 {r.folder.name}</div>
          : <div key={r.occ.id} style={{ paddingLeft: r.depth * 12 }}>
              <TemplateRow occ={r.occ} selected={r.occ.id === selectedId} onSelect={setSelectedId} />
            </div>
        )}
      </div>
      <div style={{ flex: 1 }}>
        {!selected && <div style={{ fontSize: 12, opacity: 0.5 }}>Select a template on the left.</div>}
        {selected && (
          <div>
            <h3 style={{ marginTop: 0 }}>{selected.meta?.templateName}</h3>
            <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>
              kind: {state.modulesById[selected.targetId]?.role || state.modulesById[selected.targetId]?.kind}
            </div>
            <button onClick={() => setPickingTarget(true)} style={{ fontSize: 12 }}>Apply to…</button>
            {pickingTarget && (
              <div style={{ marginTop: 8 }}>
                <CategoryPathPicker mode="occurrence" onSelect={onApplyTo} onCancel={() => setPickingTarget(false)} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Register tab in `CommandCenter.jsx`**

Find the tab list/config object and add an entry, e.g.:

```jsx
{ id: "templates", label: "Templates", render: () => <TemplatesTab /> }
```

- [ ] **Step 4: Smoke test**

Run: `npm run dev`. Open Command Center → Templates tab → confirm tree renders → select a template → click Apply to → pick a target → confirm subtree appears in the target.

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/commandCenter/TemplatesTab.jsx client/src/ui/CommandCenter.jsx
git commit -m "feat(templates): TemplatesTab in Command Center with apply-to path picker"
```

### Task 4.4: Verify `bindSocketToStore` handles new events

**Files:**
- Modify: `client/src/state/bindSocketToStore.js` (if needed)

- [ ] **Step 1: Confirm `module_created`, `occurrence_created`, `occurrence_updated`, `module_deleted`, `occurrence_deleted` are handled**

Run: `grep -n "module_created\|occurrence_created\|module_deleted\|occurrence_deleted" client/src/state/bindSocketToStore.js | head`

If all are handled, no change needed. Otherwise, add reducers for the missing events using the existing patterns.

- [ ] **Step 2: Smoke test (full apply cycle)**

Run: `npm run dev`. Save a template, apply via TemplatesTab, confirm clones appear in the UI in real time without reload.

- [ ] **Step 3: Commit (if changes made)**

```bash
git add client/src/state/bindSocketToStore.js
git commit -m "feat(state): handle template clone events in store binder"
```

---

## Phase 5 — APPLY_TEMPLATE op step + Schedule rewrite

### Task 5.1: Add `APPLY_TEMPLATE` to client `operationActions.js` action registry

**Files:**
- Modify: `client/src/helpers/operationActions.js`

- [ ] **Step 1: Find action type list**

Run: `grep -n "SET_FIELD_VALUE\|CREATE\|actionTypes\|switch" client/src/helpers/operationActions.js | head -20`

- [ ] **Step 2: Add config schema for APPLY_TEMPLATE**

In the action-type definitions, add:

```javascript
APPLY_TEMPLATE: {
  label: "Apply Template",
  configSchema: {
    templateRef: { type: "string", required: true, description: "Template occurrence id or $var" },
    targetOccurrenceVar: { type: "string", required: true, description: "$var holding target occurrence id" },
    mode: { type: "enum", values: ["append", "replace"], default: "append" },
    resultVar: { type: "string", required: true, description: "$var to receive array of new occurrence ids" },
  },
},
```

- [ ] **Step 3: Commit**

```bash
git add client/src/helpers/operationActions.js
git commit -m "feat(ops): register APPLY_TEMPLATE action schema"
```

### Task 5.2: Implement `APPLY_TEMPLATE` in client `operationExecutor.js`

**Files:**
- Modify: `client/src/helpers/operationExecutor.js`

- [ ] **Step 1: Locate step dispatch switch**

Run: `grep -n "case \"CREATE\"\|case \"SET_FIELD_VALUE\"" client/src/helpers/operationExecutor.js | head`

- [ ] **Step 2: Add case**

```javascript
case "APPLY_TEMPLATE": {
  const templateRef = resolveExpr(step.config.templateRef, vars);
  const target = resolveExpr(step.config.targetOccurrenceVar, vars);
  const mode = step.config.mode || "append";
  const result = await applyTemplateInExecutor({
    templateOccurrenceId: templateRef,
    targetOccurrenceId: target,
    mode,
    state, socket,
  });
  if (step.config.resultVar) vars[step.config.resultVar] = result.newOccurrenceIds;
  effects.push(...result.effects);
  break;
}
```

- [ ] **Step 3: Implement `applyTemplateInExecutor`**

Add at module scope:

```javascript
async function applyTemplateInExecutor({ templateOccurrenceId, targetOccurrenceId, mode, state, socket }) {
  return new Promise((resolve) => {
    const handler = (payload) => {
      socket.off("template_applied", handler);
      resolve({
        rootOccurrenceId: payload.rootOccurrenceId,
        newOccurrenceIds: payload.newOccurrenceIds,
        effects: [],
      });
    };
    socket.on("template_applied", handler);
    socket.emit("apply_template", { templateOccurrenceId, targetOccurrenceId, mode });
  });
}
```

- [ ] **Step 4: Write executor test**

Create `client/src/__tests__/applyTemplateStep.test.js`:

```javascript
import { executePipeline } from "../helpers/operationExecutor";

describe("APPLY_TEMPLATE step", () => {
  test("emits apply_template with resolved refs and binds resultVar", async () => {
    const emits = [];
    const handlers = {};
    const socket = {
      emit: (ev, payload) => {
        emits.push([ev, payload]);
        if (ev === "apply_template") setTimeout(() => handlers["template_applied"]?.({ rootOccurrenceId: "r1", newOccurrenceIds: ["r1", "c1"] }), 0);
      },
      on: (ev, h) => { handlers[ev] = h; },
      off: () => {},
    };
    const state = { occurrencesById: { tgt: { id: "tgt" } } };
    const pipeline = {
      steps: [
        { type: "INIT_VAR", config: { name: "$target", value: "tgt" } },
        { type: "APPLY_TEMPLATE", config: { templateRef: "tpl-1", targetOccurrenceVar: "$target", mode: "append", resultVar: "$new" } },
      ],
    };
    const r = await executePipeline(pipeline, { state, socket, trigger: {} });
    expect(emits.find(([e]) => e === "apply_template")?.[1]).toMatchObject({
      templateOccurrenceId: "tpl-1", targetOccurrenceId: "tgt", mode: "append",
    });
    expect(r.vars.$new).toEqual(["r1", "c1"]);
  });
});
```

- [ ] **Step 5: Run test**

Run: `npm --prefix ./client run test -- applyTemplateStep`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/helpers/operationExecutor.js client/src/__tests__/applyTemplateStep.test.js
git commit -m "feat(ops): APPLY_TEMPLATE pipeline step delegates to apply_template socket"
```

### Task 5.3: Rewrite `Schedule: Build Day` in createTestGrid.js

**Files:**
- Modify: `server/scripts/createTestGrid.js`

- [ ] **Step 1: Add a "Daily Routine" template subtree to the seed**

After ensuring the Templates manifest exists (or call `ensureTemplatesManifest`), build a template occurrence subtree representing the 48 timeslots + their routine items. Each slot is a container occurrence with `meta.scheduleSlot: true, meta.slotLabel: "6:00 AM"` etc., children = the seed instances for that slot. Root parentId = templates manifest root folder. Root has `meta.templateName: "Daily Routine"` and `meta.templateModule: true` on its module.

```javascript
// pseudo-structure
const dailyRoutineRootModId = "tpl-mod-daily-routine";
const dailyRoutineRootOccId = "tpl-occ-daily-routine";
// Module: kind "list", role "container", meta.templateModule true
// Occurrence: parentId = templates root folder, meta.templateName "Daily Routine"
// Children: 48 slot occurrences, each a container module with its routine instances
```

Add a helper `buildDailyRoutineTemplate(uc, gridId, userId, templatesRootFolderId, slots, presets)` that mints the modules + occurrences in `uc` and persists them via `Module.findOneAndUpdate` / `Occurrence.findOneAndUpdate`.

- [ ] **Step 2: Replace the Build Day op pipeline**

Old:
```
LOOP slots → FIND slot → IF missing CREATE slot ... → LOOP presets → FIND inst → IF missing CREATE inst
```

New:
```
FIND $schedPage
INIT_VAR $schedDate from $schedPage._effectiveFilter
FIND $dailyRoutineTemplate (by meta.templateName "Daily Routine")
APPLY_TEMPLATE { templateRef: $dailyRoutineTemplate, targetOccurrenceVar: $schedPage, mode: "append", resultVar: $new }
LOOP $new → IF role IS instance → SET_FIELD_VALUE [dateFieldId] = $schedDate
                                  SET_FIELD_VALUE [dueFieldId] = $schedDate
```

- [ ] **Step 3: Reseed**

Run: `node --env-file=.env server/scripts/createTestGrid.js`
Expected: script completes, Daily Routine template appears in the Templates manifest, schedule page is empty until Build Day fires.

- [ ] **Step 4: Smoke test**

Run: `npm run dev`. Navigate to a fresh date — Build Day op fires, schedule fills in. Confirm dates on the new instances match the active date.

- [ ] **Step 5: Commit**

```bash
git add server/scripts/createTestGrid.js
git commit -m "feat(schedule): Build Day uses APPLY_TEMPLATE from Daily Routine template"
```

### Task 5.4: Rewrite `Schedule: Seed Daily Routine` similarly

**Files:**
- Modify: `server/scripts/createTestGrid.js`

- [ ] **Step 1: Replace its 12-preset LOOP with `APPLY_TEMPLATE` of the same Daily Routine template under the appropriate slot (or skip — Build Day now covers it)**

Decision: if Build Day already handles seeding via the template, Seed Daily Routine becomes redundant. Either:
- delete it,
- or keep it as a smaller "single-slot" template (Routine for One Slot) — your call. Simplest: delete and route both triggers through Build Day with priority.

- [ ] **Step 2: Update `RUN_OPERATION` callers**

If trackers call `Schedule: Seed Daily Routine`, point them at `Schedule: Build Day` instead.

- [ ] **Step 3: Reseed + smoke**

Run: `node --env-file=.env server/scripts/createTestGrid.js && npm run dev`.

- [ ] **Step 4: Commit**

```bash
git add server/scripts/createTestGrid.js
git commit -m "refactor(schedule): collapse Seed Daily Routine into Build Day template"
```

---

## Phase 6 — Cleanup + verification

### Task 6.1: Sweep for dead code

- [ ] **Step 1: Search**

Run: `grep -rn "save_template\|fill_from_template\|FilterButton" client server | grep -v migrateLegacyTemplates`

Expected: zero hits.

- [ ] **Step 2: Remove any stragglers**

If hits exist, delete them.

- [ ] **Step 3: Commit (if needed)**

```bash
git add -u
git commit -m "chore: remove residual legacy template / FilterButton references"
```

### Task 6.2: Update folder-level CLAUDE.md docs

**Files:**
- Modify: `client/src/ui/CLAUDE.md`, `client/src/modules/CLAUDE.md`, `client/src/helpers/CLAUDE.md`, `server/CLAUDE.md`

- [ ] **Step 1: Add a "Recent Changes (2026-05-13 — HeaderDropdown + Templates v2)" block to each**

Cover:
- `client/src/ui/CLAUDE.md`: HeaderDropdown, HeaderChevron, FiltersSection, TemplatesSection, FilterNavWidgets, TemplatesTab files + roles. FilterButton retired.
- `client/src/modules/CLAUDE.md`: Module*.jsx now mount HeaderChevron + HeaderDropdown instead of FilterButton.
- `client/src/helpers/CLAUDE.md`: templateHelpers.js traversal; CommitHelpers new template commits; legacy template commits removed; operationActions.js + operationExecutor.js gain APPLY_TEMPLATE.
- `server/CLAUDE.md`: socketHandlers/templates.js rewritten (clone_subtree_as_template / apply_template / save_over_template); utils/cloneSubtree.js + utils/templatesManifest.js added; createTestGrid.js Build Day rewritten.

- [ ] **Step 2: Update root CLAUDE.md handoff section**

Replace the carryover punch-list with a new handoff block describing what shipped + any open items.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md client/src/ui/CLAUDE.md client/src/modules/CLAUDE.md client/src/helpers/CLAUDE.md server/CLAUDE.md
git commit -m "docs: update CLAUDE.md files for HeaderDropdown + Templates v2"
```

### Task 6.3: Full acceptance pass

- [ ] **Step 1: Full server test suite**

Run: `npm --prefix ./server run test`
Expected: all pass.

- [ ] **Step 2: Full client test suite**

Run: `npm --prefix ./client run test`
Expected: all pass.

- [ ] **Step 3: Manual acceptance walkthrough**

Walk the 14 acceptance criteria from the spec in order. Note any failures.

- [ ] **Step 4: Final commit (if fixes made)**

```bash
git add -u
git commit -m "fix: address acceptance pass findings"
```

---

## Self-Review Notes

Spec coverage:
- AC 1 (HeaderDropdown overlay): Task 2.2, 2.5, 2.6.
- AC 2 (FilterButton retired): Task 2.7.
- AC 3 (ancestor toggle): Task 2.4 (FiltersSection).
- AC 4 (own filter writes override): Task 2.4.
- AC 5 (type-dispatched nav widgets): Task 2.3 + Task 2.8.
- AC 6 (Templates manifest seeded): Task 1.4.
- AC 7 (save-as-template clones with templateModule): Task 3.1, 3.2, 4.1.
- AC 8 (apply deep-clones with appliedFromTemplateId): Task 3.1, 3.2.
- AC 9 (save-over): Task 3.2, 4.1.
- AC 10 (TemplatesTab in Command Center): Task 4.3.
- AC 11 (APPLY_TEMPLATE op step): Task 5.1, 5.2.
- AC 12 (Schedule: Build Day rewrite): Task 5.3, 5.4.
- AC 13 (migration): Task 3.4.
- AC 14 (no regression): Task 6.3.

No placeholders / TBDs. Types and function names verified consistent: `cloneSubtree`, `ensureTemplatesManifest`, `commitApplyTemplate`, `commitCloneSubtreeAsTemplate`, `commitSaveOverTemplate`, `templatesByKind`, `rootFolderForTemplates`, `templatesManifestFor` used identically across files.
