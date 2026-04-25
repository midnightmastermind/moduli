// scripts/migrateArtifactRole.js
// Migrate role:"instance" + kind:"artifact" modules to role:"artifact" with kind
// derived from meta.artifactType (or fileRef extension as fallback).
// Run once after deploying the artifact-as-role refactor:
//   node --env-file=.env scripts/migrateArtifactRole.js

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "../.env") });

import Module from "../models/Module.js";

const CODE_EXTS = new Set(["js","jsx","ts","tsx","py","sh","bash","json","yaml","yml","toml","css","html","xml","sql","go","rs","c","cpp","h","rb","php","swift","kt"]);

function inferKindFromFileRef(fileRef = "") {
  const ext = (fileRef.split(".").pop() || "").toLowerCase();
  if (["jpg","jpeg","png","gif","webp","svg","avif"].includes(ext)) return "image";
  if (["mp4","webm","mov"].includes(ext)) return "video";
  if (["mp3","wav","ogg","m4a"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (CODE_EXTS.has(ext)) return "code";
  return "markdown";
}

async function main() {
  const url = process.env.MONGO_URI || process.env.MONGO_URL || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/moduli";
  await mongoose.connect(url);

  const targets = await Module.find({ role: "instance", kind: "artifact" });
  console.log(`Found ${targets.length} legacy artifact modules to migrate`);

  for (const m of targets) {
    const kind = m.meta?.artifactType || inferKindFromFileRef(m.fileRef);
    const nextMeta = { ...(m.meta || {}) };
    delete nextMeta.artifactType;
    delete nextMeta.viewType;
    m.role = "artifact";
    m.kind = kind;
    m.meta = nextMeta;
    await m.save();
    console.log(`  ${m.id} → role=artifact, kind=${kind} (${m.label || m.fileRef})`);
  }

  await mongoose.disconnect();
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); });
