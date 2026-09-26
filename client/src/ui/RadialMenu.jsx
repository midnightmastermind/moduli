
// ui/RadialMenu.jsx
// Exported for testing:
export function calcOpenDirection(centerX, centerY, viewportW, viewportH, spread = 58) {
  // Always open right — handles are on the left wall of entities.
  // Only override for top/bottom edge cases.
  const topEdge = centerY;
  const bottomEdge = viewportH - centerY;
  if (bottomEdge < spread) return 'up';
  if (topEdge < spread) return 'down';
  return 'right';
}
// ============================================================
// Radial/Arc menu component with spinning animation
// Used as a combined drag handle + action menu for panels/containers/instances
//
// CHANGES (ONLY what you asked):
// ✅ keep everything else the same as the last working portal+spin version
// ✅ fix "shooting from bottom" -> swing from TOP into place
// ✅ fix move handle color mismatch (copy was fine) -> move uses slate gradient
// ✅ remove always-visible mode tooltip block (keep only native hover tooltips via title)
// ✅ increase spacing (buttons farther from each other + farther from center)
// ✅ add WHITE BORDER around popup buttons (like handle)
// ✅ handle becomes a LEFT TAB (not circle), hugs inside wall, taller, slightly wider
// ============================================================

import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Settings, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, Filter, LayoutTemplate, Clock, Trash2 } from "lucide-react";

import { DEFAULT_DRAG_MODES, dragModeMeta, dragModeItem } from "../helpers/dragModes";

// ── THE ARC HAS A CAPACITY, AND IT USED TO EXCEED IT SILENTLY ──────────────
//
// Items were spaced a fixed 45° apart, so EIGHT filled a full revolution and a
// ninth landed on exactly the first one's box. Measured on prod: the container
// menu carried eleven items, and Settings / Set to Copy / Hide Header were
// covered by Convert to Canvas / Table / Graph — clicking the gear converted
// the container. Nothing reported it; the covered buttons were simply gone.
//
// So the step is capped to fit the ring AND the radius grows until neighbours
// keep a whole button of room. A menu that already fit is untouched: at 45°
// the base radius 42 gives a 32.1px chord for a 28px button, which is why
// ARC_ITEM_GAP is 4 — it is derived from the geometry that already worked, so
// every existing menu measures identically.
export const ARC_ITEM_PX = 28;     // the button box
export const ARC_ITEM_GAP = 4;     // minimum air between neighbours
export const ARC_MAX_STEP = 45;    // preferred degrees between items
export const ARC_MAX_TOTAL = 330;  // never close the ring — first and last must not meet

const ARC_BASE_ANGLE = { left: 180, right: 0, down: 90, up: 270 };

export function arcAngles(direction, count, baseRadius) {
  const base = ARC_BASE_ANGLE[direction] ?? 0;
  if (count <= 1) return { angles: count === 1 ? [base] : [], radius: baseRadius, step: 0 };
  const step = Math.min(ARC_MAX_STEP, ARC_MAX_TOTAL / (count - 1));
  const chord = ARC_ITEM_PX + ARC_ITEM_GAP;
  const needed = chord / (2 * Math.sin((step * Math.PI) / 180 / 2));
  const radius = Math.max(baseRadius, needed);
  const half = ((count - 1) * step) / 2;
  const angles = [];
  for (let i = 0; i < count; i++) angles.push(base - half + i * step);
  return { angles, radius, step };
}

// ── A SUBMENU REPLACES THE ARC IT OPENED FROM ─────────────────────────────
//
// User, 2026-09-22: *"make a convert submenu so we dont have 4 convert buttons
// on the arc menu. one convert button"*. Replacing rather than adding a second
// ring keeps one interaction model — and it is what takes the container menu
// from eleven items back to eight, i.e. inside the ring's capacity.
//
// `openLabel` naming a submenu that no longer exists falls back to the top
// level: the items memo rebuilds when the container's kind changes, and
// rendering an empty arc there would be a menu with no way out.
export function arcItemsFor(items, openLabel) {
  if (!openLabel) return items;
  const parent = items.find((i) => i?.label === openLabel && Array.isArray(i.submenu));
  if (!parent) return items;
  return [{ label: "Back", icon: ChevronLeft, __back: true, color: "bg-slate-700 hover:bg-slate-600" },
          ...parent.submenu];
}


