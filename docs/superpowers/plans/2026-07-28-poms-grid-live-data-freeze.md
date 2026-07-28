# Poms Grid → Absolute Live Data (freeze + protect + migrate)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `poms grid` becomes permanent live data — created from the seed exactly ONE more time, then never written by `createLiveData.js` again. From that moment, every change to it lives in the data itself (the app, or a reviewed migration), never in the create file.

**Naming (user, 2026-07-28):** four grids.

| Name | What it is | Seed may write it? |
|---|---|---|
| `poms grid` | **The live data.** Frozen after one final build. | **NEVER** |
| `test grid 1` | The pre-2026-07-25 live grid, already frozen | Never |
| `test grid 2` | The seed's target — overwrite freely, any time | **Yes, always** |
| `test grid 3` | The stray 1×1 grid that already exists | Never |

**Current state (verified against Atlas 2026-07-28, user `josh@jpoms.com` / `699bbdfbf62b06018225b91a`):**

| Existing name | id | Shape | Occurrences / Modules / Ops / Fields | Becomes |
|---|---|---|---|---|
| `Poms` | `6a668aedb434ccb3ac262b3e` | 2×3 mosaic, 5 panels, `meta.defaultGrid` | 1074 / 1010 / 68 / 161 | `poms grid` |
| `test grid` | `6a5e12cde72d64753a5a116b` | 2×3 mosaic, 5 panels | 859 / 803 / 72 / 130 | `test grid 1` |
| `(unnamed)` | `6a2b76b23c6b5fcb91d25d97` | 1×1, 2 panels | 3 / 2 / 0 / 0 | `test grid 3` |
| — | — | — | — | `test grid 2` (new) |

---

## The threat model — every path that can destroy `poms grid` today

Each verified by reading the code this session. **This list is the reason the plan exists**; Task ordering follows it.

1. **`dropExistingLiveGrid(userId, "Poms")`** — `createLiveData.js:88`. Deletes the grid + every scoped Occurrence / Module / Field / Manifest / View / Folder / Operation / Transaction. Runs at the top of **every default reseed**. `DEFAULT_GRID_NAME` is `"Poms"` — so today, the routine reseed command is the single most dangerous thing in the repo.
2. **`sweepStaleGrids(userId)`** — `:115`. Deletes any non-preserved grid with zero panel occurrences that is not 1×1. A `poms grid` caught mid-write (or whose panels were transiently pruned) is a legal target.
3. **`clearAllUserGrids(userId)`** (`--clear`) — `:147`. Deletes every non-preserved grid.
4. **`server/scripts/resetData.js:53`** and **`clearUserData.js:53`** — both do a bare `Grid.deleteMany({ userId })`. These respect **no** preserved list at all: they would wipe `poms grid`, `test grid 1`, and everything else. The loaded guns in the drawer.
5. **Runtime `delete_grid`** — `server/socketHandlers/crud.js:67`. Reachable from the UI (Command Center → Grid Settings → Delete) behind a single `window.confirm`. Also **orphans** all scoped docs — it deletes the Grid row only.
6. **Dev and prod share one Atlas database.** There is no environment where any of the above is a cheap mistake. A local reseed *is* a production reseed.

**No backup exists today.** `exportSeedData.js` writes `server/seed/*.json` for ALL grids at once and is the behavioural-test fixture — it is not a restore path, and running it overwrites the fixture.

---

## Global constraints

- **`poms grid` is append-only from the app's point of view.** After Task 6, no script in this repo may create, drop, or bulk-rewrite it. The only sanctioned writers are (a) the running application, (b) a reviewed migration under `server/migrations/`.
- **Every destructive script must consult ONE shared protected-grid list.** No second copy of the rule.
- **Backups before mutations.** Any migration snapshots first, automatically, with no flag needed to get that behaviour.
- **Dry-run by default.** Migrations and the restore tool print what they *would* do; `--apply` commits.
- Seed files stay exempt from the no-domain-knowledge rule (they author data).
- Server tests: `cd server && npm test`. Client: `cd client && node node_modules/.bin/vitest run`.
- Baseline before starting: 1429 client, 246 server tests passing.

---

### Task 1: Grid-scoped backup + restore (do this FIRST)

