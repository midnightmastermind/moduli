// vr/officeScene.js — the VR office's 3D scene (Three.js + WebXR), run INSIDE
// the Moduli app (user, 2026-10-21: the office reads the grid the app already
// holds, so a shelf is a saved query answered by the feed code).
//
// Imperative on purpose: React owns the data and the 2D dialogs (VrOffice.jsx),
// this file owns the canvas. They talk through `host`:
//   host.shelves()          [{ shelf, items }]      (vr/shelfItems)
//   host.screens()          [{ screen, label }]
//   host.open(id)           open a page / file in the app (ends the XR session)
//   host.editShelf(id)      the shelf's settings: the app's own feed editor
//   host.editScreen(id)     the screen's settings: which page, or the grid
//   host.addShelf(asset)    -> new shelf id (stored on the grid)
//   host.addScreen()        -> new screen id
//   host.snapshot(screen)   -> Promise<HTMLCanvasElement|null>, what it shows
//   host.decor()            the decor library: built-ins + every .glb on the grid
//   host.layoutKey          where positions are kept in this browser
// Returned: { refresh(), refreshScreens(), endSession(), dispose(), startSession(mode) }
//
// Point and pinch (or trigger, or click on a desktop):
//   a book / record / tape   opens it in Moduli (its file when it has one)
//   ⚙ on a shelf or screen   its settings (leaves the headset view)
//   ◀ ▶ on a shelf           the next / previous shelf-full
//   ⟳ under a screen         redraw what it shows
//   the palette              place a shelf or a screen; "Decor ▸" pages through
//                            the decor library (built-ins + your .glb files)
//   anything placed          pick it up and place it again
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ASSET_LABELS } from "./officeConfig.js";
import { decorPage } from "./decorLibrary.js";
import { makeFireplace as makeFireplaceObject, makeShelfFrame, makeScreenFrame, makeDecor as makeDecorObject, SHELF_SIZES, SCREEN_SIZE } from "./decorMakers.js";

const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const SPINE_COLORS = [0x7a2e2e, 0x2e4a7a, 0x2e6a4a, 0x6a5a2e, 0x5a2e6a, 0x8a5a2a, 0x3a3a3a, 0x7a6a5a];
const PER_PAGE = { record: 9 };

