// modules/DocContent.jsx
// DocEditorShell — thin wrapper around the TipTap Editor: adds click-to-edit state and lock toggle.
// Extracted from containerHelpers.jsx.

import React, { useRef, useState } from "react";
import Editor from "../ui/Editor";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { Lock, Unlock } from "lucide-react";

export const DocContent = React.memo(function DocContent({ occurrence, dispatch, socket, onConvertListToInstances, hideToolbar = false }) {
  const [isEditing, setIsEditing] = useState(false);
  const [showLockBtn, setShowLockBtn] = useState(false);
  const wrapRef = useRef(null);
  const isLocked = !!occurrence?.locked;
  const handleToggleLock = (e) => {
    e.stopPropagation();
    if (!occurrence?.id) return;
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...occurrence, locked: !isLocked } });
  };
  return (
    <div
      ref={wrapRef}
      className={`doc-container flex flex-col flex-1 min-h-0 relative${isEditing ? " is-editing" : ""}`}
      onClick={() => { if (!isLocked) setIsEditing(true); }}
      onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget)) setIsEditing(false); }}
      onMouseEnter={() => setShowLockBtn(true)}
      onMouseLeave={() => setShowLockBtn(false)}
      style={{ cursor: isLocked ? "default" : (isEditing ? "text" : "default") }}
    >
      {(showLockBtn || isLocked) && (
        <button
          onMouseDown={handleToggleLock}
          title={isLocked ? "Unlock document" : "Lock document"}
          style={{
            position: "absolute", top: 4, right: 4, zIndex: 10,
            background: "none", border: "none", cursor: "pointer",
            opacity: isLocked ? 0.7 : 0.3, padding: 2,
            color: isLocked ? "var(--danger)" : "var(--text-muted)",
          }}
        >
          {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
        </button>
      )}
      <Editor
        content={occurrence?.textmap ?? null}
        occurrence={occurrence}
        dispatch={dispatch}
        socket={socket}
        editable={!isLocked}
        className="flex-1"
        onConvertListToInstances={onConvertListToInstances}
      />
    </div>
  );
});

// Named alias for backward compatibility with containerHelpers.jsx imports
export const DocEditorShell = DocContent;

export default DocContent;
