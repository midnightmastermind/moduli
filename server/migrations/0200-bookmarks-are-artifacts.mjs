/**
 * 0200 — the imported bookmarks become ARTIFACTS, which is what they always were.
 *
 * USER, seeing `0199`'s rows: *"make it more like a page preview type thing
 * where the view can be an entire page or a preview of it (we dont need to load
 * an iframe tho). so its not tech an instance"* — then, decisively: ***"an
 * artifact is its own module type now i thought"***.
 *
 * They are right, and `0199` was wrong. `role: "artifact"` is the module type
 * for a thing with content of its own; it is kind-bearing
 * (`KIND_BEARING_ROLES`), and its layout cascade already declares exactly the
 * two views described:
 *
 *     artifact   dragInView: "actual"   navOptions: ["preview", "actual"]
 *
 * *"the view can be an entire page or a preview of it"* IS that line. So a
 * bookmark is an artifact whose `fileRef` is a URL: `preview` renders its card
 * (no iframe, which is the other half of the ask) and `actual` renders the page.
 *
 * ── WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT ────────────────────
 *
 * Only the MODULE moves: `role: instance -> artifact`, `kind: "bookmark"`, and
 * `fileRef` gains the URL the row already carries in its `URL` field.
 *
 * **The `URL` FIELD IS KEPT.** `fileRef` is what the renderer reads; the field
 * is what a person edits, what the board can filter on, and what
 * `helpers/occurrenceUrl` finds for any row. Dropping it would make the URL
 * invisible in the UI and unfilterable — and `occurrenceUrl` already prefers a
 * named field over a `fileRef`, so the two agree.
 *
 * Occurrences are untouched: same ids, same fields, same parent, same order. A
 * role change on the module is the whole migration.
 *
 * ── IT FINDS ITS ROWS BY THE MARKER `0199` LEFT, not by label ───────────────
 *
 * `meta.raindropId` starting `b:`. A label match would sweep any row a person
 * happened to name after a bookmark, and this grid has already been bitten by
 * two modules sharing the label `Workout Log` (2026-08-23).
 */
export const id = "0200-bookmarks-are-artifacts";
export const describe =
  "Turn the imported bookmark rows into artifacts (kind \"bookmark\", fileRef = the URL) so they get the preview/actual views an artifact already has. Keeps the URL field.";

/** The module patch for one bookmark row, or null when it is already right. */
export function artifactPatch(module, url) {
  if (!module || !url) return null;
  if (module.role === "artifact" && module.kind === "bookmark" && module.fileRef === url) return null;
  return { role: "artifact", kind: "bookmark", fileRef: url };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const urlField = (await Field.find({ gridId, name: "URL" }).lean())[0];
  if (!urlField) { log("  REFUSING: no `URL` field on this grid"); return; }

  const rows = await Occurrence.find({ gridId, "meta.raindropId": { $regex: "^b:" } }).lean();
  if (!rows.length) { log("  nothing to do — no imported bookmark rows"); return; }
  const mods = new Map((await Module.find({ gridId, id: { $in: rows.map((r) => r.moduleId) } }).lean())
    .map((m) => [m.id, m]));

  const edits = [];
  let already = 0, noUrl = 0;
  for (const r of rows) {
    const url = r.fields?.[urlField.id]?.value;
    if (typeof url !== "string" || !url) { noUrl++; continue; }
    const patch = artifactPatch(mods.get(r.moduleId), url);
    if (!patch) { already++; continue; }
    edits.push({ id: r.moduleId, patch });
  }
  log(`  ${rows.length} imported bookmark(s): ${edits.length} to convert, ${already} already artifacts, ${noUrl} with no URL (left alone)`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }
  for (let i = 0; i < edits.length; i += 500) {
    await Module.bulkWrite(edits.slice(i, i + 500).map((e) => ({
      updateOne: { filter: { id: e.id, gridId }, update: { $set: e.patch } },
    })));
  }
  log(`  done — ${edits.length} module(s) are now bookmark artifacts; occurrences and the URL field untouched`);
}
