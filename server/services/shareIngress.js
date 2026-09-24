// server/services/shareIngress.js
//
// INGRESS PREPARES; THE RULE ROUTES (spec §3).
//
// All mechanical work happens here, before any rule runs — link metadata is
// fetched, a display label is chosen, the idempotency key is derived — so a
// rule sees clean flat data and the rule language stays free of I/O.
//
// Dependencies are INJECTED (`fetchPreview`, `storeFile`) so this module is
// testable without a network or a disk, and so the route supplies the SAME
// link-preview helper `/bookmarks` uses rather than a second one.
//
// FILES ARE NOT WIRED YET. The upload lives inline in server.js's
// `/api/artifacts/upload`; the share path must reuse it, not grow a second
// uploader (engine plan, Global Constraints). Until it is extracted, a share
// carrying a file is refused with a message that says so — never dropped.
import { classifyShare } from "./shareClassify.js";

const trimTo = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The one display label for a share — what the catch-all names its row. */
export function shareLabelFor(type, props = {}, explicit = null) {
  if (explicit && String(explicit).trim()) return trimTo(explicit, 200);
  if (type === "link") return trimTo(props.title || props.url, 200) || "Shared link";
  if (type === "text" || type === "html") return trimTo(props.firstLine || props.text, 120) || "Shared text";
  return trimTo(props.filename, 200) || "Shared file";
}

/**
 * Idempotency key (spec §7). A link keys on `<shape>:<url>` — the extension's
 * existing scheme, so a clip re-routed through /share updates the row the old
 * /ingest path made instead of duplicating it. Shape defaults to `link`.
 */
export function shareExternalIdFor(type, props = {}, { shape = null, sha256 = null } = {}) {
  if (type === "link") return `${shape || "link"}:${props.url}`;
  if (sha256) return `sha256:${sha256}`;
  if (props.filename) return `file:${props.filename}:${props.sizeBytes ?? ""}`;
  return `text:${trimTo(props.text, 200)}`;
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * The browser extension's clip record (its `buildClipRecord` output), reduced
 * to the keys the catch-all writes. It arrives from the caller, so every key
 * is type-checked and anything else is DROPPED — a rule reads `$share.clip.*`
 * and must not be handed arbitrary structure.
 *
 * This is what keeps D15's "day one is identical": the extension still decides
 * the label, the bookmark/image shape and the field ids (resolved by NAME on
 * this grid), exactly as it did when it posted to /ingest.
 */
export function sanitizeClip(raw) {
  if (!isObj(raw)) return null;
  const fields = {};
  if (isObj(raw.fields)) {
    for (const [fid, cell] of Object.entries(raw.fields)) {
      if (typeof fid === "string" && fid && isObj(cell) && "value" in cell) {
        fields[fid] = { value: cell.value, flow: cell.flow === "out" ? "out" : "in" };
      }
    }
  }
  const meta = {};
  if (isObj(raw.meta)) {
    if (str(raw.meta.clipShape)) meta.clipShape = str(raw.meta.clipShape);
    if (str(raw.meta.clippedFrom)) meta.clippedFrom = str(raw.meta.clippedFrom);
  }
  return {
    // The clip's OWN identity (`<shape>:<url>`) is authoritative. Re-deriving
    // it here from the classified url breaks on anything that is not an http
    // link — an image on a search page is a `data:` URL, classifies as a bare
    // "file", and derived `text:` with nothing after it, so every such image
    // clip shared one identity and each overwrote the last.
    externalId: str(raw.externalId),
    label: str(raw.label),
    moduleRole: str(raw.moduleRole) || "artifact",
    moduleKind: str(raw.moduleKind),
    moduleFileRef: str(raw.moduleFileRef),
    parentId: str(raw.parentId),
    fields, meta,
  };
}

export async function prepareShare({
  userId, gridId, source = "api",
  files = [], url = null, text = null, title = null, label = null, shape = null,
  clip = null,
  fetchPreview = null, storeFile = null,
}) {
  const { type, props } = classifyShare({ files, url, text, title });
  const enriched = { ...props, shape: shape || null };
  const cleanClip = sanitizeClip(clip);
  let sha256 = null;

  if (files.length) {
    if (!storeFile) {
      const err = new Error("sharing files is not wired up yet — links and text only for now");
      err.code = "files_unsupported";
      throw err;
    }
    const f = files[0];
    const stored = await storeFile({ file: f, userId, gridId });
    enriched.occurrenceId = stored.occurrenceId;
    enriched.fileRef = stored.fileRef;
    sha256 = stored.sha256 || f.sha256 || null;
  } else if (type === "link" && fetchPreview && !cleanClip) {
    // A CLIP IS NOT FETCHED. The extension already knows the page's title,
    // and a link clip is deliberately "bookmark it without visiting it"
    // (extension/README.md) — fetching it here would undo that.
    // A dead site still shares — the preview failing leaves the url itself as
    // the label, which is what /bookmarks does too.
    const preview = await fetchPreview(enriched.url).catch(() => null);
    if (preview?.ok) {
      enriched.title = enriched.title || preview.title || null;
      enriched.favicon = preview.favicon || null;
      enriched.image = preview.cover || null;
      enriched.finalUrl = preview.url || enriched.url;
    }
  }
  // The catalogue (spec §3) promises these keys on a link; present-but-null
  // beats absent, so a rule reading one resolves to null rather than failing.
  if (type === "link") {
    for (const k of ["title", "description", "siteName", "image", "favicon"]) {
      if (!(k in enriched)) enriched[k] = null;
    }
  }

  return {
    type, source,
    props: enriched,
    clip: cleanClip,
    label: shareLabelFor(type, enriched, label || cleanClip?.label),
    externalId: cleanClip?.externalId || shareExternalIdFor(type, enriched, { shape, sha256 }),
    receivedAt: new Date().toISOString(),
  };
}
