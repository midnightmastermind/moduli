// One number, edited once — a field's displayConfig value that FOLLOWS another
// field's instead of storing its own copy.
//
// THE PROBLEM IT EXISTS FOR (audit item C1). The tasks goal is two fields:
//
//     Tasks Completed   { startValue: 0, targetValue: 5, targetOp: ">=" }   counts UP
//     Tasks Left        { startValue: 5, targetValue: 0, targetOp: "<=" }   counts DOWN
//
// Both encode "5 tasks", in two editors under two names. Changing one is not an
// error and leaves the pair silently disagreeing — the honest answer to *"can I
// change my tasks goal from 10 to 5 easily"* was "yes, twice, if you know".
//
// A field may now declare:
//
//     meta.deriveDisplayFrom = { fieldId, from: "targetValue", to: "startValue" }
//
// …meaning "my startValue IS that field's targetValue". There is one number.
//
// IT FAILS SOFT, ON PURPOSE. A missing source field, a missing value, or a
// self-reference returns the field UNCHANGED rather than throwing or blanking —
// the stored value is still there and still correct-ish, and a goal tile that
// renders nothing is worse than one showing a slightly stale anchor. The editor
// is what tells the user it is derived; this layer never removes information.
//
// It resolves ONE hop and never follows a chain: a derivation whose source is
// itself derived would need cycle detection, and nothing on the grid asks for
// it. A chain is refused rather than half-followed.

/** Keys a derivation is allowed to read or write. Anything else is ignored. */
export const DERIVABLE_KEYS = ["targetValue", "startValue"];

/**
 * True when `field` declares a well-formed derivation.
 * Exported so the editor can render the control read-only without re-deriving
 * the rule (two opinions about "is this derived" is how they drift).
 */
export function derivationOf(field) {
  const d = field?.meta?.deriveDisplayFrom;
  if (!d || typeof d !== "object") return null;
  const { fieldId, from, to } = d;
  if (typeof fieldId !== "string" || !fieldId) return null;
  if (!DERIVABLE_KEYS.includes(from) || !DERIVABLE_KEYS.includes(to)) return null;
  if (fieldId === field.id) return null; // a field cannot follow itself
  return { fieldId, from, to };
}

/**
 * Returns `field` with its derived displayConfig key filled in from the source
 * field. Returns the SAME OBJECT when nothing is derived, so callers can use it
 * unconditionally without adding a render.
 */
export function resolveDisplayConfig(field, fieldsById) {
  const d = derivationOf(field);
  if (!d || !fieldsById) return field;

  const src = fieldsById[d.fieldId];
  if (!src) return field;                       // deleted source — keep what we have
  if (derivationOf(src)) return field;          // one hop only; never a chain
  const v = src.displayConfig?.[d.from];
  if (v == null) return field;                  // nothing to follow

  const cur = field.displayConfig?.[d.to];
  if (cur === v) return field;                  // already equal — no new object

  return { ...field, displayConfig: { ...(field.displayConfig || {}), [d.to]: v } };
}
