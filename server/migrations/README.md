# Migrations

How `poms grid` changes now that the seed can't touch it.

## The rule

**Content changes happen in the app.** Adding a task, renaming a page, checking
something off, dragging a card — that is what the application is for, and it is
already persisted. Nothing here.

**Migrations are only for structure the UI cannot express**: a new field on an
existing template, an operation whose pipeline needs correcting, a binding that
points at the wrong id. Things that used to ride along in `createLiveData.js`
and now have nowhere else to go.

If you can do it by clicking, do it by clicking.

## Writing one

`server/migrations/NNNN-kebab-name.mjs`:

```js
export const id = "0001-kebab-name";
export const describe = "One sentence. If it deletes anything, say exactly what.";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Operation } = models;
  const rows = await Occurrence.find({ gridId, /* … */ }).lean();
  log(`${rows.length} occurrence(s) to patch`);
  if (dryRun) return;
  // … writes …
}
```

Requirements, in order of how much they will hurt if ignored:

1. **Idempotent.** It may run against a grid where half of it already applied
   (an earlier run threw). Find-then-patch, never blind-append.
2. **Never delete user content without saying so in `describe`.** The runner
   prints that line before it writes; it is the last chance anyone gets to stop.
3. **Honour `dryRun`.** Do the reads, log what you would change, return before
   the writes. A migration you cannot preview is a migration nobody will run.
4. **Scope every query by `gridId`.** Never `{ userId }` — that reaches other
   grids.

## Running

```bash
# what would happen (default)
node --env-file=server/.env server/scripts/runMigrations.js --grid "poms grid"

# do it — snapshots to backups/ first, automatically
node --env-file=server/.env server/scripts/runMigrations.js --grid "poms grid" --apply
```

The runner backs the grid up before any write, with no flag needed to get that
behaviour, and records applied ids in `grid.meta.migrations[]` so each runs
exactly once. If one throws, the batch stops and it prints the snapshot path.

Rehearse against `test grid 2` first — it is disposable and the seed rebuilds it.
