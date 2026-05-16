# Select Options Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `field.meta.options` array (and the old pool mechanism) with a discriminated `field.meta.optionsSource` union — manual / range / find — where the find mode reuses operations FIND machinery wholesale.

**Architecture:** One new helper (`optionsResolver.js`) resolves any `optionsSource` shape into a `{value, label}[]` array. `FieldRenderer.jsx` calls the resolver inside a memo (same deps as today's pool memo) and exposes the result under `field.meta._resolvedOptions`. A new field-settings UI in `commandCenter/SelectOptionsSourceEditor.jsx` writes the three modes. A one-shot client-side migration in `bindSocketToStore.js` rewrites legacy fields on `full_state` ingestion. No backward-compat shims.

**Tech Stack:** React 18, Vitest, existing `operationActions.js` exports (`evalGroupAgainstRecord`, `resolveRecordPath`, `resolveExpr`), existing `CategoryPathPicker` + `ConditionGroup` + `categoryRegistry.COLLECTION_PICKER_CONFIG`.

**Tests:** Vitest. Run from repo root: `npm --prefix ./client run test -- <pattern>`. Existing test files in `client/src/__tests__/`.

---

## File Structure

**Create:**
- `client/src/helpers/optionsResolver.js` — pure resolver: `(field, ctx) → { options, totalMatched }`
- `client/src/state/migrateFieldOptionsSource.js` — pure migration: `(field) → field` (no I/O)
- `client/src/ui/commandCenter/SelectOptionsSourceEditor.jsx` — the three-mode editor component
- `client/src/__tests__/optionsResolver.test.js`
- `client/src/__tests__/migrateFieldOptionsSource.test.js`

**Modify:**
- `client/src/ui/FieldRenderer.jsx:30-80` — swap pool memo for `resolveOptions`; keep Randomize button (re-purposed for any select with > 1 option)
- `client/src/ui/Field.jsx` — read `meta._resolvedOptions` instead of `meta.options`; add search input above 10 options in Popover branch
- `client/src/ui/FieldInput.jsx` — same `_resolvedOptions` shape if it reads `meta.options`
- `client/src/ui/commandCenter/FieldsTab.jsx:267-303` — replace chip editor with `<SelectOptionsSourceEditor />`
- `client/src/state/bindSocketToStore.js` — call `migrateFieldOptionsSource` per field in `full_state` ingestion, emit `update_field` for any rewritten field

---

## Task 1: Resolver — manual & range branches (TDD)

**Files:**
- Create: `client/src/helpers/optionsResolver.js`
- Test: `client/src/__tests__/optionsResolver.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// client/src/__tests__/optionsResolver.test.js
import { describe, it, expect } from "vitest";
import { resolveOptions } from "../helpers/optionsResolver";

const emptyCtx = { occurrencesById: {}, modulesById: {}, fieldsById: {}, foldersById: {} };

describe("resolveOptions — manual mode", () => {
  it("returns each value as {value, label} pair", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "manual", values: ["Apples", "Oranges"] } } };
    const { options, totalMatched } = resolveOptions(field, emptyCtx);
    expect(options).toEqual([
      { value: "Apples", label: "Apples" },
      { value: "Oranges", label: "Oranges" },
    ]);
    expect(totalMatched).toBe(2);
  });

  it("handles numeric values", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "manual", values: [1, 2, 3] } } };
    expect(resolveOptions(field, emptyCtx).options).toEqual([
      { value: 1, label: "1" },
      { value: 2, label: "2" },
      { value: 3, label: "3" },
    ]);
  });

  it("returns empty when values missing", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "manual" } } };
    expect(resolveOptions(field, emptyCtx).options).toEqual([]);
  });
});

describe("resolveOptions — range mode", () => {
  it("expands [start, end] with step", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "range", range: { start: 1, end: 5, step: 1 } } } };
    expect(resolveOptions(field, emptyCtx).options).toEqual([
      { value: 1, label: "1" }, { value: 2, label: "2" }, { value: 3, label: "3" },
      { value: 4, label: "4" }, { value: 5, label: "5" },
    ]);
  });

  it("handles step > 1", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "range", range: { start: 0, end: 20, step: 5 } } } };
    expect(resolveOptions(field, emptyCtx).options.map(o => o.value)).toEqual([0, 5, 10, 15, 20]);
  });

  it("returns empty for invalid step", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "range", range: { start: 0, end: 5, step: 0 } } } };
    expect(resolveOptions(field, emptyCtx).options).toEqual([]);
  });

  it("returns empty when end < start", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "range", range: { start: 5, end: 1, step: 1 } } } };
    expect(resolveOptions(field, emptyCtx).options).toEqual([]);
  });
});

describe("resolveOptions — guards", () => {
  it("returns empty for non-select fields", () => {
    expect(resolveOptions({ type: "number", meta: {} }, emptyCtx).options).toEqual([]);
  });

  it("returns empty for missing optionsSource", () => {
    expect(resolveOptions({ type: "select", meta: {} }, emptyCtx).options).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix ./client run test -- optionsResolver`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// client/src/helpers/optionsResolver.js
export function resolveOptions(field, ctx) {
  if (field?.type !== "select") return { options: [], totalMatched: 0 };
  const src = field.meta?.optionsSource;
  if (!src?.mode) return { options: [], totalMatched: 0 };

  if (src.mode === "manual") {
    const values = Array.isArray(src.values) ? src.values : [];
    const options = values.map(v => ({ value: v, label: String(v) }));
    return { options, totalMatched: options.length };
  }

  if (src.mode === "range") {
    const { start, end, step } = src.range || {};
    if (typeof start !== "number" || typeof end !== "number" || typeof step !== "number") return { options: [], totalMatched: 0 };
    if (step <= 0 || end < start) return { options: [], totalMatched: 0 };
    const options = [];
    for (let v = start; v <= end; v += step) options.push({ value: v, label: String(v) });
    return { options, totalMatched: options.length };
  }

  if (src.mode === "find") {
    // Implemented in Task 2
    return { options: [], totalMatched: 0 };
  }

  return { options: [], totalMatched: 0 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix ./client run test -- optionsResolver`
Expected: PASS (all manual + range + guard cases).

- [ ] **Step 5: Commit**

```bash
git add client/src/helpers/optionsResolver.js client/src/__tests__/optionsResolver.test.js
git commit -m "feat: optionsResolver manual + range branches"
```

---

## Task 2: Resolver — find branch (TDD)

**Files:**
- Modify: `client/src/helpers/optionsResolver.js`
- Test: `client/src/__tests__/optionsResolver.test.js` (extend)

The find branch needs to (1) build the named collection from `ctx`, (2) filter via `evalGroupAgainstRecord` (imported from `operationActions.js`), (3) extract `valuePath` and optional `labelPath` via `resolveRecordPath`, (4) dedupe + sort + limit.

- [ ] **Step 1: Add failing find-mode tests**

Append to `client/src/__tests__/optionsResolver.test.js`:

```js
describe("resolveOptions — find mode", () => {
  const ctx = {
    occurrencesById: {
      occ1: { id: "occ1", moduleId: "modA", role: "instance", fields: { f1: { value: "movies" } } },
      occ2: { id: "occ2", moduleId: "modB", role: "instance", fields: { f1: { value: "movies" } } },
      occ3: { id: "occ3", moduleId: "modC", role: "instance", fields: { f1: { value: "books" } } },
      occ4: { id: "occ4", moduleId: "modD", role: "container", fields: {} },
    },
    modulesById: {
      modA: { id: "modA", label: "Inception", role: "instance" },
      modB: { id: "modB", label: "Arrival", role: "instance" },
      modC: { id: "modC", label: "Dune", role: "instance" },
      modD: { id: "modD", label: "Movies", role: "container" },
    },
    fieldsById: { f1: { id: "f1", name: "medium" } },
    foldersById: {},
  };

  it("filters $allInstances by predicate, extracts label", () => {
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: {
        over: "$allInstances",
        predicate: { rules: [{ left: "fields.f1.value", comparator: "IS", right: "movies" }] },
        valuePath: "label",
      },
    } } };
    const { options, totalMatched } = resolveOptions(field, ctx);
    expect(options.map(o => o.value).sort()).toEqual(["Arrival", "Inception"]);
    expect(totalMatched).toBe(2);
  });

  it("uses labelPath when set; value stays as valuePath", () => {
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: {
        over: "$allInstances",
        predicate: { rules: [{ left: "fields.f1.value", comparator: "IS", right: "movies" }] },
        valuePath: "id",
        labelPath: "label",
      },
    } } };
    const { options } = resolveOptions(field, ctx);
    const byId = Object.fromEntries(options.map(o => [o.value, o.label]));
    expect(byId).toEqual({ occ1: "Inception", occ2: "Arrival" });
  });

  it("dedupes by value (last label wins)", () => {
    const ctx2 = {
      ...ctx,
      occurrencesById: {
        a: { id: "a", moduleId: "x", role: "instance", fields: {} },
        b: { id: "b", moduleId: "y", role: "instance", fields: {} },
      },
      modulesById: { x: { id: "x", label: "Same" }, y: { id: "y", label: "Same" } },
    };
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: { over: "$allInstances", predicate: { rules: [] }, valuePath: "label" },
    } } };
    const { options, totalMatched } = resolveOptions(field, ctx2);
    expect(options).toHaveLength(1);
    expect(totalMatched).toBe(2);
  });

  it("sorts asc by sortPath when set", () => {
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: {
        over: "$allInstances",
        predicate: { rules: [] },
        valuePath: "label",
        sortPath: "label",
        sortDir: "asc",
      },
    } } };
    expect(resolveOptions(field, ctx).options.map(o => o.value)).toEqual(["Arrival", "Dune", "Inception"]);
  });

  it("sorts desc when sortDir=desc", () => {
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: { over: "$allInstances", predicate: { rules: [] }, valuePath: "label", sortPath: "label", sortDir: "desc" },
    } } };
    expect(resolveOptions(field, ctx).options.map(o => o.value)).toEqual(["Inception", "Dune", "Arrival"]);
  });

  it("applies limit and reports totalMatched separately", () => {
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: { over: "$allInstances", predicate: { rules: [] }, valuePath: "label", sortPath: "label", sortDir: "asc", limit: 2 },
    } } };
    const { options, totalMatched } = resolveOptions(field, ctx);
    expect(options.map(o => o.value)).toEqual(["Arrival", "Dune"]);
    expect(totalMatched).toBe(3);
  });

  it("uses $allContainers when over points there", () => {
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: { over: "$allContainers", predicate: { rules: [] }, valuePath: "label" },
    } } };
    expect(resolveOptions(field, ctx).options).toEqual([{ value: "Movies", label: "Movies" }]);
  });

  it("returns empty when predicate matches nothing", () => {
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: { over: "$allInstances", predicate: { rules: [{ left: "label", comparator: "IS", right: "Nope" }] }, valuePath: "label" },
    } } };
    expect(resolveOptions(field, ctx).options).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix ./client run test -- optionsResolver`
Expected: FAIL — find branch returns empty.

- [ ] **Step 3: Implement the find branch**

Replace the `if (src.mode === "find")` block in `client/src/helpers/optionsResolver.js`:

```js
import { evalGroupAgainstRecord, resolveRecordPath } from "./operationActions";

