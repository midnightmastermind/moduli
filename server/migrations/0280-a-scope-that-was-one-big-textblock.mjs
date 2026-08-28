/**
 * 0280 — the project scope was one big textblock pretending to have sections.
 *
 * User, 2026-08-28: *"make the project scope textblocks fit our doc container ->
 * doc container -> textblock type schema. instead of one big textblock"*.
 *
 * Every project's scope was a SINGLE `role:"textblock"` occurrence carrying
 * eleven nodes — an H1, then five H2 headings each followed by its body:
 *
 *     heading(h1)  "Project Scope — Via Fluere"
 *     heading(h2)  "Overview"          paragraph  <- the real prose
 *     heading(h2)  "Goals"             bulletList
 *     heading(h2)  "Milestones"        bulletList
 *     heading(h2)  "Risks"             paragraph
 *     heading(h2)  "Success Criteria"  paragraph
 *
 * That is a document PRETENDING to have structure. The sections were HEADINGS,
 * so nothing could address one: a section could not be reordered, styled,
 * filtered, embedded elsewhere, given a field, or found by an operation. As
 * containers they are real occurrences, which is the shape the rest of the grid
 * already uses (Journal → Daily Question → the answer textblock).
 *
 * ── THE CONVERSION IS IN PLACE, AND THAT IS WHAT MAKES IT CHEAP ────────────
 * The scope OCCURRENCE keeps its id, so the page's `moduleEmbed` still resolves
 * and `identitySignature: "project:Project Scope"` is preserved — the page needs
 * no edit at all. Its MODULE flips `role: "textblock"` → `role: "container"`
 * and gains `allowChildContainers`, which is safe because each of the three
 * scope modules has exactly ONE placement (measured — a shared module would
 * have made this a clone, not a conversion).
 *
 * ── NO TEXT IS LOST, AND THE MIGRATION PROVES IT BEFORE IT WRITES ──────────
 * The whole risk here is shredding prose the user wrote. So the plan is checked
 * against the source: the concatenated text of every section body must equal the
 * original's text with the heading text removed. A scope that fails that check
 * is REPORTED AND SKIPPED rather than converted — this is the user's own
 * writing, and a migration does not get to tidy it.
 *
 * The H2 headings themselves ARE dropped, deliberately and not silently: a
 * container renders its own label as its header, so keeping them would print
 * every section title twice. The label carries the heading's text verbatim, so
 * the words survive — they move from prose into identity.
 *
 * THE H1 IS DROPPED ONLY WHEN THE PREAMBLE IS NOTHING BUT HEADINGS. If anyone
 * has typed real content above the first section, it is PREPENDED to the first
 * section's body instead of being thrown away. Structural, so it needs no
 * label matching.
 *
 * Idempotent — a scope already converted to a container is skipped.
 */

import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";
import { scopeSectionKey } from "../utils/liveSystemBuilders.js";

export const id = "0280-a-scope-that-was-one-big-textblock";
export const describe =
  "Restructure each project's Project Scope from one big textblock into doc container → doc container → textblock, " +
  "one container per H2 section. Refuses any scope whose text would not survive the split.";
export const touches = ["occurrences", "modules"];

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

/** All text inside a ProseMirror node, concatenated. */
export function nodeText(n) {
  let s = "";
  const walk = (x) => {
    if (!x || typeof x !== "object") return;
    if (x.type === "text") s += x.text ?? "";
    for (const c of (x.content ?? [])) walk(c);
  };
  walk(n);
  return s;
}

/**
 * Split a scope body into sections at its H2 headings.
 *
 * @returns {{ preamble: Array, sections: Array<{title,body}> }|null}
 *   null when the body has no headings to split on — fail closed rather than
 *   convert a shape this was not written for.
 */
export function planScopeSections(content) {
  if (!Array.isArray(content) || !content.length) return null;
  const isSectionHead = (n) => n?.type === "heading" && (n.attrs?.level ?? 1) >= 2;
  if (!content.some(isSectionHead)) return null;

  const preamble = [];
  const sections = [];
  for (const node of content) {
    if (isSectionHead(node)) {
      sections.push({ title: nodeText(node).trim() || "Section", body: [] });
      continue;
    }
    if (sections.length) sections[sections.length - 1].body.push(node);
    else preamble.push(node);
  }
  if (!sections.length) return null;

  // Anything above the first section that is NOT just a title survives, moved
  // into the first section rather than dropped.
  const preambleIsTitleOnly = preamble.every(n => n?.type === "heading");
  if (preamble.length && !preambleIsTitleOnly) {
    sections[0].body = [...preamble, ...sections[0].body];
  }
  return { preamble, preambleIsTitleOnly, sections };
}

/**
 * THE GUARD. Every character of non-heading text must appear in some section
 * body; a scope that fails is skipped, not converted.
 */
