# Operations Editor & Pipeline Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven follow-up fixes to the operations editor, executor, drop-stamp, and `createTestGrid` seed: (1) UPDATE config gets a real path picker, (2) restore visible loop iteration-var input, (3) replace `"literal:null"` strings with a true null option in UPDATE values, (4) drive the Tracker goals off `$parentFilter` (with a fallback `$goalItem` find for the goal-page case), (5) fix the off-by-one date when stamping page-filter values onto a freshly-dropped occurrence, (6) strip legacy `$item.` predicate prefixes from the seed and use the variable picker shape for paths, (7) make `createTestGrid` grab record objects through path-pickerable variables instead of bare ID lookups.

**Architecture:** UI changes live in `client/src/blocks/OperationsBuilder.jsx` and reuse the existing `CategoryPathPicker` + `categoryRegistry`. Executor changes are localized to `operationActions.js` (`resolveExpr` for the new null-literal mode) and `operationExecutor.js` (`collectLocalVars`-equivalent). Drop-side date fix is in `helpers/dropHandlers.js` — pure normalization, no schema change. Seed changes in `server/scripts/createTestGrid.js` are mechanical: rewrite predicates to bare record paths, replace label-FIND scaffolding with `$parentFilter` reads where the trigger is ancestor-scoped, and replace UPDATE display paths with variable-anchored paths so the pre-saved `$goalItem` is reused.

**Tech Stack:** React + Vite client, MongoDB/Mongoose server, Vitest for unit tests. No new deps.

**Sequencing notes:**
- Tasks 1–4 are pure client-editor changes; they ship independently of any seed change because the UI paths are backwards-compatible with the legacy DB shape.
- Task 5 (stamp date) is independent.
- Tasks 6 + 7 (`createTestGrid` rewrites) require the editor to already accept the new shapes (Tasks 1–4) — do them after.
- Re-seeding (`scripts/createTestGrid.js`) is left to the user — every task that touches the seed says so explicitly. Do **not** run `resetData.js` or `createTestGrid.js` while implementing.

---

## File Structure

```
client/src/
  blocks/
    OperationsBuilder.jsx       — ActionConfig UPDATE case, LoopStep, collectLocalVars
  helpers/
    operationActions.js         — resolveExpr null-literal handling, UPDATE coercion
    dropHandlers.js             — stampPageFilterFields date normalization
    __tests__/
      operationActions.test.js  — new: literal:null + null-shaped UPDATE
      stampPageFilterFields.test.js  — new: date round-trip
server/scripts/
  createTestGrid.js             — predicate prefix strip, $parentFilter reads, variable-anchored UPDATE paths
```

---

## Task 1: Add a `null` option to the UPDATE value picker (replace `"literal:null"`)

**Why:** Right now an op that wants to clear a date field writes `value: "literal:null"` (a string). This is parsed via `resolveExpr` which detects the prefix and returns JS `null` — but the editor surfaces this as free text in the value field. The user wants a first-class "null" option in the picker so the operation reads as `value: <null>` and round-trips through the editor without ever displaying the `literal:` syntax.

**Files:**
- Modify: `client/src/blocks/OperationsBuilder.jsx` — add `null` mode to `ExprOrPath`'s mode `<select>`
- Modify: `client/src/helpers/operationActions.js:103` — `resolveExpr` already handles `literal:null` (no change needed) but verify with a test
- Test: `client/src/__tests__/operationActions.nullLiteral.test.js`

### Step 1: Write the failing test for `resolveExpr("literal:null")`

```js
// client/src/__tests__/operationActions.nullLiteral.test.js
import { describe, it, expect } from "vitest";
import { resolveExpr } from "../helpers/operationActions";

describe("resolveExpr null literal", () => {
  it("returns JS null for the string 'literal:null'", () => {
    expect(resolveExpr("literal:null", {})).toBe(null);
  });

  it("returns JS null when given JS null directly (no string wrapping)", () => {
    expect(resolveExpr(null, {})).toBe(null);
  });

  it("returns JS null when expr is the empty string", () => {
    expect(resolveExpr("", {})).toBe(null);
  });
});
```

- [ ] **Step 1: Write the failing test**

  Create the file with the contents above.

- [ ] **Step 2: Run the test**

  ```bash
  cd /home/joshpoms/moduli/client && npx vitest run src/__tests__/operationActions.nullLiteral.test.js
  ```

  Expected: all three tests pass on the existing executor (this test is a regression guard for the new editor mode — it confirms the runtime already accepts both shapes).

