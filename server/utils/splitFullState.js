/**
 * Split `full_state` into what the user is LOOKING AT and what merely exists.
 *
 * ── WHY, MEASURED ──────────────────────────────────────────────────────────
 *
 * User, 2026-08-29: *"the load times are terrible on tablet. but it could be my
 * internet."* It is not (only) the internet. Measured at a tablet viewport:
 *
 *     full_state over the socket   28.74 MB decompressed   (5 frames)
 *     all HTTP for the whole app    1.85 MB                (34 requests)
 *
 * The bundle is fine; the GRID STATE is the load. And the tablet pays it twice —
 * once to inflate it, once to `JSON.parse` it on the main thread — whatever the
 * network is doing.
 *
 * THE OBVIOUS LEVER IS THE WRONG ONE, and measuring is what said so. Textmaps
 * look like the weight and are 4% of it (1.20 MB of 29.31 MB), which is also why
 * the 2026-04-11 "All Textmaps Upfront" revert was right. The weight is record
 * COUNT, and 80% of it is a catalogue nobody has open:
 *
 *     artifact   15,708 occurrences   16.15 MB   of 20.22 MB
 *        song 5,484 · album 3,027 · bookmark 1,467 · artist 1,679 · movie 993
 *     textblock   2,434   2.57 MB
 *     container   1,654   1.65 MB
 *     instance    1,206   1.07 MB
 *     page          202   0.16 MB
 *
 * Tasks, Trackers, Schedule and Projects are the instance/container/page rows —
 * about 3,000 occurrences. The Spotify and Calibre imports ride along on every
 * load of every device.
 *
 * ── PROGRESSIVE, NOT ON-DEMAND, AND THAT IS THE SAFE HALF ──────────────────
 *
 * Everything is still sent, just in two messages: the working surfaces first so
 * the grid paints, then the catalogue immediately behind it. Nothing is
 * withheld, so the 19 operations that walk `$allItems` over every row (measured
 * 2026-08-25 (2)) see exactly what they saw before — the client simply waits for
 * the second message before running its load sweep.
 *
 * True on-demand loading would save more and needs those ops audited one by one;
 * that is a separate, larger piece of work and is deliberately not this.
 *
 * ── THE SPLIT NAMES A ROLE, NOT A BOARD ────────────────────────────────────
 *
 * `role: "artifact"` is the whole rule. No label, no folder, no board id — those
 * are all one rename away from wrong, and this file records a migration that
 * moved a real page because a copied marker looked authoritative.
 *
 * AND AN ARTIFACT'S MODULE GOES WITH IT, because a module with no placement
 * renders nothing: shipping the module early buys nothing and costs 7.42 MB of
 * the payload. A module is deferred only when NOTHING in the core set places it,
 * so a poster shared with a working row is never held back.
 */

/** Occurrence roles held back for the second message. */
export const DEFERRED_ROLES = Object.freeze(["artifact"]);

/**
 * @param {Array} occurrences  every occurrence on the grid
 * @param {Array} modules      every module on the grid
 * @returns {{ core, deferred, coreModules, deferredModules }}
 */
export function splitFullState(occurrences = [], modules = []) {
  const modById = new Map(modules.map((m) => [m?.id, m]));
  const deferredRole = new Set(DEFERRED_ROLES);

  const core = [], deferred = [];
  for (const o of occurrences) {
    const role = modById.get(o?.moduleId)?.role;
    (deferredRole.has(role) ? deferred : core).push(o);
  }

  // A picture a working document EMBEDS is part of that document. Held back with
  // the catalogue, an open doc drew "embed: <id>" for every picture until the last
  // deferred chunk landed (Philosopher's Stone, 2026-10-22: 49 placeholders for
  // ~6s). One level is enough: an artifact's own textmap is never walked here.
  const embeddedByCore = new Set();
  for (const o of core) if (o?.textmap) collectEmbedIds(o.textmap, embeddedByCore);
  if (embeddedByCore.size) {
    for (let i = deferred.length - 1; i >= 0; i--) {
      if (embeddedByCore.has(deferred[i]?.id)) core.push(deferred.splice(i, 1)[0]);
    }
  }

  // A module is only deferred when nothing in the CORE set places it. An
  // artifact module that also backs a working row must arrive with the core, or
  // that row renders module-less until the second message lands.
  const placedByCore = new Set(core.map((o) => o?.moduleId));
  const coreModules = [], deferredModules = [];
  for (const m of modules) {
    const holdable = deferredRole.has(m?.role) && !placedByCore.has(m?.id);
    (holdable ? deferredModules : coreModules).push(m);
  }

  return { core, deferred, coreModules, deferredModules };
}

/** Every `attrs.occurrenceId` in a TipTap JSON tree (embeds, wrap members, pills). */
function collectEmbedIds(node, out) {
  if (!node || typeof node !== "object") return;
  const id = node.attrs?.occurrenceId;
  if (typeof id === "string" && id) out.add(id);
  if (Array.isArray(node.content)) for (const c of node.content) collectEmbedIds(c, out);
}

/**
 * HOLD BACK THE TEXT OF PAGES NOBODY HAS OPEN (user, 2026-10-31: "lets try to drop down that time"; answer: hold
 * it back). Measured that day: document text was 9.8 MB of a 32.7 MB first message — ~1,300 notes pages, none of
 * them on screen. (In April it was 1.2 MB and deferring it was rightly reverted.)
 *
 * The rows themselves stay in the first message (ops and the tree need them); only `textmap` moves to the second,
 * keyed by id. KEPT: everything reachable DOWN from `keepRootIds` (the panels and the pages they show) through
 * `occurrences[]` and textmap embeds — except that a FOLDER page's children are not followed (the Root folder page
 * would pull in every note; a preview card's text arrives a moment later). HELD: text on rows reachable from some
 * OTHER page and not kept. A row under no page (a loose chip) keeps its text. Pure.
 *
 * @returns {{ core, textmaps }} core with held rows' textmap removed and `textHeld: true` (new objects), textmaps { id: textmap }
 */
