# createLiveData — Seed Script Design

_Date: 2026-05-16. Status: draft for review._

## 1. Goal

Produce a new seed script `server/scripts/createLiveData.js` that builds an
**additive, re-runnable "Live Grid"** combining:

- **The new-system architecture of `createTestGrid.js`** — namedFilters,
  Templates manifest (Daily Routine + Day Page), the modern pipeline
  operations (Schedule: Build Day, Day Page: Build, Stamp Date & Time Slot,
  Clear Date on Move-Out), DB-only doc storage (no `uploads/md` sync).
- **The rich content of `createDefaultUserData.js`** — the full toolkit
  (8 dimensions, 30 workouts, 25 nutrition), Todo + Planning, Daily Goals,
  Accounts, and the notebook docs parsed from repo markdown files.

Every old `makeLoop*` aggregation is **converted** to a new-system tracker
pipeline that mirrors exactly how `Tracker: Water Today` /
`Tracker: Tasks Completed Today` work in `createTestGrid.js`.

## 2. Decisions locked (from Q&A)

| Topic | Decision |
|-------|----------|
| Run mode | **Additive**, named grid `"Live Grid"`, re-runnable via `dropExistingLiveGrid()`. No user-data wipe. Targets `josh@jpoms.com` (same default as createTestGrid). |
| Architecture | **Approach B** — extract new-system builders into a shared util module; refactor `createTestGrid.js` to consume it (behavior-preserving); `createLiveData.js` consumes it + ports content. |
| Daily Routine template | 6 items from real seed modules: **6:00am** Drink Water + Take Vitamins; **7:00am** Morning Run; **8:00am** Scrambled Eggs + Veg; **12:00pm** Greek Salad + Chicken; **6:00pm** Read a chapter. |
| Pools / select inputs | Pool-backed `select` fields become plain **`type: "text"`** inputs for now (user will reintroduce pool data later). |
| Journal / Q&A / enrichment | **Excluded.** Day Page comes from the createTestGrid Day Page template + `Day Page: Build` op, not the seed journal. |
| Codex | **Excluded.** No `meta.source: "codex-import"` preservation/re-parent logic at all. |
| Schedule slots | **Not pre-seeded.** Schedule is built by `Schedule: Build Day` + the Daily Routine template (48 slot containers live in the template subtree only). |
| Historical data | **Excluded** (no 30-day backfill). |
| Doc storage | DB `Occurrence.textmap` only. No `uploads/md/` dir, no `{occId}.md` file writes. |
| Panels | Lean layout (see §8). Notebook panel hosts tabs **Schedule + Day Page + Canvas**. |
| Notes / notebook docs | **Not pinned** to any panel. Reachable only via the root manifest folder tree (root + local nav). |
| Canvas | A canvas page, pinned as a tab in the Notebook panel. |

## 3. Architecture (Approach B)

New shared module: **`server/utils/liveSystemBuilders.js`**. Pure builder
functions, all field IDs parameterized (the two scripts own different field
sets). No DB writes inside builders that *return* documents where the caller
prefers to control persistence; operation builders return an `Operation`-shaped
plain object (caller does `new Operation(obj).save()`), matching the existing
`operationBuilders.js` convention.

`createTestGrid.js` is refactored to call these builders **with identical
output** (same shapes, same IDs semantics, same comments preserved where they
encode hard-won bug context). The 572-client + server test suites are the
regression gate — see §9.

### Shared module exports

```
buildLiveGrid({ userId, gridName, dateFieldId })            -> { grid, gridId }
buildScheduleFilters({ schedFilterId, timeslotFilterId,
                       dateFieldId, timeslotFieldId, timeslotLabels }) -> filters[]
buildTemplatesManifest({ userId, gridId })                  -> { tplManifestId, tplManifestRootFolderId }
buildDailyRoutineTemplate({ userId, gridId, timeSlots,
                            timeslotFieldId, routineBySlot,
                            tplManifestRootFolderId, mkOcc }) -> tplRoutineRootOccId
buildDayPageTemplate({ userId, gridId,
                       tplManifestRootFolderId, mkOcc })     -> tplDayPageRootOccId
makeScheduleBuildDayOp({ userId, gridId, dateFieldId,
                         dueFieldId, timeslotFieldId })       -> Operation obj
makeDayPageBuildOp({ userId, gridId, dateFieldId, hubPanelOccIdVar }) -> Operation obj
makeStampDateTimeSlotOp({ userId, gridId, timeslotFieldId,
                          hubPanelModuleId })                 -> Operation obj
makeClearDateOnMoveOutOp({ userId, gridId, dateFieldId,
                           timeslotFieldId })                 -> Operation obj
makeTrackerOp({ userId, gridId, name, goalLabel,
                goalFieldId, agg, sourceFieldId|sourceFieldIds,
                completedFieldId, dateFieldId, flow,
                timeFilter, scopeLabel })                      -> Operation obj
```

`routineBySlot` and the routine instances' `sourceModId` resolution stay
caller-supplied so each script targets its own modules.

