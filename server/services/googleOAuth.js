// services/googleOAuth.js — the Google sign-in that creates a Drive storage
// connection (plan 2026-09-24-connections-storage-gdrive, Task 4).
//
//   startUrl(userId, { redirectUri, reconnectId })  -> the Google consent URL
//   completeConnect({ code, state, redirectUri })    -> the Connection created/refreshed
//   refreshAccessToken(refreshToken)                  -> { accessToken, expiresIn }
//
// Scope is drive.file ONLY: the app sees files it created and nothing else in
// the user's Drive (and Google does not put that scope through a review).
// The refresh token is encrypted on the Connection record (models/Connection).
//
// Needs GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in server/.env and SECRETS_KEY
// (the plan's §5 one-time Google Cloud setup). GOOGLE_REDIRECT_URI overrides
// the callback URL derived from the request.
import crypto from "crypto";
import jwt from "jsonwebtoken";
import Connection from "../models/Connection.js";
import { encryptValue, isSecretsKeyConfigured } from "../models/Secret.js";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const UPLOAD_FOLDER_NAME = "Moduli uploads";
const STATE_PURPOSE = "gdrive-connect";

export class GoogleAuthError extends Error {
  constructor(message) { super(message); this.name = "GoogleAuthError"; this.status = 401; }
}

const stateSecret = () => process.env.JWT_SECRET || "SUPER_SECRET";

/** What is missing before the flow can run — [] when ready. */
export function googleSetupMissing() {
  const missing = [];
  if (!process.env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!isSecretsKeyConfigured()) missing.push("SECRETS_KEY");
  return missing;
}

/** The callback URL Google redirects to; must match the one registered in Google Cloud. */
export function redirectUriFor(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const proto = String(req.headers?.["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  return `${proto}://${req.get ? req.get("host") : req.headers?.host}/api/connections/google/callback`;
}

/**
 * The consent URL. `state` is a short-lived signed token naming the user —
 * the callback arrives as a plain browser navigation, with no session header,
 * so the state is how it knows whose connection to create.
 */
export function startUrl(userId, { redirectUri, reconnectId = null } = {}) {
  const state = jwt.sign({ p: STATE_PURPOSE, userId: String(userId), reconnectId, n: crypto.randomBytes(8).toString("hex") },
    stateSecret(), { expiresIn: "15m" });
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",          // a refresh token…
    prompt: "consent",               // …every time, even on a re-consent
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${q}`;
}

export function readState(state) {
  try {
    const d = jwt.verify(String(state || ""), stateSecret());
    return d?.p === STATE_PURPOSE && d.userId ? { userId: String(d.userId), reconnectId: d.reconnectId || null } : null;
  } catch { return null; }
}

async function tokenRequest(params, fetchImpl) {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant = revoked/expired refresh token or a spent code: the user must sign in again.
    if (body.error === "invalid_grant" || res.status === 401) throw new GoogleAuthError(body.error_description || body.error || "invalid_grant");
    const e = new Error(`Google token request failed: ${res.status} ${body.error || ""} ${body.error_description || ""}`.trim());
    e.status = 502;
    throw e;
  }
  return body;
}

export async function refreshAccessToken(refreshToken, { fetchImpl = fetch } = {}) {
  if (!refreshToken) throw new GoogleAuthError("no refresh token stored");
  const b = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
  return { accessToken: b.access_token, expiresIn: b.expires_in };
}

/**
 * Exchange the code, find the Google account, make (or re-find) the app's
 * upload folder, and create the Connection — or, when this user already has a
 * connection to the SAME Google account (or named one to reconnect), refresh
 * that one's credentials in place. Keeping the id is what keeps every stored
 * `gdrive:<connectionId>:…` ref loading after a reconnect.
 */
export async function completeConnect({ code, state, redirectUri, fetchImpl = fetch, newId = () => crypto.randomUUID() }) {
  const who = readState(state);
  if (!who) { const e = new Error("this sign-in link expired or was not issued here — start again from Connections"); e.status = 400; throw e; }
  if (!code) { const e = new Error("Google returned no authorisation code"); e.status = 400; throw e; }

  const tok = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, fetchImpl);
  if (!tok.refresh_token) { const e = new Error("Google returned no refresh token — remove Moduli from your Google account's third-party access and connect again"); e.status = 400; throw e; }
  const auth = { Authorization: `Bearer ${tok.access_token}` };

  const about = await (await fetchImpl(`${DRIVE_API}/about?fields=user(emailAddress,displayName)`, { headers: auth })).json().catch(() => ({}));
  const accountEmail = about?.user?.emailAddress || null;

  const existing = who.reconnectId
    ? await Connection.findOne({ id: who.reconnectId, userId: who.userId }).lean()
    : accountEmail ? await Connection.findOne({ userId: who.userId, type: "gdrive", "config.accountEmail": accountEmail }).lean() : null;

  // Reuse the upload folder when it is still there (drive.file can see it: the app made it).
  let folderId = existing?.config?.folderId || null;
  if (folderId) {
    const r = await fetchImpl(`${DRIVE_API}/files/${encodeURIComponent(folderId)}?fields=id,trashed`, { headers: auth });
    const f = r.ok ? await r.json() : null;
    if (!f || f.trashed) folderId = null;
  }
  if (!folderId) {
    const r = await fetchImpl(`${DRIVE_API}/files?fields=id`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: UPLOAD_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
    });
    if (!r.ok) { const e = new Error(`could not create the "${UPLOAD_FOLDER_NAME}" folder in Drive (${r.status})`); e.status = 502; throw e; }
    folderId = (await r.json()).id;
  }

  const credentials = encryptValue(tok.refresh_token);
  const config = { ...(existing?.config || {}), folderId, accountEmail };
  const $set = { config, credentials, status: "ok", statusMessage: null, lastCheckedAt: new Date() };
  if (existing) {
    await Connection.updateOne({ id: existing.id, userId: who.userId }, { $set });
    return { ...existing, ...$set, reconnected: true };
  }
  const row = { id: newId(), userId: who.userId, type: "gdrive", name: accountEmail ? `Google Drive (${accountEmail})` : "Google Drive", ...$set };
  await Connection.create(row);
  return { ...row, reconnected: false };
}
