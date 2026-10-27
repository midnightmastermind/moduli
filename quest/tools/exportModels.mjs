// quest/tools/exportModels.mjs — writes the office furniture (client/src/vr/decorMakers.js)
// as .glb files into the Quest app's assets, so both offices hold the same pieces.
//   node quest/tools/exportModels.mjs
// Since 2026-10-27 most furniture and the shelf books are realistic models from quest/tools/realFurniture.mjs:
// running this again overwrites them with the blocky ones, so run realFurniture.mjs after it.
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

// The shelf spine colours (quest PanelHtml SPINE_COLORS): a held book / record / tape takes its spine's colour.
const SPINES = ["#7a2e2e", "#2e4a7a", "#3f6b34", "#7a5a2e", "#4a2e7a", "#2e6b6b", "#8a6a3a", "#5a3a2a"];

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
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 16), mat);
    bar.rotation.z = Math.PI / 2; g.add(bar);
    for (const x of [-0.18, 0.18]) { const end = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), mat); end.position.x = x; g.add(end); }
    // An invisible, much bigger grab zone around the bar (44 x 14 x 14 cm): the 6cm bar alone was hard to hit with
    // a controller ray. Fully transparent, so it is only felt. It stops short of the ⚙ at x = 0.235.
    const zone = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.14),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    g.add(zone);
    return g;
  },
  // A shelf's books (OfficeActivity shelf books): an invisible 1m block laid in front of each spine to grab, and the
  // solid book it turns into in your hand — one per spine colour (PanelHtml SPINE_COLORS). Unit size; the app scales
  // each to its slot.
  bookproxy: () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })));
    return g;
  },
  ...Object.fromEntries(SPINES.map((c, i) => [`book-${i}`, () => {
    const g = new THREE.Group();
    const cover = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
    const pages = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.9 });
    const part = (geo, mat, x, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, 0, z); return m; };
    // Covers: front, back, spine. Pages fill the rest, set back a little from the fore-edge.
    g.add(part(new THREE.BoxGeometry(1, 1, 0.08), cover, 0, 0.46));
    g.add(part(new THREE.BoxGeometry(1, 1, 0.08), cover, 0, -0.46));
    g.add(part(new THREE.BoxGeometry(0.12, 1, 1), cover, -0.44, 0));
    g.add(part(new THREE.BoxGeometry(0.86, 0.94, 0.84), pages, 0.05, 0));
    return g;
  }])),
  // A record taken from a crate and a tape taken from a VHS shelf, at real size (the app scales them only by the
  // shelf's own scale): a 12" sleeve in the item's colour with the black disc peeking out, and a black cassette with
  // a coloured label and two reel windows. Front faces +z.
  ...Object.fromEntries(SPINES.map((c, i) => [`record-${i}`, () => {
    const g = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.315, 0.315, 0.006), new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
    g.add(sleeve);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.003, 48), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.35 }));
    disc.rotation.x = Math.PI / 2; disc.position.set(0.07, 0, 0.0045); g.add(disc);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.0032, 32), new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 0.7 }));
    label.rotation.x = Math.PI / 2; label.position.set(0.07, 0, 0.0047); g.add(label);
    return g;
  }])),
  ...Object.fromEntries(SPINES.map((c, i) => [`vhs-${i}`, () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.187, 0.102, 0.025), new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 })));
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.002), new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
    label.position.set(0, 0.028, 0.0132); g.add(label);
    for (const x of [-0.045, 0.045]) {
      const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.002, 24), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 }));
      reel.rotation.x = Math.PI / 2; reel.position.set(x, -0.015, 0.0132); g.add(reel);
    }
    return g;
  }])),
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
    // The lowest visible point: the TV (no stand) starts 1.02m up, so "not below the floor" must use this.
    bottom: +box.min.y.toFixed(3),
    hx: +((box.max.x - box.min.x) / 2).toFixed(3),
    hz: +((box.max.z - box.min.z) / 2).toFixed(3),
  };
  const glb = await exporter.parseAsync(scene, { binary: true, onlyVisible: true });
  writeFileSync(resolve(out, name + ".glb"), Buffer.from(glb));
  // A see-through copy, shown while you sit in the piece so your own legs show through it.
  if (name !== "handle" && !/^(book|record-|vhs-)/.test(name)) {
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