`generateTimeSlots()` already lives in `operationBuilders.js` — reuse it.
`ensureTemplatesManifest` (utils/templatesManifest.js) is request-path
oriented; the seed scripts keep their own inline manifest creation wrapped by
`buildTemplatesManifest` (deterministic IDs, no `uc` cache dependency).

## 4. `makeTrackerOp` — the generalized converter

Models the two createTestGrid trackers exactly. Pipeline shape:

1. `INIT_VAR $acc` (0)
2. `FIND $allPages label IS <scopeLabel>` → `$scopePageId` (default `"Schedule"`)
3. `FIND $allInstances label IS <goalLabel>` → `$goalId`, `$goalItem`
4. `$goalDate = $goalItem._effectiveFilter.<dateFieldId>` → fallback
   `$trigger.date` → `$today` (skipped entirely when `timeFilter: "all"`)
5. Trigger-type / date-gate `if` (OR of onLoad / NavigationOp / item-bearing
   events whose `$trigger.occurrence.fields.<dateFieldId>` matches `$goalDate`;
   for `timeFilter: "all"` the date sub-rules are dropped — always run)
6. `loop $allItems` with an `if` whose rules are assembled from:
   - completion gate: `fields.<completedFieldId>.value IS true` (when the old
     op was countTrue / a completion-scoped sum)
   - date gate: `fields.<dateFieldId>.value SAME_DAY $goalDate`
     (`daily`); week-range (`weekly`); omitted (`all`)
   - scope: `_ancestors HAS_ANCESTOR $scopePageId`
   - flow: for `flow: "in"|"out"` filter on `fields.<src>.flow`; `net` runs the
     two-loop negate-and-add pattern (`makeNetBalanceOp` semantics)
   - accumulate: `ADD_TO_VAR` (sum / multiSum across `sourceFieldIds`),
     `INCREMENT_VAR` (count / countTrue), `SET_VAR` last-write (last),
     `MULTIPLY_VAR`/`DIV_VAR` (completionRate)
7. `UPDATE $goalItem.fields.<goalFieldId>.value = $acc`

