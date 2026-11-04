// tools/uisweep/matrixRun.mjs — npm run uisweep:matrix -- --vp desktop|phone [--writes]
import fs from "node:fs";
import path from "node:path";
import { open } from "./session.mjs";
import { goTo } from "./surfaces.mjs";
import { driveRowPill } from "./fieldMatrix.mjs";
import { appendRows } from "./report.mjs";
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => { if (x.startsWith("--")) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]); return a; }, []));
const vp = args.vp || "desktop";
const fx = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures.json"), "utf8"));
const s = await open({ vp, grid: "poms rebuild", allowWrites: !!args.writes, skin: args.skin || null });
await s.ready({ settleMs: 8000 });
const ctx = {};
await goTo(s.page, ctx, "Sweep Fields", "BOARD PAGE");
if (process.env.SHOT) await s.page.screenshot({ path: process.env.SHOT });
// The row in the panel ON SCREEN: on a phone the other cells are laid out beside it, and two can show the same page.
const onScreen = await s.page.evaluate(() => [...document.querySelectorAll("[data-panel-id]")].find((p) => { const r = p.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1 && r.top < innerHeight; })?.getAttribute("data-panel-id"));
const rowSel = `${onScreen ? `[data-panel-id="${onScreen}"] ` : ""}[data-occurrence-id="${fx.rowId}"]`;
const rows = [];
const only = args.only ? new Set(String(args.only).split(",")) : null;
for (const [variant, f] of Object.entries(fx.fields)) {
  if (only && !only.has(variant)) continue;
  const res = await driveRowPill(s.page, rowSel, variant, f, { touch: vp !== "desktop" });
  const bad = res.filter((r) => !r.ok);
  const ms = Math.max(0, ...res.map((r) => r.ms || 0));
  rows.push({ id: `field.${variant}@rowPill`, surface: "Field matrix · row pill", control: `${f.name} (${variant})`, vp: `${vp}${args.skin ? "/" + args.skin : ""}`,
    works: bad.length ? `✗ ${bad.map((b) => `${b.step}: ${b.note}`).join("; ")}` : `✅ ${res.map((r) => r.step).join(", ")}`, reach: "", a11y: "", clear: "", fast: ms ? `${ms}ms` : "", notes: res.filter((r) => r.ok && r.note).map((r) => `${r.step}: ${r.note}`).join("; ").slice(0, 200) });
  console.log(rows.at(-1).control, "→", rows.at(-1).works.slice(0, 160));
}
appendRows(path.resolve(import.meta.dirname, "../../docs/ui-sweep-2026-11-03.md"), rows);
await s.close();
