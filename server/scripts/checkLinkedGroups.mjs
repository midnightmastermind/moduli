// Verifies the Table:Build linkedGroupId hypothesis: do source Schedule
// tasks carry linkedGroupId that matches their Schedule Table row copies?
// If lots of source tasks have NO linkedGroupId while their copies do (or
// vice-versa), Table:Build's existence check would fail every fire →
// over-delete + over-create. Read-only.
import mongoose from "mongoose";
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";

await mongoose.connect(process.env.MONGO_URI);

const pageMods = await Module.find({ role: "page", label: { $in: ["Schedule", "Schedule Table", "Schedule Canvas"] } }).lean();
console.log("Found pages:", pageMods.map(m => `${m.label}=${m.id.slice(0,8)}`).join(", "));

const pages = {};
for (const m of pageMods) {
  const occ = await Occurrence.findOne({ moduleId: m.id }).lean();
  if (occ) pages[m.label] = occ;
}

const allOccs = await Occurrence.find({}, { id: 1, parentId: 1, moduleId: 1, linkedGroupId: 1, occurrences: 1, label: 1 }).lean();
const byId = new Map(allOccs.map(o => [o.id, o]));

const collectSubtree = (rootId) => {
  const out = new Set();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    if (out.has(id)) continue;
    out.add(id);
    const o = byId.get(id);
    if (o?.occurrences) queue.push(...o.occurrences);
  }
  return out;
};

const schedIds = pages.Schedule ? collectSubtree(pages.Schedule.id) : new Set();
const tblIds = pages["Schedule Table"] ? collectSubtree(pages["Schedule Table"].id) : new Set();
const cnvIds = pages["Schedule Canvas"] ? collectSubtree(pages["Schedule Canvas"].id) : new Set();

const schedTasks = [...schedIds].map(id => byId.get(id)).filter(o => o && o.id !== pages.Schedule?.id);
const tblRows = [...tblIds].map(id => byId.get(id)).filter(o => o && o.id !== pages["Schedule Table"]?.id);
const cnvCards = [...cnvIds].map(id => byId.get(id)).filter(o => o && o.id !== pages["Schedule Canvas"]?.id);

const groupSched = new Map();
for (const o of schedTasks) if (o.linkedGroupId) groupSched.set(o.linkedGroupId, (groupSched.get(o.linkedGroupId) || 0) + 1);
const groupTbl = new Map();
for (const o of tblRows) if (o.linkedGroupId) groupTbl.set(o.linkedGroupId, (groupTbl.get(o.linkedGroupId) || 0) + 1);

console.log(`\nSchedule descendants: ${schedTasks.length} (${schedTasks.filter(o => !o.linkedGroupId).length} with NO linkedGroupId)`);
console.log(`Schedule Table descendants: ${tblRows.length} (${tblRows.filter(o => !o.linkedGroupId).length} with NO linkedGroupId)`);
console.log(`Schedule Canvas descendants: ${cnvCards.length} (${cnvCards.filter(o => !o.linkedGroupId).length} with NO linkedGroupId)`);

let matched = 0, unmatched = 0, samples = [];
for (const row of tblRows) {
  if (!row.linkedGroupId) continue;
  if (groupSched.has(row.linkedGroupId)) matched++;
  else {
    unmatched++;
    if (samples.length < 5) {
      const srcId = row.linkedGroupId.startsWith("lg-") ? row.linkedGroupId.slice(3) : null;
      const src = srcId ? byId.get(srcId) : null;
      samples.push({ rowId: row.id.slice(0,8), lg: row.linkedGroupId.slice(0,16), srcId: srcId?.slice(0,8) || "(no lg-prefix)", srcExists: !!src, srcLg: src?.linkedGroupId?.slice(0,16) || "(unset)" });
    }
  }
}
console.log(`\nTable row → Schedule task lg match:`);
console.log(`  matched: ${matched}`);
console.log(`  unmatched: ${unmatched}  ← if >0, Table:Build's existence check fails → over-deletes`);
if (samples.length) {
  console.log(`  samples:`);
  for (const s of samples) console.log(`    row=${s.rowId} lg=${s.lg} sourceTask=${s.srcId} exists=${s.srcExists} sourceTaskLg=${s.srcLg}`);
}

let cnvMatched = 0, cnvUnmatched = 0;
for (const card of cnvCards) {
  if (!card.linkedGroupId) continue;
  if (groupSched.has(card.linkedGroupId)) cnvMatched++; else cnvUnmatched++;
}
console.log(`\nCanvas card → Schedule task lg match: matched=${cnvMatched} unmatched=${cnvUnmatched}`);

await mongoose.disconnect();