- [ ] **Step 3: Add a `null` mode to the `ExprOrPath` mode dropdown**

  In `client/src/blocks/OperationsBuilder.jsx` find `ExprOrPath` (~line 610). Update the mode-detection and dropdown to include "null":

  ```jsx
  function ExprOrPath({ value, onChange, placeholder, width = 160, sources = [], fields = [], fieldsById, modulesById, occurrencesById, inLoop = true, localVars = [] }) {
    const v = String(value ?? "").trim();
    const isArrayValue = v.startsWith("json:[");
    const isNullValue = value === null || v === "literal:null";
    const initialMode = isNullValue
      ? "null"
      : isArrayValue
      ? "array"
      : (!v || (v.startsWith("$") && !v.startsWith("literal:"))) ? "path" : "text";
    const [mode, setMode] = useState(initialMode);

    const pickerCtx = useMemo(
      () => ({ sources, fields, fieldsById, modulesById, occurrencesById, localVars }),
      [sources, fields, fieldsById, modulesById, occurrencesById, localVars],
    );

    const switchMode = (next) => {
      setMode(next);
      if (next === "path" && v && !v.startsWith("$")) onChange("");
      else if (next === "array" && !v.startsWith("json:[")) onChange("json:[]");
      else if (next === "text" && (v.startsWith("json:[") || isNullValue)) onChange("");
      else if (next === "null") onChange(null);
    };

    const arrayValue = isArrayValue ? v.slice(5) : "[]";

    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: 3, flexWrap: "wrap" }}>
        <select
          value={mode}
          onChange={e => switchMode(e.target.value)}
          title="How this value is entered"
          style={{ fontSize: 9, padding: "1px 4px", border: "1px solid var(--input-border)", borderRadius: 3, background: "var(--surface)", color: "var(--text-muted)", cursor: "pointer", height: 22 }}
        >
          <option value="path">path</option>
          <option value="text">text</option>
          <option value="array">array</option>
          <option value="null">null</option>
        </select>
        {mode === "path" && (
          <CategoryPathPicker
            value={typeof value === "string" ? value : ""}
            ctx={pickerCtx}
            onChange={onChange}
          />
        )}
        {mode === "text" && (
          <ExprInput value={value} onChange={onChange} placeholder={placeholder} width={width} />
        )}
        {mode === "array" && (
          <textarea
            value={arrayValue}
            onChange={e => {
              try {
                const parsed = JSON.parse(e.target.value);
                if (Array.isArray(parsed)) onChange("json:" + e.target.value);
                else onChange("json:" + e.target.value);
              } catch {
                onChange("json:" + e.target.value);
              }
            }}
            placeholder='[1, 2, 3]   or   [{"a": 1}]'
            style={{ fontSize: 10, padding: "3px 5px", border: "1px solid var(--input-border)", borderRadius: 3, background: "var(--input-bg)", color: "var(--text-primary)", fontFamily: "monospace", width: Math.max(width, 220), minHeight: 60 }}
          />
        )}
        {mode === "null" && (
          <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)", padding: "3px 5px", border: "1px dashed var(--border-subtle)", borderRadius: 3 }}>
            null
          </span>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 4: Make the executor accept JS `null` from `cfg.value` directly**

  Confirm `operationActions.js` UPDATE case (~line 652) handles `cfg.value === null`. The current code paths `value === null && typeof === "object"` to the textmap branch — guard it so JS null falls through to the resolveExpr path (which returns null for null input). Read the existing code first:

  ```bash
  sed -n '660,680p' /home/joshpoms/moduli/client/src/helpers/operationActions.js
  ```

  If the existing code reads `cfg.value !== null && typeof cfg.value === "object"` first, JS null already falls through to `resolveExpr(cfg.value, $vars)` which returns `null`. No change needed — but add a regression test:

  ```js
  // append to client/src/__tests__/operationActions.nullLiteral.test.js
  import { executeActionItem } from "../helpers/operationActions";

  it("UPDATE with cfg.value === null writes null through applyUpdate", () => {
    const $vars = { $myField: "old value" };
    const occurrencesById = {};
    const updates = [];
    const ctx = { $vars, occurrencesById, state: {}, updates };
    // applyUpdate writes `$myField` because the path is a single-segment var
    executeActionItem(
      { type: "UPDATE", path: "$myField", value: null },
      ctx,
    );
    expect($vars.$myField).toBe(null);
  });
  ```

  Verify the import path matches the actual export — open `operationActions.js:1-30` to confirm `executeActionItem` is exported and what its signature is (it may be `executeActionItem(action, context)` with a different shape; adapt the test accordingly).

- [ ] **Step 5: Re-run the tests**

  ```bash
  cd /home/joshpoms/moduli/client && npx vitest run src/__tests__/operationActions.nullLiteral.test.js
  ```

  Expected: all 4 tests pass.

- [ ] **Step 6: Manual smoke test in the editor**

  1. `npm run dev` from repo root.
  2. Open Command Center → Operations → pick the move-out clear op.
  3. Confirm both date and timeslot UPDATE rows render the value column with the mode dropdown showing `null`.
  4. Switch to `text` and back to `null` — the displayed value stays `null`.
  5. Save and reload — value is still `null`.

- [ ] **Step 7: Commit**

  ```bash
  git add client/src/blocks/OperationsBuilder.jsx client/src/__tests__/operationActions.nullLiteral.test.js
  git commit -m "feat(operations): null mode in ExprOrPath picker

  UPDATE/INIT_VAR/etc. value column now has a 'null' option in the
  mode dropdown — picking it stores literal JS null instead of the
  'literal:null' string. resolveExpr already round-trips both shapes
  so existing pipelines keep working."
  ```

---

## Task 2: UPDATE config uses CategoryPathPicker on both sides; no `$display`, no literals on the path side

**Why:** UPDATE writes back to a real DB record. The user picks a `$var` (bound by an earlier FIND with `itemVar`) and drills into its properties. The picker emits a dotted path like `$goalItem.fields.<fid>.value`; `applyUpdate` routes that to the bound occurrence. There is no `$display` concept and no special-cased magic-string keys — UPDATE only writes to records reachable through a FOUND variable. The value side stays as `ExprOrPath` (path/text/array/null modes), but the path side is path-only.

**Files:**
- Modify: `client/src/helpers/applyUpdate.js` — generalize the `$item.*` branch to accept any non-reserved `$<var>` whose bound value is an occurrence-shaped record. Reuse the existing `$item.fields.<fid>.value`/`.flow`/`.parentId`/`.meta.<key>`/`.textmap` routing.
- Modify: `client/src/blocks/OperationsBuilder.jsx` — UPDATE case: replace path `<input>` with `CategoryPathPicker`. Remove the `$display` references from this plan.
- Test: `client/src/__tests__/applyUpdate.varRecord.test.js` — new unit tests for arbitrary `$<var>.fields.<fid>.value` writes.

### Step 1: Read `applyUpdate.js` end-to-end

- [ ] **Step 1: Read the current implementation**

  ```bash
  cat /home/joshpoms/moduli/client/src/helpers/applyUpdate.js
  ```

  Confirm: (a) the `$item.*` branch produces `{ _effect: "UPDATE_OCCURRENCE", occurrenceId, patch }` effects, and (b) `RESERVED_VAR_NAMES` contains `$item` but not user-defined vars like `$goalItem`/`$movedItem`. Note the existing field/flow/parentId/meta/textmap sub-paths.

### Step 2: Write the failing test

```js
// client/src/__tests__/applyUpdate.varRecord.test.js
import { describe, it, expect } from "vitest";
import { applyUpdate } from "../helpers/applyUpdate";

