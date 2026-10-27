// quest/tools/realFurniture.mjs — replaces the office's blocky furniture (exportModels.mjs) with realistic models.
//   cd quest/tools && npm install && node realFurniture.mjs <sources dir>
//
// User, 2026-10-27: the pieces "feel roblocks-y and like plain and blocky". Each piece below is a free model (sources
// and licences in assets/office/CREDITS.md), turned to face +Z (a piece's front), scaled to a real size, stood on the
// floor and centred, its textures capped for the headset's memory (the app was killed for memory on 2026-10-26).
// Material effects the headset may not draw (velvet sheen, glass transmission, variants) and lights are dropped.
// Writes <piece>.glb, its see-through <piece>-ghost.glb (shown while you sit in it), and its entry in sizes.json.
//
// The shelf books are one realistic book stood up and stretched to the unit box the app scales into each slot
// (spine at -X, covers at ±Z), its cover tinted with each spine colour.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { flatten, clearNodeTransform, getBounds, prune, dedup, textureCompress, transformMesh, cloneDocument, weld, simplify } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../app/src/main/assets/office");
const SRC = process.argv[2] || "/tmp/claude-1000/src";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// What each piece is made from. size: scale so that dimension (x = width, y = height, z = depth) is that many
// metres; omitted = the model is already at real size. yaw / pitch in degrees, applied first.
const PIECES = {
  couch:        { file: "kh_GlamVelvetSofa.glb" },
  armchair:     { file: "kh_SheenChair.glb" },
  ottoman:      { file: "kh_SpecularSilkPouf.glb", size: { y: 0.32 } },
  desklamp:     { file: "kh_IridescenceLamp.glb" },
  plant:        { file: "kh_DiffuseTransmissionPlant.glb" },
  swivelchair:  { file: "ph_mid_century_lounge_chair/mid_century_lounge_chair.gltf" },
  smalltable:   { file: "ph_side_table_01/side_table_01.gltf" },
  desk:         { file: "ph_metal_office_desk/metal_office_desk.gltf" },
  recordplayer: { file: "recordplayer.glb", size: { x: 0.45 } },
  vhsplayer:    { file: "vhsplayer.glb", yaw: Number(process.env.VCR_YAW ?? 13.75), size: { x: 0.43 } },
  bed:          { file: "bed.glb" },
  lamp:         { file: "lamp.glb", size: { y: 1.55 } },
  longtable:    { file: "longtable.glb", yaw: 90, size: { y: 0.75 } },
};
const SPINES = ["#7a2e2e", "#2e4a7a", "#3f6b34", "#7a5a2e", "#4a2e7a", "#2e6b6b", "#8a6a3a", "#5a3a2a"];
const DROP_EXT = ["KHR_lights_punctual", "KHR_materials_sheen", "KHR_materials_specular", "KHR_materials_variants",
  "KHR_materials_iridescence", "KHR_materials_transmission", "KHR_materials_volume", "KHR_materials_ior",
  "KHR_materials_diffuse_transmission", "KHR_materials_clearcoat"];

const rotY = (deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const rotX = (deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
const scaleTranslate = (sx, sy, sz, tx, ty, tz) => [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, tx, ty, tz, 1];

/** Every mesh baked into one frame: no node transforms left, so the geometry can be moved by matrix. */
async function bake(doc) {
  for (const name of DROP_EXT) doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === name)?.dispose();
  await doc.transform(flatten());
  for (const n of doc.getRoot().listNodes()) clearNodeTransform(n);
}
function applyAll(doc, m) { for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, m); }
const scene = (doc) => doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];

/** Triangles in the document. */
const triangles = (doc) => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((a, p) => a + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3, 0), 0);

/** A model over MAX_TRIS is simplified toward it: many pieces can be in the room at once. */
const MAX_TRIS = 20000;
async function lighten(doc) {
  const n = triangles(doc);
  if (n <= 30000) return;
  await MeshoptSimplifier.ready;
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: MAX_TRIS / n, error: 0.002 }));
}

async function shrinkTextures(doc) {
  await doc.transform(
    textureCompress({ encoder: sharp, resize: [1024, 1024], slots: /^baseColor/ }),
    textureCompress({ encoder: sharp, resize: [512, 512], slots: /^(?!baseColor)/ }),
    dedup(), prune(),
  );
}

async function ghostOf(doc) {
  const g = cloneDocument(doc);
  for (const m of g.getRoot().listMaterials()) {
    const c = m.getBaseColorFactor(); m.setBaseColorFactor([c[0], c[1], c[2], 0.25]);
    m.setAlphaMode("BLEND"); m.setDoubleSided(true);
  }
  return g;
}

const sizesPath = resolve(OUT, "sizes.json");
const sizes = existsSync(sizesPath) ? JSON.parse(readFileSync(sizesPath, "utf8")) : {};
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;

for (const [name, p] of Object.entries(PIECES)) {
  if (only && !only.includes(name)) continue;
  const doc = await io.read(resolve(SRC, p.file));
  await bake(doc);
  if (p.yaw) applyAll(doc, rotY(p.yaw));
  if (p.pitch) applyAll(doc, rotX(p.pitch));
  let b = getBounds(scene(doc));
  const dim = { x: b.max[0] - b.min[0], y: b.max[1] - b.min[1], z: b.max[2] - b.min[2] };
  const [axis, metres] = p.size ? Object.entries(p.size)[0] : ["y", dim.y];
  const s = metres / dim[axis];
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  applyAll(doc, scaleTranslate(s, s, s, -cx * s, -b.min[1] * s, -cz * s));
  await lighten(doc);
  await shrinkTextures(doc);
  b = getBounds(scene(doc));
  sizes[name] = { top: +b.max[1].toFixed(3), bottom: +b.min[1].toFixed(3), hx: +((b.max[0] - b.min[0]) / 2).toFixed(3), hz: +((b.max[2] - b.min[2]) / 2).toFixed(3) };
  await io.write(resolve(OUT, `${name}.glb`), doc);
  await io.write(resolve(OUT, `${name}-ghost.glb`), await ghostOf(doc));
  console.log(name, sizes[name], Math.round(triangles(doc)), "triangles");
}

// Books: stood up (its length becomes the height), stretched to the 1 x 1 x 1 box centred on the origin.
if (!only || only.includes("book")) {
  for (let i = 0; i < SPINES.length; i++) {
    const doc = await io.read(resolve(SRC, "book.glb"));
    await bake(doc);
    applyAll(doc, rotX(90));
    const b = getBounds(scene(doc));
    const d = [0, 1, 2].map((k) => b.max[k] - b.min[k]);
    const c = [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2);
    applyAll(doc, scaleTranslate(1 / d[0], 1 / d[1], 1 / d[2], -c[0] / d[0], -c[1] / d[1], -c[2] / d[2]));
    const hex = SPINES[i];
    const rgb = [1, 3, 5].map((k) => Math.pow(parseInt(hex.slice(k, k + 2), 16) / 255, 2.2));
    for (const m of doc.getRoot().listMaterials()) if (!/page/i.test(m.getName())) m.setBaseColorFactor([...rgb, 1]).setRoughnessFactor(0.75).setMetallicFactor(0);
    await doc.transform(dedup(), prune());
    await io.write(resolve(OUT, `book-${i}.glb`), doc);
  }
  console.log("book-0..7");
}

writeFileSync(sizesPath, JSON.stringify(sizes, null, 2));
