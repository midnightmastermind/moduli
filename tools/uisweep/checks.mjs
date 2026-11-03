// tools/uisweep/checks.mjs — what "works, reachable, accessible, clear" means, as checks.
import path from "node:path";
import { createRequire } from "node:module";

/** A rect against a viewport: ok, or how many px it pokes out (the worst side). */
export function rectOnScreen(r, vp) {
  const off = Math.max(0, -r.x, -r.y, r.x + r.width - vp.width, r.y + r.height - vp.height);
  return { ok: off <= 0.5, offBy: Math.round(off) };
}

/** WCAG 2.5.8 floor is 24px; the app's own phone target (2026-11-02) is 32px. */
export function tapSizeVerdict(w, h) {
  const m = Math.min(w, h);
  return m < 24 ? "fail" : m < 32 ? "small" : "ok";
}

// Words a person who has never seen the code would not know. (The Command Center's Operations editor is a power
// tool and is checked without this list.) "copy-link" with a hyphen is the app's own name for the drag mode.
const JARGON = ["occurrence", "occurrences", "module", "modules", "instance", "instances", "textmap", "pipeline", "predicate", "copylink", "parentid", "moduleid", "undefined", "null", "nan", "[object object]"];
export function jargonHits(text) {
  const t = String(text || "").toLowerCase();
  const hits = JARGON.filter((w) => new RegExp(`(^|[^a-z-])${w.replace(/[[\]]/g, "\\$&")}([^a-z-]|$)`).test(t));
  // a raw id: 12+ chars of [A-Za-z0-9_-] with both a letter and a digit
  for (const m of String(text || "").matchAll(/[A-Za-z0-9_-]{12,}/g)) if (/\d/.test(m[0]) && /[a-z]/i.test(m[0]) && !/^[a-z]+(-[a-z]+)+$/.test(m[0])) hits.push(m[0]);
  return [...new Set(hits.filter((h) => h !== "modules" || !hits.includes("module")))];
}

// ── page helpers ──────────────────────────────────────────────────────────────

/** elementFromPoint at the centre IS the element (or inside it). Identity, never text. */
export async function hitTarget(page, handle) {
  return handle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return { ok: false, why: "no box" };
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const top = document.elementFromPoint(x, y);
    if (!top) return { ok: false, why: "off screen" };
    if (top === el || el.contains(top)) return { ok: true };
    const name = (n) => `${n.tagName.toLowerCase()}${n.className && typeof n.className === "string" ? "." + n.className.split(/\s+/).slice(0, 2).join(".") : ""}`;
    return { ok: false, why: `covered by ${name(top)} "${(top.getAttribute("aria-label") || top.title || top.textContent || "").trim().slice(0, 30)}"` };
  });
}

export async function noSideScroll(page) {
  return page.evaluate(() => ({ ok: document.documentElement.scrollWidth <= window.innerWidth + 1, scrollWidth: document.documentElement.scrollWidth, width: window.innerWidth }));
}

/** How many popups are open (menus, dialogs, listboxes, Radix layers, the app's sheets). */
export async function popupCount(page) {
  return page.evaluate(() => document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper], .context-menu, .radial-menu, [data-sheet], .header-dropdown').length);
}

export async function escapeCloses(page) {
  const before = await popupCount(page);
  if (!before) return { ok: true, skipped: true };
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  const after = await popupCount(page);
  return { ok: after < before, before, after };
}

const require = createRequire(import.meta.url);
let axeSource = null;
/** axe-core over a root (default the whole page). Returns counts by impact and the serious+critical rule ids. */
export async function runAxe(page, rootSel = null) {
  if (!axeSource) axeSource = (await import("node:fs")).readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  await page.evaluate(axeSource);
  const res = await page.evaluate(async (sel) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(sel ? document.querySelector(sel) || document : document, { runOnly: ["wcag2a", "wcag2aa", "wcag22aa"], resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes[0]?.target?.join(" ") }));
  }, rootSel);
  const by = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of res) by[v.impact] = (by[v.impact] || 0) + v.n;
  return { ...by, rules: res.filter((v) => v.impact === "critical" || v.impact === "serious") };
}
