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
import { useGridActionsSelector } from "../GridActionsContext.js";

const BTN_TITLES = {
  reader: "The page as text — selectable, right-clickable",
  web: "The live site",
  archive: "The closest Wayback Machine snapshot — for a dead link, or a page that has changed",
};

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
export function resolveMode({ chosen = null, fetched = null, embeddable = false } = {}) {
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
    return fetched && fetched.ok && fetched.framable === false ? "blocked" : "web";
  }
  if (chosen === "reader") return "reader";
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
  if (fetched.ok && fetched.framable === false) return "blocked";
  return "web";
}

/** The label the strip shows for why it fell through, or null when it did not. */
export function fallbackReason(fetched) {
  if (!fetched || fetched.ok === undefined) return null;
  if (!fetched.ok) return fetched.error || "could not be fetched";
  if (!fetched.usable) return "no readable text";
  return null;
}

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
  const url = resolved?.url || null;
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
  useEffect(() => {
    if (chosen !== "archive" || !url || !socket || archive) return;
    const req = ++archiveReqRef.current;
    setArchive({ loading: true });
    socket.emit("wayback_lookup", { url, requestId: String(req) }, (out) => {
      if (archiveReqRef.current !== req) return;
      setArchive(out || { ok: false, reason: "no reply" });
    });
  }, [chosen, url, socket, archive]);

  // The embeddable form of this url, or null. Computed here rather than inside
  // `resolveMode` so that function stays pure over its inputs and testable
  // without the table.
  const embedSrc = useMemo(() => embedUrlFor(url), [url]);
  const mode = resolveMode({ chosen, fetched, embeddable: !!embedSrc });
  const reason = fallbackReason(fetched);
  const pick = useCallback((m) => setChosen(m), []);

  if (!url) {
    return <div className="text-xs text-muted-foreground text-center empty-placeholder" style={{ paddingTop: 40 }}>
      Nothing to open — this row carries no link
    </div>;
  }

  const btn = (m, label) => (
    <button
      onClick={() => pick(m)}
      title={BTN_TITLES[m]}
      style={{
        padding: "2px 8px", fontSize: 12, fontFamily: "var(--font-mono)", cursor: "pointer",
        borderRadius: 4, border: "1px solid var(--border-default)",
        background: mode === m ? "var(--accent-blue)" : "var(--input-bg)",
        color: mode === m ? "var(--on-accent)" : "var(--text-muted)",
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
        borderBottom: "1px solid var(--border-subtle)", background: "var(--input-bg)",
        fontSize: 12, fontFamily: "var(--font-mono)",
      }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)" }} title={url}>
          {url.replace(/^https?:\/\/(www\.)?/, "")}
        </span>
        {reason && mode === "web" && (
          <span style={{ fontSize: 12, color: "var(--text-faint)" }} title={`Reader unavailable: ${reason}`}>
            reader: {reason}
          </span>
        )}
        {mode === "archive" && archive?.ok && archive.capturedAt && (
          <span style={{ fontSize: 12, color: "var(--text-faint)" }} title={archive.capturedAt}>
            captured {new Date(archive.capturedAt).toLocaleDateString()}
          </span>
        )}
        {btn("reader", "Reader")}
        {btn("web", "Web")}
        {btn("archive", "Archive")}
        <a href={url} target="_blank" rel="noreferrer noopener"
           style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "none", padding: "2px 4px" }}
           title="Open in a new tab">↗</a>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {mode === "loading" && (
          <div className="text-xs text-muted-foreground" style={{ padding: 16 }}>Reading…</div>
        )}
        {mode === "reader" && (
          // OUR DOM: selection and right-click work here, which is the whole
          // point of preferring this mode.
          <div style={{ height: "100%", overflowY: "auto", padding: "12px 16px", whiteSpace: "pre-wrap",
                        fontSize: 13, lineHeight: 1.55, color: "var(--text-primary)" }}>
            {fetched?.markdown || ""}
          </div>
        )}
        {mode === "blocked" && (
          // BOTH modes are unavailable: no readable text AND the site refuses to
          // be framed. Saying so beats a blank frame that looks broken, and the
          // reason is the site's own header rather than our guess.
          <div style={{ padding: 20, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
            <div style={{ marginBottom: 8 }}>
              This page will not open inside a panel — <code style={{ fontSize: 12 }}>{fetched?.frameBlockedBy || "the site refuses framing"}</code>
              {fetched?.usable === false && " — and it has no readable text to show instead."}
            </div>
            <a href={url} target="_blank" rel="noreferrer noopener"
               style={{ color: "var(--accent-blue-text, var(--text-primary))" }}>Open it in a new tab ↗</a>
          </div>
        )}
        {mode === "archive" && (
          archive?.loading || !archive ? (
            <div className="text-xs text-muted-foreground" style={{ padding: 16 }}>Searching the archive…</div>
          ) : archive.ok ? (
            // Framed like the live site, with the SAME sandbox: a snapshot is a
            // replay of a real page and can carry the same scripts.
            isActivePage ? (
              <iframe src={archive.url} title={`Archived ${url}`} sandbox={FRAME_SANDBOX}
                      style={{ width: "100%", height: "100%", border: 0, display: "block" }} />
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
        {mode === "web" && (
          // A FRAME ONLY WHERE THIS IS A PANEL'S ACTIVE PAGE. `PreviewNode`
          // records that preview cards WERE iframes until 11 of them pegged the
          // browser; 1,467 bookmark rows must never be able to become 1,467
          // frames, and this is the rule that makes it impossible rather than
          // merely unlikely.
          isActivePage ? (
            <iframe
              src={embedSrc || url}
              title={url}
              sandbox={FRAME_SANDBOX}
              style={{ width: "100%", height: "100%", border: 0, display: "block" }}
            />
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
