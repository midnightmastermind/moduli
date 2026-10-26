// server/generated/officeCore.mjs is the server's copy of the office logic (vr/officeCore.js, bundled). A change to
// the shelf code without `npm run build:office-core` would leave the server answering the headset with the old logic.
import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

it("the server's office bundle is built from the current source", async () => {
  const root = path.resolve(__dirname, "../..");
  const out = await build({
    entryPoints: [path.join(root, "src/vr/officeCore.js")], bundle: true, platform: "node", format: "esm",
    write: false, logLevel: "silent", absWorkingDir: root, outfile: path.join(root, "../server/generated/officeCore.mjs"),
  });
  const committed = fs.readFileSync(path.join(root, "../server/generated/officeCore.mjs"), "utf8");
  expect(out.outputFiles[0].text === committed, "run `npm run build:office-core` in client/").toBe(true);
}, 30000);