describe("applyUpdate with a user-defined $var bound to an occurrence record", () => {
  const occ = {
    id: "occ_goal",
    targetId: "mod_goal",
    fields: { f1: { value: 0, flow: "in" } },
    meta: { tag: "old" },
  };
  const ctx = () => ({
    vars: { $goalItem: occ },
    occurrencesById: { occ_goal: occ },
  });

  it("$goalItem.fields.<fid>.value emits UPDATE_OCCURRENCE for occ_goal", () => {
    const out = applyUpdate("$goalItem.fields.f1.value", 42, ctx());
    expect(out.varWrites).toEqual({});
    expect(out.effects).toHaveLength(1);
    const eff = out.effects[0];
    expect(eff._effect).toBe("UPDATE_OCCURRENCE");
    expect(eff.occurrenceId).toBe("occ_goal");
    expect(eff.patch.fields.f1.value).toBe(42);
    // Flow preserved from existing field
    expect(eff.patch.fields.f1.flow).toBe("in");
  });

  it("$goalItem.fields.<fid>.flow patches only flow", () => {
    const out = applyUpdate("$goalItem.fields.f1.flow", "out", ctx());
    expect(out.effects[0].patch.fields.f1.flow).toBe("out");
  });

  it("$goalItem.meta.<key> patches the meta map", () => {
    const out = applyUpdate("$goalItem.meta.tag", "new", ctx());
    expect(out.effects[0].patch.meta.tag).toBe("new");
  });

  it("$goalItem.fields.<fid>.value with null clears the field value", () => {
    const out = applyUpdate("$goalItem.fields.f1.value", null, ctx());
    expect(out.effects[0].patch.fields.f1.value).toBe(null);
  });

  it("throws when the named var isn't bound", () => {
    expect(() => applyUpdate("$missing.fields.f1.value", 5, { vars: {}, occurrencesById: {} }))
      .toThrow(/not bound/i);
  });

  it("throws when the bound var has no id (not an occurrence record)", () => {
    expect(() => applyUpdate("$scalar.fields.f1.value", 5, { vars: { $scalar: 7 }, occurrencesById: {} }))
      .toThrow(/not.*record/i);
  });
});
```

- [ ] **Step 2: Save the test and run it**

  ```bash
  cd /home/joshpoms/moduli/client && npx vitest run src/__tests__/applyUpdate.varRecord.test.js
  ```

  Expected: FAIL — current `applyUpdate` only special-cases `$item`.

### Step 3: Generalize `applyUpdate` to any non-reserved `$<var>` head

- [ ] **Step 3: Refactor**

  In `applyUpdate.js`, after the `$item` branch (or by replacing the `$item`-specific handling with a shared helper), add a branch for any other `$<var>` head whose bound value has an `id` field:

  ```js
  // Inside applyUpdate, after the single-segment $<var> write branch:
  // Multi-segment $<var>.<...> where var is bound to an occurrence-shaped record.
  if (head.startsWith("$") && VAR_NAME_RE.test(head)) {
    const bound = vars[head];
    if (bound == null) {
      throw new Error(`$${head.slice(1)} not bound in current pipeline context`);
    }
    if (typeof bound !== "object" || !bound.id) {
      throw new Error(`${head} is not an occurrence record (no .id)`);
    }
    const itemId = bound.id;
    return routeRecordPath(segments.slice(1), value, { itemId, item: bound, occurrencesById });
  }
  ```

  Where `routeRecordPath(segments, value, { itemId, item, occurrencesById })` is the shared helper that contains the existing `$item.fields/.flow/.meta/.textmap/.parentId` logic, returning `{ effects: [{ _effect: "UPDATE_OCCURRENCE", occurrenceId: itemId, patch }], varWrites: {} }`.

  Refactor: extract that body from the existing `$item` block into `routeRecordPath`. Have the `$item` branch call it with `{ itemId: vars.$item.id, item: vars.$item, occurrencesById }` so behaviour is unchanged.

- [ ] **Step 4: Re-run the test**

  ```bash
  cd /home/joshpoms/moduli/client && npx vitest run src/__tests__/applyUpdate.varRecord.test.js
  ```

  Expected: 6/6 PASS. Also run the full client test suite to confirm no regression on the existing `$item` path:

  ```bash
  npx vitest run
  ```

### Step 4: Replace UPDATE path `<input>` with `CategoryPathPicker`

- [ ] **Step 5: Edit `OperationsBuilder.jsx` UPDATE case (~line 1008)**

  ```jsx
  case "UPDATE": {
    const valueIsObject = cfg.value !== null && typeof cfg.value === "object" && !Array.isArray(cfg.value);
    const pickerCtx = { sources, fields, fieldsById, modulesById, occurrencesById, localVars };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={rowStyle}>
          {fl("path")}
          <CategoryPathPicker
            value={cfg.path || ""}
            ctx={pickerCtx}
            onChange={v => setCfg({ path: v })}
          />
        </div>
        <div style={rowStyle}>
          {fl("value")}
          {valueIsObject ? (
            <textarea
              value={JSON.stringify(cfg.value, null, 2)}
              onChange={e => {
                try { setCfg({ value: JSON.parse(e.target.value) }); } catch { /* ignore */ }
              }}
              style={{ ...inputSt, width: 320, fontFamily: "monospace", height: 60 }}
            />
          ) : (
            <ExprOrPath value={cfg.value ?? ""} onChange={v => setCfg({ value: v })} placeholder='"$expr"   or   literal:42   or   null' width={240} {...exprProps} />
          )}
        </div>
      </div>
    );
  }
  ```

  No changes to `categoryRegistry.js` or `CategoryPathPicker.jsx` — the picker already drills any `$var` declared by an earlier FIND/INIT_VAR (Apr 30 work made non-`$grid`/`$trigger` heads default to `"occurrence"` shape). Verify by smoke test below.

### Step 5: Manual smoke

- [ ] **Step 6: Smoke**

  1. `npm run dev`.
  2. Open Command Center → Operations → any op with an UPDATE step (e.g. Tracker: Water Today).
  3. UPDATE's path renders the chip-chain picker. Click it → "Local Variables" → pick `$goalItem` → drill `fields` → pick the totalWater field → pick `value`. Path commits as `$goalItem.fields.<id>.value`.
  4. Save. Reload. The chip chain reads back `$goalItem › fields › Daily Water › value` (friendly names per the segment-display work).

### Step 6: Commit

- [ ] **Step 7: Commit**

  ```bash
  git add client/src/helpers/applyUpdate.js client/src/blocks/OperationsBuilder.jsx client/src/__tests__/applyUpdate.varRecord.test.js
  git commit -m "feat(operations): UPDATE writes to any FOUND \$var record via path picker

  applyUpdate generalized to accept any non-reserved \$<var> head
  whose bound value has an id — routes the record sub-path through
  the same logic the \$item branch already uses. UPDATE config's
  path field swapped from a free-text input to a CategoryPathPicker
  so authors pick variable + property instead of typing IDs."
  ```

---

## Task 3: Restore the loop iteration-variable input

**Why:** The May 3 redesign hid the `as` field on `LoopStep` because predicates inside FIND were rewritten to bare record paths. But IF/loop-body conditions still need a way to reference the per-iteration item — and the user wants to be able to name it (`$preset`, `$slot`, `$goalItem`) so subsequent steps read clearly. The executor still binds `$vars[step.as]` per iteration; the data layer is fine, only the UI input was removed. Re-add it AND restore `step.as` to `localVars` so the picker exposes it.

**Files:**
- Modify: `client/src/blocks/OperationsBuilder.jsx` — `LoopStep` header, `collectLocalVars`

### Step 1: Add the iteration-var input + `as` collection back to localVars

- [ ] **Step 1: Re-expose `step.as` as a local var**

  Find `collectLocalVars` (~line 249–280) and add the line that walks loop bodies:

  ```js
  // Inside the recursion when visiting a `loop` step:
  if (step.type === "loop") {
    if (step.as) names.add(step.as);   // <-- ADD THIS
    walk(step.body || []);
  }
  ```

  Read the existing function before editing — only add the `names.add(step.as)` line; do not change the rest.

- [ ] **Step 2: Re-add the `as` input to `LoopStep`**

  In `LoopStep` (~line 690) update the header to render the var name input AFTER the collection picker:

  ```jsx
  <span style={{ fontSize: 10, color: "rgba(167,139,250,0.8)", fontFamily: "monospace", minWidth: 28 }}>for each in</span>
  <CategoryPathPicker
    value={step.overExpr || ""}
    ctx={pickerCtx}
    config={COLLECTION_PICKER_CONFIG}
    onChange={v => onUpdate({ overExpr: v, as: step.as || "$item" })}
  />
  <span style={{ fontSize: 10, color: "rgba(167,139,250,0.8)", fontFamily: "monospace" }}>as</span>
  <input
    value={(step.as || "$item").replace(/^\$/, "")}
    onChange={e => onUpdate({ as: `$${e.target.value.replace(/\W/g, "")}` })}
    placeholder="item"
    title="Loop iteration variable name. Body steps can reference this as $myName."
    style={{ ...inputSt, width: 80, fontFamily: "monospace" }}
  />
  ```

- [ ] **Step 3: Manual smoke**

  1. Open any operation with a loop (e.g. Water Today).
  2. The loop header now reads `for each in [collection chip] as $item` with `$item` editable in the input.
  3. Rename to `$row`, save, reload — the input still says `$row`.
  4. Inside the body, an IF rule's left-side picker now lists `$row` under "Local Variables".

- [ ] **Step 4: Commit**

  ```bash
  git add client/src/blocks/OperationsBuilder.jsx
  git commit -m "feat(operations): restore loop iteration-var input + localVar exposure"
  ```

---

## Task 4: Drive Tracker goals off `$parentFilter` (with `$goalItem` fallback)

**Why:** The two Tracker ops (Water Today, Tasks Completed Today) currently FIND `Schedule` as the page, then FIND `Physical Wellness` / `Task Progress` as the goal item, then read `$goalItem._effectiveFilter.<dateFieldId>` for `$goalDate`. The user reports `$trigger`-based ancestor scoping is breaking on cold load (the date is still wrong because it's resolving against `Physical Wellness` — the goal *instance* — instead of `Physical` — the *container* the goal lives inside, whose `_effectiveFilter` is what they actually want).

The cleanest answer: the trigger now carries `_ancestorIds`/`_ancestorLabels` (per the Apr 30 cascade work), AND the executor exposes `$parentFilter` as the merged ancestor-chain effective filter for the trigger occurrence. For triggers `ancestorLabel:"Daily Goals"`, `$parentFilter` will already be the Daily Goals page's effective filter (which is what the user wants — "the goal page filter date, not the schedule page's"). So:

- Replace the `$goalItem._effectiveFilter` read with `$parentFilter.<dateFieldId>` as the **first** choice for `$goalDate`.
- Keep the FIND for `$goalItem` only for the UPDATE step (which still needs `$goalId` to write to `$display.<fid>.${$goalId}`).
- Drop the `$schedPage` FIND too — `$parentFilter` already encodes the goal page's filter; we only need `$schedPageId` for the `HAS_ANCESTOR` predicate scope. Replace that FIND with a Source row binding `entityType: "occurrence"` keyed by label `"Schedule"`, OR keep the FIND but lift the comment.

The cleaner reseed-time fix is in Task 6; this task is the editor / runtime work that makes the new pipeline correct. Wire $parentFilter to be reachable by the picker (already is, per the Apr 30 work).

**Files:** This task is mostly *seed-side* (Task 6) — but verify `$parentFilter` is already in the Built-ins category for the picker (it is, per `categoryRegistry.js:157`). No client code change in this task; the test confirms the runtime behavior the seed will rely on.

### Step 1: Test that `$parentFilter` resolves to ancestor-chain effective filter

```js
// client/src/__tests__/parentFilterResolution.test.js
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";

