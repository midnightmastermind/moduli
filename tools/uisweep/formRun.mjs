// tools/uisweep/formRun.mjs — a button's FORM (ASK_FORM), opened from the Sweep Row's "Sweep Form" button.
// The full-size controls are the add-item picker's (pickerRun covers them); this checks what is the form's own:
// it opens titled, every field item draws a control, optional items carry an Include box that typing ticks,
// Done waits for the required item, popovers opened inside the form pick without closing it, Escape cancels,
// Enter submits, and nothing is written (the operation has no Create step).
// Usage: node --env-file=server/.env tools/uisweep/formRun.mjs [--vp desktop|phone] [--writes]
import fs from "node:fs";
import path from "node:path";
import { open } from "./session.mjs";
import { goTo } from "./surfaces.mjs";
import { appendRows } from "./report.mjs";
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => { if (x.startsWith("--")) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]); return a; }, []));
const vp = args.vp || "desktop";
const touch = vp !== "desktop";
const fx = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures.json"), "utf8"));
const s = await open({ vp, grid: "poms rebuild", allowWrites: !!args.writes });
await s.ready({ settleMs: 8000 });
await goTo(s.page, {}, "Sweep Fields", "BOARD PAGE");
const page = s.page;
const press = async (h) => { if (touch) await h.tap(); else await h.click(); };
const out = []; const step = (st, ok, note = "") => { out.push({ step: st, ok, note }); console.log(ok ? "✅" : "✗", st, note); };
const FORM = '[data-testid="form-modal"]';

async function openForm() {
  const b = await page.evaluateHandle(({ row, fid }) => {
    const p = [...document.querySelectorAll("[data-panel-id]")].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1; });
    const box = (p || document).querySelector(`.container-shell [data-occurrence-id="${row}"] [data-field-id="${fid}"]`);
    box?.scrollIntoView({ block: "center" });
    return box?.querySelector("button");
  }, { row: fx.rowId, fid: fx.formFieldId });
  if (!b.asElement()) return false;
  await press(b.asElement());
  await page.waitForSelector(FORM, { timeout: 8000 }).catch(() => {});
  return !!(await page.$(FORM));
}
const children = () => page.evaluate((cid) => (window.__moduli_state__?.occurrences || []).find((o) => o.id === cid)?.occurrences?.length, fx.containerId);
const before = await children();

// 1. opens, titled, every field item drawn
step("opens from the button", await openForm());
const info = await page.evaluate((FORM) => {
  const f = document.querySelector(FORM); if (!f) return null;
  const labels = [...f.querySelectorAll("label")].map((l) => l.textContent.trim());
  const includes = [...f.querySelectorAll('input[type=checkbox][aria-label^="Include"]')].length;
  const submit = [...f.querySelectorAll("button[type=submit]")][0];
  // The SURFACE is what must fit; the form inside it scrolls. Done must be reachable by scrolling.
  const surf = f.closest(".menu-surface") || f;
  const r = surf.getBoundingClientRect();
  submit?.scrollIntoView({ block: "nearest" });
  const sr = submit?.getBoundingClientRect();
  const reach = !!sr && sr.top >= 0 && sr.bottom <= innerHeight && document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2)?.closest("button") === submit;
  return { title: f.firstElementChild?.textContent?.trim(), labels, includes, submitDisabled: !!submit?.disabled, needs: (f.innerText.match(/Needs: [^\n]*/) || [""])[0], w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, reach };
}, FORM);
step("titled", info?.title === "Sweep form", info?.title);
const expected = Object.entries(fx.fields).filter(([v, f]) => f.inputEnabled && f.type !== "button" && !v.endsWith("/display")).map(([, f]) => f.name);
const missing = expected.filter((n) => !info?.labels.includes(n));
step("every field item drawn", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : `${expected.length} items`);
step("optional items carry an Include box", (info?.includes || 0) >= Math.floor(expected.length / 2), `${info?.includes} boxes`);
step("Done waits for the required item", info?.submitDisabled === true && /Sweep note/.test(info?.needs || ""), info?.needs);
step("fits the screen", info && info.w <= info.vw && info.h <= info.vh + 1, info ? `${info.w}x${info.h} in ${info.vw}x${info.vh}` : "");
step("Done reachable by scrolling", !!info?.reach);

