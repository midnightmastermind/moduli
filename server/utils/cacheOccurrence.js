// utils/cacheOccurrence.js
// Shape an occurrence row read from MONGO for the warm cache — the shape
// `loadUserIntoCache` gives every row: the textmap DECOMPRESSED.
//
// Found 2026-10-01: a textblock created inside a doc container made the
// server link it into its parent with `findOneAndUpdate` and cache the RETURNED
// ROW as-is — its textmap still the gzip+base64 string Mongo stores. Every
// later `full_state` served that string, the client's editor could not read
// it, and the doc container rendered BLANK; typing into it would then have
// saved an empty document over the real one. A pm2 restart reloads the cache
// properly, which is why it hid behind every deploy.
//
// Idempotent: a row already shaped (textmap an object, or none) is returned
// untouched, so it is safe at any site that might be handed either.
import { decompressTextmap, isCompressed } from "./textmapCompression.js";

export function cacheShapeOccurrence(doc) {
  if (!doc) return doc;
  const o = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return isCompressed(o.textmap) ? { ...o, textmap: decompressTextmap(o.textmap) } : o;
}
