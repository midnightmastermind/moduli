// services/jellyfinConfig.js — a user's Jellyfin connection, set in Command Center › Connections.
// Stored on the user (`user.meta.jellyfin`) with the API key ENCRYPTED, never in the Secret collection (an
// operation can read `$secrets.*` and send it anywhere). The key is never returned to a client.
import User from "../models/User.js";
import { encryptValue, decryptCipherShape, isSecretsKeyConfigured } from "../models/Secret.js";

export const DEFAULT_BASE_URL = "http://127.0.0.1:8097";
export const DEFAULT_PUBLIC_URL = "https://media.viafluere.com";
const TIMEOUT_MS = 5000;

const clean = (u) => String(u || "").trim().replace(/\/+$/, "");

/** Stored settings without the key: { baseUrl, publicUrl, jfUserId, hasKey } or null. */
export async function getJellyfinPublic(userId) {
  if (!userId) return null;
  const user = await User.findById(userId).select("meta.jellyfin").lean().catch(() => null);
  const j = user?.meta?.jellyfin;
  if (!j) return null;
  return { baseUrl: j.baseUrl || DEFAULT_BASE_URL, publicUrl: j.publicUrl || DEFAULT_PUBLIC_URL, jfUserId: j.jfUserId || "", hasKey: !!j.apiKey?.ciphertext };
}

/** { baseUrl, apiKey, userId: jfUserId, publicUrl } or null when not configured / key unreadable. */
export async function getJellyfinConfig(userId) {
  if (!userId) return null;
  const user = await User.findById(userId).select("meta.jellyfin").lean().catch(() => null);
  const j = user?.meta?.jellyfin;
  if (!j?.apiKey?.ciphertext) return null;
  let apiKey;
  try { apiKey = decryptCipherShape(j.apiKey); } catch { return null; }
  return { baseUrl: j.baseUrl || DEFAULT_BASE_URL, apiKey, userId: j.jfUserId || "", publicUrl: j.publicUrl || DEFAULT_PUBLIC_URL };
}

/** Saves the connection. An empty apiKey keeps the stored key (the form is write-only). */
export async function setJellyfinConfig(userId, { baseUrl, apiKey, jfUserId, publicUrl } = {}) {
  if (!userId) throw Object.assign(new Error("no user"), { status: 400 });
  const prev = (await User.findById(userId).select("meta.jellyfin").lean().catch(() => null))?.meta?.jellyfin;
  const key = String(apiKey ?? "").trim();
  let cipher = prev?.apiKey;
  if (key) {
    if (!isSecretsKeyConfigured()) throw Object.assign(new Error("SECRETS_KEY is not set on the server, so the key cannot be stored"), { status: 503 });
    cipher = encryptValue(key);
  }
  if (!cipher?.ciphertext) throw Object.assign(new Error("An API key is required"), { status: 400 });
  const doc = {
    baseUrl: clean(baseUrl) || DEFAULT_BASE_URL,
    publicUrl: clean(publicUrl) || DEFAULT_PUBLIC_URL,
    jfUserId: String(jfUserId ?? "").trim(),
    apiKey: cipher,
  };
  await User.updateOne({ _id: userId }, { $set: { "meta.jellyfin": doc } });
}

export async function clearJellyfinConfig(userId) {
  await User.updateOne({ _id: userId }, { $unset: { "meta.jellyfin": "" } });
}

/** fetch against cfg.baseUrl with the key as header (Jellyfin 12.4 rejects ?api_key=). */
export async function jellyfinFetch(cfg, path, init = {}) {
  const url = clean(cfg.baseUrl) + (String(path).startsWith("/") ? path : `/${path}`);
  const headers = {
    ...(init.headers || {}),
    Authorization: `MediaBrowser Token="${cfg.apiKey}"`,
    "X-Emby-Token": cfg.apiKey,
  };
  try {
    return await fetch(url, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw Object.assign(new Error("Jellyfin is unreachable"), { code: "media_offline", cause: e });
  }
}
