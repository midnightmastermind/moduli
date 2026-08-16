// server/migrations/0133-files-binding-role.mjs
//
// User, 2026-08-16: "clicking on a profile picture for an ingrediant is still
// only showing one file. in the spread."
//
// ── THE PICTURES WERE NEVER MISSING — THE BINDING'S ROLE WAS WRONG ──────────
// `0131` attached three alternatives to every ingredient and `0132` carried
// them to the feed copies. Both wrote the VALUE. But the client does not read
// the value by field name — `occurrenceMedia.filesFieldIdFor` asks the MODULE
// which of its bindings has `role: "files"`, and returns nothing when none
// does. So the ids sat on the occurrence, correct and complete, and the spread
// could not find the field they were in:
//
//     role "files"  21 rows   holds 4 files   spread opens 4   ✅
//     role "input"  28 rows   holds 4 files   spread opens 1   ❌
//     no binding     1 row    holds 3 files   spread opens 0   ❌
//
// The one window that did open is the Poster, which resolves through a
// DIFFERENT binding (`role: "media"`) — the one `0129` already repaired. This
// is that same defect one field over: `0120` bound Files as a plain input, and
// nothing since re-roled it.
//
// **The measurement is the proof, not the reasoning**: every row on the right
// role shows four, every row on the wrong role shows one, with no exceptions
// in either direction. There is no other variable between the two groups.
//
// ── IT RE-ROLES, IT DOES NOT RE-ATTACH ──────────────────────────────────────
// No picture is created, moved or deleted here. The only write is the binding's
// `role`, plus a binding ADDED where one is missing entirely. A row whose Files
// list is empty is left alone — giving it a role changes nothing and would
// inflate the count past what was measured.
//
// ── WHY FIXING THE MODULE FIXES THE COPIES TOO ──────────────────────────────
// A feed copy reads its SOURCE's module, so the 14 broken copies and their 14
// broken sources are the same ~15 modules. That is also why this cannot be
// fixed on the occurrence: the role lives on the module by design.
export const id = "0133-files-binding-role";
export const describe =
  "Ingredient Files bindings are role:files so every attached photo reaches the spread.";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";
  // Discriminate on displayEnabled: a display twin of the same name would be a
  // different field with the same label (the `0053` two-"Due" trap).
  const FILES = fields.find((f) => f.name === "Files" && !f.displayEnabled)?.id;
  const TAG = fields.find((f) => f.name === "Board Category")?.id;
  if (!FILES || !TAG) { log(`REFUSING: missing Files / Board Category.`); return; }

  const tagsOf = (o) => { const v = o.fields?.[TAG]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const listOf = (o) => { const v = o.fields?.[FILES]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const isIngredientRow = (o) =>
    modById.get(o.moduleId)?.role === "instance" &&
    (tagsOf(o).includes("ingredient") || tagsOf(o).includes("grocery"));

  // One entry per MODULE — several occurrences (a source and its feed copies)
  // share one, and the role lives there.
  const plan = new Map();
  let alreadyRight = 0, noFiles = 0;
  for (const o of occs) {
    if (!isIngredientRow(o)) continue;
    const m = modById.get(o.moduleId);
    const b = (m.fieldBindings || []).find((x) => x.fieldId === FILES);
    if (b?.role === "files") { alreadyRight++; continue; }
    // Nothing attached -> nothing to reveal. Skip rather than pad the count.
    if (listOf(o).length === 0) { noFiles++; continue; }
    if (!plan.has(m.id)) {
      plan.set(m.id, { mod: m, from: b ? (b.role || "(unset)") : "(no binding)", add: !b, rows: [] });
    }
    plan.get(m.id).rows.push({ name: nameOf(o), copy: !!o.meta?.feedSourceId, held: listOf(o).length });
  }

  const rowCount = [...plan.values()].reduce((n, p) => n + p.rows.length, 0);
  log(`ingredient rows already on role:"files": ${alreadyRight}`);
  log(`ingredient rows carrying no files (skipped): ${noFiles}`);
  log(`modules to re-role: ${plan.size}  (covering ${rowCount} row(s))`);
  for (const p of [...plan.values()].slice(0, 12)) {
    const src = p.rows.filter((r) => !r.copy).length, cp = p.rows.filter((r) => r.copy).length;
    log(`   ${(p.mod.label || p.mod.id).padEnd(26)} "${p.from}" -> "files"   ${src} source + ${cp} copy · holds ${p.rows[0].held}`);
  }
  if (plan.size > 12) log(`   … ${plan.size - 12} more`);
  if (!plan.size) { log(`every ingredient already reaches its files.`); return; }
  if (dryRun) { log(`WOULD re-role ${plan.size} module binding(s).`); return; }

  for (const p of plan.values()) {
    const cur = p.mod.fieldBindings || [];
    // Hidden: the picture renders through the media/spread path, so an inline
    // list of artifact ids on the row would be noise. Matches how the seed's
    // own ingredients carry it.
    const next = p.add
      ? [...cur, { fieldId: FILES, role: "files", hidden: true }]
      : cur.map((b) => (b.fieldId === FILES ? { ...b, role: "files" } : b));
    await Module.updateOne({ gridId, id: p.mod.id }, { $set: { fieldBindings: next } });
  }
  log(`re-roled ${plan.size} module(s).`);

  // Read the RESULT back, not the log: count the rows that can now reach more
  // than one file. That is the user-visible fact this migration exists for.
  const afterMods = await Module.find({ gridId }).lean();
  const am = new Map(afterMods.map((m) => [m.id, m]));
  let reach = 0, still = 0;
  for (const o of occs) {
    if (!isIngredientRow(o)) continue;
    const b = (am.get(o.moduleId)?.fieldBindings || []).find((x) => x.fieldId === FILES);
    const held = listOf(o).length;
    if (held > 1 && b?.role === "files") reach++;
    else if (held > 1) still++;
  }
  log(`  check: ${reach} row(s) now reach every attached file; ${still} still cannot.`);
}
