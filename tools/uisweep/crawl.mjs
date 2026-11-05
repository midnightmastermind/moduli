// tools/uisweep/crawl.mjs — find every control in a surface, activate each one, and say what happened.
//
// The defect class the 2026-10-18 sweep missed is a control that does NOTHING: no DOM change, no URL change, no
// focus change, nothing opened, nothing sent. Each one is a row marked "✗ nothing".
import { rectOnScreen, tapSizeVerdict, jargonHits, hitTarget, popupCount, escapeCloses, runAxe } from "./checks.mjs";

export const POPUP_SEL = '.menu-surface, [role="menu"], [role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper], .context-menu, .radial-menu-items, .header-dropdown, [data-sheet], .occ-search-menu, .command-palette, .artifact-spread';
const DESTRUCTIVE = /\b(delete|remove|log ?out|disconnect|reset|clear all|revoke|unsubscribe|break link|trash)\b/i;
// Pressing these moves the whole session somewhere else, and every row after them reads wrong. Switching grids has its own
// probe (_gridswitch.mjs); a notification pill's stack changes while the load runs (its rows start with a quoted name).
const ALWAYS_SKIP = /^(Reload|test grid 1|test grid 2|poms grid|poms rebuild|contrast scratch|Live Grid)$|^"/;
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
    // A missing root is NOT the whole page: falling back to body clicked the grid picker from every surface whose popup
    // had closed, and reported the same 46 page-chrome rows for each.
    const root = document.querySelector(rootSel);
    if (!root) return [];
    const out = [];
    let i = 0;
    for (const el of root.querySelectorAll(SEL)) {
      if (el.closest("[data-uisweep-skip]")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      if (cs.pointerEvents === "none") continue; // a closed panel kept in the DOM to animate: nothing can press it
      // hover-only: invisible itself or through an ancestor, until something is hovered
      let hoverOnly = false;
      for (let n = el; n && n !== root.parentElement; n = n.parentElement) { if (Number(getComputedStyle(n).opacity) === 0) { hoverOnly = true; break; } }
      const label = (el.getAttribute("aria-label") || el.getAttribute("title") || (el.innerText || "").trim().split("\n")[0] || el.getAttribute("placeholder") || el.getAttribute("name") || el.tagName.toLowerCase()).trim().slice(0, 60);
      el.setAttribute("data-uisweep-i", String(i));
      out.push({ i, label, tag: el.tagName.toLowerCase(), role: el.getAttribute("role") || "", cls: typeof el.className === "string" ? el.className.slice(0, 80) : "", rect: { x: r.x, y: r.y, width: r.width, height: r.height }, hoverOnly, named: !!(el.getAttribute("aria-label") || el.getAttribute("title") || (el.innerText || "").trim() || el.getAttribute("aria-labelledby")) });
      i++;
    }
    return out;
  }, { rootSel, SEL: CONTROL_SEL });
}

async function snapshot(page, rootSel, errors) {
  return page.evaluate(({ rootSel, errors, popSel }) => {
    const root = document.querySelector(rootSel) || document.body;
    const states = [...root.querySelectorAll("[aria-pressed], [aria-checked], [aria-expanded], [aria-selected], input[type=checkbox]")]
      .map((e) => `${e.getAttribute("aria-pressed")}${e.getAttribute("aria-checked")}${e.getAttribute("aria-expanded")}${e.getAttribute("aria-selected")}${e.checked ?? ""}`).join(",");
    const popups = document.querySelectorAll(popSel).length;
    return { url: location.href, focused: document.activeElement ? `${document.activeElement.tagName}#${document.activeElement.id}.${document.activeElement.getAttribute("data-uisweep-i") ?? ""}` : "",
      focusIsField: !!(document.activeElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable)),
      popups, writes: (window.__blockedWrites || []).length + (window.__sentWrites || []).length, errors, states, mutations: window.__uisweepMut || 0, noise: window.__uisweepNoise || 0 };
  }, { rootSel, errors, popSel: POPUP_SEL });
}

