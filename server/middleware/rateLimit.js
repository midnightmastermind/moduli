// middleware/rateLimit.js
//
// Per-token in-memory rate limiter. Token-bucket-ish: each token gets
// `windowRequests` over a rolling `windowMs` window. Returns 429 with
// Retry-After when exceeded.
//
// Slice-1 implementation — single-process state. Multi-instance deploys
// will need a shared backend (redis, etc.).

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_WINDOW_REQUESTS = 600; // 10/sec average, plenty of headroom

// Map<tokenId, { timestamps: number[] }> — keeping just the timestamps
// inside the window. Cheap enough for thousands of tokens at 600 req/min.
const buckets = new Map();

// Periodic GC so abandoned tokens don't hold memory forever.
setInterval(() => {
  const cutoff = Date.now() - DEFAULT_WINDOW_MS;
  for (const [k, b] of buckets) {
    while (b.timestamps.length && b.timestamps[0] < cutoff) b.timestamps.shift();
    if (b.timestamps.length === 0) buckets.delete(k);
  }
}, 5 * 60_000);

export function rateLimit({ windowMs = DEFAULT_WINDOW_MS, windowRequests = DEFAULT_WINDOW_REQUESTS } = {}) {
  return (req, res, next) => {
    const tokenId = req.apiToken?.tokenId;
    if (!tokenId) return next(); // unauthenticated requests are blocked at apiAuth anyway

    const now = Date.now();
    const cutoff = now - windowMs;
    let bucket = buckets.get(tokenId);
    if (!bucket) { bucket = { timestamps: [] }; buckets.set(tokenId, bucket); }
    // Drop expired timestamps.
    while (bucket.timestamps.length && bucket.timestamps[0] < cutoff) bucket.timestamps.shift();
    if (bucket.timestamps.length >= windowRequests) {
      const oldest = bucket.timestamps[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      res.setHeader("X-RateLimit-Limit", String(windowRequests));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("X-RateLimit-Reset", String(Math.ceil((oldest + windowMs) / 1000)));
      return res.status(429).json({
        error: "rate_limited",
        message: `Token exceeded ${windowRequests} requests per ${windowMs / 1000}s window`,
      });
    }
    bucket.timestamps.push(now);
    res.setHeader("X-RateLimit-Limit", String(windowRequests));
    res.setHeader("X-RateLimit-Remaining", String(windowRequests - bucket.timestamps.length));
    next();
  };
}

// Test helper — clear all buckets.
export function _resetRateLimitForTests() {
  buckets.clear();
}
