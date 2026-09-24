// server/config/uploadLimits.js
//
// D14 — the share path takes 500 MB, because phone video is one of the types
// sharing exists for and routinely exceeds 50 MB. The artifact-upload route
// keeps its own 50 MB: raising a limit for one entry point is a smaller claim
// than raising it for every uploader in the app.
export const ARTIFACT_MAX_BYTES = 50 * 1024 * 1024;
export const SHARE_MAX_BYTES = 500 * 1024 * 1024;

const mb = (b) => Math.round(b / 1024 / 1024);

/** A refusal that NAMES the size and the limit — "upload failed" sends you looking in the wrong place. */
export function describeTooLarge(sizeBytes, limit = SHARE_MAX_BYTES) {
  return sizeBytes
    ? `Too large to share (${mb(sizeBytes)} MB, limit ${mb(limit)} MB)`
    : `Too large to share (limit ${mb(limit)} MB)`;
}
