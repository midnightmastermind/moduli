// tools/uisweep/filterRun.mjs — the field matrix as a LOCAL FILTER on the Sweep Fields container's header.
// Per field: add the filter (Filter tab › Add local filter › Add filter › field › Save), find its picker at the top of
// the menu, drive it by widget kind (multi-pick / switch / input / arrows), read back what it shows and what it stored
// (the container's filterOverride), clear it, check the picker has a name, then remove the filter. The container ends
// with no local filters. Usage: node --env-file=server/.env tools/uisweep/filterRun.mjs [--vp desktop|phone] [--only v,v]
import fs from "node:fs";
import path from "node:path";
import { open } from "./session.mjs";
import { goTo } from "./surfaces.mjs";
import { appendRows } from "./report.mjs";
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => { if (x.startsWith("--")) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]); return a; }, []));
const vp = args.vp || "desktop";
const touch = vp !== "desktop";
const fx = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures.json"), "utf8"));
const only = args.only ? new Set(String(args.only).split(",")) : null;
const s = await open({ vp, grid: "poms rebuild", allowWrites: true });
await s.ready({ settleMs: 8000 });
await goTo(s.page, {}, "Sweep Fields", "BOARD PAGE");
const page = s.page;
const press = async (h) => { if (touch) await h.tap(); else await h.click(); };
const MENU = ".header-dropdown, .menu-surface";
const byText = (sel, re) => page.evaluateHandle(({ sel, src }) => [...document.querySelectorAll(sel)].find((b) => new RegExp(src).test((b.innerText || "").trim())) || null, { sel, src: re.source });
const stored = (fid) => page.evaluate(({ cid, fid }) => {
  const o = (window.__moduli_state__?.occurrences || []).find((x) => x.id === cid);
  return { override: o?.filterOverride?.[fid] ?? null, declared: !!(o?.filters || []).find((f) => f.fieldId === fid) };
}, { cid: fx.containerId, fid });

async function openMenu() {
  if (await page.$(MENU)) return true;
  const chev = await page.evaluateHandle((cid) => {
    const p = [...document.querySelectorAll("[data-panel-id]")].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1; });
    return (p || document).querySelector(`.container-shell[data-occ-id="${cid}"] .container-header .header-chevron`);
  }, fx.containerId);
  if (!chev.asElement()) return false;
  await press(chev.asElement()); await page.waitForTimeout(700);
  const tab = await byText(`:is(${MENU}) button`, /^Filter$/); if (tab.asElement()) { await press(tab.asElement()); await page.waitForTimeout(300); }
  return !!(await page.$(MENU));
}
async function addFilter(name) {
  const add = await byText(`:is(${MENU}) button`, /Add local filter/); if (!add.asElement()) return "no Add local filter";
  await press(add.asElement()); await page.waitForTimeout(600);
  const addF = await byText("button", /^Add filter$/); if (!addF.asElement()) { if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT }); return "no Add filter"; }
  await press(addF.asElement()); await page.waitForTimeout(500);
  const trig = await byText("button", /— field —/); if (!trig.asElement()) return "no field picker";
  await press(trig.asElement()); await page.waitForTimeout(500);
  await page.keyboard.type(name, { delay: 15 }); await page.waitForTimeout(500);
  const row = await page.evaluateHandle((n) => [...document.querySelectorAll('[data-radix-popper-content-wrapper] [role="option"], [data-radix-popper-content-wrapper] button')].find((b) => (b.innerText || "").split("\n")[0].trim() === n) || null, name);
  if (!row.asElement()) return "field not offered";
  await press(row.asElement()); await page.waitForTimeout(400);
  const save = await page.evaluateHandle(() => [...document.querySelectorAll("button")].reverse().find((b) => (b.innerText || "").trim() === "Save") || null);
  await press(save.asElement()); await page.waitForTimeout(1200);
  return null;
}
// The picker row at the top of the menu: the label "<Name>:" and the control beside it.
const picker = (name) => page.evaluateHandle(({ MENU, name }) => {
  const m = document.querySelector(MENU); if (!m) return null;
  const lab = [...m.querySelectorAll("span, label, div")].find((e) => e.children.length === 0 && (e.innerText || "").trim() === `${name}:`);
  let row = lab?.parentElement; for (let i = 0; i < 3 && row && !row.querySelector("button, input"); i++) row = row.parentElement;
  return row || null;
}, { MENU, name });
const kindOf = (row) => row.evaluate((r) => r.querySelector(".filter-multipick-btn") ? "multipick" : r.querySelector('[role="switch"]') ? "switch" : r.querySelector("input") ? "input" : r.querySelector('button[title="Next"], button[aria-label="Next"]') ? "arrows" : r.querySelector("button") ? "other" : "none");
const ctlName = (row, sel) => row.evaluate((r, sel) => { const c = r.querySelector(sel); if (!c) return ""; return c.getAttribute("aria-label") || (c.getAttribute("aria-labelledby") ? "labelledby" : "") || (c.closest("label") ? "label" : "") || ((c.innerText || "").trim() && c.tagName === "BUTTON" ? "text" : ""); }, sel);

