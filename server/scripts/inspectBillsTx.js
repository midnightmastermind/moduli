// Show the recent MeasureOp transactions touching the two bills occurrences,
// in time order, so we can see who wrote `completed`/`due` and in what order.
import mongoose from "mongoose";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";

const EMAIL = process.argv[2] || "josh@jpoms.com";
const SRC = "NqnfH2xY9GDm";
const COPY = "6f88f9aa-cd87-4def-8471-ca6322362db6";
await mongoose.connect(process.env.MONGO_URI);
const user = await User.findOne({ email: EMAIL });
const userId = user._id.toString();

const txs = await Transaction.find({ userId, type: "MeasureOp" }).sort({ timestamp: -1 }).limit(60).lean();

const rows = [];
for (const tx of txs) {
  for (const op of (tx.operations || [])) {
    const m = op.measure;
    if (!m) continue;
    if (m.occurrenceId === SRC || m.occurrenceId === COPY) {
      rows.push({
        t: tx.timestamp,
        which: m.occurrenceId === SRC ? "SOURCE" : "COPY",
        field: m.fieldId,
        prev: m.previousValue,
        val: m.value,
        state: tx.state,
        txid: tx.id,
      });
    }
  }
}
rows.sort((a, b) => new Date(a.t) - new Date(b.t));
console.log(`${rows.length} measure ops touching SOURCE(${SRC}) / COPY(${COPY}):\n`);
for (const r of rows) {
  console.log(`${new Date(r.t).toISOString()}  ${r.which.padEnd(6)} ${String(r.field).slice(0,12).padEnd(12)} ${JSON.stringify(r.prev)} -> ${JSON.stringify(r.val)}  [${r.state}] tx=${r.txid}`);
}
await mongoose.disconnect();
