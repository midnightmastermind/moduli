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

import React, { useCallback, useMemo } from "react";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import ViewModeSwitcher from "./ViewModeSwitcher";
import { resolveEffectiveLayout } from "../helpers/layoutCascade";

export default function ViewModeSection({ occurrence, contextTag = "default" }) {
  const { dispatch, socket, occurrencesById, modulesById, grid } = useGridActions() || {};
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

  // Layout cascade — gives allowedModes + allowChange that override the
  // legacy contextTag. When the cascade returns navOptions=[] or
  // navAllowChange=false (e.g. standalone page, page-in-container), the
  // switcher hides entirely.
  const layout = useMemo(() => {
    if (!occurrence || !occurrencesById || !modulesById) return null;
    return resolveEffectiveLayout({ occurrence, occurrencesById, modulesById, grid });
  }, [occurrence, occurrencesById, modulesById, grid]);

  if (!occurrence?.id) return null;
  // Don't render the whole section when the cascade forbids changes.
  if (layout && (!layout.navAllowChange || (layout.navOptions || []).length === 0)) {
    return null;
  }

  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
      <div style={{
        fontSize: 12, fontWeight: 600, color: "var(--text-muted)",
        fontFamily: "var(--font-mono)", letterSpacing: "0.05em",
        textTransform: "uppercase", marginBottom: 6,
      }}>
        View mode
      </div>
      <ViewModeSwitcher
        occurrence={occurrence}
        contextTag={contextTag}
        allowedModes={layout?.navOptions || null}
        allowChange={layout ? layout.navAllowChange !== false : true}
        onChange={handleChange}
        size="sm"
      />
    </div>
  );
}
