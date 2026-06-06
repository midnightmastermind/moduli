// utils/assistantToken.js
//
// Keeps the Jonah assistant's API token STABLE across re-seeds so the user
// pastes it into the drawer once and never again.
//
// Re-seeding (dropExistingLiveGrid) deletes grid-scoped data but NOT ApiToken /
// User / Grid — so a token already survives a reseed. The friction was that a
// freshly *minted* token (createApiToken.js) has a new random value each time.
// This helper makes the value deterministic: it lives in server/.env as
// ASSISTANT_API_TOKEN, and every seed re-asserts the matching DB row.
//
// First seed with no token set: mint one, append it to server/.env, print it.
// Every later seed: read it from env, upsert the DB row, print it. The raw value
// never changes → no re-entry.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ApiToken from "../models/ApiToken.js";

const ENV_KEY = "ASSISTANT_API_TOKEN";
// server/.env — the file both the server (dotenv/config) and the seed
// (node --env-file=.env, run from server/) load. Resolved from this module's
// location so it's correct regardless of cwd.
const SERVER_ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");

const ENV_COMMENT = "# Stable token for the Jonah assistant drawer — paste once into the drawer; survives reseeds.";

// Upsert ASSISTANT_API_TOKEN into the .env file: replace the existing line in
// place (no duplicate keys — a duplicate later in the file would otherwise
// shadow the intended value), or append it (with the comment) when absent.
// Returns "replaced" | "appended" | "created". Exported so any token-minting
// path (createApiToken.js) can make ITS token the stable, re-asserted one.
export function writeAssistantTokenToEnv(rawToken, { envPath = SERVER_ENV_PATH } = {}) {
  const line = `${ENV_KEY}=${rawToken}`;
  let body = "";
  try { body = fs.readFileSync(envPath, "utf8"); } catch { body = ""; }
  if (!body) {
    fs.writeFileSync(envPath, `${ENV_COMMENT}\n${line}\n`);
    return "created";
  }
  const re = new RegExp(`^${ENV_KEY}=.*$`, "m");
  if (re.test(body)) {
    fs.writeFileSync(envPath, body.replace(re, line));
    return "replaced";
  }
  const sep = body.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(envPath, `${sep}\n${ENV_COMMENT}\n${line}\n`);
  return "appended";
}

// Ensure a stable assistant token exists for `userId`. Returns
// { rawToken, source: "env" | "minted" }. Best-effort on the .env write
// (prints regardless so the value is never lost).
export async function ensureAssistantApiToken(userId, { envPath = SERVER_ENV_PATH } = {}) {
  const existing = process.env[ENV_KEY];
  if (existing) {
    await ApiToken.upsertFromRaw({ rawToken: existing, userId, name: "assistant", scopes: ["read", "write"] });
    return { rawToken: existing, source: "env" };
  }
  const { rawToken } = await ApiToken.mint({ userId, name: "assistant", scopes: ["read", "write"] });
  let persisted = false;
  try { writeAssistantTokenToEnv(rawToken, { envPath }); persisted = true; } catch { /* non-fatal */ }
  return { rawToken, source: "minted", persisted, envPath };
}
