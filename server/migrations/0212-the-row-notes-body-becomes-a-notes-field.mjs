// 0212 — an instance row's notes body was stored in its own `textmap`, where
// nothing else could read it. It becomes the `Notes` FIELD.
//
// User 2026-08-23: *"could you make that an automatic thing like our question and
// answer. could you let the instances child textmap be a notes field on them."*
//
// The mechanism already exists and already ships — `bodyLink` is what makes the
// Daily Answer's editor write into a field instead of a textmap. This points the
// instance notes body at it. All that is stored is WHICH field.
//
// NOTHING IS STRANDED, measured at full depth rather than assumed. Of 1145
// instance occurrences exactly ONE carries a textmap, and read through
// `decompressTextmap` it holds two empty paragraphs — 0 characters. A raw scan
// would have reported "no text" for every row on the grid (textmaps are stored
// COMPRESSED), so the count means nothing until it is decompressed:
//
//     instance occurrences        1145
//       carrying a textmap           1     `Cook`
//       carrying any TEXT            0     <- nothing to migrate
//     `Notes` field              exists    bound by 0 modules, 0 values
//
// IT IS A GRID-LEVEL DEFAULT, NOT A BINDING ON 861 INSTANCE MODULES. "Every X"
// in a migration means every X that existed when it ran, so a module minted next
// month would silently miss it — the `0043` / `0064` / `0120` class this repo
// keeps paying for. One key on the grid covers every instance that will ever
// exist, and an occurrence or module binding still overrides it.
//
// **IT DECLARES NO `link`, AND THAT IS THE LOAD-BEARING DECISION.** A binding's
// `link` is the JOIN identity for cross-occurrence sync: Daily Answer links on
// the DATE, so every answer for one day stays in step. Reusing that here would
// be data destruction — every instance row on a given day would carry the same
// `Notes` field, so typing a note on one row would paste it onto every other row
// dated the same day. The notes body is PER-ROW; `findLinkedSiblings` refuses to
// fan out a link-less binding, and a test pins that in the dangerous direction.
//
// Resolved by NAME **and TYPE**, because this grid carries duplicate field names
// (2026-08-08, the two fields called `Due`) — and it REFUSES rather than guessing
// if the name is ambiguous. `Person Notes` is a different field and is untouched.
export const id = "0212-the-row-notes-body-becomes-a-notes-field";
export const description =
  "Point the instance notes body at the `Notes` field (grid.meta.instanceBodyLink) — it was writing to a textmap nothing could read";

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Grid, Occurrence, Module } = models;

  const candidates = await Field.find({ gridId, name: "Notes", type: "text" }).lean();
  if (candidates.length !== 1) {
    log(`  expected exactly ONE text field named "Notes", found ${candidates.length} — REFUSING`);
    return { set: 0, refused: true };
  }
  const notes = candidates[0];
  log(`  Notes = ${notes.id} (text, input=${notes.inputEnabled}, display=${notes.displayEnabled})`);

  // Report what the body currently holds, so a run that WOULD strand something
  // says so out loud instead of being discovered later. Textmaps are stored
  // compressed, so a length check on the raw value is meaningless — this counts
  // presence only, and the header records the decompressed reading.
  const instanceModuleIds = new Set(
    (await Module.find({ gridId, role: "instance" }).select("id").lean()).map((m) => m.id)
  );
  const withTextmap = await Occurrence.find({
    gridId,
    moduleId: { $in: [...instanceModuleIds] },
    textmap: { $ne: null },
  })
    .select("id moduleId")
    .lean();
  log(`  ${instanceModuleIds.size} instance module(s); ${withTextmap.length} instance occurrence(s) carry a textmap`);
  for (const o of withTextmap.slice(0, 5)) log(`    ${o.id}`);

  const grid = await Grid.findById(gridId).select("meta").lean();
  const existing = grid?.meta?.instanceBodyLink;
  if (existing?.selfField === notes.id) {
    log("  already points at Notes — nothing to do");
    return { set: 0, alreadyDone: true };
  }
  if (existing) log(`  REPLACING an existing binding: ${JSON.stringify(existing)}`);

  // No `link` key at all — see the header. Its absence is the feature.
  const next = { selfField: notes.id };
  log(`${dryRun ? "[dry run] " : ""}set grid.meta.instanceBodyLink = ${JSON.stringify(next)}`);
  if (!dryRun) {
    await Grid.updateOne({ _id: gridId }, { $set: { "meta.instanceBodyLink": next } });
  }
  return { set: 1 };
}
