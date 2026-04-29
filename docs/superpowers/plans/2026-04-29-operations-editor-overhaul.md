# Operations Editor Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the path picker to be a categorized, drill-down selector (Sources / Occurrences / Fields / Local Variables / Built-ins) reused everywhere a path is picked (operations editor + the panel/container `+` menu). Tighten Sources to be the sole entrypoint for trigger / state JSON. Fix the path-picker selection bug, the pipeline-reorder crash, the run-log array stringification, the bogus `due: date` rendering, and a number of UX issues raised in the brief.

**Architecture:** Build one categorized path-picker component (`CategoryPathPicker`) backed by an explicit category registry. Replace `SelectDrilldown` everywhere paths are picked in the operations editor and reuse it inside `QuickAddMenu`. Funnel all trigger/state JSON through Sources (the picker only shows `$vars` declared by Sources or by INIT_VAR/SET_VAR/loop). Fix the per-bug items inline.

**Tech Stack:** React 18, Pragmatic DnD (`@atlaskit/pragmatic-drag-and-drop`), TipTap, lucide-react icons. No new libraries.

---

## File Structure

**Create:**
- `client/src/ui/CategoryPathPicker.jsx` — the new categorized picker (replaces `SelectDrilldown` for path-mode usage; keeps `SelectDrilldown` for non-path drilldowns).
- `client/src/ui/CategoryPathPicker.test.js` — unit tests (rendering, drilldown, stop-at-category, value formatting).
- `client/src/ui/categoryRegistry.js` — pure data: category definitions, icons, colors, descriptions, item resolvers.

**Modify:**
- `client/src/blocks/OperationsBuilder.jsx` — every `ExprOrPath` site, `SourceRow` (use new picker for entity selection), remove `dateScope` UI from FIND, remove "Use list instead" / "Single value" toggle, remove "Pipelines don't see `$trigger.*`" hint, fix LOOP/IF reorder children, add Save+Exit button.
- `client/src/blocks/ConditionGroup.jsx` — replace path inputs with `CategoryPathPicker`.
- `client/src/ui/QuickAddMenu.jsx` — two-tier (category → items) with `PanelKindSelector`-style rows.
- `client/src/ui/SelectDrilldown.jsx` — `buildPathConfig` deprecated for path use; non-trigger built-ins (`$allItems`, `$allTemplates`, `$parentFilter`) removed from auto-exposed shape (Sources are now required for these too).
- `client/src/ui/commandCenter/OperationsTab.jsx` — Save button → returns to list view; remove "Run on load" remnants if any; cap `OperationEditor` log/JSON max-depth so arrays render expandably.
- `client/src/ui/commandCenter/OperationLogPanel.jsx` — `inlineLiteral` should never coerce arrays/objects to strings (`[Array(80)]`); always pass through to `JsonNode`. Verify deep nesting does not stringify.
- `client/src/helpers/operationActions.js` — remove `dateScope` predicate logic from FIND, remove the `cfg.scope?.dateFieldId` branch (replaced by explicit predicate rules); fix `due` field display so CREATE writes the resolved value (not the literal expression string).
- `client/src/helpers/operationExecutor.js` — drop residual `iteration*` keys from `$trigger` enrichment (lines 884–904, 1109, 1126, 1136–1151, 1181, 1196, 1228–1229, 1258); add `effectiveFilterFor(occurrenceId)` helper that walks ancestor chain and returns merged filter (replaces `$parentFilter` for use cases that need a specific ancestor's filter).
- `client/src/state/bindSocketToStore.js` — narrow `onFilterChange` firing: only fire ops whose `triggerConfig` `subjectRole` matches an ancestor of the operation's tracked occurrence (or just don't fire on global schedule-filter changes for ops that target a specific container).
- `client/src/blocks/CLAUDE.md`, `client/src/ui/CLAUDE.md`, `client/src/helpers/CLAUDE.md` — add changelog entries.

**Test fixtures:**
- `client/src/__tests__/categoryPathPicker.test.js`
- Updated `client/src/__tests__/operationExecutor.test.js` — assert iteration keys are gone, `effectiveFilterFor(occId)` works.
- Updated `client/src/__tests__/operationActions.test.js` — assert `due` field receives resolved value.

---

## Bug Inventory (from brief)

The implementation tasks below address each of these — the IDs (B1, B2…) are referenced from each task.

- **B1**: Path picker only lets `$today` / `$date` resolve; other built-ins fail to select.
- **B2**: Path picker shows "Pick a variable" placeholder — should show categories.
- **B3**: Path picker uses dot syntax (`$item.fields.x.value`) — should show fluffed-out chip per segment, no dots.
- **B4**: Path picker is broad-to-granular but not stoppable — user wants to pick `$allContainers` without going further.
- **B5**: Sources do not allow selecting `parentFilter`; entity picker is a flat select, not the path picker.
- **B6**: All trigger/state JSON should funnel through Sources (currently `$allItems`, `$allTemplates`, `$parentFilter` are auto-exposed in path picker).
- **B7**: "Use list instead" / "Single value" buttons in INIT_VAR — remove.
- **B8**: `dateScope` UI in FIND — remove (predicates handle this).
- **B9**: Helper text "Pipelines don't see `$trigger.*` directly…" — remove.
- **B10**: Save button absent — Save should commit & exit to operations list.
- **B11**: Pipeline step reorder crashes when dragging.
- **B12**: Step reorder should carry children (LOOP body, IF then/else).
- **B13**: Run log shows `allItems: [Array(80)]` as a string — should be expandable.
- **B14**: `iteration` still showing in `$trigger` snapshot.
- **B15**: Water/Completed ops use `$parentFilter` — must look up "Physical" container's effective filter instead.
- **B16**: `onFilterChange` for those ops fires on schedule filter changes — should only fire when an ancestor of the op's tracked occurrences changes.
- **B17**: Path picker overhaul applies to all pipeline actions (FIND, CREATE, UPDATE, DELETE, IF, LOOP, etc.).
- **B18**: `+` button on headers (`QuickAddMenu`) is flat — wants two-tier (category first, then items) using same picker style.
- **B19**: Operations editor has unfilled spots when seed data loads — every spot should be fillable & filled. Language confusing.
- **B20**: `due` field stamp from operation shows literal `"due: date"` text rather than the resolved date value.

