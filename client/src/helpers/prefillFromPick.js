// helpers/prefillFromPick.js
// Picking an occurrence in a dropdown fills the fields that pick implies.
//
// User 2026-08-06: *"if i select that as the ingrediant, it would prefill the
// nutrition on eat … if i select meal, it would fill the ingrediants dropdown
// with all the ingrediants involved and the nutrition."*
//
// This is the DECISION half — pure, no React, no writes. `FieldRenderer`'s
// existing commit merges the result into the same `updateOccurrence` that stores
// the pick, so a pick and its fills are one write and one undo step.
//
// CONFIG lives on the SOURCE dropdown field, because that is what you select and
// what knows where the values come from:
//
//   field.meta.prefill = {
//     enabled: true,
//     map: [ { from: <fieldId on the PICKED occurrence>,
//              to:   <fieldId on the occurrence being edited>,   // defaults to `from`
//              combine: "sum" } ],
//     chain: 1,   // how many further hops a fill may itself trigger
//   }
//
// POLICY, settled with the user (see the plan):
//   1. A pick ALWAYS overwrites. You may hand-correct a filled value; picking
//      that dropdown again replaces it. So there is no provenance to store and
//      the stored field shape stays exactly `{ value, flow }`.
//   2. Only fields the TARGET MODULE ALREADY BINDS are filled. Prefill fills
//      what is there; it never changes what a thing IS. (A drop does add
//      bindings — this deliberately does not.)
//   3. A filled value carries no marker. It is an ordinary value.

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const nums = (vals) => vals.map(Number).filter((n) => Number.isFinite(n));

// How several picks collapse into one value. Numeric reducers SKIP anything that
// is not a number rather than coercing it to 0 — a text ingredient must not drag
// a protein total down.
export const COMBINERS = {
  replace: (vals) => vals[0],
  sum: (vals) => { const n = nums(vals); return n.length ? n.reduce((a, b) => a + b, 0) : undefined; },
  avg: (vals) => { const n = nums(vals); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : undefined; },
  min: (vals) => { const n = nums(vals); return n.length ? Math.min(...n) : undefined; },
  max: (vals) => { const n = nums(vals); return n.length ? Math.max(...n) : undefined; },
  concat: (vals) => { const s = vals.filter((v) => v != null && v !== "").map(String); return s.length ? s.join(", ") : undefined; },
  // For occurrence ARRAYS — this is what fills an Ingredients dropdown from a Meal.
  union: (vals) => {
    const out = [];
    for (const v of vals) for (const item of (Array.isArray(v) ? v : [v])) {
      if (item != null && item !== "" && !out.includes(item)) out.push(item);
    }
    return out.length ? out : undefined;
  },
};

const asPicks = (value) => {
  if (value == null || value === "") return [];
  return (Array.isArray(value) ? value : [value]).filter((v) => v != null && v !== "");
};

const prefillOf = (field) => {
  const cfg = field?.meta?.prefill;
  if (!cfg || cfg.enabled === false || !Array.isArray(cfg.map) || cfg.map.length === 0) return null;
  return cfg;
};

const boundFieldIds = (module) =>
  new Set((Array.isArray(module?.fieldBindings) ? module.fieldBindings : []).map((b) => b?.fieldId).filter(Boolean));

/**
 * @param {object} field   the dropdown field just picked (carries meta.prefill)
 * @param {*}      value   the new pick — an occurrence id, or an array of them
 * @param {object} target  the occurrence being edited (its MODULE decides what may be filled)
 * @param {object} ctx     { occurrencesById, modulesById, fieldsById }
 * @returns {{ writes: Array<{ fieldId, value, flow, sources: { from, occurrenceIds } }> }}
 */
export function planPrefill({ field, value, target, ctx }) {
  const writes = [];
  if (!field || !target || !ctx) return { writes };
  const targetMod = ctx.modulesById?.[target.moduleId];
  const bound = boundFieldIds(targetMod);
  if (bound.size === 0) return { writes };

  // A field is filled at most once per plan — the first (shallowest) write wins,
  // which is also what stops a cycle from ping-ponging between two fields.
  const claimed = new Set();

  const walk = (srcField, pickValue, hopsLeft) => {
    const cfg = prefillOf(srcField);
    if (!cfg) return;
    const pickIds = asPicks(pickValue);
    if (pickIds.length === 0) return;
    const picked = pickIds.map((id) => ctx.occurrencesById?.[id]).filter(Boolean);
    if (picked.length === 0) return;

    // Everything this hop writes, collected before recursing, so a chained hop
    // can never be the reason an earlier, shallower field is skipped.
    const produced = [];
    for (const entry of cfg.map) {
      const from = entry?.from;
      const to = entry?.to || from;
      if (!from || !to || claimed.has(to)) continue;
      // Decision 2: fill only what the target already carries.
      if (!bound.has(to)) continue;

      const slots = picked.map((occ) => occ.fields?.[from]);
      const raw = slots
        .map((slot) => (slot && typeof slot === "object" && "value" in slot ? slot.value : slot))
        // FLOW-AWARE COMBINING IS OPT-IN, PER ROW (`flowAware: true`), and OFF by
        // default — measured on poms grid before choosing: the macro fields this
        // feature actually targets carry `flowToggle: false` and every stored
        // value is `flow: "replace"`, so flow is meaningless there and honouring
        // it unconditionally would be noise. `Amount` is the opposite —
        // `flowToggle: true`, 24 values split out:16 / in:5 / replace:3 — so
        // summing money without direction would be plainly wrong.
        //
        // Neither "always" nor "never" is right, so it is configuration. Default
        // off means the shipped nutrition prefill (0042) behaves byte-identically.
        // `out` NEGATES, which is the same convention every aggregation on this
        // grid already uses.
        .map((v, i) => {
          if (!entry.flowAware) return v;
          const flow = slots[i] && typeof slots[i] === "object" ? slots[i].flow : null;
          const n = Number(v);
          return (flow === "out" && Number.isFinite(n)) ? -n : v;
        })
        .filter((v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0));
      if (raw.length === 0) continue;   // nothing to say — never overwrite with empty

      const combine = COMBINERS[entry.combine] ? entry.combine : "replace";
      const next = COMBINERS[combine](raw);
      if (next === undefined || next === null || next === "") continue;

      // Flow follows the first real contributor so an "out" amount stays an out.
      const flowSlot = picked.map((occ) => occ.fields?.[from]).find((s) => s && typeof s === "object" && s.flow);
      claimed.add(to);
      produced.push({
        fieldId: to,
        value: next,
        flow: flowSlot?.flow || "in",
        sources: { from, occurrenceIds: pickIds },
      });
    }
    writes.push(...produced);

    if (hopsLeft <= 0) return;
    // A fill that lands in ANOTHER dropdown keeps going, using THAT field's own
    // config — which is why configuring Ingredient→macros once serves both a
    // direct ingredient pick and a Meal that names ingredients.
    for (const w of produced) {
      const nextField = ctx.fieldsById?.[w.fieldId];
      if (nextField?.type === "occurrence" && prefillOf(nextField)) {
        walk(nextField, w.value, hopsLeft - 1);
      }
    }
  };

  const rootCfg = prefillOf(field);
  walk(field, value, Number.isFinite(Number(rootCfg?.chain)) ? Number(rootCfg.chain) : 0);
  return { writes };
}

/** Convenience for the commit site: the writes as a `fields` patch to merge. */
export function prefillFieldsPatch(writes) {
  const patch = {};
  for (const w of writes || []) patch[w.fieldId] = { value: w.value, flow: w.flow };
  return patch;
}
