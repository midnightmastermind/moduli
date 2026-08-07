// server/migrations/0051-file-homeless-artifacts.mjs
//
// Give every HOMELESS file a home in Files/<kind>. Task 4 Step 4.
//
// ── THE PREDICATE, AND WHY IT IS NARROWER THAN "FILE THE ARTIFACTS" ─────────
//
// Measured on the live grids before this was written, because 0035's lesson is
// that a selector matching "things that look like X" moves the user's real work:
//
//   poms grid    234 artifact occurrences   223 homeless files · 6 quotes · 5 placed
//   test grid 2  193 artifact occurrences   188 homeless files · 0 quotes · 5 placed
//
// So there are three populations, and only ONE of them should move:
//
//   1. **No `parentId` AND the module has a `fileRef`** → MOVE. These are files
//      that live nowhere: no folder, and (for 219 of poms grid's) not even
//      listed by a parent's `occurrences[]`. They are reachable today only
//      through a doc's textmap embed — the "ancestry orphan" class this repo
//      named on 2026-06-15. Filing them takes them from nowhere to somewhere;
//      nothing is moved OUT of anywhere.
//
//   2. **No `fileRef`** → SKIP. `kind:"quote"` artifacts are pull-quotes carrying
//      `meta.quote`, with no file behind them (services/markdownImporter.js).
//      **A thing with no file is not a FILE**, and filing it would put imported
//      prose in the user's Documents folder. 6 on poms grid.
//
//   3. **Already has a `parentId`** → SKIP, and this is the one that matters.
//      Those artifacts were PLACED — on poms grid all five sit in the "Examples"
//      folder (Blue Marble, Pillars of Creation, Earthrise, W3C dummy.pdf, Big
//      Buck Bunny). Moving them into Files would be exactly the mistake 0035
//      made when it swept a real project page out of its folder because the page
//      resembled a template. A folder the user chose outranks this rule.
//
// ── WHY THIS CANNOT HIDE A FILE ─────────────────────────────────────────────
//
// The one shape that would make a move destructive is an artifact whose ONLY
// structural link is a NON-FOLDER `parentId` — moving it would remove it from
// the container that renders it. **Measured: zero such artifacts on any of the
// three grids**, and the predicate excludes anything with a parentId anyway, so
// the class is doubly out of scope. Everything moved here has parentId null, and
// a textmap `moduleEmbed` resolves its occurrence by id, so every embed keeps
// rendering exactly as before.
//
// ── EVERY ONE OF THESE IS A REAL FILE. A RETRACTED CLAIM, RECORDED. ────────
//
// The first version of this header said 213 of poms grid's 223 were
// "unreachable dead rows" and held the migration back on that basis. **That was
// WRONG**, and the user caught it: *"theres way more than 16. we have the
// instance pictures too dont we and also wtf are those 213, those are probably
// ones to be connected back in."*
//
// The error was in the REACHABILITY DEFINITION, not the data. The scan looked
// for textmap embeds and `occurrences[]` membership and called everything else
// unreachable — **it never looked at FIELD VALUES, which is exactly where an
// instance picture lives.** Re-measured properly:
//
//     embedded in a doc textmap        10
//     referenced by a FIELD value     213
//     unreachable                       0
//
// The 213 are movie posters and book covers, held by the `Poster` and `Files`
// fields on the library items themselves (Inception → Inception poster, The
// Matrix → The Matrix poster, …). They are live, visible, in-use files whose
// occurrences simply never had a folder — which is the precise condition this
// migration exists to fix. So all 223 are filed, and Files opens as a real
// library of every file on the grid.
//
// **The lesson is the one this repo keeps paying for: a probe that reports
// "nothing references these" is a claim about the PROBE until you have checked
// every way a reference can be expressed.** An occurrence here can be reached by
// a textmap embed, a parent's `occurrences[]`, OR a field value — and a scan
// that knows about two of the three will confidently mislabel the third.
//
// IDEMPOTENT: a moved file now HAS a parentId, so a re-run matches nothing.
// Reversible: every moved row's prior parentId was null.

import { resolveFilesFolderId, filesSubfolderForKind } from "../utils/filesFolder.js";

export const id = "0051-file-homeless-artifacts";

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Folder, Manifest } = models;

  const manifest = await Manifest.findOne({ gridId, manifestType: "user" }).lean();
  if (!manifest?.rootFolderId) { log(`no user manifest on grid ${gridId} — nothing to do`); return; }
  const userId = manifest.userId;

  // The Files folder must already exist (migration 0049). REFUSE rather than
  // invent one: a file written to the wrong folder is data loss that presents
  // as a missing file, and half-filing is worse than not filing.
  const folders = await Folder.find({ gridId, userId }).lean();
  const uc = { foldersById: Object.fromEntries(folders.map(f => [f.id, f])) };
  if (!resolveFilesFolderId(uc, { gridId, userId })) {
    log(`no Files folder on this grid — run 0049 first. NOTHING MOVED.`);
    return;
  }

  const mods = await Module.find({ gridId, userId, role: "artifact" }).lean();
  const modById = Object.fromEntries(mods.map(m => [m.id, m]));
  const occs = await Occurrence.find({
    gridId, userId, moduleId: { $in: mods.map(m => m.id) },
  }).lean();

  const perSub = {};
  const skippedPlaced = [];
  const skippedNoFile = [];
  let moved = 0;

  for (const occ of occs) {
    const mod = modById[occ.moduleId];
    if (!mod?.fileRef) { skippedNoFile.push(mod?.kind || "?"); continue; }
    if (occ.parentId) { skippedPlaced.push(mod.label || occ.id); continue; }

    const sub = filesSubfolderForKind(mod.kind);
    const target = resolveFilesFolderId(uc, { gridId, userId, kind: mod.kind });
    if (!target) { log(`  no target folder for kind "${mod.kind}" — skipping ${occ.id}`); continue; }

    perSub[sub] = (perSub[sub] || 0) + 1;
    moved += 1;
    if (!dryRun) {
      await Occurrence.updateOne({ id: occ.id, userId }, { $set: { parentId: target } });
    }
  }

  log(`MOVE ${moved} homeless file(s) into Files:`);
  for (const [sub, n] of Object.entries(perSub).sort()) log(`   ${sub}: ${n}`);
  if (skippedNoFile.length) {
    const kinds = [...new Set(skippedNoFile)].join(", ");
    log(`SKIP ${skippedNoFile.length} artifact(s) with no fileRef (${kinds}) — not files`);
  }
  if (skippedPlaced.length) {
    // NAMED, not counted — the whole point of the dry run is that a human can
    // recognise these as things they placed on purpose.
    log(`SKIP ${skippedPlaced.length} already placed: ${skippedPlaced.slice(0, 10).join(" | ")}`);
  }
  log(dryRun ? "DRY RUN — nothing written" : "applied");
}
