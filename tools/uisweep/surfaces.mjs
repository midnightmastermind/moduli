// tools/uisweep/surfaces.mjs — every place in the app the sweep opens, by area.
//
// A surface = { id, area, name, from: [old sweep row numbers], root: selector the crawler looks inside,
//               open(page, ctx), writes?: true when its destructive controls may run (poms rebuild only),
//               vps?: ["desktop","phone",...] (default all), skip?: RegExp of control labels not to press }.
// `ctx` is shared across a run: ctx.panels = the panel ids in DOM order (filled by the first open).
//
// Open functions use REAL gestures: the settings forms switch tabs on a pointer PRESS, so element.click() from a
// script does nothing (2026-10-18 sweep note).

const tap = async (page, sel, { touch } = {}) => {
  const h = await page.waitForSelector(sel, { timeout: 8000, state: "visible" });
  await h.scrollIntoViewIfNeeded().catch(() => {});
  if (touch) await h.tap(); else await h.click();
  await page.waitForTimeout(500);
  return h;
};
const isPhone = (page) => (page.viewportSize()?.width || 1440) < 700;
async function panels(page, ctx) {
  ctx.panels = await page.evaluate(() => [...document.querySelectorAll("[data-panel-id]")].filter((p) => { const r = p.getBoundingClientRect(); if (!(r.width > 0 && r.right > 1 && r.left < innerWidth - 1 && r.bottom > 1 && r.top < innerHeight - 1)) return false;
    // A panel clipped by the phone viewport still reports its full rect (the next one starts at x=364 beside a
    // 26px rail): on screen means most of the panel's own width is inside the window.
    return Math.min(r.right, innerWidth) - Math.max(r.left, 0) > r.width / 2; }).map((p) => p.getAttribute("data-panel-id")));
  return ctx.panels;
}
const P = (id) => `[data-panel-id="${id}"]`;
/** the panel the sweep works in: the first visible one (on a phone, the one on screen). */
async function mainPanel(page, ctx) { const ps = await panels(page, ctx); return ps[0]; }
/** Press Escape until no popup is open. */
async function clear(page) { for (let i = 0; i < 4; i++) await page.keyboard.press("Escape"); await page.waitForTimeout(200); }
/** On a phone the toolbar's buttons live in the side drawer. */
async function openPhoneMenu(page) {
  if (await page.$("[data-toolbar-drawer]")) return;
  await tap(page, 'button[aria-label="Menu"], button[title="Menu"], [data-testid="toolbar"] button[aria-label*="menu" i]', { touch: true });
}
/** Make the main panel show `name` (search only when it does not already). */
export async function ensurePage(page, ctx, name) {
  const id = await mainPanel(page, ctx);
  const head = await page.$eval(`${P(id)} .page-header-row-label`, (e) => (e.innerText || "").trim()).catch(() => "");
  if (head !== name) await goTo(page, ctx, name);
}
/** Open the first match of `sel` inside the main panel. */
async function inPanel(page, ctx, sel, { touch, nth = 0 } = {}) {
  const id = await mainPanel(page, ctx);
  const hs = await page.$$(`${P(id)} ${sel}`);
  const h = hs[nth];
  if (!h) throw new Error(`no "${sel}" in panel ${id}`);
  await h.scrollIntoViewIfNeeded().catch(() => {});
  if (touch) await h.tap(); else await h.click();
  await page.waitForTimeout(600);
  return h;
}
/** The toolbar's timer panel stays in the DOM closed: open it through its compact bar. */
async function openPomodoro(page) {
  await clear(page);
  if (isPhone(page)) await openPhoneMenu(page);
  await tap(page, '[title*="remaining"]', { touch: isPhone(page) });
}
const POPUP_ONLY = '.menu-surface, .occ-search-menu, .command-palette, [data-radix-popper-content-wrapper], .context-menu, .header-dropdown, [data-sheet], [role="menu"], [role="dialog"], [role="listbox"]';
const POPUP = '.menu-surface, [role="menu"], [role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper], .context-menu, .radial-menu-items, .header-dropdown, [data-sheet]';
const CC = '[data-testid="command-center"], .command-center, [role="dialog"][aria-label*="Command" i]';

