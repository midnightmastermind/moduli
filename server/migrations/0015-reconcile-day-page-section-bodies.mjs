// Wreckage left by the auto-create focus race (fixed in the same commit as this
// migration): when the caret failed to reach a freshly created textblock, the
// next keystroke created ANOTHER one, and the container's textmap and its
// occurrences[] drifted apart. On the live day page that left:
//
//   Journal      two textblocks the user typed, listed as children but embedded
//                NOWHERE — their text existed and could not be seen.
//   Notes        a textblock embedded in the body but not listed as a child.
//   Highlights   an embed pointing at an occurrence that no longer exists.
//
// This reconciles the two views of the same content, for every doc container on
// a day page:
//   * an embed naming no occurrence is dropped (nothing to render),
//   * a child textblock that is embedded nowhere is appended so its text is
//     visible again — content is never deleted to make the two agree,
//   * an embedded textblock missing from occurrences[] is listed.
//
// Written as a rule over the CURRENT state rather than a list of ids, so it is
// idempotent and repairs any day page that drifted, not just today's.

import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0015-reconcile-day-page-section-bodies";
export const describe =
  "Reconciles day-page section containers whose textmap and child list disagree: drops embeds that " +
  "name no occurrence, re-embeds child textblocks that render nowhere, and lists embedded textblocks " +
  "that are missing from occurrences[]. Deletes no user content.";

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;

  const dayPageMods = await Module.find({ gridId, role: "page", label: /^Day Page/ }).select({ id: 1 }).lean();
  if (!dayPageMods.length) { log("no day pages on this grid"); return; }
  const pages = await Occurrence.find({ gridId, moduleId: { $in: dayPageMods.map(m => m.id) } })
    .select({ id: 1, occurrences: 1 }).lean();

  const sectionIds = pages.flatMap(p => p.occurrences || []);
  const sections = await Occurrence.find({ gridId, id: { $in: sectionIds } })
    .select({ id: 1, moduleId: 1, occurrences: 1, textmap: 1 }).lean();
  const mods = await Module.find({ gridId, id: { $in: sections.map(s => s.moduleId) } })
    .select({ id: 1, label: 1, kind: 1 }).lean();
  const labels = new Map(mods.map(m => [m.id, m]));

  let touched = 0;
  for (const sec of sections) {
    const mod = labels.get(sec.moduleId);
    if (mod?.kind !== "doc") continue;                       // only bodies that hold a textmap
    const tm = decompressTextmap(sec.textmap) || {};
    const content = Array.isArray(tm.content) ? tm.content : [];
    const kids = sec.occurrences || [];

    const embedded = content
      .map(n => n?.attrs?.occurrenceId)
      .filter(ref => typeof ref === "string" && ref && !ref.startsWith("$"));
    const rows = await Occurrence.find({ gridId, id: { $in: [...embedded, ...kids] } })
      .select({ id: 1, moduleId: 1 }).lean();
    const live = new Map(rows.map(o => [o.id, o]));

    const dangling = content.filter(n => {
      const ref = n?.attrs?.occurrenceId;
      return ref && !live.has(ref);
    });
    const unrendered = kids.filter(k => live.has(k) && !embedded.includes(k));
    const unlisted = embedded.filter(e => live.has(e) && !kids.includes(e));
    if (!dangling.length && !unrendered.length && !unlisted.length) continue;

    const name = `${mod?.label || "(section)"} ${sec.id.slice(0, 8)}`;
    if (dangling.length) log(`  ${name}: dropping ${dangling.length} embed(s) that name no occurrence`);
    if (unrendered.length) log(`  ${name}: re-embedding ${unrendered.length} child textblock(s) that render nowhere`);
    if (unlisted.length) log(`  ${name}: listing ${unlisted.length} embedded textblock(s) as children`);
    touched++;
    if (dryRun) continue;

    // Keep every node that still resolves, in its current order, then add the
    // ones that had no node at all — before the trailing blank paragraph TipTap
    // wants at the end of a body.
    const kept = content.filter(n => {
      const ref = n?.attrs?.occurrenceId;
      return !ref || live.has(ref);
    });
    const appended = unrendered.map(occId => ({
      type: "instanceTextblock",
      attrs: { instanceId: live.get(occId)?.moduleId ?? null, occurrenceId: occId },
    }));
    const paraIdx = kept.findIndex(n => n.type === "paragraph" && !n.content);
    const nextContent = paraIdx >= 0
      ? [...kept.slice(0, paraIdx), ...appended, ...kept.slice(paraIdx)]
      : [...kept, ...appended];

    await Occurrence.updateOne({ gridId, id: sec.id }, {
      $set: {
        textmap: { type: "doc", content: nextContent.length ? nextContent : [{ type: "paragraph" }] },
        occurrences: [...kids, ...unlisted],
      },
    });
  }

  log(touched
    ? `${touched} section(s) ${dryRun ? "would be" : ""} reconciled`
    : "every day-page section body already agrees with its child list");
}
