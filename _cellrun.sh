#!/bin/bash
export S=/tmp/claude-1000/-home-joshpoms-moduli/6d1c04e3-2cac-4874-92d0-873f6ff99c10/scratchpad
LOCALBUILD=${LB} node ${PROBE:-_cell.mjs} 2>&1 | grep -E "^(CHAIN|  |\]|\}|tds|BEFORE|HOVER|AFTER|sizes|secs|chips)"
KEEP=$(cat $S/keep.txt) node --env-file=server/.env -e '
import("./server/node_modules/mongoose/index.js").then(async ({default:m})=>{await m.connect(process.env.MONGO_URI||process.env.MONGODB_URI);const p=await m.connection.db.collection("occurrences").findOne({id:"YGVS8DQ_vphC"});const keep=new Set(process.env.KEEP.split(","));console.log((p.occurrences||[]).filter(x=>!keep.has(x)).join(","));await m.disconnect();})' > $S/drop.txt
GRID=6a690f6fb8e785df961a9f3c VIEW=4xMDw5b43ylm ACTIVE=n1KSK9wrbjuX PANEL=YGVS8DQ_vphC DROP=$(cat $S/drop.txt) timeout 60 node _panelrestore.mjs
