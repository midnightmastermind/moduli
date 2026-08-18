/**
 * 0142 — the duplicate day column that made `Day Page: Build` throw.
 *
 * USER, 2026-08-18: *"i get this too in notifications: 'Day Page: Build' failed
 * — $col is not a record (no .id) — UPDATE needs a FOUND occurrence"*.
 *
 * THE ERROR IS A SYMPTOM AND THE DEFECT IS DATA. The op's per-day loop opens
 * with
 *
 *     FIND over $allOccurrences
 *       parentId IS <the Day Page board>
 *       AND fields.<Date>.value SAME_DAY $day      -> $col / $colId
 *
 * and the very next step after the mint/merge branch is
 * `UPDATE $col.meta.appliedFromTemplateId`. **FIND binds an ARRAY on a
 * multi-match**, and UPDATE wants a record with `.id` — the exact failure
 * 2026-08-11 (4) records ("a silent no-op became a crash"). Measured on the
 * live board before writing anything:
 *
 *     18 occurrences parented to the Day Page board
 *     17 dates with exactly ONE column
 *      1 date with TWO:  2026-08-18
 *
 * So one date out of eighteen breaks the op for the whole day.
 *
 * WHY THERE ARE TWO, stated rather than guessed: they were minted 11:50:26Z and
 * 12:57:49Z, and NEITHER carries an `identitySignature`. The mint branch runs
 * when the FIND comes back empty, and nothing else stops it — two clients whose
 * builds overlap both see "no column" and both clone one. This migration
 * repairs the damage; it does NOT fix that race, which lives in a shared op
 * governing every date-carrying page and wants its own reviewed pass.
 *
 * THE KEEPER IS CHOSEN, NOT ASSUMED. Ranked by: characters of text at full
 * subtree depth, then number of children, then earliest creation. Measured
 * here: both hold ZERO characters, and the 11:50 one has five children
 * including the shared Emotions Wheel while the 12:57 one has four.
 *
 * NOTHING CONTAINING WRITING IS EVER DELETED. The guard is TEXT-ONLY, read at
 * full subtree depth through `decompressTextmap` — `0038` scored field VALUES,
 * fired on the app's own date stamp, and refused to delete anything forever;
 * its header records making that mistake twice. Raw documents store textmap
 * COMPRESSED, so a regex over the raw string reports "no text" for everything.
 *
 * A MULTI-PARENTED CHILD IS UNLINKED, NEVER DELETED. The Emotions Wheel is one
 * occurrence listed by several day columns (2026-08-11), and `Place Dated Work`
 * multi-parents a task into several days on purpose. Any descendant that some
 * occurrence OUTSIDE the doomed subtree still lists survives.
 */
export const id = "0142-duplicate-day-column";
export const describe = "Remove the empty duplicate day column that makes Day Page: Build bind an array into $col.";

