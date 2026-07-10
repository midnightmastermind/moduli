// Idempotent: enforce the rule "a SCHEDULE-BASED aggregation only counts an item
// when its Completed field is true — and if an item has no Completed field, it
// always counts." Implemented as a nested OR gate `(Completed IS true) OR
// (Completed IS_EMPTY)` added to every schedule-scoped aggregation loop guard.
// Usage: node --env-file=.env scripts/patchCompletionGates.js [--apply]
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
import Operation from "../models/Operation.js";
import Field from "../models/Field.js";
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import User from "../models/User.js";

const APPLY = process.argv.includes("--apply");
const uid = () => Math.random().toString(36).slice(2, 14);

// Curated "things you DID" schedule trackers still missing the completion gate.
// (Volume ×6, Total Reps, Nutrition ×4 were gated by the first pass.) Excluded on
// purpose: Completion Rate ($tot is the denominator = ALL tasks), Day Page build
// (control-flow loop), financial/bills trackers (not schedule-scoped / no Completed).
const TARGET = new Set([
  "Moods", "Movies Watched", "Books Read", "Podcasts Listened", "Courses Taken",
  "Workout History", "Meal History", "Purchase History",
]);

function isSchedScope(right, schedOccId) {
  if (right === schedOccId) return true;
  return typeof right === "string" && /(\$sched|\$scope|schedPage|scopePage)/i.test(right);
}

// Gate the SCHEDULE-SCOPE IF (the one deciding which items are counted) —
// `left` mirrors that IF's own loop var (Moods=$inst, media=$watchInst, …), read
// off its existing rules so the gate matches the item being scoped.
function patch(steps, completedId, schedOccId) {
  const touched = [];
  const walk = (arr) => {
    for (const s of arr || []) {
      if (s.type === "loop") walk(s.body || s.steps);
      else if (s.type === "if") {
        const rules = s.condition?.rules || [];
        const ancRule = rules.find(r => r.comparator === "HAS_ANCESTOR" && isSchedScope(r.right, schedOccId));
        const mentionsCompleted = JSON.stringify(rules).includes(completedId);
        if (ancRule && !mentionsCompleted) {
          const loopVar = String(ancRule.left).split("._ancestors")[0] || "$item"; // e.g. $inst / $watchInst
          rules.push({ id: uid(), operator: "OR", rules: [
            { id: uid(), left: `${loopVar}.fields.${completedId}.value`, comparator: "IS", right: true },
            { id: uid(), left: `${loopVar}.fields.${completedId}.value`, comparator: "IS_EMPTY", right: "" },
          ] });
          s.condition.rules = rules;
          touched.push(loopVar);
        }
        walk(s.then); walk(s.else);
      }
    }
  };
  walk(steps);
  return touched;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const u = await User.findOne({ email: "josh@jpoms.com" });
  const userId = u._id.toString();
  const completedId = (await Field.findOne({ userId, name: "Completed" })).id;
  const schedMod = (await Module.find({ userId, role: "page" }).lean()).find(x => x.label === "Schedule");
  const schedOcc = (await Occurrence.find({ userId, moduleId: schedMod.id }).lean())[0].id;
  console.log(`Completed=${completedId} Schedule occ=${schedOcc} apply=${APPLY}\n`);

  const ops = await Operation.find({ userId }).lean();
  let patchedOps = 0, gates = 0;
  for (const op of ops) {
    if (!TARGET.has(op.name)) continue;
    const pipeline = JSON.parse(JSON.stringify(op.pipeline || {}));
    const touched = patch(pipeline.steps, completedId, schedOcc);
    if (touched.length) {
      console.log(`  + ${(op.name || "?").padEnd(24)} (${touched.length} loop${touched.length > 1 ? "s" : ""}: ${touched.join(", ")})`);
      patchedOps++; gates += touched.length;
      if (APPLY) await Operation.updateOne({ _id: op._id }, { $set: { pipeline } });
    }
  }
  console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"}: ${patchedOps} ops, ${gates} gates.`);
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
