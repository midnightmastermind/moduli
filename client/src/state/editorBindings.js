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
// module.meta.<slot>Link (template default). Cascade: occurrence wins →
// module next → null. An explicit "clear" string on the occurrence opts out
// of a module-level binding without re-setting it.
//
// Slot is "header" or "body".

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function isBinding(v) {
  return (
    v &&
    typeof v === "object" &&
    typeof v.selfField === "string" &&
    typeof v.link === "string"
  );
}

export function resolveEditorBinding({ occurrence, module, slot }) {
  const key = `${slot}Link`;
  const occBind = occurrence?.meta?.[key];
  if (occBind === "clear") return null;
  if (isBinding(occBind)) return occBind;
  const modBind = module?.meta?.[key];
  if (isBinding(modBind)) return modBind;
  return null;
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
