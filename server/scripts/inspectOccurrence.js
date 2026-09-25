#!/usr/bin/env node
// server/scripts/inspectOccurrence.js — READ-ONLY. Prints everything about the
// occurrences whose label (occurrence or module) contains a phrase: field
// values BY NAME, the module's bindings (which fields the card shows), where it
// is listed, every recorded transaction that touched it (what changed each
// field, and which action did it), and share-log entries with that label.
//
//   node --env-file=server/.env server/scripts/inspectOccurrence.js --grid "poms grid" --label "Follow-Up Therapy"
//
// Writes nothing.
import mongoose from "mongoose";
import Grid from "../models/Grid.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Field from "../models/Field.js";
import Transaction from "../models/Transaction.js";

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const gridName = arg("--grid"), phrase = (arg("--label") || "").toLowerCase();
if (!gridName || !phrase) { console.error('usage: --grid "<name>" --label "<text>"'); process.exit(1); }

await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
const grid = await Grid.findOne({ name: gridName }).lean();
if (!grid) { console.error(`no grid named "${gridName}"`); process.exit(1); }
const gridId = String(grid._id);
const fields = new Map((await Field.find({ gridId }).lean()).map(f => [f.id, f]));
const fname = (id) => fields.get(id)?.name ? `${fields.get(id).name}` : `?${id}`;
const show = (v) => JSON.stringify(v)?.slice(0, 160);

const mods = await Module.find({ gridId, label: { $regex: phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }).lean();
const occs = await Occurrence.find({ gridId, $or: [
  { moduleId: { $in: mods.map(m => m.id) } },
  { label: { $regex: phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
] }).lean();
console.log(`${occs.length} occurrence(s) match "${phrase}"\n`);

for (const o of occs) {
  const m = await Module.findOne({ gridId, id: o.moduleId }).lean();
  console.log(`=== occurrence ${o.id}  label=${show(o.label)}  module=${o.moduleId} (${m?.label}, role=${m?.role})`);
  console.log(`    created ${o.createdAt?.toISOString?.()}  updated ${o.updatedAt?.toISOString?.()}  parentId=${o.parentId}`);
  console.log(`    meta ${show(o.meta)}`);
  const listers = await Occurrence.find({ gridId, occurrences: o.id }).select({ id: 1, label: 1, moduleId: 1 }).lean();
  for (const l of listers) console.log(`    listed by ${l.id} (${l.label || (await Module.findOne({ id: l.moduleId }).lean())?.label})`);
  console.log("    FIELD VALUES:");
  for (const [fid, cell] of Object.entries(o.fields || {})) console.log(`      ${fname(fid).padEnd(24)} ${show(cell)}`);
  console.log("    MODULE BINDINGS (what the card shows):");
  for (const b of m?.fieldBindings || []) console.log(`      ${fname(b.fieldId).padEnd(24)} role=${b.role} hidden=${!!b.hidden}`);

  const txs = await Transaction.find({ gridId, "docs.id": { $in: [o.id, o.moduleId] } }).sort({ timestamp: 1 }).limit(60).lean();
  console.log(`    TRANSACTIONS touching it: ${txs.length}`);
  for (const t of txs) {
    for (const d of t.docs.filter(d => d.id === o.id || d.id === o.moduleId)) {
      const bf = d.before?.fields || {}, af = d.after?.fields || {};
      const changed = [...new Set([...Object.keys(bf), ...Object.keys(af)])].filter(k => JSON.stringify(bf[k]) !== JSON.stringify(af[k]));
      const bindB = (d.before?.fieldBindings || []).map(b => fname(b.fieldId)).join(",");
      const bindA = (d.after?.fieldBindings || []).map(b => fname(b.fieldId)).join(",");
      console.log(`      ${new Date(t.timestamp).toISOString()} ${t.state} action=${t.actionId ? "user" : "derived(op/app)"} ${d.model} ${d.before ? (d.after ? "update" : "DELETE") : "create"}`);
      for (const k of changed) console.log(`         ${fname(k)}: ${show(bf[k])} -> ${show(af[k])}`);
      if (bindB !== bindA) console.log(`         bindings: [${bindB}] -> [${bindA}]`);
    }
  }
  console.log("");
}
for (const e of (grid.shareLog || []).filter(e => String(e.label || "").toLowerCase().includes(phrase))) {
  console.log(`SHARE LOG ${e.at} type=${e.type} status=${e.status} events=${e.events} notices=${show(e.notices)} rules=${show(e.rules)} error=${e.error}`);
}
await mongoose.disconnect();