export function createOfficeScene(container, host) {
  const status = (t) => host.status?.(t);
  const W0 = () => container.clientWidth || innerWidth, H0 = () => container.clientHeight || innerHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(W0(), H0());
  renderer.xr.enabled = true;
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, W0() / H0(), 0.05, 50);
  camera.position.set(0, 1.6, 2.6);
  camera.lookAt(0, 1.0, 0);
  const onResize = () => { camera.aspect = W0() / H0(); camera.updateProjectionMatrix(); renderer.setSize(W0(), H0()); };
  addEventListener("resize", onResize);

  scene.add(new THREE.HemisphereLight(0xffe2c0, 0x2a1c12, 1.1));
  const office = new THREE.Group();
  scene.add(office);
  const interactive = [];
  const surfaces = [];
  const textureLoader = new THREE.TextureLoader();
  textureLoader.setCrossOrigin("anonymous");

  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  function box(w, h, d, color, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  const unregister = (obj) => obj.traverse((m) => { const i = interactive.indexOf(m); if (i >= 0) interactive.splice(i, 1); });

  // Cozy room shell: VR and desktop only (in mixed reality the room is real).
  const shell = new THREE.Group();
  {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), mat(0x5a3b25));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; shell.add(floor);
    const wallMat = mat(0x6b4e3d);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), wallMat); back.position.set(0, 1.5, -2); shell.add(back);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), wallMat); left.position.set(-3, 1.5, 0); left.rotation.y = Math.PI / 2; shell.add(left);
    const right = left.clone(); right.position.x = 3; right.rotation.y = -Math.PI / 2; shell.add(right);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), mat(0x3a2a20)); ceiling.position.y = 3; ceiling.rotation.x = Math.PI / 2; shell.add(ceiling);
    const front = back.clone(); front.position.z = 4; front.rotation.y = Math.PI; shell.add(front);
    scene.add(shell);
  }
  // In VR the room follows the headset's BOUNDARY (bounded-floor): floor, walls and ceiling along its edges.
  const shellDefault = [...shell.children];
  function fitShellToBounds(points) {
    if (!points || points.length < 3) return false;
    for (const c of [...shell.children]) shell.remove(c);
    const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)));
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(0x5a3b25));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; shell.add(floor);
    const ceiling = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(0x3a2a20, { side: THREE.BackSide }));
    ceiling.rotation.x = -Math.PI / 2; ceiling.position.y = 3; shell.add(ceiling);
    const wallMat = mat(0x6b4e3d, { side: THREE.DoubleSide });
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z); if (len < 0.01) continue;
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, 3), wallMat);
      wall.position.set((a.x + b.x) / 2, 1.5, (a.z + b.z) / 2);
      wall.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
      shell.add(wall);
    }
    return true;
  }
  function restoreDefaultShell() {
    for (const c of [...shell.children]) shell.remove(c);
    for (const c of shellDefault) shell.add(c);
  }
  const floorSurface = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ visible: false }));
  floorSurface.rotation.x = -Math.PI / 2;
  scene.add(floorSurface); surfaces.push(floorSurface);

  // ── Textures ─────────────────────────────────────────────────────────────
  function canvasTex(w, h, draw) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const hex = (n) => "#" + n.toString(16).padStart(6, "0");
  function wrapLines(x, text, maxW, maxLines) {
    const words = String(text).split(/\s+/); const lines = []; let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
      if (lines.length === maxLines) break;
    }
    if (lines.length < maxLines && cur) lines.push(cur);
    return lines;
  }
  const spineTexture = (title, color, ink = "#f4e9d8") => canvasTex(64, 256, (x) => {
    x.fillStyle = hex(color); x.fillRect(0, 0, 64, 256);
    x.fillStyle = "#e8d9b5"; x.fillRect(0, 18, 64, 3); x.fillRect(0, 235, 64, 3);
    x.save(); x.translate(38, 128); x.rotate(-Math.PI / 2);
    x.font = "bold 20px Georgia"; x.textAlign = "center"; x.fillStyle = ink;
    x.fillText(title.length > 18 ? title.slice(0, 17) + "…" : title, 0, 0);
    x.restore();
  });
  const sleeveTexture = (title, color) => canvasTex(256, 256, (x) => {
    x.fillStyle = hex(color); x.fillRect(0, 0, 256, 256);
    x.fillStyle = "rgba(0,0,0,0.25)"; x.beginPath(); x.arc(128, 128, 90, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#f4e9d8"; x.font = "bold 22px Georgia"; x.textAlign = "center";
    wrapLines(x, title, 220, 4).forEach((l, i) => x.fillText(l, 128, 100 + i * 28));
  });
  const labelTexture = (text, w = 512, h = 96) => canvasTex(w, h, (x) => {
    x.fillStyle = "#2a1c12"; x.fillRect(0, 0, w, h);
    x.fillStyle = "#e8c98a"; x.font = "bold " + Math.round(h * 0.42) + "px Georgia"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(text, w / 2, h / 2);
  });
  function plaque(text, w, h) {
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: labelTexture(text, 512, Math.round(512 * h / w)) }));
  }
  function setPlaque(m, text) {
    m.material.map?.dispose();
    const w = m.geometry.parameters.width, h = m.geometry.parameters.height;
    m.material.map = labelTexture(text, 512, Math.round(512 * h / w)); m.material.needsUpdate = true;
  }
  // A cover picture replaces the drawn face once it loads; a picture that will
  // not load (no CORS, gone) leaves the drawn one in place.
  function loadCover(material, url) {
    if (!url) return;
    textureLoader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; material.map?.dispose(); material.map = t; material.needsUpdate = true; }, undefined, () => {});
  }

  // ── Fireplace ────────────────────────────────────────────────────────────
  const flames = [];
  let fireLight;
  function makeFireplace() {
    const g = makeFireplaceObject(THREE, { flames });
    fireLight = g.userData.light;
    return g;
  }

  // ── Shelves: the PLACED shelf decides what each result looks like ────────
  // Items are packed into "pages"; ◀ ▶ on top move between them.
  function packSpines(items, { W, SHELVES, height, thick, fixed }) {
    const slots = []; let page = 0, shelf = 0, x = -W / 2 + 0.04;
    for (const item of items) {
      const h = fixed ? height : height + (hash(item.title) % 6) / 100;
      const t = fixed ? thick : thick + (hash(item.title + "w") % 3) / 100;
      if (x + t > W / 2 - 0.03) { shelf++; x = -W / 2 + 0.04; }
      if (shelf >= SHELVES) { page++; shelf = 0; x = -W / 2 + 0.04; }
      slots.push({ item, page, shelf, x, t, h });
      x += t + 0.004;
    }
    return { slots, pageCount: page + 1 };
  }
  function packGrid(items, perPage) {
    const slots = items.map((item, i) => ({ item, page: Math.floor(i / perPage), cell: i % perPage }));
    return { slots, pageCount: Math.max(1, Math.ceil(items.length / perPage)) };
  }

  function makeShelf(shelf, items) {
    const g = new THREE.Group();
    const asset = shelf.asset;
    let W, H, D, SHELVES, packed, place;
    if (asset === "record") {
      // A face-out cube shelf: 3 × 3 sleeves.
      ({ W, H, D, SHELVES } = SHELF_SIZES.record);
      packed = packGrid(items, PER_PAGE.record);
      place = (s) => {
        const color = SPINE_COLORS[hash(s.item.title) % SPINE_COLORS.length];
        const face = new THREE.MeshStandardMaterial({ map: sleeveTexture(s.item.title, color), roughness: 0.6 });
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.012), [mat(color), mat(color), mat(color), mat(color), face, mat(color)]);
        const col = s.cell % 3, row = Math.floor(s.cell / 3);
        m.position.set(-W / 3 + col * (W / 3), H - (row + 0.5) * (H - 0.04) / 3, 0.05);
        m.rotation.x = -0.08;
        loadCover(face, s.item.cover);
        return m;
      };
    } else {
      const vhs = asset === "vhs";
      ({ W, H, D, SHELVES } = SHELF_SIZES[vhs ? "vhs" : "book"]);
      packed = packSpines(items, { W, SHELVES, height: vhs ? 0.19 : 0.24, thick: vhs ? 0.028 : 0.035, fixed: vhs });
      place = (s) => {
        const color = vhs ? 0x151515 : SPINE_COLORS[hash(s.item.title) % SPINE_COLORS.length];
        const spine = new THREE.MeshStandardMaterial({ map: spineTexture(s.item.title, color, vhs ? "#f2f2f2" : "#f4e9d8"), roughness: 0.7 });
        const plain = mat(color), edges = mat(vhs ? 0x222222 : 0xe9dfc8);
        const m = new THREE.Mesh(new THREE.BoxGeometry(s.t, s.h, D * 0.8), [plain, plain, edges, edges, spine, plain]);
        m.position.set(s.x + s.t / 2, 0.035 + s.shelf * (H - 0.04) / SHELVES + s.h / 2, 0.01);
        return m;
      };
    }
    g.add(makeShelfFrame(THREE, asset));

    const itemGroup = new THREE.Group(); g.add(itemGroup);
    const title = plaque(shelf.title || ASSET_LABELS[asset] || "Shelf", 0.6, 0.09); title.position.set(0, H + 0.08, 0.02); g.add(title);
    const gear = plaque("⚙", 0.09, 0.07); gear.position.set(W / 2 - 0.05, H + 0.08, 0.03);
    gear.userData.onSelect = () => host.editShelf(shelf.id); g.add(gear); interactive.push(gear);
    const counter = plaque("", 0.16, 0.06); counter.position.set(0, H, 0.17); g.add(counter);
    if (!items.length) {
      const empty = plaque("Point at ⚙ to set what this shelf holds", 0.9, 0.08);
      empty.position.set(0, H / 2, D / 2 + 0.01); itemGroup.add(empty);
    }
    let current = 0;
    const show = (p) => {
      current = (p + packed.pageCount) % packed.pageCount;
      for (const m of [...itemGroup.children]) { if (!m.userData.item) continue; itemGroup.remove(m); unregister(m); }
      for (const s of packed.slots) {
        if (s.page !== current) continue;
        const m = place(s);
        m.castShadow = true;
        m.userData.item = s.item; m.userData.hoverable = true;
        m.userData.onSelect = () => { m.position.z += 0.08; host.open(s.item.id); setTimeout(() => (m.position.z -= 0.08), 900); };
        itemGroup.add(m); interactive.push(m);
      }
      setPlaque(counter, (current + 1) + " / " + packed.pageCount + "  ·  " + items.length);
    };
    if (packed.pageCount > 1) {
      const prev = plaque("◀", 0.09, 0.07), next = plaque("▶", 0.09, 0.07);
      prev.position.set(-0.17, H, 0.17); next.position.set(0.17, H, 0.17);
      prev.userData.onSelect = () => show(current - 1); next.userData.onSelect = () => show(current + 1);
      g.add(prev, next); interactive.push(prev, next);
    }
    show(0);
    return g;
  }

  // ── Screens: a page, or the whole grid ───────────────────────────────────
  function makeScreen(screen, label) {
    const g = new THREE.Group();
    const { W, H } = SCREEN_SIZE;
    g.add(makeScreenFrame(THREE));
    const face = new THREE.MeshBasicMaterial({ map: labelTexture(label || "Point at ⚙ to choose a page", 1024, 576) });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(W, H), face);
    panel.position.set(0, 1.5, 0.021);
    panel.userData.onSelect = () => {
      if (screen.source === "page" && screen.pageOccId) host.open(screen.pageOccId);
      else if (screen.source === "grid") host.open(null);
      else host.editScreen(screen.id);
    };
    g.add(panel); interactive.push(panel);
    const gear = plaque("⚙", 0.09, 0.07); gear.position.set(W / 2 - 0.06, 1.5 - H / 2 - 0.07, 0.03);
    gear.userData.onSelect = () => host.editScreen(screen.id); g.add(gear); interactive.push(gear);
    const redraw = plaque("⟳", 0.09, 0.07); redraw.position.set(W / 2 - 0.17, 1.5 - H / 2 - 0.07, 0.03);
    redraw.userData.onSelect = () => paintScreen(screen.id); g.add(redraw); interactive.push(redraw);
    const name = plaque(label || "Screen", 0.8, 0.07); name.position.set(-0.3, 1.5 - H / 2 - 0.07, 0.03); g.add(name);
    g.userData.face = face; g.userData.screen = screen;
    return g;
  }
  // Screens are painted once the office is up and the page has gone quiet — a picture is heavy work and must not
  // hold up the room appearing. Repaints (⟳) run straight away.
  let screensReady = false;
  const waitingScreens = new Set();
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 8000 }) : setTimeout(fn, 1500));
  setTimeout(() => idle(() => { screensReady = true; for (const id of waitingScreens) paintScreen(id); waitingScreens.clear(); }), 2500);
  async function paintScreen(id) {
    if (!screensReady) { waitingScreens.add(id); return; }
    if (!FIXTURES["screen:" + id]) return;
    const canvas = await host.snapshot(FIXTURES["screen:" + id].userData.screen).catch(() => null);
    // Read it again: a settings change may have rebuilt the screen meanwhile.
    const obj = FIXTURES["screen:" + id];
    if (!canvas || !obj) return;
    const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace;
    obj.userData.face.map?.dispose(); obj.userData.face.map = t; obj.userData.face.needsUpdate = true;
  }

  // ── Objects you can place ────────────────────────────────────────────────
  const LABELS = { armchair: "Armchair", couch: "Couch", bed: "Queen bed", lamp: "Floor lamp", desklamp: "Desk lamp", plant: "Plant", rug: "Rug", candle: "Candle" };

  // ── Decor from files: any .glb on the grid ───────────────────────────────
  // Loaded once per file. A model is scaled so its largest side is sensible
  // for a room (a file in centimetres or in kilometres both come out ~1 m) and
  // stood on its base. A model that will not load becomes a small marker box
  // that says so, rather than nothing.
  const gltfLoader = new GLTFLoader();
  const gltfCache = new Map();
  function loadModel(src) {
    if (!gltfCache.has(src)) gltfCache.set(src, new Promise((res, rej) => gltfLoader.load(src, (g) => res(g.scene), undefined, rej)));
    return gltfCache.get(src);
  }
  function makeModel(entry) {
    const g = new THREE.Group();
    const marker = box(0.2, 0.2, 0.2, 0x6a5a4a, 0, 0.1, 0); g.add(marker);
    loadModel(entry.src).then((scene) => {
      const m = scene.clone(true);
      const b = new THREE.Box3().setFromObject(m); const size = b.getSize(new THREE.Vector3());
      const big = Math.max(size.x, size.y, size.z) || 1;
      const scale = big > 3 || big < 0.1 ? 1 / big : 1;
      m.scale.setScalar(scale);
      const b2 = new THREE.Box3().setFromObject(m);
      m.position.y -= b2.min.y; m.position.x -= (b2.min.x + b2.max.x) / 2; m.position.z -= (b2.min.z + b2.max.z) / 2;
      m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.remove(marker); unregister(marker); g.add(m);
      if (g.userData.grabbable) makeGrabbable(g);
    }).catch(() => { status("Could not load " + entry.title); marker.material.color.set(0xaa3333); });
    return g;
  }
  function makeDecor(key) {
    { const g = makeDecorObject(THREE, key, { flames }); if (g) return g; }
    const entry = (host.decor?.() || []).find((d) => d.key === key);
    return entry?.src ? makeModel(entry) : null;
  }
  const decorTitle = (key) => LABELS[key] || (host.decor?.() || []).find((d) => d.key === key)?.title || "it";

  // ── Placing and moving ───────────────────────────────────────────────────
  // FIXTURES: things the office builds from data (fireplace, every shelf and
  // screen) keyed "fireplace" / "shelf:<id>" / "screen:<id>"; `placed` are the
  // free objects. Positions of both are kept in this browser.
  const FIXTURES = {};
  const placed = [];
  let holding = null;
  function makeGrabbable(obj) {
    obj.userData.grabbable = true;
    obj.traverse((m) => { if (m.isMesh && !m.userData.onSelect) { m.userData.onSelect = () => pickUp(obj); interactive.push(m); } });
  }
  function pickUp(obj) { if (holding) return; holding = { obj, turned: true }; showHoldMenu(); status("Point where it should go and pinch · the menu above it turns or deletes it"); }
  function choose(type) {
    if (holding) return;
    const obj = makeDecor(type); if (!obj) return;
    obj.userData.type = type; office.add(obj); makeGrabbable(obj);
    placed.push(obj); holding = { obj, turned: false }; showHoldMenu();
    status("Point at the floor or a table and pinch to place the " + decorTitle(type).toLowerCase());
  }
  function drop(point) {
    const { obj, turned } = holding; holding = null; hideHoldMenu();
    if (point) obj.position.copy(point);
    // A NEW piece faces you; one you picked up (or turned) keeps the way it was turned.
    if (!turned) { const { pos } = headPose(); obj.lookAt(pos.x, obj.position.y, pos.z); }
    saveLayout(); status("Placed. Point at it and pinch to move, turn or delete it.");
  }
  function turnHeld(radians) {
    if (!holding) return;
    holding.obj.rotation.y += radians; holding.turned = true;
  }
  function keyOf(obj) { return Object.keys(FIXTURES).find((k) => FIXTURES[k] === obj) || null; }
  async function deleteHeld() {
    if (!holding) return;
    const { obj } = holding; const key = keyOf(obj);
    if (key === "fireplace") { status("The fireplace stays — move or turn it instead."); return; }
    holding = null; hideHoldMenu();
    if (key) {
      const ok = await host.removeFixture?.(key);
      if (ok === false) { status("Could not remove that."); return; }
      office.remove(obj); unregister(obj); delete FIXTURES[key];
      refresh();
    } else {
      const i = placed.indexOf(obj); if (i >= 0) placed.splice(i, 1);
      office.remove(obj); unregister(obj);
    }
    saveLayout(); status("Deleted.");
  }

  // ── The hold menu: ⟲ ⟳ Delete Done, floating above whatever you are holding ──
  const HOLD_BTNS = [["left", "⟲"], ["right", "⟳"], ["delete", "Delete"], ["done", "Done"]];
  const holdCanvas = document.createElement("canvas"); holdCanvas.width = 512; holdCanvas.height = 112;
  const holdTex = new THREE.CanvasTexture(holdCanvas); holdTex.colorSpace = THREE.SRGBColorSpace;
  const holdMenu = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.105), new THREE.MeshBasicMaterial({ map: holdTex, transparent: true, side: THREE.DoubleSide, depthTest: false }));
  holdMenu.renderOrder = 10; holdMenu.visible = false; scene.add(holdMenu);
  function drawHoldMenu() {
    const x = holdCanvas.getContext("2d"); x.clearRect(0, 0, 512, 112);
    x.fillStyle = "rgba(26,18,12,0.88)"; x.beginPath(); x.roundRect(0, 0, 512, 112, 22); x.fill();
    const fixedFire = holding && keyOf(holding.obj) === "fireplace";
    HOLD_BTNS.forEach(([k, label], i) => {
      const cx = 8 + i * 126; const off = k === "delete" && fixedFire;
      x.fillStyle = k === "delete" ? (off ? "#4a3a30" : "#8a2f22") : k === "done" ? "#3f774e" : "#5a4030";
      x.beginPath(); x.roundRect(cx, 10, 118, 92, 16); x.fill();
      x.fillStyle = off ? "#9a8a7a" : "#f4e9d8"; x.font = (label.length > 2 ? "30px" : "52px") + " system-ui"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(label, cx + 59, 58);
    });
    holdTex.needsUpdate = true;
  }
  function showHoldMenu() { drawHoldMenu(); holdMenu.visible = true; }
  function hideHoldMenu() { holdMenu.visible = false; }
  const holdBox = new THREE.Box3();
  function placeHoldMenu() {
    if (!holding) return;
    holdBox.setFromObject(holding.obj);
    const top = Number.isFinite(holdBox.max.y) ? holdBox.max.y : holding.obj.position.y + 1;
    holdMenu.position.set(holding.obj.position.x, top + 0.18, holding.obj.position.z);
    const { pos } = headPose(); holdMenu.lookAt(pos.x, holdMenu.position.y, pos.z);
  }
  function holdMenuHit(rc) {
    if (!holdMenu.visible) return null;
    const h = rc.intersectObject(holdMenu, false)[0];
    if (!h?.uv) return null;
    const i = Math.min(3, Math.max(0, Math.floor(h.uv.x * 4)));
    return { key: HOLD_BTNS[i][0], distance: h.distance };
  }
  function pressHoldMenu(key) {
    if (key === "left") turnHeld(Math.PI / 4);
    else if (key === "right") turnHeld(-Math.PI / 4);
    else if (key === "delete") deleteHeld();
    else if (key === "done") drop(null);
  }

  // ── Layout, kept in this browser ─────────────────────────────────────────
  function saveLayout() {
    const fixtures = {};
    for (const [k, o] of Object.entries(FIXTURES)) fixtures[k] = { p: o.position.toArray().map((n) => +n.toFixed(3)), r: +o.rotation.y.toFixed(3) };
    const objects = placed.map((o) => ({ type: o.userData.type, p: o.position.toArray().map((n) => +n.toFixed(3)), r: +o.rotation.y.toFixed(3) }));
    try { localStorage.setItem(host.layoutKey, JSON.stringify({ fixtures, objects })); } catch { /* private mode */ }
  }
  function loadLayout() {
    try { const v = JSON.parse(localStorage.getItem(host.layoutKey) || "null"); return v && v.fixtures ? v : null; } catch { return null; }
  }
  const saved = loadLayout();
  function placeFixture(key, obj, fallback) {
    const s = saved?.fixtures?.[key];
    if (s) { obj.position.fromArray(s.p); obj.rotation.set(0, s.r, 0); } else fallback(obj);
  }
  // Spots for a fixture that has never been placed: round the walls of the shell.
  const SPOTS = [[-2.4, -1.0, Math.PI / 2], [-2.4, 0.4, Math.PI / 2], [2.4, -1.0, -Math.PI / 2], [2.4, 0.4, -Math.PI / 2], [-1.3, -1.8, 0], [1.3, -1.8, 0]];
  let nextSpot = 0;
  const atSpot = (obj) => { const [x, z, r] = SPOTS[nextSpot++ % SPOTS.length]; obj.position.set(x, 0, z); obj.rotation.set(0, r, 0); };

  const fireplace = makeFireplace();
  office.add(fireplace); FIXTURES.fireplace = fireplace; makeGrabbable(fireplace);
  placeFixture("fireplace", fireplace, (o) => o.position.set(0, 0, -1.8));
  for (const it of saved?.objects || []) {
    const obj = makeDecor(it.type); if (!obj) continue;   // a model file since deleted is skipped
    obj.userData.type = it.type; office.add(obj); makeGrabbable(obj); placed.push(obj);
    obj.position.fromArray(it.p); obj.rotation.set(0, it.r, 0);
  }

  // Rebuild shelves and screens from the app's data. Keeps where each stands.
  function refresh() {
    const want = new Set();
    for (const { shelf, items } of host.shelves()) {
      const key = "shelf:" + shelf.id; want.add(key);
      const prev = FIXTURES[key];
      // Unchanged settings and contents: keep it (a rebuild redraws every cover).
      const sig = JSON.stringify([shelf, items.map((it) => [it.id, it.title, it.cover])]);
      if (prev && prev.userData.sig === sig) continue;
      const obj = makeShelf(shelf, items); obj.userData.sig = sig;
      if (prev) { obj.position.copy(prev.position); obj.rotation.copy(prev.rotation); office.remove(prev); unregister(prev); }
      else placeFixture(key, obj, atSpot);
      FIXTURES[key] = obj; office.add(obj); makeGrabbable(obj);
    }
    for (const { screen, label } of host.screens()) {
      const key = "screen:" + screen.id; want.add(key);
      const prev = FIXTURES[key];
      // Rows changing elsewhere do not re-picture a screen — ⟳ does. Only a
      // changed source (or its page's name) rebuilds it.
      const sig = JSON.stringify([screen, label]);
      if (prev && prev.userData.sig === sig) continue;
      const obj = makeScreen(screen, label); obj.userData.sig = sig;
      if (prev) { obj.position.copy(prev.position); obj.rotation.copy(prev.rotation); office.remove(prev); unregister(prev); }
      else placeFixture(key, obj, atSpot);
      FIXTURES[key] = obj; office.add(obj); makeGrabbable(obj);
      paintScreen(screen.id);
    }
    for (const key of Object.keys(FIXTURES)) {
      if (key === "fireplace" || want.has(key)) continue;
      office.remove(FIXTURES[key]); unregister(FIXTURES[key]); delete FIXTURES[key];
    }
  }
  function refreshDecor() { if (palMode === "decor") drawPalette(); }
  function refreshScreens() { for (const key of Object.keys(FIXTURES)) if (key.startsWith("screen:")) paintScreen(key.slice(7)); }
  // A shelf / screen just created from the palette: it rides the pointer until placed.
  function holdFixture(key) {
    const obj = FIXTURES[key];
    if (!obj || holding) return;
    holding = { obj, turned: false }; showHoldMenu(); status("Point at the floor and pinch to place it");
  }

  // ── The palette: Place (shelves, screens) and Decor (the library) ───────
  const MAIN = [["shelf:book", "Bookshelf"], ["shelf:record", "Record crate"], ["shelf:vhs", "VHS shelf"], ["screen", "Screen"], ["decor", "Decor ▸"]];
  const PER_DECOR_PAGE = 8;
  let palMode = "main", decorIdx = 0;
  const palCanvas = document.createElement("canvas"); palCanvas.width = 512; palCanvas.height = 560;
  const palTex = new THREE.CanvasTexture(palCanvas); palTex.colorSpace = THREE.SRGBColorSpace;
  const palette = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.39), new THREE.MeshBasicMaterial({ map: palTex, transparent: true }));
  const cell = (i) => ({ cx: 30 + (i % 2) * 236, cy: 76 + Math.floor(i / 2) * 92 });
  // What each cell does in the current mode: [[action, label], …] by cell index.
  function palCells() {
    if (palMode === "main") return MAIN;
    const lib = host.decor?.() || [];
    const { items, page, pages } = decorPage(lib, decorIdx, PER_DECOR_PAGE);
    const cells = [["back", "◂ Back"], ...items.map((d) => ["decor:" + d.key, d.title])];
    while (cells.length < 9) cells.push(null);
    cells.push(pages > 1 ? ["more", "More " + (page + 1) + "/" + pages] : null);
    return cells;
  }
  function drawPalette() {
    const x = palCanvas.getContext("2d");
    x.clearRect(0, 0, 512, 560);
    x.fillStyle = "rgba(30,22,16,0.92)"; x.fillRect(0, 0, 512, 560);
    x.fillStyle = "#f4e9d8"; x.font = "bold 32px system-ui"; x.textAlign = "center";
    x.fillText(palMode === "main" ? "Place" : "Decor", 256, 50);
    palCells().forEach((c, i) => {
      if (!c) return;
      const { cx, cy } = cell(i);
      x.fillStyle = c[0].startsWith("decor:") ? "#4a3424" : "#5a3e22"; x.fillRect(cx, cy, 216, 76);
      x.fillStyle = "#f4e9d8"; x.font = "24px system-ui";
      const label = c[1].length > 16 ? c[1].slice(0, 15) + "…" : c[1];
      x.fillText(label, cx + 108, cy + 46);
    });
    palTex.needsUpdate = true;
  }
  drawPalette();
  palette.userData.onSelect = async (hit) => {
    const px = hit.uv.x * 512, py = (1 - hit.uv.y) * 560;
    const cells = palCells();
    const i = cells.findIndex((c, k) => { if (!c) return false; const { cx, cy } = cell(k); return px >= cx && px <= cx + 216 && py >= cy && py <= cy + 76; });
    if (i < 0 || holding) return;
    const [key] = cells[i];
    if (key === "decor") { palMode = "decor"; decorIdx = 0; drawPalette(); }
    else if (key === "back") { palMode = "main"; drawPalette(); }
    else if (key === "more") { decorIdx++; drawPalette(); }
    else if (key.startsWith("decor:")) choose(key.slice(6));
    else if (key.startsWith("shelf:")) { const id = await host.addShelf(key.slice(6)); if (id) { refresh(); holdFixture("shelf:" + id); } }
    else if (key === "screen") { const id = await host.addScreen(); if (id) { refresh(); holdFixture("screen:" + id); } }
  };
  scene.add(palette); interactive.push(palette);
  palette.position.set(0.9, 1.1, 1.0); palette.lookAt(0, 1.4, 2.6);

  function headPose() {
    const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    const pos = new THREE.Vector3(); cam.getWorldPosition(pos);
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir); dir.y = 0; dir.normalize();
    return { pos, dir };
  }

  // ── Mixed reality: the fireplace on the biggest real wall ────────────────
  let roomFitted = true;
  function fitToRoom(frame, refSpace) {
    const planes = frame.detectedPlanes;
    if (!planes || planes.size === 0) return false;
    const walls = [];
    let tables = 0;
    planes.forEach((plane) => {
      const pose = frame.getPose(plane.planeSpace, refSpace);
      if (!pose) return;
      const poly = plane.polygon || [];
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
      const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
      const pos = new THREE.Vector3().setFromMatrixPosition(m);
      const normal = new THREE.Vector3(0, 1, 0).transformDirection(m);
      const label = (plane.semanticLabel || "").toLowerCase();
      if (plane.orientation === "vertical" && label !== "door" && label !== "window") walls.push({ pos, normal, area: (maxX - minX) * (maxZ - minZ) });
      if (label === "table" || label === "desk") tables++;
      if (plane.orientation === "horizontal" && poly.length > 2) {
        const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, -p.z)));
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
        mesh.applyMatrix4(m); mesh.rotateX(-Math.PI / 2); scene.add(mesh); surfaces.push(mesh);
      }
    });
    if (!walls.length) return false;
    walls.sort((a, b) => b.area - a.area);
    if (!saved?.fixtures?.fireplace) {
      const wall = walls[0];
      const n = wall.normal.clone(); n.y = 0; n.normalize();
      const { pos } = headPose();
      if (n.dot(new THREE.Vector3(pos.x - wall.pos.x, 0, pos.z - wall.pos.z)) < 0) n.negate();
      fireplace.position.set(wall.pos.x, 0, wall.pos.z).addScaledVector(n, 0.22);
      fireplace.rotation.set(0, Math.atan2(n.x, n.z), 0);
      saveLayout();
    }
    status("Fitted to your room: " + walls.length + " walls, " + tables + " tables found");
    return true;
  }

  // ── Pointing ─────────────────────────────────────────────────────────────
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
  const isShown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  function onSelect(rc) {
    if (holding) {
      const menu = holdMenuHit(rc);
      const hits = rc.intersectObjects(surfaces, false);
      if (menu && (!hits.length || menu.distance <= hits[0].distance)) { pressHoldMenu(menu.key); return; }
      if (hits.length) drop(hits[0].point);
      return;
    }
    const hits = rc.intersectObjects(interactive, false).filter((h) => isShown(h.object));
    if (!hits.length) return;
    const item = hits.find((h) => h.object.userData.hoverable && h.distance < hits[0].distance + 0.08);
    (item || hits[0]).object.userData.onSelect?.(item || hits[0]);
  }
  const mouse = new THREE.Vector2();
  const toMouse = (e) => { const r = renderer.domElement.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
  const onPointerDown = (e) => { if (renderer.xr.isPresenting) return; toMouse(e); raycaster.setFromCamera(mouse, camera); onSelect(raycaster); };
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", toMouse);

  // ── Sessions ─────────────────────────────────────────────────────────────
  async function startSession(mode) {
    const session = await navigator.xr.requestSession(mode, {
      requiredFeatures: ["local-floor"],
      optionalFeatures: mode === "immersive-ar" ? ["bounded-floor", "plane-detection", "hand-tracking", "anchors"] : ["bounded-floor", "hand-tracking"],
    });
    shell.visible = mode !== "immersive-ar";
    roomFitted = mode !== "immersive-ar";
    // BOUNDED-FLOOR: positions are relative to your boundary, so what you place stays put from one session to the
    // next. `local-floor`'s origin is wherever the headset was when the session began — which is why furniture
    // used to land somewhere new every time.
    let bounds = null;
    try {
      const space = await session.requestReferenceSpace("bounded-floor");
      if (space?.boundsGeometry?.length >= 3) bounds = [...space.boundsGeometry].map((p) => ({ x: p.x, z: p.z }));
    } catch { /* no boundary: local-floor */ }
    renderer.xr.setReferenceSpaceType(bounds ? "bounded-floor" : "local-floor");
    await renderer.xr.setSession(session);
    if (bounds && mode === "immersive-vr") fitShellToBounds(bounds);
    status(bounds ? "Using your boundary — what you place stays where you put it." : "No boundary from the headset — places follow where you start.");
    session.addEventListener("end", () => { shell.visible = true; restoreDefaultShell(); });
    setTimeout(() => {
      const { pos, dir } = headPose();
      palette.position.copy(pos).addScaledVector(dir, 0.6); palette.position.y = 1.0;
      palette.lookAt(pos.x, palette.position.y, pos.z); palette.position.x -= 0.35;
    }, 600);
  }
  async function endSession() { await renderer.xr.getSession()?.end().catch(() => {}); }

  // ── Loop ─────────────────────────────────────────────────────────────────
  const clock = new THREE.Clock();
  let lastTime = null;
  renderer.setAnimationLoop((t, frame) => {
    const time = clock.getElapsedTime();
    for (const f of flames) {
      const s = 0.8 + 0.25 * Math.sin(time * 9 + f.userData.phase) + 0.15 * Math.sin(time * 23 + f.userData.phase * 2);
      if (f.userData.baseY === undefined) f.userData.baseY = f.position.y - f.userData.h / 2;
      f.scale.set(1, s, 1); f.position.y = f.userData.baseY + f.userData.h * s / 2;
    }
    if (fireLight) fireLight.intensity = 5 + Math.sin(time * 11) * 0.8 + Math.sin(time * 27) * 0.5;
    if (frame && !roomFitted) roomFitted = fitToRoom(frame, renderer.xr.getReferenceSpace());
    const dt = Math.min(0.1, time - (lastTime ?? time)); lastTime = time;
    if (holding) {
      // A thumbstick pushed sideways turns what you hold.
      for (const src of frame?.session?.inputSources || []) {
        const ax = src.gamepad?.axes?.[2] ?? 0;
        if (Math.abs(ax) > 0.3) turnHeld(-ax * 2.2 * dt);
      }
      const rc = renderer.xr.isPresenting ? rayFrom(lastController || controllers[1]) : (raycaster.setFromCamera(mouse, camera), raycaster);
      const menu = holdMenuHit(rc);
      const hits = rc.intersectObjects(surfaces, false);
      // Pointing at the hold menu leaves the piece where it is, so you can press its buttons.
      const onMenu = menu && (!hits.length || menu.distance <= hits[0].distance);
      reticle.visible = !!hits.length && !onMenu;
      if (hits.length && !onMenu) { reticle.position.copy(hits[0].point); holding.obj.position.copy(hits[0].point); }
      placeHoldMenu();
    } else reticle.visible = false;
    renderer.render(scene, camera);
  });

  refresh();

  function resetLayout() {
    try { localStorage.removeItem(host.layoutKey); } catch { /* ignore */ }
    for (const o of placed) { office.remove(o); unregister(o); }
    placed.length = 0; nextSpot = 0;
    fireplace.position.set(0, 0, -1.8); fireplace.rotation.set(0, 0, 0);
    for (const [k, o] of Object.entries(FIXTURES)) if (k !== "fireplace") atSpot(o);
    status("Layout reset");
  }

  function dispose() {
    renderer.setAnimationLoop(null);
    endSession();
    removeEventListener("resize", onResize);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", toMouse);
    renderer.dispose();
    renderer.domElement.remove();
  }

  // For checking the page from a test browser.
  window.__vr = { scene, camera, interactive, palette, office, FIXTURES, placed, onSelect, raycaster, palCells, holdMenu, isHolding: () => !!holding, shell, renderer };

  return { refresh, refreshScreens, refreshDecor, startSession, endSession, resetLayout, dispose };
}
