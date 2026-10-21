// Moduli Office — a WebXR prototype (throwaway spike, 2026-10-21).
// Open /vr/ in the Quest 3 browser while signed in to Moduli.
//   Mixed reality: your real room through passthrough; the fireplace goes on
//     the biggest wall the headset found in Space Setup, the bookshelf on the
//     next one, a lamp on any table it found.
//   VR: the same office inside a cozy room shell.
// Point and pinch (or trigger) to use things:
//   a book      -> it opens as a reading panel (◀ ▶ to turn pages, ✕ to close)
//   the palette -> pick an object, then point at the floor / a table and pinch
//   a placed object (or the fireplace / shelf) -> pick it up and place it again
// The layout is kept in this browser (localStorage), not in Moduli yet.
import * as THREE from "three";

const $ = (id) => document.getElementById(id);
const status = (t) => { $("status").textContent = t; };
const LAYOUT_KEY = "moduli-vr-layout";

// ── Moduli ────────────────────────────────────────────────────────────────
const token = localStorage.getItem("moduli-token");
const gridId = localStorage.getItem("moduli-gridId");
async function api(path) {
  const r = await fetch("/api/v1" + path + (path.includes("?") ? "&" : "?") + "gridId=" + encodeURIComponent(gridId), {
    headers: { Authorization: "Bearer " + token },
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || r.status);
  return r.json();
}
const SAMPLE_BOOKS = ["Notes", "Fitness Plan", "Philosopher's Stone", "Gospel of Thomas", "Tasks", "Reading List", "Recipes", "Journal"]
  .map((title, i) => ({ id: "sample-" + i, title, sample: true }));
async function loadBooks() {
  if (!token || !gridId) { status("Not signed in — showing sample books. Open Moduli, sign in, then come back."); return SAMPLE_BOOKS; }
  try {
    const { books, total } = await api("/vr/shelf");
    status(total + " pages on your shelf" + (total > books.length ? " (newest " + books.length + ")" : ""));
    return books;
  } catch (e) {
    status("Could not read your pages (" + e.message + ") — showing sample books.");
    return SAMPLE_BOOKS;
  }
}
async function loadPage(book) {
  if (book.sample) return { title: book.title, blocks: [{ type: "text", text: "This is a sample book. Sign in to Moduli to see your own pages here." }] };
  return api("/vr/page/" + encodeURIComponent(book.id));
}

// ── Scene ─────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 50);
camera.position.set(0, 1.6, 2.6);
camera.lookAt(0, 1.0, 0);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0xffe2c0, 0x2a1c12, 1.1));
const office = new THREE.Group();   // everything we place
scene.add(office);
const interactive = [];             // meshes a ray can hit, each with userData.onSelect
const surfaces = [];                // meshes objects can be placed on

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}

// Cozy room shell, shown only in VR and on a desktop (passthrough is the room in MR).
const shell = new THREE.Group();
{
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), mat(0x5a3b25));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  shell.add(floor);
  const wallMat = mat(0x6b4e3d);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), wallMat); back.position.set(0, 1.5, -2); shell.add(back);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), wallMat); left.position.set(-3, 1.5, 0); left.rotation.y = Math.PI / 2; shell.add(left);
  const right = left.clone(); right.position.x = 3; right.rotation.y = -Math.PI / 2; shell.add(right);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), mat(0x3a2a20)); ceiling.position.y = 3; ceiling.rotation.x = Math.PI / 2; shell.add(ceiling);
  const front = back.clone(); front.position.z = 4; front.rotation.y = Math.PI; shell.add(front);
  scene.add(shell);
}
// The floor is always a placement surface (y = 0 in local-floor space).
const floorSurface = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ visible: false }));
floorSurface.rotation.x = -Math.PI / 2;
scene.add(floorSurface); surfaces.push(floorSurface);

