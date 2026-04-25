// commandCenter/TemplatesTab.jsx
import React, { useContext } from "react";
import { GridActionsContext } from "../../GridActionsContext";

export function TemplatesTab() {
  const { state } = useContext(GridActionsContext);
  const templates = state?.grid?.templates || [];

  return (
    <div className="px-4 py-3">
      <div className="text-text-muted text-xs mb-3">Saved templates</div>
      {templates.length === 0 ? (
        <div className="text-text-faint text-xs font-mono">
          No templates yet — right-click a container to save one.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {templates.map(t => (
            <div
              key={t.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded border border-border-subtle text-xs text-text-muted"
            >
              {t.name || "Untitled template"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
