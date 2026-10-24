// vr/decorMakers.js — the office's furniture, built from three.js primitives.
//
// Shared by the browser office (officeScene) and the Quest app's model export
// (quest/tools/exportModels.mjs), so the two offices hold the same pieces.
// Nothing here knows about a scene, input or the grid.

export const SHELF_SIZES = {
  book: { W: 1.1, H: 1.8, D: 0.3, SHELVES: 5 },
  record: { W: 1.15, H: 1.15, D: 0.36, SHELVES: 3 },
  vhs: { W: 1.0, H: 1.3, D: 0.24, SHELVES: 4 },
};
export const SCREEN_SIZE = { W: 1.6, H: 0.9, Y: 1.5 };

function kit(THREE) {
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  function box(w, h, d, color, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  return { mat, box };
}

/** The fireplace. Its flames are pushed onto `flames` (they flicker in the browser); its light is `userData.light`. */
export function makeFireplace(THREE, { flames = [] } = {}) {
  const { box } = kit(THREE);
  const g = new THREE.Group();
  g.add(box(1.5, 1.1, 0.4, 0x8a8077, 0, 0.55, 0));
  g.add(box(1.7, 0.08, 0.5, 0x5b3a22, 0, 1.14, 0.03));
  g.add(box(0.9, 0.7, 0.3, 0x1a1410, 0, 0.42, 0.08));
  g.add(box(0.6, 0.06, 0.12, 0x4a2c18, -0.05, 0.12, 0.18));
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
  const light = new THREE.PointLight(0xff8a3d, 6, 6, 1.4);
  light.position.set(0, 0.45, 0.45); light.castShadow = true;
  g.add(light); g.userData.light = light;
  g.add(box(0.6, 0.42, 0.03, 0x3b2a1a, 0, 1.55, 0));
  g.add(box(0.52, 0.34, 0.01, 0x9fb7c9, 0, 1.55, 0.02));
  return g;
}

/** The empty frame of a shelf of `asset` (back, sides, boards). */
export function makeShelfFrame(THREE, asset) {
  const { box } = kit(THREE);
  const { W, H, D, SHELVES } = SHELF_SIZES[asset] || SHELF_SIZES.book;
  const wood = 0x4e3220;
  const g = new THREE.Group();
  g.add(box(W, H, 0.02, wood, 0, H / 2, -D / 2 + 0.01));
  g.add(box(0.03, H, D, wood, -W / 2, H / 2, 0));
  g.add(box(0.03, H, D, wood, W / 2, H / 2, 0));
  for (let i = 0; i <= SHELVES; i++) g.add(box(W, 0.025, D, wood, 0, 0.02 + i * (H - 0.04) / SHELVES, 0));
  return g;
}

/** A screen's bezel and stand (the picture sits at y = SCREEN_SIZE.Y, just in front). */
export function makeScreenFrame(THREE) {
  const { box } = kit(THREE);
  const { W, H, Y } = SCREEN_SIZE;
  const g = new THREE.Group();
  // Wall-mounted: just the frame, no stand (user, 2026-10-23).
  g.add(box(W + 0.06, H + 0.06, 0.04, 0x111111, 0, Y, 0));
  return g;
}

/** A built-in piece of decor, or null for an unknown key. Candle flames go onto `flames`. */
export function makeDecor(THREE, key, { flames = [] } = {}) {
  const { mat, box } = kit(THREE);
  const g = new THREE.Group();
  switch (key) {
    case "armchair": {
      const c = 0x7a3b2e;
      g.add(box(0.8, 0.42, 0.8, c, 0, 0.21, 0)); g.add(box(0.8, 0.5, 0.18, c, 0, 0.67, -0.31));
      g.add(box(0.14, 0.25, 0.8, c, -0.33, 0.54, 0)); g.add(box(0.14, 0.25, 0.8, c, 0.33, 0.54, 0));
      return g;
    }
    case "couch": {
      // A three-seat sofa, 2.1m wide; its back is at -z like the armchair's, so it faces +z.
      const c = 0x4a5a6a, cushion = 0x5c6e80;
      g.add(box(2.1, 0.22, 0.9, 0x3a4652, 0, 0.17, 0));
      for (const x of [-0.65, 0, 0.65]) g.add(box(0.64, 0.14, 0.7, cushion, x, 0.35, 0.06));
      g.add(box(2.1, 0.5, 0.2, c, 0, 0.6, -0.35));
      g.add(box(0.18, 0.32, 0.9, c, -0.96, 0.44, 0)); g.add(box(0.18, 0.32, 0.9, c, 0.96, 0.44, 0));
      for (const x of [-0.95, 0.95]) for (const z of [-0.38, 0.38]) g.add(box(0.06, 0.06, 0.06, 0x2a2a2a, x, 0.03, z));
      return g;
    }
    case "swivelchair": {
      // An office chair with no back and no arms (user, 2026-10-23): five-star base on casters, gas lift, padded seat.
      const dark = 0x2b2b2b, pad = 0x34495e;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const leg = box(0.32, 0.03, 0.05, dark, Math.sin(a) * 0.16, 0.07, Math.cos(a) * 0.16);
        leg.rotation.y = a + Math.PI / 2; g.add(leg);
        const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), mat(0x111111));
        wheel.position.set(Math.sin(a) * 0.31, 0.03, Math.cos(a) * 0.31); g.add(wheel);
      }
      const lift = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 12), mat(0x888888)); lift.position.y = 0.26; g.add(lift);
      g.add(box(0.5, 0.08, 0.48, pad, 0, 0.47, 0));
      return g;
    }
    case "longtable": {
      // A long table, 2.4 x 0.9m, 75cm high: a thick wooden top on four square legs with a rail under the top.
      const wood = 0x6b4a2f;
      g.add(box(2.4, 0.05, 0.9, 0x7a5636, 0, 0.725, 0));
      for (const x of [-1.12, 1.12]) for (const z of [-0.38, 0.38]) g.add(box(0.07, 0.7, 0.07, wood, x, 0.35, z));
      for (const z of [-0.38, 0.38]) g.add(box(2.2, 0.08, 0.03, wood, 0, 0.66, z));
      for (const x of [-1.12, 1.12]) g.add(box(0.03, 0.08, 0.7, wood, x, 0.66, 0));
      return g;
    }
    case "recordplayer": {
      // A turntable: wooden plinth, platter with a black record, a tonearm. Drop a record on it to play it (Quest app).
      g.add(box(0.45, 0.1, 0.36, 0x5e4129, 0, 0.05, 0));
      const platter = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.015, 40), mat(0x1a1a1a, { roughness: 0.4 }));
      platter.position.set(-0.04, 0.108, 0); g.add(platter);
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.017, 24), mat(0xc9a86a));
      label.position.set(-0.04, 0.109, 0); g.add(label);
      g.add(box(0.012, 0.012, 0.22, 0xb8b8b8, 0.16, 0.13, -0.02));
      g.add(box(0.04, 0.03, 0.04, 0x2b2b2b, 0.16, 0.115, -0.13));
      return g;
    }
    case "vhsplayer": {
      // A VCR: black box with a tape slot and a small green display. Drop a tape on it to play it on a screen.
      g.add(box(0.43, 0.09, 0.3, 0x1b1b1b, 0, 0.045, 0));
      g.add(box(0.2, 0.025, 0.004, 0x050505, -0.07, 0.055, 0.152));
      g.add(box(0.08, 0.02, 0.004, 0x1f5f3a, 0.13, 0.055, 0.152));
      return g;
    }
    case "clock": {
      // A round wall clock: a dark wooden rim around the face (the face is drawn live by the Quest app).
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 48), mat(0x3a2616));
      rim.rotation.x = Math.PI / 2; rim.position.set(0, 0.2, 0); g.add(rim);
      return g;
    }
    case "window": {
      // A window frame, 1.0 x 0.75m glass area, four panes and a sill (the view is drawn by the Quest app).
      const wood = 0xe8e2d4;
      g.add(box(1.1, 0.06, 0.08, wood, 0, 0.03, 0));
      g.add(box(1.1, 0.06, 0.08, wood, 0, 0.84, 0));
      for (const x of [-0.53, 0.53]) g.add(box(0.06, 0.87, 0.08, wood, x, 0.435, 0));
      g.add(box(0.03, 0.75, 0.04, wood, 0, 0.435, 0.02));
      g.add(box(1.0, 0.03, 0.04, wood, 0, 0.435, 0.02));
      g.add(box(1.2, 0.03, 0.16, wood, 0, 0.0, 0.05));
      return g;
    }
    case "keyboard": {
      // A full-size keyboard, 44 x 14cm: a dark case with five rows of keys and a space bar. Typing side is +z.
      g.add(box(0.44, 0.02, 0.14, 0x1e1e1e, 0, 0.01, 0));
      const key = 0x3a3a3a;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 14; c++) g.add(box(0.024, 0.012, 0.022, key, -0.195 + c * 0.03, 0.026, -0.05 + r * 0.026));
      }
      g.add(box(0.15, 0.012, 0.022, key, 0, 0.026, 0.054));
      for (const x of [-0.16, -0.12, 0.12, 0.16]) g.add(box(0.034, 0.012, 0.022, key, x, 0.026, 0.054));
      return g;
    }
    case "tvframe": {
      // Just a TV's bezel with nothing inside (user: "make this a tv furniture, not a screen. so i can see my tv
      // through it") — sized for a 65" set (1.45 x 0.83m picture), sitting on its own base so it can be lifted
      // and resized to fit around a real TV.
      const W = 1.45, H = 0.83, b = 0.03, d = 0.03, c = 0x151515;
      g.add(box(W + 2 * b, b, d, c, 0, b / 2, 0));
      g.add(box(W + 2 * b, b, d, c, 0, H + b * 1.5, 0));
      for (const x of [-(W + b) / 2, (W + b) / 2]) g.add(box(b, H, d, c, x, b + H / 2, 0));
      return g;
    }
    case "smalltable": {
      // A small side table, 55 x 55cm and 55cm high, with a lower shelf.
      const wood = 0x6b4a2f;
      g.add(box(0.55, 0.035, 0.55, 0x7a5636, 0, 0.535, 0));
      for (const x of [-0.24, 0.24]) for (const z of [-0.24, 0.24]) g.add(box(0.04, 0.52, 0.04, wood, x, 0.26, z));
      g.add(box(0.48, 0.02, 0.48, wood, 0, 0.14, 0));
      return g;
    }
    case "desk": {
      // A desk, 1.4 x 0.7m, 75cm high: wooden top, a three-drawer pedestal on the right, a leg and a back panel on
      // the left. You sit at +z (the drawers' fronts face +z).
      const wood = 0x5e4129, front = 0x6e4d31;
      g.add(box(1.4, 0.04, 0.7, 0x7a5636, 0, 0.73, 0));
      g.add(box(0.42, 0.71, 0.66, wood, 0.47, 0.355, 0));
      for (const y of [0.13, 0.36, 0.59]) {
        g.add(box(0.38, 0.2, 0.02, front, 0.47, y, 0.335));
        g.add(box(0.1, 0.02, 0.02, 0xb8b0a0, 0.47, y + 0.04, 0.35));
      }
      g.add(box(0.04, 0.71, 0.66, wood, -0.66, 0.355, 0));
      g.add(box(0.88, 0.4, 0.02, wood, -0.2, 0.5, -0.32));
      return g;
    }
    case "ottoman": {
      // A padded footstool on short legs.
      g.add(box(0.6, 0.3, 0.6, 0x7a5c48, 0, 0.27, 0));
      g.add(box(0.56, 0.04, 0.56, 0x8c6d58, 0, 0.44, 0));
      for (const x of [-0.25, 0.25]) for (const z of [-0.25, 0.25]) g.add(box(0.05, 0.12, 0.05, 0x3a2a1e, x, 0.06, z));
      return g;
    }
    case "bed": {
      // A queen bed: 1.52 x 2.03m mattress. The headboard is at -z; you get in from +z.
      g.add(box(1.62, 0.3, 2.13, 0x5b3a22, 0, 0.15, 0));
      g.add(box(1.52, 0.25, 2.03, 0xf2efe8, 0, 0.42, 0));
      g.add(box(1.56, 0.06, 1.4, 0x3d5a78, 0, 0.56, 0.33));
      g.add(box(1.56, 0.08, 0.3, 0xe8e4da, 0, 0.58, -0.25));
      for (const x of [-0.38, 0.38]) g.add(box(0.6, 0.12, 0.38, 0xffffff, x, 0.6, -0.76));
      g.add(box(1.7, 1.1, 0.08, 0x5b3a22, 0, 0.55, -1.1));
      return g;
    }
    case "lamp": {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.4), mat(0x2b2b2b)); pole.position.y = 0.7; g.add(pole);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.03), mat(0x2b2b2b)); base.position.y = 0.015; g.add(base);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.25, 20, 1, true), mat(0xf2e0b8, { emissive: 0xffcf8a, emissiveIntensity: 0.6, side: THREE.DoubleSide }));
      shade.position.y = 1.45; g.add(shade);
      const l = new THREE.PointLight(0xffd29a, 2.5, 4, 1.5); l.position.y = 1.4; g.add(l);
      return g;
    }
    case "desklamp": {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.02), mat(0x2b2b2b)); base.position.y = 0.01; g.add(base);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.3), mat(0x2b2b2b)); stem.position.y = 0.16; g.add(stem);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.12, 16, 1, true), mat(0x1f4f3a, { emissive: 0xffcf8a, emissiveIntensity: 0.3, side: THREE.DoubleSide }));
      shade.position.y = 0.33; g.add(shade);
      const l = new THREE.PointLight(0xffd29a, 1.2, 2, 1.5); l.position.y = 0.28; g.add(l);
      return g;
    }
    case "plant": {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.26, 16), mat(0x9a5a3a)); pot.position.y = 0.13; g.add(pot);
      for (let i = 0; i < 7; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(0x3f6b34));
        leaf.position.set(Math.sin(i) * 0.1, 0.38 + (i % 3) * 0.1, Math.cos(i * 1.7) * 0.1); g.add(leaf);
      }
      return g;
    }
    case "rug": {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.01, 40), mat(0x8a3a32)); r.scale.z = 0.65; r.position.y = 0.005; g.add(r);
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.012, 40), mat(0xc49a5a)); inner.scale.z = 0.65; inner.position.y = 0.006; g.add(inner);
      return g;
    }
    case "candle": {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 12), mat(0xf4ecd8)); c.position.y = 0.06; g.add(c);
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.035, 8), new THREE.MeshBasicMaterial({ color: 0xffc35a })); f.position.y = 0.14; g.add(f);
      f.userData.phase = Math.random() * 10; f.userData.h = 0.035; flames.push(f);
      const l = new THREE.PointLight(0xffb45a, 0.6, 1.5, 1.6); l.position.y = 0.16; g.add(l);
      return g;
    }
    // Screens with a job (the headset app gives them their page): drawn as a screen.
    case "gridscreen":
    case "notepad":
    case "browser":
    case "claude":
      return makeScreenFrame(THREE);
    default:
      return null;
  }
}

export const DECOR_KEYS = ["armchair", "swivelchair", "ottoman", "longtable", "smalltable", "desk", "keyboard", "tvframe", "recordplayer", "vhsplayer", "clock", "window", "couch", "bed", "lamp", "desklamp", "plant", "rug", "candle"];
