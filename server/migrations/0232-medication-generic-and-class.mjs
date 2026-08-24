// 0232 — `Generic Name` and `Drug Class`, on MEDICATIONS ONLY.
//
// User's call, 2026-08-24: *"Add Generic name + Drug class"*. openFDA returns
// five keys; these are the two that carry meaning for this list. `Route` is
// "Oral" for all four of the user's medications, and `Manufacturer` names
// whichever repackager the lookup happened to return — it changes per call, so
// storing it would make the row look edited when nothing was.
//
// ── AND `Supplement` IS NOT MAPPED, WHICH IS THE FINDING ───────────────────
//
// `0219` paired BOTH boards with openFDA. openFDA is a DRUG LABEL database, and
// against real supplement names it answers confidently and wrongly. Measured,
// live, five for five:
//
//     "Creatine"    -> "Colotox"                       a homeopathic remedy
//     "Vitamin D"   -> "Silicea"                       a homeopathic remedy
//     "Fish Oil"    -> "Benzalkonium Chloride"         antibacterial hand soap
//     "Magnesium"   -> "Esomeprazole Magnesium"        an acid reducer
//     "Zinc"        -> "Zinc Oxide"                    diaper cream
//
// Writing "Generic name: Benzalkonium Chloride" onto the user's fish oil is
// worse than leaving it blank: a plausible value on a health record is
// indistinguishable from one they entered themselves — the rule `0052` set for
// phone numbers and `0054` for addresses. So the map is authored on
// `Medication` alone. **The PAIRING on `Supplement` is left as it is and
// reported**, because un-pairing is a configuration change the user did not
// ask for and can now make in the field editor.
//
// ── THE BACKFILL WRITES ONLY WHAT THE PROVIDER CONFIRMS ────────────────────
//
// The four existing rows predate the fields, and nothing re-imports a row you
// already have — so without a backfill they carry two empty pills forever.
// The rule is CONFIRMATION, not matching: the generic name openFDA returns must
// begin with the row's own name (its label minus its authored `meta.dose`).
//
//     Aripiprazole  -> "Aripiprazole"                 confirmed, written
//     Lamotrigine   -> "Lamotrigine"                  confirmed, written
//     Trazodone     -> "Trazodone Hydrochloride"      confirmed, written
//     Vyvanse       -> "Lisdexamfetamine Dimesylate"  REFUSED, and reported
//
// **Vyvanse's answer is CORRECT and is still refused**, which is the point: a
// brand name cannot confirm itself against its own generic, so accepting it
// would mean accepting anything the search returned. It is named in the log for
// the user to accept by hand — and the fields are BOUND on the refused row too,
// so there is a pill to type into. Telling someone to fill something in by hand
// while giving them nowhere to do it is its own defect.
//
// Network, so it PROBES FIRST and refuses when openFDA is unreachable — a
// half-filled medication list is worse than an untouched one, because nothing
// tells you which half (the `0121` rule).

import { getProvider } from "../utils/searchProviders.js";
import "../utils/providers/openfda.js";

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

/** One openFDA lookup, returning its flat field bag or null.
 *  INJECTABLE at `up({ fetchDetail })` so the rules above can be driven without
 *  a network — the default is the real provider, so the shipped path is the one
 *  that runs. */
export async function openFdaDetail(name) {
  const p = getProvider("openfda");
  const [top] = await p.search(name, { limit: 1 });
  if (!top) return null;
  const d = await p.detail(top);
  return d?.fields || null;
}

export const id = "0232-medication-generic-and-class";
export const description = "Generic Name and Drug Class on the Medications board, filled where openFDA confirms the name";

export const NEW_FIELDS = [["Generic Name", "text"], ["Drug Class", "text"]];

/** provider key -> our field name. openFDA's own casing, verified live. */
export const KEY_TO_FIELD = { "Generic name": "Generic Name", "Drug class": "Drug Class" };

/** The row's own drug name: its label minus the dose its author recorded.
 *  PURE. Uses `meta.dose` rather than a regex — the dose is AUTHORED data, and
 *  `0158` put it there precisely so nothing would have to parse a label. */
