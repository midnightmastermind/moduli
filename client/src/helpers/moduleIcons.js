// helpers/moduleIcons.js
//
// Single source of truth for module-type iconography. Used wherever an
// occurrence/module needs a visual type tag — manifest tree pills, folder-page
// preview cards, DrilldownPicker tiles, QuickAddMenu add tiles, mind-map
// representation nodes, value-builder breadcrumb crumbs, etc.
//
// Resolution order:
//   1. `module.kind` — most specific signal (board/list/doc/canvas/table/...).
//   2. `module.role` — fallback when kind is unset (page/container/instance/
//      textblock/artifact/...).
//   3. For fields: `field.type` (number/text/boolean/select/occurrence/date/...).
//
// Add new icons here, not in component-local maps. Three existing maps in
// NodePill / PreviewNode / ModulePage are kept as inert fallbacks for now;
// migrate them to this helper as touched.
import {
  // page / container kinds
  Layout, FileText, LayoutGrid, PenTool, Table, List,
  // role fallbacks
  Box, Type, AlignLeft,
  // artifact kinds
  Image as ImageIcon, Music, Video, FileCode,
  // other entity types
  Folder, Zap, Stamp,
  // field types
  Hash, ToggleLeft, ChevronDown, Link2, Calendar, Star, Clock,
  // catch-all
  File, HelpCircle,
} from "lucide-react";

// ───────────────────────────────────────────────────────────────────────────
// Kind icons — the most specific layer. Container kinds + page kinds + the
// canvas/table/board distinctions. Looked up FIRST when `module.kind` is set.
// ───────────────────────────────────────────────────────────────────────────
export const KIND_ICONS = {
  // container/page kinds
  list:     List,
  doc:      FileText,
  board:    LayoutGrid,
  canvas:   PenTool,
  table:    Table,
  folder:   Folder,
  // artifact sub-kinds
  image:    ImageIcon,
  video:    Video,
  audio:    Music,
  pdf:      FileText,
  markdown: FileText,
  code:     FileCode,
  // misc
  preview:  Layout,
  display:  Layout,
};

// ───────────────────────────────────────────────────────────────────────────
// Role icons — fallback layer when kind isn't recognized or set. Pages
// without explicit kind get Layout; instances get Box; etc.
// ───────────────────────────────────────────────────────────────────────────
export const ROLE_ICONS = {
  page:      Layout,
  panel:     Layout,
  container: Hash,
  instance:  Box,
  textblock: AlignLeft,
  artifact:  FileText,
  template:  Stamp,
};

// ───────────────────────────────────────────────────────────────────────────
// Field-type icons — for field references in the value-builder card,
// category picker, etc. Reads field.type rather than role/kind.
// ───────────────────────────────────────────────────────────────────────────
export const FIELD_TYPE_ICONS = {
  number:     Hash,
  text:       Type,
  boolean:    ToggleLeft,
  select:     ChevronDown,
  occurrence: Link2,
  date:       Calendar,
  rating:     Star,
  duration:   Clock,
};

// ───────────────────────────────────────────────────────────────────────────
// Color tokens — paired with the icons so the same "type" reads consistent
// in color across surfaces. Returns a CSS color string (var() or rgba).
// ───────────────────────────────────────────────────────────────────────────
export const KIND_COLORS = {
  folder:   "#f59e0b",   // amber
  list:     "rgba(134,239,172,0.9)",  // green
  doc:      "rgba(100,180,255,0.9)",  // blue
  board:    "rgba(167,139,250,0.9)",  // purple (kanban-ish)
  canvas:   "rgba(244,114,182,0.9)",  // pink
  table:    "rgba(251,191,36,0.9)",   // amber-soft
  image:    "rgba(96,165,250,0.9)",
  video:    "rgba(96,165,250,0.9)",
  audio:    "rgba(96,165,250,0.9)",
  pdf:      "rgba(96,165,250,0.9)",
  code:     "rgba(96,165,250,0.9)",
};

export const ROLE_COLORS = {
  page:      "#06b6d4",  // cyan
  panel:     "#06b6d4",
  container: "rgba(134,239,172,0.9)",
  instance:  "rgba(100,180,255,0.9)",
  textblock: "rgba(125,211,252,0.9)",
  artifact:  "rgba(96,165,250,0.9)",
  template:  "rgba(251,191,36,0.9)",
};

// ───────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resolve the icon component for a module (or field, when passed via the
 * `field` arg). Returns a lucide React component you can render directly.
 * Falls back to a generic File icon when nothing matches.
 */
export function getModuleTypeIcon(module, field = null) {
  if (field?.type) return FIELD_TYPE_ICONS[field.type] || HelpCircle;
  if (!module) return File;
  if (module.kind && KIND_ICONS[module.kind]) return KIND_ICONS[module.kind];
  if (module.role && ROLE_ICONS[module.role]) return ROLE_ICONS[module.role];
  return File;
}

/**
 * Resolve the color string for a module's type. Mirrors `getModuleTypeIcon`'s
 * fallback chain. Used to tint icon strokes / borders / pills.
 */
export function getModuleTypeColor(module, field = null) {
  if (field?.type) return "var(--accent-blue-text, #bfdbfe)";
  if (!module) return "var(--text-secondary)";
  if (module.kind && KIND_COLORS[module.kind]) return KIND_COLORS[module.kind];
  if (module.role && ROLE_COLORS[module.role]) return ROLE_COLORS[module.role];
  return "var(--text-secondary)";
}

/**
 * Convenience for callers that want both at once. Returns `{ Icon, color }`.
 */
export function getModuleTypeBadge(module, field = null) {
  return {
    Icon:  getModuleTypeIcon(module, field),
    color: getModuleTypeColor(module, field),
  };
}

/**
 * Operation icon — operations don't have role/kind in the same shape but
 * deserve a consistent badge. Returns just the Zap icon.
 */
