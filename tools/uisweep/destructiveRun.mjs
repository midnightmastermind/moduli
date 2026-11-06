// tools/uisweep/destructiveRun.mjs — what the crawl skips (sweep Task 9), once each, for real, on test grid 2.
// Each case: its own fixture -> press the control -> read Mongo -> one undo -> read Mongo, compare with before.
//   node --env-file=server/.env tools/uisweep/destructiveRun.mjs [--vp phone] [--only rowDelete,keepKids]
import { execFileSync } from "node:child_process";
import mongoose from "../../server/node_modules/mongoose/index.js";
import { open, SITE } from "./session.mjs";
import { goTo, mainPanel, openPhoneMenu } from "./surfaces.mjs";

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const VP = arg("vp") || "desktop", ONLY = arg("only")?.split(","), GRIDNAME = "test grid 2", PAGE = "ZZ Destruct";
await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
let db = mongoose.connection.db;
const grid = await db.collection("grids").findOne({ name: GRIDNAME }); const GRID = String(grid._id); const ROOT = `usr-root-${GRID}`;
const email = (await db.collection("users").findOne({ _id: new mongoose.Types.ObjectId(String(grid.userId)) }))?.email;
const out = execFileSync("node", ["--env-file=server/.env", "server/scripts/createApiToken.js", email, "read,write", "uisweep destructive", "--no-env"], { encoding: "utf8" });
const TOKEN = (out.match(/^\s+(moduli_\S+)\s*$/m) || [])[1]; if (!TOKEN) throw new Error("no token");
const api = async (m, p, b) => { const r = await fetch(`${SITE}/api/v1${p}`, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${JSON.stringify(j).slice(0, 160)}`); return j; };
const made = new Set(); const madeMods = new Set();
const mint = async (role, kind, label, parentId, extra = {}) => { const m = await api("POST", "/modules", { gridId: GRID, role, kind, label, ...(extra.module || {}) }); madeMods.add(m.module.id); const o = await api("POST", "/occurrences", { gridId: GRID, moduleId: m.module.id, parentId, ...(extra.occ || {}) }); made.add(o.occurrence.id); return o.occurrence.id; };

const pageId = await mint("page", "board", PAGE, ROOT);
const IGN = (o) => o && { id: o.id, parentId: o.parentId ?? null, label: o.label ?? null, moduleId: o.moduleId, kids: o.occurrences || [], lg: o.linkedGroupId ?? null, lock: o.meta?.lockedInPlace ?? null, mode: o.dragMode ?? null, table: o.meta?.table ?? null, fields: o.fields || {} };
const snap = async (ids) => { const out = {}; for (const id of ids) { const o = await db.collection("occurrences").findOne({ id }); const c = IGN(o); if (c && c.moduleId) c.module = !!(await db.collection("modules").findOne({ id: c.moduleId })); out[id] = c || null; } return out; };
const same = (a, b) => { const diff = []; for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diff.push(k.slice(0, 8)); return diff; };

const s = await open({ vp: VP, grid: GRIDNAME, allowWrites: true }); const page = s.page; await s.ready({ settleMs: 8000 });
if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI); // open() closes it
db = mongoose.connection.db;
const phone = VP === "phone"; const ctx = {};
const press = async (loc, what = "") => { try { if (phone) await loc.tap({ timeout: 6000 }); else await loc.click({ timeout: 6000 }); } catch (e) { const l = String(e.message).split("\n").filter((x) => /intercepts|waiting for|not visible|outside/.test(x)).slice(-1)[0] || ""; throw new Error(`press ${what}: ${l.replace(/\u001b\[[0-9;]*m/g, "").trim().slice(0, 170)}`); } };
const showPage = async () => { await goTo(page, ctx, PAGE, "board").catch(() => {}); await page.waitForTimeout(1500); };
const radial = async (sel, title) => { const h = page.locator(`${sel} button.radial-handle`).first(); await h.scrollIntoViewIfNeeded(); await press(h, "handle"); await page.waitForTimeout(500); const titles = await page.locator(".radial-menu-items button").evaluateAll((bs) => bs.map((b) => b.title || b.getAttribute("aria-label"))); const it = page.locator(`.radial-menu-items button[title="${title}"]`).first(); if (!(await it.count())) throw new Error(`no "${title}" in [${titles.join(", ")}]`); await press(it, title); await page.waitForTimeout(400); };
const dialog = async () => page.evaluate(() => { const d = document.querySelector("[data-choice-dialog], [role=alertdialog], [role=dialog]"); return d ? [...d.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean) : []; });
const choose = async (re) => { const b = page.locator("[data-choice-dialog] button, [role=alertdialog] button, [role=dialog] button").filter({ hasText: re }).first(); await press(b, "dialog"); };
const undo = async () => { await page.waitForTimeout(1200); if (phone) { await openPhoneMenu(page); await page.waitForTimeout(400); await press(page.locator('[data-toolbar-drawer] button[title^="Undo"], [data-toolbar-drawer] button[aria-label^="Undo"]').first()); await page.waitForTimeout(400); await page.keyboard.press("Escape"); } else { await page.evaluate(() => document.activeElement?.blur?.()); await page.keyboard.press("Control+z"); } await page.waitForTimeout(3500); };
const row = (id) => `.instance-wrap[data-occurrence-id="${id}"]`, ctr = (id) => `.container-shell[data-occ-id="${id}"]`;
const onScreen = (id) => page.evaluate((id) => { const e = document.querySelector(`[data-panel-id] [data-occurrence-id="${id}"], [data-panel-id] [data-occ-id="${id}"]`); return !!e; }, id);

const results = [];
async function run(name, build, act, check) {
  if (ONLY && !ONLY.includes(name)) return;
  const r = { name, confirm: "", done: "", undo: "", screen: "", notes: "" };
  try {
    const f = await build(); await page.waitForTimeout(1200);
    await showPage(); await page.waitForTimeout(500);
    const before = await snap(f.ids);
    r.confirm = (await act(f, r)) || "";
    await page.waitForTimeout(2500);
    const mid = await snap(f.ids);
    const chk = await check(f, mid, before); r.done = chk === true ? "ok" : `WRONG: ${chk}`;
    await undo();
    const after = await snap(f.ids);
    const d = same(before, after); r.undo = d.length ? `NOT RESTORED: ${d.map((k) => { const key = Object.keys(before).find((x) => x.slice(0, 8) === k); return `${before[key]?.label || k}: ${JSON.stringify(before[key]).slice(0, 110)} -> ${JSON.stringify(after[key]).slice(0, 110)}`; }).join(" ;; ")}` : "exact";
    if (f.visible) { await page.waitForTimeout(500); const vis = []; for (const id of f.visible) vis.push(await onScreen(id)); r.screen = vis.every(Boolean) ? "back" : `missing ${vis.filter((x) => !x).length}/${vis.length}`; }
  } catch (e) { r.notes = `FAILED: ${String(e.message).split("\n")[0].slice(0, 200)}`; }
  await page.keyboard.press("Escape").catch(() => {}); await page.keyboard.press("Escape").catch(() => {});
  results.push(r); console.log(JSON.stringify(r));
}
const board = async (label, rows) => { const c = await mint("container", "board", label, pageId); const ids = []; for (const n of rows) ids.push(await mint("instance", undefined, n, c)); return { c, rows: ids }; };

await run("rowDelete", async () => { const b = await board("D row", ["R1", "R2", "R3"]); return { ...b, ids: [b.c, ...b.rows], visible: b.rows }; },
  async (f) => { await radial(row(f.rows[1]), "Delete"); await page.waitForTimeout(500); const d = await dialog(); if (d.length) { await choose(/^Delete/); return `asked: ${d.join(" / ")}`; } return "no question"; },
  async (f, m) => (m[f.rows[1]] === null && !m[f.c].kids.includes(f.rows[1]) && !!m[f.rows[0]] && !!m[f.rows[2]]) || `row ${!!m[f.rows[1]]}, kids ${m[f.c].kids.length}`);
await run("keepKids", async () => { const b = await board("D keep", ["K1", "K2"]); return { ...b, ids: [pageId, b.c, ...b.rows], visible: [b.c, ...b.rows] }; },
  async (f) => { await radial(ctr(f.c), "Remove"); const d = await dialog(); await choose(/^Keep/); return `asked: ${d.join(" / ")}`; },
  async (f, m) => (m[f.c] === null && f.rows.every((id) => m[id] && m[id].parentId === pageId && m[pageId].kids.includes(id))) || `c ${!!m[f.c]} (kids ${m[f.c]?.kids?.length}) page ${pageId.slice(0, 6)} rows ${f.rows.map((id) => m[id]?.parentId?.slice(0, 6))} pageKids ${m[pageId].kids.length}`);
await run("deleteKids", async () => { const b = await board("D all", ["A1", "A2"]); return { ...b, ids: [pageId, b.c, ...b.rows], visible: [b.c, ...b.rows] }; },
  async (f) => { await radial(ctr(f.c), "Remove"); const d = await dialog(); await choose(/^Delete all/); return `asked: ${d.join(" / ")}`; },
  async (f, m) => (m[f.c] === null && f.rows.every((id) => m[id] === null)) || `c ${!!m[f.c]} rows ${f.rows.map((id) => !!m[id])}`);
await run("breakLink", async () => { const c = await mint("container", "board", "D link", pageId); const lg = `lg-${Date.now()}`; const a = await mint("instance", undefined, "L1", c, { occ: { linkedGroupId: lg } }); const srcMod = (await db.collection("occurrences").findOne({ id: a })).moduleId; const o = await api("POST", "/occurrences", { gridId: GRID, moduleId: srcMod, parentId: c, linkedGroupId: lg }); made.add(o.occurrence.id); return { c, a, b: o.occurrence.id, ids: [a, o.occurrence.id], visible: [a, o.occurrence.id] }; },
  async (f) => { await radial(row(f.b), "Break Link"); const d = await dialog(); return d.length ? `asked: ${d.join(" / ")}` : "no question"; },
  async (f, m) => (m[f.b].lg === null && !!m[f.a].lg) || `b ${m[f.b].lg} a ${m[f.a].lg}`);
await run("lockInPlace", async () => { const b = await board("D lock", ["Lk"]); return { ...b, ids: b.rows, visible: b.rows }; },
  async (f) => { await radial(row(f.rows[0]), "Lock position (copy only)").catch(async (e) => { throw e; }); return "no question"; },
  async (f, m) => m[f.rows[0]].lock === true || `lock ${m[f.rows[0]].lock}`);
await run("removeColumn", async () => { const cols = ["A", "B", "C"].map((t, i) => ({ id: `tc${i}`, title: t, width: 120 })); const c = await mint("container", "table", "D table", pageId, { occ: { meta: { table: { columns: cols, rowCount: 2, cells: { "0:1": "keepme" } } } } }); return { c, ids: [c], visible: [c] }; },
  async (f) => { const th = page.locator(`${ctr(f.c)} .table-th`).nth(1); await th.hover().catch(() => {}); const k = th.locator("button.table-th-kebab, .table-th-actions button").last(); await k.waitFor({ timeout: 3000 }); await press(k, "kebab"); await page.waitForTimeout(400); if (process.env.OUT) await page.screenshot({ path: `${process.env.OUT}/colmenu.png` }); const it = page.locator('button[title="Remove column"], [role=menuitem]:has-text("Remove column"), button:has-text("Remove column"), button:has-text("Delete column")').first(); await press(it, "remove column"); await page.waitForTimeout(400); const d = await dialog(); return d.length ? `asked: ${d.join(" / ")}` : "no question"; },
  async (f, m) => (m[f.c].table.columns.length === 2) || `cols ${m[f.c].table.columns.length}`);
const treeRow = async (name) => { const pid = await mainPanel(page, ctx); const P = `[data-panel-id="${pid}"]`; if (!(await page.$(`${P} .manifest-row`))) { await press(page.locator(`${P} button.panel-files-btn`)); await page.waitForTimeout(800); }
  for (let i = 0; i < 6; i++) { const l = page.locator(`${P} .manifest-row`).filter({ hasText: name }).first(); if (await l.count()) return l; if (i === 0) { const r = page.locator(`${P} .manifest-row`).filter({ hasText: /^Root$/ }).first(); if (await r.count()) { await r.locator("button, svg").first().click({ force: true }).catch(() => {}); await page.waitForTimeout(700); } } await page.waitForTimeout(300); }
  throw new Error(`no tree row ${name}; rows: ${(await page.locator(`${P} .manifest-row`).allInnerTexts()).map((x) => x.split("\n")[0]).slice(0, 40).join(",")}`.slice(0, 500)); };
const ctxItem = async (loc, label) => { const b = await loc.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: "right" }); await page.waitForTimeout(400); await page.locator(".menu-surface").getByText(label, { exact: true }).first().click({ timeout: 4000 }); await page.waitForTimeout(400); };
if (!phone) {
  await run("pageDelete", async () => { const p = await mint("page", "board", "ZZ Doomed Page", ROOT); const c = await mint("container", "board", "Doomed C", p); const k = await mint("instance", undefined, "Doomed R", c); return { p, c, k, ids: [p, c, k] }; },
    async (f) => { const l = await treeRow("ZZ Doomed Page"); await ctxItem(l, "Delete page"); const d = await dialog(); await choose(/^Delete/); return `asked: ${d.join(" / ")}`; },
    async (f, m) => (m[f.p] === null && m[f.c] === null && m[f.k] === null) || `p ${!!m[f.p]} c ${!!m[f.c]} k ${!!m[f.k]}`);
}
console.log("\nSUMMARY"); for (const r of results) console.log(`${r.name.padEnd(13)} ${r.confirm.padEnd(46).slice(0, 46)} done:${r.done.slice(0, 30).padEnd(14)} undo:${r.undo.slice(0, 26).padEnd(10)} screen:${r.screen} ${r.notes}`);
console.log("page errors", s.errors.length, s.errors.slice(0, 2).join(" | ").slice(0, 200));
await s.close();
if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
db = mongoose.connection.db;
// clean up through the API (Mongo, warm cache, parent lists), then say what is left
for (const id of [...made].reverse()) await fetch(`${SITE}/api/v1/occurrences/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } }).catch(() => {});
for (const id of madeMods) await fetch(`${SITE}/api/v1/modules/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } }).catch(() => {});
const left = await db.collection("occurrences").countDocuments({ id: { $in: [...made] } }); const leftM = await db.collection("modules").countDocuments({ id: { $in: [...madeMods] } }); console.log("modules left", leftM);
const dm = await db.collection("apitokens").deleteMany({ name: "uisweep destructive" }).catch(() => ({ deletedCount: "?" }));
console.log("probe rows left", left, "tokens revoked", dm.deletedCount);
await mongoose.disconnect(); process.exit(0);
