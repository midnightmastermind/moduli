// server/migrations/0134-apple-fruit-and-zucchini-row.mjs
//
// User, 2026-08-16: "this has nothing for quantity, nor has images Zucchini
// Peppers Onions (1/2 cup) and the apple one is showing an apple logo, not
// images of an apple."
//
// Two unrelated rows, two unrelated causes. They ship together because each is
// a few lines and both are "this one row is wrong"; they are reported and
// applied independently, so one refusing never half-applies the other.
//
// ── 1. APPLE: THE SEARCH TERM WAS AMBIGUOUS, NOT THE CODE ──────────────────
// `0131` searched each ingredient by its bare name. For "Apple" that returns
// the COMPANY — measured on the live row, three of its four pictures are
// `9to5mac.com`, `insight.com/store` and `compucom.com`. Only the first hit
// (which `0121` had already taken as the face) is fruit.
//
// **There is no way to tell a photo of a fruit from a photo of a laptop by
// inspecting a URL**, so this does not try to prune the bad ones — it re-runs
// the SAME search with a disambiguated query and replaces the row's pictures
// wholesale. `AMBIGUOUS` is a table so the next collision ("Turkey" the bird
// vs the country, "Kiwi" the fruit vs the bird) is one line, not a new
// migration.
//
// ── 2. ZUCCHINI: THE PICTURES WERE THERE, THE BINDINGS WERE NOT ────────────
// This row is tagged `ingredient` ONLY — never `grocery` — so `0125`, which
// added Quantity/Total Needed/Price to the grocery board, never saw it. And
// `0121` gave it no Poster. Measured:
//
//     bindings: … Files:files(hidden)      <- 3 photos, reachable since 0133
//     NO Poster binding                    -> nothing renders on the row
//     NO Quantity binding                  -> "nothing for quantity"
//
// So it needs a Poster binding (its face comes from the files it already has —
// nothing is fetched) and a Quantity binding. **Price and Total Needed are
// deliberately NOT added**: those are the grocery board's fields, this row is
// not on that board, and a plausible price on a row nobody priced is
// indistinguishable from one the user entered — the rule `0052` and `0054`
// both hold to.
//
// The amount moves OUT of the label and INTO Quantity, which is what the user
// asked for on the grocery rows ("take the amounts out of the title") and what
// every other ingredient already does.
export const id = "0134-apple-fruit-and-zucchini-row";
export const describe =
  "Apple gets photos of the fruit; the Zucchini row gets a face and a quantity.";

export const SEARCH_BASE = process.env.MODULI_BASE_URL || "http://localhost:5000";
// name (exact, case-insensitive) -> the query to search instead.
export const AMBIGUOUS = { apple: "apple fruit fresh" };
export const WANT = 4; // poster + 3 alternatives, matching 0131

