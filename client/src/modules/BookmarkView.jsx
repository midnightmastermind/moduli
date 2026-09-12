// modules/BookmarkView.jsx
//
// A BOOKMARK ARTIFACT's `actual` view — the web page itself.
//
// CORRECTED TWICE BEFORE LANDING HERE, and the corrections are the useful part.
// First this was a page KIND, then a URL-bearing instance the panel learned to
// render. Both were wrong for the same reason: `role: "artifact"` already IS the
// module type for "a thing that has content of its own", it is kind-bearing, and
// its cascade already declares exactly the two views the user described —
//
//     artifact   dragInView: "actual"   navOptions: ["preview", "actual"]
//
// *"the view can be an entire page or a preview of it"* is that line. So a
// bookmark is an artifact whose `fileRef` is a URL, `preview` is its card and
// `actual` is this — one more branch beside image, pdf, audio and video in
// `ArtifactContent`, rather than a new surface.
//
// User, 2026-08-23: *"we need a whole iframe view that can go on links and
// bookmark artifacts so we can open them up in a panel"* / *"it should probably
// work like folder does with its views"*.
//
// TWO MODES, READER FIRST (*"can you make sure to open in text preview mode if
// possible"*):
//
//   reader — the page fetched server-side (`page_reader`) and rendered as OUR
//            DOM. Selection, right-click and turning text into modules all work,
//            because none of it is behind a cross-origin boundary.
//   web    — the live site in a frame. The opt-in: a logged-in view, an app, a
//            video, or a page whose text does not survive a server-side fetch.
//
// `page_reader` answers `usable`, calibrated at 200 words against the real
// extractor. About half of the user's own bookmarks return a JavaScript shell
// server-side (reddit: 0 words), and a reader showing nav chrome is worse than
// the site — so an unusable read falls through to the frame instead of
// rendering an empty page and calling it a feature.
//
// WHY THE FRAME IS NOT SANDBOXED SHUT: `allow-scripts allow-same-origin
// allow-forms allow-popups` and deliberately NOT `allow-top-navigation`. Links
// and forms work and you can navigate inside the page; what is blocked is the
// page navigating the GRID away, which is the one thing a careless page could
// do to you.
//
// WHAT CANNOT WORK HERE, established by measurement rather than assumed: the
// parent cannot see a right-click inside the frame and cannot read its
// selection (`contentDocument` -> null, `getSelection()` -> SecurityError). That
// is the entire reason reader mode exists, and why our controls live in a STRIP
// above the frame rather than in a context menu over it.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { occurrenceUrl } from "../helpers/occurrenceUrl";
import { embedUrlFor } from "../helpers/embedUrl";
import {
  initialNav, currentUrl, canGoBack, canGoForward, goBack, goForward, navigate,
  normalizeTyped, isScratch,
} from "../helpers/browserNav";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { buildContainerCrumbOptions } from "../helpers/containerCrumbs";
import { useGridActionsSelector } from "../GridActionsContext.js";
import { Spinner } from "../components/ui/spinner.jsx";
import { readerStateFromPlan } from "../helpers/readerPlan";

// LAZY, and it is a CYCLE BREAK rather than a bundle tweak. The static graph is
// BookmarkView -> PagePreviewApp -> ModuleContainer -> ArtifactCard -> BookmarkView,
// because a container renders artifact cards and an artifact card renders this.
// ES modules tolerate that, but only by luck of evaluation order; a lazy import
// has no edge at module-evaluation time at all.
const PagePreviewBody = React.lazy(() =>
  import("../PagePreviewApp.jsx").then((m) => ({ default: m.PagePreviewBody })),
);

const BTN_TITLES = {
  reader: "The page as one document — a single container and textblock",
  magic: "The page broken into occurrences — sections, textblocks, link chips, quotes, tables",
  web: "The live site",
  archive: "The closest Wayback Machine snapshot — for a dead link, or a page that has changed",
};

const EMPTY_MAP = {};
const EMPTY_OPTIONS = [];

export const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups";

/**
 * Which mode to show, given what the reader fetch came back with.
 * PURE, because this is the decision the whole surface turns on.
 *
 *   - an explicit user choice always wins; picking Web then having it silently
 *     revert would make the toggle a suggestion
 *   - otherwise reader, but only when the fetch produced something worth reading
 *   - a failed or thin fetch falls through to the frame, never to a blank reader
 */
