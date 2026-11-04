// tools/uisweep/pickerRun.mjs — the field matrix in the ADD-ITEM FIELD PICKER (+ › Item), where every typeable field
// draws the full-size, non-compact `Field` (the same control a button's form uses). Nothing is created: the run ticks a
// field (only when it is not ticked already — the picker pre-ticks the siblings' fields), drives its control, reads the
// control back, and leaves with Skip/Escape. Usage: node --env-file=server/.env tools/uisweep/pickerRun.mjs [--vp ..] [--only v,v]
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
const s = await open({ vp, grid: "poms rebuild", skin: args.skin || null });
await s.ready({ settleMs: 8000 });
await goTo(s.page, {}, "Sweep Fields", "BOARD PAGE");
const page = s.page;
const OPT = '[role="option"], [data-radix-popper-content-wrapper] button, .occ-search-row';
const press = async (h) => { if (touch) await h.tap(); else await h.click(); };

async function openPicker() {
  const plus = await page.evaluateHandle((cid) => {
    const p = [...document.querySelectorAll("[data-panel-id]")].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1; });
    return (p || document).querySelector(`.container-shell[data-occ-id="${cid}"] .container-header .quick-add-btn`);
  }, fx.containerId);
  await press(plus.asElement()); await page.waitForTimeout(600);
  const item = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => /^Item\b/.test((b.innerText || "").trim())));
  await press(item.asElement()); await page.waitForTimeout(700);
}
const rowOf = (name) => page.evaluateHandle((name) => [...document.querySelectorAll("button[title]")].find((b) => b.title === name)?.parentElement || null, name);
const ticked = (name) => page.evaluate((name) => !![...document.querySelectorAll("button[title]")].find((b) => b.title === name)?.querySelector("svg"), name);
const ctlText = (row) => row.evaluate((r) => (r.children[1]?.innerText || "").replace(/\s+/g, " ").trim());
// Close the layers a control opened — never the picker itself (it is a layer too, and Escape closes it).
const pickerOpen = () => page.evaluate(() => !![...document.querySelectorAll("div")].find((d) => /^Pick fields to attach/.test((d.innerText || "").trim()) && d.children.length === 0));
async function closeLayers() {
  for (let i = 0; i < 3; i++) {
    const n = await page.evaluate(() => [...document.querySelectorAll('[data-radix-popper-content-wrapper], [role="dialog"]')].filter((l) => !/Pick fields to attach/.test(l.innerText || "")).length);
    if (!n) break;
    await page.keyboard.press("Escape"); await page.waitForTimeout(250);
  }
  if (!(await pickerOpen())) { await openPicker(); }
}

