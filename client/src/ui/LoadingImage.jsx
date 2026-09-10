import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Spinner } from "../components/ui/spinner";

// An <img> that says what it is doing.
//
// Every picture in the app is a REMOTE fetch — an upload behind the server, a
// board thumbnail, a search result someone pasted — so there is always a window
// where the frame is empty. Left alone that reads as "there is nothing here",
// which is indistinguishable from a broken reference. A spinner says "wait", a
// broken-image glyph says "this one is gone"; a blank box says neither.
//
// ── WHY THE STATUS IS AN OVERLAY, NOT A REPLACEMENT ─────────────────────────
// The status renders ON TOP of the img rather than instead of it, so the frame
// NEVER changes size when the picture arrives. Swapping a spinner element for
// an <img> reflows every row around it at the moment the image loads, which is
// the jitter this is meant to remove in the first place.
//
// ── `el.complete` ON MOUNT IS LOAD-BEARING ──────────────────────────────────
// A CACHED image can finish decoding before React attaches onLoad, and that
// event never fires again. Without this check a re-opened dropdown — every
// picture already in cache — would spin forever on images that are right there.
//
// ── `fallback` IS A REPLACEMENT, AND THAT IS THE EXCEPTION TO THE RULE ABOVE ─
// The status is an overlay so the frame never resizes mid-load. A `fallback` is
// different in kind: it is not a transient state, it is the final answer that
// this picture does not exist. A caller with something better to draw than a
// broken-image glyph — a bookmark that still has its own 📄 thumbnail — says so
// here, and gets it INSTEAD of the img. Nothing reflows twice, because the
// image never arrives.
//
// It is opt-in: without one, a dead image still says so, which is the whole
// point of this component.
//
// ── THE IMG IS HIDDEN UNTIL IT HAS FULLY DECODED ────────────────────────────
// A remote JPEG/PNG paints AS ITS BYTES ARRIVE — progressive files sharpen in
// passes, baseline ones fill in top-down — so a visible <img> mid-fetch shows a
// half-drawn picture "printing down" the frame, with the spinner floating over
// the part that has not arrived. Holding it at `opacity: 0` until it is decoded
// means a picture appears whole or not at all.
//
// It is OPACITY rather than not rendering the img, for the same reason the
// status is an overlay: the element must keep its box the whole time or every
// row reflows the moment a picture lands.
//
// `decode()` and not just `onLoad` — onLoad fires when the BYTES are in, and
// the decode still happens on the main thread at first paint, which on a wall
// of tiles is exactly the hitch this removes. It is awaited off the event, and
// a rejection (a removed node, a format the browser will not decode) falls
// through to showing the img anyway rather than hiding it forever.
//
// `frameStyle` positions the status: the wrapper is what `inset: 0` resolves
// against, so a caller that wants the overlay centred on the picture gives the
// wrapper the picture's box. `display: contents` opts out entirely and lets an
// ancestor that is already positioned own it (what the artifact cards do — the
// card is the frame, and a wrapper between it and the img would break its
// layout).
// ── A COVER THAT FAILED ONCE IS NOT ASKED FOR AGAIN ───────────────────────
//
// User, 2026-09-10: the viewer *"takes forever to open"*. Their console log is
// the measurement — 232 image GETs between two `__renderTally()` calls and **203
// `NS_ERROR_DOM_NETWORK_ERR`**. The hosts name themselves:
// `scontent.cdninstagram.com` (60 of them — Instagram blocks hotlinking, so
// every one fails), dead blogs, CORP-blocked CDNs. These are the bookmark
// COVERS, and each failure costs a DNS lookup, a TCP connect and a TLS
// handshake before the browser gives up.
//
// The state below is per INSTANCE, so a card that unmounts and remounts —
// virtualisation, scrolling, the churn that reads as 3,221 instance renders in
// that same tally — mounts a fresh `<img>` on the same dead src and the browser
// pays for it all over again.
//
// Session-scoped ON PURPOSE, not persisted: "this host was unreachable" is a
// fact about a moment, and a bookmark that failed on a flaky connection must get
// another chance on the next load rather than being written off for good.
//
// Bounded, because a diagnostic-shaped cache must not become the leak it was
// added to prevent. At the cap it stops recording rather than evicting — the
// worst case is the OLD behaviour for later images, never a wrong answer.
const FAILED_SRC = new Set();
const FAILED_CAP = 5000;
export function rememberFailedSrc(src) {
  if (src && FAILED_SRC.size < FAILED_CAP) FAILED_SRC.add(src);
}
/** Exported for tests: a session's failures are not observable any other way. */
export function _resetFailedSrc() { FAILED_SRC.clear(); }

export default function LoadingImage({
  src,
  alt = "",
  className,
  imgStyle,
  frameStyle,
  spinnerSize = "sm",
  errorSize = 14,
  title,
  fallback = null,
}) {
  const ref = useRef(null);
  const [state, setState] = useState(() => (src && FAILED_SRC.has(src) ? "error" : "loading"));

  // Reveal only once the bitmap is ready to paint. Guarded by the src it was
  // started for, so a fast re-point cannot reveal the previous picture.
  const reveal = (el, forSrc) => {
    const done = () => {
      if (ref.current === el && el.getAttribute("src") === forSrc) setState("ok");
    };
    if (typeof el.decode === "function") el.decode().then(done, done);
    else done();
  };

  useEffect(() => {
    if (src && FAILED_SRC.has(src)) { setState("error"); return; }
    setState("loading");
    const el = ref.current;
    if (!el || !el.complete) return;
    if (el.naturalWidth > 0) reveal(el, el.getAttribute("src"));
    else { rememberFailedSrc(src); setState("error"); }
  }, [src]);

  // After every hook, never before one.
  if (state === "error" && fallback) return fallback;

  return (
    <span className="img-load-wrap" style={frameStyle}>
      <img
        ref={ref}
        className={className}
        // THE SRC IS DROPPED ONCE IT IS KNOWN DEAD, and the ELEMENT is kept.
        // An `<img>` carrying a src IS the request, so leaving one in place
        // would re-ask on every remount — which is the entire cost being
        // removed. Removing the element instead would resize the frame, which
        // `LoadingImage.test.jsx` pins as its own contract ("keeps the img
        // mounted in every state, so the frame never resizes").
        src={state === "error" ? undefined : src}
        alt={alt}
        title={title}
        style={{
          ...imgStyle,
          opacity: state === "ok" ? (imgStyle?.opacity ?? 1) : 0,
          transition: "opacity 120ms ease-out",
        }}
        onLoad={(e) => reveal(e.currentTarget, e.currentTarget.getAttribute("src"))}
        onError={() => { rememberFailedSrc(src); setState("error"); }}
      />
      {state === "loading" && (
        <span className="img-load-status" aria-hidden="true">
          <Spinner size={spinnerSize} />
        </span>
      )}
      {state === "error" && (
        <span
          className="img-load-status img-load-status--error"
          title="This image could not be loaded"
        >
          <AlertCircle style={{ width: errorSize, height: errorSize }} />
        </span>
      )}
    </span>
  );
}
