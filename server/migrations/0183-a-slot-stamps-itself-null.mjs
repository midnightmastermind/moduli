/**
 * 0183 — `Stamp Date & Time Slot` NULLS A SLOT'S OWN IDENTITY MARKER when the slot is created.
 *
 * This is the CAUSE of a defect `0145` and `0182` each repaired the symptom of, four days apart,
 * both closing with the same honest gap. `0182`'s header:
 *
 *     "WHAT STAMPED THE TEMPLATE ON 2026-08-18 IS NOT ESTABLISHED, and is deliberately not
 *      guessed at."  ... "10 slots, not 21, and they are contiguous: Todo, then 12:00am through
 *      4:30am. Every one updatedAt 05:59:15, seconds after a pm2 restart, i.e. during the FIRST
 *      grid load that followed it."
 *
 * ── THE EVIDENCE THAT NAMES IT, and it was sitting in the field the last repair chose not to touch
 *
 * `0182` cleared the DATE on those rows and said in as many words that it left `Time Slot` alone,
 * because `Build Schedule`, `Alarm` and `Pomodoro: Start` all FIND their slot by that value and
 * nulling it breaks all three (2026-07-30). That reasoning is right. What nobody checked is that
 * **the same writer had already nulled it.** Measured on the live grid today:
 *
 *     Day template slots ................................ 49
 *     carrying a Time Slot value ........................ 38
 *     NULL ..............................................  11   <- Todo, 12:00am .. 4:30am
 *     every null entry ....... { value: null, flow: "replace", timestamp: 2026-08-22 10:40:27Z }
 *
 * The SAME eleven rows, contiguous, in one second. So the date and the null are one event, and the
 * repair that looked complete had fixed half of it. **A field left untouched on purpose still has
 * to be READ** — the reason not to write it is not a reason not to look at it.
 *
 * ── THE MECHANISM, from the op's own pipeline ───────────────────────────────────────────────
 *
 * `Schedule: Stamp Date & Time Slot` fires `onCreate` and asks ONE question — is the thing I was
 * dropped INTO a slot?
 *
 *     $item          = the occurrence that was just created
 *     $destContainer = $trigger.containerId
 *     IF   $destContainer.<Schedule Format> IS "slot"   ->  Time Slot = $trigger.containerLabel
 *     ELSE                                              ->  Time Slot = null
 *     then                                                  Date      = $trigger.date
 *
 * That is correct for an ITEM. **A slot is not an item.** When a slot container is itself created —
 * under the `Day` template, or under a day column — its parent is the template or the column, whose
 * Schedule Format is `day-col` or nothing. The ELSE fires, and the op nulls the identity marker of
 * the very row that was just minted, then dates it. The `flow: "replace"` on all eleven is the
 * fingerprint: that is what `UPDATE` writes, and a seeded marker carries `flow: "in"`.
 *
 * The ELSE exists for a real reason — 2026-07-30: *"a COPY carries the source's fields, so a
 * slotted item copied onto a canvas would otherwise keep a slot it no longer sits in."* It is kept.
 * It simply must not fire on schedule STRUCTURE.
 *
 * ── THE GUARD IS AS NARROW AS THE EVIDENCE, deliberately ────────────────────────────────────
 *
 * The tempting rule is "skip anything carrying a Schedule Format value", which also covers day
 * columns. **That is wider than anything measured, and a day column legitimately carries a Date —
 * `Place Weekday` FINDs it by `Date SAME_DAY $day`.** Gating day columns out of the date stamp to
 * fix a slot bug is exactly the trade that has damaged this grid before. So the guard names the one
 * shape the damage is made of:
 *
 *     IF $item.<Schedule Format> IS_NOT "slot"     ... the whole existing body, untouched ...
 *
 * `IS_NOT` compares as strings, so an ordinary item — which carries no Schedule Format at all —
 * reads `"undefined" !== "slot"` and takes the branch exactly as it does today. Day columns are
 * byte-identical. Only a slot creating itself is skipped.
 *
 * ── AND IT REPAIRS THE MASTER AND THE COPIES IN THE SAME PASS ───────────────────────────────
 *
 * The 2026-07-30 (2) rule, which this same op taught: *"repair the masters and the copies in the
 * same pass, or rebuild the copies."* Fixing the `Day` template alone fixes tomorrow and leaves
 * today's column dead from midnight to 4:30am; fixing today alone is undone by the next build.
 *
 * **The value restored is the slot's OWN identity, read from its `identitySignature`** (`slot:4:30am`
 * -> `4:30am`), never from the module label — the label is one rename from wrong, and `0172` chose
 * the signature for this exact reason. A slot whose signature does not parse is REPORTED and left
 * alone rather than guessed at.
 *
 * ── WHY IT MATTERS BEYOND TIDINESS ──────────────────────────────────────────────────────────
 *
 * `Schedule: Place Weekday` walks a template's slots and skips any whose `Time Slot` is empty, then
 * matches the day column's slot by that same value. So **12:00am through 4:30am cannot be filled by
 * any layer** — not Meals, not a workout, not the Routine layer being added next. Ten of the
 * forty-eight half-hours in a day were silently unreachable, and the `Todo` marker being null is
 * `0172`'s defect having recurred by the same mechanism.
 */
export const id = "0183-a-slot-stamps-itself-null";
export const describe =
  "Guard Stamp Date & Time Slot so a slot never nulls its own marker, and restore the 11 markers it already nulled. Deletes nothing.";

