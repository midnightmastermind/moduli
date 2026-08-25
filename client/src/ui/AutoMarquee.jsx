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
import { useRef, useState, useLayoutEffect, useContext, createContext } from "react";

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

const SPEED_PX_PER_SEC = 35; // scroll speed; lower = slower
const MIN_DURATION_S = 4;     // ensures the end-of-travel pauses read clearly
const THRESHOLD_PX = 3; // ignore sub-pixel / rounding overflow

export default function AutoMarquee({ children, className = "" }) {
  const boxRef = useRef(null);
  const innerRef = useRef(null);
  const [shift, setShift] = useState(0);
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

  const activeShift = isStatic ? 0 : shift;
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
