// tools/uisweep/fieldMatrix.mjs — every field type × variant × every place a field renders.
//
// The fixture row "Sweep Row" (buildFixtures.mjs) binds one field per variant. A case = (variant, context) and a list
// of steps; driveFieldCase runs them through the real UI. Today's select-unpick bug (2026-11-03) is the shape this is
// for: a field that works in the row pill and fails in the form.
import { REUSE, CREATE } from "./variants.mjs";

export const VARIANTS = [...REUSE.map(([v]) => v), ...CREATE.map(([v]) => v)];

// Where a field renders. `types` = which field types that place offers (absent = all).
export const CONTEXTS = [
  { id: "rowPill", name: "board row pill" },
  { id: "rowSettings", name: "row Settings › Fields" },
  { id: "tableCell", name: "table cell" },
  { id: "docPill", name: "field pill in a doc" },
  { id: "formModal", name: "a button's form", types: ["text", "number", "boolean", "select", "date", "rating", "duration", "occurrence", "address", "when", "markdown"] },
  { id: "quickAddPicker", name: "add-item field picker", types: ["text", "number", "boolean", "select", "date", "rating", "duration", "occurrence", "address", "when"] },
  { id: "filterNav", name: "header filter widget", types: ["date", "select", "occurrence", "boolean"] },
  { id: "opEditor", name: "operations editor value", types: ["text", "number", "boolean", "select", "date", "rating", "duration", "occurrence"] },
];

const STEPS = {
  boolean: ["toggle on → shown on", "toggle off → shown off", "keyboard: Space toggles", "persist"],
  button: ["press → runs its listener or says nothing listens", "keyboard: Enter presses"],
  default: ["set → shown", "change → shown", "clear / unpick → shown empty", "keyboard: Tab in, Enter/arrows, Escape", "persist"],
};

export function cases() {
  const out = [];
  for (const v of VARIANTS) {
    const type = v.split("/")[0];
    for (const c of CONTEXTS) {
      if (c.types && !c.types.includes(type)) continue;
      if (type === "button" && c.id !== "rowPill" && c.id !== "docPill") continue;
      out.push({ key: `${v}@${c.id}`, variant: v, type, context: c.id, steps: STEPS[type] || STEPS.default });
    }
  }
  return out;
}

// ── drivers: one case through the real UI ─────────────────────────────────────
// Each returns { step, ok, note, ms } per step. The row is found by its occurrence id; a field by its label.

const OPT = '[role="option"], [data-radix-popper-content-wrapper] button, .occ-search-row';

async function act(page, h, touch) { if (touch) await h.tap(); else await h.click(); }
async function pillText(page, rowSel, name) {
  return page.evaluate(({ rowSel, name }) => {
    const row = document.querySelector(rowSel); if (!row) return null;
    const el = [...row.querySelectorAll(".instance-field-mq")].find((e) => (e.innerText || "").trim().startsWith(name));
    return el ? (el.innerText || "").replace(/\s+/g, " ").trim() : null;
  }, { rowSel, name });
}
async function pillHandle(page, rowSel, name) {
  return page.evaluateHandle(({ rowSel, name }) => {
    const row = document.querySelector(rowSel);
    const box = [...row.querySelectorAll(".instance-field-mq")].find((e) => (e.innerText || "").trim().startsWith(name));
    if (!box) return null;
    return box.querySelector("button, [role=combobox], [tabindex]") || box;
  }, { rowSel, name });
}
async function openOptions(page) {
  await page.waitForTimeout(500);
  return page.$$(OPT);
}
const timed = async (fn) => { const t = Date.now(); const r = await fn(); return { r, ms: Date.now() - t }; };