// ── Fireplace ─────────────────────────────────────────────────────────────
const flames = [];
let fireLight;
function makeFireplace() {
  const g = new THREE.Group();
  g.add(box(1.5, 1.1, 0.4, 0x8a8077, 0, 0.55, 0));            // stone surround
  g.add(box(1.7, 0.08, 0.5, 0x5b3a22, 0, 1.14, 0.03));          // mantel
  g.add(box(0.9, 0.7, 0.3, 0x1a1410, 0, 0.42, 0.08));           // firebox
  g.add(box(0.6, 0.06, 0.12, 0x4a2c18, -0.05, 0.12, 0.18));     // logs
  g.add(box(0.5, 0.06, 0.12, 0x3f2614, 0.1, 0.17, 0.16));
  const flameMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  [[0xff6a1a, 0.13, 0.4], [0xffa43a, 0.1, 0.3], [0xffd36b, 0.06, 0.2]].forEach(([c, r, h], i) => {
    for (let k = -1; k <= 1; k++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(r, h, 10), flameMat(c));
      f.position.set(k * 0.16, 0.2 + h / 2, 0.2 + i * 0.01);
      f.userData.phase = Math.random() * 10; f.userData.h = h;
      g.add(f); flames.push(f);
    }
  });
  fireLight = new THREE.PointLight(0xff8a3d, 6, 6, 1.4);
  fireLight.position.set(0, 0.45, 0.45); fireLight.castShadow = true;
  g.add(fireLight);
  // a framed picture above the mantel
  g.add(box(0.6, 0.42, 0.03, 0x3b2a1a, 0, 1.55, 0));
  g.add(box(0.52, 0.34, 0.01, 0x9fb7c9, 0, 1.55, 0.02));
  return g;
}

// ── Bookshelf ─────────────────────────────────────────────────────────────
const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const SPINE_COLORS = [0x7a2e2e, 0x2e4a7a, 0x2e6a4a, 0x6a5a2e, 0x5a2e6a, 0x8a5a2a, 0x3a3a3a, 0x7a6a5a];
function spineTexture(title, color) {
  const c = document.createElement("canvas"); c.width = 64; c.height = 256;
  const x = c.getContext("2d");
  x.fillStyle = "#" + color.toString(16).padStart(6, "0"); x.fillRect(0, 0, 64, 256);
  x.fillStyle = "#e8d9b5"; x.fillRect(0, 18, 64, 3); x.fillRect(0, 235, 64, 3);
  x.save(); x.translate(38, 128); x.rotate(-Math.PI / 2);
  x.font = "bold 20px Georgia"; x.textAlign = "center"; x.fillStyle = "#f4e9d8";
  x.fillText(title.length > 18 ? title.slice(0, 17) + "…" : title, 0, 0);
  x.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function makeBookshelf(books) {
  const g = new THREE.Group();
  const W = 1.0, H = 1.8, D = 0.3, wood = 0x4e3220;
  g.add(box(W, H, 0.02, wood, 0, H / 2, -D / 2 + 0.01));
  g.add(box(0.03, H, D, wood, -W / 2, H / 2, 0));
  g.add(box(0.03, H, D, wood, W / 2, H / 2, 0));
  const shelves = 5;
  for (let i = 0; i <= shelves; i++) g.add(box(W, 0.025, D, wood, 0, 0.02 + i * (H - 0.04) / shelves, 0));
  let shelf = 0, x = -W / 2 + 0.04;
  for (const book of books) {
    const h = 0.24 + (hash(book.title) % 6) / 100, t = 0.035 + (hash(book.title + "w") % 3) / 100;
    if (x + t > W / 2 - 0.03) { shelf++; x = -W / 2 + 0.04; }
    if (shelf >= shelves) break;
    const color = SPINE_COLORS[hash(book.title) % SPINE_COLORS.length];
    const spine = new THREE.MeshStandardMaterial({ map: spineTexture(book.title, color), roughness: 0.7 });
    const plain = mat(color), pages = mat(0xe9dfc8);
    // BoxGeometry faces: +x, -x, +y, -y, +z (front = spine), -z
    const m = new THREE.Mesh(new THREE.BoxGeometry(t, h, D * 0.8), [plain, plain, pages, pages, spine, plain]);
    m.position.set(x + t / 2, 0.035 + shelf * (H - 0.04) / shelves + h / 2, 0.01);
    m.castShadow = true;
    m.userData.onSelect = () => openBook(book, m);
    m.userData.hoverable = true;
    g.add(m); interactive.push(m);
    x += t + 0.004;
  }
  return g;
}

// ── Reading panel ─────────────────────────────────────────────────────────
const PANEL_W = 0.62, PANEL_H = 0.78, PX_W = 1024, PX_H = 1288;
const panelCanvas = document.createElement("canvas"); panelCanvas.width = PX_W; panelCanvas.height = PX_H;
const panelTex = new THREE.CanvasTexture(panelCanvas); panelTex.colorSpace = THREE.SRGBColorSpace;
const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), new THREE.MeshBasicMaterial({ map: panelTex, transparent: true }));
panel.visible = false; scene.add(panel);
let reading = null; // { page, pages: [[lines]], index, book }

