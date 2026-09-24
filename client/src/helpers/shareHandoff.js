// helpers/shareHandoff.js
//
// SHARING FROM THE PHONE / WINDOWS (share plan 3). A share arrives as a form
// POST to /share-target that carries NO credential — the OS builds it — while
// /api/v1/share needs a Bearer. So it is handed over in two halves:
//
//   public/sw.js      catches the POST, keeps the ORIGINAL FORM in Cache
//                     Storage under `stashUrl(id)`, redirects (303) to
//                     /share-pending?id=<id>
//   SharePending.jsx  takes the form back out, attaches the signed-in session,
//                     posts it to /api/v1/share and SAYS what happened
//
// The form itself is the shape both halves agree on — Cache Storage holds a
// Response built from the FormData, so there is no second schema to drift. The
// only shared facts are the cache name and the key, and the service worker
// (a classic script, which cannot import this module) repeats them; a test
// reads sw.js and fails if they ever disagree.
export const SHARE_CACHE = "moduli-share-handoff";
export const stashUrl = (id) => `/__share-stash/${encodeURIComponent(id)}`;

/**
 * Take a stashed share OUT of Cache Storage — read and delete, so a reload of
 * the pending page cannot post the same share twice.
 * @returns {Promise<FormData|null>}
 */
export async function takeStashedShare(id, cachesApi = globalThis.caches) {
  if (!id || !cachesApi) return null;
  const cache = await cachesApi.open(SHARE_CACHE);
  const key = stashUrl(id);
  const res = await cache.match(key);
  if (!res) return null;
  await cache.delete(key);
  return res.formData();
}

/** Where the share came from — a rule can branch on `$share.source`. */
export function shareSourceFor(userAgent = "") {
  if (/Android/i.test(userAgent)) return "android";
  if (/Windows/i.test(userAgent)) return "windows";
  if (/iPhone|iPad|Mac OS/i.test(userAgent)) return "apple";
  return "pwa";
}

/**
 * The form /api/v1/share receives: the OS's own title/text/url/files, plus the
 * sender's source and timezone (so a shared calendar is read in the user's zone).
 * @param {{ title?, text?, url?, files?: File[] }} parts
 */
export function buildShareForm(parts = {}, { source = "pwa", timeZone = null, gridId = null } = {}) {
  const fd = new FormData();
  for (const k of ["title", "text", "url"]) {
    const v = parts[k];
    if (typeof v === "string" && v.trim()) fd.append(k, v);
  }
  for (const f of parts.files || []) if (f && f.size !== undefined) fd.append("files", f, f.name || "shared-file");
  fd.append("source", source);
  if (timeZone) fd.append("timeZone", timeZone);
  if (gridId) fd.append("gridId", gridId);
  return fd;
}

/** The parts of a FormData the OS sent (share_target params are title/text/url/files). */
export function partsFromForm(form) {
  if (!form) return {};
  const str = (k) => { const v = form.get(k); return typeof v === "string" ? v : null; };
  return { title: str("title"), text: str("text"), url: str("url"),
    files: form.getAll("files").filter((f) => f && typeof f === "object") };
}

/**
 * What to tell the person. A share must never look like it worked when it did
 * not (spec §12) — so a 2xx with nothing written is not "done".
 */
export function describeShareResult(status, body = {}) {
  if (status === 401) return { ok: false, message: "Sign in to Moduli on this device, then share again." };
  if (status >= 400 || !body || body.error) {
    return { ok: false, message: body?.message || body?.error || `The share failed (${status}).` };
  }
  const ran = Array.isArray(body.ran) ? body.ran : [];
  const created = ran.flatMap((r) => r.created || []);
  const failed = ran.filter((r) => r.ok === false);
  const count = created.length + (body.fileOccurrenceId && !created.some(c => c.occurrenceId === body.fileOccurrenceId) ? 1 : 0);
  if (!count) {
    return { ok: false, message: failed[0]?.error?.message ? `A rule failed: ${failed[0].error.message}` : "Nothing was filed — no rule wrote anything." };
  }
  const rules = [...new Set(ran.filter((r) => (r.created || []).length).map((r) => r.ruleName).filter(Boolean))];
  return {
    ok: true,
    title: body.label || null,
    message: `Filed ${count} item${count === 1 ? "" : "s"}${rules.length ? ` via “${rules.join("”, “")}”` : ""}.`,
    notices: Array.isArray(body.notices) ? body.notices : [],
    updated: created.length > 0 && created.every((c) => c.status === "updated"),
  };
}