async function openCC(page, tab, { touch }) {
  await clear(page);
  if (isPhone(page)) await openPhoneMenu(page);
  await tap(page, 'button[aria-label="Open command center"], button[title="Open command center"], [data-toolbar-drawer] button:has-text("Command Center")', { touch });
  if (tab) {
    const t = await page.waitForSelector(`${CC} [role="tab"]:has-text("${tab}"), ${CC} button:has-text("${tab}")`, { timeout: 8000 });
    if (touch) await t.tap(); else await t.click();
    await page.waitForTimeout(800);
  }
}

/** Go to a page (or a row) by the panel's search: the hit whose name is exactly `name`, not a folder unless `kind`
 *  says so (kind = a regex against the hit's kind line: "BOARD PAGE", "DOC PAGE", "FOLDER", "BOARD" …). */
export async function goTo(page, ctx, name, kind = null) {
  await clear(page);
  await inPanel(page, ctx, "button.occ-search-trigger", { touch: isPhone(page) });
  await page.keyboard.type(name, { delay: 20 });
  await page.waitForTimeout(1500);
  const idx = await page.$$eval(".occ-search-menu .occ-search-row", (rows, { name, kind }) => {
    const info = rows.map((r) => { const l = (r.innerText || "").split("\n").map((x) => x.trim()).filter(Boolean); return { n: l[0] || "", k: l[1] || "" }; });
    const re = kind ? new RegExp(kind, "i") : null;
    let i = info.findIndex((x) => x.n.toLowerCase() === name.toLowerCase() && (re ? re.test(x.k) : !/folder/i.test(x.k)));
    if (i < 0) i = info.findIndex((x) => x.n.toLowerCase().startsWith(name.toLowerCase()) && !/folder/i.test(x.k));
    return i;
  }, { name, kind });
  if (idx < 0) throw new Error(`search "${name}": no matching hit`);
  const rows = await page.$$(".occ-search-menu .occ-search-row");
  if (isPhone(page)) await rows[idx].tap(); else await rows[idx].click();
  await page.waitForTimeout(2500);
}
/** Right-click (desktop) the first match of sel in the main panel. */
async function context(page, ctx, sel) {
  await clear(page);
  const id = await mainPanel(page, ctx);
  const h = await page.$(`${P(id)} ${sel}`);
  if (!h) throw new Error(`no "${sel}"`);
  await h.scrollIntoViewIfNeeded().catch(() => {});
  await h.click({ button: "right" });
  await page.waitForTimeout(600);
}
const pageRoot = async (page, ctx) => { const id = await mainPanel(page, ctx); ctx.root = `${P(id)}`; };

