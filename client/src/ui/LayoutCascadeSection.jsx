// ui/LayoutCascadeSection.jsx
//
// HeaderDropdown section that exposes per-occurrence layout-cascade
// overrides via the LayoutCascadeEditor. Writes to `meta.layoutCascade`
// (for containers/pages/panels — the level pushes rules down to children)
// OR to `meta.layoutCascadeOverride` (for leaf occurrences — final-say
// per-placement). The resolver in helpers/layoutCascade.js reads both.

import React, { useCallback, useContext, useMemo } from "react";
import { GridActionsContext } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import LayoutCascadeEditor from "./LayoutCascadeEditor";
import {
  buildLayoutCascadeContext,
  resolveLayoutCascade,
} from "../helpers/layoutCascade";

export default function LayoutCascadeSection({ occurrence }) {
  const { dispatch, socket, occurrencesById, modulesById, fieldsById, grid } =
    useContext(GridActionsContext) || {};

  const module = occurrence?.moduleId ? modulesById?.[occurrence.moduleId] : null;
  const role = module?.role || "instance";
  const kind = module?.kind || null;

  // Decide which slot we write to. The cascade walker reads both keys —
  // container/page/panel entities write `meta.layoutCascade` (this level
  // sets rules that flow DOWN to children); leaf occurrences write
  // `meta.layoutCascadeOverride` (per-placement final-say only).
  const slot = useMemo(() => {
    if (role === "container" || role === "page" || role === "panel") return "layoutCascade";
    return "layoutCascadeOverride";
  }, [role]);

  const stored = occurrence?.meta?.[slot] || null;

  // Build the cascade context for the inheritance row.
  const cascade = useMemo(() => {
    if (!occurrence || !occurrencesById || !modulesById) return null;
    const ctx = buildLayoutCascadeContext({
      leafOccurrence: occurrence, occurrencesById, modulesById, grid,
    });
    return resolveLayoutCascade(ctx, role, kind);
  }, [occurrence, occurrencesById, modulesById, grid, role, kind]);

  const fieldsList = useMemo(() => {
    if (!fieldsById) return [];
    return Object.values(fieldsById)
      .filter(f => !f?.meta?.trashed)
      .map(f => ({ id: f.id, name: f.name || f.id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [fieldsById]);

  const handleChange = useCallback((next) => {
    if (!occurrence?.id) return;
    const nextMeta = { ...(occurrence.meta || {}) };
    if (next == null) delete nextMeta[slot];
    else nextMeta[slot] = next;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrence.id, meta: nextMeta },
      emit: true,
    });
  }, [occurrence?.id, occurrence?.meta, slot, dispatch, socket]);

  if (!occurrence?.id) return null;

  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
      <LayoutCascadeEditor
        value={stored}
        onChange={handleChange}
        cascade={cascade}
        label="Layout cascade"
        inheritLabel={role === "container" ? "Page" : role === "page" ? "Panel / Grid" : "Container"}
        showRepresentationFieldIds={true}
        fieldsList={fieldsList}
      />
    </div>
  );
}
