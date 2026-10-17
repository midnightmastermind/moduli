// utils/matchesPattern.js — the "matches regex" comparator, shared by the client
// executor (helpers/operationActions evalRule) and the server one (serverExecutor).
//
// The right side is a pattern: `/source/flags`, or plain text taken as a regex source
// matched case-insensitively. Patterns are compiled once and cached — a rule runs once per
// record in a loop over the grid. An invalid pattern matches nothing (never throws: a typo
// in a condition must not take the operation down). An array left matches when any member
// does; an empty left never matches.
const cache = new Map();
const CACHE_MAX = 500;

export function compilePattern(spec) {
  if (spec instanceof RegExp) return spec;
  const s = spec == null ? "" : String(spec);
  if (!s) return null;
  if (cache.has(s)) return cache.get(s);
  let re = null;
  try {
    const m = /^\/([\s\S]+)\/([dgimsuy]*)$/.exec(s);
    re = m ? new RegExp(m[1], m[2].replace(/g|y/g, "")) : new RegExp(s, "i");
  } catch { re = null; }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(s, re);
  return re;
}

export function matchesPattern(left, right) {
  const re = compilePattern(right);
  if (!re) return false;
  if (Array.isArray(left)) return left.some((v) => v != null && re.test(String(v)));
  if (left == null || left === "") return false;
  return re.test(String(left));
}
