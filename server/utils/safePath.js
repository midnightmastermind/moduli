// utils/safePath.js — join a user-supplied name onto a folder WITHOUT leaving it.
//
// `path.join(root, "../../etc/passwd")` happily walks out of `root`; the
// connection import did exactly that (audit A3, 2026-09-24). Returns the
// absolute path when it is strictly inside `root`, else null. Absolute names,
// `..` segments that escape, NUL bytes and the root itself are all refused.
import path from "path";

export function resolveInside(root, name) {
  if (typeof root !== "string" || typeof name !== "string" || !name || name.includes("\0")) return null;
  const base = path.resolve(root);
  const full = path.resolve(base, name);
  return full.startsWith(base + path.sep) ? full : null;
}