function layoutPages(page) {
  const x = panelCanvas.getContext("2d");
  const pages = [[]]; let y = 0; const top = 150, bottom = PX_H - 110, maxW = PX_W - 140;
  const add = (line) => { if (top + y + line.size * 1.45 > bottom) { pages.push([]); y = 0; } pages[pages.length - 1].push({ ...line, y }); y += line.size * 1.45; };
  for (const b of page.blocks) {
    const size = b.type === "heading" ? (b.level === 1 ? 46 : b.level === 2 ? 38 : 33) : 30;
    const font = (b.type === "heading" ? "bold " : "") + size + "px Georgia";
    x.font = font;
    const words = ((b.type === "item" ? "• " : "") + b.text).split(/\s+/);
    let cur = "";
    if (b.type === "heading" && y > 0) y += 12;
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (x.measureText(test).width > maxW && cur) { add({ text: cur, font, size }); cur = w; } else cur = test;
    }
    if (cur) add({ text: cur, font, size });
    y += 10;
  }
  if (page.truncated) add({ text: "(this page goes on — open it in Moduli for the rest)", font: "italic 26px Georgia", size: 26 });
  return pages;
}
function drawPanel() {
  const x = panelCanvas.getContext("2d");
  x.clearRect(0, 0, PX_W, PX_H);
  x.fillStyle = "#f3ead7"; roundRect(x, 0, 0, PX_W, PX_H, 40); x.fill();
  x.fillStyle = "#3a2a1c"; x.font = "bold 44px Georgia"; x.textAlign = "left";
  const title = reading?.page?.title || "";
  x.fillText(title.length > 34 ? title.slice(0, 33) + "…" : title, 70, 90);
  x.fillStyle = "#c9b48f"; x.fillRect(70, 112, PX_W - 140, 3);
  if (reading?.loading) { x.font = "32px Georgia"; x.fillText("Opening…", 70, 200); }
  for (const l of reading?.pages?.[reading.index] || []) { x.font = l.font; x.fillStyle = "#2b2016"; x.fillText(l.text, 70, 150 + l.y + l.size); }
  // footer controls: ◀  page n / N  ▶   and ✕ top-right
  x.font = "bold 54px system-ui"; x.fillStyle = "#8a5a2a"; x.textAlign = "center";
  x.fillText("◀", 110, PX_H - 40); x.fillText("▶", PX_W - 110, PX_H - 40); x.fillText("✕", PX_W - 70, 92);
  x.font = "28px Georgia"; x.fillStyle = "#6b5a44";
  if (reading?.pages) x.fillText((reading.index + 1) + " / " + reading.pages.length, PX_W / 2, PX_H - 50);
  panelTex.needsUpdate = true;
}
function roundRect(x, l, t, w, h, r) { x.beginPath(); x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r); x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath(); }
panel.userData.onSelect = (hit) => {
  const u = hit.uv.x, v = hit.uv.y;
  if (u > 0.86 && v > 0.88) return closeBook();
  if (!reading?.pages) return;
  if (v < 0.12 && u < 0.3) reading.index = Math.max(0, reading.index - 1);
  else if (v < 0.12 && u > 0.7) reading.index = Math.min(reading.pages.length - 1, reading.index + 1);
  else if (u > 0.5) reading.index = Math.min(reading.pages.length - 1, reading.index + 1);
  else reading.index = Math.max(0, reading.index - 1);
  drawPanel();
};
interactive.push(panel);

