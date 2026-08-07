// server/migrations/0052-add-keith-and-angela.mjs
//
// Add two REAL people to the People board: **Keith** (therapist) and **Angela**.
// User's ask, 2026-08-07, alongside the real appointments and due-dated tasks:
//
//   "Therapy with Keith is on Aug 10th at 2:00pm until 3 … at location Dewey
//    center" / "Talk to Angela about Vivance Due Aug 11th"
//   "also add those people to the people list we have (keith and angela)"
//
// ── WHY A MIGRATION FOR WHAT LOOKS LIKE CONTENT ─────────────────────────────
//
// Adding a person IS expressible in the app, so by the standing rule this would
// be content, not structure. It runs here for one reason: poms grid is protected
// live data and the migration runner auto-snapshots before any write. That
// snapshot is the whole value — a hand-run script against the live grid is the
// exact shape of the 2026-07-28 incident where verifying a guard dropped the
// live grid.
//
// ── THE SHAPE IS DERIVED, NOT ENUMERATED ────────────────────────────────────
//
// A person module on this grid binds ~24 fields (name, email, phone, gender,
// relationship, birthday, city, address, employer, title, socials, favourite
// food, allergies, interests, how-we-met, emergency contact, notes…). Listing
// those ids here would bake a snapshot of today's schema into a file that runs
// tomorrow. Instead this reads an EXISTING person's module and copies its
// `fieldBindings` verbatim, and resolves the few fields it actually writes BY
// NAME. If the People board gains a field next week, a person added by this
// migration still has it bound.
//
// ── WHAT IT DELIBERATELY DOES NOT DO: INVENT ANYTHING ───────────────────────
//
// The seeded people carry full dossiers — emails, phone numbers, street
// addresses, birthdays, allergies. **Keith and Angela get none of that, because
// nobody told me any of it.** Writing a plausible-looking phone number into a
// real contact list is the worst kind of wrong: it is indistinguishable from
// data the user entered, it will be trusted, and it is false. Only three things
// are written, and all three come from what the user actually said:
//
//   • the person's NAME
//   • the two identity tags every person on this board carries (so the board's
//     feed and every People dropdown can see them)
//   • a NOTE recording the one fact stated about them
//
// Everything else is left empty for the user to fill in the app, which is where
// contact details belong.
//
// ── IDEMPOTENT, AND IT MATCHES ON NAME WITHIN THE BOARD ─────────────────────
//
// Re-running finds the person by name AMONG THE PEOPLE BOARD'S CHILDREN and
// skips. Scoping the match to the board matters: "Angela" could legitimately be
// the label of something else on this grid, and a global name match would then
// silently decide it already existed. Same class of error as 0035's selector.

export const id = "0052-add-keith-and-angela";

/** What the user actually told us. Nothing beyond this is written. */
const PEOPLE = [
  {
    name: "Keith",
    note: "Therapist. Sessions at the Dewey Center.",
  },
  {
    name: "Angela",
    note: "Talk to about Vivance.",
  },
];

