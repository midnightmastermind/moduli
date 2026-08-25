// helpers/occurrenceMedia.js
// ============================================================
// THE resolver for "what pictures/files belong to this occurrence".
//
// Before this file there were TWO unrelated representations of an image that
// belongs to a thing: a media-role field holding a raw STRING (fileRef or
// remote URL), and a role:"artifact" module+occurrence. A person's photo was
// a string, so it could not be opened, captioned, dragged, or sit beside a
// PDF; an artifact could not be a profile picture, because nothing read
// artifacts when it wanted a thumbnail.
//
// The merge: a media field's value is an OCCURRENCE ID naming an artifact.
// Attachment is then an ordinary occurrence dropdown (`role:"files"`,
// multi-select), so the same artifact can hang off several occurrences by
// reference and nothing new goes through ancestry walks or the delete cascade.
//
//   media binding (role:"media")  → the ONE entry marked as the face
//   files binding (role:"files")  → every ATTACHED artifact, the face included
//   occurrences[]                 → artifacts living INSIDE this occurrence
//
// THE LAST TWO COEXIST — they are not alternatives (user, 2026-08-06). A
// container can hold artifact occurrences as real children AND carry a Files
// field attaching others by reference. `filesOf` returns the UNION, tagging
// each entry with where it came from, because the two are written differently:
// a child's order lives in `occurrences[]`, an attachment's in the Files array.
//
// NO FALLBACK FOR LEGACY STRINGS. A value that is not a resolvable artifact
// occurrence id returns null, deliberately: a passthrough would render an
// unmigrated grid correctly and hide the fact that it was never migrated.
// `server/migrations/0043-media-fields-to-artifacts.mjs` is what fixes data.
//
// Read through this file at EVERY thumbnail site — Field's media pill and
// `resolveOccCard`, ModuleInstance's media block, RepresentationView. The
// inline `bindings.find(b => b.role === "media")` those sites used to carry
// lives here now, once.
// ============================================================
import { resolveFileRef } from "./fileRef";
import { resolveMainFile } from "./mainFile";

function bindingsOf(module) {
  return Array.isArray(module?.fieldBindings) ? module.fieldBindings : [];
}

function fieldIdForRole(module, role) {
  return bindingsOf(module).find(b => b?.role === role)?.fieldId ?? null;
}

// The field holding the id of the entry marked as this occurrence's face.
export function mediaFieldIdFor(module) {
  return fieldIdForRole(module, "media");
}

// The multi-select field holding every artifact attached to this occurrence.
export function filesFieldIdFor(module) {
  return fieldIdForRole(module, "files");
}

// A stored field value is either the `{value, flow}` wrapper or the bare
// value (FieldRenderer unwraps before it reaches Field). Arrays pass through
// untouched — treating an array as "object without a value key" is the
// 2026-07-12 bug that made every multi-select render "—".
function rawValue(occ, fieldId) {
  if (!fieldId) return undefined;
  const v = occ?.fields?.[fieldId];
  if (v && typeof v === "object" && !Array.isArray(v)) return "value" in v ? v.value : undefined;
  return v;
}

// Normalize a pick value to a list of ids. A Files field is multi-select, but
// a single id is accepted so a not-yet-multi binding still resolves.
function idsFrom(value) {
  if (Array.isArray(value)) return value.filter(v => typeof v === "string" && v);
  return typeof value === "string" && value ? [value] : [];
}

// Resolve one id to the artifact behind it. Returns null unless the id names
// a real occurrence whose module is role:"artifact" — that gate is what makes
// a legacy string value resolve to nothing instead of to garbage.
function resolveArtifact(id, ctx) {
  const occ = ctx?.occurrencesById?.[id];
  if (!occ) return null;
  const module = ctx?.modulesById?.[occ.moduleId];
  if (!module || module.role !== "artifact") return null;
  return {
    occ,
    module,
    kind: module.kind || null,
    src: resolveFileRef(module.fileRef),
    label: occ.label || module.label || "",
  };
}

