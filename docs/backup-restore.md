# Backing up and restoring a grid

`poms grid` is permanent live data. Dev and prod share one Atlas database, so a
local mistake is a production incident — these are the tools that make that
survivable.

## Quick reference

```bash
npm run backup:poms                  # snapshot the live grid
npm run backup:list                  # what snapshots exist
npm run backup:grid -- --all         # every grid
npm run migrate:poms                 # pending migrations (dry run)
npm run migrate:poms -- --apply      # …apply them (snapshots first)
```

Snapshots land in `backups/<slug>/<timestamp>[_label]/` and are gitignored —
they hold live user data and must never enter the repo.

## Scheduled

A cron entry on the droplet runs `server/scripts/backupCron.sh` at **04:17
daily**, snapshotting `poms grid` and `test grid 1` and keeping the newest **14**
unlabelled snapshots per grid. Labelled ones (`pre-freeze`, `pre-migration-…`)
are never pruned — the point of deliberately capturing a moment is that it is
still there later.

```bash
ssh deploy@viafluere.com "crontab -l"                        # confirm it's installed
ssh deploy@viafluere.com "tail -20 /var/www/moduli/backups/cron.log"   # last runs
ssh deploy@viafluere.com "du -sh /var/www/moduli/backups"    # disk
```

Roughly 3.5 MB per grid per night → ~1 GB/year at 14-day retention, against 71 GB
free. Not a concern; check it once a quarter anyway.

## Restoring

**The restore is verbatim** — same grid id, same document ids. `Occurrence.id`
is a globally unique index and ids are woven through `parentId`,
`occurrences[]`, `viewId`, textmap embeds and operation pipelines, so remapping
them on restore would mean rewriting every one of those references. A
half-correct remap would give false confidence in the tool whose entire job is
to be trustworthy. Verbatim also matches the real disaster case: the grid is
gone, put it back exactly as it was.

Consequently the restore **refuses to run over a grid that still exists**. To
rehearse without touching live data, restore into a scratch *database*, where
verbatim ids collide with nothing.

### The drill (run it after any change to these scripts)

```bash
D=$(ls -d backups/poms-grid/* | tail -1)

# 1. dry run — see what it would write
node --env-file=server/.env server/scripts/restoreGrid.js --from "$D" --into-db moduli_restore_drill

# 2. restore into the scratch database
node --env-file=server/.env server/scripts/restoreGrid.js --from "$D" --into-db moduli_restore_drill --apply

# 3. verify — counts AND content hashes, per collection
node --env-file=server/.env server/scripts/restoreGrid.js --from "$D" --into-db moduli_restore_drill --verify

# 4. clean up
node --env-file=server/.env server/scripts/restoreGrid.js --from "$D" --into-db moduli_restore_drill --drop-db --apply
```

Step 3 must print `matches the backup exactly — counts AND content` and exit 0.
Counts alone would pass a restore that dropped every field off every
occurrence, which is exactly the failure this is here to rule out.

**Drill result, 2026-07-28** (1075-occurrence live grid):

```
   collection    backup  moduli_restore_drill  hash(backup)      hash(drill)
   ------------  ------  --------------------  ----------------  ----------------  --
   grid          1       1                     2cc86c96c88821f6  2cc86c96c88821f6  ok
   modules       1011    1011                  7d4450b363c5a618  7d4450b363c5a618  ok
   occurrences   1075    1075                  4d017f3f54c4827f  4d017f3f54c4827f  ok
   fields        161     161                   82344085714d84c9  82344085714d84c9  ok
   views         10      10                    af783a4052e6cb33  af783a4052e6cb33  ok
   manifests     2       2                     6f7f5356de7bf5b0  6f7f5356de7bf5b0  ok
   folders       36      36                    36bfd4ac15a29247  36bfd4ac15a29247  ok
   operations    68      68                    8470fc42d34ce4c4  8470fc42d34ce4c4  ok
   transactions  181     181                   782a2a38bc1fa048  782a2a38bc1fa048  ok
```

### For real (the grid is actually gone)

```bash
node --env-file=server/.env server/scripts/restoreGrid.js --from "$D" --apply
node --env-file=server/.env server/scripts/restoreGrid.js --from "$D" --verify
```

This was not hypothetical: on 2026-07-28 a destructive check run against the
live database dropped `poms grid`, and these two commands brought it back
byte-identical. That is the entire justification for building the backup before
anything else.

### Replacing a grid that still exists

Only when you mean it:

```bash
node --env-file=server/.env server/scripts/restoreGrid.js --from "$D" \
  --apply --overwrite --yes-overwrite-live
```

Both flags are required; the first alone is refused.

## What the tools refuse

Each verified by exit code (not through a pipe — that masking shipped a stale
deploy once already):

| Attempt | Result |
|---|---|
| Restore over a grid that still exists | refused, exit 1 |
| `--overwrite` without `--yes-overwrite-live` | refused, exit 1 |
| `--drop-db` without `--into-db` | refused, exit 1 |
| A backup whose file is shorter than its manifest claims | refused **before** any live delete, exit 1 |
| A backup that wrote zero rows to a non-optional collection | throws at backup time, not at restore time |
| Deleting or reseeding a protected grid | refused (`utils/protectedGrids.js`) |

## Related

- `server/migrations/README.md` — how the live grid changes now
- `docs/superpowers/plans/2026-07-28-poms-grid-live-data-freeze.md` — the plan
  and the full threat model
