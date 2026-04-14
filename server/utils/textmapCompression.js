// utils/textmapCompression.js
// Compress/decompress TipTap JSON textmaps using fflate (gzip).
// Compressed textmaps are stored as base64 strings in MongoDB.
// Raw textmaps are JSON objects — check isCompressed() to distinguish.

import { gzipSync, gunzipSync, strToU8, strFromU8 } from "fflate";

export function compressTextmap(textmap) {
  if (!textmap) return textmap;
  const str = JSON.stringify(textmap);
  const compressed = gzipSync(strToU8(str), { level: 6 });
  return Buffer.from(compressed).toString("base64");
}

export function decompressTextmap(textmap) {
  if (!textmap) return textmap;
  if (typeof textmap !== "string") return textmap; // already raw JSON object
  try {
    const buf = Buffer.from(textmap, "base64");
    const decompressed = gunzipSync(new Uint8Array(buf));
    return JSON.parse(strFromU8(decompressed));
  } catch {
    return textmap; // not compressed, return as-is
  }
}

export function isCompressed(textmap) {
  return typeof textmap === "string";
}