// ── LIKE-MINDED ITEMS SHARE ONE SUBMENU ───────────────────────────────────
//
// User, 2026-09-26: *"i also want any thats like minded to consolidate to a
// submenu (like having all these seperate buttons for converting)"*. An item
// that names a `group` is gathered with every other item of that group — and
// into an existing submenu item of the same label, so the embed's "To pill"
// joins a container's own "Convert" list instead of sitting beside it. A group
// with ONE member stays a plain button: a submenu of one is an extra click that
// buys nothing. The group lands where its first member was.
export function groupItems(items) {
  const out = [];
  const slot = new Map();              // group label → index in `out`
  for (const item of items || []) {
    if (!item) continue;
    const key = item.group || (Array.isArray(item.submenu) ? item.label : null);
    if (!key) { out.push(item); continue; }
    const members = item.group ? [{ ...item, group: undefined }] : item.submenu;
    if (!slot.has(key)) {
      slot.set(key, out.length);
      out.push(item.group
        ? { label: key, icon: item.groupIcon || item.icon, color: item.groupColor || item.color, submenu: members, __single: item }
        : { ...item, submenu: [...members] });
      continue;
    }
    const at = slot.get(key);
    const host = out[at];
    out[at] = { ...host, submenu: [...host.submenu, ...members], __single: undefined };
  }
  return out.map((it) => {
    if (!it.__single) { const { __single, ...rest } = it; return rest; }
    // A group of one: the member itself, without the group wrapper.
    const { group, groupIcon, groupColor, ...solo } = it.__single;
    return solo;
  });
}

