// Two ops bugs the user reported / the integrity gate surfaced, 2026-07-29.
//
// 1. "in workouts, time is set to schedule canvas and not a time right now"
//    `Schedule: Stamp Date & Time Slot` wrote the DESTINATION CONTAINER'S LABEL
//    into the Time Slot field unconditionally. Time Slot is a select of the 48
//    generated slot labels, so creating anything under the hub panel that is not
//    a slot stamped a page/container NAME as the "time" — live grid held
//    "Schedule Canvas" ×3 (on Exercise rows), "Due" ×2, "No timeslot" ×2 — and
//    every history row that reads the field showed it. The builder now gates the
//    write on the destination carrying `Schedule Format IS "slot"` and CLEARS
//    the field otherwise (a copy carries the source's fields, so a slotted item
//    copied onto a canvas would keep a slot it no longer sits in).
//
// 2. Every fired alarm minted its Schedule instance with `kind: "list"`.
//    `getModuleTypeIcon` resolves kind BEFORE role, so those rows drew the BOARD
//    icon — the same defect the 2026-07-29 kind removal fixed everywhere else.
//    The client builder emitted it; the server twin already did not.
//
// The seed produces both fixes in the same commit; this reaches the frozen grids
// (their stored pipelines predate the change and would keep re-creating the bad
// values every drop / every 5 PM).
import { makeStampDateTimeSlotOp } from "../utils/liveSystemBuilders.js";

export const id = "0006-timeslot-gate-and-alarm-kind";
export const describe =
  "Regenerates the Stamp Date & Time Slot pipeline so Time Slot is only written when the " +
  "destination IS a timeslot (and cleared when it isn't), NULLS the out-of-range Time Slot values " +
  "already stored (container/page names, not times), and strips the inert kind:\"list\" from the " +
  "alarm ops' CREATE step + from any instance module already carrying it. Clears field VALUES that " +
  "are not valid slot labels; creates and deletes nothing else.";

/** Walk every step (loop bodies + if branches) and hand each action config to fn. */
function eachActionConfig(steps, fn) {
  for (const s of steps || []) {
    if (s?.config) fn(s.config);
    eachActionConfig(s?.body, fn);
    eachActionConfig(s?.then, fn);
    eachActionConfig(s?.else, fn);
  }
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence, Operation } = models;

  const fieldByName = async (name) =>
    (await Field.findOne({ gridId, name }).select({ id: 1 }).lean())?.id || null;

  const timeslotFieldId       = await fieldByName("Time Slot");
  const dateFieldId           = await fieldByName("Date");
  const lastSeenFieldId       = await fieldByName("Last Seen");
  const scheduleFormatFieldId = await fieldByName("Schedule Format");

  // ── 1. Re-gate the stamp op ───────────────────────────────────────────────
  const stampOp = await Operation.findOne({ gridId, name: "Schedule: Stamp Date & Time Slot" }).lean();
  if (!stampOp) {
    log("no 'Schedule: Stamp Date & Time Slot' op on this grid — skipping the gate");
  } else if (!scheduleFormatFieldId || !timeslotFieldId) {
    log(`missing Time Slot / Schedule Format field — cannot gate (grid keeps the ungated stamp)`);
  } else if (JSON.stringify(stampOp.pipeline || {}).includes(scheduleFormatFieldId)) {
    log("stamp op already gated on Schedule Format");
  } else {
    // Rebuild from the BUILDER rather than hand-patching JSON, so the stored
    // pipeline can't drift from what the seed produces. The hub panel comes off
    // the op's own trigger — that is where the seed put it.
    const hubPanelModuleId = stampOp.triggerObjects?.[0]?.targetId || null;
    if (!hubPanelModuleId) {
      log("stamp op has no panel trigger target — refusing to guess the hub panel");
    } else {
      const rebuilt = makeStampDateTimeSlotOp({
        userId: stampOp.userId, gridId, timeslotFieldId, dateFieldId,
        lastSeenFieldId, scheduleFormatFieldId, hubPanelModuleId,
      });
      log(`re-gate stamp op: ${stampOp.pipeline?.steps?.length ?? 0} steps → ${rebuilt.pipeline.steps.length}`);
      if (!dryRun) {
        await Operation.updateOne({ _id: stampOp._id }, { $set: { pipeline: rebuilt.pipeline } });
      }
    }
  }

  // ── 2. NULL the Time Slot values that aren't times ────────────────────────
  if (timeslotFieldId) {
    const tsField = await Field.findOne({ gridId, name: "Time Slot" }).lean();
    // The option list lives in meta.optionsSource.values (objects) on poms grid
    // and in meta.options (bare strings) in the seed — same divergence 0005 hit.
    const raw = tsField?.meta?.optionsSource?.values ?? tsField?.meta?.options ?? [];
    const valid = new Set(raw.map(v => (v && typeof v === "object" ? v.value : v)));
    if (!valid.size) {
      log("Time Slot has no option list — refusing to judge which values are invalid");
    } else {
      const carriers = await Occurrence.find({ gridId, [`fields.${timeslotFieldId}`]: { $exists: true } })
        .select({ id: 1, fields: 1 }).lean();
      const bad = carriers.filter(o => {
        const v = o.fields?.[timeslotFieldId]?.value;
        return v !== null && v !== undefined && v !== "" && !valid.has(v);
      });
      if (!bad.length) log(`all ${carriers.length} stored Time Slot values are valid slot labels`);
      else {
        const tally = {};
        for (const o of bad) { const v = o.fields[timeslotFieldId].value; tally[v] = (tally[v] || 0) + 1; }
        log(`NULL ${bad.length} out-of-range Time Slot value(s): ${JSON.stringify(tally)}`);
        if (!dryRun) {
          for (const o of bad) {
            await Occurrence.updateOne({ gridId, id: o.id },
              { $set: { [`fields.${timeslotFieldId}.value`]: null } });
          }
        }
      }
    }
  }

  // ── 3. Strip the inert kind from the alarm ops' CREATE step ───────────────
  const alarmOps = await Operation.find({ gridId, "alarm.type": { $exists: true } }).lean();
  const legacyAlarmOps = alarmOps.length
    ? alarmOps
    : await Operation.find({ gridId, name: /^Alarm: / }).lean();
  for (const op of legacyAlarmOps) {
    let touched = false;
    const pipeline = JSON.parse(JSON.stringify(op.pipeline || {}));
    eachActionConfig(pipeline.steps, (cfg) => {
      if (cfg.type === "CREATE" && cfg.role === "instance" && cfg.kind != null) {
        delete cfg.kind;
        touched = true;
      }
    });
    if (!touched) { log(`"${op.name}" CREATE step already has no kind`); continue; }
    log(`strip kind from "${op.name}" CREATE step`);
    if (!dryRun) await Operation.updateOne({ _id: op._id }, { $set: { pipeline } });
  }

  // ── 4. Clear kind off instance modules already created with one ───────────
  // Same rule migration 0003 applied; these are rows alarms minted since.
  const inert = await Module.find({ gridId, role: "instance", kind: { $exists: true, $ne: null } })
    .select({ id: 1, label: 1, kind: 1 }).lean();
  if (!inert.length) log("no instance module carries an inert kind");
  else {
    log(`clear inert kind on ${inert.length} instance module(s): ` +
        inert.map(m => `${JSON.stringify(m.label)}(${m.kind})`).join(", "));
    if (!dryRun) {
      await Module.updateMany({ gridId, id: { $in: inert.map(m => m.id) } }, { $unset: { kind: "" } });
    }
  }
}
