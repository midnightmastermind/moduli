// tools/uisweep/crawl.mjs — find every control in a surface, activate each one, and say what happened.
//
// The defect class the 2026-10-18 sweep missed is a control that does NOTHING: no DOM change, no URL change, no
// focus change, nothing opened, nothing sent. Each one is a row marked "✗ nothing".
import { rectOnScreen, tapSizeVerdict, jargonHits, hitTarget, popupCount, escapeCloses, runAxe } from "./checks.mjs";

const DESTRUCTIVE = /\b(delete|remove|log ?out|disconnect|reset|clear all|revoke|unsubscribe|break link|trash)\b/i;
const CONTROL_SEL = 'button, [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="option"], [role="tab"], [role="switch"], [role="checkbox"], [role="combobox"], a[href], input:not([type="hidden"]), select, textarea';

/** before/after snapshots → what the activation did. An error outranks everything; background DOM noise is not a change. */
export function classifyOutcome(b, a) {
  if (a.errors > b.errors) return "error";
  if (a.url !== b.url) return "navigated";
  if (a.popups > b.popups) return "opened";
  if (a.writes > b.writes) return "wrote";
  if (a.states !== b.states) return "changed";
  if (a.mutations > a.noise) return "changed"; // more DOM mutations than the same window with no input
  if (a.focused !== b.focused && a.focusIsField) return "changed"; // a button taking focus on click is not a change; a field ready to type is
  if (a.popups < b.popups) return "changed"; // it closed something (a Done / Cancel / ×)
  return "nothing";
}

/** Every control under `rootSel`, in document order: label, box, hoverOnly. Marks each with data-uisweep-i. */
export async function controlsIn(page, rootSel) {
  return page.evaluate(({ rootSel, SEL }) => {
    const root = document.querySelector(rootSel) || document.body;
    const out = [];
    let i = 0;
    for (const el of root.querySelectorAll(SEL)) {
      if (el.closest("[data-uisweep-skip]")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      // hover-only: invisible itself or through an ancestor, until something is hovered
      let hoverOnly = false;
      for (let n = el; n && n !== root.parentElement; n = n.parentElement) { if (Number(getComputedStyle(n).opacity) === 0) { hoverOnly = true; break; } }
      const label = (el.getAttribute("aria-label") || el.getAttribute("title") || (el.innerText || "").trim().split("\n")[0] || el.getAttribute("placeholder") || el.getAttribute("name") || el.tagName.toLowerCase()).trim().slice(0, 60);
      el.setAttribute("data-uisweep-i", String(i));
      out.push({ i, label, tag: el.tagName.toLowerCase(), role: el.getAttribute("role") || "", rect: { x: r.x, y: r.y, width: r.width, height: r.height }, hoverOnly, named: !!(el.getAttribute("aria-label") || el.getAttribute("title") || (el.innerText || "").trim() || el.getAttribute("aria-labelledby")) });
      i++;
    }
    return out;
  }, { rootSel, SEL: CONTROL_SEL });
}

async function snapshot(page, rootSel, errors) {
  return page.evaluate(({ rootSel, errors }) => {
    const root = document.querySelector(rootSel) || document.body;
    const states = [...root.querySelectorAll("[aria-pressed], [aria-checked], [aria-expanded], [aria-selected], input[type=checkbox]")]
      .map((e) => `${e.getAttribute("aria-pressed")}${e.getAttribute("aria-checked")}${e.getAttribute("aria-expanded")}${e.getAttribute("aria-selected")}${e.checked ?? ""}`).join(",");
    const popups = document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper], .context-menu, .radial-menu, [data-sheet], .header-dropdown').length;
    return { url: location.href, focused: document.activeElement ? `${document.activeElement.tagName}#${document.activeElement.id}.${document.activeElement.getAttribute("data-uisweep-i") ?? ""}` : "",
      focusIsField: !!(document.activeElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable)),
      popups, writes: (window.__blockedWrites || []).length + (window.__sentWrites || []).length, errors, states, mutations: window.__uisweepMut || 0, noise: window.__uisweepNoise || 0 };
  }, { rootSel, errors });
}