export default function RadialMenu({
  // Standard drag handle props (used when items not provided)
  dragMode = "move",
  // WHICH modes this surface may cycle through. Defaults to the two every drop
  // path implements — a surface passes a wider list only when its own drop
  // path honours the extra mode (see helpers/dragModes.js).
  allowedDragModes = DEFAULT_DRAG_MODES,
  onToggleDragMode,
  onSettings,

  // Custom items mode - pass array of { icon, label, onClick, color }
  items = null,

  // Force menu to open in specific direction: 'left', 'right', 'down', 'up'
  forceDirection = null,

  // Custom handle content (icon component or element)
  handleIcon = null,
  handleTitle = null,

  // Collapse/shrink toggle (for doc containers)
  onToggleCollapse = null,
  isCollapsed = false,

  // Header hide/show toggle
  onToggleHeader = null,
  showHeader = true,

  // Quick-action shortcuts (container/panel only)
  onFilter = null,
  onTemplate = null,
  onHistory = null,
  onToggleDoc = null,

  // Delete/remove action
  onDelete = null,
  // WHAT `onDelete` MEANS DEPENDS ON THE CALLER, which is why this is a prop
  // and not a constant. On a row it deletes the occurrence (and cascades to
  // anything parented to it); on a doc PILL or an embed it only takes the node
  // out of the prose and the occurrence lives on. One static word cannot be
  // true for both, and the word it used to be — "Remove" — was the wrong one
  // exactly where the damage is (user 2026-08-26: *"i cant find the delete in
  // the radial menu"*; it was there, called something else).
  // Defaults to "Remove", so every caller that does not name it is unchanged.
  deleteLabel = "Remove",

  // Extra items appended after all computed items (used by embed context to inject alignment/pill actions)
  extraItems = null,

  // Callback when open state changes
  onOpenChange = null,

  // Styling
  disabled = false,
  size = "sm",
  className = "",
  handleClassName = "",
}) {
  const [isOpen, _setIsOpen] = useState(false);
  const setIsOpen = useCallback((val) => {
    _setIsOpen((prev) => {
      const next = typeof val === "function" ? val(prev) : val;
      if (next !== prev) onOpenChange?.(next);
      return next;
    });
  }, [onOpenChange]);

  // outside-click should consider BOTH handle area and the portal area
  const menuRef = useRef(null);       // in-flow wrapper
  const portalRef = useRef(null);     // portaled wrapper

  const handleRef = useRef(null);

  // HOLD THE LAYOUT WHILE OPEN. The menu is portalled out of the card it
  // belongs to, so moving onto an arc item ends the card's :hover — and its
  // trailing empty line (revealed on hover, index.css) collapsed. On a page
  // scrolled to the bottom that clamped the scroll and slid the row ~21px, so
  // Delete moved out from under the pointer and took two clicks (user video,
  // 2026-09-19). While open, the nearest card and editor wrapper keep the
  // revealed state via `data-radial-hold`.
  useEffect(() => {
    if (!isOpen) return undefined;
    const el = handleRef.current;
    const held = [el?.closest?.(".container-shell"), el?.closest?.(".doc-editor-wrapper")].filter(Boolean);
    held.forEach((h) => h.setAttribute("data-radial-hold", ""));
    return () => held.forEach((h) => h.removeAttribute("data-radial-hold"));
  }, [isOpen]);

  // fixed-position anchor for portal (null until measured)
  const [anchor, setAnchor] = useState({ x: null, y: null });
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  // controls the "from -> to" animation after mount
  const [entered, setEntered] = useState(false);

  // Screen edge detection - determines which direction to open the menu
  const [openDirection, setOpenDirection] = useState(forceDirection || 'right');

  // Dynamic start rotation based on open direction
  const getStartRotation = (dir) => {
    switch (dir) {
      case 'left': return 90;
      case 'right': return -90;
      case 'down': return -90;
      case 'up': return 90;
      default: return 90;
    }
  };
  const startRot = getStartRotation(openDirection);

  const updateAnchor = useCallback(() => {
    const el = handleRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // A handle hidden by a hover rule measures 0×0 at the viewport origin. Keep
    // the menu where it is rather than teleporting it to the corner on the next
    // scroll (the cog handles hid themselves as the pointer left for the arc).
    if (!r.width && !r.height && anchorRef.current.x != null) return;
    const centerX = r.left + r.width / 2;
    const centerY = r.top + r.height / 2;

    // If direction is forced, skip auto-detection
    if (forceDirection) {
      setOpenDirection(forceDirection);
      setAnchor({ x: centerX, y: centerY });
      return;
    }

    // Direction logic: open toward viewport center — uses exported calcOpenDirection for testability
    const dir = calcOpenDirection(centerX, centerY, window.innerWidth, window.innerHeight, 80);
    setOpenDirection(dir);

    // Clamp anchor so portal always stays inside viewport
    const clampPad = 20;
    const clampedX = Math.max(clampPad, Math.min(window.innerWidth - clampPad, centerX));
    const clampedY = Math.max(clampPad, Math.min(window.innerHeight - clampPad, centerY));
    setAnchor({ x: clampedX, y: clampedY });
  }, [forceDirection]);

  // Close menu when clicking outside (includes portal!) or pressing Escape
  useEffect(() => {
    const handlePointerDown = (e) => {
      const inMenu = menuRef.current?.contains(e.target);
      const inPortal = portalRef.current?.contains(e.target);
      if (!inMenu && !inPortal) setIsOpen(false);
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") { e.preventDefault(); setIsOpen(false); }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handlePointerDown);
      document.addEventListener("touchstart", handlePointerDown);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // NO AUTO-CLOSE TIMER. It closed the menu 5s after opening whatever you were
  // doing — mid-read, mid-submenu, with the pointer on an item (user,
  // 2026-09-26: "it will close too early … by timed or something"). The menu
  // closes on a pick, an outside press, or Escape.

  // when open, sync anchor before paint
  useLayoutEffect(() => {
    if (!isOpen) return;
    updateAnchor();
  }, [isOpen, updateAnchor]);

  // keep anchor synced while any parent scrolls (nested scrollers too)
  useEffect(() => {
    if (!isOpen) return;

    const onAnyScroll = () => updateAnchor();
    const onResize = () => updateAnchor();

    window.addEventListener("scroll", onAnyScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("scroll", onAnyScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [isOpen, updateAnchor]);

  // ensure the portal animates "from" state on open
  useEffect(() => {
    if (!isOpen) {
      setEntered(false);
      return;
    }
    setEntered(false);
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  const handleToggle = useCallback(
    (e) => {
      e.stopPropagation();
      if (disabled) return;
      // A click synthesized right after a touch drag (some browsers fire one
      // even though dragSystem preventDefaults the touchend) must not open the
      // menu — the user was dragging by this handle, not tapping it.
      if (typeof window !== "undefined" && window.__moduliDragEndAt &&
          performance.now() - window.__moduliDragEndAt < 400) return;
      // Call updateAnchor() directly (not inside setIsOpen updater) so React 18
      // batches setOpenDirection + setAnchor + setIsOpen in the same render.
      // Calling setState from inside a setState updater can split batches,
      // causing the portal to first render with the default 'left' direction.
      updateAnchor();
      setIsOpen(prev => !prev);
    },
    [disabled, updateAnchor]
  );

  const handleAction = useCallback((action, e) => {
    e?.stopPropagation();
    action?.(e);
    setIsOpen(false);
  }, []);

  // Size configurations
  // ✅ increased radius for spacing
  // ONE SIZE BIGGER ACROSS THE BOARD (user, 2026-08-26: *"could you make all the
  // drag handles one size bigger as well"* / *"like the entire radial menu"*).
  // `sm` takes what `md` used to be and `md` steps up, so the two stay a step
  // apart and every caller moves together — the handle is the drag affordance
  // AND the menu trigger, so a bigger radius with the old handle would have
  // made the target harder to hit, not easier.
  const sizes = {
    sm: {
      handle: "h-6",            // height only; width is custom for tab
      handleIcon: "w-3 h-3",
      menu: "w-7 h-7",
      menuIcon: "w-3.5 h-3.5",
      radius: 42,
    },
    md: {
      handle: "h-7",
      handleIcon: "w-3.5 h-3.5",
      menu: "w-8 h-8",
      menuIcon: "w-4 h-4",
      radius: 50,
    },
  };

  const s = sizes[size] || sizes.sm;

  // Mode indicator icon inside handle (or custom icon). Read off the mode
  // itself rather than a copy/else ternary, which drew the MOVE icon for a
  // copylink row — a lie about what the drag is about to do.
  const modeMeta = dragModeMeta(dragMode);
  const ModeIcon = handleIcon || modeMeta.Icon;
  const titleText = handleTitle || `${modeMeta.name} mode - Click for menu`;

  // Get angles based on direction and item count
  const getAnglesForDirection = useCallback(
    (direction, count) => arcAngles(direction, count, s.radius).angles,
    [s.radius],
  );

  // ✅ Support custom items or default drag handle menu
  // Which submenu is open, if any. Reset whenever the menu closes so it always
  // reopens at the top level.
  const [openSubmenu, setOpenSubmenu] = useState(null);
  useEffect(() => { if (!isOpen) setOpenSubmenu(null); }, [isOpen]);

  const menuItems = useMemo(
    () => {
      // If custom items provided, use those with calculated angles
      if (items && items.length > 0) {
        // ── A CUSTOM `items` LIST STILL HONOURS `onDelete` ─────────────────
        //
        // This branch used to return `items` verbatim, so a caller passing BOTH
        // a custom list and `onDelete` silently got no delete — the inert-prop
        // class: the prop is declared, the caller sets it, and nothing reads it.
        // It bit exactly one surface and it was the one the user hit: an
        // instance builds a custom list ONLY when it is copy-linked (Settings /
        // drag mode / Break Link / toggle label), and a copy-linked row is most
        // of a Schedule — so those rows had no way to delete from the radial
        // menu at all. Placed before `extraItems`, matching the default branch's
        // own order.
        const deleteItem = onDelete
          ? [{ icon: Trash2, label: deleteLabel, onClick: onDelete, color: "bg-red-700 hover:bg-red-600" }]
          : [];
        const allItems = groupItems([...items, ...deleteItem, ...(extraItems || [])]);
        const angles = getAnglesForDirection(openDirection, allItems.length);
        return allItems.map((item, i) => ({
          ...item,
          angle: angles[i],
          color: item.color || "bg-slate-600 hover:bg-slate-500",
        }));
      }

      // Default drag handle menu items
      const defaultItems = [
        {
          icon: Settings,
          label: "Settings",
          onClick: onSettings,
          color: "bg-slate-600 hover:bg-slate-500",
        },
        dragModeItem({ dragMode, allowed: allowedDragModes, onClick: onToggleDragMode }),
      ];
      if (onToggleCollapse) {
        defaultItems.push({
          icon: isCollapsed ? ChevronDown : ChevronUp,
          label: isCollapsed ? "Expand" : "Shrink",
          onClick: onToggleCollapse,
          color: "bg-purple-600 hover:bg-purple-500",
        });
      }
      if (onToggleHeader) {
        defaultItems.push({
          icon: showHeader ? EyeOff : Eye,
          label: showHeader ? "Hide Header" : "Show Header",
          onClick: onToggleHeader,
          color: "bg-slate-700 hover:bg-slate-600",
        });
      }
      if (onFilter) {
        defaultItems.push({
          icon: Filter,
          label: "Filter Override",
          onClick: onFilter,
          color: "bg-cyan-700 hover:bg-cyan-600",
        });
      }
      if (onTemplate) {
        defaultItems.push({
          icon: LayoutTemplate,
          label: "Apply Template",
          onClick: onTemplate,
          color: "bg-indigo-600 hover:bg-indigo-500",
        });
      }
      if (onHistory) {
        defaultItems.push({
          icon: Clock,
          label: "History",
          onClick: onHistory,
          color: "bg-amber-700 hover:bg-amber-600",
        });
      }
      if (onToggleDoc) {
        defaultItems.push({
          icon: ChevronRight,
          label: "Toggle doc",
          onClick: onToggleDoc,
          color: "bg-slate-700 hover:bg-slate-600",
        });
      }
      if (onDelete) {
        defaultItems.push({
          icon: Trash2,
          label: deleteLabel,
          onClick: onDelete,
          color: "bg-red-700 hover:bg-red-600",
        });
      }
      if (extraItems?.length) defaultItems.push(...extraItems);
      const grouped = groupItems(defaultItems);
      const angles = getAnglesForDirection(openDirection, grouped.length);
      return grouped.map((item, i) => ({ ...item, angle: angles[i] }));
    },
    [items, extraItems, dragMode, allowedDragModes, onSettings, onToggleDragMode, onToggleCollapse, isCollapsed, onToggleHeader, showHeader, onFilter, onTemplate, onHistory, onToggleDoc, onDelete, deleteLabel, openDirection, getAnglesForDirection]
  );

  // What the ring DRAWS: the top level, or the open submenu in its place. The
  // angles and radius are recomputed from THIS list's length — a submenu has a
  // different count than the menu it replaced.
  const shown = useMemo(() => {
    const list = arcItemsFor(menuItems, openSubmenu);
    const { angles, radius } = arcAngles(openDirection, list.length, s.radius);
    return { items: list.map((it, i) => ({ ...it, angle: angles[i] })), radius };
  }, [menuItems, openSubmenu, openDirection, s.radius]);
  const shownItems = shown.items;
  const arcRadius = shown.radius;

  // PORTALED arc menu
  const portaledArcMenu =
    isOpen &&
    anchor.x != null &&
    createPortal(
      <div
        ref={portalRef}
        style={{
          position: "fixed",
          left: anchor.x,
          top: anchor.y,
          width: Math.max(shownItems.length * 30 + 60, arcRadius * 2 + 60),
          height: Math.max(shownItems.length * 30 + 60, arcRadius * 2 + 60),
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          zIndex: 2147483647,
        }}
        // A PORTAL STILL BUBBLES THROUGH ITS REACT PARENTS. The arc lives under
        // <body> in the DOM but inside the row / editor / container in the
        // React tree, so a press on an item reached their handlers too (drag
        // arming, editor focus, row selection) — "something behind the radial
        // menu is stealing the focus" (user, 2026-09-26). Stop all of them here.
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <div
          className={`
            radial-menu-items
            absolute inset-0
            pointer-events-none
          `}
          style={{
            transformOrigin: "50% 50%",
            opacity: entered ? 1 : 0,
            transform: `rotate(${entered ? 0 : startRot}deg)`,
            transition: "opacity 200ms ease-out, transform 300ms ease-out",
          }}
        >
          {(() => {
            // Pre-compute arc positions for all items
            const btnHalf = 14;
            const pad = 6;
            const arcPositions = shownItems.map((item) => {
              const rad = (item.angle * Math.PI) / 180;
              return {
                x: Math.cos(rad) * arcRadius,
                y: Math.sin(rad) * arcRadius,
              };
            });

            // Detect which edges the circle layout would clip
            let clipsLeft = false, clipsRight = false, clipsTop = false, clipsBottom = false;
            arcPositions.forEach(({ x, y }) => {
              const ax = anchor.x + x;
              const ay = anchor.y + y;
              if (ax - btnHalf < pad) clipsLeft = true;
              if (ax + btnHalf > window.innerWidth - pad) clipsRight = true;
              if (ay - btnHalf < pad) clipsTop = true;
              if (ay + btnHalf > window.innerHeight - pad) clipsBottom = true;
            });
            const anyClipped = clipsLeft || clipsRight || clipsTop || clipsBottom;

            // If clipped, switch to a line aligned with the clipping axis
            let finalPositions;
            if (anyClipped) {
              const spacing = 28;
              const count = shownItems.length;
              const halfSpan = ((count - 1) * spacing) / 2;
              const sideOffset = s.radius * 0.75;

              if (clipsLeft || clipsRight) {
                // Left/right clip → vertical line on the side with more space
                const lineX = (window.innerWidth - anchor.x) >= anchor.x ? sideOffset : -sideOffset;
                let yShift = 0;
                const topEdge = anchor.y - halfSpan - btnHalf;
                const botEdge = anchor.y + halfSpan + btnHalf;
                if (topEdge < pad) yShift = pad - topEdge;
                else if (botEdge > window.innerHeight - pad) yShift = (window.innerHeight - pad) - botEdge;
                finalPositions = shownItems.map((_, i) => ({
                  x: lineX,
                  y: -halfSpan + i * spacing + yShift,
                }));
              } else {
                // Top/bottom clip only → horizontal line on the side with more space
                const lineY = (window.innerHeight - anchor.y) >= anchor.y ? sideOffset : -sideOffset;
                let xShift = 0;
                const leftEdge = anchor.x - halfSpan - btnHalf;
                const rightEdge = anchor.x + halfSpan + btnHalf;
                if (leftEdge < pad) xShift = pad - leftEdge;
                else if (rightEdge > window.innerWidth - pad) xShift = (window.innerWidth - pad) - rightEdge;
                finalPositions = shownItems.map((_, i) => ({
                  x: -halfSpan + i * spacing + xShift,
                  y: lineY,
                }));
              }
            } else {
              finalPositions = arcPositions;
            }

            return shownItems.map((item, index) => {
            const Icon = item.icon;
            const { x, y } = finalPositions[index];

            const delay = index * 35;

            return (
              <button
                key={`${item.label}-${index}`}
                type="button"
                onClick={(e) => {
                  if (item.__back) { e.stopPropagation(); setOpenSubmenu(null); return; }
                  if (Array.isArray(item.submenu)) { e.stopPropagation(); setOpenSubmenu(item.label); return; }
                  handleAction(item.onClick, e);
                }}
                disabled={disabled || (!item.onClick && !item.submenu && !item.__back)}
                className={`
                  radial-menu-item
                  absolute
                  ${s.menu}
                  rounded-full
                  flex items-center justify-center
                  ${item.color}
                  ${item.active ? "border-2 border-emerald-300 ring-2 ring-emerald-300/60" : "border-2 border-white/80"}
                  shadow-lg
                  transition-all
                  ${entered ? "pointer-events-auto" : "pointer-events-none"}
                  ${disabled || (!item.onClick && !item.submenu && !item.__back) ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:scale-110"}
                `}
                style={{
                  left: "50%",
                  top: "50%",
                  transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                  transitionDelay: `${delay}ms`,
                }}
                title={item.label + (item.active ? " (current)" : "") + (Array.isArray(item.submenu) ? " ›" : "")}
                aria-pressed={item.active ? true : undefined}
              >
                <span style={{
                  display: "inline-flex",
                  transform: `rotate(${entered ? 0 : -startRot}deg)`,
                  transition: "transform 300ms ease-out",
                }}>
                  {Icon && React.createElement(Icon, { className: `${s.menuIcon} text-white` })}
                </span>
              </button>
            );
          });
          })()}
        </div>
      </div>,
      document.body
    );

  return (
    <div
      ref={menuRef}
      className={`radial-menu relative items-center flex flex-col ${className}`}
      data-radial-open={isOpen ? "" : undefined}
      style={{ zIndex: isOpen ? 99999 : 1000, flex: "none", justifyContent: "flex-start" }}
    >
      {/* Central drag handle button with mode indicator */}
      <button
        ref={handleRef}
        type="button"
        data-testid="radial-handle"
        onClick={handleToggle}
        disabled={disabled}
        className={`
          radial-handle
          ${s.handle}
          flex items-center justify-center
          px-2
          w-8
          rounded-l-[6px]
          rounded-r-none
          border-gray-700
          transition-all duration-200
          ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:shadow-lg"}
          ${isOpen ? "brightness-105" : ""}
          ${handleClassName}
        `}
        style={{
          alignSelf: "center",
          flex: "none",
          paddingTop: 0,
          paddingBottom: 0,
        }}
        title={titleText}
      >
        {/* Handle React components (functions) or forwardRef objects (have $$typeof).
            Use React.createElement to avoid "Objects are not valid as a React child"
            that can occur when forwardRef components are used as JSX children directly. */}
        {ModeIcon && (typeof ModeIcon === 'function' || ModeIcon.$$typeof)
          ? React.createElement(ModeIcon, { className: `${s.handleIcon} radial-handle-icon` })
          : ModeIcon
        }
      </button>


      {/* ✅ Portal renders arc menu above overflow/scroll parents */}
      {portaledArcMenu}

      {/* ❌ removed always-visible Move/Copy label per request */}
    </div>
  );
}

