// helpers/mainFile.js
// ============================================================
// `main` on a Files field value — WHICH attachment is the occurrence's face.
//
// Task 4b Step 2 of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md.
// User's framing: the Files field is an ordinary multi-select, with one
// selection designated as the face. Not a second field, not a separate list —
// a marker ON the value that is already there.
//
// ── THE INVARIANT: main ∈ value ─────────────────────────────────────────────
//
// A `main` naming a file that is not attached is a dangling reference wearing a
// different hat, and this repo has paid for that class more than once (the
// recurring `dangling-child-ref`, the `missing-module` sweep, the 2026-08-01
// scrub that removed the only thing rendering a surviving sibling). It cannot be
// enforced at the UI layer because the UI is not the only writer — a drop, a
// delete and a migration all touch this value. So it is enforced HERE, in the
// only functions allowed to write it, and `resolveMainFile` refuses to hand back
// a main that violates it even if bad data somehow exists.
//
// ── WHY `setMainFile` ATTACHES RATHER THAN REFUSING ─────────────────────────
//
// Dropping an artifact on the main-picture area means "this is the face"
// (user, 2026-08-07). If that file is not attached yet, the only two ways to
// keep the invariant are to refuse the drop or to attach it. Refusing makes the
// gesture silently do nothing; attaching is what the user meant. So a main is
// always also an attachment, and the drop is one call.
//
// ── SHAPE ───────────────────────────────────────────────────────────────────
//
// Measured on live data 2026-08-07 — both grids store
//   { value: ["<artifactOccId>", …], flow: "replace" }
// and **zero of 213 rows carry a main**, so this is greenfield. `main` sits
// beside `value` on the same wrapper; every other key is preserved untouched
// (flow and timestamp are read by aggregation and by the conflict check).
//
// Pure: no React, no store, no writes. Callers persist the returned wrapper.
// ============================================================

/**
 * "copy" (a new occurrence per placement) or "multiparent" (one occurrence
 * listed by several parents).
 *
 * ── CLIENT TWIN OF `server/utils/filesFolder.js placementSemanticForKind`.
 *    KEEP IN SYNC — same relationship `helpers/alarmOps` has with the server's
 *    `makeAlarmOp`. The server holds the authoritative rule because it also
 *    enforces the delete side of it; this exists so a DROP can decide without a
 *    round trip.
 *
 * MEDIA → COPY. One module (one fileRef, one deduped blob), N occurrences; each
 * placement moves, styles and deletes independently.
 *
 * MARKDOWN → MULTIPARENT. **`textmap` lives on the OCCURRENCE**, so two
 * occurrences of one markdown module carry two INDEPENDENT BODIES — you would
 * edit the copy on your day page and the one in Files would still show the old
 * text, with nothing to explain why. `CommitHelpers.createPageInContainer`
 * carries this warning verbatim; the Schedule's shared slots are the same
 * pattern working correctly.
 */
export function placementSemanticForKind(kind) {
  return kind === "markdown" ? "multiparent" : "copy";
}

/** The array of attached artifact occurrence ids, from either shape. */
function valueArray(fieldValue) {
  if (Array.isArray(fieldValue)) return fieldValue;
  const v = fieldValue?.value;
  if (Array.isArray(v)) return v;
  return v ? [v] : [];
}

/** The wrapper keys to preserve. A bare array has none. */
function wrapperOf(fieldValue) {
  if (!fieldValue || Array.isArray(fieldValue)) return {};
  const { value: _value, ...rest } = fieldValue;
  return rest;
}

/**
 * Mark `occId` as the face. Attaches it first when it is not already there, so
 * the invariant holds by construction and a drop is a single call.
 * A falsy id is refused rather than written — a main of "" reads as "set" to
 * every truthiness check downstream.
 */
export function setMainFile(fieldValue, occId) {
  if (!occId) return fieldValue;
  const current = valueArray(fieldValue);
  const value = current.includes(occId) ? current : [...current, occId];
  return { ...wrapperOf(fieldValue), value, main: occId };
}

/** Drop the face marker, leaving every attachment in place. */
export function clearMainFile(fieldValue) {
  const { main: _main, ...rest } = wrapperOf(fieldValue);
  return { ...rest, value: valueArray(fieldValue) };
}

/**
 * Detach `occId`. When it was the main, the marker goes with it — the
 * alternative is a main pointing at something no longer attached, which is the
 * invariant this module exists to hold.
 */
export function removeFile(fieldValue, occId) {
  const current = valueArray(fieldValue);
  if (!occId || !current.includes(occId)) return fieldValue;
  const value = current.filter(id => id !== occId);
  const rest = wrapperOf(fieldValue);
  if (rest.main === occId) delete rest.main;
  return { ...rest, value };
}

/**
 * The face, or null. **Refuses a main that is not attached** rather than
 * returning it: if data ever violates the invariant, a caller must fall back to
 * its normal thumbnail path instead of resolving a reference that goes nowhere.
 * An absent main is a legal, and currently near-universal, state.
 */
export function resolveMainFile(fieldValue) {
  const main = (!fieldValue || Array.isArray(fieldValue)) ? null : fieldValue.main;
  if (!main) return null;
  return valueArray(fieldValue).includes(main) ? main : null;
}
