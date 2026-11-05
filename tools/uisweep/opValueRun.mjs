// tools/uisweep/opValueRun.mjs — the field matrix as a VALUE IN AN OPERATION STEP. One operation ("Sweep Op Values") with one
// Set field step: per field type, pick the field, type a literal, Save, Run now, read back what the row STORED and what its
// pill SHOWS; then mode "null" → Run → the row reads empty. The operation is deleted at the end.
// Usage: node --env-file=server/.env tools/uisweep/opValueRun.mjs [--only v,v]
import fs from "node:fs";
import path from "node:path";
import { open } from "./session.mjs";
import { goTo } from "./surfaces.mjs";
import { appendRows } from "./report.mjs";
import { openCommandCenter, clickIn, clickBtn } from "../../_cc.mjs";
import { W, stepIds, addStep, setType, exprText } from "../../_opb.mjs";
import { typeNth } from "../../_ops.mjs";
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => { if (x.startsWith("--")) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]); return a; }, []));
const fx = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures.json"), "utf8"));
const only = args.only ? new Set(String(args.only).split(",")) : null;
const OP = "Sweep Op Values";
const s = await open({ vp: "desktop", grid: "poms rebuild", allowWrites: true });
await s.ready({ settleMs: 8000 });
const page = s.page;
page.on("dialog", (d) => d.accept());
await page.setViewportSize({ width: 1600, height: 1400 }); await W(page, 600);
await goTo(page, {}, "Sweep Fields", "BOARD PAGE");
const say = (t, r) => { if (!(r?.ok || r === true)) throw new Error(`${t}: ${r?.why ?? JSON.stringify(r)}`); return r; };

await openCommandCenter(page, "Operations");
const exists = await page.evaluate((OP) => (window.__moduli_state__?.operations || []).some((o) => o.name === OP), OP);
let step;
if (exists) { say("open", await clickIn(page, OP, 2200)); step = (await stepIds(page, "root"))[0]; }
else {
  say("+ Operation", await clickIn(page, "Operation", 2600));
  say("open", await clickIn(page, "New Operation", 2200));
  say("name", await typeNth(page, "", OP, 0));
}
if (!step) {
  step = say("+ Action", await addStep(page, "root", "+ Action")).id;
  say("type", await setType(page, step, ["Occurrences", "Update", "Set field"]));
  say("target", await exprText(page, step, 0, fx.rowId));
}

