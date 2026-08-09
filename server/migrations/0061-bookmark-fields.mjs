// server/migrations/0061-bookmark-fields.mjs
//
// The fields a BOOKMARK record needs, so a dropped link can become real data
// rather than prose (user, 2026-08-09: a bookmark should be "a real record with
// fields" — filterable, feedable, visible in dropdowns).
//
// ── WHY THIS NEEDS A MIGRATION AT ALL ───────────────────────────────────────
//
// Measured on poms grid before writing anything:
//
//   field types in use   occurrence 43 · text 42 · number 52 · date 11 ·
//                        select 14 · boolean 2 · rating 3 · duration 2 · address 1
//   name "Title"         FREE  (only "Job Title" exists — a different name)
//   name "URL"           FREE
//   name "Notes"         EXISTS, type text, input-enabled, bound by ZERO modules
//   media-role bindings  all 207 point at "Poster"
//
// So this adds exactly TWO fields and REUSES two. Adding a second "Notes" would
// break the standing unique-field-names rule (2026-07-14) and duplicate a field
// that is already sitting unused — `gridIntegrity` warns about exactly that.
//
// ── THE FACE IS AN ARTIFACT, NOT A URL ──────────────────────────────────────
//
// `Poster` carries the media role, and `primaryMediaOf` deliberately has NO
// legacy-string fallback (its own header: "a passthrough would render an
// unmigrated grid correctly and hide the fact that it was never migrated"). So
// a favicon URL written straight into Poster would resolve to nothing. The
// intake route mints a remote-ref image artifact for it — the same shape the
// Wikipedia importer already uses for external images — and stores THAT
// occurrence id. Nothing about that is this migration's business; it only has
// to leave `Poster` alone, which it does.
//
// ── ADDITIVE BY CONSTRUCTION ────────────────────────────────────────────────
//
// Two CREATEs and nothing else. It moves no occurrence, rewrites no value and
// binds no module, so unlike every migration that has damaged this grid there
// is no selector that can match the wrong thing. Re-running is a no-op: each
// field is matched by NAME AND TYPE before being created.

export const id = "0061-bookmark-fields";
export const describe =
  "Adds the two text fields a bookmark record needs — Title and URL. Reuses the "
  + "existing (unbound) Notes field and the Poster media field. Creates nothing "
  + "else, changes nothing existing.";

/** Name + type, so a same-named field of another type is never mistaken for it. */
export const BOOKMARK_FIELDS = [
  { name: "Title", type: "text" },
  { name: "URL", type: "text" },
];

export async function up({ gridId, models, log, dryRun }) {
  const { Field } = models;
  const userId = (await Field.findOne({ gridId }).lean())?.userId || null;
  if (!userId) { log("REFUSING: no field on this grid to read a userId from"); return; }

  const existing = await Field.find({ gridId }).lean();
  const has = (name, type) => existing.find(
    (f) => (f.name || "").trim().toLowerCase() === name.toLowerCase() && f.type === type,
  ) || null;

  // Reused, not created. Named here so the log says what the shape depends on
  // even when this migration does nothing.
  for (const [label, found] of [["Notes", has("Notes", "text")], ["Poster", has("Poster", "text")]]) {
    log(found ? `reusing existing ${label} (${found.id})` : `NOTE: no ${label} field — the bookmark shape will bind one fewer value`);
  }

  let created = 0;
  for (const spec of BOOKMARK_FIELDS) {
    const found = has(spec.name, spec.type);
    if (found) { log(`skip ${spec.name} [${spec.type}] — already exists (${found.id})`); continue; }
    // A same-NAME field of a different type is a genuine collision the unique
    // rule forbids, so refuse rather than mint a duplicate name.
    const clash = existing.find((f) => (f.name || "").trim().toLowerCase() === spec.name.toLowerCase());
    if (clash) {
      log(`REFUSING ${spec.name}: a field of that name already exists with type "${clash.type}"`);
      continue;
    }
    log(`create ${spec.name} [${spec.type}]`);
    if (!dryRun) {
      await Field.create({
        id: crypto.randomUUID(), userId, gridId,
        name: spec.name, type: spec.type,
        inputEnabled: true, displayEnabled: false,
      });
    }
    created++;
  }
  log(`${dryRun ? "would create" : "created"} ${created} field(s)`);
}
