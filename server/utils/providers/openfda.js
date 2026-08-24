// utils/providers/openfda.js — medications and supplements, from the FDA's
// keyless drug-label API.
//
// Maps onto the Medications board `0158` minted, which already holds four real
// prescriptions. A picked drug brings its generic name, active substance,
// route, dosage form, drug class and manufacturer — the facts a medication list
// wants and that `0158` deliberately refused to guess at ("which pills go in
// which dose is a medical fact about this prescription").
//
// ── ONE ROW PER DRUG, NOT ONE PER LABEL ───────────────────────────────────
//
// Every manufacturer files its own label, so the API's own counts are:
//
//     brand_name:vyv*        3 labels
//     brand_name:aripip*   117 labels   <- all of them "Aripiprazole"
//     generic_name:trazodone 103 labels <- all "Trazodone Hydrochloride"
//
// Offered raw, the dropdown shows the same drug three times and the user picks
// one arbitrarily. Deduped on the display name, keeping the first label — which
// is also what makes the external id meaningful, since a per-label id would let
// the same drug be imported again under a different manufacturer's row.
//
// **NOTHING CLINICAL IS OFFERED.** The label carries `indications_and_usage`,
// `warnings` and `dosage_and_administration` — paragraphs of prescribing
// information. They are deliberately not exposed as importable fields: a
// medication row on a personal grid is a reminder of what to take, and pasting
// FDA prescribing text into it would put medical advice in a place the user
// will read as their own note. Identity and form only.

import { normalizeResult, registerProvider } from "../searchProviders.js";

const API = "https://api.fda.gov/drug/label.json";
const UA = { "User-Agent": "Moduli/1.0 (+https://viafluere.com)", Accept: "application/json" };

const first = (v) => (Array.isArray(v) ? v[0] : v) || null;
const titleCase = (s) => String(s || "").toLowerCase()
  .replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function drugFields(openfda) {
  const f = {};
  const generic = first(openfda?.generic_name);
  if (generic) f["Generic name"] = titleCase(generic);
  if (first(openfda?.substance_name)) f["Active substance"] = titleCase(first(openfda.substance_name));
  if (first(openfda?.route)) f["Route"] = titleCase(first(openfda.route));
  if (first(openfda?.dosage_form)) f["Dosage form"] = titleCase(first(openfda.dosage_form));
  if (first(openfda?.pharm_class_epc)) f["Drug class"] = titleCase(first(openfda.pharm_class_epc));
  if (first(openfda?.manufacturer_name)) f["Manufacturer"] = first(openfda.manufacturer_name);
  return f;
}

/** Collapse a label list to one row per drug NAME. Exported so it is testable dry. */
export function dedupeByName(results) {
  const seen = new Map();
  for (const r of results || []) {
    const o = r.openfda || {};
    const name = first(o.brand_name) || first(o.generic_name);
    if (!name) continue;                       // a label with no name cannot be picked
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, { name, openfda: o, id: first(o.spl_set_id) || first(o.application_number) || key });
  }
  return [...seen.values()];
}

const toResult = (d) => normalizeResult({
  provider: "openfda",
  externalId: d.id,
  title: titleCase(d.name),
  subtitle: [first(d.openfda.generic_name) && titleCase(first(d.openfda.generic_name)),
             first(d.openfda.route) && titleCase(first(d.openfda.route))].filter(Boolean).join(" · ") || null,
  url: first(d.openfda.spl_set_id)
    ? `https://labels.fda.gov/getSPLDocument.cfm?setid=${first(d.openfda.spl_set_id)}` : null,
  fields: drugFields(d.openfda),
});

async function call(search, limit) {
  const url = `${API}?search=${encodeURIComponent(search)}&limit=${limit}`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  // openFDA answers 404 with a JSON body for "no matches" — that is an empty
  // result, not a failure, and treating it as one would surface an error toast
  // every time somebody typed a drug it does not carry.
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`openfda ${res.status}`);
  return (await res.json()).results || [];
}

export const openFdaProvider = {
  id: "openfda", label: "openFDA (medications)", needsKey: false,
  async search(q, { limit = 6 } = {}) {
    const term = String(q || "").trim().replace(/["\\:]/g, "");   // Lucene metacharacters
    if (!term) return [];
    // Brand OR generic, with a trailing wildcard so it works as you type.
    // Over-fetched because the dedupe below collapses many labels into few rows.
    const rows = await call(`openfda.brand_name:${term}* OR openfda.generic_name:${term}*`, Math.min(100, limit * 12));
    return dedupeByName(rows).slice(0, limit).map(toResult);
  },
  async detail({ title, externalId } = {}) {
    const rows = externalId
      ? await call(`openfda.spl_set_id:"${String(externalId).replace(/"/g, "")}"`, 1)
      : await call(`openfda.brand_name:"${String(title || "").replace(/"/g, "")}"`, 1);
    const [d] = dedupeByName(rows);
    return d ? toResult(d) : null;
  },
};
registerProvider(openFdaProvider);
