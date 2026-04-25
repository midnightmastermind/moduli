
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
import { Settings, Plus, Copy, Move, ChevronUp, ChevronDown, ChevronRight, Eye, EyeOff, Filter, LayoutTemplate, Clock, Trash2 } from "lucide-react";

export default function RadialMenu({
  // Standard drag handle props (used when items not provided)
  dragMode = "move",
  onToggleDragMode,
  onSettings,
  onAddChild,
  addLabel = "Item",

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
  const timeoutRef = useRef(null);

  // fixed-position anchor for portal (null until measured)
  const [anchor, setAnchor] = useState({ x: null, y: null });

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

  // Auto-close after delay
  useEffect(() => {
    if (isOpen) timeoutRef.current = setTimeout(() => setIsOpen(false), 5000);
    return () => timeoutRef.current && clearTimeout(timeoutRef.current);
  }, [isOpen]);

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
  const sizes = {
    sm: {
      handle: "h-5",            // height only; width is custom for tab
      handleIcon: "w-2.5 h-2.5",
      menu: "w-6 h-6",
      menuIcon: "w-3 h-3",
      radius: 34,
    },
    md: {
      handle: "h-6",
      handleIcon: "w-3 h-3",
      menu: "w-7 h-7",
      menuIcon: "w-3.5 h-3.5",
      radius: 42,               // was 30
    },
  };

  const s = sizes[size] || sizes.sm;

  // Mode indicator icon inside handle (or custom icon)
  const ModeIcon = handleIcon || (dragMode === "copy" ? Copy : Move);
  const titleText = handleTitle || `${dragMode === "copy" ? "Copy" : "Move"} mode - Click for menu`;

  // Get angles based on direction and item count
  const getAnglesForDirection = useCallback((direction, count) => {
    const spread = 45; // degrees between items
    const baseAngles = {
      left: 180,    // center of left arc
      right: 0,     // center of right arc
      down: 90,     // center of bottom arc (90 = straight down)
      up: 270,      // center of top arc
    };
    const base = baseAngles[direction] || 0;

    const angles = [];
    const halfSpread = ((count - 1) * spread) / 2;
    for (let i = 0; i < count; i++) {
      angles.push(base - halfSpread + i * spread);
    }
    return angles;
  }, []);

  // ✅ Support custom items or default drag handle menu
  const menuItems = useMemo(
    () => {
      // If custom items provided, use those with calculated angles
      if (items && items.length > 0) {
        const allItems = extraItems?.length ? [...items, ...extraItems] : items;
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
        {
          icon: dragMode === "move" ? Copy : Move,
          label: dragMode === "move" ? "Set to Copy" : "Set to Move",
          onClick: onToggleDragMode,
          color: dragMode === "move" ? "bg-blue-600 hover:bg-blue-500" : "bg-slate-600 hover:bg-slate-500",
        },
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
          label: "Remove",
          onClick: onDelete,
          color: "bg-red-700 hover:bg-red-600",
        });
      }
      if (extraItems?.length) defaultItems.push(...extraItems);
      const angles = getAnglesForDirection(openDirection, defaultItems.length);
      return defaultItems.map((item, i) => ({ ...item, angle: angles[i] }));
    },
    [items, extraItems, addLabel, dragMode, onAddChild, onSettings, onToggleDragMode, onToggleCollapse, isCollapsed, onToggleHeader, showHeader, onFilter, onTemplate, onHistory, onToggleDoc, onDelete, openDirection, getAnglesForDirection]
  );

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
          width: Math.max(menuItems.length * 30 + 60, s.radius * 2 + 60),
          height: Math.max(menuItems.length * 30 + 60, s.radius * 2 + 60),
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          zIndex: 2147483647,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
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
            const arcPositions = menuItems.map((item) => {
              const rad = (item.angle * Math.PI) / 180;
              return {
                x: Math.cos(rad) * s.radius,
                y: Math.sin(rad) * s.radius,
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
              const count = menuItems.length;
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
                finalPositions = menuItems.map((_, i) => ({
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
                finalPositions = menuItems.map((_, i) => ({
                  x: -halfSpan + i * spacing + xShift,
                  y: lineY,
                }));
              }
            } else {
              finalPositions = arcPositions;
            }

            return menuItems.map((item, index) => {
            const Icon = item.icon;
            const { x, y } = finalPositions[index];

            const delay = index * 35;

            return (
              <button
                key={item.label}
                type="button"
                onClick={(e) => handleAction(item.onClick, e)}
                disabled={disabled || !item.onClick}
                className={`
                  radial-menu-item
                  absolute
                  ${s.menu}
                  rounded-full
                  flex items-center justify-center
                  ${item.color}
                  border-2 border-white/80        /* ✅ white border like handle */
                  shadow-lg
                  transition-all
                  ${entered ? "pointer-events-auto" : "pointer-events-none"}
                  ${disabled || !item.onClick ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:scale-110"}
                `}
                style={{
                  left: "50%",
                  top: "50%",
                  transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                  transitionDelay: `${delay}ms`,
                }}
                title={item.label}
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
          ? React.createElement(ModeIcon, { className: `${s.handleIcon} text-white/90` })
          : ModeIcon
        }
      </button>


      {/* ✅ Portal renders arc menu above overflow/scroll parents */}
      {portaledArcMenu}

      {/* ❌ removed always-visible Move/Copy label per request */}
    </div>
  );
}

