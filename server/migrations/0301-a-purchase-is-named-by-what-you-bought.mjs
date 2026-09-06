// "Last Purchase: Spend". Every row in the Purchases and Meals history reads
// the ROUTINE's name instead of the thing.
//
// User, 2026-09-05, listing trackers that were not doing their job: *"purchases
// ... last purchase"*. Driven through the real executor with a purchase
// injected, the tracker fires and fills correctly - it is not broken - but the
// row it writes is:
//
//     Purchases   [{ label: "Spend", amount: 35, date: "2026-09-06" }]
//     Last Purchase  "Spend"
//
// because the PUSH_TO_ARRAY records `label: "$inst.label"`. Every purchase is a
// `Spend` and every meal is an `Eat`, so the history is a column of one word.
//
// ── THE FIX IS WHAT WORKOUT HISTORY ALREADY DOES ───────────────────────────
//
// Of the four history trackers, two already resolve their pick - Workout
// History records `$mv.label` (the movement) and Pomodoro History the phase.
// Meal History and Purchase History are the two that never did. So this is not
// a new mechanism; it is the one already in the grid, applied to the two that
// were missed:
//
//     INIT_VAR $mv = $allItemsById.${$mvId}   ->   PUSH { label: "$mv.label" }
//
// ── THE TWO PICKS HAVE DIFFERENT SHAPES, AND THAT DECIDES THE CONSTRUCTION ──
//
// Measured rather than assumed: `Purchase Item` is multiSelect (its values are
// ARRAYS), `Meal` is not (plain id strings). So Meal resolves in one step,
// while Purchase collects the names and joins them.
//
// **Purchases deliberately does NOT copy Workout History's row-per-pick.** A
// workout row carries sets and reps, so one row per movement is right; a
// purchase row carries an AMOUNT, and three items would become three rows of
// $35 - a history that reads as $105. One row, all items named.
//
// ── AND `$picked` IS RESET, NOT JUST CREATED ───────────────────────────────
//
// `PUSH_TO_VAR` creates the array when absent, which makes an INIT tempting.
// But the collection sits inside the OUTER loop over instances, so without a
// reset per iteration the second purchase carries the first one's item names
// and every row after it grows. It is SET to an empty array each time round.
import Field from "../models/Field.js";
import Operation from "../models/Operation.js";

export const id = "0301-a-purchase-is-named-by-what-you-bought";
export const description = "Meal and Purchase history rows are labelled by the pick, the way Workout History already is.";
export const touches = ["fields", "operations"];

const rid = () => "a" + Math.random().toString(36).slice(2, 12);
const act = (config) => ({ id: rid(), type: "action", config });

// op name -> the field whose pick names the row.
const NAMED_BY = { "Purchase History": "Purchase Item", "Meal History": "Meal" };

// The PUSH_TO_ARRAY that records the row, and the array holding it.
function findRowPush(node, out = { node: null, arr: null, idx: -1 }) {
  if (!node || typeof node !== "object" || out.node) return out;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const c = node[i]?.config || node[i];
      if (c?.type === "PUSH_TO_ARRAY" && c?.value && typeof c.value === "object"
          && String(c.value.label || "") === "$inst.label") {
        out.node = node[i]; out.arr = node; out.idx = i; return out;
      }
    }
    node.forEach((x) => findRowPush(x, out));
    return out;
  }
  Object.values(node).forEach((v) => findRowPush(v, out));
  return out;
}

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const one = (name) => {
    const hits = fields.filter((f) => f.name === name);
    if (hits.length !== 1) throw new Error(`field "${name}": ${hits.length} matches - refusing`);
    return hits[0];
  };

  for (const [opName, fieldName] of Object.entries(NAMED_BY)) {
    const op = await Operation.findOne({ gridId: gid, name: opName }).lean();
    if (!op) { log(`  ${opName}: no such operation - SKIPPED`); continue; }

    const pick = one(fieldName);
    const pipeline = JSON.parse(JSON.stringify(op.pipeline));
    const found = findRowPush(pipeline);
    if (!found.node) {
      log(`  ${opName}: no row labelled "$inst.label" - already named by its pick, left alone`);
      continue;
    }

    const multi = pick.meta?.multiSelect === true;
    const cfg = found.node.config || found.node;
    const before = [];

    // Always start from the routine's own label, so a row whose pick is empty
    // still reads as something rather than blank.
    before.push(act({ type: "INIT_VAR", name: "$rowLabel", expr: "$inst.label" }));

    if (multi) {
      before.push(act({ type: "SET_VAR", name: "$picked", expr: "json:[]" }));
      before.push({
        id: rid(), type: "loop", overExpr: `$inst.fields.${pick.id}.value`, as: "$pickId",
        body: [
          act({ type: "INIT_VAR", name: "$pickItem", expr: "$allItemsById.${$pickId}" }),
          act({ type: "PUSH_TO_VAR", name: "$picked", expr: "$pickItem.label" }),
        ],
      });
      before.push(act({ type: "JOIN_ARRAY", name: "$picked", by: ", ", to: "$pickNames" }));
      before.push({
        id: rid(), type: "if",
        condition: { operator: "AND", rules: [{ id: rid(), left: "$pickNames", comparator: "IS_NOT_EMPTY", right: "" }] },
        then: [act({ type: "SET_VAR", name: "$rowLabel", expr: "$pickNames" })],
        else: [],
      });
    } else {
      before.push(act({ type: "INIT_VAR", name: "$pickItem", expr: `$allItemsById.\${$inst.fields.${pick.id}.value}` }));
      before.push({
        id: rid(), type: "if",
        condition: { operator: "AND", rules: [{ id: rid(), left: "$pickItem.label", comparator: "IS_NOT_EMPTY", right: "" }] },
        then: [act({ type: "SET_VAR", name: "$rowLabel", expr: "$pickItem.label" })],
        else: [],
      });
    }

    found.arr.splice(found.idx, 0, ...before);
    cfg.value = { ...cfg.value, label: "$rowLabel" };

    // The "last X" scalar reads the same label, so it follows for free - but
    // only if it was reading the routine too. A SET_VAR already naming the pick
    // is left alone.
    let lastFixed = 0;
    const fixLast = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(fixLast);
      const c = n.config || n;
      if (c?.type === "SET_VAR" && c?.expr === "$inst.label" && c?.name !== "$rowLabel") {
        c.expr = "$rowLabel"; lastFixed++;
      }
      Object.values(n).forEach(fixLast);
    };
    fixLast(pipeline);

    log(`  ${opName}: rows named by "${fieldName}" (${multi ? "multi - names joined, one row" : "single"})${lastFixed ? `, ${lastFixed} "last" var(s) follow` : ""}`);
    if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline } });
  }

  if (!apply) log("  DRY RUN - pass --apply to write.");
}