`agg` ∈ `sum | count | countTrue | last | multiSum | net | completionRate`.
Trigger surface + priorities copied from the createTestGrid trackers
(priority 3; onChange/onAdd/onDelete/onFilterChange[ancestorLabel "Daily
Goals"]/onLoad). `scopeLabel` defaults to `"Schedule"`; lifetime account
aggregations (`timeFilter: "all"`) use a broader scope label (`"Accounts"` or
the relevant account container label) — surfaced per-op in §6 mapping.

### Old → new operation mapping

Source list: `createDefaultUserData.js` STEP 1b (~lines 938–991). Each entry
becomes one `makeTrackerOp` call. Examples (full table built during impl):

| Old builder | New `makeTrackerOp` args |
|-------------|--------------------------|
| `makeLoopSumOp Water Today` | agg sum, sourceField water, completed-gated, timeFilter daily |
| `makeLoopSumOp Steps Today` | agg sum, sourceField steps, daily |
| `makeLoopSumOp Spent Today` | agg sum, flow out, daily |
| `makeLoopSumOp Earned Today` | agg sum, flow in, daily |
| `makeLoopMultiSumOp Total Reps Today` | agg multiSum, sourceFields set1/2/3Reps, daily |
| `makeLoopCountTrueOp Completed Today` | agg countTrue, daily |
| `makeLoopCountOp Task Count Today` | agg count, daily |
| `makeLoopLastOp Latest Mood` | agg last, sourceField mood, daily |
| `makeNetBalanceOp` | agg net, income+spent fields |
| `makeCompletionRateOp` | agg completionRate, timeFilter all |
| lifetime (`Mom's Account Balance`, `Total Workouts`, `Total Reading Time`) | timeFilter all, scopeLabel = account container |
| weekly variants (`Time Spent This Week`) | timeFilter weekly |

`makeLiteralOp` constants (if any remain) port as-is via a tiny
`makeLiteralOp`-style helper in the shared module.

## 5. `createLiveData.js` step structure

Mirrors createTestGrid's numbered steps:

- **STEP 1** `buildLiveGrid` (+ `buildScheduleFilters`).
- **STEP 2** Fields: port the seed field set (≈58) minus journal/Q&A/enrichment
  fields; pool-backed `select` fields rewritten to `type: "text"`. Plus the
  schedule control fields (date/timeslot/due/completed) the ops require.
- **STEP 3** Instance modules: toolkit (8 dims) + 30 workouts + 25 nutrition +
  todo + planning + goal display instances + account instances. Schedulable
  toolkit instances bind `dateFieldId` hidden (createTestGrid convention).
- **STEP 4** Container modules: toolkit/todo/goal/account containers. **No**
  48 slot containers (template-only).
- **STEP 5** Panel modules (see §8).
- **STEP 6** Instance + container occurrences (parentId = parent occurrence).
- **STEP 7** User manifest + folder tree (Root → Tasks / Trackers / Interfaces
  / Notes / Day Pages, like createTestGrid's organized root).
- **STEP 7b** `buildTemplatesManifest` + `buildDailyRoutineTemplate`
  (routine retargeted to the 6 seed picks) + `buildDayPageTemplate`.
- **STEP 7c** Notebook doc pages: parse the repo markdown files
  (morenotes/gospelofthomasnotes/philosopherstone/uses/PRAGMATIC/aispecs/
  banglespecs/comparitive_religion/gospelthomas) into `Occurrence.textmap`
  via the existing `mdParsers.js`. Pages parented into the **Notes** folder in
  the manifest tree. **No** `uploads/md` writes.
- **STEP 8** Page modules + page occurrences (Daily Toolkit / Todo / Daily
  Goals / Accounts / Schedule / Canvas + the notebook doc pages). Non-Schedule,
  non-Goals pages get `filterOverride: {}` + `filterNavConfig:
  { filter_daily: { visible: false } }` (createTestGrid date-scope rule).
- **STEP 9** Panel occurrences (grid placements).
- **STEP 10** Wire page occurrences into panel occurrences. Notebook panel
  statically pinned with `[schedPageOccId, canvasPageOccId]`; the **Day Page
  tab is added dynamically** by `Day Page: Build` (`ADD_CHILD` onto the
  Notebook panel occ as an inactive tab, then `UPDATE_VIEW` drives its
  content) — exactly the createTestGrid hub mechanism. Notebook panel's View
  `activeOccurrenceId` defaults to `schedPageOccId`.
- **STEP 11** Finalize grid.
- **STEP 12** Operations: shared `makeScheduleBuildDayOp`,
  `makeDayPageBuildOp`, `makeStampDateTimeSlotOp`,
  `makeClearDateOnMoveOutOp`, plus all converted `makeTrackerOp`s.

## 6. Panels & navigation layout

Lean — no per-cell extra panels (root + local nav replaces them):

| Cell | Panel | Pinned pages |
|------|-------|--------------|
| [0,0] | Daily Toolkit | Daily Toolkit page |
| [1,0] | Todo List | Todo List page |
| [0,1] h=2 | **Notebook** (hub) | Schedule + Canvas pinned statically; Day Page tab added by `Day Page: Build`. View.activeOccurrenceId defaults to Schedule |
| [0,2] | Daily Goals | Daily Goals page |
| [1,2] | Accounts | Accounts page |

Notebook doc pages + parsed notes are **only** in the Notes folder of the
manifest tree (not pinned). Day Page tab content is driven by the
`Day Page: Build` op's `UPDATE_VIEW` against the Notebook panel's View (same
mechanism createTestGrid uses for its hub).

## 7. Exclusions (explicit)

Codex import/preserve logic; 48 pre-seeded slot containers; 30-day historical
field data; journal containers/instances; Q&A question pools + Q&A instances;
"enrichment" instances; pool libraries as `select` sources (inputs → `text`);
`uploads/md` directory and `{occId}.md` file sync; the seed's own
`makeLoop*`/`makeAgg*` operations (converted, not copied); the seed's
journal-style Day Page (replaced by the createTestGrid Day Page template).

## 8. Risks & mitigations

- **Approach B refactor regresses the test grid.** Mitigation: the
  createTestGrid refactor is strictly behavior-preserving — extract, then
  diff the produced DB shape conceptually and run `npm test` (client, 572) +
  `npm --prefix ./server run test` (server) before/after. Keep all bug-context
  comments in the moved code.
- **`makeTrackerOp` over-generalization.** Mitigation: build it to cover
  exactly the agg kinds the seed uses (enumerated in §4) — no speculative
  modes. Validate each converted op against its old `makeLoop*` output
  semantically (same field written, same scope/date gate).
- **APPLY_TEMPLATE first-burst persistence race** (known, task #40) — out of
  scope; same behavior as createTestGrid.
- **md parsing volume** — parsed docs are larger; acceptable (DB-only,
  textmap compression already in place server-side).

## 9. Verification plan

1. `npm --prefix ./server run test` + `npm test` green **before** refactor
   (baseline).
2. Refactor createTestGrid.js onto shared builders → both suites still green;
   spot-run `node --env-file=.env scripts/createTestGrid.js` and confirm grid
   shape unchanged (panel/op/template counts).
3. Implement `createLiveData.js`; run
   `node --env-file=.env scripts/createLiveData.js`; assert: grid named
   "Live Grid", no `uploads/md` touched, no codex records created, 0 slot
   containers outside the template, Schedule builds on date nav, Daily Goals
   trackers tick when Schedule tasks complete, Day Page builds per date,
   Canvas tab present in Notebook panel, notebook docs present in Notes
   folder only.
4. Add a server test asserting `createLiveData` produces the expected
   high-level counts + that no Operation uses the legacy `AGGREGATE` action.

## 10. Out of scope / future

Pool data reintroduction (user will do separately); multi-window sync;
historical/demo backfill; test-user seeding.