const uid = () => (globalThis.crypto?.randomUUID?.()
  || `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;

  // ── Locate the People board container ────────────────────────────────────
  // By its MODULE (role container, label "People"), then its occurrence. There
  // are two container modules labelled "People" on poms grid, so the one that
  // is accepted is the one whose occurrence actually holds the people.
  const peopleMods = await Module.find({
    gridId, role: "container", label: "People",
  }).select({ id: 1 }).lean();
  if (!peopleMods.length) {
    log("no People container module on this grid — nothing to do");
    return;
  }

  const candidates = await Occurrence.find({
    gridId, moduleId: { $in: peopleMods.map(m => m.id) },
  }).lean();
  // The real board is the one with children. A bare duplicate has none.
  const board = candidates
    .slice()
    .sort((a, b) => (b.occurrences?.length || 0) - (a.occurrences?.length || 0))[0];
  if (!board || !(board.occurrences || []).length) {
    log("found no People container occurrence holding people — refusing to guess");
    return;
  }
  const userId = board.userId;
  log(`People board ${board.id} — ${(board.occurrences || []).length} people`);

  // ── Derive the person SHAPE from someone already on the board ────────────
  const existingOccs = await Occurrence.find({
    gridId, id: { $in: board.occurrences },
  }).lean();
  const exemplarOcc = existingOccs.find(o => o.moduleId);
  const exemplarMod = exemplarOcc
    ? await Module.findOne({ gridId, id: exemplarOcc.moduleId }).lean()
    : null;
  if (!exemplarMod) {
    log("no exemplar person to copy the shape from — refusing to invent one");
    return;
  }
  const fieldBindings = exemplarMod.fieldBindings || [];
  log(`copying the shape of "${exemplarMod.label}" — ${fieldBindings.length} field bindings`);

  // ── Resolve the fields we write FROM THE EXEMPLAR, not by name ───────────
  // The first draft guessed "Person Name" and the field is called "Name" — the
  // dry run refused rather than writing a nameless person, which is the point of
  // failing closed. Guessing at all was the mistake: every field here is
  // identified by the VALUE it holds on a known-good person, so a rename cannot
  // break it and there is no ambiguity with some other field also called "Name".
  const exFields = exemplarOcc.fields || {};
  const valueOf = (fid) => exFields[fid]?.value;

  //  the name field = the one holding the exemplar's own label
  const nameFid = Object.keys(exFields)
    .find(fid => valueOf(fid) === exemplarMod.label) || null;
  //  the library tag = the one holding the literal "person"
  const libraryFid = Object.keys(exFields)
    .find(fid => valueOf(fid) === "person") || null;
  //  the board tag = the one holding ["person"]
  const categoryFid = Object.keys(exFields)
    .find(fid => Array.isArray(valueOf(fid)) && valueOf(fid).includes("person")) || null;
  //  notes is the one field worth a name lookup — it holds free prose, so there
  //  is no value to recognise it by.
  const fields = await Field.find({ gridId }).select({ id: 1, name: 1 }).lean();
  const notesFid = fields.find(f => (f.name || "").toLowerCase() === "person notes")?.id || null;

  log(`fields: name=${nameFid} notes=${notesFid} category=${categoryFid} library=${libraryFid}`);
  if (!nameFid) {
    log("could not identify the name field from the exemplar — refusing to add a nameless person");
    return;
  }

  const existingNames = new Set(
    existingOccs
      .map(o => o.fields?.[nameFid]?.value)
      .filter(Boolean)
      .map(v => String(v).toLowerCase()),
  );

  const stamp = () => ({ flow: "in", timestamp: new Date().toISOString() });
  const newIds = [];

  for (const person of PEOPLE) {
    if (existingNames.has(person.name.toLowerCase())) {
      log(`SKIP  ${person.name} — already on the People board`);
      continue;
    }

    const modId = uid();
    const occId = uid();
    const personFields = {
      [nameFid]: { value: person.name, ...stamp() },
      ...(notesFid ? { [notesFid]: { value: person.note, ...stamp() } } : {}),
      ...(categoryFid ? { [categoryFid]: { value: ["person"], ...stamp() } } : {}),
      ...(libraryFid ? { [libraryFid]: { value: "person", ...stamp() } } : {}),
    };

    log(`ADD   ${person.name}  (module ${modId}, occurrence ${occId})`);
    log(`        note: ${person.note}`);

    if (dryRun) { newIds.push(occId); continue; }

    await new Module({
      id: modId, userId, gridId,
      role: "instance",
      label: person.name,
      defaultDragMode: "copy",
      fieldBindings,
    }).save();

    await new Occurrence({
      id: occId, userId, gridId,
      moduleId: modId,
      targetId: modId, targetType: "module",
      parentId: board.id,
      fields: personFields,
      occurrences: [],
    }).save();

    newIds.push(occId);
  }

  if (!newIds.length) {
    log("nothing to add — both people already present");
    return;
  }

  // Link into the board's own list. `$push` with a `$ne` guard rather than a
  // whole-array write: the array is the render order and a read-modify-write
  // here is the shape that produced the 2026-08-04 dangling-ref class.
  if (!dryRun) {
    for (const occId of newIds) {
      await Occurrence.updateOne(
        { id: board.id, userId, occurrences: { $ne: occId } },
        { $push: { occurrences: occId } },
      );
    }
  }
  log(`${dryRun ? "would link" : "linked"} ${newIds.length} into the People board`);
}