async function driveOne(variant, f) {
  const out = []; const step = (s, ok, note = "") => out.push({ step: s, ok, note });
  await page.evaluate((name) => { const b = [...document.querySelectorAll("button[title]")].find((x) => x.title === name); b?.scrollIntoView({ block: "center" }); }, f.name);
  if (!(await ticked(f.name))) { const b = await page.evaluateHandle((name) => [...document.querySelectorAll("button[title]")].find((x) => x.title === name), f.name); if (!b.asElement()) { step("listed", false, "not in the picker"); return out; } await press(b.asElement()); await page.waitForTimeout(400); }
  const row = (await rowOf(f.name)).asElement();
  const hasCtl = await row.evaluate((r) => !!r.children[1]?.querySelector("input, textarea, button, [role=switch], [role=combobox]"));
  const type = f.type;
  if (process.env.DUMP) console.log("DUMP", f.name, await row.evaluate((r) => (r.children[1]?.outerHTML || "").replace(/class="[^"]*"/g, "").replace(/style="[^"]*"/g, "").replace(/<svg.*?<\/svg>/g, "<svg/>").slice(0, 600)));
  if (!f.inputEnabled || type === "button" || variant.endsWith("/display")) { step("no input offered", !hasCtl, hasCtl ? "a control is offered for a field that takes no input" : ""); return out; }
  if (!hasCtl) { step("control", false, "ticked but no control"); return out; }
  const ctl = await row.evaluateHandle((r) => r.children[1]);
  if (type === "text" || type === "number" || type === "markdown") {
    const inp = await ctl.evaluateHandle((c) => c.querySelector("textarea, input:not([type=checkbox])"));
    const val = type === "number" ? "7" : "sweep 1";
    await press(inp.asElement()); await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A"); await page.keyboard.type(val); await page.keyboard.press("Tab"); await page.waitForTimeout(300);
    const got = await inp.evaluate((e) => e.value);
    step("set → kept", got === val, `"${got}"`);
  } else if (type === "boolean") {
    const sw = await ctl.evaluateHandle((c) => c.querySelector('button.peer, [role="switch"], [role="checkbox"], input[type=checkbox]'));
    const st = () => sw.evaluate((e) => e.getAttribute("aria-checked") ?? e.getAttribute("data-state") ?? String(e.checked));
    const a = await st(); await press(sw.asElement()); await page.waitForTimeout(250); const b = await st();
    step("toggle", a !== b, `${a}→${b}`);
    const named = await sw.evaluate((e) => !!(e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || e.closest("label")));
    step("named", named, named ? "" : "switch has no accessible name");
  } else if (type === "select" || type === "occurrence") {
    const before = await ctlText(row);
    const trig = await ctl.evaluateHandle((c) => c.querySelector("button, [role=combobox]"));
    await press(trig.asElement()); await page.waitForTimeout(700);
    const opts = await page.$$(OPT);
    let picked = null;
    for (const o of opts) { const t = ((await o.innerText()) || "").trim(); if (t && !/^\+|add new|^—$|^none$/i.test(t) && (await o.isVisible())) { picked = t.split("\n")[0]; await press(o); break; } }
    step("opens list", opts.length > 0, `${opts.length} options`);
    await page.waitForTimeout(500); await closeLayers();
    const after = await ctlText(row);
    step("pick → shown", !!picked && after !== before && after.includes(picked.slice(0, 8)), `"${before}" → "${after}" (picked "${picked}")`);
  } else if (type === "date") {
    const inp = await ctl.evaluateHandle((c) => c.querySelector("input[type=date]"));
    if (!inp.asElement()) { step("date input", false, "no date input"); return out; }
    await inp.evaluate((e, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, v); e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, "2026-11-04");
    await page.waitForTimeout(300);
    step("set → kept", (await inp.evaluate((e) => e.value)) === "2026-11-04", await inp.evaluate((e) => e.value));
  } else if (type === "duration") {
    const ins = await ctl.$$("input");
    if (ins.length >= 2) { await ins[0].fill("1"); await ins[1].fill("30"); await page.keyboard.press("Tab"); await page.waitForTimeout(300); const v = [await ins[0].inputValue(), await ins[1].inputValue()]; step("set h+m → kept", v[0] === "1" && v[1] === "30", v.join(":")); }
    else if (ins.length === 1) { await ins[0].fill("90"); await page.keyboard.press("Tab"); await page.waitForTimeout(300); step("set → kept", (await ins[0].inputValue()) === "90", await ins[0].inputValue()); }
    else step("inputs", false, "no duration input");
  } else if (type === "rating") {
    const stars = await ctl.$$("button");
    if (stars.length < 3) { step("stars", false, `${stars.length} buttons`); return out; }
    await press(stars[2]); await page.waitForTimeout(250);
    const pressed = await stars[2].evaluate((e) => e.getAttribute("aria-pressed"));
    const label = await stars[2].evaluate((e) => e.getAttribute("aria-label") || "");
    step("3 stars → shown", pressed === "true", `aria-pressed=${pressed}`);
    step("stars named", /3 of/.test(label), label || "unnamed");
  } else if (type === "address" || type === "when") {
    const b = await ctl.evaluateHandle((c) => c.querySelector("button"));
    await press(b.asElement()); await page.waitForTimeout(700);
    const opened = await page.evaluate(() => !!document.querySelector('[role="dialog"]:not([data-testid]), [data-radix-popper-content-wrapper]'));
    step("opens its picker", opened);
    await closeLayers();
  } else step("type", false, `no driver for ${type}`);
  return out;
}

await openPicker();
const rows = [];
for (const [variant, f] of Object.entries(fx.fields)) {
  if (only && !only.has(variant)) continue;
  let res;
  if (!(await pickerOpen())) await openPicker();
  try { res = await driveOne(variant, f); } catch (e) { res = [{ step: "drive", ok: false, note: String(e.message).split("\n")[0].slice(0, 160) }]; await closeLayers(); }
  const bad = res.filter((r) => !r.ok);
  rows.push({ id: `field.${variant}@quickAddPicker`, surface: "Field matrix · add-item picker", control: `${f.name} (${variant})`, vp: `${vp}${args.skin ? "/" + args.skin : ""}`,
    works: bad.length ? `✗ ${bad.map((b) => `${b.step}: ${b.note}`).join("; ")}` : `✅ ${res.map((r) => r.step).join(", ")}`, reach: "", a11y: "", clear: "", fast: "", notes: res.filter((r) => r.ok && r.note).map((r) => `${r.step}: ${r.note}`).join("; ").slice(0, 200) });
  console.log(rows.at(-1).control, "→", rows.at(-1).works.slice(0, 200));
}
// Leave without creating anything.
const skip = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "Skip"));
const createdBefore = await page.evaluate((cid) => (window.__moduli_state__?.occurrences || []).find((o) => o.id === cid)?.occurrences?.length, fx.containerId);
await page.keyboard.press("Escape"); await page.waitForTimeout(500);
const createdAfter = await page.evaluate((cid) => (window.__moduli_state__?.occurrences || []).find((o) => o.id === cid)?.occurrences?.length, fx.containerId);
console.log("container children before/after leaving:", createdBefore, createdAfter, skip.asElement() ? "(Skip present)" : "");
if (args.shot) await page.screenshot({ path: args.shot });
appendRows(path.resolve(import.meta.dirname, "../../docs/ui-sweep-2026-11-03.md"), rows);
await s.close();