const stored = (fid) => page.evaluate(({ r, fid }) => (window.__moduli_state__?.occurrences || []).find((o) => o.id === r)?.fields?.[fid]?.value ?? null, { r: fx.rowId, fid });
const pill = (fid) => page.evaluate(({ r, fid }) => { const rows = [...document.querySelectorAll(`[data-occurrence-id="${r}"]`)]; for (const row of rows) { const b = row.querySelector(`[data-field-id="${fid}"]`); if (b) return (b.innerText || "").replace(/\s+/g, " ").trim(); } return null; }, { r: fx.rowId, fid });
const anyValue = (fid) => page.evaluate((fid) => { for (const o of window.__moduli_state__?.occurrences || []) { const v = o.fields?.[fid]?.value; if (Array.isArray(v) && v.length) return v[0]; if (typeof v === "string" && v) return v; } return null; }, fid);
const optionOf = (fid) => page.evaluate((fid) => { const f = (window.__moduli_state__?.fields || []).find((x) => x.id === fid); const o = f?.meta?.options || f?.options || f?.meta?.optionsSource?.values || f?.meta?.optionsSource?.options || []; const x = o[0]; return x == null ? null : (typeof x === "object" ? x.value ?? x.label : x); }, fid);
async function pickField(name) {
  const trig = await page.evaluateHandle((id) => { const st = document.querySelector(`[data-step-id="${id}"]`); return [...st.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Pick field...") || [...st.querySelectorAll('button[aria-haspopup], button[role="combobox"]')].at(0) || null; }, step);
  if (!trig.asElement()) return { ok: false, why: "no field picker" };
  await trig.asElement().click(); await W(page, 500);
  await page.keyboard.type(name, { delay: 12 }); await W(page, 500);
  const row = await page.evaluateHandle((n) => [...document.querySelectorAll('[data-radix-popper-content-wrapper] [role="option"], [data-radix-popper-content-wrapper] button')].find((b) => (b.innerText || "").split("\n")[0].trim() === n) || null, name);
  if (!row.asElement()) { await page.keyboard.press("Escape"); return { ok: false, why: `"${name}" not offered` }; }
  await row.asElement().click(); await W(page, 400);
  return { ok: true };
}
const setMode = (n, mode) => page.evaluate(({ id, n, mode }) => { const st = document.querySelector(`[data-step-id="${id}"]`); const sel = [...st.querySelectorAll("select")].filter((e) => [...e.options].map((o) => o.value).join(",").includes("path,text,structured,array,null")).at(n); sel.value = mode; sel.dispatchEvent(new Event("change", { bubbles: true })); return true; }, { id: step, n, mode });
async function run() {
  say("save", await clickBtn(page, "Save", { wait: 900 }));
  // Save goes back to the list; the run lives on the operation's own page.
  if (!(await page.$(`[data-step-id="${step}"]`))) say("reopen", await clickIn(page, OP, 1800));
  say("run", await clickBtn(page, "Run now", { wait: 2200 }));
}
const LIT = (type, variant) => ({ text: "sweep-op", number: "7", duration: "90", boolean: "true", rating: "3", date: new Date().toISOString().slice(0, 10), markdown: "sweep **md**", address: "Madison", when: "2026-11-05" }[type]);

// "value" mode: the field's own control inside the step. Returns the value picked, or { skip } for a control that opens a dialog.
async function driveValueControl(f) {
  await setMode(1, "value"); await W(page, 500);
  const box = await page.$(`[data-step-id="${step}"] [data-testid="step-value-field"]`);
  if (!box) throw new Error("no value control drawn");
  if (f.type === "boolean") { const c = await box.$('[role="switch"], [role="checkbox"], input[type=checkbox], button'); await c.click(); await W(page, 300); return { want: true }; }
  if (f.type === "select" || f.type === "occurrence") {
    const t = await box.$("button, [role=combobox]"); await t.click(); await W(page, 700);
    const opts = await page.$$('[data-radix-popper-content-wrapper] [role="option"], [data-radix-popper-content-wrapper] button');
    let picked = null;
    for (const o of opts) { const x = ((await o.innerText()) || "").trim(); if (x && !/^\+|add new|^—$|^none$|^clear/i.test(x) && await o.isVisible()) { picked = x.split("\n")[0]; await o.click(); break; } }
    await W(page, 400);
    if (await page.$('[data-radix-popper-content-wrapper]')) { await page.keyboard.press("Escape"); await W(page, 300); }
    return picked ? { label: picked } : { skip: `${opts.length} rows, nothing to pick` };
  }
  if (f.type === "rating") { const b = await box.$$("button"); await b[2].click(); await W(page, 300); return { want: 3 }; }
  if (f.type === "date") { const i = await box.$("input[type=date]"); await i.fill(new Date().toISOString().slice(0, 10)); await W(page, 300); return { want: new Date().toISOString().slice(0, 10) }; }
  if (f.type === "duration") { const i = await box.$$("input"); await i[0].fill("1"); if (i[1]) await i[1].fill("30"); await page.keyboard.press("Tab"); await W(page, 300); return { want: i[1] ? 90 : 1 }; }
  if (f.type === "address" || f.type === "when") { const t = await box.$("button"); await t.click(); await W(page, 600); const opened = !!(await page.$('[data-radix-popper-content-wrapper], [role="dialog"]:not(.cc-card)')); await page.keyboard.press("Escape"); await W(page, 300); return { skip: opened ? "its picker opens" : "PICKER DID NOT OPEN", bad: !opened }; }
  const i = await box.$("textarea, input"); const v = f.type === "number" ? "7" : "sweep"; await i.click(); await page.keyboard.press("Control+A"); await page.keyboard.type(v); await page.keyboard.press("Tab"); await W(page, 300);
  return { want: f.type === "number" ? 7 : v };
}

const rows = [];
for (const [variant, f] of Object.entries(fx.fields)) {
  if (only && !only.has(variant)) continue;
  if (f.type === "button" || !f.inputEnabled) continue;
  const out = []; const stp = (st, ok, note = "") => out.push({ step: st, ok, note });
  try {
    say("field", await pickField(f.name));
    if (args.mode === "value") {
      const r = await driveValueControl(f);
      if (r.skip) stp("control", !r.bad, r.skip);
      else {
        await run();
        const st = await stored(f.id); const p = await pill(f.id);
        const expr = await page.evaluate((OP) => { const o = (window.__moduli_state__?.operations || []).find((x) => x.name === OP); return o?.pipeline?.steps?.[0]?.config?.valueExpr; }, OP);
        if (r.want !== undefined) stp("stored, right type", JSON.stringify(st) === JSON.stringify(r.want), `${JSON.stringify(st)} from ${expr}`);
        else stp("picked → row shows it", !!p && p.includes(r.label.slice(0, 6)), `"${r.label}" → "${p}"; stored ${JSON.stringify(st)}`);
        // it reopens on the same control, holding what was picked
        const reopened = await page.evaluate((id) => !!document.querySelector(`[data-step-id="${id}"] [data-testid="step-value-field"]`), step);
        stp("reopens as a value", reopened, "");
      }
      await setMode(1, "null"); await W(page, 300); await run();
      const bad = out.filter((x) => !x.ok);
      rows.push({ id: `field.${variant}@opValueControl`, surface: "Field matrix · operation step, value control", control: `${f.name} (${variant})`, vp: "desktop", works: bad.length ? `✗ ${bad.map((b) => `${b.step}: ${b.note}`).join("; ")}` : `✅ ${out.map((x) => x.step).join(", ")}`, reach: "", a11y: "", clear: "", fast: "", notes: out.filter((x) => x.ok && x.note).map((x) => `${x.step}: ${x.note}`).join("; ").slice(0, 240) });
      console.log(rows.at(-1).control, "→", rows.at(-1).works.slice(0, 200), "|", rows.at(-1).notes.slice(0, 170));
      continue;
    }
    let v = LIT(f.type, variant);
    if (f.type === "select") v = (await optionOf(f.id)) ?? (await anyValue(f.id));
    if (f.type === "occurrence") v = await anyValue(f.id);
    if (v == null) { stp("value", true, "no known option to type — skipped"); }
    else {
      say("value", await exprText(page, step, 1, String(v)));
      await run();
      const st = await stored(f.id); const p = await pill(f.id);
      const multi = /multi/.test(variant);
      stp("stored", multi ? (Array.isArray(st) && st.length === 1) || String(st) === String(v) : String(st) === String(v), `${JSON.stringify(st)} (${Array.isArray(st) ? "array" : typeof st})`);
      if (f.type === "boolean") {
        const on = await page.evaluate(({ r, fid }) => { const b = document.querySelector(`[data-occurrence-id="${r}"] [data-field-id="${fid}"]`); const c = b?.querySelector('[role="switch"], [role="checkbox"], input[type=checkbox]'); return c ? (c.getAttribute("aria-checked") ?? c.getAttribute("data-state") ?? String(c.checked)) : "no control"; }, { r: fx.rowId, fid: f.id });
        stp("row shows it", on === "true" || on === "checked", `control reads ${on}`);
      } else if (f.type === "rating" || f.type === "markdown") {
        const shown = await page.evaluate(({ r, fid, type }) => { const b = document.querySelector(`[data-occurrence-id="${r}"] [data-field-id="${fid}"]`); return type === "markdown" ? (b?.querySelector("textarea")?.value ?? "") : [...(b?.querySelectorAll('button[aria-pressed="true"]') || [])].length; }, { r: fx.rowId, fid: f.id, type: f.type });
        stp("row shows it", f.type === "markdown" ? shown === String(v) : shown === 1 || shown === 3, `reads ${JSON.stringify(shown)}`);
      } else stp("row shows it", !!p && p.length > f.name.length + 1 && !/—$/.test(p), `"${p}"`);
    }
    await setMode(1, "null"); await W(page, 300);
    await run();
    const st2 = await stored(f.id); const p2 = await pill(f.id);
    stp("null → empty", st2 == null || st2 === "", `${JSON.stringify(st2)} "${p2}"`);
  } catch (e) { stp("drive", false, String(e.message).split("\n")[0].slice(0, 160)); }
  const bad = out.filter((r) => !r.ok);
  rows.push({ id: `field.${variant}@opValue`, surface: "Field matrix · value in an operation step", control: `${f.name} (${variant})`, vp: "desktop",
    works: bad.length ? `✗ ${bad.map((b) => `${b.step}: ${b.note}`).join("; ")}` : `✅ ${out.map((r) => r.step).join(", ")}`, reach: "", a11y: "", clear: "", fast: "", notes: out.filter((r) => r.ok && r.note).map((r) => `${r.step}: ${r.note}`).join("; ").slice(0, 240) });
  console.log(rows.at(-1).control, "→", rows.at(-1).works.slice(0, 230), "|", rows.at(-1).notes.slice(0, 140));
}
// Delete the operation (its onLoad trigger would otherwise run on every load).
if (!(await page.$(`[data-step-id="${step}"]`))) await clickIn(page, OP, 1800);
const del = await clickBtn(page, "Delete", { wait: 1200 }); console.log("delete op:", JSON.stringify(del));
const left = await page.evaluate((OP) => (window.__moduli_state__?.operations || []).filter((o) => o.name === OP).length, OP);
console.log("operations named", OP, "left:", left);
appendRows(path.resolve(import.meta.dirname, "../../docs/ui-sweep-2026-11-03.md"), rows);
await s.close();
