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
// `frameStyle` positions the status: the wrapper is what `inset: 0` resolves
// against, so a caller that wants the overlay centred on the picture gives the
// wrapper the picture's box. `display: contents` opts out entirely and lets an
// ancestor that is already positioned own it (what the artifact cards do — the
// card is the frame, and a wrapper between it and the img would break its
// layout).
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
  const [state, setState] = useState("loading");

  useEffect(() => {
    setState("loading");
    const el = ref.current;
    if (el && el.complete) setState(el.naturalWidth > 0 ? "ok" : "error");
  }, [src]);

  // After every hook, never before one.
  if (state === "error" && fallback) return fallback;

  return (
    <span className="img-load-wrap" style={frameStyle}>
      <img
        ref={ref}
        className={className}
        src={src}
        alt={alt}
        title={title}
        style={imgStyle}
        onLoad={() => setState("ok")}
        onError={() => setState("error")}
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
