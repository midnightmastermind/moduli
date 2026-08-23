// modules/pages/PageIframe.jsx
//
// The IFRAME VIEW — a web page as a first-class surface, so a bookmark or a link
// opens in a panel like any other page.
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
import { occurrenceUrl } from "../../helpers/occurrenceUrl";

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
export function resolveMode({ chosen = null, fetched = null } = {}) {
  if (chosen === "web" || chosen === "reader") return chosen;
  if (!fetched) return "loading";
  return fetched.ok && fetched.usable ? "reader" : "web";
}

/** The label the strip shows for why it fell through, or null when it did not. */
export function fallbackReason(fetched) {
  if (!fetched || fetched.ok === undefined) return null;
  if (!fetched.ok) return fetched.error || "could not be fetched";
  if (!fetched.usable) return "no readable text";
  return null;
}

export default function PageIframe({ occurrence, module = null, fieldsById = {}, socket, isActivePage = true }) {
  const resolved = useMemo(
    () => occurrenceUrl(occurrence, { module, fieldsById }),
    [occurrence, module, fieldsById],
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

  const mode = resolveMode({ chosen, fetched });
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
      title={m === "reader" ? "The page as text — selectable, right-clickable" : "The live site"}
      style={{
        padding: "2px 8px", fontSize: 10, fontFamily: "var(--font-mono)", cursor: "pointer",
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
        fontSize: 11, fontFamily: "var(--font-mono)",
      }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)" }} title={url}>
          {url.replace(/^https?:\/\/(www\.)?/, "")}
        </span>
        {reason && mode === "web" && (
          <span style={{ fontSize: 9, color: "var(--text-faint)" }} title={`Reader unavailable: ${reason}`}>
            reader: {reason}
          </span>
        )}
        {btn("reader", "Reader")}
        {btn("web", "Web")}
        <a href={url} target="_blank" rel="noreferrer noopener"
           style={{ fontSize: 10, color: "var(--text-muted)", textDecoration: "none", padding: "2px 4px" }}
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
        {mode === "web" && (
          // A FRAME ONLY WHERE THIS IS A PANEL'S ACTIVE PAGE. `PreviewNode`
          // records that preview cards WERE iframes until 11 of them pegged the
          // browser; 1,467 bookmark rows must never be able to become 1,467
          // frames, and this is the rule that makes it impossible rather than
          // merely unlikely.
          isActivePage ? (
            <iframe
              src={url}
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