function headPose() {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const pos = new THREE.Vector3(); cam.getWorldPosition(pos);
  const dir = new THREE.Vector3(); cam.getWorldDirection(dir); dir.y = 0; dir.normalize();
  return { pos, dir };
}
function placeInFront(obj, dist, height) {
  const { pos, dir } = headPose();
  obj.position.copy(pos).addScaledVector(dir, dist); obj.position.y = height ?? pos.y - 0.1;
  obj.lookAt(pos.x, obj.position.y, pos.z);
}
async function openBook(book, mesh) {
  if (mesh) { mesh.position.z += 0.06; setTimeout(() => (mesh.position.z -= 0.06), 900); }
  reading = { book, loading: true, page: { title: book.title } };
  placeInFront(panel, 0.75);
  panel.visible = true; drawPanel();
  try {
    const page = await loadPage(book);
    reading = { book, page, pages: layoutPages(page), index: 0 };
  } catch (e) {
    reading = { book, page: { title: book.title }, pages: [[{ text: "Could not open: " + e.message, font: "30px Georgia", size: 30, y: 0 }]], index: 0 };
  }
  drawPanel();
}
function closeBook() { panel.visible = false; reading = null; }

// ── Objects you can place ─────────────────────────────────────────────────
const MAKERS = {
  armchair() {
    const g = new THREE.Group(), c = 0x7a3b2e;
    g.add(box(0.8, 0.42, 0.8, c, 0, 0.21, 0)); g.add(box(0.8, 0.5, 0.18, c, 0, 0.67, -0.31));
    g.add(box(0.14, 0.25, 0.8, c, -0.33, 0.54, 0)); g.add(box(0.14, 0.25, 0.8, c, 0.33, 0.54, 0));
    return g;
  },
  lamp() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.4), mat(0x2b2b2b)); pole.position.y = 0.7; g.add(pole);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.03), mat(0x2b2b2b)); base.position.y = 0.015; g.add(base);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.25, 20, 1, true), mat(0xf2e0b8, { emissive: 0xffcf8a, emissiveIntensity: 0.6, side: THREE.DoubleSide }));
    shade.position.y = 1.45; g.add(shade);
    const l = new THREE.PointLight(0xffd29a, 2.5, 4, 1.5); l.position.y = 1.4; g.add(l);
    return g;
  },
  desklamp() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.02), mat(0x2b2b2b)); base.position.y = 0.01; g.add(base);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.3), mat(0x2b2b2b)); stem.position.y = 0.16; g.add(stem);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.12, 16, 1, true), mat(0x1f4f3a, { emissive: 0xffcf8a, emissiveIntensity: 0.3, side: THREE.DoubleSide }));
    shade.position.y = 0.33; g.add(shade);
    const l = new THREE.PointLight(0xffd29a, 1.2, 2, 1.5); l.position.y = 0.28; g.add(l);
    return g;
  },
  plant() {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.26, 16), mat(0x9a5a3a)); pot.position.y = 0.13; g.add(pot);
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(0x3f6b34));
      leaf.position.set(Math.sin(i) * 0.1, 0.38 + (i % 3) * 0.1, Math.cos(i * 1.7) * 0.1); g.add(leaf);
    }
    return g;
  },
  rug() {
    const g = new THREE.Group();
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.01, 40), mat(0x8a3a32)); r.scale.z = 0.65; r.position.y = 0.005; g.add(r);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.012, 40), mat(0xc49a5a)); inner.scale.z = 0.65; inner.position.y = 0.006; g.add(inner);
    return g;
  },
  candle() {
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 12), mat(0xf4ecd8)); c.position.y = 0.06; g.add(c);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.035, 8), new THREE.MeshBasicMaterial({ color: 0xffc35a })); f.position.y = 0.14; g.add(f); flames.push(f); f.userData.phase = Math.random() * 10; f.userData.h = 0.035;
    const l = new THREE.PointLight(0xffb45a, 0.6, 1.5, 1.6); l.position.y = 0.16; g.add(l);
    return g;
  },
};
const LABELS = { armchair: "Armchair", lamp: "Floor lamp", desklamp: "Desk lamp", plant: "Plant", rug: "Rug", candle: "Candle" };