async function watchMutations(page, ms) {
  // count mutations for `ms` with no input: that is the page's own background noise
  await page.evaluate(() => {
    if (!window.__uisweepObs) {
      window.__uisweepObs = new MutationObserver((l) => { window.__uisweepMut = (window.__uisweepMut || 0) + l.length; });
      window.__uisweepObs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    window.__uisweepMut = 0;
  });
  await page.waitForTimeout(ms);
  await page.evaluate(() => { window.__uisweepNoise = window.__uisweepMut || 0; window.__uisweepMut = 0; });
}

async function restore(page, basePopups, baseUrl, surface, ctx) {
  for (let k = 0; k < 4 && (await popupCount(page)) > basePopups; k++) { await page.keyboard.press("Escape"); await page.waitForTimeout(120); }
  if (page.url() !== baseUrl) { await page.goBack().catch(() => {}); await page.waitForTimeout(400); }
  if (!(await page.$(surface.root))) await surface.open(page, ctx);
}

/**
 * Crawl one surface. surface = { id, name, root, open(page, ctx), writes?, popupRoot? }.
 * opts: { vp, depth = 2, settleMs = 500, errors = [], maxControls = 150, axe = true }.
 * Returns report rows (report.mjs COLUMNS).
 */
export async function crawlSurface(page, surface, { vp = "desktop", depth = 2, settleMs = 500, errors = [], maxControls = 150, axe = true, ctx = {}, prefix = "" } = {}) {
  const touch = vp !== "desktop";
  const vpBox = page.viewportSize();
  await surface.open(page, ctx);
  await page.waitForTimeout(settleMs);
  const rows = [];
  const basePopups = await popupCount(page);
  const baseUrl = page.url();
  const first = await controlsIn(page, surface.root);
  const n = Math.min(first.length, maxControls);
  if (first.length > maxControls) rows.push({ id: surface.id, surface: surface.name, control: `(${first.length - maxControls} more not crawled)`, vp, works: "⚠", notes: `maxControls ${maxControls}` });
  for (let i = 0; i < n; i++) {
    const controls = await controlsIn(page, surface.root);
    const c = controls[i];
    if (!c) break;
    const row = { id: `${surface.id}${prefix}#${i}`, surface: surface.name, control: c.label, vp, works: "", reach: "", a11y: "", clear: "", fast: "", notes: "" };
    const reach = [];
    const onScreen = rectOnScreen(c.rect, vpBox);
    if (!onScreen.ok) reach.push(`off screen ${onScreen.offBy}px`);
    if (touch) { const t = tapSizeVerdict(c.rect.width, c.rect.height); if (t !== "ok") reach.push(`tap ${Math.round(c.rect.width)}×${Math.round(c.rect.height)} ${t === "fail" ? "<24" : "<32"}`); }
    if (c.hoverOnly) reach.push(touch ? "hover-only (no touch path?)" : "hover-only");
    const jargon = jargonHits(c.label);
    if (jargon.length) row.clear = `⚠ jargon: ${jargon.join(", ")}`;
    if (!c.named) row.a11y = "✗ no accessible name";
    if (DESTRUCTIVE.test(c.label) && !surface.writes) { row.works = "— skipped (destructive)"; row.reach = reach.length ? `⚠ ${reach.join("; ")}` : "✅"; rows.push(row); continue; }

    const handle = await page.$(`[data-uisweep-i="${i}"]`);
    if (!handle) { row.works = "⚠ vanished"; rows.push(row); continue; }
    if (c.hoverOnly) { await handle.evaluate((el) => el.parentElement?.scrollIntoView({ block: "center" })); const pr = await handle.evaluate((el) => { const r = el.parentElement.getBoundingClientRect(); return { x: r.x + 4, y: r.y + r.height / 2 }; }); await page.mouse.move(pr.x, pr.y); await page.waitForTimeout(150); }
    const hit = await hitTarget(page, handle);
    if (!hit.ok) reach.push(hit.why);
    await watchMutations(page, Math.min(400, settleMs));
    const before = await snapshot(page, surface.root, errors.length);
    let t0 = Date.now(), activated = true;
    try {
      if (touch && !c.hoverOnly) await handle.tap({ timeout: 2500 });
      else await handle.click({ timeout: 2500 });
    } catch (e) { activated = false; reach.push(`could not activate: ${String(e.message).split("\n")[0].slice(0, 80)}`); }
    await page.waitForTimeout(settleMs);
    const after = await snapshot(page, surface.root, errors.length);
    const outcome = activated ? classifyOutcome(before, after) : "unreachable";
    row.works = outcome === "nothing" ? "✗ nothing" : outcome === "error" ? `✗ error: ${errors[errors.length - 1]?.slice(0, 80)}` : outcome === "unreachable" ? "✗ unreachable" : `✅ ${outcome}`;
    row.fast = `${Date.now() - t0 - settleMs > 0 ? "" : ""}`;
    if (outcome === "opened" && axe) {
      const a = await runAxe(page, '[role="menu"], [role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper], .context-menu, .radial-menu').catch(() => null);
      if (a && (a.critical || a.serious)) row.a11y = `${row.a11y ? row.a11y + "; " : ""}✗ axe ${a.rules.map((r) => `${r.id}×${r.n}`).join(", ")}`;
      const popRects = await page.evaluate(() => [...document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper] > *, .context-menu')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
      for (const r of popRects) { const o = rectOnScreen(r, vpBox); if (!o.ok && r.width) { reach.push(`popup off screen ${o.offBy}px`); break; } }
      if (depth > 1) {
        const sub = { id: `${surface.id}${prefix}#${i}`, name: `${surface.name} › ${c.label}`, root: '[role="menu"], [role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper], .context-menu, .radial-menu',
          writes: surface.writes, open: async (p) => { if (!(await p.$(sub.root))) { await restore(p, basePopups, baseUrl, surface, ctx); const h = await p.$(`[data-uisweep-i="${i}"]`); if (h) await (touch ? h.tap() : h.click()).catch(() => {}); await p.waitForTimeout(settleMs); } } };
        rows.push(row);
        rows.push(...await crawlSurface(page, sub, { vp, depth: depth - 1, settleMs, errors, maxControls: 60, axe: false, ctx, prefix: "" }));
        const esc = await escapeCloses(page);
        if (!esc.ok) row.a11y = `${row.a11y ? row.a11y + "; " : ""}✗ Escape does not close`;
        row.reach = reach.length ? `⚠ ${reach.join("; ")}` : "✅";
        await restore(page, basePopups, baseUrl, surface, ctx);
        continue;
      }
      const esc = await escapeCloses(page);
      if (!esc.ok) row.a11y = `${row.a11y ? row.a11y + "; " : ""}✗ Escape does not close`;
    }
    row.reach = reach.length ? `⚠ ${reach.join("; ")}` : "✅";
    if (!row.a11y) row.a11y = "✅";
    if (!row.clear) row.clear = "✅";
    rows.push(row);
    await restore(page, basePopups, baseUrl, surface, ctx);
  }
  return rows;
}
