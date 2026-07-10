// Idempotent: in the 3 pomodoro ops, replace the fragile bare `label IS "Pomodoro"`
// rules (which never match a COPY_LINK'd, per-occurrence-label-less session) with a
// pomodoroNumber-presence discriminator — matching each rule's sibling var prefix.
// Fixes Pomodoro History not filling AND the completion never being stamped (zeroing).
// Usage: node --env-file=.env scripts/patchPomodoroLabels.js [--apply]
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
import Operation from "../models/Operation.js";
import Field from "../models/Field.js";
import User from "../models/User.js";

const APPLY = process.argv.includes("--apply");
const OPS = new Set(["Pomodoro History", "Pomodoro: Complete", "Pomodoro: Stop"]);

function patchRules(rules, pomoNumId) {
  let n = 0;
  for (const r of rules || []) {
    if (r.rules) { n += patchRules(r.rules, pomoNumId); continue; }
    if ((r.left === "label" || r.left === "$inst.label" || r.left === "$item.label") && r.right === "Pomodoro") {
      // Mirror the sibling prefix: $inst.* in the loop, bare fields.* in a FIND.
      const prefix = String(r.left).startsWith("$inst") ? "$inst." : (String(r.left).startsWith("$item") ? "$item." : "");
      r.left = `${prefix}fields.${pomoNumId}.value`;
      r.comparator = "IS_NOT_EMPTY";
      r.right = "";
      n++;
    }
  }
  return n;
}
function walk(steps, pomoNumId) {
  let n = 0;
  for (const s of steps || []) {
    if (s.condition?.rules) n += patchRules(s.condition.rules, pomoNumId);
    if (s.config?.predicate?.rules) n += patchRules(s.config.predicate.rules, pomoNumId);
    n += walk(s.then, pomoNumId); n += walk(s.else, pomoNumId); n += walk(s.body || s.steps, pomoNumId);
  }
  return n;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const u = await User.findOne({ email: "josh@jpoms.com" });
  const userId = u._id.toString();
  const fields = await Field.find({ userId }).lean();
  const pomoNum = fields.find(f => /pomodoro ?(number|#)/i.test(f.name || ""));
  console.log("pomodoroNumber field:", pomoNum?.id, pomoNum?.name, "| apply:", APPLY, "\n");

  const ops = await Operation.find({ userId }).lean();
  let total = 0;
  for (const op of ops) {
    if (!OPS.has(op.name)) continue;
    const pipeline = JSON.parse(JSON.stringify(op.pipeline || {}));
    const n = walk(pipeline.steps, pomoNum.id);
    console.log(`  ${op.name.padEnd(20)} label→presence rules: ${n}`);
    if (n && APPLY) await Operation.updateOne({ _id: op._id }, { $set: { pipeline } });
    total += n;
  }
  console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"}: ${total} rules.`);
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
