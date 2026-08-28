/**
 * 0279 — the kanban stacked its columns, and the page led with the board.
 *
 * `0278` made the six columns RENDER. Looking at the result, they rendered as
 * six full-width strips stacked down the page — a board that holds columns but
 * does not lay them out as columns. User, 2026-08-28: *"can you make the
 * projects kanban look more like a kanban with the layouts we have. columns
 * going across fixed height, no wrap"* / *"right now they are stacked"* /
 * *"then make the container a certain min width with scroll for layout"*.
 *
 * ── WHY IT STACKED, AND IT IS AN INERT KEY RATHER THAN A MISSING ONE ────────
 * `mode: "flex-row"` has been in the layout-cascade vocabulary all along:
 * PageBoard has laid the Schedule's day columns out with it since 2026-07-31,
 * and `layoutToSurfaceShape` already maps the rich Layout editor's "flex, no
 * wrap" straight onto it. But **only PageBoard ever read it** — on a CONTAINER
 * the mode was inert, so the kanban fell to the default vertical stack. That is
 * the same class as `childMaxWidth`, a declared key only PageBoard consumed
 * until 2026-08-25, one mode over. `ModuleContainer` consumes it as of this
 * commit; this migration supplies the data.
 *
 * Written to `meta.layoutCascade` — the slot the header's Layout menu writes —
 * so every number here can be changed in-app afterwards and the user's choice
 * replaces it rather than fighting an op that would rewrite it.
 *
 * ── AND THE PAGE LEADS WITH THE SCOPE NOW ──────────────────────────────────
 * User: *"switch the kan ban and project scope around"*. A doc page renders its
 * TEXTMAP, so the order that matters is the embed order — but `occurrences[]`
 * is moved in the same pass and to the same order, because letting the two
 * disagree is how a child ends up listed and not drawn (repaired from six
 * directions in this file). The two embeds SWAP POSITIONS rather than being
 * rewritten into a fixed list, so anything else in the body stays where it is.
 *
 * ── THE SELECTOR NAMES NO LABEL, AND MEASURING IS WHY ──────────────────────
 * The obvious selector is `identitySignature: "project:Kanban"`. It is WRONG on
 * this grid and would have silently skipped a real project:
 *
 *     project: signatures on poms grid    4
 *       Project: {ProjectName}   kanban + scope   signed
 *       Paul's Clown Website     kanban + scope   signed
 *       Via Fluere               NOTHING           <- cloned by the CLIENT, long ago
 *
 * Matching on the label "Kanban" is the other trap — one rename away from
 * wrong, and this file records a migration that moved a real page because a
 * copied marker looked authoritative.
 *
 * So a kanban is identified by WHAT IT IS: a board-kind container whose child
 * containers' labels are the Status field's own option set. That rule reads the
 * options off the field rather than restating them, so renaming a column
 * through the field keeps the two in step, and it matched all three pages
 * including the unsigned one.
 *
 * Idempotent — a kanban already carrying the shape, and a page already leading
 * with its scope, are each skipped. Moves nothing between parents, creates
 * nothing, deletes nothing.
 */

import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";
import { PROJECT_KANBAN_LAYOUT } from "../utils/liveSystemBuilders.js";

export const id = "0279-a-kanban-that-stacked-its-columns";
export const describe =
  "Lay the project kanban out as columns going across (mode flex-row, fixed width + height, horizontal scroll) " +
  "and put Project Scope before the board on every project page. Written to the cascade slot the Layout menu " +
  "edits. Creates nothing, deletes nothing.";
export const touches = ["occurrences"];

/**
 * Find every project page structurally.
 *
 * A KANBAN is a board-kind container whose child containers' labels cover the
 * status option set — never its own label, never a signature (see the header).
 * The SCOPE is the page's other container child.
 *
 * @returns [{ pageId, pageLabel, kanbanId, scopeIds, needsLayout, needsReorder }]
 */
