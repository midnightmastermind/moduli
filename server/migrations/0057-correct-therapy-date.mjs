// server/migrations/0057-correct-therapy-date.mjs
//
// USER 2026-08-08: "it wasnt on aug 7th btw, it is in the future. just set it
// for the 17th for now."
//
// `0055` entered a Therapy with Keith session on 2026-08-07 from the user's
// original note. That date was wrong — the session is upcoming, not past. Moves
// it to 2026-08-17, same 1:00pm start and same hour length.
//
// ── WHY A MIGRATION FOR ONE FIELD ───────────────────────────────────────────
//
// By the standing rule this is CONTENT and belongs in the app. It runs here for
// the same reason 0052 and 0055 did: poms grid is protected live data and the
// runner auto-snapshots before any write. Editing a live row by hand is the
// shape of the 2026-07-28 incident.
//
// ── IT MATCHES ONE ROW, AND REFUSES IF IT CANNOT BE SURE ────────────────────
//
// There are TWO appointments labelled "Therapy with Keith" — Aug 10 and the
// wrong one. Matching on the label alone would hit both, so the selector is
// label AND the exact stale date, and it REFUSES if that does not resolve to
// exactly one row. A migration that "looks like it found the right thing" is
// how 0035 moved the user's real project page.
//
// Nothing else moves: the time, duration, location, person and type are all
// still what the user said. Only the day changes.

export const id = "0057-correct-therapy-date";

const LABEL = "Therapy with Keith";
const FROM = "2026-08-07";
const TO = "2026-08-17";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Field } = models;

  const fDate = (await Field.find({ gridId }).lean())
    .find((f) => (f.name || "").trim().toLowerCase() === "date" && f.type === "date");
  if (!fDate) { log("REFUSING: no date field named Date"); return; }

  // The label lives on the OCCURRENCE (0055 used the per-placement override,
  // because all three appointments share the one Appointment module).
  const candidates = await Occurrence.find({
    gridId, label: LABEL, [`fields.${fDate.id}.value`]: FROM,
  }).lean();

  if (!candidates.length) {
    const already = await Occurrence.countDocuments({
      gridId, label: LABEL, [`fields.${fDate.id}.value`]: TO,
    });
    log(already
      ? `nothing to do — "${LABEL}" is already on ${TO}`
      : `nothing to do — no "${LABEL}" on ${FROM}`);
    return;
  }
  if (candidates.length > 1) {
    log(`REFUSING: ${candidates.length} rows match "${LABEL}" on ${FROM} — ambiguous`);
    return;
  }

  const occ = candidates[0];
  log(`MOVE   "${LABEL}"  ${FROM} → ${TO}   (occurrence ${occ.id})`);
  log(`         time and duration unchanged: ${occ.fields?.[Object.keys(occ.fields).find((k) => typeof occ.fields[k]?.value === "string" && /(am|pm)$/.test(occ.fields[k].value))]?.value || "?"}`);

  if (dryRun) return;

  // Field-path $set, never a whole-`fields` write: the row carries location,
  // person, type, duration and completion, and replacing the object would drop
  // whatever this migration did not think to copy.
  await Occurrence.updateOne(
    { gridId, id: occ.id },
    { $set: { [`fields.${fDate.id}.value`]: TO, [`fields.${fDate.id}.timestamp`]: new Date().toISOString() } },
  );
  log("done");
}