export function resolveMode({ chosen = null, fetched = null, embeddable = false, archived = false } = {}) {
  // ARCHIVE IS UNCONDITIONAL, and that is the difference between it and the
  // other two. Reader can be empty and Web can be refused, so both are checked
  // against what the fetch learned; the archive is a DIFFERENT page on a
  // different host, so nothing the live site said about itself applies to it.
  // Measured 2026-08-23: a snapshot sends no `x-frame-options` and a CSP with
  // no `frame-ancestors`, so it frames where the original does not.
  if (chosen === "archive") return "archive";
  // ── AN EMBEDDABLE URL IS NEVER BLOCKED ──────────────────────────────────
  //
  // `framable` describes the PAGE. When `embedUrlFor` knows this site, the
  // frame shows a DIFFERENT url — the one its owner publishes for embedding —
  // and the page's own header says nothing about that. Measured:
  // `youtube.com/watch` sends SAMEORIGIN, `youtube.com/embed` sends no header.
  // Without this, pasting a YouTube link reports "this site refuses to be
  // framed", which is true of the page and wrong about what we would show.
  if (chosen === "web") {
    if (embeddable) return "web";
    // AN EXPLICIT WEB PICK IS NEVER SILENTLY TURNED INTO A SNAPSHOT.
    //
    // The automatic fall-through below shows the archive when the live page will
    // not frame — but that is a fallback for when nobody chose, not a veto on a
    // choice. This file's first rule is that "an explicit user choice always
    // wins; picking Web then having it silently revert would make the toggle a
    // suggestion", and a version of this branch briefly broke it (2026-09-10).
    // If you ask for the live page you get the live page, or an honest account
    // of why the SITE refused it.
    return fetched && fetched.ok && fetched.framable === false ? "blocked" : "web";
  }
  // READER and MAGIC read the same text and differ only in how it is laid out
  // (user, 2026-09-12), so every rule that applies to one applies to both.
  if (chosen === "reader" || chosen === "magic") return chosen;
  // AND IT IS THE DEFAULT, ahead of reader. Reader mode on a video page yields
  // the description and some nav chrome — never the thing you opened it for. If
  // the site publishes a player, the player IS the content. Reader is still one
  // click away for the cases where the surrounding page is what you wanted.
  if (embeddable) return "web";
  if (!fetched) return "loading";
  if (fetched.ok && fetched.usable) return "reader";
  // The reader has nothing to show. The frame is the fallback — unless the site
  // refuses that too, which the fetch already told us from its own headers
  // rather than us framing, waiting, and discovering a blank box. Measured:
  // github DENY, youtube/reddit/google/danbrown SAMEORIGIN, wikipedia allows.
  // ── A REFUSED PAGE IS NOT AN UNSHOWABLE PAGE ────────────────────────────
  //
  // User, 2026-09-10: *"it should be showing the web version since thats what
  // raindrop lets you do"* / *"ours says it cant display the page but it can be
  // displayed, its just erroring out"*. Both are true and they resolve together.
  //
  // The LIVE site genuinely cannot be framed — the Washington Post sends
  // `X-Frame-Options: sameorigin` and their console says so verbatim. What
  // Raindrop shows is a SNAPSHOT, not the live page, and we already fetch those:
  // the archive rendered that same article in their screenshot. We simply never
  // reached for one at the moment it was the only thing left, and showed a dead
  // end instead.
  //
  // Only when a snapshot EXISTS. Claiming one we do not have would replace an
  // honest "this will not open" with a blank box, which is worse.
  if (fetched.ok && fetched.framable === false) return archived ? "archive" : "blocked";
  // ── AND WHEN THE FETCH LEARNED NOTHING AT ALL ───────────────────────────
  //
  // `framable` comes from headers the reader fetch received, so a fetch that
  // FAILED has none and `ok` is false. The Washington Post is exactly that: our
  // server cannot reach it (bot protection — a plain `curl -I` gets nothing
  // either) while the user's own browser loads it fine.
  //
  // The first version of this fall-through required `ok === true`, so it could
  // never fire for the page it was built for — and shortening the reader timeout
  // to 6s made `ok === false` MORE common, i.e. made it worse.
  //
  // A snapshot beats framing a page we know nothing about, which is also the
  // model the user named: Raindrop does not frame the live site, it shows its
  // copy. Only when one EXISTS — otherwise the frame is still the best guess
  // available, which the control beside this pins.
  if (!fetched.ok && archived) return "archive";
  return "web";
}

// ── WHERE THE READER GETS ITS TEXT ──────────────────────────────────────────
//
// User, 2026-09-10: *"the reader view shows nothing for this bookmark
// currently... id like the reader to point at the archive if web fails"*.
//
// Measured on the article they named — the live page gives the masthead and
// nothing else, its SNAPSHOT gives the piece:
//
//     washingtonpost.com   live       91 words   (unusable)
//                          snapshot 1614 words   (the actual article)
//
// So a page can be unreadable TODAY and perfectly readable in the archive, and
// for a paywalled or client-rendered news site that is the normal case rather
// than the exception. The snapshot was captured when the text was in the HTML.
//
// LIVE WINS WHEN IT IS USABLE, always: the archive copy is dated, and reading a
// 2023 capture of a page that renders fine today would be quietly wrong. The
// archive is the FALLBACK, never the preference.
//
// It also reports WHERE the text came from, because that is not a detail on a
// news article — the strip says so, so nobody reads a two-year-old capture
// believing it is today's page.
export function readerSource({ fetched, archiveRead }) {
  if (fetched?.ok && fetched.usable && fetched.markdown) {
    return { markdown: fetched.markdown, from: "live" };
  }
  if (archiveRead?.ok && archiveRead.usable && archiveRead.markdown) {
    return { markdown: archiveRead.markdown, from: "archive" };
  }
  // Still loading the archive read is NOT the same as having nothing — the
  // caller shows a wait rather than an empty page.
  if (archiveRead?.loading) return { markdown: "", from: "loading" };
  return { markdown: "", from: null };
}

/** The label the strip shows for why it fell through, or null when it did not. */
export function fallbackReason(fetched) {
  if (!fetched || fetched.ok === undefined) return null;
  if (!fetched.ok) return fetched.error || "could not be fetched";
  if (!fetched.usable) return "no readable text";
  return null;
}

