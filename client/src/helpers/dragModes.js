// helpers/dragModes.js
//
// THE DRAG MODES, and — more importantly — WHICH ONES A SURFACE MAY OFFER.
//
// A drag resolves its mode as
//   occurrence.dragMode ?? module.defaultDragMode ?? "move"
// (dragSystem), and the drop path branches on it. So a mode is only real where
// the drop path for THAT entity kind implements it:
//
//   instance    move · copy · copylink   handleOccurrenceMove runs
//                                        copylinkInstanceToContainer
//   container   move · copy              copyContainerToPanel exists;
//                                        there is NO copylinkContainer helper
//   doc-embed   move · copy              handleDocEmbedDrop branches on
//                                        `mode === "copy"` and nothing else
//   panel       move                     handlePanelDrop DESTRUCTURES `mode`
//                                        and never reads it; a panel is copied
//                                        from its context menu (copyPanel /
//                                        copylinkPanel), not by dragging
//
// That table is why this is a LIST rather than a constant. The radial menu used
// to hardcode a two-way `move ? "copy" : "move"` toggle, so copy-link was
// unreachable from it (user, 2026-09-17: *"it should be a third option in the
// radial menu"*). Making it three-way EVERYWHERE would have been worse than
// leaving it: a container offering copy-link would write `dragMode:"copylink"`
// that its own drop path ignores — a control that looks like it works and does
// nothing, which is the class this repo keeps paying for.
//
// So the cycle is over an ALLOWED list, defaulting to the two modes every
// surface implements. A surface opts in to more only when its drop path can
// honour them.
//
// REPORTED, NOT CHANGED: by that table the PANEL toggle is already inert — it
// writes `defaultDragMode: "copy"` that handlePanelDrop ignores. That predates
// this pass and narrowing it would REMOVE a control rather than add one, so
// the panel keeps the two-way default and the finding is written down instead.
import { Move, Copy, Link2 } from "lucide-react";

/** Every mode the system knows. Order IS the cycle order. */
export const DRAG_MODES = ["move", "copy", "copylink"];

/** What a surface may offer unless it says otherwise — what all of them implement. */
export const DEFAULT_DRAG_MODES = ["move", "copy"];

/** Instances: the one kind whose drop path runs copylinkInstanceToContainer. */
export const INSTANCE_DRAG_MODES = ["move", "copy", "copylink"];

const META = {
  move: {
    Icon: Move,
    name: "Move",
    setLabel: "Set to Move",
    color: "bg-slate-600 hover:bg-slate-500",
  },
  copy: {
    Icon: Copy,
    name: "Copy",
    setLabel: "Set to Copy",
    color: "bg-blue-600 hover:bg-blue-500",
  },
  copylink: {
    // Link2 rather than Link — `Unlink` is already the "Break Link" item and
    // the two read as a pair.
    Icon: Link2,
    name: "Copy-link",
    setLabel: "Set to Copy-link",
    // Purple, matching ClipboardStatusBanner's copylink colour so the two
    // surfaces name the same action the same way.
    color: "bg-purple-600 hover:bg-purple-500",
  },
};

/**
 * Icon / name / colour for a mode. Falls back to `move` for anything unknown
 * rather than rendering blank — an occurrence carrying a mode this build does
 * not know about must still draw a handle.
 */
export function dragModeMeta(mode) {
  return META[mode] || META.move;
}

/**
 * The next mode in the cycle, restricted to `allowed`.
 *
 * A mode that is not in `allowed` cycles to the FIRST allowed one rather than
 * being preserved — that is what lets a surface narrow its list without
 * stranding an occurrence on a mode it can no longer honour (e.g. an instance
 * set to copylink and then converted to a container).
 */
export function nextDragMode(current, allowed = DEFAULT_DRAG_MODES) {
  const list = Array.isArray(allowed) && allowed.length ? allowed : DEFAULT_DRAG_MODES;
  const i = list.indexOf(current);
  if (i === -1) return list[0];
  return list[(i + 1) % list.length];
}

/**
 * The radial menu's mode button, as a ready-made item.
 *
 * It names the NEXT mode ("Set to Copy-link"), because that is what pressing it
 * does — the CURRENT mode is what the handle itself draws. Both the default
 * menu (RadialMenu) and the copy-linked row's custom list (ModuleInstance)
 * render this, so the label, icon and colour cannot drift between them.
 */
export function dragModeItem({ dragMode = "move", allowed = DEFAULT_DRAG_MODES, onClick } = {}) {
  const meta = dragModeMeta(nextDragMode(dragMode, allowed));
  return {
    icon: meta.Icon,
    label: meta.setLabel,
    onClick,
    color: meta.color,
  };
}
