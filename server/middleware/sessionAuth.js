// middleware/sessionAuth.js — the signed-in app session on plain Express routes.
//
// The upload, image, connection and import routes used to trust a `userId`
// sent in the request body (audit A2, plan 2026-09-24-connections-storage-
// gdrive): anyone who knew a user id could write into that user's grid and
// fill the server's disk. The session JWT the app already holds for its socket
// is the identity now; a body `userId` is ignored.
//
// `requireSession` MUST run before any multer middleware on an upload route —
// otherwise an unauthenticated request still streams its file to disk first.

import mongoose from "mongoose";
import { verifyToken } from "../utils/jwts.js";
import Grid from "../models/Grid.js";

export function sessionUserId(req) {
  const header = req.headers?.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return null;
  const decoded = verifyToken(m[1].trim());
  return decoded?.userId ? String(decoded.userId) : null;
}

export function requireSession(req, res, next) {
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ error: "unauthorized", message: "Sign in again — this request carried no valid session." });
  req.userId = userId;
  next();
}

/** True when `gridId` is absent (nothing to check) or names a grid this user owns. */
export async function ownsGrid(userId, gridId) {
  if (!gridId) return true;
  if (!mongoose.isValidObjectId(gridId)) return false;
  return !!(await Grid.exists({ _id: gridId, userId }));
}
