// Editor↔field binding helpers (self-field + sync model).
//
// A binding declares two things:
//   - selfField : the field on the HOST occurrence whose value IS the editor's
//                 content. The editor reads from host.fields[selfField] and
//                 writes back to host.fields[selfField].
//   - link      : the JOIN identity field. Any other occurrence that shares
//                 host.fields[link].value AND has selfField populated is in
//                 the implicit "linked group" — writes propagate.
//
// Bindings live on occurrence.meta.<slot>Link (placement override) or
// module.meta.<slot>Link (template default), and a caller may supply a
// GRID-LEVEL default as the last resort. Cascade: occurrence wins → module
// next → the caller's gridDefault → null. An explicit "clear" string on the
// occurrence opts out of every level below it without re-setting one.
//
// `link` is OPTIONAL. A binding that declares one syncs across the group
// (Daily Question ↔ Answer, joined on the day). A binding that declares NONE
// is deliberately PER-OCCURRENCE — the instance notes body — and must never
// fan out: every instance row on a given day carries the same Notes field, so
// a date link there would paste one row's note onto the whole day.
//
// Slot is "header" or "body".

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function isBinding(v) {
  return (
    v &&
    typeof v === "object" &&
    typeof v.selfField === "string" &&
    (v.link == null || typeof v.link === "string")
  );
}

// True when the binding opts into cross-occurrence sync. A binding without a
// link is valid and inert for propagation — see the header note.
export function isSyncingBinding(binding) {
  return !!(binding && typeof binding.link === "string" && binding.link);
}

export function resolveEditorBinding({ occurrence, module, slot, gridDefault = null }) {
  const key = `${slot}Link`;
  const occBind = occurrence?.meta?.[key];
  if (occBind === "clear") return null;
  if (isBinding(occBind)) return occBind;
  const modBind = module?.meta?.[key];
  if (isBinding(modBind)) return modBind;
  // The grid default is OPT-IN AT THE CALL SITE rather than read from the grid
  // here. That is the whole safety of it: `ModuleTextblock` resolves its body
  // through this same function, and a grid-wide default reaching it would
  // replace all 1161 textblock bodies with an empty field — their text is
  // their own `occurrence.textmap`, and nothing would render it.
  if (isBinding(gridDefault)) return gridDefault;
  return null;
}

// The instance notes body ("Show notes"), resolved with the grid-level default
// applied. Role-gated because this row shell is NOT instance-only — textblock
// cards and artifact cards compose it too (see ModuleInstance's `canHaveBody`),
// and a textblock is already its own body.
export function resolveInstanceBodyBinding({ occurrence, module, grid }) {
  if (module?.role !== "instance") return null;
  return resolveEditorBinding({
    occurrence,
    module,
    slot: "body",
    gridDefault: grid?.meta?.instanceBodyLink ?? null,
  });
}

export function sameLinkValue(a, b) {
  if (a == null || b == null) return false;
  if (
    typeof a === "string" &&
    typeof b === "string" &&
    ISO_DATE_RE.test(a) &&
    ISO_DATE_RE.test(b)
  ) {
    return a.slice(0, 10) === b.slice(0, 10);
  }
  return a === b;
}

// Walk occurrencesById; return occurrences (other than the host) that share
// the host's link-field value AND have the selfField present. Skips matches
// whose current value already equals nextValue (loop prevention).
export function findLinkedSiblings({ binding, hostOccurrence, occurrencesById, nextValue }) {
  if (!binding || !hostOccurrence || !occurrencesById) return [];
  // A link-less binding is per-occurrence BY DESIGN and never fans out. This
  // is the dangerous direction: without it, an instance notes body bound
  // grid-wide would write one row's note onto every row sharing the link.
  if (!isSyncingBinding(binding)) return [];
  const linkVal = hostOccurrence?.fields?.[binding.link]?.value;
  if (linkVal == null) return [];
  const out = [];
  for (const occ of Object.values(occurrencesById)) {
    if (!occ || occ.id === hostOccurrence.id) continue;
    const otherLinkVal = occ?.fields?.[binding.link]?.value;
    if (!sameLinkValue(otherLinkVal, linkVal)) continue;
    if (!occ.fields || !(binding.selfField in occ.fields)) continue;
    if (occ.fields[binding.selfField]?.value === nextValue) continue;
    out.push(occ);
  }
  return out;
}
