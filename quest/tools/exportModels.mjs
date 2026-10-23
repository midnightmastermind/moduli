// quest/tools/exportModels.mjs — writes the office furniture (client/src/vr/decorMakers.js)
// as .glb files into the Quest app's assets, so both offices hold the same pieces.
//   node quest/tools/exportModels.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// GLTFExporter reads its Blob back through FileReader, which Node does not have.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.({ target: this }); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = "data:application/octet-stream;base64," + Buffer.from(b).toString("base64"); this.onloadend?.({ target: this }); }); }
};

const here = dirname(fileURLToPath(import.meta.url));
const client = resolve(here, "../../client");
const THREE = await import(resolve(client, "node_modules/three/build/three.module.js"));
const { GLTFExporter } = await import(resolve(client, "node_modules/three/examples/jsm/exporters/GLTFExporter.js"));
const M = await import(resolve(client, "src/vr/decorMakers.js"));

const out = resolve(here, "../app/src/main/assets/office");
mkdirSync(out, { recursive: true });

const pieces = {
  fireplace: () => M.makeFireplace(THREE),
  "shelf-book": () => M.makeShelfFrame(THREE, "book"),
  "shelf-record": () => M.makeShelfFrame(THREE, "record"),
  "shelf-vhs": () => M.makeShelfFrame(THREE, "vhs"),
  screen: () => M.makeScreenFrame(THREE),
  ...Object.fromEntries(M.DECOR_KEYS.map((k) => [k, () => M.makeDecor(THREE, k)])),
};

const exporter = new GLTFExporter();
for (const [name, make] of Object.entries(pieces)) {
  const scene = new THREE.Scene();
  const g = make();
  // Lights stay in the browser; the headset lights the room itself.
  g.traverse((o) => { if (o.isLight) o.visible = false; });
  scene.add(g);
  const glb = await exporter.parseAsync(scene, { binary: true, onlyVisible: true });
  writeFileSync(resolve(out, name + ".glb"), Buffer.from(glb));
  console.log(name + ".glb", Buffer.from(glb).length, "bytes");
}
