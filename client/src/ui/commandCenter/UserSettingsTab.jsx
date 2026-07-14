// ui/commandCenter/UserSettingsTab.jsx

import React, { useState } from "react";
import { Save } from "lucide-react";
import { useGridActions } from "../../GridActionsContext";

export function UserSettingsTab() {
  const { state } = useGridActions();
  const userId = state?.userId;
  const [displayName, setDisplayName] = useState(() => localStorage.getItem("moduli-displayName") || "");

  const save = () => localStorage.setItem("moduli-displayName", displayName.trim());

  return (
    <div className="p-4 flex flex-col gap-4 font-mono max-w-sm">
      {/* User ID */}
      <div>
        <span className="text-[10px] text-foregroundScale-2 block mb-1">User ID</span>
        <div className="text-[10px] text-foreground/30 break-all">{userId || "—"}</div>
      </div>

      {/* Display Name */}
      <div>
        <span className="text-[10px] text-foregroundScale-2 block mb-1">Display Name</span>
        <div className="flex gap-1.5">
          <input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") save(); }}
            placeholder="Your name..."
            className="flex-1 h-7 text-[11px] px-2 rounded bg-backgroundScale-0 border border-borderScale-1 text-foreground outline-none focus:border-primary"
          />
          <button
            onClick={save}
            className="px-3 h-7 rounded text-[11px] inline-flex items-center gap-1 bg-blue-500/20 border border-blue-500/40 text-blue-300 cursor-pointer hover:bg-blue-500/30 transition-colors"
          >
            <Save style={{ width: 10, height: 10 }} /> Save
          </button>
        </div>
      </div>

      {/* Appearance link note */}
      <div>
        <span className="text-[10px] text-foregroundScale-2 block mb-1">Appearance</span>
        <div className="text-[10px] text-foreground/40 leading-relaxed">
          Theme and appearance settings are in the{" "}
          <span className="text-blue-400">Appearance</span> tab.
        </div>
      </div>

      {/* About */}
      <div>
        <span className="text-[10px] text-foregroundScale-2 block mb-1">About</span>
        <div className="text-[10px] text-foreground/30 leading-[1.7]">
          Moduli v0.7 — Occurrence-based workspace<br />
          Phases 1–5 complete. Fields · Docs · Operations · Themes.
        </div>
      </div>
    </div>
  );
}
