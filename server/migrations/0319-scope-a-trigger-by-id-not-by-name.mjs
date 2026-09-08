// 48 operations decided whether to fire by reading a page's NAME.
//
// User, 2026-09-08: *"would it be easier not to look at labels since those
// change but to mark occurances with a certain field like we do with a lot of
// them"*
//
// Measured before answering: **48 of 74 enabled ops scope a trigger by an
// ancestor LABEL** — `"Trackers"` on 43, `"Schedule"` on 35. And it had already
// cost something twice over:
//
//   · `Completed Habits` and `Sleep Time` still said `ancestorLabel: "Goals"`
//     after the July rename, so they stopped recomputing on a date change while
//     still recomputing on load — a PARTIAL silent failure (repaired in 0318).
//   · `"Trackers"` names **TWO** page occurrences — the real board and an empty
//     page/folder — so 43 ops were matching on a name that is already ambiguous.
//
// `matchAncestorScope` has always checked `ancestorId` against the transaction's
// `_ancestorIds` BEFORE it looks at labels. The rename-proof form existed; the
// ops simply were not using it.
//
// ── THE ID COMES FROM THE OP ITSELF, NOT FROM A LABEL LOOKUP ──────────────
//
// Resolving "Trackers" by label would repeat the mistake inside the fix. Every
// one of these ops ALREADY names its pages by id in its own pipeline —
// `$scopePageId`, `$goalItem`, the picker-direct `$allItemsById.<id>` bindings —
// so the id is read out of the op and only ACCEPTED if that occurrence's label
// is the one the trigger was scoping by. Two independent facts have to agree
// before anything is written.
//
// Falls back to a unique page carrying that label, and REFUSES when neither
// answers — a trigger repointed at the wrong ancestor stops firing, and a
// tracker that silently stops recomputing is exactly what this is fixing.
//
// `ancestorLabel` is REPLACED rather than kept beside the id: `matchAncestorScope`
// fires when EITHER matches, so leaving the name behind keeps the ambiguity
// alive and hides whether the id is doing the work.
//
// Idempotent.
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0319-scope-a-trigger-by-id-not-by-name";
export const description = "Ancestor-scoped triggers name an occurrence id, not a page name.";
export const touches = ["modules", "occurrences", "operations"];

