// An identity marker was nulled and the copy-link fan-out spread it to all 7 copies.
//
// Found while auditing the trackers, 2026-09-05. Today's schedule column had
// 48 of its 49 children carrying a `Time Slot` marker. The 49th was `Todo`:
//
//     copy source LnLC5V1K "Todo"  Time Slot = {value:null, flow:"replace", ...}
//     copies: 7                    carrying the marker: 0
//
// `Time Slot` on these containers is not a time - it is an IDENTITY MARKER, and
// the grid FINDs by it in three places: `Schedule: Build Schedule` locates the
// Todo container, and `Alarm` and `Pomodoro: Start` locate a slot. With it null
// the FIND matches nothing and the step below it silently does nothing, which
// is how this survived: no error anywhere.
//
// HOW IT SPREAD IS THE PART WORTH KEEPING. `update_occurrence` fans EVERY field
// of a write out to every member of a copy-link group. 2026-08-29 (7) narrowed
// that for FILTER fields - a `Date` written on one copy was re-dating the whole
// group and hiding rows - by withholding fields the grid filters on, derived
// from the grid's own filter config. `Time Slot` is not a filter field, so it
// still fans out, and a single null written anywhere in the group reached the
// source and all seven copies. The stored value still carries
// `flow:"replace"`, which is what a fanned write looks like.
//
// THIS FILE REPAIRS THE DATA. It does not stop the fan-out: withholding
// identity markers is a change to the shared write path and wants its own
// reviewed pass - the same call 2026-08-29 (7) made about its own half.
//
// ── THE RULE IS THE GRID'S OWN CONVENTION, NOT A LIST OF LABELS ────────────
//
// 2026-07-30 (2) had to separate two meanings of the same field and wrote the
// discriminator down: *"a value equal to the occurrence's OWN label is an
// identity marker; a value equal to a PARENT's label is the mis-stamp"*. So the
// vocabulary of markers is READ OFF the Schedule Template - every occurrence
// there whose Time Slot equals its own label - and a copy or source carrying
// that same label with an EMPTY marker is restored to it.
//
// Nothing names "Todo". If another marker is ever nulled the same way, this
// repairs it too.
//
// ── IT ONLY EVER FILLS AN EMPTY ────────────────────────────────────────────
//
// A row with a real slot time ("7:00am") is never touched - only null/"" is
// restored, and only to the label the template says that row's marker is. So
// this cannot re-stamp a slot that was deliberately cleared to something else,
// and re-running converges.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";

export const id = "0292-a-nulled-identity-marker-fanned-out";
export const description =
  "Restore Time Slot identity markers the copy-link fan-out nulled (Build Schedule FINDs by them).";
export const touches = ["fields", "modules", "occurrences"];

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const hits = fields.filter((f) => f.name === "Time Slot");
  if (hits.length !== 1) throw new Error(`field "Time Slot": ${hits.length} matches - refusing`);
  const ts = hits[0].id;

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o.label || modById[o.moduleId]?.label || null;

  // The marker VOCABULARY: rows whose Time Slot IS their own label. On this
  // grid that is Todo / Due / No timeslot and the 48 clock times.
  const markerLabels = new Set();
  for (const o of occs) {
    const v = o.fields?.[ts]?.value;
    const l = labelOf(o);
    if (l && v && String(v) === String(l)) markerLabels.add(String(l));
  }
  log(`  identity-marker labels found on the grid: ${[...markerLabels].sort().join(", ") || "(none)"}`);
  if (!markerLabels.size) { log("  no marker convention to restore from - REFUSING"); return; }

  // Empty-markered rows whose label IS one of those markers.
  const broken = occs.filter((o) => {
    const l = labelOf(o);
    if (!l || !markerLabels.has(String(l))) return false;
    const v = o.fields?.[ts]?.value;
    return v === null || v === undefined || v === "";
  });

  log(`  rows whose label is a marker but whose marker is EMPTY: ${broken.length}`);
  const byLabel = {};
  for (const b of broken) byLabel[labelOf(b)] = (byLabel[labelOf(b)] || 0) + 1;
  for (const [l, n] of Object.entries(byLabel)) log(`     ${l}: ${n}`);
  if (!broken.length) { log("  nothing to repair - already converged."); return; }

  if (!apply) { log("  DRY RUN - pass --apply to write."); return; }
  let wrote = 0;
  for (const b of broken) {
    const l = String(labelOf(b));
    // Written as a plain value, dropping the `flow:"replace"` the fanned write
    // left behind - a marker has no flow.
    await Occurrence.updateOne({ id: b.id, gridId: gid }, { $set: { [`fields.${ts}`]: { value: l } } });
    wrote++;
  }
  log(`  restored ${wrote} identity marker(s).`);
}