export const BOARD_ID = "8gpoqzx32h7";
export const DATE_FIELD = "Eh7oi4HKdbHB";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const { decompressTextmap } = await import("../utils/textmapCompression.js");

  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map(m => [m.id, m]));
  const byId = new Map(occs.map(o => [o.id, o]));
  const labelOf = (o) => o?.label || modById.get(o?.moduleId)?.label || "";

  const board = byId.get(BOARD_ID);
  if (!board) { log(`  REFUSING: no Day Page board ${BOARD_ID} on this grid`); return; }

  // ---- text, at full depth, through the real decompressor --------------
  const textOf = (o) => {
    let t = "";
    try {
      const tm = o?.textmap ? decompressTextmap(o.textmap) : null;
      const walk = (n) => { if (!n) return; if (typeof n.text === "string") t += n.text; (n.content || []).forEach(walk); };
      walk(tm);
    } catch { /* an unreadable textmap counts as no text we can vouch for */ }
    return t.trim();
  };
  const subtreeIds = (rootId) => {
    const out = [], seen = new Set();
    const walk = (id) => {
      if (seen.has(id)) return; seen.add(id); out.push(id);
      for (const k of byId.get(id)?.occurrences || []) walk(k);
    };
    walk(rootId);
    return out;
  };
  const subtreeText = (rootId) => subtreeIds(rootId).reduce((n, id) => n + textOf(byId.get(id)).length, 0);

  // ---- CONTROL: the text probe must find text SOMEWHERE on this grid ----
  // A probe that returns zero everywhere is broken, not evidence of emptiness.
  const totalText = occs.reduce((n, o) => n + textOf(o).length, 0);
  if (totalText === 0) {
    log("  REFUSING: the text probe found 0 characters on the WHOLE grid — the probe is broken, not the data");
    return;
  }
  log(`  text-probe control: ${totalText} characters across the grid (probe works)`);

  // ---- group the board's children by date ------------------------------
  const kids = occs.filter(o => o.parentId === BOARD_ID);
  const byDate = new Map();
  for (const k of kids) {
    const d = k.fields?.[DATE_FIELD]?.value;
    if (!d) continue;                       // an undated child is not a day column
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(k);
  }
  const dupes = [...byDate].filter(([, arr]) => arr.length > 1).sort();
  log(`  day columns: ${kids.length} parented · ${byDate.size} distinct dates · ${dupes.length} date(s) with more than one`);
  if (!dupes.length) { log("  nothing duplicated — already converged"); return; }

  // ---- plan --------------------------------------------------------------
  const plan = [];
  for (const [date, arr] of dupes) {
    const scored = arr.map(o => ({
      o,
      text: subtreeText(o.id),
      kids: (o.occurrences || []).length,
      born: new Date(o.createdAt || 0).getTime(),
    })).sort((a, b) => b.text - a.text || b.kids - a.kids || a.born - b.born);

    const keep = scored[0];
    for (const cand of scored.slice(1)) {
      if (cand.text > 0) {
        log(`  ${date}: KEEPING BOTH — ${cand.o.id} holds ${cand.text} characters of writing`);
        continue;
      }
      plan.push({ date, keep: keep.o, drop: cand.o, keepText: keep.text, keepKids: keep.kids, dropKids: cand.kids });
    }
  }
  if (!plan.length) { log("  every duplicate holds writing — nothing to remove"); return; }

  for (const p of plan) {
    const ids = subtreeIds(p.drop.id);
    // A descendant some occurrence OUTSIDE this subtree still lists is SHARED.
    const inside = new Set(ids);
    const shared = ids.filter(id => id !== p.drop.id &&
      occs.some(o => !inside.has(o.id) && (o.occurrences || []).includes(id)));
    p.subtree = ids;
    p.shared = shared;
    log(`  ${p.date}:`);
    log(`      keep  ${p.keep.id}  children ${p.keepKids}  text ${p.keepText}  (${(p.keep.occurrences||[]).map(k=>labelOf(byId.get(k))).join(", ").slice(0,80)})`);
    log(`      drop  ${p.drop.id}  children ${p.dropKids}  text 0  -> deleting ${ids.length} occurrence(s)`);
    if (shared.length) log(`      shared, UNLINKED not deleted: ${shared.map(s => `${labelOf(byId.get(s))}(${s})`).join(", ")}`);
  }
  if (dryRun) { log("  DRY RUN — nothing written"); return; }

  for (const p of plan) {
    const doomed = p.subtree.filter(id => !p.shared.includes(id));
    // Unlink first, so nothing is ever listed by a parent that no longer exists.
    await Occurrence.updateOne({ id: BOARD_ID, gridId }, { $pull: { occurrences: p.drop.id } });
    for (const s of p.shared) {
      await Occurrence.updateOne({ id: p.drop.id, gridId }, { $pull: { occurrences: s } });
    }
    await Occurrence.deleteMany({ id: { $in: doomed }, gridId });
    log(`  ${p.date}: deleted ${doomed.length}, unlinked ${p.shared.length}, board no longer lists ${p.drop.id}`);
  }

  // ---- read it back, the way the op's own FIND reads it -----------------
  const after = await Occurrence.find({ gridId }).lean();
  const afterKids = after.filter(o => o.parentId === BOARD_ID);
  const counts = new Map();
  for (const k of afterKids) {
    const d = k.fields?.[DATE_FIELD]?.value;
    if (d) counts.set(d, (counts.get(d) || 0) + 1);
  }
  const still = [...counts].filter(([, n]) => n > 1);
  const boardAfter = after.find(o => o.id === BOARD_ID);
  for (const p of plan) {
    const gone = !after.some(o => o.id === p.drop.id);
    const kept = after.some(o => o.id === p.keep.id);
    const unlisted = !(boardAfter.occurrences || []).includes(p.drop.id);
    log(`  verify ${p.date}: duplicate gone ${gone} · keeper present ${kept} · board no longer lists it ${unlisted} -> ${gone && kept && unlisted ? "YES" : "NO"}`);
  }
  for (const s of plan.flatMap(p => p.shared)) {
    log(`  verify shared ${s} still exists: ${after.some(o => o.id === s)}`);
  }
  log(still.length
    ? `  STILL DUPLICATED: ${still.map(([d, n]) => `${d} x${n}`).join(", ")}`
    : "  every date under the board now has exactly one column — the op's FIND binds a record");
}
