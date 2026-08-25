// ui/TransactionNotificationStack.jsx
//
// Slim chip-style cards that live in the very same toolbar slot as
// SocketStatusBanner. Chips are arranged left-to-right in chronological
// order (newest on the left). One chip at a time is "open" — full
// chrome with × button, marquee, relative time, and the read-full
// popout. The others show their leading dot+icon as a peek.
//
// Up to six chips render in the horizontal stack. When more than six
// exist, a trailing "+N" pill appears; clicking it drops a vertical
// list of the overflow notifications below the toolbar so the user
// can dismiss/expand any of them.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, AlertTriangle, Loader2, X, Maximize2, Info } from "lucide-react";
import {
  subscribeTxNotifications,
  dismissTxNotification,
} from "../state/notificationStore";

// Each chip uses two background layers — a colored tint over an
// opaque surface — so stacked chips don't bleed through each other.
// Matches SocketStatusBanner's pill visual.
// Each chip is a coloured tint over an opaque surface, so stacked chips do not
// bleed through each other. Matches SocketStatusBanner's pill visual.
//
// EVERY COLOUR IS A SIGNAL TOKEN. These were fifteen literal hex values, so the
// toast stack painted the same tailwind palette on every skin — a green success
// chip in front of Stardew's cream and brown. Same class as `valueSignPillTint`'s
// hardcoded emerald (2026-08-19 (8)); found by grepping the literal rather than
// the call sites, which is the lesson that entry's successor recorded.
//
// `info` is the one that is NOT a signal — it is a neutral chip, so it reads the
// theme's own muted ink instead of borrowing a hue that would imply a meaning.
const chip = (token) => ({
  bg: `linear-gradient(rgba(var(${token}) / 0.15), rgba(var(${token}) / 0.15)), var(--surface-card)`,
  border: `rgba(var(${token}) / 0.45)`,
  color: `rgba(var(${token}) / 0.92)`,
  dot: `rgb(var(${token}))`,
});
const NEUTRAL = {
  bg: "linear-gradient(var(--input-bg), var(--input-bg)), var(--surface-card)",
  border: "var(--border-default)",
  color: "var(--text-primary)",
  dot: "var(--text-muted)",
};
const KIND_STYLES = {
  success: { ...chip("--signal-pos"),  Icon: Check },
  error:   { ...chip("--signal-neg"),  Icon: AlertTriangle },
  pending: { ...chip("--signal-zero"), Icon: Loader2 },
  info:    { ...NEUTRAL,               Icon: Info },
  warning: { ...chip("--signal-warn"), Icon: AlertTriangle },
};

// Neutral pill for the "+N" overflow indicator.
const OVERFLOW_STYLE = { ...NEUTRAL };

const VISIBLE_MAX = 6;        // hard cap on inline chips; overflow → "+N"
const PEEK_OFFSET = 14;       // px each older card peeks past the previous
const CHIP_HEIGHT = 22;       // matches SocketStatusBanner pill height
const CHIP_WIDTH = 280;       // fixed chip width — labels marquee inside
const OVERFLOW_PILL_WIDTH = 36;
const LABEL_TRACK_GAP = 28;
const MARQUEE_PX_PER_SEC = 36;