const SF = "vQ0ELZP_zxnx";  // Schedule Format
const TS = "nSccAtADyUGW";  // Time Slot

/**
 * Wrap the op's existing body in `IF $item.<SF> IS_NOT "slot"`.
 * Exported so the test drives the SAME transform the migration performs.
 */
export function guardAgainstSelfStamp(pipeline) {
  const steps = pipeline?.steps;
  if (!Array.isArray(steps)) return { changed: false, reason: "no steps" };
  if (steps.some((s) => s?.type === "if" && s?.condition?.rules?.some(
    (r) => r?.left === `$item.fields.${SF}.value` && r?.comparator === "IS_NOT")))
    return { changed: false, reason: "already guarded" };

  // The two FINDs that bind $item and $destContainer must stay OUTSIDE the guard —
  // the guard reads $item, so it cannot run before $item is bound.
  const firstIf = steps.findIndex((s) => s?.type === "if");
  if (firstIf < 1) return { changed: false, reason: "no IF to guard, or nothing binds $item first" };

  const body = steps.slice(firstIf);
  const guard = {
    id: `guard-${Math.random().toString(36).slice(2, 12)}`,
    type: "if",
    condition: { operator: "AND", rules: [{
      id: `gr-${Math.random().toString(36).slice(2, 12)}`,
      left: `$item.fields.${SF}.value`, comparator: "IS_NOT", right: "slot",
    }] },
    then: body,
    else: [],
  };
  pipeline.steps = [...steps.slice(0, firstIf), guard];
  return { changed: true, reason: "" };
}

/** `slot:4:30am` -> `4:30am`; `slot:Todo` -> `Todo`. Anything else -> null (reported, not guessed). */
export function markerFromSignature(sig) {
  if (typeof sig !== "string") return null;
  const m = /^slot:(.+)$/.exec(sig);
  return m && m[1].trim() ? m[1].trim() : null;
}

/**
 * A per-day slot is a COPY_LINK copy and carries NO signature — its identity is
 * `meta.copyLinkSource`, pointing at the template master. So the marker is resolved from the
 * occurrence's own signature FIRST and from its source's second. This is the half the first
 * dry run caught missing: the header quotes 2026-07-30 (2) — *repair the masters and the copies
 * in the same pass* — and the code was only doing the masters.
 */
export function markerFor(occ, byId) {
  const own = markerFromSignature(occ?.identitySignature);
  if (own) return { marker: own, via: "signature" };
  const src = byId.get(occ?.meta?.copyLinkSource);
  const viaSrc = markerFromSignature(src?.identitySignature);
  if (viaSrc) return { marker: viaSrc, via: `copyLinkSource ${src.id}` };
  return { marker: null, via: null };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Operation } = models;

  // ── 1. the op ────────────────────────────────────────────────────────────────
  const ops = await Operation.find({ gridId }).lean();
  const op = ops.find((o) => /stamp date & time slot/i.test(o.name || ""));
  if (!op) log("  no `Schedule: Stamp Date & Time Slot` on this grid — skipping the op half");
  else {
    const pipeline = JSON.parse(JSON.stringify(op.pipeline || {}));
    const { changed, reason } = guardAgainstSelfStamp(pipeline);
    if (!changed) log(`  op: ${reason}`);
    else {
      log(`  op: wrapping the body in  IF $item.fields.${SF}.value IS_NOT "slot"`);
      if (!dryRun) await Operation.updateOne({ id: op.id, gridId }, { $set: { pipeline } });
    }
  }

  // ── 2. the data, master AND copies ───────────────────────────────────────────
  const occs = await Occurrence.find({ gridId }).lean();
  const isSlot = (o) => o?.fields?.[SF]?.value === "slot" || /^slot:/.test(o?.identitySignature || "");
  const broken = occs.filter((o) => isSlot(o) && !o?.fields?.[TS]?.value);
  log(`  slots with no Time Slot marker: ${broken.length}`);

  const byId = new Map(occs.map((o) => [o.id, o]));
  const listed = new Set();
  for (const o of occs) for (const k of o.occurrences || []) listed.add(k);

  let fixed = 0;
  const refused = [];
  const orphaned = [];
  for (const o of broken) {
    const { marker, via } = markerFor(o, byId);
    if (!marker) { refused.push(o.id); continue; }
    // An orphan is repaired too — a correct marker on an unreachable row is harmless, and a NULL
    // one becomes a bug the moment anything re-lists it. But it is REPORTED, because six of these
    // are debris the `0181` dedupe left behind and nothing else would surface them.
    const reachable = listed.has(o.id) || byId.has(o.parentId);
    if (!reachable) orphaned.push(o.id);
    log(`    ${o.id}  via ${via}  ->  Time Slot = "${marker}"${reachable ? "" : "   [ORPHAN]"}`);
    if (!dryRun) {
      await Occurrence.updateOne({ id: o.id, gridId },
        { $set: { [`fields.${TS}`]: { value: marker, flow: "in" } } });
    }
    fixed++;
  }
  if (refused.length)
    log(`  REFUSED (no signature and no resolvable copyLinkSource), left alone: ${refused.join(", ")}`);
  if (orphaned.length)
    log(`  NOTE: ${orphaned.length} of those are ORPHANS — listed by no parent. Debris, reported not swept: ${orphaned.join(", ")}`);
  log(`  ${fixed} marker(s) ${dryRun ? "would be" : ""} restored, ${refused.length} refused`);
  if (!dryRun && fixed) log("  written — RESTART pm2 and reload.");
}
