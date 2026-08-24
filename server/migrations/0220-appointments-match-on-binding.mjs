// 0220 — an appointment is a row whose MODULE BINDS "Appointment Type",
//        not a row of one particular module.
//
// User, 2026-08-24: *"my aug 24th task didnt get put into the schedule"*, then
// *"its not a due date, its a normal date."*
//
// ── THE DEFECT, MEASURED ───────────────────────────────────────────────────
//
// `Schedule: Place Dated Work` phase 1 matched an appointment with
// `$appt.templateId IS <the Appointment module id>`. On the live grid:
//
//     Therapy with Keith              module jb0tg0odtt   <- its OWN module
//     Peer Support Group - Froedtert  module mKp0a0PsYkyU
//     Psych appointment with Angela   module mKp0a0PsYkyU
//
// Therapy with Keith is dated 2026-08-24 3:00pm — TODAY — and today's 3:00pm
// slot held only `Eat · Drink`. The other two are dated 08-27 (future) and
// 08-11 (past, completed), so **the only appointment that has ever fallen on a
// "today" was the one the predicate could not see**, which is why the op looked
// like it worked and had in fact never placed anything. Its own 2026-08-08
// entry called that out as the honest gap: *"no real appointment has ever been
// placed by this op."*
//
// ── WHY BINDING, AND WHY IT IS EXACT RATHER THAN MERELY BROADER ────────────
//
// A row created from the Appointment catalog shares that module; a row created
// by hand gets its own — and BOTH bind the same fields, because binding is what
// gives the row its Date, Time Slot, Duration and Location controls. So the
// binding is what actually makes something an appointment, and the module id is
// an accident of how it was created. Measured on the live grid:
//
//     modules binding "Appointment Type"   2   (Appointment, Therapy with Keith)
//     routine rows binding it              0   (Eat, Drink, Exercise, Hygiene,
//                                               Journal, Take Medication, Walk)
//
// A structural rule that matched "has a Date and a Time Slot" instead would
// match EVERY routine row on the schedule — they all carry both — and would
// place the whole day twice. The binding is the one signal that separates them.
//
// This is the 2026-07-11 idiom: *"the discriminator is the module BINDING, never
// the stored value"* — and it survives a copy for free.
//
// ── BOTH ARMS MOVE, OR A MOVED APPOINTMENT IS NEVER UNLINKED ───────────────
//
// The op's header states that the sweep's keep-test IS the placement decision,
// so the two cannot drift. Phase 1 places on one predicate and unlinks stale
// placements on the same one. Patching only the placement would leave an
// appointment moved from 3pm to 5pm listed at 3pm forever. This migration
// REFUSES unless it finds and rewrites exactly the expected pair.

export const id = "0220-appointments-match-on-binding";
export const description = "Place Dated Work decides what an appointment is by module binding, not by one template id";

const OP_NAME = "Schedule: Place Dated Work";
const MARKER_FIELD_NAME = "Appointment Type";

/**
 * Rewrite the two `<var>.templateId IS <id>` rules to bind-based ones.
 * PURE and exported so a test drives what ships. Returns the rewritten pipeline
 * plus the vars it touched, so the caller can check against a NAMED expectation
 * rather than a count — the `0035` rule.
 */
export function retargetToBinding(pipeline, markerFieldId) {
  const touched = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;

    if (Array.isArray(node.rules)) {
      node.rules = node.rules.map((r) => {
        if (Array.isArray(r?.rules)) return walk(r);
        // Only the appointment arms: `$appt.templateId` / `$placed.templateId`.
        // `$todoTemplateId` and the cycle ops use `templateId` too, so an
        // untargeted rewrite would reach into pipelines this has no business in.
        const m = /^\$(appt|placed)\.templateId$/.exec(r?.left || "");
        if (!m || r.comparator !== "IS") return r;
        touched.push(`$${m[1]}`);
        return { ...r, left: `$${m[1]}._boundFieldIds`,
                 comparator: "ARRAY_INCLUDES", right: markerFieldId };
      });
    }
    for (const k of ["steps", "then", "else", "body", "condition"]) {
      if (node[k]) node[k] = walk(node[k]);
    }
    return node;
  };
  const out = walk(structuredClone(pipeline));
  return { pipeline: out, touched };
}

export async function up({ models, gridId, dryRun, log }) {
  const { Operation, Field } = models;
  const gid = String(gridId);

  const marker = await Field.findOne({ gridId: gid, name: MARKER_FIELD_NAME }).lean();
  if (!marker) { log(`no "${MARKER_FIELD_NAME}" field on this grid — nothing to do`); return { patched: 0 }; }

  const op = await Operation.findOne({ gridId: gid, name: OP_NAME }).lean();
  if (!op) { log(`"${OP_NAME}" is not on this grid — nothing to do`); return { patched: 0 }; }

  const { pipeline, touched } = retargetToBinding(op.pipeline, marker.id);
  log(`marker field "${MARKER_FIELD_NAME}" = ${marker.id}`);
  log(`rules rewritten: ${touched.length ? touched.join(", ") : "(none)"}`);

  if (!touched.length) { log("already matching on the binding — no change"); return { patched: 0 }; }

  // FAIL CLOSED on anything but the expected pair. One arm alone means the
  // sweep and the placement would disagree, which is worse than not running.
  const want = ["$appt", "$placed"].sort().join(",");
  if (touched.slice().sort().join(",") !== want) {
    throw new Error(`expected exactly $appt and $placed, got: ${touched.join(", ")}`);
  }
  if (dryRun) return { patched: touched.length };

  await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline } });
  return { patched: touched.length };
}
