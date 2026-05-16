# createLiveData Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `server/scripts/createLiveData.js` — an additive, re-runnable "Live Grid" that uses createTestGrid's new-system architecture (filters, Templates manifest, modern pipeline ops, DB-only docs) populated with the rich content from createDefaultUserData, with every old aggregation converted to a new-system tracker.

**Architecture:** Approach B. Extract the new-system builders from `createTestGrid.js` into `server/utils/liveSystemBuilders.js`; refactor `createTestGrid.js` to consume them with byte-equivalent output (test-suite gated); then write `createLiveData.js` consuming the same builders plus a content port.

**Tech Stack:** Node ESM, Mongoose models (`server/models/*`), vitest (client 572 + server suites), socket-driven pipeline ops (`Operation.pipeline.steps`).

**Reference docs:** `docs/superpowers/specs/2026-05-16-create-live-data-design.md` (spec). Source files: `server/scripts/createTestGrid.js` (new system), `server/utils/createDefaultUserData.js` (content), `server/utils/operationBuilders.js` (`uid`, `generateTimeSlots`, old `makeLoop*`), `server/utils/mdParsers.js` (`parseSections`, `parseSectionsWithInstances`).

**Run commands:**
- Client tests (572): `npm test` (repo root)
- Server tests: `npm --prefix ./server run test`
- Seed test grid: `cd server && node --env-file=.env scripts/createTestGrid.js`
- Seed live grid: `cd server && node --env-file=.env scripts/createLiveData.js`

---

## Part 1 — Shared library + behavior-preserving createTestGrid refactor

### Task 0: Backup + baseline

**Files:**
- Create: `server/scripts/createTestGrid.backup.js` (untracked)

- [ ] **Step 1: Copy the known-good fixture**

Run: `cp server/scripts/createTestGrid.js server/scripts/createTestGrid.backup.js`

- [ ] **Step 2: Add backup to gitignore (do not track the backup)**

Append to `server/.gitignore` (create if absent): `scripts/createTestGrid.backup.js`

- [ ] **Step 3: Baseline both suites green**

Run: `npm --prefix ./server run test` then `npm test`
Expected: both pass (note the server + client pass counts; client ≈ 572).

- [ ] **Step 4: Capture a structural snapshot of the test grid**

Run: `cd server && node --env-file=.env scripts/createTestGrid.js | tee /tmp/ctg-before.txt`
Expected: completes; note the returned summary (gridId, panelOccIds keys, op count). This is the parity reference for Task 5.

- [ ] **Step 5: Commit the snapshot note**

```bash
git add docs/superpowers/plans/2026-05-16-create-live-data.md
git commit -m "chore: baseline before createLiveData Part 1"
```

---

### Task 1: liveSystemBuilders — grid + schedule filters

**Files:**
- Create: `server/utils/liveSystemBuilders.js`
- Test: `server/__tests__/liveSystemBuilders.test.js`

Extract `createTestGrid.js` STEP 1 (lines ~146–186, the `Grid` construction + `namedFilters`) and the schedule-page `filters` array (lines ~694–725).

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/liveSystemBuilders.test.js
import { describe, it, expect } from "vitest";
import { buildGridDoc, buildScheduleFilters } from "../utils/liveSystemBuilders.js";

describe("buildGridDoc", () => {
  it("creates a Daily namedFilter on dateFieldId with empty activeFilterValues", () => {
    const g = buildGridDoc({ userId: "u1", gridName: "Live Grid", manifestId: "m1", dateFieldId: "DF" });
    expect(g.name).toBe("Live Grid");
    expect(g.activeFilterId).toBe("filter_daily");
    expect(g.namedFilters[0].conditions[0]).toMatchObject({ fieldId: "DF", comparator: "SAME_DAY", isNav: true });
    expect(g.activeFilterValues).toEqual({});
  });
});