describe("$parentFilter on triggers ancestored by a page with filterOverride", () => {
  it("returns the page's effective filter merged with grid filter", async () => {
    const dateFieldId = "fld_date";
    const grid = {
      activeFilterValues: { [dateFieldId]: "2026-05-01" },
      namedFilters: [],
    };
    const goalsPageOcc = {
      id: "occ_goals_page",
      targetId: "mod_goals_page",
      filterOverride: { [dateFieldId]: "2026-05-23" },
      occurrences: ["occ_goal_inst"],
    };
    const goalInstOcc = {
      id: "occ_goal_inst",
      targetId: "mod_goal_inst",
      parentId: "occ_goals_page",
      occurrences: [],
      fields: {},
    };
    const occurrencesById = {
      occ_goals_page: goalsPageOcc,
      occ_goal_inst: goalInstOcc,
    };

    const pipeline = {
      sources: [],
      steps: [
        { id: "s1", type: "action",
          config: { type: "INIT_VAR", name: "$result", expr: `$parentFilter.${dateFieldId}` } },
      ],
    };

    const log = [];
    const updates = await executePipeline(
      pipeline,
      { type: "MeasureOp", occurrenceId: "occ_goal_inst" },
      { state: { grid, gridId: "g1" }, modulesById: {}, occurrencesById, fieldsById: {} },
      undefined,
      undefined,
      (entry) => log.push(entry),
    );

    // The pipeline's final $result should be "2026-05-23" — the page-level override.
    const finalSnapshot = log.find(e => e.type === "end")?.varsAfter || {};
    expect(finalSnapshot.$result).toBe("2026-05-23");
  });
});
```

- [ ] **Step 1: Write the failing test**

  Save the file above. Note: read `executePipeline`'s actual signature (`client/src/helpers/operationExecutor.js`) and adapt the call — it may take a single context object rather than positional args. The intent is "fire a MeasureOp on occ_goal_inst, run a pipeline that reads `$parentFilter.<fid>`, and confirm $result equals the page override."

- [ ] **Step 2: Run it**

  ```bash
  cd /home/joshpoms/moduli/client && npx vitest run src/__tests__/parentFilterResolution.test.js
  ```

  Expected: PASS (the executor already does this — this test just locks the behaviour the seed will depend on).

  If FAIL: read `operationExecutor.js:896-926` to confirm the chain walk uses `parentByChildId` (built from `occ.occurrences[]`) — not `parentId`. Adjust the test fixtures to match.

- [ ] **Step 3: Commit the test only**

  ```bash
  git add client/src/__tests__/parentFilterResolution.test.js
  git commit -m "test: \$parentFilter resolves goal-page filterOverride for ancestored trigger"
  ```

---

## Task 5: Fix off-by-one date in `stampPageFilterFields`

**Why:** When dropping an instance into a slot under a page filtered to `2026-05-23`, the new occurrence is being saved with `fields.<dateFieldId>.value === "2026-05-22"`. Root cause: `getEffectiveFilterForOccurrence` returns the value as stored — and the page-filter UI may be persisting either a `Date`, an ISO timestamp `2026-05-23T00:00:00.000Z`, or a YYYY-MM-DD string. When the value is the ISO timestamp, the date input downstream calls `new Date("2026-05-23T00:00:00.000Z")` → `Sat May 22 2026 19:00:00 GMT-0500` and `formattedValue` shows May 22. Other ops (`$activeDate`) already normalize via `_localDayString` (per Apr 29 fix) — `stampPageFilterFields` does not.

**Fix:** Normalize `v` to a local-tz `YYYY-MM-DD` string before stamping, mirroring the executor's `_localDayString` helper.

**Files:**
- Modify: `client/src/helpers/dropHandlers.js` — `stampPageFilterFields`
- Test: `client/src/__tests__/stampPageFilterFields.test.js`

### Step 1: Write the failing test

```js
// client/src/__tests__/stampPageFilterFields.test.js
import { describe, it, expect, vi } from "vitest";

