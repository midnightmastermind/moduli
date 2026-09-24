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

export async function prepareShare({
  userId, gridId, source = "api",
  files = [], url = null, text = null, title = null, label = null, shape = null,
  fetchPreview = null, storeFile = null,
}) {
  const { type, props } = classifyShare({ files, url, text, title });
  const enriched = { ...props };
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
  } else if (type === "link" && fetchPreview) {
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
    label: shareLabelFor(type, enriched, label),
    externalId: shareExternalIdFor(type, enriched, { shape, sha256 }),
    receivedAt: new Date().toISOString(),
  };
}
