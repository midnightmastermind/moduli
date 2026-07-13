// ui/InsertGap.jsx
//
// "Insert here" affordance (docket item from the block-wrap session). A thin
// hover zone that sits BETWEEN sibling items (board column rows / list items /
// — and, via the doc variant, between top-level doc blocks). On hover it lights
// up a highlight bar like a drop spot; the QuickAddMenu "+" centered on the bar
// opens the same add-item menu used in headers, but the new occurrence is
// spliced in at THIS index rather than appended.
//
// Reuses QuickAddMenu wholesale (categories / search / field-picker / template
// tiles). The only new piece is wiring its onCreateNew / onSelect to
// `createLeafInstanceAtIndex` with the gap's index.
import { useState } from "react";
import { useGridActions } from "../GridActionsContext.js";
import QuickAddMenu from "./QuickAddMenu.jsx";
import { createChildInContainer, createLeafInstanceAtIndex } from "../helpers/CommitHelpers";
import { requestLabelEdit } from "../helpers/pendingLabelEdit.js";

export default function InsertGap({
  parentOccurrence,
  index,
  targetRole = "instance",
  hostOccurrence = null,
  // Panel context for the OccurrenceCreateOp — the Stamp op's trigger is
  // panel-scoped and reads the timeslot from $trigger.containerLabel, so a
  // gap-insert must carry the same context a drag into the container does.
  panelId = null,
  containerLabel = "",
}) {
  const { dispatch, socket, gridId, userId, state, modulesById } = useGridActions() || {};
  const resolvedGridId = gridId || state?.grid?._id || state?.gridId;
  const resolvedUserId = userId || state?.grid?.userId || state?.userId;
  // While the menu is open, force the gap revealed (it normally only shows on
  // hover — moving the pointer to the portal menu would otherwise collapse it).
  const [menuOpen, setMenuOpen] = useState(false);

  if (!parentOccurrence || !resolvedGridId || !resolvedUserId) return null;

  const insertNew = ({ fieldIds = [], kind, file, url } = {}) => {
    // Route by kind (Item / Textblock / Board / Doc / Table / Canvas / Artifact)
    // and splice at THIS gap's index. Artifact returns a Promise (async upload).
    const res = createChildInContainer({
      dispatch, socket, gridId: resolvedGridId, userId: resolvedUserId,
      containerOccurrence: parentOccurrence,
      containerModule: modulesById?.[parentOccurrence?.moduleId] || null,
      kind: kind || (targetRole === "instance" ? "instance" : targetRole),
      fieldIds: Array.isArray(fieldIds) ? fieldIds : [],
      file, url, index,
      panelId, containerLabel,
    });
    // Open the new item's label editor focused (see helpers/pendingLabelEdit) —
    // sync creates only (artifact resolves to a Promise).
    if (res && typeof res.then !== "function" && res.moduleId) requestLabelEdit(res.moduleId);
  };

  const insertExisting = (m) => {
    const moduleId = m?.id ?? m;
    if (!moduleId) return;
    createLeafInstanceAtIndex({
      dispatch, socket, gridId: resolvedGridId, userId: resolvedUserId,
      parentOccurrence, index,
      existingModuleId: moduleId,
      panelId, containerLabel,
    });
  };

  return (
    <div className={`insert-gap${menuOpen ? " insert-gap--open" : ""}`} data-insert-index={index}>
      <div className="insert-gap-line" />
      <div className="insert-gap-btn">
        <QuickAddMenu
          targetRole={targetRole}
          onSelect={insertExisting}
          onCreateNew={insertNew}
          hostOccurrence={hostOccurrence}
          onOpenChange={setMenuOpen}
        />
      </div>
    </div>
  );
}
