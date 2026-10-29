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
import { Move, Copy, Link2, Lock, Unlock } from "lucide-react";

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
 * The radial menu's drag-mode control, as a ready-made item: a SUBMENU that
 * lists every allowed mode with the current one marked, and sets the one you
 * pick (user, 2026-09-26: *"i also dont like cycled buttons … copy, copylink,
 * move … should have a submenu to select which one, not a cycle"*). A cycle
 * made you read the label to learn what the NEXT press would do, and reaching
 * a mode two steps away took two trips through the menu.
 *
 * `onClick(mode)` receives the chosen mode. The top-level button draws the
 * CURRENT mode. Both the default menu (RadialMenu) and the copy-linked row's
 * custom list (ModuleInstance) render this, so the two cannot drift.
 */
export function dragModeItem({ dragMode = "move", allowed = DEFAULT_DRAG_MODES, onClick } = {}) {
  const list = Array.isArray(allowed) && allowed.length ? allowed : DEFAULT_DRAG_MODES;
  const cur = dragModeMeta(list.includes(dragMode) ? dragMode : list[0]);
  return {
    icon: cur.Icon,
    label: `Drag mode: ${cur.name}`,
    color: cur.color,
    submenu: list.map((mode) => {
      const meta = dragModeMeta(mode);
      return {
        icon: meta.Icon,
        label: meta.name,
        color: meta.color,
        active: mode === dragMode,
        onClick: onClick ? () => onClick(mode) : undefined,
      };
    }),
  };
}

// ── LOCKED IN PLACE ────────────────────────────────────────────────────────
//
// A placement can be locked to where it sits (user, 2026-10-29: *"you cant move
// it from the position but you can copy/copylink it … the lock should autoswitch
// from and block moving from grabbing the radial handle"*). Stored as
// `occurrence.meta.lockedInPlace` — NOT the top-level `occurrence.locked`, which
// is a doc's read-only switch (DocContent) and means something else.
//
// The rule lives HERE because "what does this drag do" is answered here: every
// drag start, drag pill and preview resolves its mode through `effectiveDragMode`,
// so a locked row can never start a move, whatever its stored `dragMode` says.

export const LOCK_META_KEY = "lockedInPlace";

/** Is this placement locked to where it sits? */
export function isLockedInPlace(occurrence) {
  return occurrence?.meta?.[LOCK_META_KEY] === true;
}

/** A drag's mode after the lock: a locked placement never moves — a move becomes a copy. */
export function effectiveDragMode(mode, occurrence) {
  const m = mode || "move";
  return m === "move" && isLockedInPlace(occurrence) ? "copy" : m;
}

/** What a drag does, read from a draggable's live data (occurrence mode, else the module default, else move). */
export function dragModeOfData(data) {
  return effectiveDragMode(data?.occurrence?.dragMode ?? data?.defaultDragMode ?? "move", data?.occurrence);
}

/** The modes a surface may offer while locked: everything but move. */
export function allowedDragModesFor(allowed = DEFAULT_DRAG_MODES, locked = false) {
  const list = Array.isArray(allowed) && allowed.length ? allowed : DEFAULT_DRAG_MODES;
  if (!locked) return list;
  const rest = list.filter((m) => m !== "move");
  return rest.length ? rest : ["copy"];
}

/**
 * The write that locks or unlocks a placement. Locking a row set to Move switches
 * it to Copy (and remembers that it did); unlocking puts Move back only when the
 * lock was what took it away — a mode the user picked while locked is kept.
 */
export function planLockToggle(occurrence, currentMode = "move") {
  const meta = { ...(occurrence?.meta || {}) };
  if (isLockedInPlace(occurrence)) {
    const restore = meta.lockSwitchedFromMove === true && (currentMode === "copy" || !currentMode);
    delete meta[LOCK_META_KEY];
    delete meta.lockSwitchedFromMove;
    return { locked: false, meta, ...(restore ? { dragMode: "move" } : {}) };
  }
  meta[LOCK_META_KEY] = true;
  if ((currentMode || "move") === "move") {
    meta.lockSwitchedFromMove = true;
    return { locked: true, meta, dragMode: "copy" };
  }
  return { locked: true, meta };
}

/** The radial menu's Lock / Unlock item. */
export function lockItem({ locked = false, onClick } = {}) {
  return {
    icon: locked ? Unlock : Lock,
    label: locked ? "Unlock position" : "Lock position (copy only)",
    color: locked ? "bg-amber-600 hover:bg-amber-500" : "bg-slate-700 hover:bg-slate-600",
    onClick,
  };
}