Nothing else in this plan is safe to start without a restore path.

**Files:**
- Create: `server/scripts/backupGrid.js`
- Create: `server/scripts/restoreGrid.js`
- Modify: `.gitignore` (add `/backups/`)

**Steps:**
- [ ] `backupGrid.js --grid "<name>"` writes `backups/<slug>/<ISO-timestamp>/{grid,modules,occurrences,fields,views,manifests,folders,operations}.json`, every collection scoped by that grid's `gridId` (plus the Grid row itself). Writes a `manifest.json` with counts, the source grid id, the git HEAD sha, and the wall-clock time.
- [ ] It must **fail loudly** if any collection comes back empty when the grid census says it should not — a silent empty backup is worse than none.
- [ ] `restoreGrid.js --from <dir>` reads a backup directory and restores it **into a NEW grid** by default (fresh grid id, fresh name `<name> (restored <ts>)`), so a restore can never itself be the thing that destroys live data. `--in-place` (which drops + recreates the original grid id) requires a second confirm flag.
- [ ] Both scripts print a summary table and exit non-zero on any mismatch.
- [ ] Add `npm run backup:poms` and `npm run backup:list` to the root `package.json`.
- [ ] **Verify:** take a backup of the current `Poms`, then restore it into a scratch grid and diff the census (occurrence/module/op/field counts must match exactly). Delete the scratch grid afterwards. *A backup tool that has never been restored from is a hypothesis, not a backup.*

### Task 2: One shared protected-grid list, honoured everywhere

**Files:**
- Create: `server/utils/protectedGrids.js`
- Modify: `server/scripts/createLiveData.js` (`PRESERVED_GRID_NAMES`, `dropExistingLiveGrid`, `sweepStaleGrids`, `clearAllUserGrids`)
- Modify: `server/scripts/resetData.js`, `server/scripts/clearUserData.js`
- Create: `server/__tests__/protectedGrids.test.js`

**Steps:**
- [ ] `protectedGrids.js` exports `PROTECTED_GRID_NAMES` (`poms grid`, `test grid 1`, `test grid 3`), `isProtectedGrid(name)`, and `assertNotProtected(name, action)` which THROWS with a message naming the grid and the attempted action.
- [ ] `dropExistingLiveGrid` calls `assertNotProtected(gridName, "drop")` before it queries. Today it takes the name as a parameter and trusts it — that is the hole.
- [ ] `sweepStaleGrids` and `clearAllUserGrids` filter through `isProtectedGrid`.
- [ ] `resetData.js` + `clearUserData.js`: replace `Grid.deleteMany({ userId })` with a protected-aware delete, and scope their other collection deletes so protected grids' docs survive (mirror the `clearAllUserGrids` `$nin` pattern — do **not** re-derive it).
- [ ] Tests: each of the five entry points refuses each protected name; a non-protected name still deletes; `assertNotProtected` throws rather than silently no-ops.

### Task 3: Repoint the seed at `test grid 2`

**Files:** `server/scripts/createLiveData.js`

**Steps:**
- [ ] `DEFAULT_GRID_NAME` → `"test grid 2"`.
- [ ] Grep the seed + `liveSystemBuilders.js` + `deploydata.sh` for any remaining literal `"Poms"` and repoint or delete it.
- [ ] The seed's `meta.defaultGrid` clear (`:5675`) must not touch protected grids — confirm the existing filtered `updateMany` already excludes them (it was narrowed 2026-07-25 to only grids carrying the flag; `poms grid` **does** carry it today, so this needs an explicit exclusion).
- [ ] Run a reseed. **Verify by census:** `test grid 2` is rebuilt; `poms grid` / `test grid 1` / `test grid 3` are byte-identical, `updatedAt` unmoved.

### Task 4: Protect the runtime delete path

**Files:**
- Modify: `server/socketHandlers/crud.js` (`delete_grid`)
- Modify: `client/src/ui/commandCenter/GridSettingsTab.jsx`

**Steps:**
- [ ] `delete_grid` loads the grid first and refuses when `grid.meta.protected === true` (emit `server_error` with a clear reason). Name-based checks are not enough — the user can rename.
- [ ] While in here: the handler orphans every scoped doc. Either cascade the delete or leave a `TODO` with the orphan-sweep script named. **Decide, don't drift.**
- [ ] `GridSettingsTab`: hide the Delete button for a protected grid and render "This grid is protected live data" in its place.
- [ ] Client + server tests for both.

