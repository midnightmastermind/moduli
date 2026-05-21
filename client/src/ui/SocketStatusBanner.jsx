// ui/SocketStatusBanner.jsx
//
// Small inline pill rendered in the toolbar that reflects socket
// connectivity. Three states:
//   "connected"    → renders nothing (the indicator hides entirely
//                    once the recovered pill has faded).
//   "disconnected" → red pill with pulsing dot + "Disconnected —
//                    retrying…". Stays for the entire outage; the
//                    offline queue (helpers/offlineQueue.js) is
//                    silently buffering writes during this time.
//   "recovered"    → green pill with "Reconnected"; fades out
//                    automatically after ~3s (driven by the hook).
//
// Tooltip on the disconnected state explains that writes are queued
// locally so the user knows nothing's been lost. Mobile gets the same
// affordance via the same component — it's small enough that it fits
// the toolbar on phones too.

import React from "react";
import { WifiOff, Wifi } from "lucide-react";
import { useSocketStatus } from "../hooks/useSocketStatus";

export default function SocketStatusBanner() {
  const { status, attempts, retryInMs } = useSocketStatus();

  if (status === "connected") return null;

  const isDown = status === "disconnected";
  const Icon = isDown ? WifiOff : Wifi;
  let label;
  if (!isDown) {
    label = "Reconnected";
  } else if (retryInMs > 0) {
    // ceil so the user sees a smooth countdown ("3s … 2s … 1s")
    // instead of jumping from "1s" straight to "trying".
    const seconds = Math.ceil(retryInMs / 1000);
    label = `Disconnected — retry in ${seconds}s${attempts > 0 ? ` (attempt ${attempts + 1})` : ""}`;
  } else {
    label = attempts > 0 ? `Disconnected — trying now (attempt ${attempts})` : "Disconnected — retrying…";
  }
  const tooltip = isDown
    ? "Connection to server lost. Your changes are being saved locally and will sync when the connection comes back."
    : "Connection restored. Buffered changes have been replayed.";

  return (
    <div
      title={tooltip}
      className="socket-status-pill font-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 22,
        padding: "0 8px",
        borderRadius: 999,
        fontSize: 10,
        whiteSpace: "nowrap",
        background: isDown ? "rgba(248, 113, 113, 0.15)" : "rgba(74, 222, 128, 0.15)",
        border: `1px solid ${isDown ? "rgba(248, 113, 113, 0.45)" : "rgba(74, 222, 128, 0.45)"}`,
        color: isDown ? "#fca5a5" : "#86efac",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6, height: 6, borderRadius: "50%",
          background: isDown ? "#f87171" : "#4ade80",
          animation: isDown ? "socket-status-pulse 1.2s ease-in-out infinite" : "none",
        }}
      />
      <Icon size={11} aria-hidden />
      <span>{label}</span>
    </div>
  );
}