export function holdBackText(core = [], { keepRootIds = [], modules = [] } = {}) {
  const modById = new Map(modules.map((m) => [m?.id, m]));
  const byId = new Map(core.map((o) => [o?.id, o]));
  const isFolderPage = (o) => { const m = modById.get(o?.moduleId); return m?.role === "page" && m?.kind === "folder"; };
  const isPage = (o) => modById.get(o?.moduleId)?.role === "page";
  const children = (o) => {
    const out = [...(o?.occurrences || [])];
    if (o?.textmap && typeof o.textmap === "object") { const s = new Set(); collectEmbedIds(o.textmap, s); out.push(...s); }
    return out;
  };
  const walk = (roots, seen, stopAtFolders) => {
    const stack = [...roots];
    while (stack.length) {
      const id = stack.pop();
      if (!id || seen.has(id)) continue;
      const o = byId.get(id);
      if (!o) continue;
      seen.add(id);
      if (stopAtFolders && isFolderPage(o)) continue;
      for (const c of children(o)) if (!seen.has(c)) stack.push(c);
    }
    return seen;
  };
  const kept = walk(keepRootIds, new Set(), true);
  const underPages = walk(core.filter((o) => isPage(o) && !kept.has(o.id)).map((o) => o.id), new Set(), false);
  const textmaps = {};
  const out = core.map((o) => {
    if (!o?.textmap || kept.has(o.id) || !underPages.has(o.id)) return o;
    textmaps[o.id] = o.textmap;
    const { textmap, ...rest } = o;
    // Marked, so a reconnecting tab knows the text it holds in memory is to be replaced by the copy that follows.
    return { ...rest, textHeld: true };
  });
  return { core: out, textmaps };
}

/**
 * SHOWN PAGES FIRST (user, 2026-11-03: "we have panels with multiple pages technically inside of them, so i want to
 * make sure those arent being loaded in too right away. Just the shown pages").
 *
 * Measured on poms grid that day: the first message carried 15,775 rows (~28 MB) and the four pages on screen needed
 * 3,706 of them (~3.9 MB). 3,226 sat under pages pinned to a panel but not shown, and 8,843 under no panel page.
 *
 * The first message keeps:
 *  - everything reachable DOWN from `shownRootIds` (each panel and the page it shows) through `occurrences[]` and
 *    textmap embeds. A page reached on the way that is not itself shown keeps its ROW only (its tab, card and tree
 *    entry need the row; its content follows). A FOLDER page keeps its children's rows (its cards) but not below.
 *  - every page and panel row on the grid, so the tree, tabs and menus are whole from the start;
 *  - one hop of references from the kept rows: an occurrence a field value names (a picked Beverage, a Meal), and a
 *    feed copy's source — so a shown pill reads its picked row's name at once.
 * Everything else is sent in the second message, which the client waits for before any operation runs.
 * Modules follow the same rule as `splitFullState`: a module goes later only when nothing kept places it. Pure.
 *
 * @returns {{ core, deferred, coreModules, deferredModules }}
 */
export function splitShownFirst(occurrences = [], modules = [], { shownRootIds = [] } = {}) {
  const modById = new Map(modules.map((m) => [m?.id, m]));
  const byId = new Map(occurrences.map((o) => [o?.id, o]));
  const role = (o) => modById.get(o?.moduleId)?.role;
  const isFolderPage = (o) => { const m = modById.get(o?.moduleId); return m?.role === "page" && m?.kind === "folder"; };
  const children = (o) => {
    const out = [...(o?.occurrences || [])];
    if (o?.textmap && typeof o.textmap === "object") { const s = new Set(); collectEmbedIds(o.textmap, s); out.push(...s); }
    return out;
  };
  const roots = new Set(shownRootIds.filter(Boolean));
  const keep = new Set();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop();
    if (!id || keep.has(id)) continue;
    const o = byId.get(id);
    if (!o) continue;
    keep.add(id);
    const r = role(o);
    if (r === "page" && !roots.has(id)) continue;
    if (isFolderPage(o)) { for (const c of o.occurrences || []) if (byId.has(c)) keep.add(c); continue; }
    for (const c of children(o)) if (!keep.has(c)) stack.push(c);
  }
  for (const o of occurrences) { const r = role(o); if (r === "page" || r === "panel") keep.add(o.id); }
  const refs = (v, depth = 0) => {
    if (v == null || depth > 3) return;
    if (typeof v === "string") { if (byId.has(v)) keep.add(v); return; }
    if (Array.isArray(v)) { for (const x of v) refs(x, depth + 1); return; }
    if (typeof v === "object") { if ("value" in v) refs(v.value, depth + 1); }
  };
  for (const id of [...keep]) {
    const o = byId.get(id);
    for (const cell of Object.values(o?.fields || {})) refs(cell);
    if (o?.meta?.feedSourceId && byId.has(o.meta.feedSourceId)) keep.add(o.meta.feedSourceId);
  }
  const core = [], deferred = [];
  for (const o of occurrences) (keep.has(o?.id) ? core : deferred).push(o);
  const placedByCore = new Set(core.map((o) => o?.moduleId));
  const coreModules = [], deferredModules = [];
  for (const m of modules) (placedByCore.has(m?.id) ? coreModules : deferredModules).push(m);
  return { core, deferred, coreModules, deferredModules };
}
