/**
 * 0204 — the codex pages render blank, because a DOC page draws its textmap.
 *
 * `0203` minted all 75 pages as `role:"page" kind:"doc"` and listed the
 * imported root in `occurrences[]`. `PageDoc` renders the occurrence's TEXTMAP
 * through a TipTap editor and **never reads `occurrences[]`** — so every one of
 * those pages opens as an empty editor while its content sits in the database,
 * complete and unreachable.
 *
 * That is the listed-but-not-embedded class this repo has repaired from five
 * directions, and `0203`'s own commit message quoted it while shipping it.
 * Found by opening a page in a browser; no test and no data check could see it,
 * because the DATA is correct — only the renderer disagrees.
 *
 * `PageBoard` renders child containers, which is exactly what these pages hold:
 * one imported root apiece. `0199` reached the same answer for the Bookmarks
 * page.
 *
 * ── IT CHANGES THE MODULE'S `kind` AND NOTHING ELSE ────────────────────────
 *
 * No occurrence moves, no field is rewritten, no content is touched. The pages
 * are found by the marker `0203` left (`meta.codexPath` on the occurrence), not
 * by label — 75 pages named after files, several sharing a basename.
 */
export const id = "0204-codex-pages-are-boards";
export const describe =
  "Codex pages render blank: a `doc` page draws its textmap and ignores its children. Flip the 75 page modules to `kind: \"board\"`, which renders them.";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const pages = await Occurrence.find({ gridId, "meta.codexPath": { $exists: true } }).lean();
  if (!pages.length) { log("  nothing to do — no codex pages on this grid"); return; }

  const mods = await Module.find({ gridId, id: { $in: pages.map((p) => p.moduleId) } }).lean();
  const wrong = mods.filter((m) => m.role === "page" && m.kind !== "board");
  const already = mods.length - wrong.length;
  log(`  ${pages.length} codex page(s): ${wrong.length} to flip to board, ${already} already correct`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }
  if (!wrong.length) return;

  for (let i = 0; i < wrong.length; i += 500) {
    await Module.bulkWrite(wrong.slice(i, i + 500).map((m) => ({
      updateOne: { filter: { id: m.id, gridId }, update: { $set: { kind: "board" } } },
    })));
  }
  log(`  done — ${wrong.length} page module(s) now render their children`);
}