async function removeFilter(name) {
  await openMenu();
  const row = await page.evaluateHandle(({ MENU, name }) => {
    const m = document.querySelector(MENU);
    const strong = [...(m?.querySelectorAll("strong") || [])].find((e) => (e.innerText || "").trim() === name);
    let r = strong; for (let i = 0; i < 4 && r && !r.querySelector('button[title="Remove this filter"]'); i++) r = r.parentElement;
    return r?.querySelector('button[title="Remove this filter"]') || null;
  }, { MENU, name });
  if (!row.asElement()) return false;
  await press(row.asElement()); await page.waitForTimeout(900);
  return true;
}

async function driveOne(variant, f) {
  const out = []; const step = (st, ok, note = "") => out.push({ step: st, ok, note });
  if (!(await openMenu())) { step("menu", false, "no header filter menu"); return out; }
  // A field an ancestor already filters is adjusted from its own row; the editor does not offer it.
  const inherited = await page.evaluate(({ MENU, name }) => { const t = document.querySelector(MENU)?.innerText || ""; const a = t.indexOf("ANCESTOR FILTERS"), l = t.indexOf("LOCAL FILTERS"); return a >= 0 && new RegExp(`(^|\\n)${name}( |\\n|=)`).test(t.slice(a, l < 0 ? undefined : l)); }, { MENU, name: f.name });
  const err = await addFilter(f.name);
  if (inherited) { step("not offered (an ancestor filters it)", err === "field not offered", err || "it was offered"); await page.keyboard.press("Escape"); const c = await byText("button", /^Cancel$/); if (c.asElement()) await press(c.asElement()); return out; }
  if (err) { step("add filter", false, err); return out; }
  if (!(await openMenu())) { step("menu", false, "menu closed after Save"); return out; }
  const st0 = await stored(f.id);
  step("declared", st0.declared, st0.declared ? "" : "the container carries no filter for it");
  const row = (await picker(f.name)).asElement();
  if (!row) { if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT }); step("picker shown", false, "no picker at the top of the menu: " + (await page.evaluate((M) => document.querySelector(M)?.innerText.replace(/\s+/g, " ").slice(0, 300), MENU))); await removeFilter(f.name); return out; }
  const kind = await kindOf(row);
  step("picker shown", kind !== "none", kind);
  if (kind === "multipick") {
    step("named", !!(await ctlName(row, ".filter-multipick-btn")), "");
    const btn = await row.$(".filter-multipick-btn"); await press(btn); await page.waitForTimeout(700);
    const opts = await page.$$('[data-radix-popper-content-wrapper] [role="option"], [data-radix-popper-content-wrapper] button');
    let picked = "";
    for (const o of opts) { const t = ((await o.innerText()) || "").trim(); if (t && !/^Clear|^Search/.test(t) && await o.isVisible()) { picked = t.split("\n")[0]; await press(o); break; } }
    await page.waitForTimeout(900);
    const st1 = await stored(f.id);
    const summary = await row.evaluate((r) => (r.querySelector(".filter-multipick-btn")?.innerText || "").trim());
    step("pick → shown + stored", !!picked && Array.isArray(st1.override) && st1.override.length === 1 && summary.includes(picked.slice(0, 6)), `"${picked}" → "${summary}" stored ${JSON.stringify(st1.override)}`);
    const clear = await byText('[data-radix-popper-content-wrapper] button', /^Clear/);
    if (clear.asElement()) { await press(clear.asElement()); await page.waitForTimeout(900); } else await page.keyboard.press("Escape");
    const st2 = await stored(f.id);
    step("clear → [] (not off)", Array.isArray(st2.override) && st2.override.length === 0, JSON.stringify(st2.override));
  } else if (kind === "switch") {
    step("named", !!(await ctlName(row, '[role="switch"]')), "the switch has no accessible name");
    const sw = await row.$('[role="switch"]');
    await press(sw); await page.waitForTimeout(700);
    const a = await sw.getAttribute("aria-checked"); const st1 = await stored(f.id);
    step("on → shown + stored", a === "true" && (st1.override === true || st1.override === "true"), `aria ${a}, stored ${JSON.stringify(st1.override)}`);
    await press(sw); await page.waitForTimeout(700);
    const st2 = await stored(f.id);
    step("off → stored false", (await sw.getAttribute("aria-checked")) === "false" && (st2.override === false || st2.override === "false"), JSON.stringify(st2.override));
  } else if (kind === "input") {
    step("named", !!(await ctlName(row, "input")), "the box has no accessible name");
    const inp = await row.$("input");
    const v = f.type === "number" ? "7" : "sweep";
    await press(inp); await page.keyboard.type(v); await page.waitForTimeout(900);
    const st1 = await stored(f.id);
    step("type → stored", String(st1.override) === v, JSON.stringify(st1.override));
    await inp.fill(""); await page.waitForTimeout(900);
    const st2 = await stored(f.id);
    step("clear → stored empty", st2.override === "" || st2.override == null, JSON.stringify(st2.override));
  } else if (kind === "arrows") {
    const label = () => row.evaluate((r) => (r.innerText || "").replace(/\s+/g, " ").trim());
    const before = await label();
    const next = await row.$('button[title="Next"], button[aria-label="Next"]'); await press(next); await page.waitForTimeout(800);
    const mid = await label(); const st1 = await stored(f.id);
    step("next → shown + stored", mid !== before && st1.override != null, `"${before}" → "${mid}" stored ${JSON.stringify(st1.override)}`);
    const prev = await row.$('button[title="Prev"], button[aria-label="Prev"], button[title="Previous"]'); if (prev) { await press(prev); await page.waitForTimeout(800); }
    step("prev → back", (await label()) === before, await label());
  } else step("drive", false, `no driver for "${kind}"`);
  const removed = await removeFilter(f.name);
  const st3 = await stored(f.id);
  step("remove → gone", removed && !st3.declared && st3.override == null, `declared ${st3.declared}, override ${JSON.stringify(st3.override)}`);
  return out;
}

