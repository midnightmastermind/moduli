// ui/ToolbarClock.jsx
// The current date and time in the top toolbar (user, 2026-10-27). Ticks on the
// minute boundary, in its own component, so nothing else in the toolbar
// re-renders. `now` fixes the time for tests.
import React, { useEffect, useState } from "react";

export function formatToolbarClock(d) {
  const date = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return { date, time };
}

export default function ToolbarClock({ now: fixedNow = null }) {
  const [now, setNow] = useState(() => fixedNow || new Date());
  useEffect(() => {
    if (fixedNow) return undefined;
    let timer;
    const tick = () => {
      const d = new Date();
      setNow(d);
      timer = setTimeout(tick, 60000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50);
    };
    tick();
    return () => clearTimeout(timer);
  }, [fixedNow]);
  const { date, time } = formatToolbarClock(now);
  return (
    <div data-testid="toolbar-clock" title={now.toLocaleString()}
      className="flex items-baseline gap-1.5 px-1 whitespace-nowrap select-none"
      style={{ fontSize: 11, color: "var(--text-muted)" }}>
      <span>{date}</span>
      <span className="tabular-nums" style={{ color: "var(--text-primary)" }}>{time}</span>
    </div>
  );
}
