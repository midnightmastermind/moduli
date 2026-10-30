// helpers/lazyEditor.js
// ============================================================================
// One decision, one place: "is this textblock's real editor mounted yet?"
//
// A live TipTap/ProseMirror instance per textblock is the app's dominant render
// cost. TextblockCard has carried this optimisation alone; the doc BLOCK path
// (246 of poms grid's 1036 textblocks) mounts eagerly. Extracting it here is
// what lets both share ONE implementation instead of a second copy.
//
// `forceLiveNow` exists for one specific reason, and it is not convenience:
// InstanceTextblockNode moves the caret between adjacent textblocks by focusing
// the SIBLING's inner `.ProseMirror`, behind an `if (innerPM)` guard. A neighbour
// that is still a placeholder has no `.ProseMirror`, so the guard swallows the
// focus and the caret silently stops moving between blocks. The neighbour must be
// made live SYNCHRONOUSLY before it is focused.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";

// The class a placeholder paints. Anything that MEASURES rendered text has to
// know it: WrapGroupNode reads `.ProseMirror || .textblock-card-placeholder`,
// because a host below the fold has thousands of characters on screen and no
// ProseMirror at all (measured on the Eminem page: 17 of 18 wrap groups reported
// textArea 0 with 2580-3826 real characters, which decideWrapStack read as
// "blank host — nothing to wrap"). Reusing the class TextblockCard already paints
// means every existing measurer keeps working when a second path goes lazy.
export const LAZY_PLACEHOLDER_CLASS = "textblock-card-placeholder";

// What the stand-in draws: the textmap's top-level nodes — or NULL when it holds something the read-only stand-in
// (ui/StaticTextmap) cannot draw (a table, a picture, an embedded occurrence…), and the editor must mount at once.
// It draws paragraphs, headings, bulleted / numbered lists, bold / italic / strike / code / links, line breaks and
// doc CHIPS (the doc chip's own component, no editor). Before 2026-10-30 it drew plain text only: a list of chips
// showed EMPTY until clicked, and making those mount eagerly put 79 live editors on the Eminem article (8s to open).
// It is REAL TEXT on screen, because WrapGroupNode measures rendered characters to decide wrap vs stack.
export const STAND_IN_NODES = new Set([
  "doc", "paragraph", "heading", "text", "hardBreak", "bulletList", "orderedList", "listItem", "instanceTextblockInline",
]);
export function standInBlocks(textmap) {
  if (!textmap || typeof textmap !== "object") return [];
  let drawable = true;
  const walk = (n) => {
    if (!drawable || !n || typeof n !== "object") return;
    if (!STAND_IN_NODES.has(n.type)) { drawable = false; return; }
    if (n.type === "instanceTextblockInline" && !n.attrs?.occurrenceId) { drawable = false; return; }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  const content = Array.isArray(textmap.content) ? textmap.content : [];
  content.forEach(walk);
  return drawable ? content : null;
}

// occurrenceId -> goLive(). Registered while a lazy editor is mounted and NOT yet
// live; removed the moment it goes live or unmounts, so the map only ever holds
// editors that can still be forced.
const pending = new Map();

/**
 * Make a registered, not-yet-live editor live synchronously.
 * @returns {boolean} false when that id is not registered (already live, never
 *   mounted, or not lazy) — callers use this to fall back rather than assume.
 */
export function forceLiveNow(occurrenceId) {
  const goLive = occurrenceId ? pending.get(occurrenceId) : null;
  if (!goLive) return false;
  goLive();
  return true;
}

// Test-only: register a goLive without mounting a component. Not used in app code.
// In the app the registration is removed by the hook's own effect cleanup, so a
// stale entry is impossible; a hand-registered one has no such lifecycle, which is
// why `__resetForTest` exists — without it a closure from a previous test fires
// against detached DOM and throws NotFoundError from an unrelated test.
export function __registerForTest(occurrenceId, goLive) {
  pending.set(occurrenceId, goLive);
}
export function __resetForTest() {
  pending.clear();
}

/**
 * @param {object}  opts
 * @param {boolean} opts.eager         mount the real editor immediately
 * @param {string}  opts.occurrenceId  key for forceLiveNow
 * @param {number}  opts.rootMargin    px ahead of the viewport to go live
 * @param {boolean} opts.onUse         go live only when used (pressed / forced), never on scroll
 * @returns {{ live: boolean, ref: object, goLive: () => void }}
 */
export function useLazyEditor({ eager = false, occurrenceId = null, rootMargin = 700, onUse = false } = {}) {
  const [live, setLive] = useState(eager);
  const ref = useRef(null);
  const goLive = useCallback(() => setLive(true), []);

  // Register while forceable. Keyed on `live` so the entry is dropped as soon as
  // it goes live — forcing an already-live editor is a no-op we should not claim
  // to have done (callers branch on the return value).
  useEffect(() => {
    if (!occurrenceId || live) return undefined;
    pending.set(occurrenceId, goLive);
    return () => { pending.delete(occurrenceId); };
  }, [occurrenceId, live, goLive]);

  useEffect(() => {
    if (live) return undefined;
    // `onUse`: live only when used (a press, or forceLiveNow) — never from scrolling. A board of text rows (the Lookup
    // board: 250) made an editor for every row it scrolled past; on desktop Firefox scrolling it was "glitchy and
    // slow" (measured at 4x CPU: 50ms frames, 600ms stalls, 12s busy — almost all TipTap setting up editors).
    if (onUse) return undefined;
    const el = ref.current;
    // No element, or no IntersectionObserver (jsdom, old engines) -> mount eagerly
    // rather than render a placeholder that could never be replaced.
    if (!el || typeof IntersectionObserver === "undefined") { setLive(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setLive(true); io.disconnect(); }
    }, { rootMargin: `${rootMargin}px` });
    io.observe(el);
    return () => io.disconnect();
  }, [live, rootMargin, onUse]);

  return { live, ref, goLive };
}

