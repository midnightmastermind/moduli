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
import { useGridActions } from "../GridActionsContext.js";
import QuickAddMenu from "./QuickAddMenu.jsx";
import { createLeafInstanceAtIndex } from "../helpers/CommitHelpers";

export default function InsertGap({
  parentOccurrence,
  index,
  targetRole = "instance",
  hostOccurrence = null,
}) {
  const { dispatch, socket, gridId, userId, state } = useGridActions() || {};
  const resolvedGridId = gridId || state?.grid?._id || state?.gridId;
  const resolvedUserId = userId || state?.grid?.userId || state?.userId;

  if (!parentOccurrence || !resolvedGridId || !resolvedUserId) return null;

  const insertNew = ({ fieldIds } = {}) => {
    createLeafInstanceAtIndex({
      dispatch, socket, gridId: resolvedGridId, userId: resolvedUserId,
      parentOccurrence, index,
      role: targetRole === "instance" ? "instance" : targetRole,
      fieldIds: Array.isArray(fieldIds) ? fieldIds : [],
    });
  };

  const insertExisting = (m) => {
    const moduleId = m?.id ?? m;
    if (!moduleId) return;
    createLeafInstanceAtIndex({
      dispatch, socket, gridId: resolvedGridId, userId: resolvedUserId,
      parentOccurrence, index,
      existingModuleId: moduleId,
    });
  };

  return (
    <div className="insert-gap" data-insert-index={index}>
      <div className="insert-gap-line" />
      <div className="insert-gap-btn">
        <QuickAddMenu
          targetRole={targetRole}
          onSelect={insertExisting}
          onCreateNew={insertNew}
          hostOccurrence={hostOccurrence}
        />
      </div>
    </div>
  );
}
