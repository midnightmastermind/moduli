// server/scripts/exportGridFixture.js
//
// Export a grid as a TEST FIXTURE — "a copy of it", so the behavioural suite can
// drive that grid's OWN operations without a database.
//
// User, 2026-08-19: *"we also need to make sure in our testing, we have testing
// specifically on poms grid (or a copy of it) and making sure those specific
// operations are working still."*
//
// WHY A FIXTURE AND NOT THE LIVE GRID. `liveOpsBehavioral.test.js` already
// drives the real executor — but it boots from `server/seed/*.json`, which is
// what a FRESH grid looks like. poms grid has diverged from the seed by ~120
// migrations; its stored pipelines are not the seed's, so the existing suite
// has never covered a single one of them. A committed snapshot runs in CI, is
// deterministic, and pins the pipelines as they are today.
//
// TEXTMAPS ARE STRIPPED, and that is the difference between a fixture and a
// backup. Operations read fields, labels, parentage and meta; not one action
// reads prose. Keeping them made the file ~20x larger for data no pipeline
// touches. `backupGrid.js` is the tool that keeps everything — this one is
// deliberately lossy, and the header says so in case anyone reaches for it as a
// restore.
//
// IT IS COMMITTED BROTLI'D, and that is not premature tidying. Even with
// textmaps stripped the JSON is ~5.7 MB, which is a file nobody can review in a
// diff and which bloats every clone forever. Brotli takes it to ~0.3 MB — a
// 20x saving on data that is one enormous line either way, so nothing is lost
// to readability that was ever there. The test decompresses it in memory; there
// is no build step and no checked-in derived copy to drift.
//
// Usage:
//   node --env-file=server/.env server/scripts/exportGridFixture.js \
//     --grid "poms grid" [--user josh@jpoms.com] [--out <path>]
import mongoose from "mongoose";
import { writeFileSync, mkdirSync } from "fs";
import { brotliCompressSync, constants as zlibConstants } from "zlib";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import User from "../models/User.js";
import Grid from "../models/Grid.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Field from "../models/Field.js";
import Operation from "../models/Operation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI is not set (run with --env-file=server/.env)");
  await mongoose.connect(uri);

  const email = arg("--user", "josh@jpoms.com");
  const gridName = arg("--grid");
  if (!gridName) throw new Error("--grid <name> is required");

  const user = await User.findOne({ email }).lean();
  if (!user) throw new Error(`no user ${email}`);
  const userId = user._id.toString();
  const grid = await Grid.findOne({ userId, name: gridName }).lean();
  if (!grid) throw new Error(`no grid "${gridName}" for ${email}`);
  const gridId = grid._id.toString();

  const [modules, occurrences, fields, operations] = await Promise.all([
    Module.find({ gridId }).lean(),
    Occurrence.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
    Operation.find({ gridId }).lean(),
  ]);

  // Strip what no pipeline reads. `textmap` is the bulk of the bytes and none of
  // the meaning; `__v` and `_id` are Mongo bookkeeping the executor never sees.
  const slim = (docs) => docs.map(({ textmap, __v, _id, ...rest }) => rest);

  const fixture = {
    _note: "Test fixture — TEXTMAPS STRIPPED. Not a backup; use backupGrid.js for that.",
    _exportedAt: new Date().toISOString(),
    _source: { grid: gridName, user: email },
    grid: { ...grid, _id: gridId, __v: undefined },
    modules: slim(modules),
    occurrences: slim(occurrences),
    fields: slim(fields),
    operations: slim(operations),
  };

  const out = arg("--out", resolve(REPO_ROOT, "client/src/__tests__/fixtures/pomsGrid.json.br"));
  mkdirSync(dirname(out), { recursive: true });
  const json = Buffer.from(JSON.stringify(fixture));
  // Quality 11 is the slow end of brotli and the right end here: this is
  // written once by hand and read on every test run.
  const packed = brotliCompressSync(json, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: json.length,
    },
  });
  writeFileSync(out, packed);
  const enabled = operations.filter(o => o.enabled !== false).length;
  console.log(`✅ ${gridName} → ${out}`);
  console.log(`   ${modules.length} modules · ${occurrences.length} occurrences · ` +
              `${fields.length} fields · ${operations.length} operations (${enabled} enabled)`);
  console.log(`   ${Math.round(json.length / 1024)} KB raw → ${Math.round(packed.length / 1024)} KB brotli ` +
              `(${(json.length / packed.length).toFixed(1)}x)`);
  await mongoose.disconnect();
}
main().catch(e => { console.error("❌", e.message); process.exit(1); });