async function watchMutations(page, ms) {
  // count mutations for `ms` with no input: that is the page's own background noise
  await page.evaluate(() => {
    if (!window.__uisweepObs) {
      window.__uisweepObs = new MutationObserver((l) => { window.__uisweepMut = (window.__uisweepMut || 0) + l.filter((m) => !(m.type === "attributes" && /^data-uisweep/.test(m.attributeName || ""))).length; });
      window.__uisweepObs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    window.__uisweepMut = 0;
  });
  await page.waitForTimeout(ms);
  await page.evaluate(() => { window.__uisweepNoise = window.__uisweepMut || 0; window.__uisweepMut = 0; });
}

async function restore(page, basePopups, baseUrl, surface, ctx, lastRow = null) {
  for (let k = 0; k < 4 && (await popupCount(page)) > basePopups; k++) { await page.keyboard.press("Escape"); await page.waitForTimeout(120); }
  if (page.url() !== baseUrl) { await page.goBack().catch(() => {}); await page.waitForTimeout(400); }
  // Something still on top of the surface (a dialog Escape did not close, a backdrop)? Name it on the row that
  // opened it, then start clean: a layer left over makes every later control read "covered".
  const cover = await page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel);
    if (!root) return null;
    const r = root.getBoundingClientRect();
    const pts = [[r.x + r.width / 2, r.y + Math.min(r.height / 2, 20)], [r.x + 10, r.y + 10]];
    for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const top = document.elementFromPoint(x, y);
      if (top && !root.contains(top) && !top.contains(root)) return `${top.tagName.toLowerCase()}.${(typeof top.className === "string" ? top.className : "").split(/\s+/).slice(0, 3).join(".")}`;
    }
    return null;
  }, surface.root).catch(() => null);
  if (cover) {
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    const still = await page.evaluate((rootSel) => { const root = document.querySelector(rootSel); if (!root) return false; const r = root.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 20)); return !!(t && !root.contains(t) && !t.contains(root)); }, surface.root).catch(() => false);
    if (still) {
      if (lastRow) lastRow.a11y = `${lastRow.a11y && lastRow.a11y !== "✅" ? lastRow.a11y + "; " : ""}✗ left open after Escape: ${cover}`;
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!document.querySelector("[data-panel-id]"), null, { timeout: 120000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('[data-testid="snapshot-pill"]'), null, { timeout: 120000 }).catch(() => {});
      await page.waitForTimeout(5000);
    }
  }
  // A modal's backdrop blocks every click whether or not the surface's root is still there (a radial closes when its item
  // opens a dialog, so the check above sees no root and no cover).
  const modal = () => page.evaluate(() => [...document.querySelectorAll('[data-state="open"][aria-hidden="true"], .fixed.inset-0, [data-image-picker]')].some((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width >= innerWidth - 2 && r.height >= innerHeight - 2 && cs.pointerEvents !== "none" && cs.display !== "none" && cs.visibility !== "hidden" && !e.closest("[data-panel-id]"); })).catch(() => false);
  if (await modal()) {
    await page.keyboard.press("Escape"); await page.waitForTimeout(250);
    if (await modal()) {
      if (lastRow) lastRow.a11y = `${lastRow.a11y && lastRow.a11y !== "✅" ? lastRow.a11y + "; " : ""}✗ modal left open after Escape`;
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!document.querySelector("[data-panel-id]") && !document.querySelector('[data-testid="snapshot-pill"]'), null, { timeout: 120000 }).catch(() => {});
      await page.waitForTimeout(5000);
    }
  }
  const moved = surface.baseHead !== undefined && (await pageHead(page)) !== surface.baseHead;
  if (moved || !(await page.$(surface.root))) await surface.open(page, ctx);
}

/** What the panels show: a control that navigated must not leave the rest of the surface crawled on another page. */
const pageHead = (page) => page.evaluate(() => [...document.querySelectorAll(".page-header-row-label")].map((e) => (e.innerText || "").trim()).join("|")).catch(() => "");

const MAX_RETRIES = 12;
async function freshLoad(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!document.querySelector("[data-panel-id]") && !document.querySelector('[data-testid="snapshot-pill"]'), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
}

/**
 * Crawl one surface. surface = { id, name, root, open(page, ctx), writes?, popupRoot? }.
 * opts: { vp, depth = 2, settleMs = 400, errors = [], maxControls = 80, axe = true }.
 * Returns report rows (report.mjs COLUMNS).
 */