const rows = [];
for (const [variant, f] of Object.entries(fx.fields)) {
  if (only && !only.has(variant)) continue;
  if (!f.inputEnabled || f.type === "button" || variant.endsWith("/display")) continue;
  let res;
  try { res = await driveOne(variant, f); } catch (e) { res = [{ step: "drive", ok: false, note: String(e.message).split("\n")[0].slice(0, 160) }]; await page.keyboard.press("Escape").catch(() => {}); await removeFilter(f.name).catch(() => {}); }
  await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(300);
  const bad = res.filter((r) => !r.ok);
  rows.push({ id: `field.${variant}@filterNav`, surface: "Field matrix · local filter picker", control: `${f.name} (${variant})`, vp,
    works: bad.length ? `✗ ${bad.map((b) => `${b.step}: ${b.note}`).join("; ")}` : `✅ ${res.map((r) => r.step).join(", ")}`, reach: "", a11y: "", clear: "", fast: "", notes: res.filter((r) => r.ok && r.note).map((r) => `${r.step}: ${r.note}`).join("; ").slice(0, 200) });
  console.log(rows.at(-1).control, "→", rows.at(-1).works.slice(0, 220));
}
const left = await page.evaluate((cid) => ((window.__moduli_state__?.occurrences || []).find((x) => x.id === cid)?.filters || []).length, fx.containerId);
console.log("local filters left on the container:", left);
appendRows(path.resolve(import.meta.dirname, "../../docs/ui-sweep-2026-11-03.md"), rows);
await s.close();