function formatClockTime(ts) {
  const d = new Date(ts);
  const hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, "0");
  const period = hh >= 12 ? "PM" : "AM";
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}:${mm} ${period}`;
}

function Chip({ note, index, isOpen, openIndex, onOpen, now }) {
  const style = KIND_STYLES[note.kind] || KIND_STYLES.pending;
  const Icon = style.Icon;
  const treatAsOpen = isOpen;

  const labelRef = useRef(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    if (!treatAsOpen) { setOverflows(false); return; }
    const el = labelRef.current;
    if (!el) return;
    const single = el.querySelector("[data-tx-label-copy]");
    if (!single) return;
    setOverflows(single.scrollWidth > el.clientWidth);
  }, [note.label, treatAsOpen]);

  const animate = treatAsOpen && overflows;
  const durationSec = animate
    ? Math.max(4, (labelRef.current?.querySelector("[data-tx-label-copy]")?.scrollWidth || 0) / MARQUEE_PX_PER_SEC)
    : 0;

  // z-index in the inline stack.
  const z = isOpen ? 1000 : 500 - Math.abs(index - openIndex);
  const positional = { position: "absolute", top: 0, left: index * PEEK_OFFSET, zIndex: z };

  return (
    <div
      role={treatAsOpen ? undefined : "button"}
      tabIndex={treatAsOpen ? -1 : 0}
      onClick={treatAsOpen ? undefined : () => onOpen?.(note.id)}
      onKeyDown={treatAsOpen ? undefined : (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.(note.id);
        }
      }}
      title={`${note.label} · ${formatClockTime(note.createdAt)}`}
      style={{
        ...positional,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: CHIP_HEIGHT,
        width: CHIP_WIDTH,
        padding: "0 6px 0 4px",
        borderRadius: 999,
        fontSize: 10,
        lineHeight: 1,
        whiteSpace: "nowrap",
        background: style.bg,
        border: `1px solid ${style.border}`,
        color: style.color,
        cursor: treatAsOpen ? "default" : "pointer",
        overflow: "hidden",
      }}
    >
      {treatAsOpen && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={(e) => {
            e.stopPropagation();
            dismissTxNotification(note.id);
          }}
          style={dismissBtnStyle(style.color)}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; }}
        >
          <X size={10} strokeWidth={2.5} aria-hidden />
        </button>
      )}

      <span
        aria-hidden
        style={{
          flex: "0 0 auto",
          width: 6, height: 6, borderRadius: "50%",
          background: style.dot,
          animation: note.kind === "pending" ? "socket-status-pulse 1.2s ease-in-out infinite" : "none",
        }}
      />
      <Icon
        size={11}
        aria-hidden
        style={{
          flex: "0 0 auto",
          animation: note.kind === "pending" ? "spin-cw 1.2s linear infinite" : undefined,
        }}
      />

      {/* Label + time render ONLY on the open chip / overflow rows.
          Closed peek chips show just their colored tab (dot + icon)
          so the stack reads as a row of tabs. */}
      {treatAsOpen ? (
        <>
          <div
            ref={labelRef}
            style={{
              flex: "1 1 auto",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                animation: animate ? `tx-marquee ${durationSec}s linear infinite` : "none",
                willChange: animate ? "transform" : "auto",
              }}
            >
              <span data-tx-label-copy style={{ paddingRight: LABEL_TRACK_GAP }}>{note.label}</span>
              {animate && <span aria-hidden style={{ paddingRight: LABEL_TRACK_GAP }}>{note.label}</span>}
            </div>
          </div>
          <span
            style={{
              flex: "0 0 auto",
              fontSize: 9,
              opacity: 0.75,
              letterSpacing: 0.2,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatClockTime(note.createdAt)}
          </span>
        </>
      ) : (
        // Spacer flex-grow so the chip still occupies its 180px slot
        // (needed for the peek-offset stacking math) but renders no
        // text content.
        <span style={{ flex: "1 1 auto" }} aria-hidden />
      )}

      {treatAsOpen && <ExpandButton note={note} color={style.color} />}
    </div>
  );
}

function dismissBtnStyle(color) {
  return {
    flex: "0 0 auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 14,
    height: 14,
    border: 0,
    borderRadius: "50%",
    background: "transparent",
    color,
    cursor: "pointer",
    padding: 0,
    opacity: 0.7,
  };
}

function ExpandButton({ note, color }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      const card = document.getElementById(`tx-popout-${note.id}`);
      if (card && card.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, note.id]);

  return (
    <>
      <button
        type="button"
        aria-label="Read full message"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        style={{
          flex: "0 0 auto",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 14,
          height: 14,
          border: 0,
          borderRadius: 3,
          background: "transparent",
          color,
          cursor: "pointer",
          padding: 0,
          opacity: 0.7,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; }}
      >
        <Maximize2 size={10} strokeWidth={2.5} aria-hidden />
      </button>
      {open && (
        <div
          id={`tx-popout-${note.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: CHIP_HEIGHT + 6,
            left: 0,
            zIndex: 1000,
            maxWidth: 320,
            minWidth: 180,
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 11,
            lineHeight: 1.35,
            whiteSpace: "normal",
            background: "var(--surface-overlay)",
            border: `1px solid ${color}55`,
            color: "var(--text-primary, #e5e7eb)",
            boxShadow: "var(--menu-shadow-1)",
            cursor: "auto",
          }}
        >
          <div style={{ marginBottom: 4, fontSize: 9, opacity: 0.7, letterSpacing: 0.4, textTransform: "uppercase" }}>
            {formatClockTime(note.createdAt)}
          </div>
          {note.label}
        </div>
      )}
    </>
  );
}

// Human-readable kind label for the card header.
const KIND_LABELS = {
  success: "Success",
  error: "Error",
  warning: "Warning",
  info: "Info",
  pending: "Working",
};

// Roomy multi-line card used inside the overflow dropdown (NOT the inline
// stack). Header row = dot + icon + kind + time + dismiss; the full message
// wraps on its own line(s) below, so nothing is cramped onto one line.
function NotificationCard({ note }) {
  const style = KIND_STYLES[note.kind] || KIND_STYLES.pending;
  const Icon = style.Icon;
  const isPending = note.kind === "pending";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: "100%",
        padding: "8px 12px",
        borderRadius: 8,
        background: style.bg,
        border: `1px solid ${style.border}`,
        color: style.color,
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          aria-hidden
          style={{
            flex: "0 0 auto",
            width: 7, height: 7, borderRadius: "50%",
            background: style.dot,
            animation: isPending ? "socket-status-pulse 1.2s ease-in-out infinite" : "none",
          }}
        />
        <Icon
          size={13}
          aria-hidden
          style={{ flex: "0 0 auto", animation: isPending ? "spin-cw 1.2s linear infinite" : undefined }}
        />
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", opacity: 0.9 }}>
          {KIND_LABELS[note.kind] || note.kind}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 9,
            opacity: 0.7,
            letterSpacing: 0.2,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {formatClockTime(note.createdAt)}
        </span>
      </div>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.4,
          color: "var(--text-primary, #e5e7eb)",
          whiteSpace: "normal",
          wordBreak: "break-word",
        }}
      >
        {note.label}
      </div>
    </div>
  );
}

