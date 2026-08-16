// server/migrations/0131-alternative-ingredient-photos.mjs
//
// User, 2026-08-16: "put in alternative photos in ingrediants for each one so i
// know how it looks."
//
// `0121` attached ONE picture per ingredient. A single search hit is a coin
// flip — "Granola" returns a recipe blog's styled bowl as readily as a bag on a
// shelf — so this attaches a few more per ingredient and lets the spread show
// the alternatives side by side.
//
// ── THEY GO ON `Files`, NOT `Poster` ────────────────────────────────────────
// `Poster` is the FACE — one value, the picture the row shows inline — and
// `0121` already chose it. `Files` is the multi-valued attachment list the
// spread reads (`filesOf`), so alternatives belong there and the face is left
// exactly as it was. **The existing Poster is included in the Files list**, so
// it stays first in the spread rather than being pushed out by newcomers.
//
// ── IT SKIPS THE FIRST SEARCH HIT ───────────────────────────────────────────
// `0121` took result #1, so re-taking it would attach a duplicate of the face.
// This starts at #2 and takes the next few DISTINCT urls — the same query, the
// same route, just further down the list.
//
// Refuses if the image route is unreachable, rather than half-populating a
// board where nothing tells you which half failed — the `0121` posture.
// Idempotent: an ingredient already holding ALTERNATIVES (more than one file)
// is skipped, so a re-run after a partial failure fills only the gaps.
import { randomUUID } from "node:crypto";

export const id = "0131-alternative-ingredient-photos";
export const describe = "Each ingredient gets a few alternative photos, attached to Files.";

export const SEARCH_BASE = process.env.MODULI_BASE_URL || "http://localhost:5000";
export const WANT_ALTERNATES = 3;
// "Greek Yogurt (1 cup)" -> "Greek Yogurt"; the unit is a serving size, not a
// description of what the thing looks like.
export const stripUnit = (s) => String(s ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchImages(name) {
  const res = await fetch(`${SEARCH_BASE}/api/images/search?q=${encodeURIComponent(name)}`,
    { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const body = await res.json();
  const urls = [];
  for (const r of body?.results || []) {
    const u = r?.image || r?.thumbnail;
    if (typeof u === "string" && /^https?:\/\//i.test(u) && !urls.includes(u)) urls.push(u);
  }
  return urls;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";
  const fid = (n) => fields.find((f) => f.name === n && !f.displayEnabled)?.id;
  const TAG = fields.find((f) => f.name === "Board Category")?.id;
  const POSTER = fid("Poster"), FILES = fid("Files");
  if (!TAG || !POSTER || !FILES) { log(`REFUSING: missing Board Category / Poster / Files.`); return; }

  const tagsOf = (o) => { const v = o.fields?.[TAG]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const listOf = (o, f) => { const v = o.fields?.[f]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const isSource = (o) => !o.meta?.feedSourceId && modById.get(o.moduleId)?.role === "instance";

  // Where pictures live — learned from an artifact one already points at.
  let home = null, exemplarMod = null;
  for (const o of occs) {
    const p = o.fields?.[POSTER]?.value;
    const art = typeof p === "string" ? byId.get(p) : null;
    if (art && modById.get(art.moduleId)?.role === "artifact") {
      home = art.parentId; exemplarMod = modById.get(art.moduleId); break;
    }
  }
  if (!home) { log(`REFUSING: no existing picture to learn the folder from.`); return; }

  const targets = occs.filter((o) => isSource(o) &&
    (tagsOf(o).includes("ingredient") || tagsOf(o).includes("grocery")))
    .filter((o) => listOf(o, FILES).length <= 1);   // already has alternatives -> skip

  log(`pictures are homed under ${home}`);
  log(`ingredients wanting alternatives: ${targets.length}`);
  for (const t of targets.slice(0, 8)) log(`   ${nameOf(t).padEnd(24)} has ${listOf(t, FILES).length} file(s)`);
  if (targets.length > 8) log(`   … ${targets.length - 8} more`);
  if (!targets.length) { log(`every ingredient already has alternatives.`); return; }

  // Prove the route answers BEFORE writing anything.
  let probe = null;
  try { probe = await searchImages(stripUnit(nameOf(targets[0]))); }
  catch (e) { log(`REFUSING: image search unreachable (${e.message}). Is the server running?`); return; }
  if (!probe || probe.length < 2) { log(`REFUSING: search returned ${probe?.length ?? 0} result(s) — not enough for alternatives.`); return; }
  log(`search OK — "${stripUnit(nameOf(targets[0]))}" returned ${probe.length} distinct image(s)`);
  if (dryRun) { log(`WOULD attach up to ${WANT_ALTERNATES} alternative(s) each to ${targets.length} ingredient(s).`); return; }

  let made = 0; const failed = [];
  for (const t of targets) {
    const q = stripUnit(nameOf(t));
    let urls = [];
    try { urls = await searchImages(q); } catch (e) { log(`  "${q}" search failed: ${e.message}`); }
    // Skip #1 — that is the face 0121 already attached.
    const alts = urls.slice(1, 1 + WANT_ALTERNATES);
    if (!alts.length) { failed.push(q); await sleep(400); continue; }

    const newIds = [];
    for (const url of alts) {
      const aMod = randomUUID(), aOcc = randomUUID();
      await Module.create({
        id: aMod, gridId, userId: t.userId, label: q,
        role: "artifact", kind: "image", fileRef: url,
        meta: { ...(exemplarMod?.meta || {}), alternate: true },
      });
      await Occurrence.create({
        id: aOcc, gridId, userId: t.userId, moduleId: aMod, targetId: aMod,
        parentId: home, occurrences: [], fields: {},
      });
      newIds.push(aOcc);
    }
    // The face stays FIRST; alternatives follow it.
    const poster = t.fields?.[POSTER]?.value;
    const next = [...new Set([...(poster ? [poster] : []), ...listOf(t, FILES), ...newIds])];
    await Occurrence.updateOne({ gridId, id: t.id },
      { $set: { [`fields.${FILES}`]: { value: next, flow: "in" } } });
    made += newIds.length;
    log(`  ${q.padEnd(24)} +${newIds.length} alternative(s) -> ${next.length} file(s)`);
    await sleep(400);
  }
  log(`attached ${made} alternative(s)` + (failed.length ? `; none found for: ${failed.join(", ")}` : ""));
}