const COLLECTION_KEYS = {
  $allOccurrences: "all",
  $allItems: "all",
  $allContainers: "container",
  $allPages: "page",
  $allPanels: "panel",
  $allInstances: "instance",
  $allTemplates: "templates",
  $allFields: "fields",
};

function buildCollection(over, ctx) {
  const { occurrencesById = {}, modulesById = {}, fieldsById = {} } = ctx;
  const filter = COLLECTION_KEYS[over];
  if (filter === undefined) return [];
  if (filter === "templates") return Object.values(modulesById);
  if (filter === "fields") return Object.values(fieldsById);

  // Build occurrence + template-merged records — same shape executePipeline produces.
  const records = Object.values(occurrencesById).map(occ => {
    const tpl = occ.moduleId ? modulesById[occ.moduleId] : null;
    return {
      ...occ,
      label: occ.label ?? tpl?.label ?? tpl?.name ?? null,
      name: occ.name ?? tpl?.name ?? tpl?.label ?? null,
      role: occ.role ?? tpl?.role ?? null,
      kind: occ.kind ?? tpl?.kind ?? null,
      meta: { ...(tpl?.meta || {}), ...(occ.meta || {}) },
      templateId: occ.moduleId ?? null,
    };
  });
  if (filter === "all") return records;
  return records.filter(r => r.role === filter);
}
```

Then replace the `find` branch body with:

```js
if (src.mode === "find") {
  const cfg = src.find || {};
  const over = cfg.over || "$allOccurrences";
  const records = buildCollection(over, ctx);
  const predicate = cfg.predicate || { rules: [] };
  const matched = records.filter(r => {
    if (!predicate.rules?.length) return true;
    return evalGroupAgainstRecord(predicate, r, {});
  });

  const valuePath = cfg.valuePath || "id";
  const labelPath = cfg.labelPath || valuePath;
  const pairs = matched.map(r => {
    const value = resolveRecordPath(r, valuePath);
    const label = labelPath === valuePath ? value : resolveRecordPath(r, labelPath);
    return { value, label: label == null ? "" : String(label) };
  }).filter(p => p.value !== undefined && p.value !== null);

  const totalMatched = pairs.length;

  // Dedupe by value (last-write wins on label).
  const seen = new Map();
  for (const p of pairs) seen.set(p.value, p);
  let deduped = Array.from(seen.values());

  // Sort.
  if (cfg.sortPath) {
    const dir = cfg.sortDir === "desc" ? -1 : 1;
    const cache = new Map(deduped.map((p, i) => [p, resolveRecordPath(matched[i], cfg.sortPath)]));
    deduped.sort((a, b) => {
      const av = cache.get(a), bv = cache.get(b);
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av < bv ? -dir : dir;
    });
  }

  // Limit.
  const limit = typeof cfg.limit === "number" && cfg.limit > 0 ? cfg.limit : 100;
  const options = deduped.slice(0, limit);

  return { options, totalMatched };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix ./client run test -- optionsResolver`
Expected: PASS — all find-mode cases.

- [ ] **Step 5: Commit**

```bash
git add client/src/helpers/optionsResolver.js client/src/__tests__/optionsResolver.test.js
git commit -m "feat: optionsResolver find branch (predicate + paths + sort/limit)"
```

---

## Task 3: Migration helper (TDD)

**Files:**
- Create: `client/src/state/migrateFieldOptionsSource.js`
- Test: `client/src/__tests__/migrateFieldOptionsSource.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// client/src/__tests__/migrateFieldOptionsSource.test.js
import { describe, it, expect } from "vitest";
import { migrateFieldOptionsSource, needsMigration } from "../state/migrateFieldOptionsSource";

describe("migrateFieldOptionsSource", () => {
  it("rewrites meta.options into manual mode", () => {
    const field = { id: "f1", type: "select", meta: { options: ["Apples", "Oranges"], prefix: "$" } };
    const out = migrateFieldOptionsSource(field);
    expect(out.meta.optionsSource).toEqual({ mode: "manual", values: ["Apples", "Oranges"] });
    expect(out.meta.options).toBeUndefined();
    expect(out.meta.prefix).toBe("$"); // unrelated keys preserved
  });

  it("rewrites pool fields into find mode with HAS_ANCESTOR_ANY", () => {
    const field = { id: "f1", type: "select", meta: { sourceType: "pool", poolContainerIds: ["c1", "c2"] } };
    const out = migrateFieldOptionsSource(field);
    expect(out.meta.optionsSource).toEqual({
      mode: "find",
      over: "$allInstances",
      predicate: { rules: [{ left: "_ancestors", comparator: "HAS_ANCESTOR_ANY", right: ["c1", "c2"] }] },
      valuePath: "id",
      labelPath: "label",
    });
    expect(out.meta.sourceType).toBeUndefined();
    expect(out.meta.poolContainerIds).toBeUndefined();
  });

  it("treats legacy single poolContainerId as a one-entry list", () => {
    const field = { id: "f1", type: "select", meta: { sourceType: "pool", poolContainerId: "c1" } };
    const out = migrateFieldOptionsSource(field);
    expect(out.meta.optionsSource.predicate.rules[0].right).toEqual(["c1"]);
    expect(out.meta.poolContainerId).toBeUndefined();
  });

  it("produces manual{values:[]} when no options and no pool", () => {
    const field = { id: "f1", type: "select", meta: {} };
    const out = migrateFieldOptionsSource(field);
    expect(out.meta.optionsSource).toEqual({ mode: "manual", values: [] });
  });

  it("is a no-op for non-select fields", () => {
    const field = { id: "f1", type: "number", meta: { options: ["x"] } };
    expect(migrateFieldOptionsSource(field)).toBe(field);
  });

  it("is idempotent — already-migrated fields pass through unchanged", () => {
    const field = { id: "f1", type: "select", meta: { optionsSource: { mode: "manual", values: ["a"] } } };
    expect(migrateFieldOptionsSource(field)).toBe(field);
  });
});

describe("needsMigration", () => {
  it("returns true for legacy meta.options", () => {
    expect(needsMigration({ type: "select", meta: { options: ["x"] } })).toBe(true);
  });
  it("returns true for legacy pool fields", () => {
    expect(needsMigration({ type: "select", meta: { sourceType: "pool", poolContainerIds: ["c"] } })).toBe(true);
  });
  it("returns true for select fields with no optionsSource", () => {
    expect(needsMigration({ type: "select", meta: {} })).toBe(true);
  });
  it("returns false when optionsSource present", () => {
    expect(needsMigration({ type: "select", meta: { optionsSource: { mode: "manual", values: [] } } })).toBe(false);
  });
  it("returns false for non-select fields", () => {
    expect(needsMigration({ type: "number", meta: {} })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix ./client run test -- migrateFieldOptionsSource`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the migration**

```js
// client/src/state/migrateFieldOptionsSource.js
export function needsMigration(field) {
  if (field?.type !== "select") return false;
  if (field.meta?.optionsSource) return false;
  return true;
}

export function migrateFieldOptionsSource(field) {
  if (!needsMigration(field)) return field;

  const next = { ...field, meta: { ...field.meta } };

  const poolIds = Array.isArray(field.meta?.poolContainerIds)
    ? field.meta.poolContainerIds
    : field.meta?.poolContainerId ? [field.meta.poolContainerId] : null;

  if (field.meta?.sourceType === "pool" && poolIds?.length) {
    next.meta.optionsSource = {
      mode: "find",
      over: "$allInstances",
      predicate: { rules: [{ left: "_ancestors", comparator: "HAS_ANCESTOR_ANY", right: poolIds }] },
      valuePath: "id",
      labelPath: "label",
    };
  } else {
    next.meta.optionsSource = {
      mode: "manual",
      values: Array.isArray(field.meta?.options) ? field.meta.options : [],
    };
  }

  delete next.meta.options;
  delete next.meta.sourceType;
  delete next.meta.poolContainerId;
  delete next.meta.poolContainerIds;

  return next;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix ./client run test -- migrateFieldOptionsSource`
Expected: PASS.

- [ ] **Step 5: Verify `HAS_ANCESTOR_ANY` comparator exists**

```bash
grep -n "HAS_ANCESTOR_ANY\|HAS_ANCESTOR\b" client/src/helpers/operationActions.js | head -5
```

If `HAS_ANCESTOR_ANY` is not implemented, fall back to `HAS_ANCESTOR` (single id) — change the migration's `right: poolIds` to `right: poolIds[0]` and `comparator: "HAS_ANCESTOR"`, and update the test. If `HAS_ANCESTOR_ANY` exists, leave as-is. Re-run the test.

- [ ] **Step 6: Commit**

```bash
git add client/src/state/migrateFieldOptionsSource.js client/src/__tests__/migrateFieldOptionsSource.test.js
git commit -m "feat: migrateFieldOptionsSource for legacy options + pool fields"
```

---

## Task 4: Wire migration into `bindSocketToStore.js`

**Files:**
- Modify: `client/src/state/bindSocketToStore.js`

- [ ] **Step 1: Find the `full_state` ingestion site**

```bash
grep -n "full_state\|onFullState\|state.fields\b" client/src/state/bindSocketToStore.js | head -10
```

Locate where the fields array enters the store (likely an `onFullState` handler that dispatches `set_fields` or similar).

- [ ] **Step 2: Wire the migration**

At the top of `bindSocketToStore.js`, add:

```js
import { migrateFieldOptionsSource, needsMigration } from "./migrateFieldOptionsSource";
```

In the `full_state` handler, immediately before dispatching fields into the store, map each field through `migrateFieldOptionsSource` and emit `update_field` for any that changed:

```js
const migratedFields = (payload.fields || []).map(f => {
  if (!needsMigration(f)) return f;
  const migrated = migrateFieldOptionsSource(f);
  // Persist the rewrite so the next load short-circuits.
  safeEmit(socket, "update_field", { field: migrated });
  return migrated;
});
// ... existing dispatch using migratedFields instead of payload.fields
```

(If `safeEmit` is not already imported in that file, import it from `../helpers/offlineQueue`.)

- [ ] **Step 3: Smoke test**

```bash
npm --prefix ./client run test
```

Expected: All existing tests still PASS (none should be affected by the new migration call — it's a no-op for already-migrated fields, and the existing test grid uses pristine data).

- [ ] **Step 4: Commit**

```bash
git add client/src/state/bindSocketToStore.js
git commit -m "feat: run migrateFieldOptionsSource on full_state ingestion"
```

---

## Task 5: Wire resolver into `FieldRenderer.jsx`

**Files:**
- Modify: `client/src/ui/FieldRenderer.jsx:30-80` (replace pool memo)

- [ ] **Step 1: Read the current pool memo**

```bash
sed -n '28,82p' client/src/ui/FieldRenderer.jsx
```

Confirm the existing `effectiveField` memo + `handleQuickAddPool` helper that resolves pool options.

- [ ] **Step 2: Replace the pool memo with `resolveOptions`**

Replace the pool memo (the `useMemo` block that branches on `field.meta?.sourceType === "pool"`) with:

```js
import { resolveOptions } from "../helpers/optionsResolver";

// ...

const { options: resolvedOptions, totalMatched } = useMemo(() => {
  if (field?.type !== "select") return { options: [], totalMatched: 0 };
  return resolveOptions(field, { occurrencesById, modulesById, fieldsById, foldersById });
}, [field, occurrencesById, modulesById, fieldsById, foldersById]);

const effectiveField = useMemo(() => {
  if (field?.type !== "select") return field;
  return { ...field, meta: { ...field.meta, _resolvedOptions: resolvedOptions, _totalMatched: totalMatched } };
}, [field, resolvedOptions, totalMatched]);
```

Delete `handleQuickAddPool` and its onAdd wiring. The Randomize button (currently gated on `isPoolSourced`) gets re-purposed:

```js
// was:  const isPoolSourced = field?.meta?.sourceType === "pool";
const canRandomize = field?.type === "select" && resolvedOptions.length > 1;

// in the JSX inline-flex wrapper:
{canRandomize && inputEnabled && (
  <button onClick={handleRandomize} title="Pick a random option" ...>🎲</button>
)}
```

`handleRandomize` picks from `resolvedOptions` instead of the old `_moduleOptions`:

```js
function handleRandomize() {
  if (!resolvedOptions.length) return;
  const pick = resolvedOptions[Math.floor(Math.random() * resolvedOptions.length)];
  onChange?.(pick.value);
}
```

- [ ] **Step 3: Run the full client test suite**

```bash
npm --prefix ./client run test
```

Expected: All existing tests PASS. (The resolver tests already cover the data path; FieldRenderer has no dedicated unit test, so smoke-via-suite is fine.)

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/FieldRenderer.jsx
git commit -m "refactor: FieldRenderer uses resolveOptions; Randomize works for any multi-option select"
```

---

## Task 6: Update `Field.jsx` / `FieldInput.jsx` to consume `{value, label}` shape

**Files:**
- Modify: `client/src/ui/Field.jsx`
- Modify: `client/src/ui/FieldInput.jsx` (if it independently reads `meta.options`)

- [ ] **Step 1: Find every `meta.options` read**

```bash
grep -n "meta\.options\|meta?\.options" client/src/ui/Field.jsx client/src/ui/FieldInput.jsx
```

- [ ] **Step 2: Swap each read for `meta._resolvedOptions`**

Each call site changes from iterating `(meta.options || []).map(s => ...)` (bare strings) to iterating `(meta._resolvedOptions || []).map(({value, label}) => ...)`.

Examples (adjust exact line numbers to match local file state):

```jsx
// In Field.jsx, native <select>:
<select value={value} onChange={...}>
  {(field.meta._resolvedOptions || []).map(opt => (
    <option key={String(opt.value)} value={opt.value}>{opt.label}</option>
  ))}
</select>

// In Field.jsx Popover branch (option list):
{(field.meta._resolvedOptions || []).map(opt => (
  <button key={String(opt.value)} onClick={() => onChange(opt.value)}>{opt.label}</button>
))}
```

For displaying the SELECTED value (which is now `opt.value` — could be an id, could be a string), resolve via the same `_resolvedOptions` lookup table:

```jsx
const selectedLabel = useMemo(() => {
  const found = (field.meta._resolvedOptions || []).find(o => o.value === value);
  return found?.label ?? (value == null ? "" : String(value));
}, [field.meta._resolvedOptions, value]);
```

This drop-in replaces any place that previously rendered the raw value string.

- [ ] **Step 3: Smoke test**

```bash
npm --prefix ./client run test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/Field.jsx client/src/ui/FieldInput.jsx
git commit -m "refactor: Field reads _resolvedOptions {value,label} shape"
```

---

## Task 7: Build `SelectOptionsSourceEditor` — manual mode only

**Files:**
- Create: `client/src/ui/commandCenter/SelectOptionsSourceEditor.jsx`

This task lands the component shell + the three-mode toggle + the manual body. Range and find bodies come in later tasks.

- [ ] **Step 1: Create the component**

```jsx
// client/src/ui/commandCenter/SelectOptionsSourceEditor.jsx
import React, { useState } from "react";

const MODES = [
  { key: "manual", label: "Manual" },
  { key: "range",  label: "Range" },
  { key: "find",   label: "Find" },
];

const pillStyle = (active) => ({
  padding: "3px 10px",
  borderRadius: 999,
  fontSize: 11,
  fontFamily: "monospace",
  background: active ? "var(--accent-blue-bg)" : "var(--input-bg)",
  border: `1px solid ${active ? "var(--accent-blue-border)" : "var(--input-border)"}`,
  color: active ? "var(--accent-blue-text)" : "var(--text-muted)",
  cursor: "pointer",
});

export default function SelectOptionsSourceEditor({ source, onChange }) {
  const mode = source?.mode || "manual";

  function setMode(next) {
    if (next === mode) return;
    if (next === "manual") onChange({ mode: "manual", values: [] });
    else if (next === "range") onChange({ mode: "range", range: { start: 0, end: 10, step: 1 } });
    else if (next === "find") onChange({ mode: "find", find: { over: "$allInstances", predicate: { rules: [] }, valuePath: "label" } });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {MODES.map(m => (
          <button key={m.key} type="button" onClick={() => setMode(m.key)} style={pillStyle(mode === m.key)}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === "manual" && <ManualBody source={source} onChange={onChange} />}
      {mode === "range"  && <RangeBody  source={source} onChange={onChange} />}
      {mode === "find"   && <FindBody   source={source} onChange={onChange} />}
    </div>
  );
}

function ManualBody({ source, onChange }) {
  const values = Array.isArray(source?.values) ? source.values : [];
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v) return;
    onChange({ ...source, mode: "manual", values: [...values, v] });
    setDraft("");
  }
  function remove(i) {
    onChange({ ...source, mode: "manual", values: values.filter((_, j) => j !== i) });
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
        {values.map((v, i) => (
          <span key={i} style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            padding: "1px 7px", borderRadius: 999, fontSize: 10, fontFamily: "monospace",
            background: "var(--border-subtle)", border: "1px solid var(--border-default)",
            color: "var(--text-muted)",
          }}>
            {String(v)}
            <button onClick={() => remove(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,100,100,0.6)", padding: 0, lineHeight: 1 }}>✕</button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="Add option (Enter)"
          style={{
            flex: 1, height: 28, fontSize: 11, fontFamily: "monospace",
            background: "var(--input-bg)", border: "1px solid var(--input-border)",
            borderRadius: 5, color: "var(--text-primary)", padding: "0 8px", outline: "none",
          }}
        />
        <button onClick={add} style={{
          padding: "0 10px", borderRadius: 4, fontSize: 10, fontFamily: "monospace",
          background: "var(--input-bg)", border: "1px solid var(--input-border)",
          color: "var(--text-muted)", cursor: "pointer",
        }}>Add</button>
      </div>
    </div>
  );
}

function RangeBody() { return <div style={{ fontSize: 10, color: "var(--text-faint)" }}>Range mode — coming in Task 9</div>; }
function FindBody()  { return <div style={{ fontSize: 10, color: "var(--text-faint)" }}>Find mode — coming in Task 10</div>; }
```

- [ ] **Step 2: Visual smoke (no test yet — component test added in Task 10)**

The component is reachable only once Task 8 wires it into `FieldsTab.jsx`. Confirm it compiles:

```bash
npm --prefix ./client run test
```

Expected: All tests PASS (no new ones).

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/commandCenter/SelectOptionsSourceEditor.jsx
git commit -m "feat: SelectOptionsSourceEditor shell + manual mode"
```

---

## Task 8: Wire `SelectOptionsSourceEditor` into `FieldsTab.jsx`

**Files:**
- Modify: `client/src/ui/commandCenter/FieldsTab.jsx:267-303`

- [ ] **Step 1: Replace the chip editor block**

In `FieldsTab.jsx`, replace lines 267-303 (the `{local.type === "select" && (...)}` chip editor) with:

```jsx
{local.type === "select" && (
  <div>
    <span style={labelStyle}>Options source</span>
    <SelectOptionsSourceEditor
      source={local.meta?.optionsSource || { mode: "manual", values: [] }}
      onChange={(next) => setLocal(p => ({ ...p, meta: { ...(p.meta || {}), optionsSource: next } }))}
    />
  </div>
)}
```

Add the import at the top of `FieldsTab.jsx`:

```js
import SelectOptionsSourceEditor from "./SelectOptionsSourceEditor";
```

- [ ] **Step 2: Hand-verify in the running app**

```bash
npm run dev
```

Open Command Center → Fields → click any select field → confirm the three-mode toggle renders with Manual selected. Add a value via Enter; confirm it persists after Save. Switch to Range — confirm placeholder shows. Switch to Find — confirm placeholder shows.

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/commandCenter/FieldsTab.jsx
git commit -m "feat: wire SelectOptionsSourceEditor into FieldsTab"
```

---

## Task 9: Add range mode to `SelectOptionsSourceEditor`

**Files:**
- Modify: `client/src/ui/commandCenter/SelectOptionsSourceEditor.jsx`

- [ ] **Step 1: Replace the `RangeBody` placeholder**

```jsx
function RangeBody({ source, onChange }) {
  const range = source?.range || { start: 0, end: 10, step: 1 };

  function set(key, value) {
    const num = value === "" ? 0 : Number(value);
    onChange({ ...source, mode: "range", range: { ...range, [key]: num } });
  }

  // Preview — first 10 values, ellipsis if more.
  const preview = [];
  if (range.step > 0 && range.end >= range.start) {
    for (let v = range.start; v <= range.end && preview.length < 11; v += range.step) preview.push(v);
  }
  const overflow = preview.length > 10;
  const shown = overflow ? preview.slice(0, 10) : preview;

  const inputStyle = {
    width: 60, height: 28, fontSize: 11, fontFamily: "monospace",
    background: "var(--input-bg)", border: "1px solid var(--input-border)",
    borderRadius: 5, color: "var(--text-primary)", padding: "0 8px", outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", display: "inline-flex", flexDirection: "column", gap: 2 }}>
          Start <input type="number" value={range.start} onChange={(e) => set("start", e.target.value)} style={inputStyle} />
        </label>
        <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", display: "inline-flex", flexDirection: "column", gap: 2 }}>
          End <input type="number" value={range.end} onChange={(e) => set("end", e.target.value)} style={inputStyle} />
        </label>
        <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", display: "inline-flex", flexDirection: "column", gap: 2 }}>
          Step <input type="number" value={range.step} onChange={(e) => set("step", e.target.value)} style={inputStyle} />
        </label>
      </div>
      <div style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "monospace" }}>
        Preview: {shown.join(", ")}{overflow ? ", …" : ""}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Hand-verify**

Open Command Center → select a field → Range mode → tweak start/end/step → preview line updates live → Save → reload → values persist.

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/commandCenter/SelectOptionsSourceEditor.jsx
git commit -m "feat: SelectOptionsSourceEditor range mode body"
```

---

## Task 10: Add find mode to `SelectOptionsSourceEditor`

**Files:**
- Modify: `client/src/ui/commandCenter/SelectOptionsSourceEditor.jsx`

This is the biggest task — wires up the collection picker, predicate editor (`ConditionGroup`), value/label/sort path pickers, and limit input. Live preview is its own task (Task 11).

- [ ] **Step 1: Verify the primitives exist**

```bash
grep -n "COLLECTION_PICKER_CONFIG\|buildRecordKeyPickerConfig\|recordShape" client/src/ui/categoryRegistry.js | head -10
grep -n "^export\|^function ConditionGroup\b" client/src/blocks/ConditionGroup.jsx | head -5
```

Confirm `COLLECTION_PICKER_CONFIG`, `buildRecordKeyPickerConfig`, and `ConditionGroup` are exported and ready to import. If any export name differs, update the imports in Step 2 accordingly.

- [ ] **Step 2: Replace the `FindBody` placeholder**

Add imports at the top of `SelectOptionsSourceEditor.jsx`:

```js
import CategoryPathPicker from "../CategoryPathPicker";
import { COLLECTION_PICKER_CONFIG, buildRecordKeyPickerConfig } from "../categoryRegistry";
import ConditionGroup from "../../blocks/ConditionGroup";
```

Replace `FindBody`:

```jsx
function FindBody({ source, onChange }) {
  const find = source?.find || { over: "$allInstances", predicate: { rules: [] }, valuePath: "label" };

  function patch(p) {
    onChange({ ...source, mode: "find", find: { ...find, ...p } });
  }

  const recordPickerConfig = buildRecordKeyPickerConfig(find.over);
  const sectionLabel = { fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", marginBottom: 3 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <div style={sectionLabel}>Search in</div>
        <CategoryPathPicker
          value={find.over}
          config={COLLECTION_PICKER_CONFIG}
          onChange={(over) => patch({ over })}
        />
      </div>

      <div>
        <div style={sectionLabel}>Where</div>
        <ConditionGroup
          group={find.predicate || { rules: [] }}
          onChange={(predicate) => patch({ predicate })}
          recordPickerConfig={recordPickerConfig}
        />
      </div>

      <div>
        <div style={sectionLabel}>Grab value</div>
        <CategoryPathPicker
          value={find.valuePath}
          config={recordPickerConfig}
          onChange={(valuePath) => patch({ valuePath })}
        />
      </div>

      <div>
        <div style={sectionLabel}>Grab label (optional — same as value when empty)</div>
        <CategoryPathPicker
          value={find.labelPath || ""}
          config={recordPickerConfig}
          onChange={(labelPath) => patch({ labelPath: labelPath || undefined })}
        />
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <div style={sectionLabel}>Sort by (optional)</div>
          <CategoryPathPicker
            value={find.sortPath || ""}
            config={recordPickerConfig}
            onChange={(sortPath) => patch({ sortPath: sortPath || undefined })}
          />
        </div>
        <div>
          <div style={sectionLabel}>Dir</div>
          <select
            value={find.sortDir || "asc"}
            onChange={(e) => patch({ sortDir: e.target.value })}
            style={{ height: 28, fontSize: 11, fontFamily: "monospace", background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: 5, color: "var(--text-primary)", padding: "0 8px", outline: "none" }}
          >
            <option value="asc">↑ asc</option>
            <option value="desc">↓ desc</option>
          </select>
        </div>
        <div>
          <div style={sectionLabel}>Limit</div>
          <input
            type="number"
            value={find.limit ?? 100}
            onChange={(e) => patch({ limit: Math.max(1, Number(e.target.value) || 100) })}
            style={{ width: 70, height: 28, fontSize: 11, fontFamily: "monospace", background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: 5, color: "var(--text-primary)", padding: "0 8px", outline: "none" }}
          />
        </div>
      </div>
    </div>
  );
}
```

If `ConditionGroup`'s prop names differ in this repo (e.g. it uses `value` / `onChange` instead of `group` / `onChange`, or doesn't accept `recordPickerConfig`), adjust the call to match the existing signature. Cross-check by reading the `ConditionGroup` usage in `client/src/blocks/OperationsBuilder.jsx`.

- [ ] **Step 3: Hand-verify**

```bash
npm run dev
```

Create a "Watch movie" select field. In Find mode: set `Search in` to `$allInstances`, add a rule `fields.<medium-field-id>.value IS "movies"`, set `Grab value` to `label`. Save. Open an instance binding this field. Confirm the dropdown lists current movie instance labels.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/commandCenter/SelectOptionsSourceEditor.jsx
git commit -m "feat: SelectOptionsSourceEditor find mode body (predicate + paths + sort/limit)"
```

---

## Task 11: Add live preview to find mode body

**Files:**
- Modify: `client/src/ui/commandCenter/SelectOptionsSourceEditor.jsx`

- [ ] **Step 1: Add the preview block to `FindBody`**

Add imports:

```js
import { useContext, useMemo } from "react";
import { GridActionsContext } from "../../GridActionsContext";
import { resolveOptions } from "../../helpers/optionsResolver";
```

Inside `FindBody`, after the `find` declaration:

```jsx
const ctx = useContext(GridActionsContext);
const preview = useMemo(() => {
  const draftField = { type: "select", meta: { optionsSource: { mode: "find", find } } };
  return resolveOptions(draftField, {
    occurrencesById: ctx.occurrencesById || {},
    modulesById: ctx.modulesById || {},
    fieldsById: ctx.fieldsById || {},
    foldersById: ctx.foldersById || {},
  });
}, [find, ctx.occurrencesById, ctx.modulesById, ctx.fieldsById, ctx.foldersById]);
```

Append at the bottom of the `FindBody` return:

```jsx
<div style={{ marginTop: 4 }}>
  <div style={sectionLabel}>
    Preview: {preview.totalMatched} match{preview.totalMatched === 1 ? "" : "es"}
    {preview.totalMatched > preview.options.length && ` (showing first ${preview.options.length})`}
  </div>
  {preview.options.length === 0 ? (
    <div style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "monospace", fontStyle: "italic" }}>
      No matches — check the predicate.
    </div>
  ) : (
    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
      {preview.options.slice(0, 10).map((o, i) => (
        <li key={i}>{o.label}{o.label !== String(o.value) ? `  ·  ${o.value}` : ""}</li>
      ))}
      {preview.options.length > 10 && <li style={{ color: "var(--text-faint)" }}>… {preview.options.length - 10} more</li>}
    </ul>
  )}
</div>
```

- [ ] **Step 2: Hand-verify**

```bash
npm run dev
```

Adjust the predicate in the field settings; confirm the preview list updates as you type.

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/commandCenter/SelectOptionsSourceEditor.jsx
git commit -m "feat: live preview block in SelectOptionsSourceEditor find body"
```

---

## Task 12: Search-input-when-many-options in `Field.jsx` Popover

**Files:**
- Modify: `client/src/ui/Field.jsx`

- [ ] **Step 1: Locate the Popover-based select dropdown**

```bash
grep -n "Popover\|optionsSource\|_resolvedOptions" client/src/ui/Field.jsx | head -20
```

Find the open-popover branch that renders the option list (the non-compact / non-native-select path).

- [ ] **Step 2: Add search input when option count exceeds 10**

Inside the popover content, just above the option list:

```jsx
const [query, setQuery] = useState("");
const opts = field.meta._resolvedOptions || [];
const filtered = opts.length > 10 && query
  ? opts.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
  : opts;

// ...

{opts.length > 10 && (
  <input
    autoFocus
    value={query}
    onChange={(e) => setQuery(e.target.value)}
    placeholder="Filter options…"
    style={{
      width: "100%", height: 28, fontSize: 11, fontFamily: "monospace",
      background: "var(--input-bg)", border: "1px solid var(--input-border)",
      borderRadius: 5, color: "var(--text-primary)", padding: "0 8px",
      outline: "none", marginBottom: 6,
    }}
  />
)}
{filtered.length === 0 ? (
  <div style={{ fontSize: 10, fontStyle: "italic", color: "var(--text-faint)", padding: 6 }}>
    No matches — check the field's options source
  </div>
) : (
  filtered.map(opt => (
    <button key={String(opt.value)} onClick={() => { onChange(opt.value); setQuery(""); }}>
      {opt.label}
    </button>
  ))
)}
```

- [ ] **Step 3: Hand-verify**

```bash
npm run dev
```

On a find-mode select with >10 matches, open the dropdown, type into the filter, confirm filtering works. On a manual-mode select with ≤10 entries, confirm the search input does NOT appear.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/Field.jsx
git commit -m "feat: search input in select Popover when options > 10"
```

---

## Task 13: Delete dead pool code

**Files:**
- Modify: `client/src/ui/FieldRenderer.jsx`
- Scan: any other reads of `meta.options` / `meta.sourceType` / `meta.poolContainerId(s)`

- [ ] **Step 1: Grep for stragglers**

```bash
grep -rn "meta\.options\b\|meta?.options\b\|sourceType.*pool\|poolContainer" client/src --include="*.js" --include="*.jsx" 2>/dev/null
```

For each hit:
- If it's a read for rendering or logic that's now superseded by `_resolvedOptions` / `optionsSource`, delete it.
- If it's a test (legacy fixture), update the test fixture to use `optionsSource`.

- [ ] **Step 2: Verify nothing still references the dead keys at runtime**

```bash
grep -rn "isPoolSourced\|handleQuickAddPool" client/src --include="*.js" --include="*.jsx" 2>/dev/null
```

Expected: empty (already removed in Task 5).

- [ ] **Step 3: Run the full client test suite**

```bash
npm --prefix ./client run test
```

Expected: PASS. No tests should depend on legacy `meta.options` or pool fields.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete dead pool / meta.options references"
```

---

## Task 14: Final sweep — manual smoke + folder CLAUDE.md updates

**Files:**
- Modify: `client/src/CLAUDE.md`
- Modify: `client/src/helpers/CLAUDE.md`
- Modify: `client/src/ui/CLAUDE.md`
- Modify: `client/src/state/CLAUDE.md` (if exists)

- [ ] **Step 1: Manual smoke flow**

```bash
npm run dev
```

1. Open a select field with legacy `meta.options` (any existing seeded field). Confirm it auto-migrated to `optionsSource: { mode: "manual" }`. Add a value; confirm persist.
2. Switch the field to Range mode; set 1-10 step 1; bind to an instance; confirm dropdown shows 1-10.
3. Switch to Find mode; point at `$allInstances`; add a predicate; pick `label` as valuePath. Confirm preview shows. Confirm instance dropdown shows the same list.
4. Reload the page; confirm the saved configuration round-trips through the server.

- [ ] **Step 2: Update folder CLAUDE.md files**

For each touched folder, append a Recent Changes block describing this work. Keep entries terse — one paragraph each, file paths + the new shape names.

- [ ] **Step 3: Run the full test suite one last time**

```bash
npm --prefix ./client run test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/CLAUDE.md client/src/helpers/CLAUDE.md client/src/ui/CLAUDE.md client/src/state/CLAUDE.md 2>/dev/null
git commit -m "docs: update folder CLAUDE.md for optionsSource refactor"
```

---

## Self-Review Notes

**Spec coverage:** Every section of the spec maps to a task:
- §Data Model → Task 1 (manual+range schema), Task 2 (find schema)
- §Resolution Runtime → Task 1, Task 2, Task 5
- §Rendering changes → Task 6, Task 12
- §Field Settings UI → Tasks 7, 8, 9, 10, 11
- §Migration → Tasks 3, 4
- §Dead Code to Delete → Task 13
- §Testing → Tasks 1, 2, 3 (unit), Task 14 (smoke)

**Type consistency:** `optionsSource` keyed as `{mode, values, range, find}`; `find` keyed as `{over, predicate, valuePath, labelPath, sortPath, sortDir, limit}`. `resolveOptions` always returns `{options: Array<{value,label}>, totalMatched: number}`. `_resolvedOptions` is the runtime-only field-meta key. Names match across all 14 tasks.

**Known external dependency on `HAS_ANCESTOR_ANY`:** Task 3 Step 5 verifies the comparator exists; falls back to `HAS_ANCESTOR` if not. Either way the migration produces a valid predicate.

**Known external dependency on `ConditionGroup` prop shape:** Task 10 Step 1 verifies the export and Step 2 calls it out — adjust prop names if local signature differs.