// "+N" pill sitting at the far right of the inline stack. Clicking
// opens a portal-rendered list of EVERY notification (visible + overflow)
// anchored under the pill. Portal avoids stacking-context conflicts that
// were letting the dropdown "blank out" the page tabs underneath.
function OverflowPill({ count, leftPx, allItems, now, compact = false }) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const ref = useRef(null);

  // Re-measure the pill on open + on scroll/resize so the portal can
  // anchor against viewport coords.
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      if (ref.current) setAnchorRect(ref.current.getBoundingClientRect());
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      const dd = document.getElementById("tx-overflow-dropdown");
      if (dd && dd.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close when nothing's left to show.
  useEffect(() => {
    if (open && allItems.length === 0) setOpen(false);
  }, [open, allItems.length]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        title={`${count} notification${count === 1 ? "" : "s"} · click to view all`}
        onClick={() => setOpen(o => !o)}
        style={{
          position: compact ? "relative" : "absolute",
          top: compact ? undefined : 0,
          left: compact ? undefined : leftPx,
          zIndex: 1100,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          height: CHIP_HEIGHT,
          width: OVERFLOW_PILL_WIDTH,
          padding: 0,
          borderRadius: 999,
          fontSize: 10,
          fontVariantNumeric: "tabular-nums",
          background: OVERFLOW_STYLE.bg,
          border: `1px solid ${OVERFLOW_STYLE.border}`,
          color: OVERFLOW_STYLE.color,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {count}
      </button>
      {open && anchorRect && createPortal(
        <div
          id="tx-overflow-dropdown"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: anchorRect.bottom + 6,
            left: Math.max(8, Math.min(window.innerWidth - 428, anchorRect.right - 420)),
            zIndex: 10000,
            width: 420,
            maxHeight: 440,
            overflowY: "auto",
            padding: 8,
            borderRadius: 8,
            background: "var(--surface-overlay)",
            border: "1px solid var(--border-default, rgba(148,163,184,0.4))",
            boxShadow: "var(--menu-shadow-1)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {allItems.map((n) => (
            <NotificationCard key={n.id} note={n} />
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

export default function TransactionNotificationStack({ compact = false }) {
  const [items, setItems] = useState([]);
  const [openIdState, setOpenIdState] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => subscribeTxNotifications(setItems), []);

  // Re-render every 30s so the relative-time fragments stay current
  // without burning a tick per second.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // Inline toolbar stack shows only the ACTIVE (undismissed) pills. The
  // dropdown shows the full `items` log (active + dismissed).
  const active = useMemo(() => items.filter(n => !n.dismissed), [items]);

  const openId = useMemo(() => {
    if (!active.length) return null;
    if (openIdState && active.some(n => n.id === openIdState)) return openIdState;
    return active[0].id;
  }, [active, openIdState]);

  const openIndex = useMemo(
    () => (openId ? active.findIndex(n => n.id === openId) : -1),
    [active, openId]
  );

  const visible = active.slice(0, VISIBLE_MAX);
  // Everything not shown inline (dismissed pills + active overflow beyond
  // VISIBLE_MAX) lives in the dropdown log. The +N pill opens it.
  const hiddenCount = items.length - visible.length;
  const hasHistory = hiddenCount > 0;

  if (!items.length) return null;

  // Compact mode: just a small count pill that opens the full dropdown.
  // Used on mobile where the inline chip stack is too wide.
  if (compact) {
    return (
      <OverflowPill
        count={items.length}
        leftPx={0}
        allItems={items}
        now={now}
        compact
      />
    );
  }

  // Right-edge of the visible chip stack (last chip's right edge =
  // its left position + CHIP_WIDTH). The +N pill sits just past that
  // with a small visual gap so it reads as a trailing addendum
  // instead of floating in the middle of the open chip.
  const chipsRightEdge = visible.length > 0
    ? (visible.length - 1) * PEEK_OFFSET + CHIP_WIDTH
    : 0;
  const overflowGap = 6;
  const overflowLeft = chipsRightEdge + overflowGap;
  const stackWidth = hasHistory
    ? overflowLeft + OVERFLOW_PILL_WIDTH
    : chipsRightEdge;

  return (
    <div
      className="font-mono"
      style={{
        position: "relative",
        height: CHIP_HEIGHT,
        width: stackWidth,
        display: "inline-block",
      }}
    >
      {visible.map((n, i) => (
        <Chip
          key={n.id}
          note={n}
          index={i}
          isOpen={n.id === openId}
          openIndex={openIndex < VISIBLE_MAX ? openIndex : 0}
          onOpen={setOpenIdState}
          now={now}
        />
      ))}
      {hasHistory && (
        <OverflowPill
          count={hiddenCount}
          leftPx={overflowLeft}
          allItems={items}
          now={now}
        />
      )}
    </div>
  );
}