const placed = []; // { type, obj }
let holding = null; // { obj, type, fixed } while choosing where it goes
function spawn(type) {
  const obj = type === "fireplace" ? fireplace : type === "bookshelf" ? bookshelf : MAKERS[type]();
  obj.userData.type = type;
  if (!office.children.includes(obj)) office.add(obj);
  // every mesh in it picks the whole object up again
  obj.traverse((m) => { if (m.isMesh && !m.userData.onSelect) { m.userData.onSelect = () => pickUp(obj); interactive.push(m); } });
  return obj;
}
function pickUp(obj) { if (holding) return; closeBook(); holding = { obj, type: obj.userData.type }; status("Point where it should go and pinch"); }
function choose(type) { closeBook(); if (holding) return; const obj = spawn(type); placed.push({ type, obj }); holding = { obj, type }; status("Point at the floor or a table and pinch to place the " + LABELS[type].toLowerCase()); }
function drop(point, faceUser) {
  const { obj } = holding; holding = null;
  obj.position.copy(point);
  const { pos } = headPose();
  if (faceUser) obj.lookAt(pos.x, obj.position.y, pos.z);
  saveLayout(); status("Placed. Point at it and pinch to move it again.");
}

// The palette: a small board of object buttons near your left hand.
const palCanvas = document.createElement("canvas"); palCanvas.width = 512; palCanvas.height = 384;
const palTex = new THREE.CanvasTexture(palCanvas); palTex.colorSpace = THREE.SRGBColorSpace;
const palette = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.27), new THREE.MeshBasicMaterial({ map: palTex, transparent: true }));
const PAL = Object.keys(LABELS);
{
  const x = palCanvas.getContext("2d");
  x.fillStyle = "rgba(30,22,16,0.9)"; roundRect(x, 0, 0, 512, 384, 30); x.fill();
  x.fillStyle = "#f4e9d8"; x.font = "bold 34px system-ui"; x.textAlign = "center"; x.fillText("Place an object", 256, 52);
  PAL.forEach((k, i) => {
    const cx = 30 + (i % 2) * 236, cy = 80 + Math.floor(i / 2) * 96;
    x.fillStyle = "#4a3424"; roundRect(x, cx, cy, 216, 80, 16); x.fill();
    x.fillStyle = "#f4e9d8"; x.font = "28px system-ui"; x.fillText(LABELS[k], cx + 108, cy + 50);
  });
  palTex.needsUpdate = true;
}
palette.userData.onSelect = (hit) => {
  const px = hit.uv.x * 512, py = (1 - hit.uv.y) * 384;
  PAL.forEach((k, i) => {
    const cx = 30 + (i % 2) * 236, cy = 80 + Math.floor(i / 2) * 96;
    if (px >= cx && px <= cx + 216 && py >= cy && py <= cy + 80) choose(k);
  });
};
scene.add(palette); interactive.push(palette);

