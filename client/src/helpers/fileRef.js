// helpers/fileRef.js
// Resolve an artifact `fileRef` to a renderable src URL.
//
// Backstory: artifact modules have historically stored a path
// relative to the user's upload directory (e.g. "kittens.jpg"),
// and renderers built `src = /uploads/${fileRef}` directly. The
// drag-to-import pipeline (docket #6.5) mints artifact modules
// pointing at REMOTE images (Wikipedia, etc.) — those refs are
// absolute URLs that must NOT be prefixed.
//
// One shared helper avoids the "did I remember to handle absolute
// URLs everywhere?" footgun. The detection is conservative: only
// recognized schemes (http/https/data/blob) and absolute paths
// (leading `/`) pass through; anything else is treated as a
// relative `/uploads/<X>` ref.
//
// Use this everywhere a fileRef is turned into an `<img src>` /
// `<video src>` / `<audio src>` / `<iframe src>` etc.
// ============================================================
// Artifact shapes — audit (docket §8 gap #21, recorded 2026-05-21).
//
// Two artifact-module variants share the `role:"artifact"` shape but
// differ in `fileRef` semantics. Every code path that touches
// artifacts should know which it is dealing with. Detection: the
// helpers below (`isExternalFileRef` / `isExternalArtifact`).
//
//   ┌────────────────┬──────────────────────────┬────────────────────────────┐
//   │ shape          │ fileRef                  │ origin                     │
//   ├────────────────┼──────────────────────────┼────────────────────────────┤
//   │ internal       │ "user/<ts>-<rnd>.<ext>"  │ /api/artifacts/upload      │
//   │ (local upload) │ "/uploads/<path>"        │ /api/connections/:id/import│
//   ├────────────────┼──────────────────────────┼────────────────────────────┤
//   │ external       │ "https://…"              │ Wikipedia drop / drag-to-  │
//   │ (absolute URL) │ "data:…" or "blob:…"     │ import / markdown importer │
//   └────────────────┴──────────────────────────┴────────────────────────────┘
//
// Renderers handle both transparently via `resolveFileRef`, but other
// code paths MUST special-case external refs:
//
//   • Delete — internal: also delete file on disk; external: nothing to delete.
//   • Dedup (SHA-256, docket gap #3) — internal only; external dedup
//     would mean "same URL" + a uniqueness scan.
//   • Storage size accounting (per-user quota, gap #15) — internal
//     only; external doesn't consume user storage.
//   • Year-month upload sharding (gap #18) — internal only.
//   • Orphan-file cleanup (gap #19) — internal only.
//   • Remote-image mirroring (gap #22) — converts external → internal.
//   • CDN / signed-URL serving (gap #17) — internal only.
//
// `module.meta.external: true` is set by external-origin paths as
// a fast-path marker; it's authoritative when present. When the
// flag is missing (legacy modules), fall back to detecting from the
// fileRef itself via `isExternalFileRef`.
// ============================================================

export function resolveFileRef(fileRef) {
  if (!fileRef) return null;
  if (/^(?:https?:|data:|blob:|\/)/i.test(fileRef)) return fileRef;
  return `/uploads/${fileRef}`;
}

// True when the fileRef is an absolute URL (http/https/data/blob)
// rather than a relative path under uploads/. Internal helper for
// the special-case code paths listed above. Matches what
// `resolveFileRef` would pass through unchanged, minus the leading-`/`
// case (server-absolute paths are still treated as internal since
// they live under our origin).
export function isExternalFileRef(fileRef) {
  if (!fileRef) return false;
  return /^(?:https?:|data:|blob:)/i.test(fileRef);
}

// Module-level helper. Trusts `meta.external` when present; falls
// back to fileRef detection. Use this when deciding whether to apply
// the internal-only operations (dedup, size accounting, orphan cleanup,
// year-month sharding, mirroring).
export function isExternalArtifact(module) {
  if (!module) return false;
  if (module?.meta?.external === true) return true;
  if (module?.meta?.external === false) return false;
  return isExternalFileRef(module?.fileRef);
}