export function planProjectPages(occurrences, modulesById, statusOptions) {
  const occById = Object.fromEntries(occurrences.map(o => [o.id, o]));
  const wanted = new Set((statusOptions || []).map(s => String(s).trim().toLowerCase()).filter(Boolean));
  // Fail closed: with no options to compare against, every board would match
  // the empty set and this would rewrite the grid.
  if (wanted.size < 2) return [];

  const labelOf = (o) => o?.label ?? modulesById[o?.moduleId]?.label ?? "";
  const isKanban = (o) => {
    const m = modulesById[o?.moduleId];
    if (m?.role !== "container") return false;
    if (m.kind !== "board" && m.kind !== "list") return false;
    const kids = (o.occurrences || []).map(id => occById[id]).filter(Boolean)
      .filter(k => modulesById[k.moduleId]?.role === "container");
    if (kids.length < wanted.size) return false;
    const got = new Set(kids.map(k => String(labelOf(k)).trim().toLowerCase()));
    for (const w of wanted) if (!got.has(w)) return false;
    return true;
  };

  const out = [];
  for (const page of occurrences) {
    const pm = modulesById[page.moduleId];
    if (pm?.role !== "page") continue;
    const kids = (page.occurrences || []).map(id => occById[id]).filter(Boolean);
    const kanban = kids.find(isKanban);
    if (!kanban) continue;
    // Everything else the page lists, in its existing order. The scope is
    // whatever is not the board; taking "the other children" rather than
    // naming one keeps this correct if a project page grows a third section.
    const others = kids.filter(k => k.id !== kanban.id);

    const cur = kanban.meta?.layoutCascade || {};
    const needsLayout = Object.entries(PROJECT_KANBAN_LAYOUT).some(([k, v]) => cur[k] !== v);

    const order = kids.map(k => k.id);
    const kIdx = order.indexOf(kanban.id);
    const firstOtherIdx = others.length ? order.indexOf(others[0].id) : -1;
    const needsReorder = firstOtherIdx >= 0 && kIdx < firstOtherIdx;

    out.push({
      pageId: page.id,
      pageLabel: labelOf(page) || "(unnamed)",
      kanbanId: kanban.id,
      scopeIds: others.map(o => o.id),
      needsLayout,
      needsReorder,
    });
  }
  return out;
}

/**
 * Swap the kanban's embed with the FIRST other embed so the scope leads.
 *
 * A swap rather than a rewrite: the body may hold prose between or around the
 * embeds, and rebuilding the content array from the child list would delete it.
 * Returns null when there is nothing to move.
 */
export function reorderEmbeds(content, kanbanId, scopeIds) {
  if (!Array.isArray(content)) return null;
  const idxOf = (id) => content.findIndex(
    n => n?.type === "moduleEmbed" && n?.attrs?.occurrenceId === id);
  const kIdx = idxOf(kanbanId);
  if (kIdx < 0) return null;
  const sIdx = scopeIds.map(idxOf).filter(i => i >= 0).sort((a, b) => a - b)[0];
  if (sIdx === undefined || sIdx < kIdx) return null;   // already leads
  const next = content.slice();
  [next[kIdx], next[sIdx]] = [next[sIdx], next[kIdx]];
  return next;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modulesById = Object.fromEntries(mods.map(m => [m.id, m]));

  const status = fields.find(f => f.name === "Status" && f.type === "select");
  const opts = status?.meta?.options || status?.meta?.optionsSource?.values || [];
  log(`  Status field ${status ? status.id : "(none)"} — ${opts.length} option(s): ${JSON.stringify(opts)}`);

  const plan = planProjectPages(occs, modulesById, opts);
  log(`  project pages found: ${plan.length}`);
  for (const p of plan) {
    log(`      "${p.pageLabel}" — kanban ${p.kanbanId.slice(0, 10)} · ${p.scopeIds.length} other child(ren)` +
        ` · layout ${p.needsLayout ? "NEEDS" : "ok"} · order ${p.needsReorder ? "kanban first → SWAP" : "ok"}`);
  }
  const work = plan.filter(p => p.needsLayout || p.needsReorder);
  if (!work.length) { log("  every project page already lays out across and leads with its scope — already converged"); return; }
  if (dryRun) { log(`  (dry run — ${work.length} page(s) would change, nothing written)`); return; }

  let laid = 0, moved = 0;
  for (const p of work) {
    if (p.needsLayout) {
      const k = occs.find(o => o.id === p.kanbanId);
      // Whole-object write: meta may be null, and a dotted $set cannot create a
      // field inside a null (the 0021 lesson).
      await Occurrence.updateOne({ gridId, id: p.kanbanId }, {
        $set: { meta: { ...(k.meta || {}), layoutCascade: { ...(k.meta?.layoutCascade || {}), ...PROJECT_KANBAN_LAYOUT } } },
      });
      laid++;
    }
    if (p.needsReorder) {
      const page = occs.find(o => o.id === p.pageId);
      const order = (page.occurrences || []).slice();
      const kIdx = order.indexOf(p.kanbanId);
      const sIdx = p.scopeIds.map(id => order.indexOf(id)).filter(i => i >= 0).sort((a, b) => a - b)[0];
      const set = {};
      if (kIdx >= 0 && sIdx !== undefined && kIdx < sIdx) {
        [order[kIdx], order[sIdx]] = [order[sIdx], order[kIdx]];
        set.occurrences = order;
      }
      let tm = null;
      try { tm = decompressTextmap(page.textmap); } catch { tm = null; }
      const nextContent = reorderEmbeds(tm?.content, p.kanbanId, p.scopeIds);
      if (nextContent) set.textmap = compressTextmap({ ...tm, content: nextContent });
      if (Object.keys(set).length) {
        await Occurrence.updateOne({ gridId, id: p.pageId }, { $set: set });
        moved++;
      }
    }
  }
  log(`  done — ${laid} kanban(s) laid out across, ${moved} page(s) now lead with their scope`);
}
