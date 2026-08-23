#!/usr/bin/env bash
# server/scripts/mirrorGrid.sh
#
# A MIRROR of the live grid, for rehearsing against real data.
#
# User, 2026-08-23: *"we should have one that mirrors my live data so we can
# test stuff on that if we arent already"* — and we were not. `test grid 1` is a
# frozen archive of the OLD grid (859 occurrences, pre-July rebuild) and
# `test grid 2` is the seed's target: the same lineage as poms grid but none of
# its content. Rehearsing there catches SHAPE errors and not DATA errors — it
# would not have caught the two modules both labelled "Workout Log", or the
# duplicate field names.
#
# WHY A SCRATCH DATABASE AND NOT A SECOND GRID. A mirror inside the same
# database would need every id remapped — parentId, occurrences[], textmap
# embeds, ops' picker-direct `$allItemsById.<id>`, field values holding
# occurrence ids, feed scopes, view activeOccurrenceId, folder parentage. That
# is exactly why `restoreGrid.js` restores VERBATIM. A remap that misses one
# path produces a mirror that lies, which is worse than no mirror.
#
# Verbatim ids collide with nothing in a database of their own.
#
# Usage:
#   npm run mirror:poms              refresh the mirror and verify it
#   npm run mirror:poms -- --drop    delete the mirror database
#
# To LOOK at it, point a local server at the mirror:
#   MONGO_URI="<cluster>/moduli_mirror" npm run dev
set -e
cd "$(dirname "$0")/../.."

DB="${MIRROR_DB:-moduli_mirror}"
NODE=(node --env-file=./server/.env)

if [ "$1" = "--drop" ]; then
  "${NODE[@]}" server/scripts/restoreGrid.js --from /dev/null --into-db "$DB" --drop-db --apply
  echo "🗑️  mirror database $DB dropped"
  exit 0
fi

echo "📦 backing up poms grid…"
OUT=$("${NODE[@]}" server/scripts/backupGrid.js --grid "poms grid")
echo "$OUT"
DIR=$(printf '%s\n' "$OUT" | grep -oE '/[^ ]*backups/poms-grid/[^ ]+' | tail -1)
[ -n "$DIR" ] || { echo "❌ could not find the backup directory in the output" >&2; exit 1; }

echo "🪞 restoring into $DB (verbatim ids)…"
"${NODE[@]}" server/scripts/restoreGrid.js --from "$DIR" --into-db "$DB" --apply

# The verify compares CONTENT HASHES, not counts — a restore that dropped a
# field on every document would match on counts and differ on hashes.
echo "🔍 verifying…"
"${NODE[@]}" server/scripts/restoreGrid.js --from "$DIR" --into-db "$DB" --verify
echo "✅ mirror ready: $DB (from $DIR)"