export async function crawlSurface(page, surface, { budgetMs = 300000, vp = "desktop", depth = 2, settleMs = 400, errors = [], maxControls = 80, axe = true, ctx = {}, prefix = "" } = {}) {
  const touch = vp !== "desktop";
  const vpBox = page.viewportSize();
  await surface.open(page, ctx);
  await page.waitForTimeout(settleMs);
  const rows = [];
  const basePopups = await popupCount(page);
  const baseUrl = page.url();
  if (!(await page.$(surface.root))) throw new Error(`nothing matched "${surface.root}" after opening`);
  surface.baseHead = await pageHead(page);
  const first = await controlsIn(page, surface.root);
  const n = Math.min(first.length, maxControls);
  if (first.length > maxControls) rows.push({ id: surface.id, surface: surface.name, control: `(${first.length - maxControls} more not crawled)`, vp, works: "⚠", notes: `maxControls ${maxControls}` });
  const started = Date.now();
  let retries = 0, retriedAt = -1;
  for (let i = 0; i < n; i++) {
    if (Date.now() - started > budgetMs) { rows.push({ id: surface.id, surface: surface.name, control: `(stopped at the time limit; ${n - i} not crawled)`, vp, works: "⚠", notes: "" }); break; }
    const controls = await controlsIn(page, surface.root);
    const c = controls[i];
    if (!c) break;
    // A long list of like options (search hits, a 49-slot picker): the first few say what the rest would.
    const listy = (x) => x.role === "option" || /occ-search-row/.test(x.cls || "");
    const sameKind = controls.filter((x, j) => j < i && listy(x) && x.role === c.role && x.cls === c.cls);
    if (listy(c) && sameKind.length >= 6) { if (sameKind.length === 6) rows.push({ id: `${surface.id}${prefix}#${i}+`, surface: surface.name, control: `(${controls.filter((x) => listy(x) && x.cls === c.cls).length - 6} more like it, sampled)`, vp, works: "— sampled" }); continue; }
    await page.$eval(`[data-uisweep-i="${i}"]`, (el) => el.scrollIntoView({ block: "nearest", inline: "nearest" })).catch(() => {});
    await page.waitForTimeout(60);
    const fresh = await page.$eval(`[data-uisweep-i="${i}"]`, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }).catch(() => c.rect);
    c.rect = fresh;
    const row = { id: `${surface.id}${prefix}#${i}`, surface: surface.name, control: c.label, vp, works: "", reach: "", a11y: "", clear: "", fast: "", notes: "" };
    const reach = [];
    const onScreen = rectOnScreen(c.rect, vpBox);
    if (!onScreen.ok) reach.push(`off screen ${onScreen.offBy}px`);
    if (touch) { const t = tapSizeVerdict(c.rect.width, c.rect.height); if (t !== "ok") reach.push(`tap ${Math.round(c.rect.width)}×${Math.round(c.rect.height)} ${t === "fail" ? "<24" : "<32"}`); }
    if (c.hoverOnly) reach.push(touch ? "hover-only (no touch path?)" : "hover-only");
    const jargon = jargonHits(c.label);
    if (jargon.length) row.clear = `⚠ jargon: ${jargon.join(", ")}`;
    if (!c.named) row.a11y = "✗ no accessible name";
    if ((DESTRUCTIVE.test(c.label) && !surface.writes) || surface.skipRe?.test(c.label) || ALWAYS_SKIP.test(c.label)) { row.works = "— skipped (destructive)"; row.reach = reach.length ? `⚠ ${reach.join("; ")}` : "✅"; rows.push(row); continue; }

    const handle = await page.$(`[data-uisweep-i="${i}"]`);
    if (!handle) { row.works = "⚠ vanished"; rows.push(row); continue; }
    if (await handle.evaluate((el) => el.disabled || el.getAttribute("aria-disabled") === "true")) { row.works = "— disabled"; rows.push(row); continue; }
    if (c.hoverOnly) { await handle.evaluate((el) => el.parentElement?.scrollIntoView({ block: "center" })); const pr = await handle.evaluate((el) => { const r = el.parentElement.getBoundingClientRect(); return { x: r.x + 4, y: r.y + r.height / 2 }; }); await page.mouse.move(pr.x, pr.y); await page.waitForTimeout(150); }
    const hit = await hitTarget(page, handle);
    if (!hit.ok) reach.push(hit.why);
    await watchMutations(page, Math.min(250, settleMs));
    await page.evaluate((sel) => { for (const e of document.querySelectorAll(sel)) e.setAttribute("data-uisweep-pre", "1"); }, POPUP_SEL);
    const before = await snapshot(page, surface.root, errors.length);
    let t0 = Date.now(), activated = true;
    try {
      if (touch && !c.hoverOnly) await handle.tap({ timeout: 2500 });
      else await handle.click({ timeout: 2500 });
    } catch (e) { activated = false; reach.push(`could not activate: ${String(e.message).split("\n")[0].slice(0, 80)}`); }
    await page.waitForTimeout(settleMs);
    const after = await snapshot(page, surface.root, errors.length);
    const newTag = `${surface.id}-${i}`.replace(/[^a-z0-9-]/gi, "_");
    await page.evaluate(({ sel, tag }) => { for (const e of document.querySelectorAll(sel)) if (!e.hasAttribute("data-uisweep-pre") && !e.closest("[data-uisweep-pre]")) e.setAttribute("data-uisweep-new", tag); }, { sel: POPUP_SEL, tag: newTag });
    // Could not press it: usually a state an earlier control left (full screen, a viewer, a moved page), not this control.
    // Say so only if it still fails from a fresh load.
    if (!activated && retriedAt !== i && retries < MAX_RETRIES) {
      retries++; retriedAt = i;
      await freshLoad(page);
      await surface.open(page, ctx);
      await page.waitForTimeout(settleMs);
      i--;
      continue;
    }
    const outcome = activated ? classifyOutcome(before, after) : "unreachable";
    row.works = outcome === "nothing" ? "✗ nothing" : outcome === "error" ? `✗ error: ${errors[errors.length - 1]?.slice(0, 80)}` : outcome === "unreachable" ? "✗ unreachable" : `✅ ${outcome}`;
    row.fast = `${Date.now() - t0 - settleMs > 0 ? "" : ""}`;
    if (outcome === "opened" && axe) {
      const a = await runAxe(page, `[data-uisweep-new="${newTag}"]`).catch(() => null);
      if (a && (a.critical || a.serious)) row.a11y = `${row.a11y ? row.a11y + "; " : ""}✗ axe ${a.rules.map((r) => `${r.id}×${r.n}`).join(", ")}`;
      const popRects = await page.evaluate((tag) => [...document.querySelectorAll(`[data-uisweep-new="${tag}"]`)].map((e) => { if (e.matches(".radial-menu-items")) { const bs = [...e.querySelectorAll("button")].map((b) => b.getBoundingClientRect()); if (!bs.length) return { x: 0, y: 0, width: 0, height: 0 }; const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y)); return { x, y, width: Math.max(...bs.map((b) => b.right)) - x, height: Math.max(...bs.map((b) => b.bottom)) - y }; } const el = e.matches("[data-radix-popper-content-wrapper]") ? (e.firstElementChild || e) : e; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }), newTag);
      for (const r of popRects) { const o = rectOnScreen(r, vpBox); if (!o.ok && r.width) { reach.push(`popup off screen ${o.offBy}px`); break; } }
      if (depth > 1) {
        const sub = { id: `${surface.id}${prefix}#${i}`, name: `${surface.name} › ${c.label}`, root: `[data-uisweep-new="${newTag}"]`,
          writes: surface.writes, open: async (p) => { if (!(await p.$(sub.root))) { await restore(p, basePopups, baseUrl, surface, ctx); await controlsIn(p, surface.root); await p.evaluate((sel) => { for (const e of document.querySelectorAll(sel)) e.setAttribute("data-uisweep-pre", "1"); }, POPUP_SEL); const h = await p.$(`[data-uisweep-i="${i}"]`); if (h) await (touch ? h.tap() : h.click()).catch(() => {}); await p.waitForTimeout(settleMs); await p.evaluate(({ sel, tag }) => { for (const e of document.querySelectorAll(sel)) if (!e.hasAttribute("data-uisweep-pre") && !e.closest("[data-uisweep-pre]")) e.setAttribute("data-uisweep-new", tag); }, { sel: POPUP_SEL, tag: newTag }); } } };
        rows.push(row);
        rows.push(...await crawlSurface(page, sub, { budgetMs: 60000, vp, depth: depth - 1, settleMs, errors, maxControls: 60, axe: false, ctx, prefix: "" }));
        const esc = await escapeCloses(page);
        if (!esc.ok) row.a11y = `${row.a11y ? row.a11y + "; " : ""}✗ Escape does not close`;
        row.reach = reach.length ? `⚠ ${reach.join("; ")}` : "✅";
        await restore(page, basePopups, baseUrl, surface, ctx, row);
        continue;
      }
      const esc = await escapeCloses(page);
      if (!esc.ok) row.a11y = `${row.a11y ? row.a11y + "; " : ""}✗ Escape does not close`;
    }
    row.reach = reach.length ? `⚠ ${reach.join("; ")}` : "✅";
    if (!row.a11y) row.a11y = "✅";
    if (!row.clear) row.clear = "✅";
    rows.push(row);
    await restore(page, basePopups, baseUrl, surface, ctx, row);
  }
  return rows;
}