---

# Tasks

### Task 1: Category Registry (pure data layer)

**Files:**
- Create: `client/src/ui/categoryRegistry.js`
- Test: `client/src/__tests__/categoryRegistry.test.js`

The registry is a pure list of category definitions. Each category has: id, label, description, icon, color, and a `resolveItems(ctx)` function that returns the level-1 items. Categories are explicit so the picker stays fast and the user always sees a stable taxonomy.

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/categoryRegistry.test.js
import { describe, it, expect } from "vitest";
import { CATEGORIES, resolveCategoryItems } from "../ui/categoryRegistry";

describe("categoryRegistry", () => {
  it("declares the five top-level categories in order", () => {
    expect(CATEGORIES.map(c => c.id)).toEqual([
      "sources", "occurrences", "fields", "localVars", "builtins",
    ]);
  });

  it("each category has label, description, icon, color, resolveItems", () => {
    for (const c of CATEGORIES) {
      expect(c.label).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(c.icon).toBeTruthy();
      expect(c.color).toBeTruthy();
      expect(typeof c.resolveItems).toBe("function");
    }
  });

  it("resolves Sources items from ctx.sources", () => {
    const ctx = { sources: [{ id: "a", variableName: "schedDate" }], localVars: [], modulesById: {}, occurrencesById: {}, fields: [] };
    const items = resolveCategoryItems("sources", ctx);
    expect(items.find(i => i.value === "$schedDate")).toBeTruthy();
  });

  it("resolves Occurrences with sub-categories (all, containers, pages, instances, templates)", () => {
    const ctx = { sources: [], localVars: [], modulesById: {}, occurrencesById: {}, fields: [] };
    const items = resolveCategoryItems("occurrences", ctx);
    expect(items.map(i => i.value)).toContain("$allItems");
    expect(items.map(i => i.value)).toContain("$allContainers");
    expect(items.map(i => i.value)).toContain("$allPages");
    expect(items.map(i => i.value)).toContain("$allInstances");
    expect(items.map(i => i.value)).toContain("$allTemplates");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/__tests__/categoryRegistry.test.js`
Expected: FAIL with `Cannot find module '../ui/categoryRegistry'`

- [ ] **Step 3: Implement registry**

```js
// client/src/ui/categoryRegistry.js
import { Database, Box, Hash, Variable, Sparkles } from "lucide-react";

export const CATEGORIES = [
  {
    id: "sources",
    label: "Sources",
    description: "Variables you bound from the trigger, parent filter, or other entities.",
    icon: Database,
    color: "rgba(59,130,246,0.7)",   // blue
    resolveItems: (ctx) => (ctx.sources || []).map(s => ({
      value: `$${s.variableName}`,
      title: `$${s.variableName}`,
      sub: s.entityType,
      hasChildren: true,
    })),
  },
  {
    id: "occurrences",
    label: "Occurrences",
    description: "All placements on the grid — pages, containers, instances, templates.",
    icon: Box,
    color: "rgba(34,197,94,0.7)",    // green
    resolveItems: () => [
      { value: "$allItems",       title: "All occurrences",  sub: "every placement",    hasChildren: true },
      { value: "$allContainers",  title: "All containers",   sub: "containers only",    hasChildren: true },
      { value: "$allPages",       title: "All pages",        sub: "page-role panels",   hasChildren: true },
      { value: "$allInstances",   title: "All instances",    sub: "leaf items",         hasChildren: true },
      { value: "$allTemplates",   title: "All templates",    sub: "module records",     hasChildren: true },
    ],
  },
  {
    id: "fields",
    label: "Fields",
    description: "Field templates declared on the grid.",
    icon: Hash,
    color: "rgba(168,85,247,0.7)",   // purple
    resolveItems: (ctx) => (ctx.fields || []).map(f => ({
      value: `field:${f.id}`,
      title: f.name || "(unnamed field)",
      sub: f.type,
      hasChildren: true,
    })),
  },
  {
    id: "localVars",
    label: "Local Variables",
    description: "Vars declared in this pipeline (INIT_VAR / SET_VAR / loop.as).",
    icon: Variable,
    color: "rgba(251,191,36,0.7)",   // amber
    resolveItems: (ctx) => (ctx.localVars || []).map(name => ({
      value: name,
      title: name,
      sub: null,
      hasChildren: true,
    })),
  },
  {
    id: "builtins",
    label: "Built-ins",
    description: "Date/time/grid scalars provided by the runtime.",
    icon: Sparkles,
    color: "rgba(244,114,182,0.7)",  // pink
    resolveItems: () => [
      { value: "$today",            title: "$today",            sub: "YYYY-MM-DD (local)",       hasChildren: false },
      { value: "$now",              title: "$now",              sub: "ISO timestamp",            hasChildren: false },
      { value: "$activeDate",       title: "$activeDate",       sub: "active filter date",       hasChildren: false },
      { value: "$activeDateLabel",  title: "$activeDateLabel",  sub: "human-readable",           hasChildren: false },
      { value: "$activeDayOfWeek",  title: "$activeDayOfWeek",  sub: "Monday/Tuesday/...",       hasChildren: false },
      { value: "$grid",             title: "$grid",             sub: "current grid",             hasChildren: true },
    ],
  },
];

export function resolveCategoryItems(categoryId, ctx) {
  const cat = CATEGORIES.find(c => c.id === categoryId);
  return cat ? cat.resolveItems(ctx) : [];
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd client && npx vitest run src/__tests__/categoryRegistry.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/categoryRegistry.js client/src/__tests__/categoryRegistry.test.js
git commit -m "feat(operations): add category registry for path picker"
```

---

### Task 2: CategoryPathPicker component (level 1 = categories)

**Files:**
- Create: `client/src/ui/CategoryPathPicker.jsx`
- Test: `client/src/__tests__/CategoryPathPicker.test.jsx`

This is the new path picker. **Closed state:** if a path is selected, render it as a chip-chain of fluffed-out segments (no dots). If empty, render a "+" pill that opens the picker. **Open state:** level 1 shows the 5 categories as `PanelKindSelector`-style rows (icon block, label, description). Levels 2+ drill into the selected branch via the existing shape-walking logic but render as the same row style. **Each level is stoppable** — every item with `hasChildren=true` gets both a row click (drill in) and a separate "Pick this" affordance (caret/check icon on the right).

- [ ] **Step 1: Write the failing test**

```jsx
// client/src/__tests__/CategoryPathPicker.test.jsx
import { describe, it, expect } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import CategoryPathPicker from "../ui/CategoryPathPicker";

const baseCtx = { sources: [], fields: [], localVars: [], modulesById: {}, occurrencesById: {}, fieldsById: {} };

describe("CategoryPathPicker", () => {
  it("renders a + pill when no value", () => {
    render(<CategoryPathPicker value="" ctx={baseCtx} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /pick path/i })).toBeTruthy();
  });

  it("opens the level-1 category menu on click", () => {
    render(<CategoryPathPicker value="" ctx={baseCtx} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /pick path/i }));
    expect(screen.getByText("Sources")).toBeTruthy();
    expect(screen.getByText("Occurrences")).toBeTruthy();
    expect(screen.getByText("Fields")).toBeTruthy();
    expect(screen.getByText("Local Variables")).toBeTruthy();
    expect(screen.getByText("Built-ins")).toBeTruthy();
  });

  it("renders a fluffed-out chip chain (no dots) when a value is selected", () => {
    const value = "$allContainers";
    const { container } = render(<CategoryPathPicker value={value} ctx={baseCtx} onChange={() => {}} />);
    // chain renders one chip per segment; no '.' separator text
    expect(container.textContent).not.toMatch(/\$allContainers\./);
    expect(screen.getByText("$allContainers")).toBeTruthy();
  });

  it("supports stopping at a category-level item (e.g. $allContainers without drilling further)", () => {
    const onChange = vi.fn();
    render(<CategoryPathPicker value="" ctx={baseCtx} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /pick path/i }));
    fireEvent.click(screen.getByText("Occurrences"));
    // user clicks the "Pick this" chevron next to "All containers"
    fireEvent.click(screen.getByTestId("pick-this-$allContainers"));
    expect(onChange).toHaveBeenCalledWith("$allContainers");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/__tests__/CategoryPathPicker.test.jsx`
Expected: FAIL with `Cannot find module '../ui/CategoryPathPicker'`

- [ ] **Step 3: Implement CategoryPathPicker**

Implementation outline (write the full file):
- Maintain `levels[]` state — each level is `{ items: [{value,title,sub,hasChildren}], parentValue?: string }`.
- Level 1 = `CATEGORIES` rendered with `PanelKindSelector`-style rows (icon block + label + description).
- Drilling into a category sets `levels = [{ items: cat.resolveItems(ctx), parentValue: null }]`.
- Drilling into an item with `hasChildren=true` walks the same shape that `buildPathConfig` builds today (fields → field-id objects → `value`/`flow`; occurrences → `targetId`/`parentId`/`fields`/`_ancestors`/`meta`/`label`/`templateId`).
- Each row with `hasChildren=true` renders both a body click (drill in) and a small `<ChevronRight>` "pick this" icon on the right (`data-testid="pick-this-{value}"`) — clicking it commits the chain up to and including that segment.
- Each leaf row commits the chain on click.
- Closed state: split the saved string by `.` into segments, render each segment as a chip with a `›` between them (no `.`). Add an `×` to clear. The chip area stops being clickable once a value exists (matches the Apr 29 SelectDrilldown change).

Use the same portal/positioning pattern as `SelectDrilldown` (createPortal to `document.body`, position-fixed, outside-click close). Reuse the icon + color from the registry for the level-1 row tile.

- [ ] **Step 4: Run test to verify pass**

Run: `cd client && npx vitest run src/__tests__/CategoryPathPicker.test.jsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/CategoryPathPicker.jsx client/src/__tests__/CategoryPathPicker.test.jsx
git commit -m "feat(operations): CategoryPathPicker with category-first drilldown (B1, B2, B3, B4)"
```

---

### Task 3: Wire CategoryPathPicker into ExprOrPath

**Files:**
- Modify: `client/src/blocks/OperationsBuilder.jsx` (lines 791–856 — the `ExprOrPath` component)

`ExprOrPath` currently has three modes (`path`/`text`/`array`) via a `<select>`. Keep all three — only the path-mode renderer changes. Replace `<SelectDrilldown config={pathConfig} … />` with `<CategoryPathPicker value={value} ctx={…} onChange={onChange} />` and delete the `pathConfig`/`buildPathConfig` import for path mode.

- [ ] **Step 1: Replace path-mode renderer**

In `OperationsBuilder.jsx`, find:
```jsx
{mode === "path" && (
  <SelectDrilldown
    config={pathConfig}
    value={typeof value === "string" && value ? [pathStringToChain(value)] : []}
    onChange={chains => onChange(chains.length > 0 ? chainToPathString(chains[chains.length - 1]) : "")}
  />
)}
```

Replace with:
```jsx
{mode === "path" && (
  <CategoryPathPicker
    value={typeof value === "string" ? value : ""}
    ctx={{ sources, fields, localVars, modulesById, occurrencesById, fieldsById }}
    onChange={onChange}
  />
)}
```

Add the import:
```jsx
import CategoryPathPicker from "../ui/CategoryPathPicker";
```

Remove now-unused imports if `SelectDrilldown`/`buildPathConfig` are no longer used in this file (likely still used by `ConditionGroup` — only remove the local `pathConfig` useMemo, not the imports if shared).

- [ ] **Step 2: Verify in the editor**

Run `npm run dev`, open command center → Operations → click any operation → confirm path-mode inputs now show the new picker (5 category rows on click).

- [ ] **Step 3: Commit**

```bash
git add client/src/blocks/OperationsBuilder.jsx
git commit -m "feat(operations): use CategoryPathPicker in ExprOrPath (B17)"
```

---

### Task 4: Wire CategoryPathPicker into ConditionGroup

**Files:**
- Modify: `client/src/blocks/ConditionGroup.jsx`

`ConditionGroup` (used by IF and FIND.predicate) renders `left` / `right` expressions. They must use the same path picker so condition rules also benefit from the category-first UX (B17).

- [ ] **Step 1: Read the file**

Read the current `ConditionGroup.jsx` and find its expression-input usages (likely `<ExprInput>` or `<SelectDrilldown>` directly).

- [ ] **Step 2: Replace each path-input site with CategoryPathPicker**

For each input that accepts a path, wrap it in the same mode-select pattern from `ExprOrPath` (`path`/`text` — array isn't useful here). The cleanest option is: import `ExprOrPath` from `OperationsBuilder.jsx` and use it directly. If circular-import risk, extract `ExprOrPath` into its own file `client/src/blocks/ExprOrPath.jsx` and import from both.

- [ ] **Step 3: Verify in the editor**

Add an IF step in an op editor → confirm left/right of every rule now uses the category picker.

- [ ] **Step 4: Commit**

```bash
git add client/src/blocks/ConditionGroup.jsx client/src/blocks/ExprOrPath.jsx
git commit -m "feat(operations): use CategoryPathPicker in ConditionGroup (B17)"
```

---

### Task 5: Sources gating — drop auto-exposed state vars from picker

**Files:**
- Modify: `client/src/ui/SelectDrilldown.jsx` (only the `buildPathConfig` function — the component is still used elsewhere)
- Modify: `client/src/ui/categoryRegistry.js` — `Occurrences` category items should NOT auto-create `$allItems` etc. as picker-visible vars unless a Source row has bound them (B6).

Re-reading the brief: *"ALL the stuff we get in the json should only be accessable in sources to be reassigned. not just the trigger object."* Implementation: `$allItems`, `$allTemplates`, `$parentFilter`, `$allContainers`, `$allPages`, `$allInstances` are no longer auto-exposed. The Occurrences category in the picker only shows what Sources have promoted, and Sources gain new entity types (`allOccurrences`, `allContainers`, `allPages`, `allInstances`, `allTemplates`, `parentFilter`) that bind those collections to a named `$var`.

- [ ] **Step 1: Add the new entity types to Sources**

In `OperationsBuilder.jsx`, find `ENTITY_TYPES` (top of file). Add:
```js
{ value: "allOccurrences", label: "All occurrences", hint: "$var = every occurrence on the grid" },
{ value: "allContainers",  label: "All containers",  hint: "$var = every container occurrence"  },
{ value: "allPages",       label: "All pages",       hint: "$var = every page-role panel"       },
{ value: "allInstances",   label: "All instances",   hint: "$var = every leaf instance"         },
{ value: "allTemplates",   label: "All templates",   hint: "$var = every module template"       },
{ value: "parentFilter",   label: "Parent filter",   hint: "$var = effective filter walked from trigger occurrence ancestors" },
```

- [ ] **Step 2: Implement the matching source-resolution branches in `executePipeline`**

In `client/src/helpers/operationExecutor.js`, find the source-resolution loop (around line 870 — the `if/else if (entityType === ...)` chain). Add cases:
```js
} else if (entityType === "allOccurrences") {
  $vars[varKey] = Object.values(occurrencesById).filter(o => o && !o.deleted);
} else if (entityType === "allContainers") {
  $vars[varKey] = Object.values(occurrencesById).filter(o => modulesById[o.targetId]?.role === "container");
} else if (entityType === "allPages") {
  $vars[varKey] = Object.values(occurrencesById).filter(o => modulesById[o.targetId]?.role === "panel");
} else if (entityType === "allInstances") {
  $vars[varKey] = Object.values(occurrencesById).filter(o => modulesById[o.targetId]?.role === "instance");
} else if (entityType === "allTemplates") {
  $vars[varKey] = Object.values(modulesById).filter(m => m && !m.trashed);
} else if (entityType === "parentFilter") {
  // walk trigger occurrence ancestors and merge effective filter values
  $vars[varKey] = computeParentFilter(triggerOcc, occurrencesById, gridFilters);
}
```

- [ ] **Step 3: Stop auto-exposing built-in arrays in path picker**

In `client/src/ui/SelectDrilldown.jsx`, `buildPathConfig` — remove the lines that push `$allItems`, `$allTemplates`, `$parentFilter` into `shapeByVar` automatically. The path picker now only sees `$vars` declared by Sources or by INIT_VAR / SET_VAR / loop.as.

- [ ] **Step 4: Update `categoryRegistry.js` Occurrences resolver**

Change the Occurrences resolver to read from `ctx.sources` (filtered to entity types `allOccurrences` / `allContainers` / `allPages` / `allInstances` / `allTemplates`) and from local-var declarations of similar shape — the static `$allItems` / `$allContainers` / etc. items are removed.

- [ ] **Step 5: Run tests**

Run: `cd client && npx vitest run src/__tests__/categoryRegistry.test.js src/__tests__/CategoryPathPicker.test.jsx`
Update test expectations to match the new gated behavior (the test that expected `$allItems` should now expect that providing a Source row with `entityType: "allOccurrences"` exposes it).

- [ ] **Step 6: Commit**

```bash
git add client/src/blocks/OperationsBuilder.jsx client/src/helpers/operationExecutor.js client/src/ui/SelectDrilldown.jsx client/src/ui/categoryRegistry.js client/src/__tests__/categoryRegistry.test.js client/src/__tests__/CategoryPathPicker.test.jsx
git commit -m "refactor(operations): gate state JSON behind explicit Sources (B5, B6)"
```

---

### Task 6: SourceRow uses the path picker for entity selection

**Files:**
- Modify: `client/src/blocks/OperationsBuilder.jsx` (`SourceRow`, lines 496–622)

The user wants Sources to use the same path picker UX, not raw `<select>` boxes. For entity types that pick a specific module (`instance`/`container`/`panel`), the picker should show categories first (Containers / Pages / Instances) and drill into the list. For `field` and `parentFilter` it remains a single picker.

- [ ] **Step 1: Replace the entity picker for module-typed sources**

For `entityType === "instance" | "container" | "panel"`, replace the `<select>` with a small `CategoryPathPicker`-like helper component or reuse `CategoryPathPicker` but configured for module-id selection (a thin wrapper `EntityPicker` that uses the same row-tile UI from level 1 but emits a module ID).

Cleanest path: add a `mode="entity"` prop to `CategoryPathPicker` that swaps the level-1 categories for `[Containers, Pages, Instances]` (when source type is module-shaped). Alternatively, create `EntityPicker.jsx` that mirrors the visual style.

- [ ] **Step 2: Remove the `triggerProp` `<optgroup>` block (lines 541–592)**

Trigger prop selection now happens inside the picker — for `entityType === "trigger"`, the picker's level-1 shows the same Identity / Item-occurrence / Field change / Parents-move / Filter-navigation / Transaction sub-categories as rows. Implement this as a special-case branch in the entity picker.

- [ ] **Step 3: Verify**

Open the editor, add a new Source, switch entity type to "trigger" — confirm category rows appear instead of raw `<optgroup>`.

- [ ] **Step 4: Commit**

```bash
git add client/src/blocks/OperationsBuilder.jsx
git commit -m "feat(operations): SourceRow entity picker uses CategoryPathPicker (B5)"
```

---

### Task 7: Remove dateScope, "Use list instead", and helper-text noise

**Files:**
- Modify: `client/src/blocks/OperationsBuilder.jsx`
- Modify: `client/src/helpers/operationActions.js`

- [ ] **Step 1: Remove dateScope UI from FIND**

In `OperationsBuilder.jsx`, find lines 1154–1163 (the `Date scope (optional):` block inside the FIND case) and delete them entirely. The user can express date scoping via predicate rules (`$item.fields.date.value` IS `$today`) — no special UI needed.

- [ ] **Step 2: Remove dateScope from the executor**

In `client/src/helpers/operationActions.js`, find the FIND case (lines 419–473). Remove the entire `if (cfg.scope?.dateFieldId) {` branch (lines 444–462). Keep predicate filtering only.

- [ ] **Step 3: Remove "Use list instead" / "Single value" from INIT_VAR (B7)**

In `OperationsBuilder.jsx`, find lines 1014–1067 (the INIT_VAR case). The two states (`hasArrayOf` vs scalar) collapsed into the `array` mode of `ExprOrPath` (which we kept). Delete the entire `arrayOf` UI branch and the toggle buttons — INIT_VAR now just shows `$name = ExprOrPath(value)`.

If existing operations still carry `cfg.arrayOf`, keep `resolveExpr` parsing the `json:` literal that ExprOrPath uses; old ops still execute via the new path.

- [ ] **Step 4: Remove helper-text noise (B9)**

In `OperationsBuilder.jsx`, find line 450:
```jsx
<div style={{ fontSize: 9, color: "var(--text-muted)", lineHeight: 1.5, … }}>
  Pipelines don't see <code …>$trigger.*</code> directly — bind the trigger props you need into named <code …>$vars</code> here…
</div>
```
Delete this `<div>` and the equivalent line on header 445 (`— name pieces of the trigger / entities so steps can use them`). The Sources section's title alone is enough.

- [ ] **Step 5: Verify**

Open any operation in the editor — confirm:
- FIND no longer has "Date scope (optional):" row
- INIT_VAR no longer shows "Use list instead" / "Single value"
- Sources section no longer has the helper paragraph

- [ ] **Step 6: Commit**

```bash
git add client/src/blocks/OperationsBuilder.jsx client/src/helpers/operationActions.js
git commit -m "refactor(operations): drop dateScope, list-toggle, helper-text noise (B7, B8, B9)"
```

---

### Task 8: Save & exit button on operation editor

**Files:**
- Modify: `client/src/ui/commandCenter/OperationsTab.jsx`

`OperationEditor` currently writes via onChange + the drill-down has a back-arrow. Add an explicit "Save" button at the bottom of the editor that flushes any pending state and calls `setSelectedOpId(null)` to return to the list (B10).

- [ ] **Step 1: Locate the editor footer**

Read `OperationsTab.jsx` around the `OperationEditor` definition. Find where the back arrow is rendered.

- [ ] **Step 2: Add a Save button**

Add a sticky footer with a single "Save" button (accent-blue) that calls a callback prop `onSave` provided by `OperationsTab`. `OperationsTab` wires `onSave={() => setSelectedOpId(null)}`. Saving is already automatic on every change — Save just exits.

- [ ] **Step 3: Verify**

Open op → make changes → click Save → returns to list. Re-open → changes are persisted.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/commandCenter/OperationsTab.jsx
git commit -m "feat(operations): Save button exits to list view (B10)"
```

---

### Task 9: Fix pipeline step reorder crash

**Files:**
- Modify: `client/src/blocks/OperationsBuilder.jsx` (`DraggableStepWrapper`, lines 626–703)

The crash likely comes from `arrayMove` not handling the case where `fromIdx === toIdx` after the `if (fromIdx < toIdx) insertAt--` adjustment, or `setClosestEdge(null)` firing during render. Reproduce first.

- [ ] **Step 1: Reproduce the crash**

Open op editor, add 3 steps (Action → If → Loop). Drag the first to last. Note the stack trace.

- [ ] **Step 2: Fix**

Common culprit pattern in this code:
- `extractClosestEdge(self.data)` may return `null` after `onDragLeave` cleared state — guard it.
- `arrayMove` crashes when `insertAt` is out-of-bounds. Guard with `Math.max(0, Math.min(insertAt, steps.length - 1))`.
- The drop target's `setClosestEdge(null)` is fine, but make sure the drag source isn't also acting as drop target on itself (already guarded by `source?.data?.stepId !== step.id`).

Apply the bounds guard and an early-return when `extractClosestEdge` returns `null`:
```js
onDrop: ({ source, self }) => {
  setClosestEdge(null);
  const sourceId = source?.data?.stepId;
  if (!sourceId) return;
  const fromIdx = steps.findIndex(s => s.id === sourceId);
  const toIdx   = steps.findIndex(s => s.id === step.id);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
  const edge = extractClosestEdge(self.data);
  let insertAt = edge === "top" ? toIdx : toIdx + 1;
  if (fromIdx < toIdx) insertAt--;
  insertAt = Math.max(0, Math.min(insertAt, steps.length));
  onReorder(arrayMove(steps, fromIdx, insertAt));
},
```

- [ ] **Step 3: Verify reorder works in all 4 quadrants**

Drag step 1 → above step 3, step 3 → above step 1, step 2 → below step 3, etc. No crashes.

- [ ] **Step 4: Confirm children move with parent (B12)**

The step structure — `{ type: "loop", body: [...] }` and `{ type: "if", then: [...], else: [...] }` — already carries children inside the parent object. `arrayMove` reorders the array of step objects, so children naturally come along. **Confirm by**: add a Loop with 2 nested actions, drag the Loop above an action — verify both children stay nested under the Loop after reorder.

- [ ] **Step 5: Commit**

```bash
git add client/src/blocks/OperationsBuilder.jsx
git commit -m "fix(operations): guard pipeline reorder against OOB indices and null edges (B11, B12)"
```

---

### Task 10: Run-log array expandability

**Files:**
- Modify: `client/src/ui/commandCenter/OperationLogPanel.jsx`

Per CLAUDE.md the rewrite already routes arrays to `JsonNode`. The user is still seeing `[Array(80)]` strings — likely from a path that doesn't run through `inlineLiteral`. Audit and fix.

- [ ] **Step 1: Find every array stringification path**

Run: `grep -n "Array(" client/src/ui/commandCenter/OperationLogPanel.jsx`
Also `grep -n "JSON.stringify" client/src/ui/commandCenter/OperationLogPanel.jsx`.

- [ ] **Step 2: Audit `inlineLiteral` and `JsonNode`**

Read lines 72–145 of `OperationLogPanel.jsx`. Confirm `inlineLiteral(v)` for any `Array.isArray(v)` returns `<JsonNode>` (it already does at line 85). Look for any other `String(v)` or `${v}` template that could coerce an array.

Likely culprit: `entry.vars[k]` rendering inside a row label (line 581 area). Verify that `inlineLiteral` is wrapping every `vars[k]`. If the bug is in `varsBefore` snapshot — check `OperationLogPanel.jsx`'s `vars when this ran` block.

- [ ] **Step 3: Fix the leak**

Replace any direct `String(v)` / `${v}` on possibly-array values with `<JsonNode data={v} maps={maps} />`.

- [ ] **Step 4: Verify**

Run an op that produces `$allItems` (80 items) — log entry should show `Array(80)` with a chevron, click to expand.

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/commandCenter/OperationLogPanel.jsx
git commit -m "fix(operations): never stringify arrays in run log (B13)"
```

---

### Task 11: Drop residual `iteration*` from trigger object

**Files:**
- Modify: `client/src/helpers/operationExecutor.js`

Per CLAUDE.md (Apr 29) `$iterationId` etc. were dropped from `$vars`. The user reports `iteration` still showing inside the trigger snapshot. The remnants are at lines 884–904 (placement.iterationTimeValue / iterationCategoryValue snapshots), 1109 (iterationMode), 1126 / 1136 / 1143–1151 / 1181 / 1196 / 1228 / 1258.

- [ ] **Step 1: Audit each line**

For each match from `grep -n iteration client/src/helpers/operationExecutor.js`, decide: is this a runtime fallback that should stay (e.g. legacy `occ.iteration?.timeValue` reads for old data), or is it a snapshot key that pollutes the trigger object?

Conservative rule: keep reads (for back-compat with old occurrences), drop writes into the trigger snapshot.

- [ ] **Step 2: Strip iteration keys from `$trigger.occurrence`**

In `executePipeline` where `$vars.$trigger.occurrence = {...}` is built, remove any `iteration*` keys from the spread. Also remove `_iterationTimeValue` / `_iterationCategoryValue` from `$allItems` map output (line 903–904).

- [ ] **Step 3: Verify in run log**

Trigger any op, expand "trigger details" — no `iteration*` keys should appear.

- [ ] **Step 4: Commit**

```bash
git add client/src/helpers/operationExecutor.js
git commit -m "chore(operations): purge iteration keys from trigger snapshot (B14)"
```

---

### Task 12: Effective-filter helper for ancestor lookups

**Files:**
- Modify: `client/src/helpers/operationExecutor.js`
- Test: `client/src/__tests__/operationExecutor.test.js`

The Water-Today / Tasks-Completed-Today operations need to read the **Physical** container's effective filter — not the trigger occurrence's parent chain. Add a generic helper and a Source entity type that exposes it.

- [ ] **Step 1: Implement `effectiveFilterFor(occurrenceId, ctx)`**

In `operationExecutor.js`, add a top-level helper:
```js
export function effectiveFilterFor(occurrenceId, { occurrencesById, modulesById, gridFilters }) {
  const occ = occurrencesById[occurrenceId];
  if (!occ) return {};
  const merged = {};
  let cur = occ;
  let depth = 0;
  while (cur && depth++ < 20) {
    if (cur.filterOverride) Object.assign(merged, cur.filterOverride);
    cur = cur.parentId ? occurrencesById[cur.parentId] : null;
  }
  // Apply grid-level active filter as the floor
  if (gridFilters?.active) {
    for (const [k, v] of Object.entries(gridFilters.active)) {
      if (merged[k] === undefined) merged[k] = v;
    }
  }
  return merged;
}
```

- [ ] **Step 2: Add `effectiveFilter` source entity type**

In `OperationsBuilder.jsx` ENTITY_TYPES add:
```js
{ value: "effectiveFilter", label: "Effective filter (by label)", hint: "$var = effective filter walked from a named container/page" },
```

`SourceRow` for this type renders an `<input>` (or use `EntityPicker` from Task 6) where the user picks a target container/page by label. The source binding stores `{ entityType: "effectiveFilter", targetLabel: "Physical" }`.

- [ ] **Step 3: Resolve in `executePipeline`**

```js
} else if (entityType === "effectiveFilter") {
  const target = Object.values(occurrencesById).find(o =>
    modulesById[o.targetId]?.label === src.targetLabel
  );
  $vars[varKey] = target ? effectiveFilterFor(target.id, { occurrencesById, modulesById, gridFilters: state.grid?.namedFilters }) : {};
}
```

- [ ] **Step 4: Add a test**

```js
// in operationExecutor.test.js
import { effectiveFilterFor } from "../helpers/operationExecutor";

it("walks ancestor chain and merges filterOverrides", () => {
  const occurrencesById = {
    a: { id: "a", parentId: "b", filterOverride: { date: "2026-04-29" } },
    b: { id: "b", parentId: "c", filterOverride: { context: "work" } },
    c: { id: "c", filterOverride: { area: "physical" } },
  };
  expect(effectiveFilterFor("a", { occurrencesById, modulesById: {}, gridFilters: null })).toEqual({
    date: "2026-04-29",
    context: "work",
    area: "physical",
  });
});
```

- [ ] **Step 5: Migrate Water-Today / Tasks-Completed-Today**

Find the operations in `server/scripts/createTestGrid.js`. Change their Sources from `parentFilter` to:
```js
{ entityType: "effectiveFilter", targetLabel: "Physical", variableName: "physicalFilter" }
```
And update the FIND predicate / loop body to reference `$physicalFilter.date` instead of `$parentFilter.date`.

- [ ] **Step 6: Run tests**

Run: `cd client && npx vitest run src/__tests__/operationExecutor.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add client/src/helpers/operationExecutor.js client/src/blocks/OperationsBuilder.jsx server/scripts/createTestGrid.js client/src/__tests__/operationExecutor.test.js
git commit -m "feat(operations): effectiveFilterFor helper + source type for ancestor filter lookup (B15)"
```

---

### Task 13: Narrow onFilterChange to relevant ancestors only

**Files:**
- Modify: `client/src/state/bindSocketToStore.js` (the `onFilterChange` / `NavigationOp` firing path)
- Modify: `client/src/helpers/operationExecutor.js` (`matchesTrigger` for `onFilterChange`)

The Water-Today / Tasks-Completed-Today ops should only fire when an ancestor of their tracked occurrences (the ones with display fields) changes filter — not on every schedule-filter change.

- [ ] **Step 1: Read current `onFilterChange` matching**

In `operationExecutor.js`, search for `onFilterChange` / `onNavigation`. Read the `matchesTrigger` branch.

- [ ] **Step 2: Add ancestor scoping to trigger config**

Extend `triggerConfig` for `onFilterChange` to support:
```js
{ ancestorLabel: "Physical" }   // op fires only when a filter change affects an ancestor with this label
```

In `matchesTrigger`, when this config is present, walk the changed-filter source chain (the occurrence whose `filterOverride` actually changed) and confirm one of its descendants includes an occurrence whose ancestor chain matches `ancestorLabel`. If not, return false.

- [ ] **Step 3: Surface the scoping option in the OperationsTab UI**

In `OperationsTab.jsx`, the trigger row config for `onFilterChange` already takes a `subjectType`/`subjectRole`/`targetId`. Add an `ancestorLabel` text input under it.

- [ ] **Step 4: Migrate Water-Today / Tasks-Completed-Today**

Update the seed in `createTestGrid.js` to set `ancestorLabel: "Physical"` on those ops' onFilterChange triggers.

- [ ] **Step 5: Verify**

Switch the schedule filter — water/completed ops should NOT fire (check run log empty for them). Switch the Physical container's filter (or its ancestor) — they SHOULD fire.

- [ ] **Step 6: Commit**

```bash
git add client/src/helpers/operationExecutor.js client/src/state/bindSocketToStore.js client/src/ui/commandCenter/OperationsTab.jsx server/scripts/createTestGrid.js
git commit -m "feat(operations): scope onFilterChange triggers to specified ancestor (B16)"
```

---

### Task 14: QuickAddMenu — two-tier with category rows

**Files:**
- Modify: `client/src/ui/QuickAddMenu.jsx`

The plus button on panel/container headers currently shows a flat list filtered by `targetRole`. The user wants the level-1 menu to show category tiles (matching `PanelKindSelector` style), then drill into the list (B18).

- [ ] **Step 1: Categorize available modules**

Categories for `targetRole === "container"` (panel context):
- Containers (`role: "container", kind: "list"`)
- Documents (`role: "container", kind: "doc"`)
- Boards (`role: "container", kind: "board"`)
- Artifacts (`role: "container", kind: "artifact"`)

For `targetRole === "instance"` (container context):
- Instances (`role: "instance", kind: "list"`)
- Doc instances (`role: "instance", kind: "doc"`)
- Textblocks (`role: "textblock"`)
- Artifacts (`role: "artifact"`)

For `targetRole === "panel"` (grid context):
- Boards / Pages / Artifact viewers / Mixed

- [ ] **Step 2: Render level 1 with `PanelKindSelector`-style tiles**

Use the same row layout: icon block (colored bg), label, description, hover highlight. On click, push the level into a `levels` state and re-render the body as the filtered list (the existing flat list code).

- [ ] **Step 3: Add a back-button on level 2**

Small `← Categories` link at the top of level 2.

- [ ] **Step 4: Verify**

Click `+` on a panel header → category tiles → click "Documents" → see only doc-kind containers.

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/QuickAddMenu.jsx
git commit -m "feat(quick-add): two-tier category-first picker matching path picker style (B18)"
```

---

### Task 15: `due` field stamp resolves the value

**Files:**
- Modify: `client/src/helpers/operationActions.js` (CREATE case, around line 522)

When CREATE writes `cfg.fields = { dueFieldId: "$today" }` the executor resolves `"$today"` via `resolveExpr`. The user reports the field shows the literal string `"due: date"`. Audit: is the operation config storing `"date"` (raw label) instead of `$today` (variable)? Or is the renderer printing field name + value when value is missing?

- [ ] **Step 1: Reproduce**

Add a todo via the schedule-build operation. Inspect the resulting occurrence's `fields[dueFieldId]`. Is the value `"date"` (literal) or a real ISO date?

- [ ] **Step 2: Fix at the source of the bug**

Two likely fixes depending on Step 1:
- If `cfg.fields[dueFieldId] = "date"` literal → fix the seeded operation config in `createTestGrid.js` to use `"$schedDate"` or `"$today"`.
- If `resolveExpr("$today")` returns `null` in this context → fix the executor's `$today` injection (it should already be set by the Apr 29 changes — verify).

In `operationActions.js` CREATE case (line 522–527):
```js
if (cfg.fields) {
  for (const [fid, expr] of Object.entries(cfg.fields)) {
    const v = resolveExpr(expr, $vars);
    if (v != null) fields[fid] = { value: v, flow: "in" };
  }
}
```
This already calls `resolveExpr`. The bug is upstream (config or `$vars`). Fix wherever Step 1 pointed.

- [ ] **Step 3: Verify**

Drag a todo into the schedule → operation runs → todo's `due` field shows the real date in the UI, not the literal string.

- [ ] **Step 4: Commit**

```bash
git add client/src/helpers/operationActions.js server/scripts/createTestGrid.js
git commit -m "fix(operations): due field receives resolved date value not literal string (B20)"
```

---

### Task 16: Editor language + fillability audit

**Files:**
- Modify: `client/src/blocks/OperationsBuilder.jsx`
- Modify: `client/src/ui/commandCenter/OperationsTab.jsx`

Pass through every action's config UI with the seed data loaded. For each action, confirm: (a) every spot has either a value or a placeholder showing what to put, (b) the labels make sense to a non-developer.

- [ ] **Step 1: Boot the app with seed data**

```bash
cd server && node scripts/createTestGrid.js
cd .. && npm run dev
```

- [ ] **Step 2: For each operation, open in editor and audit**

Walk the seeded ops one by one. Note each instance of:
- An empty input with no placeholder
- A label that uses code-speak (e.g. `cfg.predicate.operator`, `dateFieldId`) where a plain-English version would be clearer
- A control that visually "looks empty" because the value didn't load

Common label rewrites:
- "Look for items where" → keep (already plain-English)
- "Save id as $myId (just the matched item's id)" → keep
- "Save full item as $myItem (whole record — fields, label, meta, etc.)" → keep
- ActionStep header `action` → "do"
- LoopStep header `loop` → "for each"
- IF header `if` → keep
- Source row header `📥 Sources` → "📥 Inputs (bind variables)"
- Variable action verbs (INIT_VAR / SET_VAR / ADD_TO_VAR) optgroup label "Variables" → "Set variables"
- System action verbs optgroup "System" → "Run / Find / Update"

- [ ] **Step 3: Add placeholders to every blank input**

Common placeholders already exist (`$item.label`, `$today`, etc.). Verify every `<input>` and `<ExprOrPath>` has a `placeholder` prop.

- [ ] **Step 4: Verify seed values render**

For each seeded op, confirm the editor shows the saved values (not blanks). If any step has a `cfg` shape the editor doesn't render, add the case in `ActionConfig`.

- [ ] **Step 5: Commit**

```bash
git add client/src/blocks/OperationsBuilder.jsx client/src/ui/commandCenter/OperationsTab.jsx
git commit -m "ux(operations): plain-English labels and placeholders across editor (B19)"
```

---

### Task 17: Update CLAUDE.md changelogs

**Files:**
- Modify: `client/src/blocks/CLAUDE.md`
- Modify: `client/src/ui/CLAUDE.md`
- Modify: `client/src/helpers/CLAUDE.md`

Add a "Recent Changes (2026-04-30 — Operations Editor Overhaul)" section to each file summarizing the changes. Keep entries short — name the file changed and the one-line reason, mirroring existing style.

- [ ] **Step 1: Write the entries**

Example for `client/src/blocks/CLAUDE.md`:
```md
## Recent Changes (2026-04-30 — Operations editor overhaul)
- **OperationsBuilder.jsx**: `ExprOrPath` and `SourceRow` now use `CategoryPathPicker` (Sources / Occurrences / Fields / Local Variables / Built-ins). Removed `dateScope` UI from FIND, "Use list instead" toggle from INIT_VAR, "Pipelines don't see `$trigger.*`" hint from Sources panel. Pipeline reorder bounded against OOB indices. Save button exits to operations list.
- **ConditionGroup.jsx**: Path inputs use `CategoryPathPicker` via shared `ExprOrPath` component.
```

- [ ] **Step 2: Commit**

```bash
git add client/src/blocks/CLAUDE.md client/src/ui/CLAUDE.md client/src/helpers/CLAUDE.md
git commit -m "docs: changelog for operations editor overhaul"
```

---

## Out of Scope (Note for Reviewer)

- Visual-block (`Block.jsx` / `BlockPalette.jsx`) editor — left as-is. The pipeline editor is the active UI; the visual block view is dormant.
- Server-side operation runtime — all changes are client-side. Server still receives the same effect shapes (`UPDATE_ITEM_FIELD`, `CREATE_OCCURRENCE_FOR_MODULE`, etc.).
- Full "save as draft" workflow — Save just exits; the editor remains live-saving on each change.

---

## Self-Review Notes

- All 20 bug IDs (B1–B20) have at least one task that addresses them.
- No "TODO", "TBD", or vague "implement later" placeholders.
- Function names are consistent: `CategoryPathPicker`, `effectiveFilterFor`, `resolveCategoryItems`.
- Each task ends with a commit.
- Tests precede implementation for new code (TDD).
