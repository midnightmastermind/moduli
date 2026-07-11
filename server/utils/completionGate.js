// server/utils/completionGate.js
// Enforces the policy: a SCHEDULE-BASED aggregation only counts an item when its
// Completed field is true — and an item whose module never BINDS a Completed
// field counts on scope membership alone. The discriminator is the BINDING
// (`_boundFieldIds`, executor-enriched), not the stored value: a
// bound-but-unchecked Completed reads as empty, and empty must mean NOT done
// (2026-07-11). Implemented as a nested
// `(Completed IS true) OR (_boundFieldIds ARRAY_NOT_INCLUDES completedFieldId)`
// gate added to the schedule-scope IF of the curated "things you did" trackers
// that don't already reference the Completed field.
//
// The per-muscle Volume, Total Reps, and per-meal Nutrition trackers are gated
// inline in their builders (they carry the rule at seed time); THIS covers the
// custom row-builder / count trackers whose scope-IF is easier to patch here than
// to thread the gate through their inline pipelines. Shared by createLiveData.js
// (post-seed pass) and scripts/patchCompletionGates.js (live-DB apply).

const uid = () => Math.random().toString(36).slice(2, 14);

// Curated schedule trackers still missing the gate. Excluded on purpose:
// Completion Rate ($tot is the denominator = ALL tasks), Day Page build
// (control-flow loop), financial/bills trackers (not schedule-scoped / no Completed).
export const GATE_TRACKER_NAMES = new Set([
  "Moods", "Movies Watched", "Books Read", "Podcasts Listened", "Courses Taken",
  "Workout History", "Meal History", "Purchase History",
]);

function isSchedScope(right, scheduleOccId) {
  if (right === scheduleOccId) return true;
  return typeof right === "string" && /(\$sched|\$scope|schedPage|scopePage)/i.test(right);
}

// Mutates each matching op's `pipeline` in place. Returns the array of op objects
// that were changed (so the caller can persist exactly those).
export function gateScheduleTrackers(ops, { completedFieldId, scheduleOccId }) {
  const changed = [];
  const patch = (steps) => {
    let added = 0;
    for (const s of steps || []) {
      if (s.type === "loop") added += patch(s.body || s.steps);
      else if (s.type === "if") {
        const rules = s.condition?.rules || [];
        const anc = rules.find(r => r.comparator === "HAS_ANCESTOR" && isSchedScope(r.right, scheduleOccId));
        const mentionsCompleted = JSON.stringify(rules).includes(completedFieldId);
        if (anc && !mentionsCompleted) {
          // Mirror the scope rule's loop var ($inst / $watchInst / …) so the gate
          // reads the item being scoped.
          const loopVar = String(anc.left).split("._ancestors")[0] || "$item";
          rules.push({ id: uid(), operator: "OR", rules: [
            { id: uid(), left: `${loopVar}.fields.${completedFieldId}.value`, comparator: "IS", right: true },
            { id: uid(), left: `${loopVar}._boundFieldIds`, comparator: "ARRAY_NOT_INCLUDES", right: completedFieldId },
          ] });
          s.condition.rules = rules;
          added++;
        }
        added += patch(s.then);
        added += patch(s.else);
      }
    }
    return added;
  };
  for (const op of ops) {
    if (!GATE_TRACKER_NAMES.has(op.name)) continue;
    if (patch(op.pipeline?.steps) > 0) changed.push(op);
  }
  return changed;
}
