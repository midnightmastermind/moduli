// server/migrations/0121-pictures-for-the-plan-ingredients.mjs
//
// User, 2026-08-13: "why dont the new ones have price quantity and pictures".
// `0120` gave them the fields; this gives them the pictures.
//
// A PICTURE HERE IS AN ARTIFACT OCCURRENCE, not a URL in a field — measured from
// an existing one rather than assumed:
//
//     Chicken Breast  Poster = "e442d34b…"  Files = ["e442d34b…"]
//     e442d34b…       role:"artifact" kind:"image" fileRef:"https://tse1.mm…"
//
// So each ingredient gets an artifact module whose `fileRef` is the remote image
// URL (external URLs pass through `resolveFileRef` verbatim — the pattern the
// seeded pictures already use), an occurrence homed WHERE THE EXISTING
// INGREDIENT PICTURES LIVE, and both `Poster` and `Files` pointing at it.
//
// **THE HOME IS DERIVED, NOT NAMED.** It is the parent of an artifact an existing
// ingredient already points at — by definition the right folder, and immune to
// the Files folder being renamed or restructured.
//
// IMAGES COME FROM THE APP'S OWN `/api/images/search` ROUTE — the same one the
// picker uses — so nothing here invents a source. The migration REFUSES if the
// route is unreachable rather than writing ingredients with no picture and
// calling it done; a half-populated board is worse than an untouched one because
// nothing tells you which half failed.
//
// Idempotent: an ingredient that already has a Poster is skipped, so a re-run
// after a partial failure fills only the gaps.
import { randomUUID } from "node:crypto";

export const id = "0121-pictures-for-the-plan-ingredients";
export const describe = "Every plan ingredient gets a picture from the app's own image search.";

export const SEARCH_BASE = process.env.MODULI_BASE_URL || "http://localhost:5000";
// "Greek Yogurt (1 cup)" -> "Greek Yogurt". The unit is a serving size, not part
// of what the thing looks like, and it makes the search worse.
export const stripUnit = (s) => String(s ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchImage(name, log) {
  const url = `${SEARCH_BASE}/api/images/search?q=${encodeURIComponent(name)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const body = await res.json();
  for (const r of body?.results || []) {
    const u = r?.image || r?.thumbnail;
    if (typeof u === "string" && /^https?:\/\//i.test(u)) return u;
  }
  log(`  no usable result for "${name}"`);
  return null;
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
  const isSource = (o) => !o.meta?.feedSourceId && modById.get(o.moduleId)?.role === "instance";
  const empty = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);

  // Where existing ingredient pictures live — derived, not named.
  let home = null, exemplar = null;
  for (const o of occs) {
    if (!isSource(o) || !tagsOf(o).includes("ingredient")) continue;
    const p = o.fields?.[POSTER]?.value;
    const art = typeof p === "string" ? byId.get(p) : null;
    if (art && modById.get(art.moduleId)?.role === "artifact") { home = art.parentId; exemplar = art; break; }
  }
  if (!home) { log(`REFUSING: no existing ingredient picture to learn the folder from.`); return; }
  log(`pictures are homed under ${home} (learned from "${nameOf(exemplar)}")`);

  const targets = occs.filter((o) => isSource(o) && tagsOf(o).includes("grocery") &&
    tagsOf(o).includes("ingredient") && empty(o.fields?.[POSTER]?.value));
  log(`ingredients without a picture: ${targets.length}`);
  for (const t of targets) log(`   ${nameOf(t).padEnd(30)} search "${stripUnit(nameOf(t))}"`);
  if (!targets.length) { log(`every ingredient already has a picture.`); return; }

  // Prove the route answers BEFORE claiming anything — and before writing.
  let probe = null;
  try { probe = await searchImage(stripUnit(nameOf(targets[0])), log); }
  catch (e) { log(`REFUSING: the image search route is unreachable (${e.message}). Is the server running?`); return; }
  if (!probe) { log(`REFUSING: the image search returned nothing even for the first ingredient.`); return; }
  log(`search route OK — first result: ${probe.slice(0, 70)}…`);
  if (dryRun) { log(`WOULD fetch and attach ${targets.length} picture(s).`); return; }

  const userId = exemplar.userId;
  const exMod = modById.get(exemplar.moduleId);
  let made = 0, failed = [];
  for (const t of targets) {
    const q = stripUnit(nameOf(t));
    let url = null;
    try { url = await searchImage(q, log); } catch (e) { log(`  "${q}" search failed: ${e.message}`); }
    if (!url) { failed.push(q); await sleep(400); continue; }

    const aMod = randomUUID(), aOcc = randomUUID();
    await Module.create({
      id: aMod, gridId, userId, label: q,
      role: "artifact", kind: "image", fileRef: url,
      meta: { ...(exMod?.meta || {}) },
    });
    await Occurrence.create({
      id: aOcc, gridId, userId, moduleId: aMod, targetId: aMod,
      parentId: home, occurrences: [], fields: {},
    });
    await Occurrence.updateOne({ gridId, id: t.id }, { $set: {
      [`fields.${POSTER}`]: { value: aOcc, flow: "in" },
      [`fields.${FILES}`]: { value: [aOcc], flow: "in" },
    } });
    made++;
    log(`  ${q.padEnd(26)} -> ${url.slice(0, 60)}…`);
    await sleep(400);   // the search proxies a public endpoint; do not hammer it
  }
  log(`attached ${made} picture(s)` + (failed.length ? `, ${failed.length} without one: ${failed.join(", ")}` : ""));
}