const walk = (n, fn) => {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, fn));
  if (n && typeof n === "object") { fn(n); Object.values(n).forEach((v) => walk(v, fn)); }
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const ops  = await Operation.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const occById = Object.fromEntries(occs.map((o) => [o.id, o]));
  const labelOf = (o) => o && (o.label || modById[o.moduleId]?.label || "");
  const roleOf  = (o) => modById[o?.moduleId]?.role;

  // Pages by label, for the fallback — and for reporting the ambiguity.
  const pagesByLabel = {};
  for (const o of occs) {
    if (roleOf(o) !== "page") continue;
    const l = labelOf(o); if (!l) continue;
    (pagesByLabel[l] ||= []).push(o.id);
  }

  const parentOf = new Map();
  for (const o of occs) for (const c of o.occurrences || []) parentOf.set(c, o.id);
  const ancestorsOf = (id) => { const out = []; let c = parentOf.get(id), n = 0;
    while (c && n++ < 50) { out.push(c); c = parentOf.get(c); } return out; };

  let repointed = 0, refused = 0, viaOp = 0, viaUnique = 0;
  for (const op of ops.filter((o) => o.enabled !== false)) {
    const scoped = (op.triggerObjects || []).filter((t) => t?.ancestorLabel);
    if (!scoped.length) continue;

    // Every occurrence id this op names anywhere in its own pipeline.
    const named = new Set();
    walk(op.pipeline, (n) => {
      for (const k of ["expr", "value", "right"]) {
        const v = n[k] ?? n.config?.[k];
        if (typeof v !== "string") continue;
        const m = /^\$allItemsById\.([A-Za-z0-9_-]+)$/.exec(v);
        if (m && occById[m[1]]) named.add(m[1]);
        else if (occById[v]) named.add(v);
      }
    });
    if (op.targetOccurrenceId && occById[op.targetOccurrenceId]) named.add(op.targetOccurrenceId);
    // An op may name its tile by MODULE rather than by occurrence —
    // `FIND $allInstances where templateId IS <moduleId>` is how `Monthly Bills`
    // finds the row it writes to. Resolve those to their occurrence(s), so the
    // structural rule below can still find the page that holds them.
    walk(op.pipeline, (n) => {
      if (n.left !== "templateId" || n.comparator !== "IS" || typeof n.right !== "string") return;
      for (const o of occs) if (o.moduleId === n.right) named.add(o.id);
    });

    const resolve = (label) => {
      // 1. An id the op ALREADY names whose label is the one being scoped by.
      const own = [...named].filter((i) => labelOf(occById[i]) === label);
      if (own.length === 1) return { id: own[0], how: "named by the op itself" };

      const pages = pagesByLabel[label] || [];
      // 2. The page CARRYING something the op names — its own goal tile lives
      //    on the page it is scoped to, which is what separates the real
      //    "Trackers" board from the empty page/folder that shares its name.
      //    An ambiguous NAME is resolved by structure, never by picking one.
      const holding = pages.filter((p) => [...named].some((i) => ancestorsOf(i).includes(p)));
      if (holding.length === 1) return { id: holding[0], how: "the page holding this op's own tile" };

      // 3. Exactly one PAGE carries that label.
      if (pages.length === 1) return { id: pages[0], how: "the only page with that name" };
      return { id: null, how: own.length > 1 ? `the op names ${own.length} occurrences called "${label}"`
                                             : `${pages.length} pages are called "${label}", none holding this op's tile` };
    };

    const decided = new Map();
    let blocked = null;
    for (const t of scoped) {
      if (decided.has(t.ancestorLabel)) continue;
      const r = resolve(t.ancestorLabel);
      if (!r.id) { blocked = `${t.ancestorLabel} — ${r.how}`; break; }
      decided.set(t.ancestorLabel, r);
    }
    if (blocked) { log(`  ${op.name}: REFUSED — ${blocked}`); refused++; continue; }

    const next = (op.triggerObjects || []).map((t) => {
      if (!t?.ancestorLabel) return t;
      const { ancestorLabel, ...rest } = t;
      return { ...rest, ancestorId: decided.get(ancestorLabel).id };
    });
    log(`  ${op.name}: ` + [...decided.entries()]
      .map(([l, r]) => `"${l}" -> ${r.id} (${r.how})`).join(" · "));
    for (const r of decided.values()) r.how === "named by the op itself" ? viaOp++ : viaUnique++;
    if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { triggerObjects: next } });
    repointed++;
  }

  log(`\n  ${repointed} op(s) ${apply ? "repointed" : "would be repointed"} — ${viaOp} scope(s) from the op's own ids, ${viaUnique} from a unique page.`);
  if (refused) log(`  ${refused} REFUSED and left on their label — a wrong ancestor stops an op firing.`);

  // THE CONTROL: every id written must resolve, and must be a page or a
  // container. A trigger repointed at a textblock would never match.
  if (apply) {
    const after = await Operation.find({ gridId: gid }).lean();
    const bad = [];
    for (const op of after.filter((o) => o.enabled !== false))
      for (const t of op.triggerObjects || []) {
        if (!t?.ancestorId) continue;
        const o = occById[t.ancestorId];
        if (!o) bad.push(`${op.name} -> missing ${t.ancestorId}`);
        else if (!["page", "container", "panel"].includes(roleOf(o)))
          bad.push(`${op.name} -> ${roleOf(o)} "${labelOf(o)}"`);
      }
    if (bad.length) throw new Error(`repointed at something that cannot be an ancestor: ${bad.join(", ")}`);
    log(`  every ancestorId resolves to a page/container.`);
  }
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
