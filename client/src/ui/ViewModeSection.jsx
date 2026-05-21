// ui/ViewModeSection.jsx
//
// HeaderDropdown section that exposes the three-way view-mode toggle
// (preview / representation / actual) for any occurrence. Writes
// `meta.viewMode` via CommitHelpers.updateOccurrence so the change
// fans out to all renderers (ModuleInstance / ModuleContainer /
// ModulePage all check `getEffectiveViewMode`). PreviewNode keeps its
// own inline switcher for folder-page cards; this section is the
// canonical home everywhere else (container chevron, page chevron).
//
// contextTag defaults to "default" — surfaces every legal mode. Pass
// "folderPage" if mounted inside a folder-page surface to suppress
// the Actual option.

import React, { useCallback, useContext } from "react";
import { GridActionsContext } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import ViewModeSwitcher from "./ViewModeSwitcher";

export default function ViewModeSection({ occurrence, contextTag = "default" }) {
  const { dispatch, socket } = useContext(GridActionsContext) || {};
  const handleChange = useCallback((nextMode) => {
    if (!occurrence?.id) return;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: {
        id: occurrence.id,
        meta: { ...(occurrence.meta || {}), viewMode: nextMode },
      },
      emit: true,
    });
  }, [occurrence?.id, occurrence?.meta, dispatch, socket]);

  if (!occurrence?.id) return null;

  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
      <div style={{
        fontSize: 10, fontWeight: 600, color: "var(--text-muted)",
        fontFamily: "var(--font-mono)", letterSpacing: "0.05em",
        textTransform: "uppercase", marginBottom: 6,
      }}>
        View mode
      </div>
      <ViewModeSwitcher
        occurrence={occurrence}
        contextTag={contextTag}
        onChange={handleChange}
        size="sm"
      />
    </div>
  );
}
