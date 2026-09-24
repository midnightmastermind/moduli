// server/services/shareRules.js
//
// Selects and runs the `onShare` rules for one shared payload.
//
// ONE RULE PER TYPE (D8) — branching lives inside a rule's pipeline, which is
// why there is no "first match wins" machinery here. Ordering matters in
// exactly one place: the `*` catch-all runs LAST, reached only when no typed
// rule halted the chain.
//
// A rule is an ordinary Operation whose `triggerObjects` carries
// `{ eventType: "onShare", shareType: "<token>" | "*" }` — the same trigger
// shape every other operation stores (the plan's `triggers[].type` sketch did
// not match the model), so the Operations plumbing applies unchanged.
//
// HALTING (D9) is an ordinary SET_VAR, no new action type. Either spelling
// works, because the server executor stores a dotted name flat:
//   SET_VAR name "$share.handled" = true        → scope["$share.handled"]
//   SET_VAR name "$share" = { ...handled:true } → scope.$share.handled
import Operation from "../models/Operation.js";
import { runOperationServerSide } from "./serverExecutor.js";

export const CATCH_ALL = "*";
const DEFAULT_PRIORITY = 50;

export function shareTriggerOf(op) {
  return (op?.triggerObjects || []).find(t => t?.eventType === "onShare") || null;
}

const priorityOf = (op, trig) => op.priority ?? trig.priority ?? DEFAULT_PRIORITY;

/** Pure: which rules run for a share type, in order. */
export function selectShareRules(ops, shareType) {
  return (ops || [])
    .filter(op => op && op.enabled !== false)
    .map(op => ({ op, trig: shareTriggerOf(op) }))
    .filter(({ trig }) => trig && (trig.shareType === shareType || trig.shareType === CATCH_ALL))
    .sort((a, b) => {
      const ac = a.trig.shareType === CATCH_ALL ? 1 : 0;
      const bc = b.trig.shareType === CATCH_ALL ? 1 : 0;
      return ac - bc || priorityOf(a.op, a.trig) - priorityOf(b.op, b.trig);
    })
    .map(({ op }) => op);
}

const isHandled = (scope) =>
  scope?.["$share.handled"] === true || scope?.$share?.handled === true;

export async function runShareRules({ share, userId, gridId, io = null, mirror = null }) {
  const all = await Operation.find({ userId, gridId }).lean();
  const rules = selectShareRules(all, share.type);

  const ran = [];
  let state = { ...share };

  for (const op of rules) {
    const res = await runOperationServerSide(op, {
      vars: { $share: state }, userId, gridId, io, mirror,
    });
    ran.push({
      ruleId: op.id, ruleName: op.name,
      ok: res.ok !== false,
      error: res.error || null,
      created: (res.effects || []).filter(e => e._effect === "CREATE"),
      unsupported: res.unsupported || [],
    });
    if (isHandled(res.scope)) return { ran, halted: true };
    if (res.scope?.$share && typeof res.scope.$share === "object") state = res.scope.$share;
  }
  return { ran, halted: false };
}
