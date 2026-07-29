import { describe, it } from "vitest";
import fs from "fs";
import { runMatchingOperations } from "../helpers/operationExecutor";
const D = JSON.parse(fs.readFileSync("/tmp/claude-1000/-home-joshpoms-moduli/8e7f3dee-e51b-41d9-baca-108fbefa4b0d/scratchpad/live.json","utf8"));
describe("workout history against LIVE data", () => {
  it("runs the onLoad sweep and reports what the workout ops produce", () => {
    const { grid, occurrences, modules, fields, operations } = D;
    const occurrencesById = Object.fromEntries(occurrences.map(o=>[o.id,o]));
    const modulesById = Object.fromEntries(modules.map(m=>[m.id,m]));
    const fieldsById = Object.fromEntries(fields.map(f=>[f.id,f]));
    const operationsById = Object.fromEntries(operations.map(o=>[o.id,o]));
    const state = { grid, gridId: grid._id, userId: grid.userId,
      occurrences, modules, fields, operations,
      occurrencesById, modulesById, fieldsById };
    const wanted = new Set(["Workout History","Total Workouts","Total Reps","Chest Volume"]);
    const ops = operations.filter(o => wanted.has(o.name));
    const updates = runMatchingOperations(ops, null, null,
      { state, fieldsById, operationsById, occurrencesById, modulesById });
    const F = Object.fromEntries(fields.map(f=>[f.id,f.name]));
    console.log(`ran ${ops.length} op(s) → ${updates.length} update(s)`);
    for (const u of updates.slice(0,12)) {
      const v = JSON.stringify(u.value ?? u.displayValue ?? u);
      console.log(`   ${F[u.fieldId]||u.fieldId} = ${v?.slice(0,120)}`);
    }
  });
});