// ── Layout (kept in this browser) ─────────────────────────────────────────
let fireplace, bookshelf;
function saveLayout() {
  const items = office.children.filter((o) => o.userData.type).map((o) => ({
    type: o.userData.type, p: o.position.toArray().map((n) => +n.toFixed(3)), r: +o.rotation.y.toFixed(3),
  }));
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(items)); } catch (e) { /* private mode */ }
}
function loadLayout() { try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null"); } catch (e) { return null; } }
function applyLayout(items) {
  for (const it of items) {
    const obj = spawn(it.type);
    if (it.type !== "fireplace" && it.type !== "bookshelf") placed.push({ type: it.type, obj });
    obj.position.fromArray(it.p); obj.rotation.set(0, it.r, 0);
  }
}
$("resetLayout").onclick = () => {
  try { localStorage.removeItem(LAYOUT_KEY); } catch (e) { /* ignore */ }
  for (const p of placed) office.remove(p.obj);
  placed.length = 0; defaultLayout(); status("Layout reset");
};
function defaultLayout() {
  fireplace.position.set(0, 0, -1.8); fireplace.rotation.set(0, 0, 0);
  bookshelf.position.set(-2.4, 0, -0.6); bookshelf.rotation.set(0, Math.PI / 2, 0);
  palette.position.set(0.9, 1.1, 1.0); palette.lookAt(0, 1.4, 2.6);
}

// ── Mixed reality: put things on the real walls and tables ───────────────
let roomFitted = false;
function fitToRoom(frame, refSpace) {
  const planes = frame.detectedPlanes;
  if (!planes || planes.size === 0) return false;
  const walls = [], tables = [];
  planes.forEach((plane) => {
    const pose = frame.getPose(plane.planeSpace, refSpace);
    if (!pose) return;
    const poly = plane.polygon || [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const area = (maxX - minX) * (maxZ - minZ);
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    const normal = new THREE.Vector3(0, 1, 0).transformDirection(m); // a plane's y-axis is its normal
    const label = (plane.semanticLabel || "").toLowerCase();
    if (plane.orientation === "vertical" && label !== "door" && label !== "window") walls.push({ pos, normal, area });
    if (label === "table" || label === "desk") tables.push({ pos, area });
    // an invisible surface so objects can be placed on it
    if (plane.orientation === "horizontal" && poly.length > 2) {
      const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, -p.z)));
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
      mesh.applyMatrix4(m); mesh.rotateX(-Math.PI / 2); scene.add(mesh); surfaces.push(mesh);
    }
  });
  if (!walls.length) return false;
  walls.sort((a, b) => b.area - a.area);
  const onWall = (obj, wall, sideways = 0) => {
    const n = wall.normal.clone(); n.y = 0; n.normalize();
    // face into the room: flip the normal if it points away from where you stand
    const { pos } = headPose();
    if (n.dot(new THREE.Vector3(pos.x - wall.pos.x, 0, pos.z - wall.pos.z)) < 0) n.negate();
    const along = new THREE.Vector3(-n.z, 0, n.x);
    obj.position.set(wall.pos.x, 0, wall.pos.z).addScaledVector(n, 0.22).addScaledVector(along, sideways);
    obj.rotation.set(0, Math.atan2(n.x, n.z), 0);
  };
  if (!loadLayout()) {
    onWall(fireplace, walls[0]);
    if (walls[1]) onWall(bookshelf, walls[1]); else onWall(bookshelf, walls[0], 1.4);
    if (tables[0]) { const l = spawn("desklamp"); placed.push({ type: "desklamp", obj: l }); l.position.copy(tables[0].pos); }
    saveLayout();
  }
  status("Fitted to your room: " + walls.length + " walls, " + tables.length + " tables found");
  return true;
}

// ── Pointing: controllers / hands in XR, the mouse on a desktop ──────────
const raycaster = new THREE.Raycaster();
const reticle = new THREE.Mesh(new THREE.RingGeometry(0.04, 0.055, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffb45a }));
reticle.visible = false; scene.add(reticle);
let lastController = null;
const controllers = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xffd29a }));
  line.scale.z = 3; c.add(line);
  c.addEventListener("selectstart", () => { lastController = c; onSelect(rayFrom(c)); });
  scene.add(c);
  return c;
});
function rayFrom(obj) {
  const m = new THREE.Matrix4().extractRotation(obj.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(obj.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(m);
  return raycaster;
}
function onSelect(rc) {
  if (holding) {
    const hits = rc.intersectObjects(surfaces, false);
    if (hits.length) drop(hits[0].point, true);
    return;
  }
  const hits = rc.intersectObjects(interactive, false).filter((h) => h.object.visible && isShown(h.object));
  if (!hits.length) return;
  // A book just behind the shelf's frame still counts, so books near the
  // edge of a shelf can be picked from an angle.
  const book = hits.find((h) => h.object.userData.hoverable && h.distance < hits[0].distance + 0.08);
  (book || hits[0]).object.userData.onSelect?.(book || hits[0]);
}
function isShown(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
const mouse = new THREE.Vector2();
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (renderer.xr.isPresenting) return;
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera); onSelect(raycaster);
});
renderer.domElement.addEventListener("pointermove", (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
});