export function drugName(label, dose) {
  let s = String(label || "").trim();
  if (dose) s = s.replace(new RegExp(`\\s*${String(dose).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "");
  return s.trim();
}

/** Does the provider's generic name CONFIRM the name we already hold?
 *  PURE. Confirmation, never resemblance: a brand name cannot confirm itself. */
export function confirms(name, generic) {
  const a = String(name || "").trim().toLowerCase();
  const b = String(generic || "").trim().toLowerCase();
  if (!a || !b) return false;
  return b === a || b.startsWith(`${a} `);
}

export async function up({ models, gridId, dryRun, log, fetchDetail = openFdaDetail }) {
  const { Field, Module, Occurrence } = models;
  const gid = String(gridId);
  const fields = await Field.find({ gridId: gid }).lean();
  const byName = new Map(fields.map((f) => [f.name, f]));

  const target = byName.get("Medication");
  if (!target) { log("no \"Medication\" field on this grid — nothing to do"); return { minted: 0 }; }
  const cfg = target.meta?.optionsSource?.searchProvider;
  if (cfg?.provider !== "openfda") {
    log(`  "Medication" carries ${cfg?.provider || "no provider"}, not openfda — skipped`);
    return { minted: 0 };
  }

  // the rows: tagged `medication`, not a feed copy, and carrying a dose (the
  // board CONTAINER carries the tag too and is not a medication)
  const tagField = byName.get("Board Category");
  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const mById = new Map(mods.map((m) => [m.id, m]));
  const rows = occs.filter((o) => {
    const v = o.fields?.[tagField?.id]?.value;
    if (!(Array.isArray(v) ? v : [v]).includes("medication")) return false;
    if (o.meta?.feedSourceId) return false;
    return !!mById.get(o.moduleId)?.meta?.dose;
  });

  const mint = NEW_FIELDS.filter(([n]) => !byName.has(n));
  log(`fields to mint: ${mint.map((f) => f[0]).join(", ") || "(none — all present)"}`);
  log(`medication rows: ${rows.length}`);
  for (const o of rows) {
    const m = mById.get(o.moduleId);
    log(`   "${m.label}" -> looking up "${drugName(m.label, m.meta.dose)}"`);
  }
  if (dryRun) return { minted: mint.length, rows: rows.length };

  const userId = fields[0]?.userId;
  for (const [name, type] of mint) {
    await Field.create({ id: uid(), userId, gridId: gid, name, type, role: "input", inputEnabled: true, meta: {} });
    log(`  minted field "${name}" [${type}]`);
  }
  const fresh = await Field.find({ gridId: gid }).lean();
  const freshByName = new Map(fresh.map((f) => [f.name, f]));
  const map = {};
  for (const [key, name] of Object.entries(KEY_TO_FIELD)) {
    const f = freshByName.get(name);
    if (!f) throw new Error(`0232: field missing after mint: ${name}`);
    map[key] = f.id;
  }
  await Field.updateOne({ id: target.id, gridId: gid },
    { $set: { "meta.optionsSource.searchProvider.fieldMap": map } });
  log(`authored "Medication": ${Object.entries(map).map(([k, v]) => `${k}->${v}`).join(", ")}`);

  // ── the backfill ────────────────────────────────────────────────────────
  //
  // PROBE FIRST, on a drug whose answer is known, and refuse the whole backfill
  // if openFDA is unreachable. A half-filled medication list is worse than an
  // untouched one: nothing on screen tells you which half is missing (`0121`).
  try {
    const probe = await fetchDetail("Ibuprofen");
    if (!confirms("Ibuprofen", probe?.["Generic name"])) {
      log(`  ! openFDA control lookup did not confirm ("${probe?.["Generic name"] || "nothing"}") — backfill SKIPPED`);
      log("    the fields and the map are authored; re-run to fill them once it answers");
      return { minted: mint.length, filled: 0, refused: rows.length };
    }
  } catch (e) {
    log(`  ! openFDA unreachable (${e.message}) — backfill SKIPPED, fields and map are authored`);
    return { minted: mint.length, filled: 0, refused: rows.length };
  }
  let filled = 0; const refused = [];
  for (const o of rows) {
    const m = mById.get(o.moduleId);
    const name = drugName(m.label, m.meta.dose);

    // BIND FIRST, ON EVERY ROW, AND THAT IS THE POINT OF THE ORDER. A refused
    // row is exactly the one the log asks the user to fill in by hand, and
    // without a binding there is no pill to type into — the instruction would
    // name a control that does not exist. `0120` set this rule for `Price`:
    // *"The field is BOUND so there is somewhere to type it."*
    const have = new Set((m.fieldBindings || []).map((b) => b.fieldId));
    const add = Object.values(map).filter((fid) => !have.has(fid))
      .map((fid, i) => ({ fieldId: fid, role: "input", order: 300 + i }));
    if (add.length) await Module.updateOne({ id: m.id, gridId: gid }, { $push: { fieldBindings: { $each: add } } });

    const already = o.fields?.[map["Generic name"]]?.value;
    if (already) { log(`   "${m.label}" already carries a generic name — left alone`); continue; }
    let d = null;
    try { d = await fetchDetail(name); } catch (e) { log(`   ! "${name}" lookup failed: ${e.message}`); refused.push(name); continue; }
    const generic = d?.["Generic name"], klass = d?.["Drug class"];
    if (!confirms(name, generic)) {
      log(`   REFUSED "${m.label}": openFDA answered "${generic || "nothing"}", which does not confirm "${name}"`);
      refused.push(`${m.label} (openFDA said "${generic || "nothing"}")`);
      continue;
    }
    const set = { [`fields.${map["Generic name"]}`]: { value: generic, flow: "in" } };
    if (klass) set[`fields.${map["Drug class"]}`] = { value: klass, flow: "in" };
    await Occurrence.updateOne({ id: o.id, gridId: gid }, { $set: set });
    log(`   filled "${m.label}": generic="${generic}"${klass ? ` class="${klass}"` : " (no class published)"}`);
    filled++;
  }
  if (refused.length) log(`  NOT filled, for the user to set by hand: ${refused.join(" · ")}`);
  return { minted: mint.length, filled, refused: refused.length };
}