export function textSurvives(originalContent, plan) {
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const headingText = originalContent
    .filter(n => n?.type === "heading" && (n.attrs?.level ?? 1) >= 2)
    .map(nodeText).join("");
  let before = norm(originalContent.map(nodeText).join(""));
  // Remove the section headings' text — those move into the container labels.
  for (const h of originalContent.filter(n => n?.type === "heading" && (n.attrs?.level ?? 1) >= 2)) {
    before = norm(before.replace(norm(nodeText(h)), ""));
  }
  // …and the title, when it is being dropped.
  if (plan.preambleIsTitleOnly) {
    for (const h of plan.preamble) before = norm(before.replace(norm(nodeText(h)), ""));
  }
  const after = norm(plan.sections.map(s => s.body.map(nodeText).join("")).join(""));
  return { ok: norm(before) === after, before: norm(before), after, headingText };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modulesById = Object.fromEntries(mods.map(m => [m.id, m]));
  const occById = Object.fromEntries(occs.map(o => [o.id, o]));
  const userId = occs[0]?.userId;

  // A scope is identified STRUCTURALLY: a textblock child of a page whose
  // sibling is the project kanban. Rather than re-deriving that here, key on
  // the signature the template stamps AND the label, then verify the shape —
  // and cover the unsigned client-cloned page (Via Fluere) by also accepting a
  // textblock whose page lists a board carrying `allowChildContainers`.
  const candidates = [];
  for (const page of occs) {
    if (modulesById[page.moduleId]?.role !== "page") continue;
    const kids = (page.occurrences || []).map(id => occById[id]).filter(Boolean);
    const hasKanban = kids.some(k => {
      const m = modulesById[k.moduleId];
      return m?.role === "container" && m.meta?.allowChildContainers === true
        && (k.occurrences || []).length >= 2
        && (k.occurrences || []).every(c => modulesById[occById[c]?.moduleId]?.role === "container");
    });
    if (!hasKanban) continue;
    for (const k of kids) {
      if (modulesById[k.moduleId]?.role === "textblock") candidates.push({ page, scope: k });
    }
  }

  log(`  project pages with a kanban: ${new Set(candidates.map(c => c.page.id)).size} · scope textblocks to convert: ${candidates.length}`);
  if (!candidates.length) {
    log("  no scope is still a single textblock — already converged");
    return;
  }

  const work = [];
  for (const { page, scope } of candidates) {
    const label = page.label ?? modulesById[page.moduleId]?.label ?? page.id;
    const mod = modulesById[scope.moduleId];
    const placements = occs.filter(o => o.moduleId === scope.moduleId).length;
    let tm = null;
    try { tm = decompressTextmap(scope.textmap); } catch { tm = null; }
    const plan = planScopeSections(tm?.content);
    if (!plan) { log(`      SKIP "${label}" — its scope has no H2 sections to split on`); continue; }
    if (placements !== 1) { log(`      SKIP "${label}" — its scope module has ${placements} placements; converting it would change them all`); continue; }
    const check = textSurvives(tm.content, plan);
    if (!check.ok) {
      log(`      SKIP "${label}" — text would not survive the split.`);
      log(`         before: ${JSON.stringify(check.before.slice(0, 120))}`);
      log(`         after:  ${JSON.stringify(check.after.slice(0, 120))}`);
      continue;
    }
    log(`      "${label}" — ${plan.sections.length} section(s): ${plan.sections.map(s => s.title).join(" · ")}  · ${check.after.length} chars preserved`);
    work.push({ page, scope, mod, plan });
  }

  if (!work.length) { log("  nothing convertible"); return; }
  if (dryRun) { log(`  (dry run — ${work.length} scope(s) would be restructured, nothing written)`); return; }

  for (const { scope, mod, plan } of work) {
    const sectionOccIds = [];
    for (const sec of plan.sections) {
      const key = scopeSectionKey(sec.title);
      const secModId = uid(), secOccId = uid(), bodyModId = uid(), bodyOccId = uid();

      await Module.create({ id: bodyModId, userId, gridId, role: "textblock", kind: "doc", label: sec.title,
        ...(mod.meta?.templateModule ? { meta: { templateModule: true } } : {}) });
      await Occurrence.create({
        id: bodyOccId, userId, gridId, moduleId: bodyModId, targetId: bodyModId, targetType: "module",
        parentId: secOccId, identitySignature: `projectScope:${key}/body`,
        iteration: { mode: "persistent" }, fields: {}, meta: {},
        textmap: compressTextmap({ type: "doc", content: sec.body.length ? sec.body : [{ type: "paragraph" }] }),
        occurrences: [],
      });

      await Module.create({ id: secModId, userId, gridId, role: "container", kind: "doc", label: sec.title,
        ...(mod.meta?.templateModule ? { meta: { templateModule: true } } : {}) });
      await Occurrence.create({
        id: secOccId, userId, gridId, moduleId: secModId, targetId: secModId, targetType: "module",
        parentId: scope.id, identitySignature: `projectScope:${key}`,
        iteration: { mode: "persistent" }, fields: {}, meta: {},
        // A doc container renders its TEXTMAP, not its child list — listing the
        // body without embedding it is the "present in the data, invisible on
        // screen" class. A TEXTBLOCK child embeds as `instanceTextblock`.
        textmap: compressTextmap({ type: "doc", content: [
          { type: "instanceTextblock", attrs: { instanceId: bodyModId, occurrenceId: bodyOccId } },
        ]}),
        occurrences: [bodyOccId],
      });
      sectionOccIds.push(secOccId);
    }

    // The scope itself becomes the doc container holding them.
    await Module.updateOne({ gridId, id: mod.id }, {
      $set: { role: "container", kind: "doc", meta: { ...(mod.meta || {}), allowChildContainers: true } },
    });
    await Occurrence.updateOne({ gridId, id: scope.id }, {
      $set: {
        occurrences: sectionOccIds,
        textmap: compressTextmap({ type: "doc", content: sectionOccIds.map(id => (
          { type: "moduleEmbed", attrs: { occurrenceId: id } }
        ))}),
      },
    });
  }
  log(`  done — ${work.length} scope(s) are now doc container → doc container → textblock`);
}