// ── A DOC SECTION'S STAND-IN ────────────────────────────────────────────────
// A section (an embedded doc container) is a list of embeds — its textblocks, sub-sections, pictures, tables — so
// the textblock stand-in cannot draw it, and every section of a long page mounted its editor at open: Eminem's ~45
// (user, 2026-10-30: "opening a page is taking an extremely long time"). This expands the embeds into what the
// stand-in can draw (ui/StaticTextmap): a textblock's own content in a card, a sub-section as its label + its own
// expansion, a picture or a table as a box of about its height. The section goes live as it nears the viewport.
const plainLines = (tm) => (Array.isArray(tm?.content) ? tm.content : []).map((n) => {
  const parts = []; const walk = (x) => { if (!x || typeof x !== "object") return; if (typeof x.text === "string") parts.push(x.text); (x.content || []).forEach(walk); };
  walk(n); return { type: "paragraph", content: parts.length ? [{ type: "text", text: parts.join("") }] : [] };
});

export function sectionStandIn(textmap, getOcc, getMod, depth = 0) {
  const out = [];
  const embed = (id) => {
    const o = getOcc?.(id); const m = o ? getMod?.(o.moduleId) : null;
    if (!o || !m) return { type: "standinBox", height: 32 };
    if (m.role === "textblock") return { type: "standinCard", content: standInBlocks(o.textmap) || plainLines(o.textmap) };
    if (m.role === "container" && (m.kind === "doc" || !m.kind) && depth < 8) {
      return { type: "standinSection", label: o.label || m.label || "", content: sectionStandIn(o.textmap, getOcc, getMod, depth + 1) };
    }
    if (m.kind === "table" || o.meta?.table) return { type: "standinBox", height: 30 + 28 * (o.meta?.table?.rowCount || 3) };
    if (m.role === "artifact") return { type: "standinBox", height: 220 };
    return { type: "standinBox", height: 40 };
  };
  const visit = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "moduleEmbed" || n.type === "instanceTextblock") { if (n.attrs?.occurrenceId) out.push(embed(n.attrs.occurrenceId)); return; }
    if (n.type === "wrapGroup") { (n.content || []).forEach(visit); return; }
    const drawn = standInBlocks({ type: "doc", content: [n] });
    out.push(...(drawn || plainLines({ content: [n] })));
  };
  (Array.isArray(textmap?.content) ? textmap.content : []).forEach(visit);
  return out;
}

/** Force live every lazy editor on `id`'s ancestor chain (a search jump into a section not yet mounted). */
export function forceLiveAncestors(ancestorIds) {
  let forced = false;
  for (const a of ancestorIds || []) if (forceLiveNow(a)) forced = true;
  return forced;
}
