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
import { useRef, useState, useLayoutEffect } from "react";

const SPEED_PX_PER_SEC = 35; // scroll speed; lower = slower
const MIN_DURATION_S = 2.5;
const THRESHOLD_PX = 3; // ignore sub-pixel / rounding overflow

export default function AutoMarquee({ children, className = "" }) {
  const boxRef = useRef(null);
  const innerRef = useRef(null);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
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
  });

  const duration = shift > 0
    ? Math.max(MIN_DURATION_S, shift / SPEED_PX_PER_SEC)
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
          shift > 0
            ? {
                display: "inline-block",
                animation: `auto-marquee-scroll ${duration}s linear infinite alternate`,
                // exact overflow distance, negative = scroll content leftward
                ["--mq-shift"]: `-${shift}px`,
              }
            : { display: "inline-block" }
        }
      >
        {children}
      </span>
    </span>
  );
}
