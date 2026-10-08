#!/bin/bash
# CONT|TILE|OPNAME|KIND|FIELD|TRIGS
while IFS='|' read CONT TILE OPNAME KIND FIELD TRIGS; do
  [ -z "$CONT" ] && continue
  echo "=== $OPNAME ($CONT › $TILE)"
  R=$(PAGEN=Trackers CONT="$CONT" ITEM="$TILE" FIELDS="$FIELD" timeout 300 node _additem.mjs 2>&1 | grep "result\|ERR"); echo "  $R" | cut -c1-200
  TID=$(echo "$R" | grep -o '"occ":\["[^"]*' | cut -d'"' -f4); [ -z "$TID" ] && { echo "  no tile id"; continue; }
  echo "$R" | grep -q "\"$FIELD\"" || { OCC=$TID FIELD="$FIELD" timeout 200 node _bindfield.mjs 2>&1 | grep picked; }
  for F in $(echo "$R" | grep -o '"bind":\[[^]]*' | sed 's/"bind":\[//; s/"//g' | tr ',' '\n' | grep -vx "$FIELD" | tr ' ' '_'); do F=${F//_/ }; OCC=$TID FIELD="$F" MODE=remove timeout 200 node _bindfield.mjs 2>&1 | grep remove | cut -c1-80; done
  export OPNAME PRIO=3 SPEC="{\"tile\":\"$TID\",\"kind\":\"$KIND\"}"
  for P in create build; do PHASE=$P timeout 1200 node _tracker2.mjs 2>&1 | grep -v "^  console" | grep "FAIL\|STOPPED\|stored step"; done
  PHASE=trig TRIGS="$TRIGS" timeout 600 node _tracker2.mjs 2>&1 | grep "FAIL\|STOPPED"
  echo "  tile=$TID"
done
