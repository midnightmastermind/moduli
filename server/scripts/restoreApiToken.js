// scripts/restoreApiToken.js
//
// CLI: turn a REVOKED API token back on, keeping the exact same token string —
// so an extension or phone that already holds it needs no change. Run with:
//   node --env-file=.env server/scripts/restoreApiToken.js <moduli_…token>
//
// Revoking only sets `revoked: true`; the hash, user, name and scopes stay on
// the row. This checks the secret against that hash (only the token's holder
// can restore it) and clears the flag. Nothing else about the token changes.

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import ApiToken from "../models/ApiToken.js";

const raw = process.argv.slice(2).find(a => !a.startsWith("--"));
const parts = ApiToken.parse(raw);
if (!parts) {
  console.error("Usage: node server/scripts/restoreApiToken.js <moduli_<id>_<secret>>");
  process.exit(1);
}

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/dnd_containers";

try {
  await mongoose.connect(MONGO_URI);
  const doc = await ApiToken.findOne({ tokenId: parts.tokenId });
  if (!doc) { console.error(`No token ${parts.tokenId}`); process.exit(1); }
  if (!(await bcrypt.compare(parts.secret, doc.hash))) {
    console.error(`Token ${parts.tokenId} exists but that secret does not match it.`);
    process.exit(1);
  }
  if (!doc.revoked) { console.log(`Token ${parts.tokenId} is already active.`); process.exit(0); }
  await ApiToken.updateOne({ tokenId: parts.tokenId }, { $set: { revoked: false } });
  console.log(`Restored ${parts.tokenId} (${doc.name || "unnamed"}, scopes ${(doc.scopes || []).join(",")}).`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
} finally {
  await mongoose.disconnect().catch(() => {});
}
