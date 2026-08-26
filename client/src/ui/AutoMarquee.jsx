// ui/AutoMarquee.jsx
// Auto-scrolls its content horizontally ONLY when the content is wider than
// its container (overflow). When it fits, it renders statically (no animation,
// no layout change). Used inside table cells so a long instance label / field
// value stays readable without widening the cell or being permanently clipped.
//
// Measurement: ResizeObserver on both the clip box and the inner content.
// When inner.scrollWidth > box.clientWidth by more than a small threshold, a
// CSS ping-pong animation (`auto-marquee-scroll`, alternate) translates the
// inner content by exactly the overflow distance, at a constant px/sec speed.
import { useRef, useState, useLayoutEffect, useEffect, useContext, createContext } from "react";

// STATIC INSIDE A PREVIEW CARD.
//
// A folder-page preview renders a whole page at ~0.15 scale into a thumbnail.
// Marquee there is worse than useless: it is unreadable at that size, it is
// non-interactive so nobody is waiting to read the rest of a label, and every
// instance costs TWO ResizeObservers plus a running CSS animation. Measured on
// poms grid: 565 `.auto-marquee` on one screen — a folder page multiplies that
// by its card count, on a surface whose whole job is to paint once and sit
// still (user, 2026-08-25: "turn off auto marque if you are in preview mode
// from a preview card. the little nodes dont need the auto marqueue").
//
// A CONTEXT rather than a prop: AutoMarquee is mounted from dozens of call
// sites — labels, field pills, table cells, headers — and threading a flag
// through all of them is the "wire it at every call site" shape that leaves the
// next one to forget. `PagePreviewBody` wraps its whole subtree once, so
// anything rendered inside a preview is static by construction.
export const StaticTextContext = createContext(false);

// ── A MARQUEE NOBODY CAN SEE STILL COSTS A FRAME ──────────────────────────
// User, 2026-08-26: "scroll is too slow on mobile tablet ... and the painting
// is too slow for scroll." The paint trace named this: on the live grid at
// 1280x800, **50 CSS animations were running and 46 of them were on elements
// OFF SCREEN** — still 50 after four idle seconds, so the compositor never went
// quiet at rest. Each running transform animation is its own compositing
// reason, and `Layerize` alone was 1766ms of a 3834ms main thread during a
// 60-step scroll.
//
// The animation is therefore not emitted at all while the element is out of
// view, rather than merely paused: `animation-play-state: paused` keeps the
// layer and the compositing reason, which is most of the cost. Re-entering
// restarts the scroll from the beginning, which is what you want anyway — you
// are looking at the label now.
//
// A/B'd BY SWAPPING THE BUILT BUNDLE BETWEEN RUNS, three interleaved passes
// against one server — because measuring the two halves in separate server
// sessions drifted 14-25% and would have overstated this by half:
//   main-thread task   3834ms -> 3355ms   (-12%, ranges do not overlap)
//   Layerize           1766ms -> 1290ms   (-27%)
//   RecalcStyle         239ms ->   74ms   (-69%)
//   running animations     50 ->      4     off-screen ones 46 -> 0
// A NULL ARM (a rule matching no element) read as baseline, which is what says
// the instrument discriminates — the previous attempt at this measurement was
// abandoned when a null mutation "won" by 24%.
//
// STILL ON THE TABLE, with its number: killing marquee animation outright
// (`.auto-marquee-inner{animation:none}`) reached ~2300ms on the same machine,
// so roughly two thirds of the headroom is left. It is not the three visible
// marquees — it is the layer CHURN of arming and disarming animations as rows
// cross the viewport edge during the gesture. That wants its own pass.
//
// Fails OPEN. Without IntersectionObserver the marquee behaves exactly as it
// did before, because a label that never scrolls is a worse bug than a frame.
const SPEED_PX_PER_SEC = 35; // scroll speed; lower = slower
const MIN_DURATION_S = 4;     // ensures the end-of-travel pauses read clearly
const THRESHOLD_PX = 3; // ignore sub-pixel / rounding overflow

export default function AutoMarquee({ children, className = "" }) {
  const boxRef = useRef(null);
  const innerRef = useRef(null);
  const [shift, setShift] = useState(0);
  // No IntersectionObserver → treat it as visible, i.e. today's behaviour.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  const isStatic = useContext(StaticTextContext);

  // Mount-once ([] deps): the ResizeObserver below covers every subsequent
  // box/content size change, including children swaps that change the inner
  // width. Running this effect on EVERY render (the previous no-deps form)
  // forced a synchronous reflow (scrollWidth read) + observer teardown/rebuild
  // per re-rendered label — hundreds per drop commit in the CPU profile.
  useLayoutEffect(() => {
    // No measurement AND no observers in a preview — the cost this exists to
    // avoid is the ResizeObserver pair, not just the animation.
    if (isStatic) return;
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const measure = () => {
      const over = inner.scrollWidth - box.clientWidth;
      setShift(over > THRESHOLD_PX ? over : 0);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [isStatic]);

  // Visibility is watched only when there is something to animate — an
  // observer per static label is the very per-instance cost this file already
  // refuses for the ResizeObserver pair.
  useEffect(() => {
    if (isStatic || shift <= 0) return;
    if (typeof IntersectionObserver === "undefined") return;
    const box = boxRef.current;
    if (!box) return;
    const io = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      // A small margin so a label is already moving by the time it is read,
      // rather than starting under the eye.
      { rootMargin: "100px" }
    );
    io.observe(box);
    return () => io.disconnect();
  }, [isStatic, shift]);

  const activeShift = isStatic || !inView ? 0 : shift;
  const duration = activeShift > 0
    ? Math.max(MIN_DURATION_S, activeShift / SPEED_PX_PER_SEC)
    : 0;

  return (
    <span
      ref={boxRef}
      className={`auto-marquee ${className}`}
      // borderRadius matches the field-pill / input radius (4-5px) so when a
      // marquee wraps a pill it doesn't break the rounded outline.
      style={{ display: "block", overflow: "hidden", whiteSpace: "nowrap", maxWidth: "100%", minWidth: 0, borderRadius: 4 }}
    >
      <span
        ref={innerRef}
        className="auto-marquee-inner"
        style={
          activeShift > 0
            ? {
                display: "inline-block",
                animation: `auto-marquee-scroll ${duration}s linear infinite alternate`,
                // exact overflow distance, negative = scroll content leftward
                ["--mq-shift"]: `-${activeShift}px`,
              }
            : { display: "inline-block" }
        }
      >
        {children}
      </span>
    </span>
  );
}