// 2. typing into an optional text item ticks its Include box
const optText = await page.evaluateHandle((FORM) => {
  const f = document.querySelector(FORM);
  for (const box of f.querySelectorAll('input[type=checkbox][aria-label^="Include"]')) {
    const item = box.closest("div")?.parentElement; const inp = item?.querySelector("input[type=text], input:not([type]), textarea");
    if (inp && !box.checked) { inp.setAttribute("data-probe-in", "1"); box.setAttribute("data-probe-box", "1"); return inp; }
  }
  return null;
}, FORM);
if (optText.asElement()) {
  await press(optText.asElement()); await page.keyboard.type("x"); await page.waitForTimeout(250);
  step("typing ticks Include", await page.evaluate(() => !!document.querySelector('[data-probe-box="1"]')?.checked));
} else step("typing ticks Include", false, "no unticked optional text item");

// 3. popovers inside the form: open, pick, and the form stays
for (const [variant, f] of Object.entries(fx.fields)) {
  if (!["select", "occurrence", "address", "when"].includes(f.type) || !f.inputEnabled) continue;
  const trig = await page.evaluateHandle(({ FORM, name }) => {
    const f = document.querySelector(FORM); const lab = [...f.querySelectorAll("label")].find((l) => l.textContent.trim() === name);
    const item = lab?.closest("div")?.parentElement; const b = item?.querySelector("button, [role=combobox]"); b?.scrollIntoView({ block: "center" }); return b;
  }, { FORM, name: f.name });
  if (!trig.asElement()) { step(`${f.name}: control`, false, "no trigger"); continue; }
  await press(trig.asElement()); await page.waitForTimeout(700);
  const layer = await page.evaluate(() => { const l = [...document.querySelectorAll('[data-radix-popper-content-wrapper], [role="dialog"]')].filter((x) => !x.querySelector('[data-testid="form-modal"]') && !x.closest('[data-testid="form-modal"]')); return l.length; });
  let picked = "";
  if (f.type === "select" || f.type === "occurrence") {
    const opts = await page.$$('[role="option"], [data-radix-popper-content-wrapper] button, .occ-search-row');
    for (const o of opts) { const t = ((await o.innerText()) || "").trim(); if (t && !/^\+|add new|^—$|^none$/i.test(t) && (await o.isVisible())) { picked = t.split("\n")[0]; await press(o); break; } }
    await page.waitForTimeout(400);
  }
  const formAfterPick = !!(await page.$(FORM));
  if (process.env.DIAG) console.log("  diag", f.name, "form open right after the pick:", formAfterPick);
  // close what the control opened — Escape once per layer, never the form
  for (let i = 0; i < 2; i++) { await page.waitForTimeout(300); const n = await page.evaluate(() => [...document.querySelectorAll('[data-radix-popper-content-wrapper]')].length + [...document.querySelectorAll('[role="dialog"]')].filter((d) => !d.querySelector('[data-testid="form-modal"]')).length); if (!n) break; await page.keyboard.press("Escape"); await page.waitForTimeout(250); }
  const formStill = !!(await page.$(FORM));
  const shown = picked ? await page.evaluate(({ FORM, name, picked }) => { const f = document.querySelector(FORM); const lab = [...(f?.querySelectorAll("label") || [])].find((l) => l.textContent.trim() === name); return (lab?.closest("div")?.parentElement?.innerText || "").includes(picked.slice(0, 8)); }, { FORM, name: f.name, picked }) : true;
  step(`${f.name} (${variant}) inside the form`, layer > 0 && formStill && shown, `${layer ? "opened" : "did NOT open"}${picked ? `, picked "${picked}" ${shown ? "shown" : "NOT shown"}` : ""}${formStill ? "" : ", FORM CLOSED"}`);
  if (!formStill) await openForm();
}

// 4. Escape cancels; Enter submits; nothing written
await page.keyboard.press("Escape"); await page.waitForTimeout(500);
step("Escape cancels", !(await page.$(FORM)));
if (await openForm()) {
  const note = await page.evaluateHandle((FORM) => { const f = document.querySelector(FORM); const lab = [...f.querySelectorAll("label")].find((l) => l.textContent.trim() === "Sweep note"); return lab?.closest("div")?.parentElement?.querySelector("input, textarea"); }, FORM);
  await press(note.asElement()); await page.keyboard.type("sweep"); await page.keyboard.press("Enter"); await page.waitForTimeout(800);
  step("Enter submits", !(await page.$(FORM)));
}
await page.waitForTimeout(1500);
const after = await children();
step("nothing created", before === after, `${before} → ${after}`);

const bad = out.filter((r) => !r.ok);
appendRows(path.resolve(import.meta.dirname, "../../docs/ui-sweep-2026-11-03.md"), [{ id: "forms.sweepForm", surface: "Field matrix · a button's form", control: "Sweep form (ASK_FORM)", vp,
  works: bad.length ? `✗ ${bad.map((b) => `${b.step}: ${b.note}`).join("; ")}` : `✅ ${out.length} checks`, reach: "", a11y: "", clear: "", fast: "", notes: "" }]);
await s.close();