export const SURFACES = [
  // ── toolbar ────────────────────────────────────────────────────────────────
  { id: "toolbar", area: "toolbar", name: "Toolbar", from: [1, 2, 3, 4, 6], root: '[data-testid="toolbar"]',
    open: async (page) => { await clear(page); } },
  { id: "phone.menu", area: "toolbar", name: "Phone side menu", from: [1, 2, 3, 4, 58], vps: ["phone", "phone-land"], root: "[data-toolbar-drawer]",
    open: async (page) => { await clear(page); await openPhoneMenu(page); } },
  { id: "toolbar.pomodoro", area: "toolbar", name: "Pomodoro panel", from: [3], root: "[data-pomodoro-panel]",
    open: async (page) => { await openPomodoro(page); } },
  { id: "search", area: "toolbar", name: "Occurrence search", from: [5], root: ".occ-search-menu",
    open: async (page, ctx) => { await clear(page); await inPanel(page, ctx, "button.occ-search-trigger", { touch: isPhone(page) }); await page.keyboard.type("dr"); await page.waitForTimeout(800); } },

  // ── command center ────────────────────────────────────────────────────────
  ...[["Grid", 8], ["Fields", 9], ["Operations", 10], ["Imports", 12], ["Appearance", 13], ["Connections", 15], ["Shortcuts", 16]].map(([tab, row]) => ({
    id: `cc.${tab.toLowerCase()}`, area: "commandCenter", name: `Command Center › ${tab}`, from: [7, row, ...(tab === "Grid" ? [11, 14] : [])], root: CC,
    open: async (page) => openCC(page, tab, { touch: isPhone(page) }),
  })),

  // ── panel + page header ───────────────────────────────────────────────────
  { id: "panel.header", area: "header", name: "Panel + page header", from: [17, 18, 47], root: "PANEL .page-header",
    open: async (page, ctx) => { await ensurePage(page, ctx, "Tasks"); const id = await mainPanel(page, ctx); ctx.root = `${P(id)} .page-header`; } },
  { id: "page.header", area: "header", name: "Page header row (radial, search, magic, filters, +, close)", from: [18], root: "PANEL",
    open: async (page, ctx) => { await ensurePage(page, ctx, "Tasks"); const id = await mainPanel(page, ctx); ctx.root = `${P(id)} .page-header-row`; } },
  { id: "header.dropdown", area: "header", name: "Header dropdown (Filter · Sort · Data · Fields · Layout)", from: [26, 27, 28, 29, 30], root: ".header-dropdown, [data-radix-popper-content-wrapper]",
    open: async (page, ctx) => { await ensurePage(page, ctx, "Tasks"); await inPanel(page, ctx, ".page-header-row button.header-chevron", { touch: isPhone(page) }); } },
  { id: "panel.tree", area: "drawers", name: "Manifest tree", from: [47], root: ".manifest-tree, [data-manifest-tree]",
    open: async (page, ctx) => { await clear(page); await inPanel(page, ctx, "button.panel-files-btn", { touch: isPhone(page) }); } },

  // ── radial menus ──────────────────────────────────────────────────────────
  { id: "radial.panel", area: "radial", name: "Panel radial", from: [17, 18], root: ".radial-menu-items",
    open: async (page, ctx) => { await ensurePage(page, ctx, "Tasks"); await inPanel(page, ctx, ".page-header button.radial-handle", { touch: isPhone(page) }); } },
  { id: "radial.container", area: "radial", name: "Container radial", from: [19], root: ".radial-menu-items",
    open: async (page, ctx) => { await ensurePage(page, ctx, "Tasks"); await inPanel(page, ctx, ".container-shell .container-header button.radial-handle", { touch: isPhone(page) }); } },
  { id: "radial.row", area: "radial", name: "Row radial", from: [20], root: ".radial-menu-items",
    open: async (page, ctx) => { await ensurePage(page, ctx, "Tasks"); await inPanel(page, ctx, ".instance-wrap button.radial-handle", { touch: isPhone(page) }); } },

  // ── settings forms (opened from each radial's Settings) ───────────────────
  ...[["panel", ".page-header button.radial-handle", 23], ["container", ".container-shell .container-header button.radial-handle", 24], ["row", ".instance-wrap button.radial-handle", 25]].map(([who, handle, row]) => ({
    id: `settings.${who}`, area: "settings", name: `${who[0].toUpperCase()}${who.slice(1)} settings form`, from: [row], root: '[role="dialog"], .settings-form, [data-settings-form]',
    open: async (page, ctx) => {
      await ensurePage(page, ctx, "Tasks");
      await inPanel(page, ctx, handle, { touch: isPhone(page) });
      const item = await page.waitForSelector('.radial-menu-items [title="Settings"], .radial-menu-items [aria-label="Settings"]', { timeout: 6000 });
      if (isPhone(page)) await item.tap(); else await item.click();
      await page.waitForTimeout(800);
    },
  })),

  // ── add / pick ────────────────────────────────────────────────────────────
  { id: "add.container", area: "add", name: "Container + (quick add)", from: [32], root: POPUP,
    open: async (page, ctx) => { await ensurePage(page, ctx, "Tasks"); await inPanel(page, ctx, ".container-shell button.quick-add-btn", { touch: isPhone(page) }); } },
  { id: "add.page", area: "add", name: "Page + (add container)", from: [32], root: POPUP,
    open: async (page, ctx) => { await ensurePage(page, ctx, "Trackers"); await inPanel(page, ctx, '.page-header-row button.quick-add-btn, .page-header-row button[title="Add container"]', { touch: isPhone(page) }); } },
  { id: "row.fields", area: "add", name: "A row's own controls (fields, notes, + field)", from: [33, 34, 48], root: "ROW",
    open: async (page, ctx) => { await ensurePage(page, ctx, "Tasks"); const id = await mainPanel(page, ctx); const rid = await page.$eval(`${P(id)} .instance-wrap [data-occurrence-id], ${P(id)} [data-occurrence-id]`, (e) => e.getAttribute("data-occurrence-id")); ctx.root = `${P(id)} [data-occurrence-id="${rid}"]`; } },
  { id: "row.fieldAdd", area: "add", name: "Row › Add a field menu", from: [], root: POPUP,
    open: async (page, ctx) => { await ensurePage(page, ctx, "Tasks"); const id = await mainPanel(page, ctx); const h = await page.$(`${P(id)} .instance-wrap`); await h.hover(); await page.waitForTimeout(200); await inPanel(page, ctx, '.instance-wrap button[aria-label="Add a field"]', { touch: isPhone(page) }); } },
  // ── docs ──────────────────────────────────────────────────────────────────
  { id: "docs.page", area: "docs", name: "Doc page (Basic Nutrition Guide)", from: [43, 44, 46], root: "PANEL",
    open: async (page, ctx) => { await goTo(page, ctx, "Basic Nutrition Guide"); await pageRoot(page, ctx); } },
  { id: "docs.article", area: "docs", name: "Imported article (Bonsai): sections, wraps, pictures", from: [21, 22, "22a", 46], root: "PANEL",
    open: async (page, ctx) => { await goTo(page, ctx, "Bonsai"); await pageRoot(page, ctx); } },
  { id: "docs.chips", area: "docs", name: "Article with link chips (Noam Chomsky)", from: [22], root: "PANEL",
    open: async (page, ctx) => { await goTo(page, ctx, "Noam Chomsky"); await pageRoot(page, ctx); } },
  { id: "docs.context", area: "context", name: "Doc right-click menu", from: [45, 41], vps: ["desktop"], root: ".menu-surface",
    open: async (page, ctx) => { await goTo(page, ctx, "Basic Nutrition Guide"); await context(page, ctx, ".ProseMirror p"); } },
  { id: "docs.slash", area: "docs", name: "Slash palette + @ picker", from: [43], root: ".command-palette",
    open: async (page, ctx) => {
      await goTo(page, ctx, "Basic Nutrition Guide");
      const id = await mainPanel(page, ctx);
      const ed = await page.$(`${P(id)} .doc-editor-content`);
      const b = await ed.boundingBox();
      await page.mouse.click(b.x + 20, b.y + b.height - 6);
      await page.waitForTimeout(700);
      await page.keyboard.type("/");
      await page.waitForTimeout(700);
    } },

  // ── context menus ─────────────────────────────────────────────────────────
  { id: "context.row", area: "context", name: "Row right-click menu", from: [40, 42], vps: ["desktop"], root: ".menu-surface",
    open: async (page, ctx) => { await goTo(page, ctx, "Tasks"); await context(page, ctx, ".instance-wrap .instance-label, .instance-wrap"); } },
  { id: "context.container", area: "context", name: "Container right-click menu", from: [40], vps: ["desktop"], root: ".menu-surface",
    open: async (page, ctx) => { await goTo(page, ctx, "Tasks"); await context(page, ctx, ".container-shell .container-header"); } },
  { id: "context.panel", area: "context", name: "Page right-click menu", from: [40], vps: ["desktop"], root: ".menu-surface",
    open: async (page, ctx) => { await goTo(page, ctx, "Tasks"); await context(page, ctx, ".page-header"); } },
  { id: "context.tree", area: "context", name: "Manifest tree right-click", from: [40, 47], vps: ["desktop"], root: ".menu-surface",
    open: async (page, ctx) => { await clear(page); await inPanel(page, ctx, "button.panel-files-btn"); const pid = await mainPanel(page, ctx); await page.click(`${P(pid)} .manifest-tree .folder-open-btn`, { button: "right" }); await page.waitForTimeout(500); } },
  { id: "context.text", area: "context", name: "Text right-click (cut/copy/paste, Define)", from: [41], vps: ["desktop"], root: ".menu-surface",
    open: async (page, ctx) => { await goTo(page, ctx, "Bonsai"); const id = await mainPanel(page, ctx); const p = await page.$(`${P(id)} .ProseMirror p`); await p.scrollIntoViewIfNeeded(); const b = await p.boundingBox(); const x = b.x + 40, y = b.y + 8;
      // Coordinates: the press swaps a lazy block's stand-in for its editor, so the element handle goes stale.
      await page.mouse.dblclick(x, y); await page.waitForTimeout(500); await page.mouse.click(x, y, { button: "right" }); await page.waitForTimeout(500); } },

  // ── templates / pickers ───────────────────────────────────────────────────
  { id: "templates", area: "add", name: "Templates section (Apply / Merge / Copy / Save)", from: [31], root: POPUP,
    open: async (page, ctx) => {
      await goTo(page, ctx, "Tasks");
      await inPanel(page, ctx, ".container-shell .container-header button.radial-handle", { touch: isPhone(page) });
      const t = await page.waitForSelector('.radial-menu-items [title="Apply Template"], .radial-menu-items [aria-label="Apply Template"]', { timeout: 6000 });
      if (isPhone(page)) await t.tap(); else await t.click();
      await page.waitForTimeout(700);
    } },
  { id: "pick.cover", area: "add", name: "Image picker (Set cover image)", from: [35], vps: ["desktop"], root: '[role="dialog"]',
    open: async (page, ctx) => {
      // A row's cover is on its radial; an artifact card's right-click has one too.
      await goTo(page, ctx, "Sample Files");
      await inPanel(page, ctx, ".instance-wrap button.radial-handle");
      const it = await page.waitForSelector('.radial-menu-items [title*="over" i]', { timeout: 6000 });
      await it.click(); await page.waitForTimeout(1500);
    } },
  { id: "pick.destination", area: "add", name: "Destination picker (Pomodoro › Send pomodoros to)", from: [36, 3], root: POPUP,
    open: async (page) => {
      await openPomodoro(page);
      await tap(page, 'button[aria-label="Choose destination"], button[title="Choose destination"]', { touch: isPhone(page) });
    } },

  // ── viewers ───────────────────────────────────────────────────────────────
  { id: "viewer.spread", area: "viewers", name: "Artifact viewer from a cover (Books)", from: [50, 51], root: '.artifact-spread, [role="dialog"]',
    open: async (page, ctx) => { await goTo(page, ctx, "Sample Files"); await inPanel(page, ctx, ".instance-wrap img, .instance-wrap .artifact-thumb", { touch: isPhone(page) }); await page.waitForTimeout(1500); } },
  { id: "viewer.image", area: "viewers", name: "Image file page (zoom, OCR tabs)", from: [52], root: "PANEL",
    open: async (page, ctx) => { await goTo(page, ctx, "National Geographic.jpg"); await pageRoot(page, ctx); } },
  { id: "viewer.pdf", area: "viewers", name: "PDF file page", from: [52], root: "PANEL",
    open: async (page, ctx) => { await goTo(page, ctx, "W3C dummy.pdf"); await pageRoot(page, ctx); } },
  { id: "viewer.video", area: "viewers", name: "Video file page", from: [52], root: "PANEL",
    open: async (page, ctx) => { await goTo(page, ctx, "Big Buck Bunny"); await pageRoot(page, ctx); } },
  { id: "viewer.bookmark", area: "viewers", name: "Bookmark (Web / Reader / Magic)", from: [53], root: "PANEL",
    open: async (page, ctx) => { await goTo(page, ctx, "Tea ceremony"); await pageRoot(page, ctx); } },

  // ── table / graph / board pages ───────────────────────────────────────────
  { id: "table.page", area: "table", name: "Table page (Schedule Table)", from: [55], root: "PANEL",
    open: async (page, ctx) => { await goTo(page, ctx, "Schedule Table"); await pageRoot(page, ctx); } },
  { id: "graph", area: "graph", name: "Graph container (Emotions Wheel)", from: [56], root: "PANEL",
    open: async (page, ctx) => { await goTo(page, ctx, "Emotions Wheel"); await pageRoot(page, ctx); } },
  { id: "board.trackers", area: "table", name: "Trackers page", from: [], root: "PANEL",
    open: async (page, ctx) => { await goTo(page, ctx, "Trackers"); await pageRoot(page, ctx); } },
  { id: "board.schedule", area: "table", name: "Schedule page (day columns, slots)", from: [], root: "PANEL",
    open: async (page, ctx) => { await goTo(page, ctx, "Schedule"); await pageRoot(page, ctx); } },
  { id: "canvas", area: "canvas", name: "Canvas page", from: [54], root: "PANEL",
    open: async (page, ctx) => { await goTo(page, ctx, "Sweep Canvas"); await pageRoot(page, ctx); } },

  // ── layout / phone nav ────────────────────────────────────────────────────
  { id: "layout.phone", area: "phone", name: "Phone grid nav (rails, panel picker)", from: [58], vps: ["phone", "phone-land"], root: "body",
    open: async (page) => { await clear(page); } },
  { id: "layout.mosaic", area: "layout", name: "Mosaic splitters + snap bar", from: [57], vps: ["desktop"], root: ".grid-mosaic, .grid-frame",
    open: async (page) => { await clear(page); } },

  // ── drawers ───────────────────────────────────────────────────────────────
  { id: "jonah", area: "drawers", name: "Jonah drawer", from: [49], root: ".assistant-drawer, [data-assistant-drawer]",
    open: async (page) => { await clear(page); await tap(page, 'button[aria-label^="Jonah"], button[title^="Jonah"]', { touch: isPhone(page) }); } },
  { id: "row.body", area: "drawers", name: "Row notes drawer", from: [48], root: "ROW",
    open: async (page, ctx) => { await goTo(page, ctx, "Tasks"); const id = await mainPanel(page, ctx); const h = await page.$(`${P(id)} .instance-wrap`); await h.hover(); await inPanel(page, ctx, '.instance-wrap button[aria-label="Show notes"]', { touch: isPhone(page) }); ctx.root = `${P(id)} .instance-doc-body`; } },

  // ── sharing / account / forms ─────────────────────────────────────────────
  { id: "share.place", area: "sharing", name: "Share placement window", from: [59], root: "body", open: async (page, ctx) => { await page.goto(`${ctx.site}/share-place?stage=${ctx.stage?.id}&k=${ctx.stage?.key}`); await page.waitForTimeout(3000); } },
  { id: "share.pending", area: "sharing", name: "Share pending page", from: [60], vps: ["phone"], root: "body", open: async (page, ctx) => { await page.goto(`${ctx.site}/share-pending`); await page.waitForTimeout(2000); } },
  { id: "extension", area: "sharing", name: "Browser extension popup", from: [61], vps: ["desktop"], root: "body", manual: true, open: async () => {} },
  { id: "account", area: "account", name: "Account menu", from: [62], root: POPUP, open: async (page) => { await clear(page); if (isPhone(page)) await openPhoneMenu(page); else await tap(page, 'button[aria-label="Account"], button[title="Account"]'); } },
  { id: "forms.button", area: "forms", name: "A button's form (New …)", from: [39, 37, 38], root: '[data-testid="form-modal"]',
    open: async (page, ctx) => { await goTo(page, ctx, "Sweep Fields"); await inPanel(page, ctx, 'button:has-text("Open form")', { touch: isPhone(page) }); } },
];

/** Resolve a surface's dynamic root ("PANEL …", "ROW") after its open() set ctx.root. */
export function rootFor(surface, ctx) {
  return /^(PANEL|ROW)$/.test(surface.root) || /^PANEL /.test(surface.root) ? ctx.root : surface.root;
}

export const AREAS = [...new Set(SURFACES.map((s) => s.area))];