// We can't import stampPageFilterFields directly because it's a closure helper,
// but we can extract its date-normalization logic into a tiny exported helper
// (Step 3) and unit-test that.

import { normalizeFilterDateValue } from "../helpers/dropHandlers";

describe("normalizeFilterDateValue", () => {
  it("passes through already-YYYY-MM-DD strings", () => {
    expect(normalizeFilterDateValue("2026-05-23")).toBe("2026-05-23");
  });

  it("strips the time component from ISO timestamps using LOCAL tz, not UTC", () => {
    // 2026-05-23T00:00:00.000Z is May 22 19:00 in America/New_York.
    // We want the LOCAL date to round-trip — UTC midnight is the user's
    // intent ("the filter is on the 23rd"), so output must be 2026-05-23.
    // The helper uses string-prefix slice for ISO inputs (no Date math).
    expect(normalizeFilterDateValue("2026-05-23T00:00:00.000Z")).toBe("2026-05-23");
    expect(normalizeFilterDateValue("2026-05-23T17:00:00.000Z")).toBe("2026-05-23");
  });

  it("formats Date objects via local-tz parts", () => {
    const d = new Date(2026, 4, 23, 12, 0, 0); // May=4
    expect(normalizeFilterDateValue(d)).toBe("2026-05-23");
  });

  it("returns null for null/undefined/empty", () => {
    expect(normalizeFilterDateValue(null)).toBe(null);
    expect(normalizeFilterDateValue(undefined)).toBe(null);
    expect(normalizeFilterDateValue("")).toBe(null);
  });
});
```

- [ ] **Step 1: Write the failing test**

  Save the file above.

- [ ] **Step 2: Run it**

  ```bash
  cd /home/joshpoms/moduli/client && npx vitest run src/__tests__/stampPageFilterFields.test.js
  ```

  Expected: FAIL — `normalizeFilterDateValue` not exported yet.

- [ ] **Step 3: Add `normalizeFilterDateValue` and use it in the stamp**

  In `client/src/helpers/dropHandlers.js`, ABOVE `stampPageFilterFields`, add and export:

  ```js
  // Normalize a date-typed filter value to a local-tz YYYY-MM-DD string.
  // Handles three input shapes that the filter pipeline produces in the wild:
  //   1) "2026-05-23" — return as-is
  //   2) "2026-05-23T...Z" — slice the date prefix; the time component
  //      shouldn't bleed into local-tz interpretation downstream.
  //   3) Date instance — format via getFullYear/getMonth/getDate.
  // null/undefined/empty → null. Any other shape → null (caller skips stamp).
  export function normalizeFilterDateValue(v) {
    if (v == null || v === "") return null;
    if (typeof v === "string") {
      if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
      const d = new Date(v);
      if (isNaN(d.getTime())) return null;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    if (v instanceof Date && !isNaN(v.getTime())) {
      return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
    }
    return null;
  }
  ```

  Then update `stampPageFilterFields` (~line 33) to use it:

  ```js
  for (const fid of navFieldIds) {
    const raw = effective?.[fid];
    const v = normalizeFilterDateValue(raw);
    if (v == null) continue;
    const existing = merged[fid];
    const existingValue = existing && typeof existing === "object" ? existing.value : existing;
    if (normalizeFilterDateValue(existingValue) === v) continue;
    merged[fid] = { value: v, flow: existing?.flow ?? "in" };
    changed = true;
  }
  ```

- [ ] **Step 4: Re-run the test**

  ```bash
  cd /home/joshpoms/moduli/client && npx vitest run src/__tests__/stampPageFilterFields.test.js
  ```

  Expected: 4/4 PASS.

- [ ] **Step 5: Manual smoke**

  1. `npm run dev`.
  2. Open the Schedule page, navigate the local filter to a future date (e.g. May 23).
  3. Drop a Drink Water instance into the 7am slot.
  4. Open the new occurrence's date field display. It should read May 23 — not May 22.
  5. Refresh the page; date still reads May 23.

- [ ] **Step 6: Commit**

  ```bash
  git add client/src/helpers/dropHandlers.js client/src/__tests__/stampPageFilterFields.test.js
  git commit -m "fix(stamp): normalize page-filter date to local-tz YYYY-MM-DD on drop

  stampPageFilterFields was passing the raw effective-filter value
  through to the new occurrence. When the filter stored an ISO
  timestamp (UTC midnight), downstream Date() calls converted to
  local time and showed the previous day. Normalize via local-tz
  parts so dates round-trip without offset drift."
  ```

---

## Task 6: Strip `$item.` legacy prefixes + use `$parentFilter` in seed

**Why:** Per the May 3 redesign, FIND/loop predicate `rule.left` values should be bare record paths (`label`, `fields.<fid>.value`, `_ancestors`) — not `$item.label`. The current `createTestGrid.js` still writes `$item.label`, `$item.fields.X.value`, etc. The runtime tolerates both shapes, but the editor only commits bare paths going forward — re-saving an op in the editor would change the persisted shape, then the diff between seed and live DB grows. Also: the Tracker ops should drive `$goalDate` off `$parentFilter.<dateFieldId>` (with `$goalItem._effectiveFilter` as a *fallback*, then `$trigger.date`, then `$today`).

**Files:**
- Modify: `server/scripts/createTestGrid.js`

### Step 1: Strip `$item.` prefixes from FIND predicates

- [ ] **Step 1: Search for the pattern**

  ```bash
  grep -nE '"left": "\$item\.' /home/joshpoms/moduli/server/scripts/createTestGrid.js
  ```

  Or for the literal source:

  ```bash
  grep -nE 'left: "\$item\.' /home/joshpoms/moduli/server/scripts/createTestGrid.js
  ```

  Expected: ~40 hits across the four ops.

- [ ] **Step 2: Rewrite each predicate `rule.left`**

  Map each `$item.<path>` to bare record-path:

  | Before (in createTestGrid.js)            | After                       |
  |------------------------------------------|-----------------------------|
  | `"$item.label"`                          | `"label"`                   |
  | `"$item.id"`                             | `"id"`                      |
  | `"$item.templateId"`                     | `"templateId"`              |
  | `"$item.fields.<fid>.value"`             | `"fields.<fid>.value"`      |
  | `"$item.meta.<key>"`                     | `"meta.<key>"`              |
  | `"$item._ancestors"`                     | `"_ancestors"`              |

  These appear inside FIND `predicate.rules[].left` AND inside loop-body IF `condition.rules[].left`. **Both** should be bare paths now (the executor's `evalGroupAgainstRecord` strips a leading `$item.` for back-compat, but the seed should write the new shape).

  Use sed to do the bulk strip — but verify the result by reading each affected op afterwards. From the project root:

  ```bash
  cd /home/joshpoms/moduli/server/scripts && \
    sed -i 's/left: "\$item\./left: "/g' createTestGrid.js && \
    sed -i "s/left: '\\\$item\\./left: '/g" createTestGrid.js
  ```

  Then `git diff scripts/createTestGrid.js` to verify only `left:` paths changed and the `as: "$item"` strings are untouched.

- [ ] **Step 3: Update Tracker: Water Today to use `$parentFilter` + fallback chain**

  Find the op (line ~459). Replace the `$schedPageId` + `$goalId` + `$goalItem._effectiveFilter` scaffolding with:

  ```js
  // ---- Tracker: Water Today ----
  await new Operation({
    id: uid(), userId, gridId, name: "Tracker: Water Today",
    description: "Sum water oz under the Schedule page for the date the Daily Goals page is showing.",
    priority: 3,
    triggerTypes: ["onChange", "onFilterChange", "onLoad"],
    triggerObjects: [
      { eventType: "onChange",       subjectType: "field",     targetId: waterFieldId },
      { eventType: "onChange",       subjectType: "field",     targetId: completedFieldId },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: "Daily Goals" },
      { eventType: "onLoad",         subjectType: "grid",      targetId: "" },
    ],
    enabled: true,
    pipeline: {
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },

        // Schedule page — only used for the HAS_ANCESTOR scope on the loop body.
        { id: uid(), type: "action", config: {
            type: "FIND",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: "Schedule" },
            ]},
            itemIdVar: "$schedPageId",
        }},

        // Locate the goal display item — we need its id for the UPDATE step.
        { id: uid(), type: "action", config: {
            type: "FIND",
            predicate: { operator: "AND", rules: [
              { id: uid(), left: "label", comparator: "IS", right: "Physical Wellness" },
            ]},
            itemIdVar: "$goalId",
            itemVar:   "$goalItem",
        }},

        // $goalDate fallback chain (closest signal first):
        //   1. $parentFilter.<dateFieldId> — when the trigger is ancestored by
        //      the Daily Goals page (filter-nav, on-load, etc.), $parentFilter
        //      is already the goal page's merged effective filter.
        //   2. $goalItem._effectiveFilter.<dateFieldId> — fallback for triggers
        //      whose ancestor chain doesn't include the goal page (e.g.
        //      MeasureOp on a schedule cell — $parentFilter is the schedule
        //      page's date there, which we don't want).
        //   3. $trigger.date — NavigationOp carries it explicitly.
        //   4. $today.
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalDate", expr: `$parentFilter.${dateFieldId}` } },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$goalDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalDate", expr: `$goalItem._effectiveFilter.${dateFieldId}` } }],
          else: [],
        },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$goalDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalDate", expr: "$trigger.date" } }],
          else: [],
        },
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [{ id: uid(), left: "$goalDate", comparator: "IS_EMPTY", right: "" }] },
          then: [{ id: uid(), type: "action", config: { type: "INIT_VAR", name: "$goalDate", expr: "$today" } }],
          else: [],
        },

        // Trigger gate (unchanged).
        { id: uid(), type: "if",
          condition: { operator: "OR", rules: [ /* unchanged trigger.type rules */ ]},
          then: [
            { id: uid(), type: "loop", overExpr: "$allItems", as: "$item",
              body: [{
                id: uid(), type: "if",
                condition: { operator: "AND", rules: [
                  { id: uid(), left: `fields.${waterFieldId}.value`,     comparator: "IS_NOT_EMPTY", right: "" },
                  { id: uid(), left: `fields.${completedFieldId}.value`, comparator: "IS",           right: true },
                  { id: uid(), left: `fields.${dateFieldId}.value`,      comparator: "SAME_DAY",     right: "$goalDate" },
                  { id: uid(), left: `_ancestors`,                       comparator: "HAS_ANCESTOR", right: "$schedPageId" },
                ]},
                then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: `$item.fields.${waterFieldId}.value` } }],
                else: [],
              }],
            },
            { id: uid(), type: "action", config: {
                type: "UPDATE",
                path: `$display.${totalWaterFieldId}.\${$goalId}`,
                value: "$total",
            }},
          ],
          else: [],
        },
      ],
    },
  }).save();
  ```

  Note `$item.fields.X.value` is still valid INSIDE the loop body when used in an `expr` (resolveExpr — not a record-path predicate) — that's why the ADD_TO_VAR keeps the `$item.` prefix.

- [ ] **Step 4: Apply the same pattern to Tracker: Tasks Completed Today**

  Find the op (line ~566). Same restructure:
  - Add the FIND for `$goalId`/`$goalItem` (label "Task Progress") if missing.
  - Replace the existing `$goalDate = $goalItem._effectiveFilter.<dateFieldId>` step with the four-step fallback (parentFilter → goalItem._effectiveFilter → trigger.date → today).
  - Strip `$item.` from predicate left-sides.

- [ ] **Step 5: DO NOT re-seed**

  The user explicitly said not to run resetData.js or createTestGrid.js. The pipeline change lives in code only and takes effect the next time *they* run the seed. Note that in the commit message:

  ```bash
  git add server/scripts/createTestGrid.js
  git commit -m "seed(operations): bare record paths + \$parentFilter goal date

  Strips legacy \$item. prefix from FIND/loop-body predicate left-sides
  per the May 3 record-path predicate redesign. Tracker ops now read
  \$goalDate from \$parentFilter first (correct for filter-nav and
  load triggers ancestored by Daily Goals), with goalItem effective
  filter / trigger date / today as fallbacks.

  Re-seed required when ready: node --env-file=.env scripts/createTestGrid.js"
  ```

---

## Task 7: Replace ID lookups with variable-anchored paths in seed

**Why:** Throughout `createTestGrid.js`, several CREATE/UPDATE-adjacent steps still grab raw IDs and reference them. With the path picker doing the heavy lifting at edit time, the seed should write paths that anchor on a `$var` (saved by an earlier FIND with `itemVar`). That way, when the user opens the op in the editor and clicks the path chip, they see `$goalItem › fields › Daily Water › value` — friendly names — instead of the raw fieldId/occurrenceId pair.

Concrete targets:
- The two Tracker ops' UPDATE steps already write `$display.<fieldId>.${$goalId}`. That works, but there's a *better* shape: write `$goalItem.fields.<fieldId>.value` (path-pickerable as `$goalItem › fields › Daily Water › value`). The runtime's `applyUpdate` already supports `$<var>.fields.<fid>.value`. **Decision: keep `$display` for *computed* values that aren't persisted to the occurrence.** The tracker totals are computed (not user-entered), so `$display` is the correct destination. Document this in a comment.
- The "Schedule: Stamp Date & Time Slot" op already FINDs `$item` from `$trigger.occurrenceId` — leave it.
- The "Schedule: Clear Date on Move-Out" op loops over `$allItems` and matches by id; switch the loop to a single FIND-by-id step + a check on the matched item's `_ancestors`, so the editor reads as a flat sequence (not a "loop over everything").

### Step 1: Refactor Clear-Date-on-Move-Out to use FIND-by-id

- [ ] **Step 1: Find the op (line ~1031) and replace the loop with a FIND**

  Replace:

  ```js
  // OLD (loop over everything, match by id)
  { id: uid(), type: "loop", overExpr: "$allItems", as: "$item",
    body: [{ id: uid(), type: "if",
      condition: { operator: "AND", rules: [
        { id: uid(), left: "$item.id",         comparator: "IS",                right: "$trigger.occurrenceId" },
        { id: uid(), left: "$item._ancestors", comparator: "NOT_HAS_ANCESTOR",  right: "$schedPageId" },
      ]},
      then: [ /* UPDATEs */ ],
      else: [],
    }],
  },
  ```

  With:

  ```js
  // NEW: pluck the moved item directly, then check its ancestors.
  { id: uid(), type: "action", config: {
      type: "FIND",
      predicate: { operator: "AND", rules: [
        { id: uid(), left: "id", comparator: "IS", right: "$trigger.occurrenceId" },
      ]},
      itemVar: "$movedItem",
  }},
  {
    id: uid(), type: "if",
    condition: { operator: "AND", rules: [
      { id: uid(), left: "$movedItem._ancestors", comparator: "NOT_HAS_ANCESTOR", right: "$schedPageId" },
    ]},
    then: [
      { id: uid(), type: "action", config: {
          type: "UPDATE",
          path: `$movedItem.fields.${dateFieldId}.value`,
          value: null,                       // <-- JS null, not "literal:null"
      }},
      { id: uid(), type: "action", config: {
          type: "UPDATE",
          path: `$movedItem.fields.${timeslotFieldId}.value`,
          value: null,
      }},
    ],
    else: [],
  },
  ```

  - The IF condition's left is still a record-key path on `$movedItem` — but it's a `$var.X` path, not a bare record path, because we're outside FIND's predicate context. (`evalRule`'s `resolveExpr` walks `$movedItem._ancestors` correctly.)
  - Note `value: null` (real JS null, not the `"literal:null"` string) — depends on Task 1 + the executor's `applyUpdate` accepting null. Confirm by reading `applyUpdate.js:80-110`.

- [ ] **Step 2: Add a banner comment that summarizes seed conventions**

  At the top of `createTestGrid.js` (after the existing layout banner), add:

  ```js
  // ============================================================
  // Seed conventions (May 4 2026):
  // - Predicate `rule.left` inside FIND `predicate` and inside loop-body IF
  //   conditions are BARE record paths (`label`, `fields.<fid>.value`,
  //   `_ancestors`). The runtime tolerates legacy `$item.` prefixes for
  //   back-compat but new pipelines should not write them.
  // - Outside predicates (e.g. resolveExpr on the right side of a rule, or
  //   ADD_TO_VAR's `expr`), `$item.X` IS the correct shape — that's a
  //   $var lookup against the iteration variable.
  // - UPDATE `path` is anchored on a $var (`$myVar.fields.X.value`) when
  //   writing back to a previously FOUND record, or on `$display.<fid>.${$id}`
  //   for computed (non-persisted) display values.
  // - UPDATE `value` is JS null (not `"literal:null"`) when the intent is
  //   to clear a field — the editor's null mode produces this directly.
  // ============================================================
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add server/scripts/createTestGrid.js
  git commit -m "seed(operations): clear-date FIND-by-id + null literal cleanup

  Replaced the loop-over-\$allItems-and-match-by-id pattern in
  'Schedule: Clear Date on Move-Out' with a FIND step that binds
  the moved item to \$movedItem, then a single IF over its
  ancestors. UPDATE values for the cleared fields are now JS null
  (not the legacy 'literal:null' string); resolveExpr accepts both.

  Added seed-conventions banner.

  Re-seed required when ready: node --env-file=.env scripts/createTestGrid.js"
  ```

---

## Final smoke + verification

- [ ] **Run the full client test suite**

  ```bash
  cd /home/joshpoms/moduli/client && npx vitest run
  ```

  Expected: green. Pay attention to `categoryRegistry.test.js`, `operationActions.nullLiteral.test.js`, `parentFilterResolution.test.js`, `stampPageFilterFields.test.js`, and the existing `operationExecutor.test.js`.

- [ ] **Run the server test suite**

  ```bash
  cd /home/joshpoms/moduli/server && npm test
  ```

  Expected: green. The seed-script changes don't have direct unit tests but the pipeline-shape tests should still pass.

- [ ] **End-to-end browser smoke**

  1. `npm run dev` from repo root.
  2. Open a fresh browser to `localhost:5173`. (No reseed — the user said don't.)
  3. Open Command Center → Operations → Tracker: Water Today (or "Water Today" — whichever name the live DB has).
     - The loop header reads `for each in $allOccurrences as $item`.
     - The final UPDATE step path renders as a chip-chain picker.
     - The mode dropdown next to UPDATE's value column has `null` as an option.
  4. Open the Schedule page, navigate the local filter to a future date.
  5. Drop an instance. The new occurrence's date displays as the filter date — not the day before.
  6. The Tracker totals on the Daily Goals page recompute correctly when you change the goal page filter date.

- [ ] **Self-review checklist (run mentally before reporting done)**

  - [ ] Every test file mentioned exists and the assertions reference real exports.
  - [ ] No commits run `node scripts/resetData.js` or `node scripts/createTestGrid.js` — both wipe existing op run-history and were explicitly forbidden.
  - [ ] Seed-side commits include "Re-seed required when ready" in the message so the user knows.
  - [ ] `applyUpdate.js`'s `RESERVED_VAR_NAMES` set still permits `$movedItem` as a single-segment write target (it's not in the reserved set — verify before assuming).
  - [ ] `$display` shape entry in `CategoryPathPicker.SHAPES` matches the lookup convention used by the surrounding `occurrence`/`grid` entries (function vs static array).
