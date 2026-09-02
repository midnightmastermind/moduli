// ui/OpActivityPill.jsx
//
// Sits beside SocketStatusBanner and answers the same kind of question: is it
// safe to act right now? The socket pill says the connection is down; this one
// says the GRID IS STILL WORKING.
//
// User, 2026-09-02: *"is there any way we can have a notification where the
// reconnected message is, to say that ops are still running. that way i dont
// try to drag during it"* — after a drag capture showed 80% of the gesture
// inside long tasks with ~1s of op sweeps landing during it.
//
// Amber, deliberately: red is the socket pill's outage and green is its
// recovery, and this is neither a fault nor an all-clear. It is "wait".

import React, { useSyncExternalStore } from "react";
import { Loader } from "lucide-react";
import { subscribeOpActivity, getOpActivity } from "../helpers/opActivity";

export default function OpActivityPill() {
  const act = useSyncExternalStore(subscribeOpActivity, getOpActivity, getOpActivity);
  if (!act.busy) return null;

  return (
    <div
      title="The grid is still applying operations. A drag started now will feel slow — this clears on its own."
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
        background: "rgba(251, 191, 36, 0.15)",
        border: "1px solid rgba(251, 191, 36, 0.45)",
        color: "#fcd34d",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "#fbbf24",
          animation: "socket-status-pulse 1.2s ease-in-out infinite",
        }}
      />
      <Loader size={11} aria-hidden />
      <span>Operations running</span>
    </div>
  );
}
