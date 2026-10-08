#!/bin/bash
# "CID TARGET EDGE" per line: EDGE=top lands CID before TARGET, bottom after it. Full-screen panel, no auto-scroll.
P=2edb6c51-b80e-4900-b3fa-31e17226f04c
while read cid tgt edge; do
  [ -z "$cid" ] && continue
  FULL=1 EDGE=$edge CID=$cid AFTER=$tgt PAGEOCC=$P timeout 250 node _ctrmove.mjs 2>&1 | grep -E "after:|REFUSED|release|missing|PAGEERROR"
done
echo DONE
