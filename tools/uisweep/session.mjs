// tools/uisweep/session.mjs — open Moduli the way the sweep needs it.
//
// open({ vp, throttle, skin, grid, allowWrites, browser, localBuild }) → { browser, context, page, ready(), blocked(), sent() }
//   vp          "desktop" 1440x900 · "phone" 390x844 · "phone-land" 844x390 (phone ones: touch, isMobile, DPR 3)
//   throttle    CPU slowdown (CDP, Chromium only). Default 4 on a phone, 1 on desktop.
//   skin        a skin id ("terminal", "moduli-dark" …) or null = the grid's own. Forced by rewriting the grid's
//               `meta.skin` in the frames the server sends (the grid's saved skin outranks localStorage, and the
//               sweep must not write the grid to change it).
//   grid        a grid NAME. Auth is minted for that grid's owner (needs server/.env: run with --env-file).
//   allowWrites false = every socket write is dropped (writeGuard); true = sent, and still counted.
//   localBuild  a dist dir to serve the page + /assets from, against prod's server.
import { chromium, firefox } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { guardScript } from "./writeGuard.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  "phone-land": { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
};
export const SITE = process.env.UISWEEP_SITE || "https://viafluere.com";

/** Mint a session token for the owner of the grid named `name`. */
export async function mintAuth(name) {
  const { default: mongoose } = await import(path.join(ROOT, "server/node_modules/mongoose/index.js"));
  const { default: jwt } = await import(path.join(ROOT, "server/node_modules/jsonwebtoken/index.js"));
  if (!process.env.MONGO_URI && !process.env.MONGODB_URI) throw new Error("run with --env-file=server/.env");
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  try {
    const grid = await mongoose.connection.db.collection("grids").findOne({ name });
    if (!grid) throw new Error(`no grid named "${name}"`);
    const token = jwt.sign({ userId: String(grid.userId) }, process.env.JWT_SECRET || "SUPER_SECRET", { expiresIn: "12h" });
    return { token, userId: String(grid.userId), gridId: String(grid._id), protectedGrid: !!grid.meta?.protected };
  } finally { await mongoose.disconnect(); }
}

/** The init script that forces a skin by rewriting `"skin":"…"` in the server's grid frames. */
export function skinScript(skin) {
  if (!skin) return "";
  return `(() => {
  const desc = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data");
  Object.defineProperty(MessageEvent.prototype, "data", { configurable: true, get() {
    const d = desc.get.call(this);
    if (typeof d === "string" && /^42\\["(full_state|grid_updated)"/.test(d)) return d.replace(/"skin":"[a-z0-9-]+"/g, ${JSON.stringify(`"skin":"${skin}"`)});
    return d;
  } });
  try { localStorage.setItem("moduli-skin", ${JSON.stringify(skin)}); } catch {}
})();`;
}

export async function open({ vp = "desktop", throttle, skin = null, grid = "poms rebuild", allowWrites = false,
  browser: which = "chromium", localBuild = process.env.LOCALBUILD } = {}) {
  const A = await mintAuth(grid);
  if (allowWrites && A.protectedGrid) throw new Error(`REFUSED: "${grid}" is a protected grid — writes are never allowed there`);
  const browser = await (which === "firefox" ? firefox : chromium).launch({ headless: true });
  const context = await browser.newContext({ ...VIEWPORTS[vp], ...(localBuild ? { serviceWorkers: "block" } : {}) });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.addInitScript((a) => {
    // Init scripts run in every frame too, and a sandboxed one (a bookmark's page) has no localStorage.
    try { localStorage.setItem("moduli-token", a.token); localStorage.setItem("moduli-userId", a.userId); localStorage.setItem("moduli-gridId", a.gridId); } catch {}
  }, A);
  await page.addInitScript(guardScript(allowWrites));
  if (skin) await page.addInitScript(skinScript(skin));
  if (localBuild) {
    const mime = (f) => /\.m?js$/.test(f) ? "application/javascript" : f.endsWith(".css") ? "text/css" : f.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
    await page.route(new RegExp(`^${SITE.replace(/[.]/g, "\\.")}/(\\?.*)?$`), (r) => r.fulfill({ status: 200, contentType: "text/html", body: fs.readFileSync(`${localBuild}/index.html`) }));
    await page.route(new RegExp(`^${SITE.replace(/[.]/g, "\\.")}/assets/`), (r) => {
      const f = `${localBuild}${new URL(r.request().url()).pathname}`;
      return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: mime(f), body: fs.readFileSync(f) }) : r.continue();
    });
  }
  const rate = throttle ?? (vp === "desktop" ? 1 : 4);
  if (rate > 1 && which === "chromium") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  }
  await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded" });

  let readyDone = false;
  async function ready({ settleMs = 12000 } = {}) {
    if (readyDone) return;
    await page.waitForFunction(() => !!document.querySelector("[data-panel-id]") || /workspace is empty/i.test(document.body.innerText), null, { timeout: 300000 });
    // The boot snapshot is a read-only copy that HOLDS clicks: a crawl before it is gone reads every button as dead.
    await page.waitForFunction(() => !document.querySelector('[data-testid="snapshot-pill"]'), null, { timeout: 180000 });
    await page.waitForTimeout(settleMs);
    readyDone = true;
  }
  return {
    browser, context, page, auth: A, errors, ready,
    isReady: () => readyDone,
    blocked: () => page.evaluate(() => window.__blockedWrites || []),
    sent: () => page.evaluate(() => window.__sentWrites || []),
    close: () => browser.close(),
  };
}
