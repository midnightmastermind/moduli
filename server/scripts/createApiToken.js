// scripts/createApiToken.js
//
// CLI: mint an API token for a user. Run with:
//   node --env-file=.env server/scripts/createApiToken.js <email> [scopes] [name]
//
// scopes defaults to "read,write". name defaults to the current date.
// The raw token is printed exactly once — copy it immediately.
//
// By DEFAULT the minted token is also written into server/.env as
// ASSISTANT_API_TOKEN, so it becomes the stable token createLiveData re-asserts
// on every reseed (paste it into the drawer once, never again). Pass --no-env
// to skip that and just mint.

import mongoose from "mongoose";
import User from "../models/User.js";
import ApiToken from "../models/ApiToken.js";
import { writeAssistantTokenToEnv } from "../utils/assistantToken.js";

const rawArgs = process.argv.slice(2);
const writeEnv = !rawArgs.includes("--no-env");
const [email, scopesArg, ...nameParts] = rawArgs.filter(a => !a.startsWith("--"));

if (!email) {
  console.error("Usage: node server/scripts/createApiToken.js <email> [scopes] [name] [--no-env]");
  console.error('Example: node server/scripts/createApiToken.js jtpomerenke@gmail.com "read,write" "demo token"');
  process.exit(1);
}

const scopes = (scopesArg || "read,write").split(",").map(s => s.trim()).filter(Boolean);
const name = nameParts.join(" ") || `cli token ${new Date().toISOString().slice(0, 10)}`;

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/dnd_containers";

try {
  await mongoose.connect(MONGO_URI);
  const user = await User.findOne({ email });
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }
  const { rawToken, tokenDoc } = await ApiToken.mint({
    userId: user._id.toString(),
    name,
    scopes,
  });
  console.log("\n✅ API token minted:\n");
  console.log("  Token ID: ", tokenDoc.tokenId);
  console.log("  User:     ", email);
  console.log("  Scopes:   ", tokenDoc.scopes.join(", "));
  console.log("  Name:     ", tokenDoc.name);
  console.log("\n  Raw token (SAVE THIS — it won't be shown again):");
  console.log(`  ${rawToken}\n`);
  if (writeEnv) {
    try {
      const action = writeAssistantTokenToEnv(rawToken);
      console.log(`  🔑 ${action} ASSISTANT_API_TOKEN in server/.env — this token now survives reseeds`);
      console.log("     (createLiveData re-asserts it every run). Paste it into the assistant drawer once.\n");
    } catch (e) {
      console.warn(`  ⚠️  Could not write ASSISTANT_API_TOKEN to server/.env: ${e.message}`);
      console.warn("     Add it manually to keep this token stable across reseeds.\n");
    }
  } else {
    console.log("  (--no-env) Not written to server/.env — this token survives reseeds in the DB,");
    console.log("     but only ASSISTANT_API_TOKEN is re-asserted on each reseed.\n");
  }
  await mongoose.disconnect();
} catch (err) {
  console.error("Error:", err);
  await mongoose.disconnect();
  process.exit(1);
}
