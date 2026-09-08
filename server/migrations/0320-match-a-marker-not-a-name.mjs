// Three operations still decided what a row WAS by reading its name.
//
// User, 2026-09-08: *"make sure we arent using labels like that and add any
// fields you think may help the comparison"*
//
// 0319 converted the 48 trigger SCOPES from a page name to an occurrence id.
// These are the rule-level twins — a pipeline asking `label IS "…"` — and the
// useful finding is that **every marker they need already exists**. Nothing new
// had to be minted; the ops simply were not reading what the grid already
// stamps.
//
//   Due: Seed                       label IS "Todo"            -> 16 matches
//        The Todo container carries `Time Slot: "Todo"`, the SAME identity
//        marker `Build Schedule`, `Alarm` and `Pomodoro: Start` already FIND
//        their slots by. Renaming the container to "Inbox" tomorrow breaks the
//        op; the marker survives it.
//
//   Day Page: Build Tasks Completed label IS "Tasks Completed"  -> 40 matches
//        All 40 already carry `identitySignature: "daypage:Tasks Completed"` —
//        stamped by 0022/0023 precisely so a clone is recognisable independently
//        of what it is called.
//
//   Workouts: Today's Session       moduleLabel IS "Run"/"Stretch"
//        The other 24 movements in the same op are matched by the movement's
//        OCCURRENCE id. Run and Stretch are routines rather than movements, so
//        they had no pick to match on and fell back to a name. They match on
//        `templateId` — the module — now, which is the idiom `Monthly Bills`
//        already uses and which catches every placement rather than one.
//
// ── WHY A NAME IS NOT MERELY UNTIDY HERE ──────────────────────────────────
//
// It has already cost this grid twice: the Goals page was renamed in July and
// two trackers silently stopped recomputing on a date change (0318), and
// "Trackers" names TWO pages so 43 triggers were matching on something already
// ambiguous (0319). A label is also two fields — `occurrence.label` falling back
// to the module's — which is its own trap this file has paid for repeatedly.
//
// EVERY REPLACEMENT IS CHECKED TO MATCH THE SAME ROWS the name did, and the
// migration refuses if it would match FEWER — a rule that quietly stops matching
// is exactly the silent failure being removed.
//
// Idempotent.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0320-match-a-marker-not-a-name";
export const description = "Pipeline rules match an identity marker instead of a label.";
export const touches = ["fields", "modules", "occurrences", "operations"];

const walk = (n, fn) => {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, fn));
  if (n && typeof n === "object") { fn(n); Object.values(n).forEach((v) => walk(v, fn)); }
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const mods   = await Module.find({ gridId: gid }).lean();
  const occs   = await Occurrence.find({ gridId: gid }).lean();
  const ops    = await Operation.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o && (o.label || modById[o.moduleId]?.label || "");

  const oneField = (name) => {
    const hits = fields.filter((f) => f.name === name);
    if (hits.length !== 1) throw new Error(`field "${name}" is ambiguous or missing (${hits.length}) - refusing`);
    return hits[0];
  };
  const timeSlot = oneField("Time Slot");

  /** Rows a `label IS "<name>"` rule matches today — the set to preserve. */
  const byLabel = (name) => new Set(occs.filter((o) => labelOf(o) === name).map((o) => o.id));
  /** Rows the REPLACEMENT matches. */
  const byRule = (left, right) => new Set(occs.filter((o) => {
    if (left === "identitySignature") return o.identitySignature === right;
    if (left === "templateId") return o.moduleId === right;
    const m = /^fields\.([A-Za-z0-9_-]+)\.value$/.exec(left);
    if (m) { const v = o.fields?.[m[1]]?.value; return Array.isArray(v) ? v.includes(right) : v === right; }
    return false;
  }).map((o) => o.id));

  // The replacement for each name, DERIVED from what the matched rows carry.
  const planFor = (name) => {
    const rows = occs.filter((o) => labelOf(o) === name);
    if (!rows.length) return null;
    const all = (fn) => rows.every(fn);
    // 1. Every match carries the same identitySignature.
    const sigs = new Set(rows.map((o) => o.identitySignature).filter(Boolean));
    if (sigs.size === 1 && all((o) => o.identitySignature === [...sigs][0]))
      return { left: "identitySignature", right: [...sigs][0], how: "identitySignature" };
    // 2. Every match carries the same Time Slot marker — the identity value the
    //    schedule ops already resolve slots by.
    const slots = new Set(rows.map((o) => o.fields?.[timeSlot.id]?.value).filter(Boolean));
    if (slots.size === 1 && all((o) => o.fields?.[timeSlot.id]?.value === [...slots][0]))
      return { left: `fields.${timeSlot.id}.value`, right: [...slots][0], how: "Time Slot marker" };
    // 3. Every match shares one MODULE — rename-proof and catches every placement.
    const modIds = new Set(rows.map((o) => o.moduleId));
    if (modIds.size === 1) return { left: "templateId", right: [...modIds][0], how: "module id" };
    return null;
  };

  let changed = 0, refused = 0;
  for (const op of ops.filter((o) => o.enabled !== false)) {
    let touched = false;
    walk(op.pipeline, (n) => {
      if (n.comparator !== "IS" || typeof n.right !== "string" || n.right.startsWith("$")) return;
      const left = String(n.left || "");
      if (!/(^|\.)(label|moduleLabel|containerLabel)$/.test(left)) return;

      const name = n.right;
      const plan = planFor(name);
      if (!plan) { log(`  ${op.name}: "${name}" — no marker every match shares; REFUSED`); refused++; return; }

      // THE SET MUST BE IDENTICAL, in BOTH directions. My first version checked
      // only for rows LOST, and the dry run caught what that misses: replacing
      // `label IS "⏰ 5 PM"` with the 5pm Time Slot marker matches 25 rows
      // instead of 5 — every row in that slot, not the alarm's own — so the
      // alarm's dedupe FIND would conclude it had already fired and stop
      // creating its row. **A broadened match is not a safer match.**
      const was = byLabel(name), now = byRule(plan.left, plan.right);
      const lost = [...was].filter((i) => !now.has(i));
      const gained = [...now].filter((i) => !was.has(i));
      if (lost.length || gained.length) {
        log(`  ${op.name}: "${name}" -> ${plan.how} matches a DIFFERENT set` +
            ` (${lost.length} lost, ${gained.length} gained); REFUSED`);
        refused++; return;
      }
      // The prefix is preserved: `$ex.moduleLabel` becomes `$ex.templateId`.
      const prefix = left.includes(".") ? left.slice(0, left.lastIndexOf(".") + 1) : "";
      n.left = plan.left.startsWith("fields.") ? `${prefix}${plan.left}` : `${prefix}${plan.left}`;
      n.right = plan.right;
      log(`  ${op.name}: ${left} IS "${name}"  ->  ${n.left} IS "${plan.right}" (${plan.how}, ${now.size} rows, ${now.size - was.size >= 0 ? "+" : ""}${now.size - was.size})`);
      touched = true;
    });
    if (touched) { changed++; if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline: op.pipeline } }); }
  }

  log(`  ${changed} op(s) ${apply ? "updated" : "would be updated"}, ${refused} refused.`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