describe("buildScheduleFilters", () => {
  it("returns a date filter + a timeslot select filter", () => {
    const f = buildScheduleFilters({ schedFilterId: "s", timeslotFilterId: "t", dateFieldId: "DF", timeslotFieldId: "TS", timeslotLabels: ["6:00am"] });
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ id: "s", fieldId: "DF", active: true });
    expect(f[1]).toMatchObject({ id: "t", fieldId: "TS", style: "select", options: ["6:00am"] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ./server run test -- liveSystemBuilders`
Expected: FAIL — module not found / exports undefined.

- [ ] **Step 3: Implement the two builders**

```js
// server/utils/liveSystemBuilders.js
// New-system seed builders shared by createTestGrid.js + createLiveData.js.
// Each builder is pure (no DB writes) and returns plain data the caller persists.
import { uid } from "./operationBuilders.js";

// Mirrors createTestGrid STEP 1. Returns a plain object the caller passes to `new Grid(obj)`.
export function buildGridDoc({ userId, gridName, manifestId, dateFieldId }) {
  return {
    userId, name: gridName, rows: 2, cols: 3,
    templates: [], occurrences: [],
    manifestId,
    namedFilters: [{
      id: "filter_daily",
      name: "Daily",
      conditions: [{ fieldId: dateFieldId, comparator: "SAME_DAY", isNav: true }],
      timeUnit: "day",
    }],
    activeFilterId: "filter_daily",
    activeFilterValues: {},
  };
}

// Mirrors the schedule-page `filters` array in createTestGrid STEP 8.
export function buildScheduleFilters({ schedFilterId, timeslotFilterId, dateFieldId, timeslotFieldId, timeslotLabels }) {
  return [
    {
      id: schedFilterId, fieldId: dateFieldId, active: true, showNav: true,
      timeUnit: "day", defaultNavValue: "today",
      condition: { operator: "OR", rules: [
        { left: "$field.value", comparator: "DATE_EQUALS", right: "$nav" },
        { left: "$field.value", comparator: "IS_EMPTY" },
      ]},
    },
    {
      id: timeslotFilterId, fieldId: timeslotFieldId, active: true, showNav: true,
      style: "select", options: timeslotLabels, condition: null,
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ./server run test -- liveSystemBuilders`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/utils/liveSystemBuilders.js server/__tests__/liveSystemBuilders.test.js
git commit -m "feat: liveSystemBuilders grid + schedule filter builders"
```

---

### Task 2: liveSystemBuilders — Templates manifest + Daily Routine + Day Page templates

**Files:**
- Modify: `server/utils/liveSystemBuilders.js`
- Test: `server/__tests__/liveSystemBuilders.test.js`

Extract `createTestGrid.js` STEP 7b (lines ~487–662). The builders take a caller-supplied `mkOcc(data)` async helper and model factories so each script owns persistence + IDs.

- [ ] **Step 1: Write the failing test**

```js
// append to liveSystemBuilders.test.js
import { buildDailyRoutineTemplate, buildDayPageTemplate } from "../utils/liveSystemBuilders.js";

describe("buildDailyRoutineTemplate", () => {
  it("emits one slot template occ per timeSlot with identitySignature and routine children", async () => {
    const occs = [];
    const mkOcc = async (d) => { const id = d.id || `o${occs.length}`; occs.push({ ...d, id }); return id; };
    const saved = [];
    const ModuleStub = function (o) { Object.assign(this, o); this.save = async () => { saved.push(o); }; };
    const rootOccId = await buildDailyRoutineTemplate({
      userId: "u", gridId: "g", timeSlots: [{ hour: 6, minute: 0, label: "6:00am" }, { hour: 7, minute: 0, label: "7:00am" }],
      timeslotFieldId: "TS",
      routineBySlot: { "6:00am": [{ sourceModId: "SRC", label: "Drink Water" }] },
      tplManifestRootFolderId: "tplRoot", mkOcc, Module: ModuleStub,
      findModule: async () => ({ fieldBindings: [{ fieldId: "c", role: "input", order: 0 }] }),
    });
    const slotOccs = occs.filter(o => o.identitySignature?.startsWith("slot:"));
    expect(slotOccs).toHaveLength(2);
    const root = occs.find(o => o.id === rootOccId);
    expect(root.meta).toMatchObject({ templateName: "Daily Routine", templateModule: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ./server run test -- liveSystemBuilders`
Expected: FAIL — `buildDailyRoutineTemplate` not exported.

- [ ] **Step 3: Implement both template builders**

Port `createTestGrid.js` lines 491–662 verbatim into two exported async functions. Replace the inline `new Module({...}).save()` with the injected `Module` param and `Module.findOne` with the injected `findModule`. Signatures:

```js
export async function buildTemplatesManifest({ userId, gridId, Folder, Manifest }) {
  const tplManifestRootFolderId = uid();
  const tplManifestId = uid();
  await new Folder({ id: tplManifestRootFolderId, userId, gridId, name: "Templates", parentId: null, folderType: "templates", sortOrder: 0, isExpanded: true }).save();
  await new Manifest({ id: tplManifestId, userId, gridId, name: "Templates", manifestType: "templates", rootFolderId: tplManifestRootFolderId }).save();
  return { tplManifestId, tplManifestRootFolderId };
}

export async function buildDailyRoutineTemplate({ userId, gridId, timeSlots, timeslotFieldId, routineBySlot, tplManifestRootFolderId, mkOcc, Module, findModule }) {
  // ... exact port of createTestGrid.js lines 518–604, using Module/findModule params,
  //     mkOcc for occurrences. routineBySlot + per-routine sourceModId are caller-supplied.
  //     Returns tplRoutineRootOccId.
}

export async function buildDayPageTemplate({ userId, gridId, tplManifestRootFolderId, mkOcc, Module }) {
  // ... exact port of createTestGrid.js lines 619–662. Returns tplDayPageRootOccId.
}
```

Keep every existing comment from those lines (they encode bug context — APPLY_TEMPLATE merge semantics, identitySignature, instanceTextblock shape).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ./server run test -- liveSystemBuilders`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/utils/liveSystemBuilders.js server/__tests__/liveSystemBuilders.test.js
git commit -m "feat: liveSystemBuilders template builders (Daily Routine + Day Page)"
```

---

### Task 3: liveSystemBuilders — schedule/day-page operations

**Files:**
- Modify: `server/utils/liveSystemBuilders.js`
- Test: `server/__tests__/liveSystemBuilders.test.js`

Extract the four ops from `createTestGrid.js` STEP 12: `Schedule: Build Day` (1094–1379), `Day Page: Build` (1390–~1497), `Schedule: Stamp Date & Time Slot` (1498–1530), `Schedule: Clear Date on Move-Out` (1532–1587). Each becomes a factory returning the plain object passed to `new Operation(obj)`.

- [ ] **Step 1: Write the failing test**

```js
// append to liveSystemBuilders.test.js
import { makeScheduleBuildDayOp, makeStampDateTimeSlotOp } from "../utils/liveSystemBuilders.js";

describe("schedule ops", () => {
  it("Build Day op is priority-1, onLoad+onFilterChange, references date/due/timeslot fields", () => {
    const op = makeScheduleBuildDayOp({ userId: "u", gridId: "g", dateFieldId: "DF", dueFieldId: "DUE", timeslotFieldId: "TS" });
    expect(op.name).toBe("Schedule: Build Day");
    expect(op.triggerTypes).toEqual(["onLoad", "onFilterChange"]);
    expect(op.triggerObjects.every(t => t.priority === 1)).toBe(true);
    expect(JSON.stringify(op.pipeline)).toContain("DF");
    expect(JSON.stringify(op.pipeline)).toContain("DUE");
  });
  it("Stamp op writes the timeslot field on onCreate under the hub panel", () => {
    const op = makeStampDateTimeSlotOp({ userId: "u", gridId: "g", timeslotFieldId: "TS", hubPanelModuleId: "HUB" });
    expect(op.triggerObjects[0]).toMatchObject({ eventType: "onCreate", targetId: "HUB" });
    expect(JSON.stringify(op.pipeline)).toContain("TS");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ./server run test -- liveSystemBuilders`
Expected: FAIL — factories not exported.

- [ ] **Step 3: Implement the four factories**

Verbatim port the four `new Operation({...})` literals into `makeScheduleBuildDayOp`, `makeDayPageBuildOp`, `makeStampDateTimeSlotOp`, `makeClearDateOnMoveOutOp`. Parameterize: all `uid()` calls stay inline; field IDs (`dateFieldId`,`dueFieldId`,`timeslotFieldId`) become params; `centerHubId` → `hubPanelModuleId` param (Stamp op `triggerObjects[].targetId`); `panelOccIds.hub` reference in `Day Page: Build`'s ADD_CHILD → `hubPanelOccIdVar` param (a pipeline var name string the caller sets earlier in its own pipeline, OR a literal occ id — keep the same `parentId:` shape createTestGrid uses). Return the object literal (omit the trailing `.save()`).

Preserve all inline comments (they encode the $schedDate chain, COPY_LINK migration, tail RUN_OPERATION rationale).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ./server run test -- liveSystemBuilders`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/utils/liveSystemBuilders.js server/__tests__/liveSystemBuilders.test.js
git commit -m "feat: liveSystemBuilders schedule + day-page op factories"
```

---

### Task 4: liveSystemBuilders — generalized makeTrackerOp

**Files:**
- Modify: `server/utils/liveSystemBuilders.js`
- Test: `server/__tests__/liveSystemBuilders.test.js`

Generalize `createTestGrid.js`'s `Tracker: Water Today` (804–950) and `Tracker: Tasks Completed Today` (952–1085) into one factory. Keep their exact pipeline skeleton: INIT_VAR acc → FIND scope page → FIND goal item by label → `$goalDate` chain → trigger/date-gate `if` → loop `$allItems` with rule list → UPDATE `$goalItem.fields.<goalFieldId>.value`.

- [ ] **Step 1: Write the failing test**

```js
// append to liveSystemBuilders.test.js
import { makeTrackerOp } from "../utils/liveSystemBuilders.js";

describe("makeTrackerOp", () => {
  const base = { userId: "u", gridId: "g", dateFieldId: "DF", completedFieldId: "CF" };
  it("sum: scopes to Schedule, finds goal by label, ADD_TO_VARs the source field, UPDATEs goal field", () => {
    const op = makeTrackerOp({ ...base, name: "Tracker: Water Today", goalLabel: "Physical Wellness", goalFieldId: "TW", sourceFieldId: "WF", agg: "sum", timeFilter: "daily" });
    const s = JSON.stringify(op.pipeline);
    expect(op.name).toBe("Tracker: Water Today");
    expect(s).toContain("\"right\":\"Physical Wellness\"");
    expect(s).toContain("ADD_TO_VAR");
    expect(s).toContain("$goalItem.fields.TW.value");
    expect(s).toContain("$goalItem._effectiveFilter.DF");
  });
  it("countTrue: increments by 1 on completed items, no source field needed", () => {
    const op = makeTrackerOp({ ...base, name: "Tracker: Done", goalLabel: "Task Progress", goalFieldId: "TC", agg: "countTrue", timeFilter: "daily" });
    expect(JSON.stringify(op.pipeline)).toContain("INCREMENT_VAR");
  });
  it("all timeFilter: omits the $goalDate SAME_DAY gate", () => {
    const op = makeTrackerOp({ ...base, name: "Tracker: Lifetime", goalLabel: "Bank", goalFieldId: "B", sourceFieldId: "AMT", agg: "sum", timeFilter: "all", scopeLabel: "Accounts" });
    const s = JSON.stringify(op.pipeline);
    expect(s).toContain("\"right\":\"Accounts\"");
    expect(s).not.toContain("SAME_DAY");
  });
  it("multiSum: sums each of sourceFieldIds", () => {
    const op = makeTrackerOp({ ...base, name: "Tracker: Reps", goalLabel: "Fitness", goalFieldId: "TR", sourceFieldIds: ["S1", "S2", "S3"], agg: "multiSum", timeFilter: "daily" });
    const s = JSON.stringify(op.pipeline);
    expect(s).toContain("S1"); expect(s).toContain("S2"); expect(s).toContain("S3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ./server run test -- liveSystemBuilders`
Expected: FAIL — `makeTrackerOp` not exported.

- [ ] **Step 3: Implement makeTrackerOp**

Build the factory by templating the two createTestGrid trackers. Rules:
- Params: `{ userId, gridId, name, goalLabel, goalFieldId, dateFieldId, completedFieldId, sourceFieldId, sourceFieldIds, agg, flow="any", timeFilter="daily", scopeLabel="Schedule", description }`.
- Steps 1–4 identical to the createTestGrid trackers (INIT_VAR `$acc`=0; FIND `$allPages label IS <scopeLabel>` → `$scopePageId`; FIND `$allInstances label IS <goalLabel>` → `$goalId`/`$goalItem`).
- `$goalDate` chain (`$goalItem._effectiveFilter.<dateFieldId>` → `$trigger.date` → `$today`) emitted **only when `timeFilter !== "all"`**.
- Trigger/date-gate `if`: copy the OR block; for `timeFilter:"all"` drop the per-event `fields.<dateFieldId> SAME_DAY $goalDate` sub-rules (keep onLoad/NavigationOp/event-type rules).
- Loop `$allItems` inner `if` rule list, assembled in order:
  - if `agg === "countTrue"` OR `completedGated` (default true for sum/count/countTrue): `$item.fields.<completedFieldId>.value IS true`
  - if `timeFilter === "daily"`: `$item.fields.<dateFieldId>.value SAME_DAY $goalDate`; if `"weekly"`: `$item.fields.<dateFieldId>.value SAME_WEEK $goalDate` (comparator already used elsewhere — verify in operationExecutor; if absent use the daily gate and document); if `"all"`: omit date rule
  - scope: `$item._ancestors HAS_ANCESTOR $scopePageId`
  - flow: if `flow === "in"` add `$item.fields.<src>.flow IS in`; if `"out"` add `... IS out`
- Accumulator inside the `then`:
  - `sum`: `ADD_TO_VAR $acc expr $item.fields.<sourceFieldId>.value`
  - `multiSum`: one `ADD_TO_VAR` per `sourceFieldIds[]`
  - `count` / `countTrue`: `INCREMENT_VAR $acc by 1`
  - `last`: `SET_VAR $acc expr $item.fields.<sourceFieldId>.value`
  - `net`: two loops — first adds income field, second subtracts (`ADD_TO_VAR` with negated expr) the spent field; params `incomeFieldId`,`spentFieldId`
  - `completionRate`: count completed into `$done`, total into `$tot`, then `MULTIPLY_VAR $done 100` + `DIV_VAR $done $tot` → `$acc`
- Final: `UPDATE path $goalItem.fields.<goalFieldId>.value value $acc`.
- `triggerTypes`/`triggerObjects`: copy from the createTestGrid trackers (priority 3; onChange field targets = `completedFieldId` always + `sourceFieldId` when sum/last; onAdd/onDelete container; onFilterChange filterNav ancestorLabel "Daily Goals"; onLoad grid).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ./server run test -- liveSystemBuilders`
Expected: PASS (all makeTrackerOp cases).

- [ ] **Step 5: Commit**

```bash
git add server/utils/liveSystemBuilders.js server/__tests__/liveSystemBuilders.test.js
git commit -m "feat: generalized makeTrackerOp builder"
```

---

### Task 5: Refactor createTestGrid.js onto shared builders (behavior-preserving)

**Files:**
- Modify: `server/scripts/createTestGrid.js` (STEP 1 grid, STEP 7b templates, STEP 12 ops)

- [ ] **Step 1: Replace STEP 1 grid construction**

In `createTestGrid.js`, import `{ buildGridDoc, buildScheduleFilters }` from `../utils/liveSystemBuilders.js`. Replace the `new Grid({...})` literal (lines ~156–171) with `new Grid(buildGridDoc({ userId, gridName, manifestId, dateFieldId }))`. Replace the inline schedule `filters:[...]` (lines ~694–725) with `buildScheduleFilters({ schedFilterId, timeslotFilterId, dateFieldId, timeslotFieldId, timeslotLabels })`.

- [ ] **Step 2: Replace STEP 7b with builder calls**

Replace lines ~487–662 with: `const { tplManifestRootFolderId } = await buildTemplatesManifest({ userId, gridId, Folder, Manifest });` then `await buildDailyRoutineTemplate({ userId, gridId, timeSlots, timeslotFieldId, routineBySlot, tplManifestRootFolderId, mkOcc, Module, findModule: (q) => Module.findOne(q).lean() });` (keep the existing `routineBySlot` object literal in createTestGrid as the caller-supplied arg) and `await buildDayPageTemplate({ userId, gridId, tplManifestRootFolderId, mkOcc, Module });`.

- [ ] **Step 3: Replace STEP 12 op literals with factory calls**

Replace the four `new Operation({...}).save()` blocks with `await new Operation(makeScheduleBuildDayOp({ userId, gridId, dateFieldId, dueFieldId, timeslotFieldId })).save();` etc. Replace `Tracker: Water Today` with `await new Operation(makeTrackerOp({ userId, gridId, name:"Tracker: Water Today", goalLabel:"Physical Wellness", goalFieldId:totalWaterFieldId, sourceFieldId:waterFieldId, completedFieldId, dateFieldId, agg:"sum", timeFilter:"daily" })).save();` and `Tracker: Tasks Completed Today` with `makeTrackerOp({ ..., goalLabel:"Task Progress", goalFieldId:totalTasksCompletedFieldId, completedFieldId, dateFieldId, agg:"countTrue", timeFilter:"daily" })`.

- [ ] **Step 4: Suites green**

Run: `npm --prefix ./server run test` then `npm test`
Expected: same pass counts as Task 0 baseline.

- [ ] **Step 5: Structural parity check**

Run: `cd server && node --env-file=.env scripts/createTestGrid.js | tee /tmp/ctg-after.txt && diff <(grep -o 'gridId.*\|panelOccIds.*\|Operation' /tmp/ctg-before.txt) <(grep -o 'gridId.*\|panelOccIds.*\|Operation' /tmp/ctg-after.txt)`
Expected: no meaningful diff (IDs differ per run; structure/op count identical). If regression: `cp server/scripts/createTestGrid.backup.js server/scripts/createTestGrid.js` and re-diagnose.

- [ ] **Step 6: Commit**

```bash
git add server/scripts/createTestGrid.js
git commit -m "refactor: createTestGrid consumes liveSystemBuilders (behavior-preserving)"
```

---

## Part 2 — createLiveData.js

### Task 6: createLiveData scaffold (additive, grid + filters)

**Files:**
- Create: `server/scripts/createLiveData.js`
- Modify: `package.json` (add `seed:live` script)

- [ ] **Step 1: Write the scaffold**

Model the top of `createTestGrid.js` (imports, `DEFAULT_USER_EMAIL`, `dropExistingTestGrid` → `dropExistingLiveGrid` keyed on `gridName="Live Grid"`, `main()`/`isDirectRun`). Export `createLiveData(userId, options)`. STEP 1: pre-generate the schedule control field ids (`dateFieldId,timeslotFieldId,dueFieldId,completedFieldId`), `const grid = new Grid(buildGridDoc({ userId, gridName, manifestId, dateFieldId }))`. Use `generateTimeSlots()` for `timeSlots`/`timeslotLabels`. Define the shared `mkOcc` helper (copy from createTestGrid lines 362–367).

- [ ] **Step 2: Add npm script**

In root `package.json` scripts add: `"seed:live": "TMPDIR=$HOME/tmp node server/scripts/createLiveData.js"`.

- [ ] **Step 3: Smoke run (must not throw, must be additive)**

Run: `cd server && node --env-file=.env scripts/createLiveData.js`
Expected: completes; a grid named "Live Grid" exists; existing grids untouched (script never deletes other grids — `dropExistingLiveGrid` only removes a prior "Live Grid").

- [ ] **Step 4: Commit**

```bash
git add server/scripts/createLiveData.js package.json
git commit -m "feat: createLiveData scaffold (additive Live Grid + filters)"
```

---

### Task 7: Port fields

**Files:**
- Modify: `server/scripts/createLiveData.js`

Source: `createDefaultUserData.js` STEP 1 (lines ~152–912, all `Field` definitions) + STEP 1b list (938–991) for which display fields are aggregation targets.

- [ ] **Step 1: Port the field set with transforms**

Add a STEP 2 that `Field.insertMany([...])` with: every field from createDefaultUserData STEP 1 **except** fields used only by journal/Q&A/enrichment (`journalQuestion`, `journalAnswer`, any `*QPool` question fields, enrichment-only fields — identify by their exclusive use in `wentWellQInstances/improvedQInstances/gratitudeQInstances/enrichmentInstances/journalDocInstances`). For every field with `type:"select"` whose `meta.sourceType === "pool"` (pool-backed), rewrite to `type:"text"` and drop `meta.sourceType/poolContainerId`. Add the schedule control fields `date,timeslot,due,completed` (copy shapes from createTestGrid STEP 2 lines 177–185) if not already present.

- [ ] **Step 2: Run**

Run: `cd server && node --env-file=.env scripts/createLiveData.js`
Expected: completes; no Mongoose enum error (all `type` values valid; `text` is valid).

- [ ] **Step 3: Commit**

```bash
git add server/scripts/createLiveData.js
git commit -m "feat: createLiveData field port (pool selects -> text, journal/QA excluded)"
```

---

### Task 8: Port instance + container modules

**Files:**
- Modify: `server/scripts/createLiveData.js`

Source: createDefaultUserData STEP 2 instances (1036–1485), workouts (1380–1432), nutrition (1434–1483), todo (1484–1609), planning (1610–1657), goals (1658–1725), accounts (1726–1793); containers `toolkitContainers` (2039–2077), `todoContainers` (2078–2087), `goalContainers` (2099–2113), `accountContainers` (2114–2121).

- [ ] **Step 1: Port instance modules**

STEP 3: `Module.insertMany` for toolkit + workout + nutrition + todo + planning + goal-display + account instance modules. Drop `category` hidden-field injection only if that field was excluded; otherwise keep. **Exclude** all journal/Q&A/enrichment/pool-library instances (`*PoolInstances`, `wentWellQInstances`, etc.). Schedulable toolkit instances that can land in a slot must bind `dateFieldId` hidden (createTestGrid convention, lines 199–212) — apply to the 6 Daily-Routine source modules at minimum (Drink Water, Take Vitamins, Morning Run, Scrambled Eggs + Veg, Greek Salad + Chicken, Read a chapter).

- [ ] **Step 2: Port container modules (NO schedule slots)**

STEP 4: `Module.insertMany` toolkit/todo/goal/account containers with their `ownStyle`/`styleMode`. Do **not** create the 48 slot containers or the seed `scheduleContainers` — those exist only inside the Daily Routine template (Task 10).

- [ ] **Step 3: Run**

Run: `cd server && node --env-file=.env scripts/createLiveData.js`
Expected: completes; no slot containers created at grid scope (only template-scoped later).

- [ ] **Step 4: Commit**

```bash
git add server/scripts/createLiveData.js
git commit -m "feat: createLiveData instance + container module port (no slots)"
```

---

### Task 9: Port occurrences + manifest folder tree

**Files:**
- Modify: `server/scripts/createLiveData.js`

Source: createDefaultUserData STEP 0b/folders (102–149), occurrence wiring (~2370–end). Folder tree target (createTestGrid-style organized root): Root → Tasks, Trackers, Interfaces, Notes, Day Pages.

- [ ] **Step 1: Build manifest + folders**

STEP 7: create `Manifest` (user) + `Folder` tree (Root + Tasks/Trackers/Interfaces/Notes/Day Pages), deterministic ids via `uid()`. Day Pages folder `folderType:"day-pages"`.

- [ ] **Step 2: Create instance + container occurrences**

STEP 6: for each container, `mkOcc` its occurrence with `occurrences:[childOccIds]`; create child instance occurrences with `parentId = containerOccId` and any seed `fields` (port the seed's pre-filled values, e.g. a pre-completed toolkit item). Toolkit/Todo containers get `filterOverride:{}` (date-scope opt-out, like createTestGrid Physical/General).

- [ ] **Step 3: Run + assert structure**

Run: `cd server && node --env-file=.env scripts/createLiveData.js`
Expected: completes; container occurrences have non-empty `occurrences[]`.

- [ ] **Step 4: Commit**

```bash
git add server/scripts/createLiveData.js
git commit -m "feat: createLiveData occurrences + manifest folder tree"
```

---

### Task 10: Templates (Daily Routine retargeted + Day Page)

**Files:**
- Modify: `server/scripts/createLiveData.js`

- [ ] **Step 1: Wire the template builders**

STEP 7b: `const { tplManifestRootFolderId } = await buildTemplatesManifest({ userId, gridId, Folder, Manifest });`. Define `routineBySlot` with the approved 6 picks bound to the **seed module ids** created in Task 8:

```js
const routineBySlot = {
  "6:00am": [
    { sourceModId: drinkWaterModId, label: "Drink Water" },
    { sourceModId: takeVitaminsModId, label: "Take Vitamins" },
  ],
  "7:00am": [{ sourceModId: morningRunModId, label: "Morning Run" }],
  "8:00am": [{ sourceModId: scrambledEggsModId, label: "Scrambled Eggs + Veg" }],
  "12:00pm": [{ sourceModId: greekSaladChickenModId, label: "Greek Salad + Chicken" }],
  "6:00pm": [{ sourceModId: readChapterModId, label: "Read a chapter" }],
};
await buildDailyRoutineTemplate({ userId, gridId, timeSlots, timeslotFieldId, routineBySlot, tplManifestRootFolderId, mkOcc, Module, findModule: q => Module.findOne(q).lean() });
await buildDayPageTemplate({ userId, gridId, tplManifestRootFolderId, mkOcc, Module });
```

(Use the actual variable names assigned in Task 8 for those six module ids.)

- [ ] **Step 2: Run + assert**

Run: `cd server && node --env-file=.env scripts/createLiveData.js`
Expected: completes; a `meta.templateName: "Daily Routine"` occ and a `"Day Page"` occ exist under the Templates manifest root folder.

- [ ] **Step 3: Commit**

```bash
git add server/scripts/createLiveData.js
git commit -m "feat: createLiveData templates (Daily Routine 6-pick + Day Page)"
```

---

### Task 11: Notebook docs parsed to DB textmaps

**Files:**
- Modify: `server/scripts/createLiveData.js`

Source: createDefaultUserData lines 1794–1830 (`parseSectionsWithInstances` calls for morenotes/gospelofthomasnotes/philosopherstone, `_flatNotesDefs`, comparitive_religion, gospelthomas) and the notebook container/textmap wiring.

- [ ] **Step 1: Port the md-parse → page/textmap path (DB only)**

STEP 7c: reuse `parseSections`/`parseSectionsWithInstances` from `mdParsers.js` to build doc page modules + occurrences whose `textmap` holds the parsed TipTap JSON. Parent these page occurrences into the **Notes** folder (`parentId = notesFolderId`, `sortOrder` incrementing). Do **not** write `uploads/md/{occId}.md` and do **not** create the `uploads/md` dir (omit createDefaultUserData's fs calls entirely).

- [ ] **Step 2: Run + assert no fs writes**

Run: `cd server && ls -la uploads/md 2>/dev/null | wc -l; node --env-file=.env scripts/createLiveData.js; ls -la uploads/md 2>/dev/null | wc -l`
Expected: the `uploads/md` listing count is unchanged by the run (script never touches it).

- [ ] **Step 3: Commit**

```bash
git add server/scripts/createLiveData.js
git commit -m "feat: createLiveData notebook docs parsed into DB textmaps (no md sync)"
```

---

### Task 12: Page modules, panels, wiring

**Files:**
- Modify: `server/scripts/createLiveData.js`

Layout (spec §6): [0,0] Daily Toolkit, [1,0] Todo List, [0,1 h=2] Notebook hub, [0,2] Daily Goals, [1,2] Accounts.

- [ ] **Step 1: Page modules + page occurrences**

STEP 8: create page modules/occurrences for Daily Toolkit, Todo List, Daily Goals, Accounts, Schedule, Canvas (`role:"page"`, kinds board/board/board/board/board/canvas). Schedule page occ gets `filters: buildScheduleFilters(...)` + `parentId=interfacesFolderId`. Daily Goals page = `parentId=trackersFolderId`. Every page **except Schedule and Daily Goals** gets `filterOverride:{}` + `filterNavConfig:{ filter_daily:{ visible:false } }` (createTestGrid date-scope rule). Canvas page also gets `filterOverride:{}` + the nav-hide. Notebook doc pages already created in Task 11 (Notes folder, not pinned).

- [ ] **Step 2: Panel modules + placements + wiring**

STEP 9–10: 5 panel modules; placements per layout above; Notebook hub panel occ gets `viewId` → a `View{ viewType:"board", activeOccurrenceId: schedPageOccId }`. Wire `panelOccIds.notebook.occurrences = [schedPageOccId, canvasPageOccId]` (Day Page tab is added at runtime by `Day Page: Build`'s ADD_CHILD — do not pin it statically). Toolkit/Todo/Goals/Accounts panels each pin their single page.

- [ ] **Step 3: Run + assert layout**

Run: `cd server && node --env-file=.env scripts/createLiveData.js`
Expected: completes; returned `panelOccIds` has keys toolkit/todo/notebook/goals/accounts; Notebook View.activeOccurrenceId = schedule page.

- [ ] **Step 4: Commit**

```bash
git add server/scripts/createLiveData.js
git commit -m "feat: createLiveData pages + panels (Notebook hub: Schedule+Canvas)"
```

---

### Task 13: Operations — schedule/day-page + converted trackers

**Files:**
- Modify: `server/scripts/createLiveData.js`

- [ ] **Step 1: Wire shared schedule/day-page ops**

STEP 12: `await new Operation(makeScheduleBuildDayOp({ userId, gridId, dateFieldId, dueFieldId, timeslotFieldId })).save();` plus `makeDayPageBuildOp` (pass the Notebook hub panel occ id for its ADD_CHILD target), `makeStampDateTimeSlotOp({ ..., hubPanelModuleId: notebookPanelModuleId })`, `makeClearDateOnMoveOutOp({ ..., dateFieldId, timeslotFieldId })`.

- [ ] **Step 2: Convert every old aggregation via makeTrackerOp**

For each entry in createDefaultUserData STEP 1b (lines 938–991), emit one `new Operation(makeTrackerOp({...})).save()`. Mapping (goalLabel = the goal/account display instance's label that carries the target display field binding; read it from the seed `goalInstances`/`accountInstances` defs):

| Old op | makeTrackerOp args |
|---|---|
| Completed Today | agg countTrue, goalFieldId totalCompleted, timeFilter daily |
| Task Count Today | agg count, goalFieldId taskCount, daily |
| Latest Mood | agg last, sourceFieldId mood, goalFieldId lastMood, daily |
| Steps Today | agg sum, sourceFieldId steps, goalFieldId totalSteps, daily |
| Water Today | agg sum, sourceFieldId water, goalFieldId totalWater, daily |
| Time Spent Today | agg sum, sourceFieldId duration, goalFieldId totalDuration, daily |
| Pages Today | agg sum, sourceFieldId pages, goalFieldId totalPages, daily |
| Spent Today | agg sum, sourceFieldId amount, flow out, goalFieldId totalSpent, daily |
| Earned Today | agg sum, sourceFieldId income, flow in, goalFieldId totalIncome, daily |
| Calories/Protein/Carbs/Fats Today | agg sum, respective source+goal fields, daily |
| Total Reps Today | agg multiSum, sourceFieldIds [set1Reps,set2Reps,set3Reps], goalFieldId totalRepsToday, daily |
| Mom's Account Balance | agg sum, sourceFieldId amount, goalFieldId momsAccountBalance, timeFilter all, scopeLabel = Mom's account container label |
| Total Workouts | agg countTrue, goalFieldId totalWorkouts, timeFilter all, scopeLabel = fitness container/account label |
| Total Reading Time | agg sum, sourceFieldId duration, goalFieldId totalReadingTime, timeFilter all |
| Time Spent This Week | agg sum, sourceFieldId duration, goalFieldId totalDuration, timeFilter weekly |
| any `makeNetBalanceOp` | agg net, incomeFieldId, spentFieldId |
| any `makeCompletionRateOp` | agg completionRate, timeFilter all |
| any `makeLiteralOp` | small inline literal op (port `makeLiteralOp` shape) |

For `scopeLabel` on lifetime/account ops: use the label of the page/container the data lives under (Accounts page or the specific account container). Daily trackers default `scopeLabel:"Schedule"`.

- [ ] **Step 3: Run + assert no legacy AGGREGATE**

Run: `cd server && node --env-file=.env scripts/createLiveData.js`
Then in a node one-liner against the DB (or add to the script's summary): assert no `Operation` for this grid has a step with `config.type === "AGGREGATE"`.
Expected: 0 legacy AGGREGATE ops; every goal/account display field has a backing tracker op.

- [ ] **Step 4: Commit**

```bash
git add server/scripts/createLiveData.js
git commit -m "feat: createLiveData ops (shared schedule/daypage + converted trackers)"
```

---

### Task 14: End-to-end verification + server test

**Files:**
- Create: `server/__tests__/createLiveData.test.js`

- [ ] **Step 1: Write the assertion test**

```js
// server/__tests__/createLiveData.test.js
import { describe, it, expect, vi } from "vitest";
// Mock the Mongoose models OR run against a test DB per existing createDefaultUserData.test.js pattern.
// Mirror server/__tests__/createDefaultUserData.test.js setup.
describe("createLiveData", () => {
  it("produces a Live Grid with no legacy AGGREGATE ops, no slot containers at grid scope, Notebook hub = Schedule+Canvas", async () => {
    // ... follow createDefaultUserData.test.js harness; assert:
    //  - grid.name === "Live Grid"
    //  - every Operation.pipeline.steps deep-scan: no config.type === "AGGREGATE"
    //  - zero Module role:"container" with meta.scheduleSlot:true at grid scope
    //    (slot modules only exist with meta.templateModule:true)
    //  - the notebook panel View.activeOccurrenceId resolves to the Schedule page
    //  - a meta.templateName "Daily Routine" and "Day Page" occ exist
  });
});
```

Follow the existing `server/__tests__/createDefaultUserData.test.js` harness exactly (same DB/mock strategy) so it runs in the server suite.

- [ ] **Step 2: Run the new test**

Run: `npm --prefix ./server run test -- createLiveData`
Expected: PASS.

- [ ] **Step 3: Full suites green**

Run: `npm --prefix ./server run test` then `npm test`
Expected: both green; client still ≈572.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run `npm run dev`, open the Live Grid, verify: Schedule builds on date nav, completing a Schedule task ticks the matching Daily Goal, Day Page tab appears in the Notebook panel on date nav, notebook docs appear in the Notes folder of the root tree (not pinned), Canvas tab present in Notebook panel. If you cannot test the UI, state so explicitly.

- [ ] **Step 5: Commit**

```bash
git add server/__tests__/createLiveData.test.js
git commit -m "test: createLiveData structural assertions"
```

---

## Self-Review Notes

- **Spec coverage:** §3 shared lib → Tasks 1–4; §3 backup + §9 → Task 0/Task 5 Step 5; §4 makeTrackerOp + mapping → Task 4 + Task 13; §5 steps → Tasks 6–13; §6 panel layout → Task 12; §7 exclusions → Tasks 7/8/11; §9 verification → Tasks 0,5,14.
- **`SAME_WEEK` comparator risk:** Task 4 Step 3 notes weekly may need verification against `client/src/helpers/operationExecutor.js`; if the comparator name differs, match the executor and update the one weekly op (Time Spent This Week) — do not invent a comparator.
- **goalLabel resolution:** Task 13 depends on the seed goal/account instance labels; the implementer must read the actual labels from `createDefaultUserData.js` `goalInstances`/`accountInstances` (not guess) — surfaced in Task 13 Step 2.
