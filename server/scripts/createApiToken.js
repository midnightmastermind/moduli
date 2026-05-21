// scripts/createApiToken.js
//
// CLI: mint an API token for a user. Run with:
//   node --env-file=.env server/scripts/createApiToken.js <email> [scopes] [name]
//
// scopes defaults to "read,write". name defaults to the current date.
// The raw token is printed exactly once — copy it immediately.

import mongoose from "mongoose";
import User from "../models/User.js";
import ApiToken from "../models/ApiToken.js";

const [, , email, scopesArg, ...nameParts] = process.argv;

if (!email) {
  console.error("Usage: node server/scripts/createApiToken.js <email> [scopes] [name]");
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
  await mongoose.disconnect();
} catch (err) {
  console.error("Error:", err);
  await mongoose.disconnect();
  process.exit(1);
}
