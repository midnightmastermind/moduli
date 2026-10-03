#!/bin/bash
while IFS='|' read OPNAME KIND EVT; do
  [ -z "$OPNAME" ] && continue; echo "=== $OPNAME"
  export OPNAME KIND EVT SPEC='{}'
  for P in create build trigpomo; do PHASE=$P timeout 900 node _pomoops.mjs 2>&1 | grep -v "^  console" | grep "FAIL\|STOPPED\|stored step\|events offered"; done
done