// The entry marked as the face: `{ occ, module, kind, src, label }` or null.
//
// ── RESOLUTION ORDER, AND WHY THE FALLBACK IS LOAD-BEARING ─────────────────
// 1. `main` on the FILES field — the face the user picked (Task 4b).
// 2. the `role:"media"` binding — how a face was expressed before `main`.
//
// This is ADDITIVE, and measurably so: on 2026-08-07 both live grids held 213
// occurrences with a Files value and **zero** with a `main`, so today every
// lookup falls through to step 2 and behaves byte-identically. Step 1 lights up
// only as faces get marked.
//
// The order cannot be reversed. Person and movie rows carry BOTH a media
// binding and a Files field, so preferring the binding would make marking a new
// face silently do nothing — the change would look shipped and be inert.
//
// `resolveMainFile` refuses a main that is not attached, and `resolveArtifact`
// refuses an id that is not a real artifact, so a broken step 1 falls through to
// step 2 rather than resolving to a hole.
export function primaryMediaOf(occ, ctx) {
  const module = ctx?.modulesById?.[occ?.moduleId];

  const mainId = resolveMainFile(occ?.fields?.[filesFieldIdFor(module)]);
  const fromMain = mainId ? resolveArtifact(mainId, ctx) : null;
  if (fromMain) return fromMain;

  const [id] = idsFrom(rawValue(occ, mediaFieldIdFor(module)));
  return id ? resolveArtifact(id, ctx) : null;
}

// Every artifact belonging to this occurrence — the UNION of what is ATTACHED
// (the Files field) and what lives INSIDE it (`occurrences[]` children).
// PRIMARY FIRST, deduped, with unresolvable ids skipped rather than rendered
// as holes.
//
// Each entry carries `source`, and it is load-bearing rather than decoration:
// a CHILD's order lives in the owner's `occurrences[]` and its canvas position
// on its own `meta`, while an ATTACHED artifact's order lives in the Files
// array — and its position cannot live on the artifact, because a reference is
// shared by every occurrence that picked it. Whoever writes an arrangement has
// to know which it is holding.
export function filesOf(occ, ctx) {
  const module = ctx?.modulesById?.[occ?.moduleId];
  const primaryId = idsFrom(rawValue(occ, mediaFieldIdFor(module)))[0] || null;
  const attachedIds = idsFrom(rawValue(occ, filesFieldIdFor(module)));
  const childIds = Array.isArray(occ?.occurrences) ? occ.occurrences : [];

  const ordered = [];
  const seen = new Set();
  const push = (id, source) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const resolved = resolveArtifact(id, ctx);
    // Children are every kind of occurrence, not just artifacts — resolveArtifact
    // is what keeps a container's ordinary items out of its spread.
    if (resolved) ordered.push({ ...resolved, source, isPrimary: id === primaryId });
  };

  // AN ARTIFACT IS ITS OWN FILE — BUT ONLY IF IT HAS ONE.
  //
  // This exists so opening the spread ON an artifact resolves something:
  // an image artifact carries no Poster, no Files and no children, so without
  // it clicking a picture opened an EMPTY viewer. Pushed FIRST so a single
  // artifact opens as a one-window view of itself (user, 2026-08-16: "single
  // artifacts would still only open up that one in the view").
  //
  // ITS PREMISE — "an artifact carries no children" — STOPPED BEING TRUE.
  // `0222` imported every media row as role:"artifact" rather than "instance",
  // and `0246` then hung a poster artifact off each one as a real child. So a
  // movie row is an artifact that owns a file WITHOUT BEING ONE: measured on
  // prod, `John Wick` is role:"artifact" kind:"movie" with `fileRef: ""` and
  // one child, `John Wick poster`, holding the TMDB url.
  //
  // Pushing self there contributed a file-less entry that the card then drew
  // from the row's own cover — so the spread showed the SAME poster twice and
  // said "2 files" (user, 2026-08-25: "the movie posters are showing up twice
  // when i click on the media previewer").
  //
  // So self is pushed when it HAS a file, or when nothing else would render —
  // which keeps the empty-viewer case it was written for, and drops the
  // duplicate. Deliberately NOT a dedupe on fileRef: two DIFFERENT artifacts
  // that happen to share a url are still two attachments, and collapsing them
  // would hide a real double-attach instead of fixing one.
  const selfArtifact = resolveArtifact(occ?.id, ctx);
  const othersExist = [primaryId, ...attachedIds, ...childIds]
    .some(id => id && id !== occ?.id && resolveArtifact(id, ctx));
  if (selfArtifact && (selfArtifact.src || !othersExist)) push(occ?.id, "self");
  if (primaryId) push(primaryId, attachedIds.includes(primaryId) ? "field" : "child");
  for (const id of attachedIds) push(id, "field");
  for (const id of childIds) push(id, "child");
  return ordered;
}