// ── A FRAME NEEDS A GROUND OF ITS OWN ───────────────────────────────────────
//
// User, 2026-09-10: *"the archive has a transparent background and i cant see
// the page"*. An `<iframe>` with no background is TRANSPARENT, so anything the
// framed document does not paint shows whatever sits behind the frame — and
// this surface opens over the spread's dark backdrop. A page whose body sets no
// colour of its own then renders as its own dark text on that dark ground,
// which reads as a page that failed to load.
//
// Wayback's rewritten pages are the common case: the archive strips or rewrites
// enough of the original CSS that the body frequently paints nothing.
//
// WHITE, because that is what a browser viewport is. This is a web page in a
// window, not a surface in our theme — tinting it to the grid would misrepresent
// every site that DOES set a background. Both frames get it: the live one has
// exactly the same hole, it just bites less often because most live sites paint
// their own body.
const FRAME_STYLE = { width: "100%", height: "100%", border: 0, display: "block", background: "#fff" };

export default function BookmarkView({ occurrence, module = null, fieldsById = null, socket, isActivePage = true }) {
  // ── THE FIELD MAP IS NOT OPTIONAL HERE, and it took a live probe to see it ──
  //
  // `occurrenceUrl` ranks url-ish field NAMES so a row with several links opens
  // the right one. Without the map there is no ranking, and every candidate
  // falls back to `Object.entries` order.
  //
  // That was harmless until covers landed: a bookmark now carries TWO http
  // fields — `URL` and `Cover` — so unranked, the reader could open the cover
  // IMAGE instead of the page. Probing the 400 live rows returned the right URL
  // every time, and for the wrong reason: `0199` happened to write `URL` first,
  // and object key order is insertion order. That is a coin flip sitting in the
  // reader path, decided by a migration's field ordering.
  //
  // Read from the store rather than threaded as a prop: this renders once per
  // OPEN bookmark, not once per row, so the subscription is not a hot path —
  // and `ArtifactContent`, the only caller, holds no grid state to pass down.
  // An explicit prop still wins, which is what keeps it testable.
  const ctxFields = useGridActionsSelector(s => s.fieldsById);
  const fields = fieldsById || ctxFields || {};
  const resolved = useMemo(
    () => occurrenceUrl(occurrence, { module, fieldsById: fields }),
    [occurrence, module, fields],
  );
  const storedUrl = resolved?.url || null;

  // ── THE ADDRESS BAR ─────────────────────────────────────────────────────
  //
  // User, 2026-09-04: a browser inline, *"without having to click on a
  // bookmark"*. So the url is editable, and history is local state.
  //
  // WHAT HISTORY CAN MEAN HERE is bounded by the cross-origin wall this file
  // already documents: we cannot read where the frame has gone, so Back returns
  // to the last address WE set, never to a page you clicked through inside the
  // site. That is a property of frames, not a gap to fill later.
  const [nav, setNav] = useState(() => initialNav(storedUrl));
  // Re-seed when the OCCURRENCE's own url changes (a different bookmark opened
  // in this surface), not when we navigate — otherwise every navigation would
  // be undone by its own effect.
  useEffect(() => { setNav(initialNav(storedUrl)); }, [storedUrl]);
  const url = currentUrl(nav) || storedUrl;

  const [typed, setTyped] = useState("");
  useEffect(() => { setTyped(url || ""); }, [url]);

  const dispatch = useGridActionsSelector((s) => s.dispatch);
  const scratch = isScratch(occurrence);

  // TYPING NEVER EDITS YOUR LIBRARY. A saved bookmark is an address you meant
  // to keep; navigating away from it in this surface is browsing, not an edit,
  // so the stored url is left alone and only local state moves. A SCRATCH
  // browser is a workspace — there is nothing to protect and everything to lose
  // on reload — so its url is persisted. That is the whole job of the flag.
  const commitUrl = useCallback((next) => {
    setNav((n) => navigate(n, next));
    if (!scratch || !dispatch || !occurrence) return;
    const norm = normalizeTyped(next);
    if (!norm || norm === storedUrl) return;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { ...occurrence, meta: { ...(occurrence.meta || {}), url: norm } },
    });
  }, [scratch, dispatch, socket, occurrence, storedUrl]);

  // ── SAVE THIS ADDRESS AS A BOOKMARK ─────────────────────────────────────
  //
  // User, 2026-09-04: *"a button that says save as bookmark occurrence next to
  // the url bar that has you create a new bookmark occurrence for that link and
  // asks where to put it (like the pomodoro and placing that occurrence)."*
  //
  // Reuses the Pomodoro's own destination list, so "where do I put this" looks
  // and reads the same in both places rather than being a second answer to one
  // question.
  const [saving, setSaving] = useState(false);
  const [savedTo, setSavedTo] = useState(null);
  const [dest, setDest] = useState("");
  // SUBSCRIBED ONLY WHILE THE PICKER IS OPEN. `occurrencesById` and `modulesById`
  // change identity on EVERY write anywhere on the grid, so subscribing to them
  // unconditionally would re-render every open browser — an iframe surface — on
  // every unrelated edit. Selecting a constant when the value is not read is the
  // fix this repo already used for the field pills and the instance rows
  // (2026-08-31 (6)); what becomes conditional is the value SELECTED, not the hook.
  // EMPTY is module-level: a fresh `{}` in the selector re-renders on every store
  // read instead, which is worse than what it replaces.
  const occurrencesById = useGridActionsSelector((s) => (saving ? s.occurrencesById : EMPTY_MAP));
  const modulesById = useGridActionsSelector((s) => (saving ? s.modulesById : EMPTY_MAP));
  const gridId = useGridActionsSelector((s) => s.gridId ?? s.state?.gridId);
  const userId = useGridActionsSelector((s) => s.userId ?? s.state?.userId);
  // BUILT ONLY WHILE THE PICKER IS OPEN — the same discipline the Pomodoro panel
  // took after a profile put this walk at 156ms of an effect window: it walks
  // every occurrence twice to fill a `<select>` nobody has open.
  const destOptions = useMemo(
    () => (saving ? buildContainerCrumbOptions(occurrencesById, modulesById) : EMPTY_OPTIONS),
    [saving, occurrencesById, modulesById],
  );

  const saveBookmark = useCallback(() => {
    const parent = dest ? occurrencesById?.[dest] : null;
    if (!parent || !url) return;
    const res = CommitHelpers.addBookmarkOccurrence({
      dispatch, socket, gridId, userId,
      containerOccurrence: parent,
      url,
      scratch: false,     // an address you meant to KEEP
    });
    if (!res) return;
    setSaving(false);
    // Say WHERE it went. "Saved" alone leaves you to go and check, and the
    // whole point of asking was that the destination matters.
    const label = destOptions.find((o) => o.id === dest)?.label || "";
    setSavedTo(label);
    setTimeout(() => setSavedTo(null), 4000);
  }, [dest, occurrencesById, url, dispatch, socket, gridId, userId, destOptions]);

  const [chosen, setChosen] = useState(null);
  const [fetched, setFetched] = useState(null);
  const reqRef = useRef(0);

  // The reader fetch runs once per url. It is READ-ONLY (`page_reader` creates
  // nothing), so re-running it costs a request and never a write.
  useEffect(() => {
    if (!url || !socket) return;
    const req = ++reqRef.current;
    setFetched(null);
    socket.emit("page_reader", { url, requestId: String(req) }, (out) => {
      // A late reply for a url we have navigated away from must not overwrite
      // the current one — the same stale-response trap every fetch-on-prop has.
      if (reqRef.current !== req) return;
      setFetched(out || { ok: false, error: "no reply" });
    });
  }, [url, socket]);

  // ── THE ARCHIVE LOOKUP IS LAZY, and that is deliberate ──────────────────
  //
  // The button is always on the strip (user: *"make that next to reader mode
  // and web mode"*) but the lookup only runs when it is PICKED. Asking
  // archive.org about every bookmark someone opens would send a third party a
  // request per open for a mode most opens never use.
  //
  // Keyed by url so switching back and forth costs one lookup, and reset when
  // the url changes — the same stale-reply trap the reader fetch guards.
  const [archive, setArchive] = useState(null);
  const archiveReqRef = useRef(0);
  useEffect(() => { setArchive(null); }, [url]);
  // KEYED OFF THE FETCH, NOT OFF `mode` — `mode` will depend on whether a
  // snapshot was found, so gating the lookup on it would be a cycle.
  // WHENEVER THE LIVE FRAME IS A COIN FLIP — the site refused it outright, OR the
  // fetch learned nothing and cannot say. Both are cases where a snapshot may be
  // the only thing that renders, and neither is "every bookmark you open", which
  // is the request-per-open this lookup stays lazy to avoid.
  const frameUncertain = !!(fetched && (fetched.ok === false || fetched.framable === false));

  // ── THE READ MAY CARRY ONE, BUT IT IS NEVER WAITED FOR ──────────────────
  //
  // RETRACTED, and the retraction is the useful part. `page_reader` briefly did
  // the snapshot lookup itself and sent it in the same reply — one round trip
  // instead of two, which measured better on TOTAL time and was worse to use.
  // User, 2026-09-10: *"took too long"*. Holding the reply until the archive
  // answered pushed FIRST PAINT from ~363ms out to 1-4.4s, and a person feels
  // the first paint, not the total. The round trip it saved is ~50ms against a
  // lookup that costs 644ms-3.3s.
  //
  // So the read is answered the moment it is ready and the lookup runs beside
  // it, with "Looking for a saved copy…" on screen while it does. This still
  // reads a bundled snapshot if a server ever sends one, so the two cannot
  // disagree — it simply never blocks on one.
  useEffect(() => {
    if (fetched?.archive) setArchive(fetched.archive);
  }, [fetched]);

  useEffect(() => {
    // Still LAZY in the ordinary case: asking archive.org about every bookmark
    // someone opens would send a third party a request per open. It runs on an
    // explicit pick, or when the live page has just refused to be framed and a
    // snapshot is the only thing left to show.
    //
    // `fetched.archive` is checked HERE rather than relying on the seeding effect
    // above having landed: both run after the same commit, so this one would
    // still read the pre-seed `archive` and fire a lookup the server has already
    // done. Reading the reply directly is what makes that impossible.
    if (fetched?.archive) return;
    // WHY READER IS IN THIS LIST. A page can be perfectly FRAMABLE and still have
    // no readable text — `frameUncertain` is false for those, so without this the
    // Reader button on such a page would have nothing to fall back to. Gated on an
    // explicit pick so it stays a request rather than a fetch everyone pays.
    const wantsArchiveText = (chosen === "reader" || chosen === "magic") && fetched && (!fetched.ok || !fetched.usable);
    if (!(chosen === "archive" || frameUncertain || wantsArchiveText) || !url || !socket || archive) return;
    const req = ++archiveReqRef.current;
    setArchive({ loading: true });
    socket.emit("wayback_lookup", { url, requestId: String(req) }, (out) => {
      if (archiveReqRef.current !== req) return;
      setArchive(out || { ok: false, reason: "no reply" });
    });
  }, [chosen, frameUncertain, url, socket, archive, fetched]);

  // ── THE ARCHIVE'S OWN TEXT ──────────────────────────────────────────────
  //
  // A SECOND `page_reader`, pointed at the snapshot. No new handler: reading a
  // web.archive.org url is reading a url, and reusing the same call means the
  // text you READ from a snapshot and the text you would IMPORT from it cannot
  // disagree.
  //
  // LAZY, and gated on the live read having failed us — a page whose own text is
  // fine must never pay a second fetch, and most do.
  const [archiveRead, setArchiveRead] = useState(null);
  const archiveReadReqRef = useRef(0);
  useEffect(() => { setArchiveRead(null); }, [url]);
  const liveReaderIsThin = !!(fetched && (!fetched.ok || !fetched.usable));
  useEffect(() => {
    if (!liveReaderIsThin || !archive?.ok || !archive.url || !socket || archiveRead) return;
    const req = ++archiveReadReqRef.current;
    setArchiveRead({ loading: true });
    socket.emit("page_reader", { url: archive.url, requestId: `a${req}` }, (out) => {
      // The same stale-reply guard the live read takes: a snapshot for a url we
      // have navigated away from must not overwrite the current one.
      if (archiveReadReqRef.current !== req) return;
      setArchiveRead(out || { ok: false, error: "no reply" });
    });
  }, [liveReaderIsThin, archive, socket, archiveRead]);

  const reader = readerSource({ fetched, archiveRead });

  // The embeddable form of this url, or null. Computed here rather than inside
  // `resolveMode` so that function stays pure over its inputs and testable
  // without the table.
  const embedSrc = useMemo(() => embedUrlFor(url), [url]);

  // ── WAITING ON A PAGE SHOULD LOOK LIKE WAITING ──────────────────────────
  //
  // User, 2026-09-10: *"currently waiting on a browser slows the site to a
  // crawl"* / *"put a loading circle in for when the site is loading too"*.
  //
  // How long a live third-party page takes is the browser's business and not
  // something this surface can schedule away. What WAS ours is that it said
  // nothing while it happened, so a slow site and a dead app looked identical.
  //
  // Cleared by the frame's OWN `load`, which fires for a REFUSED page too (the
  // browser loads its own error document there) — so a site that says no stops
  // spinning instead of pretending it is still trying. Keyed on the src, so
  // navigating starts a new wait rather than showing the last page's answer.
  const frameSrc = embedSrc || url;
  const [frameLoading, setFrameLoading] = useState(true);
  useEffect(() => { setFrameLoading(true); }, [frameSrc]);
  const mode = resolveMode({
    chosen, fetched, embeddable: !!embedSrc,
    archived: !!(archive?.ok && archive?.url),
  });
  const reason = fallbackReason(fetched);
  const pick = useCallback((m) => setChosen(m), []);

  // ── THE READER'S STRUCTURE ──────────────────────────────────────────────
  //
  // User, 2026-09-12: *"the reader mode should be turning the things into
  // textblocks and containers like the wikipedia import"*. `import_plan` runs
  // the IMPORTER's own planner with `dryRun: true` and writes nothing, so the
  // reader shows the same containers / textblocks / quotes / tables an import
  // would produce without minting any of them. See `helpers/readerPlan` for the
  // measurement that ruled out minting (avg 299 occurrences per page read).
  //
  // KEYED ON THE MARKDOWN, not on the url: the same page yields a live read and
  // an archive read with different text, and the plan must follow whichever one
  // `readerSource` picked. Keying on the url would leave the archive's structure
  // showing the live page's.
  //
  // TWO SHAPES (user, 2026-09-12): READER asks for one container + one
  // textblock holding the whole article; MAGIC asks for the importer's full
  // tree. The SHAPE is the mode, so the key is shape + markdown.
  //
  // CACHED PER URL, because flipping Reader <-> Magic is a thing people do to
  // compare, and re-planning an 800-occurrence Wikipedia tree on every flip
  // would make the toggle feel broken.
  const [plan, setPlan] = useState(null);
  const planReqRef = useRef(0);
  const planForRef = useRef(null);
  const planCacheRef = useRef(new Map());
  const isTextMode = mode === "reader" || mode === "magic";
  useEffect(() => {
    const md = reader.markdown;
    // Planned only when a text mode is actually on screen. The read itself runs
    // for every open (it is what DECIDES the mode), but a page you never switch
    // to Reader on should not pay for a tree nobody looks at.
    if (!isTextMode || !md || !socket) return;
    const shape = mode;
    const key = `${shape} ${md}`;
    if (planForRef.current === key) return;
    planForRef.current = key;
    // Bumped on EVERY switch, cached or not, so a slow reply for the shape just
    // left cannot land on top of the one just picked.
    const req = ++planReqRef.current;
    const cached = planCacheRef.current.get(key);
    if (cached) { setPlan(cached); return; }
    setPlan({ loading: true });
    socket.emit("import_plan", { content: md, gridId, shape, requestId: `p${req}` }, (out) => {
      const res = out || { ok: false, error: "no reply" };
      if (res.ok) planCacheRef.current.set(key, res);
      // The same stale-reply guard both reads take.
      if (planReqRef.current !== req) return;
      setPlan(res);
    });
  }, [isTextMode, mode, reader.markdown, socket, gridId]);
  // Navigating away drops the plan and its cache. Safe in this order because
  // `fetched` is reset on the same url change, so the effect above sees no
  // markdown to plan for the page being left; and a stale reply is dropped by
  // the request guard the moment the new page's text arrives and supersedes it.
  useEffect(() => { planForRef.current = null; planCacheRef.current.clear(); setPlan(null); }, [url]);

  const readerTree = useMemo(
    () => (plan && plan.ok ? readerStateFromPlan(plan) : null),
    [plan],
  );

  // A BOOKMARK WITH NO LINK HAS NOTHING TO SHOW — but a SCRATCH BROWSER with no
  // link is the ordinary case, and the whole point of it: an empty address bar
  // waiting to be typed into. Returning early here would hide the one control
  // it exists for, so the two are separated.
  //
  // Caught while creating the first one to test with, which is exactly the
  // "not verified in a browser" gap this file's own history keeps recording.
  if (!url && !scratch) {
    return <div className="text-xs text-muted-foreground text-center empty-placeholder" style={{ paddingTop: 40 }}>
      Nothing to open — this row carries no link
    </div>;
  }

  const navBtnSt = (enabled) => ({
    padding: "2px 7px", fontSize: 13, fontFamily: "var(--font-mono)",
    cursor: enabled ? "pointer" : "default", borderRadius: 4,
    border: "1px solid var(--border-default)", background: "var(--input-bg)",
    color: enabled ? "var(--text-muted)" : "var(--text-faint)",
    opacity: enabled ? 1 : 0.5,
  });

  const btn = (m, label) => (
    <button
      onClick={() => pick(m)}
      title={BTN_TITLES[m]}
      style={{
        padding: "2px 8px", fontSize: 12, fontFamily: "var(--font-mono)", cursor: "pointer",
        borderRadius: 4, border: "1px solid var(--border-default)",
        background: mode === m ? "var(--accent-blue)" : "var(--input-bg)",
        // The FILL carries "selected"; the ink does not have to. Muted ink on a
        // muted fill made the unselected modes a guess rather than a choice —
        // and which mode you are NOT in is the thing you are reading them to
        // find out. Same call as the 2026-08-19 pill work: keep the hue, take
        // the contrast.
        color: mode === m ? "var(--on-accent)" : "var(--text-primary)",
      }}
    >{label}</button>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* THE STRIP — outside the frame, which is the only place our clicks and
          right-clicks can reach us. A menu drawn over the frame can be SEEN but
          never triggered from inside it. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", flexShrink: 0,
        // SOLID, because the strip is CHROME and it is not always over a panel.
        // `--input-bg` is 0.08 alpha, which reads fine over a panel and vanishes
        // over the spread's dark backdrop — so every muted label on it lost its
        // contrast the moment a bookmark could be opened in the overlay (user,
        // 2026-09-10: *"you cant read them unselected"*, on a Stardew grid where
        // `--text-muted` is a DARK brown and the backdrop behind it is dark too).
        // The url input beside them was always legible because it already sets
        // `--panel-bg`; this gives the rest of the strip the same ground.
        borderBottom: "1px solid var(--border-subtle)", background: "var(--panel-bg)",
        fontSize: 12, fontFamily: "var(--font-mono)",
      }}>
        <button
          onClick={() => setNav(goBack)} disabled={!canGoBack(nav)} title="Back"
          style={navBtnSt(canGoBack(nav))}
        >‹</button>
        <button
          onClick={() => setNav(goForward)} disabled={!canGoForward(nav)} title="Forward"
          style={navBtnSt(canGoForward(nav))}
        >›</button>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitUrl(typed); }
            // Escape restores what is actually loaded, so a half-typed address
            // is never left sitting in the bar pretending to be the page.
            if (e.key === "Escape") { e.preventDefault(); setTyped(url || ""); e.currentTarget.blur(); }
          }}
          onFocus={(e) => e.currentTarget.select()}
          spellCheck={false}
          placeholder="Type an address…"
          title={url || ""}
          style={{
            flex: 1, minWidth: 0, background: "var(--panel-bg)", color: "var(--text-primary)",
            border: "1px solid var(--border-subtle)", borderRadius: 4,
            padding: "2px 6px", fontSize: 12, fontFamily: "var(--font-mono)",
          }}
        />
        {url && (
          <button
            onClick={() => { setDest(""); setSaving((v) => !v); }}
            title="Save this address as a bookmark occurrence"
            aria-label="Save as bookmark"
            style={{ ...navBtnSt(true), color: saving ? "var(--accent-blue)" : "var(--text-muted)" }}
          >☆</button>
        )}
        {!scratch && storedUrl && url !== storedUrl && (
          // You have browsed off a SAVED bookmark. Saying so is what keeps the
          // stored address from silently seeming to have changed.
          <button
            onClick={() => setNav(initialNav(storedUrl))}
            title={`Back to the saved address: ${storedUrl}`}
            style={navBtnSt(true)}
          >⌂</button>
        )}
        {reason && mode === "web" && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }} title={`Reader unavailable: ${reason}`}>
            reader: {reason}
          </span>
        )}
        {isTextMode && reader.from === "archive" && (
          // NOT A DETAIL ON A NEWS ARTICLE. The live page had nothing readable
          // and this text is a CAPTURE — saying when it was taken is the
          // difference between reading an archive and being misled by one.
          <span
            style={{ fontSize: 12, color: "var(--text-muted)" }}
            title={`The live page had no readable text; this is the Wayback capture${archive?.capturedAt ? ` from ${new Date(archive.capturedAt).toLocaleDateString()}` : ""}`}
          >
            from the archive{archive?.capturedAt ? ` · ${new Date(archive.capturedAt).toLocaleDateString()}` : ""}
          </span>
        )}
        {mode === "archive" && archive?.ok && archive.capturedAt && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }} title={archive.capturedAt}>
            captured {new Date(archive.capturedAt).toLocaleDateString()}
          </span>
        )}
        {btn("reader", "Reader")}
        {btn("magic", "Magic")}
        {btn("web", "Web")}
        {btn("archive", "Archive")}
        {url && <a href={url} target="_blank" rel="noreferrer noopener"
           style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "none", padding: "2px 4px" }}
           title="Open in a new tab">↗</a>}
      </div>

      {saving && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", flexShrink: 0,
          borderBottom: "1px solid var(--border-subtle)", background: "var(--panel-bg)",
          fontSize: 12, fontFamily: "var(--font-mono)",
        }}>
          <span style={{ color: "var(--text-faint)" }}>Save to</span>
          <select
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            style={{
              flex: 1, minWidth: 0, padding: "3px 5px",
              background: "var(--input-bg)", color: "var(--text-primary)",
              border: "1px solid var(--input-border)", borderRadius: 3,
              fontSize: 12, fontFamily: "var(--font-mono)",
            }}
          >
            <option value="">Choose a container…</option>
            {destOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {/* Disabled until a destination is picked: "where" is the question
              being asked, so saving without an answer would defeat it. */}
          <button onClick={saveBookmark} disabled={!dest} style={navBtnSt(!!dest)}>Save</button>
          <button onClick={() => setSaving(false)} style={navBtnSt(true)}>Cancel</button>
        </div>
      )}
      {savedTo && (
        <div style={{
          padding: "3px 8px", flexShrink: 0, fontSize: 12, fontFamily: "var(--font-mono)",
          color: "var(--accent-blue)", background: "var(--accent-blue-bg)",
          borderBottom: "1px solid var(--border-subtle)",
        }}>Saved to {savedTo}</div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {!url && (
          <div className="text-xs text-muted-foreground text-center empty-placeholder" style={{ paddingTop: 40 }}>
            Type an address above to start browsing
          </div>
        )}
        {url && mode === "loading" && (
          // THE LONGEST WAIT ON THIS SURFACE, and it used to say the least.
          //
          // `safeFetchUrl` gives a page 20 seconds to answer and a site that
          // never does burns all of it before falling through to the frame —
          // measured on the Washington Post, which is ~20s of overlay showing a
          // 12px "Reading…" and nothing else. In a full-screen surface that reads
          // as the app having died, which is exactly what was reported.
          //
          // Same spinner as the frame below, so "waiting" looks like one thing
          // here rather than two.
          <div style={{
            height: "100%", display: "flex", flexDirection: "column", gap: 10,
            alignItems: "center", justifyContent: "center", color: "var(--text-muted)",
            fontSize: 12, fontFamily: "var(--font-mono)",
          }}>
            <Spinner size="md" className="staged-hold-spinner" />
            <span>Reading the page…</span>
          </div>
        )}
        {url && isTextMode && (
          // OUR DOM: selection and right-click work here, which is the whole
          // point of preferring this mode.
          reader.from === "loading" ? (
            <div style={{
              height: "100%", display: "flex", flexDirection: "column", gap: 10,
              alignItems: "center", justifyContent: "center", color: "var(--text-muted)",
              fontSize: 12, fontFamily: "var(--font-mono)",
            }}>
              <Spinner size="md" className="staged-hold-spinner" />
              <span>Reading the saved copy…</span>
            </div>
          ) : (
          <div data-reader-pane="1"
               style={{ height: "100%", overflowY: "auto", padding: 0,
                        color: "var(--text-primary)",
                        // A GROUND, for the same reason the frame has one — and found the
                        // same way, by looking (2026-09-10). The spread's overlay is
                        // deliberately transparent so the grid reads through it (user,
                        // 2026-08-17: *"i want to see the grid through the viewer"*), which
                        // is right for a PICTURE and unreadable for a PAGE OF PROSE: the
                        // reader's text rendered straight over the Tasks panel and the
                        // Trackers behind it.
                        //
                        // `--panel-bg` rather than white: this is OUR DOM in the app's own
                        // type and colours, not a web page in a window — the frame is the
                        // one that gets a browser's white. It is also exactly the call the
                        // strip above already made, and for exactly this reason: `--input-bg`
                        // at 0.08 alpha vanishes over the spread's dark backdrop.
                        background: "var(--panel-bg)" }}>
            {/* THE PAGE AS REAL OCCURRENCES, not as markdown source (user, 2026-09-12).
                `readerTree` is the importer's own planned tree; `PagePreviewBody`
                renders it with the app's real Page/Container/DocContent renderers.

                THE ISOLATION IS STRUCTURAL. Its `parentState` is the plan and
                nothing else, and it is handed `dispatch`/`socket` of null
                internally — there is no path from this subtree to a write, so a
                planned row can never reach the store or the server. That is the
                2026-08-04 phantom class made impossible rather than guarded
                against. `publishComputed={false}` keeps it away from the
                computed-values singleton it would otherwise blank. */}
            {readerTree ? (
              <React.Suspense fallback={null}>
                <PagePreviewBody
                  parentState={readerTree.state}
                  occurrenceId={readerTree.rootOccurrenceId}
                  scroll
                  publishComputed={false}
                />
              </React.Suspense>
            ) : plan?.loading || (reader.markdown && !plan) ? (
              // The markdown is in hand and the structure is not yet. Say so
              // rather than flashing the raw source for a frame — seeing the
              // asterisks appear and vanish reads as a bug.
              <div style={{
                height: "100%", display: "flex", flexDirection: "column", gap: 10,
                alignItems: "center", justifyContent: "center", color: "var(--text-muted)",
                fontSize: 12, fontFamily: "var(--font-mono)",
              }}>
                <Spinner size="md" className="staged-hold-spinner" />
                <span>Laying out the page…</span>
              </div>
            ) : (
              <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", padding: "12px 16px", display: "block" }}>
                {reader.markdown
                  ? "This page could not be laid out."
                  : "This page has no readable text — not live, and not in the archive."}
              </span>
            )}
          </div>
          )
        )}
        {url && mode === "blocked" && (
          // BOTH modes are unavailable: no readable text AND the site refuses to
          // be framed. Saying so beats a blank frame that looks broken, and the
          // reason is the site's own header rather than our guess.
          archive?.loading ? (
            // NOT "it cannot be displayed" — we are still finding out. The
            // snapshot lookup starts the moment the live page refuses, so this
            // is the honest state for that second rather than a verdict.
            <div style={{
              height: "100%", display: "flex", flexDirection: "column", gap: 10,
              alignItems: "center", justifyContent: "center", color: "var(--text-muted)",
              fontSize: 12, fontFamily: "var(--font-mono)",
            }}>
              <Spinner size="md" className="staged-hold-spinner" />
              <span>Looking for a saved copy…</span>
            </div>
          ) : (
          <div style={{ padding: 20, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
            <div style={{ marginBottom: 8 }}>
              This page will not open inside a panel — <code style={{ fontSize: 12 }}>{fetched?.frameBlockedBy || "the site refuses framing"}</code>
              {fetched?.usable === false && " — and it has no readable text to show instead."}
            </div>
            <a href={url} target="_blank" rel="noreferrer noopener"
               style={{ color: "var(--accent-blue-text, var(--text-primary))" }}>Open it in a new tab ↗</a>
          </div>
          )
        )}
        {url && mode === "archive" && (
          archive?.loading || !archive ? (
            // The same spinner the reader and the frame use (user, 2026-09-10: "we
            // also need loading circles for the reader and archive view") — this
            // branch was the one left as bare text.
            <div style={{
              height: "100%", display: "flex", flexDirection: "column", gap: 10,
              alignItems: "center", justifyContent: "center", color: "var(--text-muted)",
              fontSize: 12, fontFamily: "var(--font-mono)",
            }}>
              <Spinner size="md" className="staged-hold-spinner" />
              <span>Searching the archive…</span>
            </div>
          ) : archive.ok ? (
            // Framed like the live site, with the SAME sandbox: a snapshot is a
            // replay of a real page and can carry the same scripts.
            isActivePage ? (
              <iframe src={archive.url} title={`Archived ${url}`} sandbox={FRAME_SANDBOX}
                      style={{ ...FRAME_STYLE }} />
            ) : (
              <div className="text-xs text-muted-foreground" style={{ padding: 16 }}>
                Open this page in a panel to load the archived copy
              </div>
            )
          ) : (
            // NOT AN ERROR STATE for the common case: most private, deep or
            // recent URLs were simply never crawled. The offer to save it is
            // the actionable thing, and it is a link rather than a button
            // because saving is archive.org's write, not ours.
            <div style={{ padding: 20, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
              <div style={{ marginBottom: 8 }}>{archive.reason || "no snapshot"}</div>
              <a href={`https://web.archive.org/save/${url}`} target="_blank" rel="noreferrer noopener"
                 style={{ color: "var(--accent-blue-text, var(--text-primary))" }}>
                Ask the Wayback Machine to save it now ↗
              </a>
            </div>
          )
        )}
        {url && mode === "web" && (
          // A FRAME ONLY WHERE THIS IS A PANEL'S ACTIVE PAGE. `PreviewNode`
          // records that preview cards WERE iframes until 11 of them pegged the
          // browser; 1,467 bookmark rows must never be able to become 1,467
          // frames, and this is the rule that makes it impossible rather than
          // merely unlikely.
          isActivePage ? (
            // `height: 100%`, NOT `flex: 1` — the content wrapper above is a flex
            // CHILD but a plain BLOCK itself, so `flex` on its children is inert
            // and this box would collapse to auto, taking the frame's own
            // `height: 100%` down with it (user, 2026-09-10: *"the full page is
            // broken again (doesnt extend full height)"* — caused by the first
            // version of this wrapper). The reader branch beside it resolves the
            // same way for the same reason.
            <div style={{ position: "relative", height: "100%" }}>
              <iframe
                src={frameSrc}
                title={url}
                onLoad={() => setFrameLoading(false)}
                sandbox={FRAME_SANDBOX}
                style={{ ...FRAME_STYLE }}
              />
              {frameLoading && (
                // OVER the frame, not above it: a spinner that took its own row
                // would resize the page the moment it cleared. `pointer-events:
                // none` so it can never be the thing you click on a page that
                // has in fact loaded behind it.
                <div style={{
                  position: "absolute", inset: 0, display: "flex",
                  alignItems: "center", justifyContent: "center",
                  pointerEvents: "none", background: "var(--panel-bg)",
                }}>
                  {/* `.staged-hold-spinner` holds it for 150ms IN CSS, so a page
                      that answers quickly never flashes one — and unlike a JS
                      timer it still runs while the main thread is busy, which is
                      exactly the case this was asked for. */}
                  <Spinner size="md" className="staged-hold-spinner" />
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground" style={{ padding: 16 }}>
              Open this in a panel to load the page
            </div>
          )
        )}
      </div>
    </div>
  );
}
