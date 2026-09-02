#!/usr/bin/env bash
# readDiag.sh — read the DEVICE's own diagnostic captures off prod.
#
# The tablet has no console, so `dragPerf` / `scrollDiag` emit their formatted
# line to the server (`save_scroll_diag`), which prints it verbatim into the pm2
# log. This is the reader, so a capture never has to be screenshotted or
# retyped — and so the numbers get read from the DEVICE rather than from a
# desktop probe. On 2026-09-02 two hypotheses about the drag were falsified
# against a synthetic drag that never resolved an instance drop target; the real
# capture sitting in this log said the opposite of all of it.
#
#   ./server/scripts/readDiag.sh            # last 10 of everything
#   ./server/scripts/readDiag.sh drag       # last 10 [drag] lines
#   ./server/scripts/readDiag.sh drag 3     # last 3
#   ./server/scripts/readDiag.sh cell       # CELL-SWITCH captures
#   ./server/scripts/readDiag.sh scroll
set -euo pipefail

HOST="${DIAG_HOST:-deploy@viafluere.com}"
KIND="${1:-all}"
N="${2:-10}"
# Deep enough that a handful of captures are not buried by ordinary traffic.
LINES="${DIAG_LINES:-1500}"

case "$KIND" in
  drag)   PAT='\[drag\]' ;;
  cell)   PAT='CELL-SWITCH' ;;
  scroll) PAT='\[scroll\] (RASTER|SKIPPED|PAINT|MOUNT|MAIN-THREAD|CLEAN)' ;;
  all)    PAT='\[drag\]|\[scroll\]' ;;
  *)      echo "usage: readDiag.sh [drag|cell|scroll|all] [count]" >&2; exit 2 ;;
esac

ssh "$HOST" "pm2 logs moduli --nostream --lines $LINES 2>/dev/null" 2>/dev/null \
  | grep -E "$PAT" \
  | tail -n "$N" \
  | sed -e 's/^[0-9]*|moduli *| //' -e 's/📉 //' \
  | awk '{ print; print "" }'
