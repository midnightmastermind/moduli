// extension/settings.js
//
// What the extension needs to know, and how it fails when it does not.
//
// PURE so the validation is tested: the failure this guards is a clip that
// silently goes nowhere. Half-configured is the common state — a token pasted
// but no grid picked — and a background worker that just returns leaves the
// user right-clicking into a void.

export const SETTINGS_KEYS = ["baseUrl", "token", "gridId", "parentId"];

export const DEFAULT_BASE_URL = "https://viafluere.com";

/**
 * @returns {{ ok: true, settings } | { ok: false, missing: string[], message: string }}
 *
 * `parentId` is OPTIONAL — with none, a clip still lands (ingest just does not
 * link it into a parent) and can be filed later. Requiring it would block the
 * common case to prevent a recoverable one.
 */
export function validateSettings(raw = {}) {
  const settings = {
    baseUrl: String(raw.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    token: String(raw.token || "").trim(),
    gridId: String(raw.gridId || "").trim(),
    parentId: String(raw.parentId || "").trim() || null,
  };
  const missing = ["token", "gridId"].filter((k) => !settings[k]);
  if (missing.length) {
    return {
      ok: false, missing,
      message: `Moduli clip is not set up yet — open the extension's options and add your ${missing.join(" and ")}.`,
    };
  }
  return { ok: true, settings };
}

/** Map a `GET /api/v1/fields` response to the name -> id table a clip needs. */
export function fieldIdsFrom(fields = []) {
  const out = {};
  for (const f of Array.isArray(fields) ? fields : []) {
    if (f && f.name && f.id && !(f.name in out)) out[f.name] = f.id;
  }
  return out;
}

/** What to tell the user after a clip. */
export function clipOutcomeMessage(result) {
  if (!result || result.ok === false) return `Clip failed: ${result?.error || "unknown error"}`;
  const r = (result.results || [])[0] || {};
  if (r.status === "created") return "Clipped to Moduli";
  if (r.status === "updated") return "Already clipped — updated it";
  if (r.status === "skipped") return "Already clipped";
  // An HTTP 200 whose record still failed is the case worth naming: the request
  // worked and the clip did not, which "Clipped" would hide.
  return `Clip failed: ${r.error || "the server accepted the request but wrote nothing"}`;
}
