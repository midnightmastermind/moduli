# Plan — a mirror of the live grid, for rehearsing against real data

**User, 2026-08-23:** *"does one of the disposable grids have my live data on it,
we should have one that mirrors my live data so we can test stuff on that if we
arent already"* — then *"make that a plan after"*.

**Not built. This is the plan.** A draft of the script sits beside this file as
`2026-08-23-mirror-grid.draft.sh`; it is unrun and deliberately not wired into
`package.json`, because an npm script nobody has executed is the inert-token
class this repo keeps removing.

## The gap, measured

```
poms grid     occ 5,215  mod 4,820   the live data
test grid 1   occ   859              a FROZEN ARCHIVE of the OLD grid, pre-July rebuild
test grid 2   occ 3,054              the seed's target — poms's lineage, none of its content
```

Nothing mirrors the live data. `test grid 2` shares the seed and all 68
operations, so rehearsing there catches **shape** errors; it has none of the
user's content, so it cannot catch **data** errors. Concretely, it would not have
caught any of these, all of which bit this month:

- two modules both labelled `Workout Log`, so a lookup by label read the wrong one
- five duplicate field names, so a lookup by name picked whichever Mongo returned
- 424 stored colours, which is what made the Stardew remap collapse a family
- a Schedule page whose `occurrences[]` had been emptied

## Why a scratch DATABASE, not a second grid

A mirror inside the same database needs every id remapped: `parentId`,
`occurrences[]`, textmap embeds, ops' picker-direct `$allItemsById.<id>`, field
values holding occurrence ids, feed `scope`, `View.activeOccurrenceId`, folder
parentage. That is precisely why `restoreGrid.js` restores **verbatim** — and a
remap that misses one path produces a mirror that LIES, which is worse than no
mirror at all.

Verbatim ids collide with nothing in a database of their own.

## What to build

1. `npm run mirror:poms` — backup `poms grid`, restore into `moduli_mirror`
   with `--into-db`, then `--verify`.
2. **Verify by CONTENT HASH, not counts.** A restore that dropped one field from
   every document matches on counts and differs on hashes; `restoreGrid.js`
   already compares hashes, so the wrapper must not settle for less.
3. `npm run mirror:poms -- --drop` for cleanup.
4. A line in `docs/backup-restore.md` pointing at it.

## Open question for whoever builds it

**Looking at the mirror needs a server pointed at that database**
(`MONGO_URI=<cluster>/moduli_mirror npm run dev`). That is fine for rehearsing a
migration, which is the stated purpose, but it is NOT "a grid I can switch to in
the picker". If that is what is wanted, this plan is the wrong one and the
id-remapping pass is the right one — it should be decided before building, not
after.

## Cost

Each refresh duplicates ~5,200 occurrences and ~4,800 modules into the scratch
database. Cheap on disk, and it should be refreshed deliberately rather than on
a cron, so the mirror's age is always known.