/** Drive one rowPill case. f = { id, name, type }. Returns step results. */
export async function driveRowPill(page, rowSel, variant, f, { touch = false } = {}) {
  const out = [];
  const step = (name, ok, note = "", ms = null) => out.push({ step: name, ok, note, ms });
  await page.$eval(rowSel, (e) => e.scrollIntoView({ block: "center" })).catch(() => {});
  const before = await pillText(page, rowSel, f.name);
  if (before === null) { step("visible", false, "no pill on the row"); return out; }
  const h = (await pillHandle(page, rowSel, f.name)).asElement();
  if (!h) { step("visible", false, "no control in the pill"); return out; }
  const type = variant.split("/")[0];
  try {
    if (type === "boolean") {
      const sw = await page.evaluateHandle(({ rowSel, name }) => { const row = document.querySelector(rowSel); const box = [...row.querySelectorAll(".instance-field-mq")].find((e) => (e.innerText || "").trim().startsWith(name)); return box?.querySelector('button.peer, [role="switch"], input[type=checkbox]'); }, { rowSel, name: f.name });
      const el = sw.asElement();
      const state = () => el.evaluate((e) => e.getAttribute("aria-checked") ?? e.getAttribute("data-state") ?? String(e.checked));
      const s0 = await state();
      const t1 = await timed(async () => { await act(page, el, touch); await page.waitForTimeout(300); return state(); });
      step("toggle on", t1.r !== s0, `${s0}→${t1.r}`, t1.ms);
      const t2 = await timed(async () => { await act(page, el, touch); await page.waitForTimeout(300); return state(); });
      step("toggle off", t2.r === s0, `→${t2.r}`, t2.ms);
      if (!touch) { await el.focus(); await page.keyboard.press("Space"); await page.waitForTimeout(300); const s3 = await state(); step("keyboard Space", s3 !== s0, `→${s3}`); await page.keyboard.press("Space"); await page.waitForTimeout(300); }
      const named = await el.evaluate((e) => !!(e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || e.closest("label")));
      step("named", named, named ? "" : "switch has no accessible name");
      return out;
    }
    if (type === "button") {
      const t = await timed(async () => { await act(page, h, touch); await page.waitForTimeout(800); return page.evaluate(() => document.body.innerText); });
      step("press", /listen|nothing|running|ran/i.test(t.r), "expects a message when nothing listens", t.ms);
      return out;
    }
    if (type === "select" || type === "occurrence") {
      const multi = /multi/.test(variant);
      const t1 = await timed(async () => { await act(page, h, touch); return openOptions(page); });
      step("opens list", t1.r.length > 0, `${t1.r.length} options`, t1.ms);
      if (!t1.r.length) { await page.keyboard.press("Escape"); return out; }
      const pick = t1.r[Math.min(1, t1.r.length - 1)];
      const label = (await pick.innerText()).split("\n")[0].trim();
      await act(page, pick, touch); await page.waitForTimeout(500);
      let txt = await pillText(page, rowSel, f.name);
      step("set → shown", !!txt && txt.includes(label.slice(0, 12)), `picked "${label}" → "${txt}"`);
      // unpick: open again, press the same option
      if (multi && !(await page.$(OPT))) { /* list closed */ }
      if (!(await page.$(OPT))) { const h2 = (await pillHandle(page, rowSel, f.name)).asElement(); await act(page, h2, touch); await page.waitForTimeout(500); }
      const opts = await page.$$(OPT);
      let same = null; for (const o of opts) { if ((await o.innerText()).split("\n")[0].trim() === label) { same = o; break; } }
      if (same) { await act(page, same, touch); await page.waitForTimeout(500); }
      await page.keyboard.press("Escape"); await page.waitForTimeout(300);
      txt = await pillText(page, rowSel, f.name);
      step("unpick → shown empty", !!txt && !txt.includes(label.slice(0, 12)), `→ "${txt}"`);
      const open = await page.$(OPT);
      step("Escape closes", !open, open ? "list still open" : "");
      return out;
    }
    if (type === "rating") {
      const stars = await h.$$("button, [role=radio], svg");
      step("has stars", stars.length > 0, `${stars.length}`);
      if (!stars.length) return out;
      await act(page, stars[Math.min(2, stars.length - 1)], touch); await page.waitForTimeout(300);
      const t = await page.evaluate(({ rowSel, name }) => { const row = document.querySelector(rowSel); const b = [...row.querySelectorAll("[title]")].find((e) => e.title.startsWith(name + ":")); return b?.title; }, { rowSel, name: f.name });
      step("set → shown", /3\//.test(t || ""), t || "");
      await act(page, stars[Math.min(2, stars.length - 1)], touch); await page.waitForTimeout(300);
      const t2 = await page.evaluate(({ rowSel, name }) => { const row = document.querySelector(rowSel); const b = [...row.querySelectorAll("[title]")].find((e) => e.title.startsWith(name + ":")); return b?.title; }, { rowSel, name: f.name });
      step("same star again clears", /0\//.test(t2 || ""), t2 || "");
      return out;
    }
    // text / number / duration / date / address / when / markdown: click, an editor appears, type, commit
    const value = type === "number" ? "7" : type === "duration" ? "90" : type === "date" ? "2026-11-05" : "Sweep";
    const t1 = await timed(async () => { await act(page, h, touch); await page.waitForTimeout(500); return page.evaluate(() => document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) || document.activeElement?.isContentEditable); });
    step("opens editor", !!t1.r, t1.r ? "" : "nothing took focus", t1.ms);
    if (!t1.r) { const dlg = await page.$('[role="dialog"]'); step("opens a dialog", !!dlg, ""); await page.keyboard.press("Escape"); return out; }
    await page.keyboard.press("Control+A"); await page.keyboard.type(value); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
    const txt = await pillText(page, rowSel, f.name);
    const want = type === "duration" ? "1h 30m" : value;
    step("set → shown", !!txt && txt.includes(want), `→ "${txt}"`);
    const h2 = (await pillHandle(page, rowSel, f.name)).asElement();
    await act(page, h2, touch); await page.waitForTimeout(400);
    await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace"); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
    const t3 = await pillText(page, rowSel, f.name);
    step("clear → shown empty", !!t3 && !t3.includes(want), `→ "${t3}"`);
    return out;
  } catch (e) {
    step("error", false, String(e.message).split("\n")[0].slice(0, 120));
    await page.keyboard.press("Escape").catch(() => {});
    return out;
  }
}