async function searchImages(q) {
  const res = await fetch(`${SEARCH_BASE}/api/images/search?q=${encodeURIComponent(q)}`,
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

// "Zucchini Peppers Onions (1/2 cup)" -> { base, amount: "1/2 cup" }
export function splitAmount(label) {
  const m = String(label ?? "").match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  return m ? { base: m[1].trim(), amount: m[2].trim() } : { base: String(label ?? "").trim(), amount: null };
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
  const POSTER = fid("Poster"), FILES = fid("Files"), QTY = fid("Quantity");
  const TAG = fields.find((f) => f.name === "Board Category")?.id;
  if (!POSTER || !FILES || !QTY || !TAG) { log(`REFUSING: missing Poster / Files / Quantity / Board Category.`); return; }

  const tagsOf = (o) => { const v = o.fields?.[TAG]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const listOf = (o, f) => { const v = o.fields?.[f]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const isSource = (o) => !o.meta?.feedSourceId && modById.get(o.moduleId)?.role === "instance";
  const isIngredient = (o) => tagsOf(o).includes("ingredient") || tagsOf(o).includes("grocery");

  // ── PART 1 — the ambiguous names ─────────────────────────────────────────
  const ambiguous = occs.filter((o) =>
    isSource(o) && isIngredient(o) && AMBIGUOUS[nameOf(o).trim().toLowerCase()]);
  log(`ambiguous ingredient names on the grid: ${ambiguous.length}`);
  for (const o of ambiguous) {
    const cur = listOf(o, FILES).map((id) => modById.get(byId.get(id)?.moduleId)?.fileRef).filter(Boolean);
    log(`   ${nameOf(o).padEnd(18)} "${nameOf(o)}" -> "${AMBIGUOUS[nameOf(o).trim().toLowerCase()]}"   replacing ${cur.length} picture(s)`);
    for (const u of cur.slice(0, 4)) log(`        was: ${String(u).slice(0, 72)}`);
  }

  // ── PART 2 — rows with pictures but no way to show them / no quantity ────
  const needsFace = [];
  for (const o of occs) {
    if (!isSource(o) || !isIngredient(o)) continue;
    const m = modById.get(o.moduleId);
    const binds = m.fieldBindings || [];
    const hasPoster = binds.some((b) => b.fieldId === POSTER);
    const hasQty = binds.some((b) => b.fieldId === QTY);
    const files = listOf(o, FILES);
    if (hasPoster && hasQty) continue;
    // A face has to come from a picture the row ALREADY has — this half
    // fetches nothing, so a row with no files gets no invented face.
    if (!hasPoster && files.length === 0) { log(`  skipping "${nameOf(o)}" — no Poster binding and no files to take a face from`); continue; }
    const { base, amount } = splitAmount(m.label);
    needsFace.push({ occ: o, mod: m, hasPoster, hasQty, files, base, amount });
  }
  log(`rows missing a Poster binding and/or a Quantity: ${needsFace.length}`);
  for (const p of needsFace) {
    const bits = [];
    if (!p.hasPoster) bits.push(`bind Poster + face from file 1 of ${p.files.length}`);
    if (!p.hasQty) bits.push(p.amount ? `bind Quantity = "${p.amount}"` : `bind Quantity (empty — no amount in the label)`);
    if (p.amount) bits.push(`label "${p.mod.label}" -> "${p.base}"`);
    log(`   ${String(p.mod.label).padEnd(34)} ${bits.join(" · ")}`);
  }

  if (!ambiguous.length && !needsFace.length) { log(`nothing to fix.`); return; }
  if (dryRun) {
    log(`WOULD re-search ${ambiguous.length} ambiguous name(s) and repair ${needsFace.length} row(s).`);
    return;
  }

  // ── APPLY 1 ──────────────────────────────────────────────────────────────
  const { randomUUID } = await import("node:crypto");
  let home = null, exemplarMod = null;
  for (const o of occs) {
    const p = o.fields?.[POSTER]?.value;
    const art = typeof p === "string" ? byId.get(p) : null;
    if (art && modById.get(art.moduleId)?.role === "artifact") { home = art.parentId; exemplarMod = modById.get(art.moduleId); break; }
  }
  for (const o of ambiguous) {
    if (!home) { log(`  REFUSING "${nameOf(o)}" — no existing picture to learn the folder from`); continue; }
    const q = AMBIGUOUS[nameOf(o).trim().toLowerCase()];
    let urls = [];
    try { urls = await searchImages(q); } catch (e) { log(`  "${q}" search failed: ${e.message}`); continue; }
    const take = urls.slice(0, WANT);
    if (take.length < 2) { log(`  REFUSING "${nameOf(o)}" — "${q}" returned ${take.length} result(s); leaving the old pictures alone`); continue; }
    const newIds = [];
    for (const url of take) {
      const aMod = randomUUID(), aOcc = randomUUID();
      await Module.create({ id: aMod, gridId, userId: o.userId, label: nameOf(o),
        role: "artifact", kind: "image", fileRef: url, meta: { ...(exemplarMod?.meta || {}) } });
      await Occurrence.create({ id: aOcc, gridId, userId: o.userId, moduleId: aMod, targetId: aMod,
        parentId: home, occurrences: [], fields: {} });
      newIds.push(aOcc);
    }
    await Occurrence.updateOne({ gridId, id: o.id }, { $set: {
      [`fields.${POSTER}`]: { value: newIds[0], flow: "in" },
      [`fields.${FILES}`]: { value: newIds, flow: "in" },
    } });
    log(`  ${nameOf(o)}: ${take.length} fresh picture(s) from "${q}"`);
    take.forEach((u) => log(`        now: ${String(u).slice(0, 72)}`));
  }

  // ── APPLY 2 ──────────────────────────────────────────────────────────────
  for (const p of needsFace) {
    const next = [...(p.mod.fieldBindings || [])];
    // hidden: the picture renders through the media path, the amount through
    // the row's own field row — matching every other ingredient.
    if (!p.hasPoster) next.push({ fieldId: POSTER, role: "media", hidden: true });
    if (!p.hasQty) next.push({ fieldId: QTY, role: "input" });
    const modSet = { fieldBindings: next };
    if (p.amount) modSet.label = p.base;
    await Module.updateOne({ gridId, id: p.mod.id }, { $set: modSet });

    const occSet = {};
    if (!p.hasPoster && p.files.length) occSet[`fields.${POSTER}`] = { value: p.files[0], flow: "in" };
    if (!p.hasQty && p.amount) occSet[`fields.${QTY}`] = { value: p.amount, flow: "in" };
    if (Object.keys(occSet).length) await Occurrence.updateOne({ gridId, id: p.occ.id }, { $set: occSet });
    log(`  ${p.base}: ${!p.hasPoster ? "face set · " : ""}${!p.hasQty && p.amount ? `quantity "${p.amount}" · ` : ""}bindings updated`);
  }

  // Read the RESULT back — the two user-visible facts.
  const [afterOccs, afterMods] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
  ]);
  const am = new Map(afterMods.map((m) => [m.id, m]));
  const ao = new Map(afterOccs.map((o) => [o.id, o]));
  for (const o of ambiguous) {
    const row = ao.get(o.id);
    const refs = (row.fields?.[FILES]?.value || []).map((id) => am.get(ao.get(id)?.moduleId)?.fileRef || "?");
    log(`  check: ${nameOf(o)} now has ${refs.length} picture(s); none from the old set: ${
      refs.every((r) => !/9to5mac|insight\.com|compucom/i.test(String(r)))}`);
  }
  for (const p of needsFace) {
    const row = ao.get(p.occ.id), m = am.get(p.mod.id);
    log(`  check: "${m?.label}" poster=${!!row.fields?.[POSTER]?.value} quantity=${JSON.stringify(row.fields?.[QTY]?.value ?? null)}`);
  }
}
