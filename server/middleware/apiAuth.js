// middleware/apiAuth.js
//
// Bearer-token auth for /api/v1/* routes. Sets req.apiToken + req.userId on
// success. Scope check is a separate helper so a route can require multiple
// scopes (e.g. write + admin) without re-fetching the token.

import ApiToken from "../models/ApiToken.js";

export function apiAuth({ requireScope = null } = {}) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || "";
      if (!header.startsWith("Bearer ")) {
        return res.status(401).json({ error: "unauthorized", message: "Missing Bearer token" });
      }
      const rawToken = header.slice("Bearer ".length).trim();
      const tokenDoc = await ApiToken.authenticate(rawToken);
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
