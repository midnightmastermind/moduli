// utils/textmapDigest.js
//
// A short fingerprint of a textmap, shared by the client and the server.
//
// WHY: an open editor can hold text the server no longer has. On 2026-10-01 a
// migration rewrote a doc while the user's tab had it open; the restart's
// full_state refreshed the row's `updatedAt` in the tab but the mounted editor
// kept its old document, and its next save put the pre-migration text back.
// The stale-write check could not see it: it compares TIMESTAMPS (and the tab
// had just been handed a fresh one), and it is skipped entirely while only one
// tab is open.
//
// So a text save carries the fingerprint of the server text its document was
// built on, and the server refuses the save when the stored text is no longer
// that. The fingerprint compares CONTENT, so a field or child-list write on the
// same row (which moves `updatedAt`) never makes a text save look stale.
//
// Keys are sorted before hashing: the same document can arrive with its keys in
// a different order (Mongo, a socket echo, a migration), and that must not read
// as a different text. Plain, so `node:` and the browser bundle can both import it.

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

/** FNV-1a over the canonical text. "" for no textmap. */
export function textmapDigest(textmap) {
  if (!textmap || typeof textmap !== "object") return "";
  const s = canonical(textmap);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${s.length.toString(36)}-${(h >>> 0).toString(36)}`;
}
