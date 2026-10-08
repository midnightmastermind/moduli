#!/bin/bash
set -o pipefail
# usage: SPEC='{...}' ./_area.sh   — builds one Boards area on the rebuild grid through the UI
export S=${S:-/tmp/claude-1000/-home-joshpoms-moduli/efaf1641-3aea-4a28-8b72-43b87b4fbb72/scratchpad}
export GRID=6ab15587409e94bbeb462694
for ph in _ph1 _ph2 _ph2b _ph3 _ph4; do
  echo "── $ph"; timeout 560 node $ph.mjs 2>&1 | grep -v "^  console:" | tail -6 || exit 1
done
