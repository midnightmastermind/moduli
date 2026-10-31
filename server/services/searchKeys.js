// services/searchKeys.js — a user's API keys for the search providers (TMDB, USDA, …), set in
// Command Center › Imports › Search sources (user, 2026-10-31: "lets try to not let that be hardcoded, we need a
// section in command center imports that allow for search boxes and api keys for them").
//
// Stored ENCRYPTED on the user (`user.meta.searchKeys[keyId] = {iv, ciphertext, authTag}`) — deliberately NOT
// in the Secret collection, whose values an operation can read as `$secrets.KEY` and send anywhere with
// CALL_API (the same call models/Connection.js makes for storage credentials). A key is never sent back to a
// client; the list says only where each key comes from.
import User from "../models/User.js";
import { encryptValue, decryptCipherShape, isSecretsKeyConfigured } from "../models/Secret.js";

/** { keyId: plaintext } for this user. A key that cannot be decrypted is left out, never thrown. */
export async function userSearchKeys(userId) {
  if (!userId) return {};
  const user = await User.findById(userId).select("meta.searchKeys").lean().catch(() => null);
  const stored = user?.meta?.searchKeys || {};
  const out = {};
  for (const [id, cipher] of Object.entries(stored)) {
    if (!cipher?.ciphertext) continue;
    try { out[id] = decryptCipherShape(cipher); } catch { /* wrong SECRETS_KEY or damaged — treat as unset */ }
  }
  return out;
}

/** Sets (or, with an empty value, removes) one key. */
export async function setUserSearchKey(userId, keyId, value) {
  if (!userId || !keyId || !/^[\w-]{1,40}$/.test(keyId)) throw Object.assign(new Error("bad key id"), { status: 400 });
  const v = String(value ?? "").trim();
  if (!v) {
    await User.updateOne({ _id: userId }, { $unset: { [`meta.searchKeys.${keyId}`]: "" } });
    return;
  }
  if (!isSecretsKeyConfigured()) throw Object.assign(new Error("SECRETS_KEY is not set on the server, so keys cannot be stored"), { status: 503 });
  await User.updateOne({ _id: userId }, { $set: { [`meta.searchKeys.${keyId}`]: encryptValue(v) } });
}
