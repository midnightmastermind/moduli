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
  // The grab handle the app floats above each piece (GrabHandle.kt): a white bar with rounded ends, 40cm wide.
  handle: () => {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xf2f2f7 });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 16), mat);
    bar.rotation.z = Math.PI / 2; g.add(bar);
    for (const x of [-0.18, 0.18]) { const end = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 12), mat); end.position.x = x; g.add(end); }
    return g;
  },
  ...Object.fromEntries(M.DECOR_KEYS.map((k) => [k, () => M.makeDecor(THREE, k)])),
};

const exporter = new GLTFExporter();
// How tall each piece is, so the app can float its grab handle just above it (OfficeActivity reads office/sizes.json).
const sizes = {};
for (const [name, make] of Object.entries(pieces)) {
  const scene = new THREE.Scene();
  const g = make();
  // Lights stay in the browser; the headset lights the room itself.
  g.traverse((o) => { if (o.isLight) o.visible = false; });
  scene.add(g);
  const box = new THREE.Box3().setFromObject(g);
  // hx / hz: half its footprint, so the app can tell when you are sitting in it (and show the see-through copy).
  sizes[name] = {
    top: +box.max.y.toFixed(3),
    hx: +((box.max.x - box.min.x) / 2).toFixed(3),
    hz: +((box.max.z - box.min.z) / 2).toFixed(3),
  };
  const glb = await exporter.parseAsync(scene, { binary: true, onlyVisible: true });
  writeFileSync(resolve(out, name + ".glb"), Buffer.from(glb));
  // A see-through copy, shown while you sit in the piece so your own legs show through it.
  if (name !== "handle") {
    const ghost = new THREE.Scene();
    const gg = make();
    gg.traverse((o) => {
      if (o.isLight) o.visible = false;
      if (o.material) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.25;
        o.material.depthWrite = false;
      }
    });
    ghost.add(gg);
    const gglb = await exporter.parseAsync(ghost, { binary: true, onlyVisible: true });
    writeFileSync(resolve(out, name + "-ghost.glb"), Buffer.from(gglb));
  }
  console.log(name + ".glb", Buffer.from(glb).length, "bytes");
}
writeFileSync(resolve(out, "sizes.json"), JSON.stringify(sizes, null, 2));
console.log("sizes.json", sizes);
