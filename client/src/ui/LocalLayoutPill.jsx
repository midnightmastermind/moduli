// ui/LocalLayoutPill.jsx — says when this tab is keeping its layout to itself
// (helpers/localLayout: set by the VR office), and puts it back in step.
import React, { useEffect, useState } from "react";
import { isLocalLayout, setLocalLayout, subscribeLocalLayout } from "../helpers/localLayout.js";

export default function LocalLayoutPill({ hidden }) {
  const [on, setOn] = useState(isLocalLayout());
  useEffect(() => subscribeLocalLayout(setOn), []);
  if (!on || hidden) return null;
  return (
    <div role="status" style={{
      position: "fixed", bottom: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1500,
      display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "6px 10px", borderRadius: 999,
      background: "var(--surface-card)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)",
      boxShadow: "var(--menu-shadow-1)",
    }}>
      Panels and date on this device only
      <button
        onClick={() => { setLocalLayout(false); window.location.reload(); }}
        style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, cursor: "pointer", border: "1px solid var(--border-subtle)", background: "transparent", color: "inherit" }}
      >Sync with my other devices</button>
    </div>
  );
}
