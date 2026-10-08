#!/bin/bash
# CONT|TILE|OPNAME|TAG  (TAG empty = no tag rule)
while IFS='|' read CONT TILE OPNAME TAG; do
  [ -z "$CONT" ] && continue
  echo "=== $OPNAME ($CONT › $TILE, tag=$TAG)"
  R=$(PAGEN=Trackers CONT="$CONT" ITEM="$TILE" FIELDS="Time Spent" timeout 300 node _additem.mjs 2>&1 | grep "result\|ERR")
  echo "  $R" | cut -c1-200
  TID=$(echo "$R" | grep -o '"occ":\["[^"]*' | cut -d'"' -f4)
  [ -z "$TID" ] && { echo "  no tile id"; continue; }
  for F in $(echo "$R" | grep -o '"bind":\[[^]]*' | sed 's/"bind":\[//; s/"//g' | tr ',' '\n' | grep -v "^Time Spent$" | tr ' ' '_'); do F=${F//_/ }; OCC=$TID FIELD="$F" MODE=remove timeout 200 node _bindfield.mjs 2>&1 | grep remove | cut -c1-80; done
  TAGRULE=""; [ -n "$TAG" ] && TAGRULE=",[\"F:Tags\",\"CONTAINS\",\"$TAG\"]"
  export OPNAME PRIO=3 SPEC="{\"tile\":\"$TID\",\"target\":\"Time Spent\",\"acc\":{\"add\":\"Duration\"},\"rules\":[[\"F:Duration\",\"IS_NOT_EMPTY\",null],[\"F:Date\",\"DATE_IN_PERIOD\",\"\$goalPeriod\"],[\"T:_ancestors\",\"HAS_ANCESTOR\",\"\$scopePageId\"],[\"T:~feedSourceId\",\"IS_EMPTY\",null]$TAGRULE],\"or\":[[\"F:Completed\",\"IS\",\"true\"],[\"T:_boundFieldIds\",\"ARRAY_NOT_INCLUDES\",\"1790525031347-njvvhnzd7\"]]}"
  for P in create build; do PHASE=$P timeout 900 node _tracker.mjs 2>&1 | grep -v "^  console" | grep "FAIL\|STOPPED\|stored step"; done
  PHASE=trig TRIGS='[["onChange","field","Completed"],["onChange","field","Duration"],["onAdd","module",null,"SCHED"],["onDelete","module",null,"SCHED"],["onFilterChange","grid"]]' timeout 600 node _tracker.mjs 2>&1 | grep "FAIL\|STOPPED"
done