// ── Sessions ──────────────────────────────────────────────────────────────
async function startSession(mode) {
  const session = await navigator.xr.requestSession(mode, {
    requiredFeatures: ["local-floor"],
    optionalFeatures: mode === "immersive-ar" ? ["plane-detection", "hand-tracking", "anchors"] : ["hand-tracking"],
  });
  shell.visible = mode !== "immersive-ar";
  roomFitted = mode !== "immersive-ar";
  renderer.xr.setReferenceSpaceType("local-floor");
  await renderer.xr.setSession(session);
  session.addEventListener("end", () => { shell.visible = true; });
  // the palette starts by your left side once the headset knows where you are
  setTimeout(() => { placeInFront(palette, 0.6, 1.0); palette.position.x -= 0.35; }, 600);
}
if (navigator.xr) {
  navigator.xr.isSessionSupported("immersive-ar").then((ok) => { $("enterAR").disabled = !ok; });
  navigator.xr.isSessionSupported("immersive-vr").then((ok) => { $("enterVR").disabled = !ok; });
}
$("enterAR").onclick = () => startSession("immersive-ar").catch((e) => status("Mixed reality failed: " + e.message));
$("enterVR").onclick = () => startSession("immersive-vr").catch((e) => status("VR failed: " + e.message));

// ── Loop ──────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
renderer.setAnimationLoop((t, frame) => {
  const time = clock.getElapsedTime();
  for (const f of flames) {
    const s = 0.8 + 0.25 * Math.sin(time * 9 + f.userData.phase) + 0.15 * Math.sin(time * 23 + f.userData.phase * 2);
    if (f.userData.baseY === undefined) f.userData.baseY = f.position.y - f.userData.h / 2;
    f.scale.set(1, s, 1); f.position.y = f.userData.baseY + f.userData.h * s / 2;
  }
  if (fireLight) fireLight.intensity = 5 + Math.sin(time * 11) * 0.8 + Math.sin(time * 27) * 0.5;
  if (frame && !roomFitted) roomFitted = fitToRoom(frame, renderer.xr.getReferenceSpace());
  // while holding something, the ring shows where it would land
  if (holding) {
    const rc = renderer.xr.isPresenting ? rayFrom(lastController || controllers[1]) : (raycaster.setFromCamera(mouse, camera), raycaster);
    const hits = rc.intersectObjects(surfaces, false);
    reticle.visible = !!hits.length;
    if (hits.length) { reticle.position.copy(hits[0].point); holding.obj.position.copy(hits[0].point); }
  } else reticle.visible = false;
  renderer.render(scene, camera);
});

// For checking the page from a test browser.
window.__vr = { scene, camera, interactive, palette, panel, office, placed, choose, onSelect, raycaster };

// ── Start ─────────────────────────────────────────────────────────────────
(async () => {
  const books = await loadBooks();
  fireplace = makeFireplace(); bookshelf = makeBookshelf(books);
  spawn("fireplace"); spawn("bookshelf");
  defaultLayout();
  const saved = loadLayout();
  if (saved) {
    for (const it of saved) {
      if (it.type === "fireplace" || it.type === "bookshelf") {
        const o = it.type === "fireplace" ? fireplace : bookshelf;
        o.position.fromArray(it.p); o.rotation.set(0, it.r, 0);
      }
    }
    applyLayout(saved.filter((it) => it.type !== "fireplace" && it.type !== "bookshelf"));
  }
  if (!navigator.xr) status($("status").textContent + " · this browser has no WebXR; open this page on the Quest");
})();
