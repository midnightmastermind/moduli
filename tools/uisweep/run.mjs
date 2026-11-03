// tools/uisweep/run.mjs — npm run uisweep -- --area toolbar --vp desktop --skin terminal [--grid "poms rebuild"]
//   [--browser firefox] [--writes] [--only id,id] [--depth 2] [--report docs/ui-sweep-2026-11-03.md]
import path from "node:path";
import fs from "node:fs";
import { open } from "./session.mjs";
import { crawlSurface } from "./crawl.mjs";
import { SURFACES, rootFor } from "./surfaces.mjs";
import { appendRows } from "./report.mjs";
import { noSideScroll } from "./checks.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return acc;
}, []));
const vp = args.vp || "desktop";
const report = path.resolve(import.meta.dirname, "../..", args.report || "docs/ui-sweep-2026-11-03.md");
const only = args.only ? new Set(String(args.only).split(",")) : null;
const list = SURFACES.filter((s) => (!args.area || s.area === args.area) && (!only || only.has(s.id)) && (!s.vps || s.vps.includes(vp)));
if (!list.length) { console.log("no surfaces match"); process.exit(1); }

const s = await open({ vp, skin: args.skin === "default" ? null : (args.skin || null), grid: args.grid || "poms rebuild", allowWrites: !!args.writes, browser: args.browser || "chromium" });
await s.ready();
import { SITE } from "./session.mjs";
const ctx = { site: SITE };
const tag = `${vp}${args.skin ? "/" + args.skin : ""}${args.browser ? "/" + args.browser : ""}`;
for (const surface of list) {
  const t0 = Date.now();
  let rows = [];
  try {
    const live = { ...surface, open: async (p) => { await surface.open(p, ctx); live.root = rootFor(surface, ctx); }, skipRe: surface.skip };
    const crawl = () => crawlSurface(s.page, live, { vp, depth: Number(args.depth || 2), errors: s.errors, ctx });
    try { rows = await crawl(); }
    catch (e) {
      // A layer left by the previous surface can block this one's open: start clean once, then report.
      await s.page.reload({ waitUntil: "domcontentloaded" });
      await s.page.waitForFunction(() => !!document.querySelector("[data-panel-id]") && !document.querySelector('[data-testid="snapshot-pill"]'), null, { timeout: 180000 });
      await s.page.waitForTimeout(6000);
      rows = await crawl();
    }
    if (surface.skip) rows = rows.map((r) => (surface.skip.test(r.control) ? { ...r, works: "— skipped (by surface)" } : r));
    const side = await noSideScroll(s.page);
    if (!side.ok) rows.unshift({ id: surface.id, surface: surface.name, control: "(page)", vp: tag, works: "", reach: `✗ sideways scroll ${side.scrollWidth}px in ${side.width}`, a11y: "", clear: "", fast: "", notes: "" });
  } catch (e) {
    rows = [{ id: surface.id, surface: surface.name, control: "(open)", vp: tag, works: `✗ could not open: ${String(e.message).split("\n")[0].slice(0, 120)}` }];
  }
  rows = rows.map((r) => ({ ...r, vp: tag }));
  appendRows(report, rows);
  const dead = rows.filter((r) => /nothing|error|unreachable|could not/.test(r.works || "")).length;
  const reach = rows.filter((r) => /^⚠|✗/.test(r.reach || "")).length;
  const a11y = rows.filter((r) => /✗/.test(r.a11y || "")).length;
  console.log(`${surface.id} [${tag}] ${rows.length} rows · ${dead} dead/error · ${reach} reach · ${a11y} a11y · ${Math.round((Date.now() - t0) / 1000)}s`);
}
const blocked = await s.blocked();
console.log(`writes blocked this run: ${blocked.length}`);
await s.close();