### Task 5: Rename the existing grids

Pure `name` field updates — no data movement. Do it as one small script so it is reviewable and idempotent.

**Steps:**
- [ ] `Poms` → `poms grid`; `test grid` → `test grid 1`; `(unnamed 1×1)` → `test grid 3`.
- [ ] Re-run the census; confirm counts unchanged for all three.

### Task 6: The final build, then the freeze

> ⚠️ **This is the irreversible step.** Everything above must be green first.

**Open question for the user — answer before running (see "Decisions needed"):** does the final build start from a *fresh* seed (wiping the 1074 occurrences currently in `Poms`, including anything logged since 2026-07-25), or is the CURRENT `Poms` content already the live data we are freezing?

- [ ] Take a labelled backup: `backups/poms-grid/pre-freeze-<ts>/`.
- [ ] **If rebuilding:** run the seed once with an explicit `--grid "poms grid" --force-protected` one-shot flag (which is the ONLY thing that can bypass `assertNotProtected`, requires an interactive typed confirmation, and logs loudly).
- [ ] Verify the result in the app: 9 dimension containers, 34 board pages, trackers live, Schedule builds, zero page errors.
- [ ] Take the post-build backup.
- [ ] Stamp `grid.meta.protected = true`, `grid.meta.frozenAt = <ISO>`, `grid.meta.frozenAtCommit = <sha>`.
- [ ] **Delete the `--force-protected` flag from the codebase in the same commit.** The escape hatch exists for exactly one invocation; leaving it in the repo is leaving the safety off.

### Task 7: Migrations — how `poms grid` changes after the freeze

This is what keeps the freeze from becoming a straitjacket. Structural changes (a new field, an op fix, a binding correction) can no longer ride the seed, so they need a first-class home.

**Files:**
- Create: `server/migrations/` + `server/migrations/README.md`
- Create: `server/scripts/runMigrations.js`

**Steps:**
- [ ] Each migration is `server/migrations/NNNN-kebab-name.mjs` exporting `id`, `describe`, and `up({ gridId, models, log })`.
- [ ] The runner: resolves the target grid by name, **auto-snapshots via Task 1 before any write**, runs pending migrations in id order, records applied ids in `grid.meta.migrations[]` so each runs exactly once. Dry-run by default; `--apply` commits; any throw aborts the batch and points at the snapshot directory.
- [ ] `README.md` states the rule plainly: **content changes happen in the app; migrations are only for structure the UI cannot express.** Every migration must be idempotent and must never delete user content without an explicit inventory in its `describe`.
- [ ] Test the runner against `test grid 2` (safe target) with a trivial no-op migration, and assert the applied-list bookkeeping.

### Task 8: Ongoing safety

- [ ] Scheduled snapshot of `poms grid` (cron on the droplet), keeping the last N, with a documented retention.
- [ ] A restore drill recorded in the docs: the exact commands, run once, output pasted.
- [ ] `CLAUDE.md` handoff: the four grid names, the protected rule, and "never reseed poms grid" stated where a future session reads it first.
- [ ] **Recommendation for the user, not scheduled here:** split dev and prod databases. Every mitigation above is a guard rail on a road that should not be shared in the first place. As long as one Atlas database backs both, a local mistake is a production incident.

---

## Decisions needed from the user

1. **Fresh rebuild or freeze-in-place?** (Task 6.) A fresh seed gives a clean, fully-current structure but discards everything logged in `Poms` since 2026-07-25. Freezing the current content keeps that history but locks in whatever drift it already carries. *Recommendation: back up, rebuild fresh, and restore-forward anything specific you want to keep — but only if you have not logged much real data yet.*
2. **`test grid 2` content:** a straight seed build (same as `poms grid`'s structure), or a slimmed-down grid for testing? *Recommendation: straight seed build — it stays a faithful rehearsal of what the seed does.*
3. **`test grid 3`** (the 1×1 stray, 3 occurrences): keep as a scratch grid, or delete it? It is currently protected from the sweep only because it is 1×1.
