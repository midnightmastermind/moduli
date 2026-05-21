// middleware/idempotency.js
//
// Idempotency-key middleware for POST routes. When a request carries
// `Idempotency-Key: <key>`, we cache the response (status + body) keyed
// by (tokenId, key). A replay of the same key within TTL returns the
// cached response with `X-Idempotent-Replay: true`.
//
// Default TTL: 24h. In-memory single-process cache; multi-instance
// deploys need redis (deferred, same as rate limiting).
//
// Safe to apply to PUT/PATCH/DELETE too — the cache key includes the
// method and path, so different verbs to the same path don't collide.

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 10000;

const cache = new Map(); // composite key → { ts, status, body, replays }

function makeKey(tokenId, idemKey, method, path) {
  return `${tokenId}|${method}|${path}|${idemKey}`;
}

setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of cache) {
    if (v.ts < cutoff) cache.delete(k);
  }
  // Cap entries — drop oldest first.
  if (cache.size > MAX_ENTRIES) {
    const toDelete = cache.size - MAX_ENTRIES;
    const entries = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < toDelete; i++) cache.delete(entries[i][0]);
  }
}, 5 * 60_000);

export function idempotency() {
  return (req, res, next) => {
    // Only applies to mutating verbs.
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const idemKey = req.headers["idempotency-key"];
    if (!idemKey || typeof idemKey !== "string") return next();
    const tokenId = req.apiToken?.tokenId || "anon";
    const key = makeKey(tokenId, idemKey, req.method, req.path);

    // Replay?
    const cached = cache.get(key);
    if (cached) {
      res.setHeader("X-Idempotent-Replay", "true");
      res.setHeader("X-Idempotent-Replay-Count", String(++cached.replays));
      return res.status(cached.status).json(cached.body);
    }

    // First request — intercept res.json to capture, then store + forward.
    const origJson = res.json.bind(res);
    res.json = (body) => {
      cache.set(key, { ts: Date.now(), status: res.statusCode || 200, body, replays: 0 });
      return origJson(body);
    };
    res.setHeader("X-Idempotent-Stored", "true");
    next();
  };
}

export function _resetIdempotencyForTests() {
  cache.clear();
}
