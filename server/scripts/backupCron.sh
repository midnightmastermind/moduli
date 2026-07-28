#!/bin/bash
# backupCron.sh — nightly snapshot of the protected grids on the droplet.
#
# Installed as a cron entry for the `deploy` user (see docs/backup-restore.md).
# Keeps the newest 14 unlabelled snapshots per grid; labelled ones (pre-freeze,
# pre-migration-…) are never pruned.
#
# Deliberately NOT `set -e` around the whole loop: one grid failing to back up
# must not stop the others. Each result is logged and the exit code reflects
# whether ANY grid failed, so a monitoring hook can tell.

REPO="${MODULI_REPO:-/var/www/moduli}"
NODE="${MODULI_NODE:-/usr/bin/node}"
LOG="$REPO/backups/cron.log"
KEEP="${MODULI_BACKUP_KEEP:-14}"

mkdir -p "$REPO/backups"
echo "=== $(date -Iseconds) backup run ===" >> "$LOG"

status=0
for GRID in "poms grid" "test grid 1"; do
  if "$NODE" --env-file="$REPO/server/.env" "$REPO/server/scripts/backupGrid.js" \
       --grid "$GRID" --keep "$KEEP" >> "$LOG" 2>&1; then
    echo "  ok: $GRID" >> "$LOG"
  else
    # backupGrid throws rather than writing a silently-empty backup, so a
    # failure here means the snapshot is NOT trustworthy — say so loudly.
    echo "  FAILED: $GRID" >> "$LOG"
    status=1
  fi
done

# Keep the log from growing without bound.
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exit $status
