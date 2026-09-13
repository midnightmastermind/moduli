// utils/hostStallMemory.js
//
// A host that just stalled a reader fetch is skipped for a while.
//
// Measured 2026-09-13 from the production droplet: every Washington Post article
// times the live fetch out at the full 6s reader deadline (the same URL answers in
// 200-470ms from a home connection — WaPo stalls the datacenter address), and only
// THEN does the viewer look for the archive copy. So every WaPo open paid six
// seconds for an answer that was always going to be "no".
//
// Only a TIMEOUT marks a host. A 403 or a thin page is answered quickly and costs
// nothing to ask again; a stall is the expensive failure, and it is the one a host
// repeats. The archive host is never marked — skipping it would take away the
// fallback this exists to reach sooner.
export const STALL_TTL_MS = 30 * 60 * 1000;
const NEVER_MARK = new Set(["web.archive.org", "archive.org"]);

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

export function createHostStallMemory({ ttlMs = STALL_TTL_MS, now = () => Date.now() } = {}) {
  const until = new Map();
  return {
    markStalled(url) {
      const h = hostOf(url);
      if (h && !NEVER_MARK.has(h)) until.set(h, now() + ttlMs);
    },
    isStalled(url) {
      const h = hostOf(url);
      if (!h) return false;
      const t = until.get(h);
      if (!t) return false;
      if (t <= now()) { until.delete(h); return false; }
      return true;
    },
    clear(url) {
      const h = hostOf(url);
      if (h) until.delete(h);
    },
  };
}

export const readerHostStalls = createHostStallMemory();
