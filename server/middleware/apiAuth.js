// middleware/apiAuth.js
//
// Bearer-token auth for /api/v1/* routes. Sets req.apiToken + req.userId on
// success. Scope check is a separate helper so a route can require multiple
// scopes (e.g. write + admin) without re-fetching the token.

import ApiToken from "../models/ApiToken.js";
import { verifyToken } from "../utils/jwts.js";

// `allowSessionJwt`: ALSO accept the signed-in app's own session token (the
// JWT in localStorage["moduli-token"]) as the Bearer. Opted into per route —
// only `POST /share`, whose phone/Windows share page runs inside the app and
// holds that session, not an API token. The session already grants everything
// over the socket, so this widens no one's reach; it is still a Bearer header,
// never a cookie (share plan, Global Constraints).
export function apiAuth({ requireScope = null, allowSessionJwt = false } = {}) {
  return async (req, res, next) => {
    try {
      // Already authenticated (e.g. by a parent /batch handler) — just
      // re-check the scope and pass through. Avoids per-sub-request
      // bcrypt overhead inside a batch.
      if (req.apiToken && req.userId) {
        if (requireScope && !req.apiToken.scopes.includes(requireScope)) {
          return res.status(403).json({ error: "forbidden", message: `Token lacks scope: ${requireScope}` });
        }
        return next();
      }

      const header = req.headers.authorization || "";
      if (!header.startsWith("Bearer ")) {
        return res.status(401).json({ error: "unauthorized", message: "Missing Bearer token" });
      }
      const rawToken = header.slice("Bearer ".length).trim();
      let tokenDoc = await ApiToken.authenticate(rawToken);
      if (!tokenDoc && allowSessionJwt) {
        const session = verifyToken(rawToken);
        if (session?.userId) {
          tokenDoc = { tokenId: "session", userId: String(session.userId), scopes: ["read", "write"], session: true };
        }
      }
      if (!tokenDoc) {
        return res.status(401).json({ error: "unauthorized", message: "Invalid or revoked token" });
      }
      if (requireScope && !tokenDoc.scopes.includes(requireScope)) {
        return res.status(403).json({ error: "forbidden", message: `Token lacks scope: ${requireScope}` });
      }
      req.apiToken = tokenDoc;
      req.userId = tokenDoc.userId;
      next();
    } catch (err) {
      console.error("[apiAuth] error:", err);
      res.status(500).json({ error: "internal_error", message: "Auth check failed" });
    }
  };
}
