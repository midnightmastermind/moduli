// commandCenter/TrashTab.jsx
import React, { useContext } from "react";
import { Trash2, RotateCcw } from "lucide-react";
import { GridActionsContext } from "../../GridActionsContext";
import { restoreModule } from "../../helpers/CommitHelpers";

export function TrashTab() {
  const { state, dispatch, socket } = useContext(GridActionsContext);
  const trashed = Object.values(state?.modulesById || {}).filter(m => m.trashed);

  return (
    <div className="px-4 py-3">
      <div className="text-text-muted text-xs mb-3">Trashed modules</div>
      {trashed.length === 0 ? (
        <div className="text-text-faint text-xs font-mono">Trash is empty.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {trashed.map(m => (
            <div
              key={m.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded border border-border-subtle text-xs"
            >
              <Trash2 size={11} className="text-text-faint shrink-0" />
              <span className="flex-1 truncate text-text-muted">{m.label || m.id}</span>
              <button
                onClick={() => restoreModule({ dispatch, socket, moduleId: m.id })}
                title="Restore"
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-border-subtle text-text-muted hover:text-foreground hover:bg-white/5"
              >
                <RotateCcw size={9} />
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
