// Editor↔field binding helpers.
//
// A binding is a JOIN: { target: fieldId, link: linkFieldId }. To render the
// bound editor, we look for an occurrence X (other than the host) where
// X.fields[link].value SAME_LINK-matches host.fields[link].value and
// X.fields[target] carries a non-empty value. The host's editor renders X's
// target field; writes go back to X.
//
// Bindings live on either occurrence.meta.<slot>Link (placement-specific
// override) or module.meta.<slot>Link (template-wide default). Cascade:
// occurrence wins → module next → null. An explicit "clear" string on the
// occurrence opts out of a module-level binding without re-setting it.
//
// Slot is either "header" (container-header content) or "body" (textblock
// body content).

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function isBinding(v) {
  return (
    v &&
    typeof v === "object" &&
    typeof v.target === "string" &&
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

export function findLinkedOccurrence({ binding, hostOccurrence, occurrencesById }) {
  if (!binding || !hostOccurrence || !occurrencesById) return null;
  const linkVal = hostOccurrence?.fields?.[binding.link]?.value;
  if (linkVal == null) return null;
  for (const occ of Object.values(occurrencesById)) {
    if (!occ || occ.id === hostOccurrence.id) continue;
    const matchLink = occ?.fields?.[binding.link]?.value;
    if (!sameLinkValue(matchLink, linkVal)) continue;
    const tgtVal = occ?.fields?.[binding.target]?.value;
    if (tgtVal == null || tgtVal === "") continue;
    return occ;
  }
  return null;
}
