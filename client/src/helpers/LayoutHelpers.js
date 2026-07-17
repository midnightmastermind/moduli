// helpers/LayoutHelpers.js
import * as CommitHelpers from "./CommitHelpers";
import { uid } from "../uid";
// ============================================================================
// LOOKUP HELPERS - get items from state by ID
// ============================================================================

/**
 * Builds a lookup map from an array of items
 * @param {Array} items - Array of items with `id` property
 * @returns {Object} Map of id -> item
 */
export function buildLookup(items = []) {
  const m = Object.create(null);
  for (const item of items) if (item?.id) m[item.id] = item;
  return m;
}

/**
 * Gets a single item by ID from a lookup map
 * @param {string} id - The item ID
 * @param {Object} lookup - The lookup map (id -> item)
 * @returns {Object|null} The item or null if not found
 */
export function getItemById(id, lookup) {
  if (!id || !lookup) return null;
  return lookup[id] || null;
}

/**
 * Gets multiple items by IDs from a lookup map
 * @param {Array} ids - Array of item IDs
 * @param {Object} lookup - The lookup map (id -> item)
 * @returns {Array} Array of items (nulls filtered out)
 */
export function getItemsByIds(ids, lookup) {
  if (!Array.isArray(ids) || !lookup) return [];
  return ids.map(id => lookup[id]).filter(Boolean);
}

/**
 * Gets the instances for a container by looking up its occurrences
 * @param {Object} container - Container with occurrences array (of IDs)
 * @param {Object} occurrencesLookup - Lookup map for occurrences
 * @param {Object} instancesLookup - Lookup map for instances
 * @param {Date|string} currentFilterValue - Optional: filter by current filter date (unused, visibility handled by isOccurrenceVisible)
 * @returns {Array} Array of instance objects
 */
// Resolve ordered child occurrence IDs from an occurrence.
// Occurrence is the sole source of ordering — NO module fallback.
function resolveChildOccurrenceIds(entityOccurrence) {
  return entityOccurrence?.occurrences || [];
}

// Numeric coercion for sort. Returns NaN when the value can't be compared
// numerically; the comparator falls through to a string compare in that case.
function _numericValue(v) {
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    // Date-like strings: parse via Date to get an epoch ms.
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
      const t = new Date(v).getTime();
      if (!Number.isNaN(t)) return t;
    }
    const n = Number(v);
    return Number.isNaN(n) ? NaN : n;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  return NaN;
}

// Apply a per-occurrence local sort to an ordered list of children.
// `localSort = { fieldId: string|"label", dir: "asc"|"desc" } | null`.
// Children carry an `occurrence` (and optionally a `moduleId` for label).
// `fieldId === "label"` reads from the resolved module's label.
// Anything else reads `occurrence.fields[fid].value`.
// Stable — items with equal keys preserve drop order.
export function applyLocalSort(items, localSort, leafModulesLookup) {
  if (!Array.isArray(items) || items.length < 2) return items;

  // U1 — pinned-to-top occurrences skip sort + always render first in
  // insertion order. `occurrence.meta.pinned === true` opts in. Pinned
  // items keep their relative drop order; unpinned items go through the
  // normal sort path below.
  const pinned = [];
  const unpinned = [];
  for (const it of items) {
    if (it?.occurrence?.meta?.pinned === true) pinned.push(it);
    else unpinned.push(it);
  }

  if (!localSort || !localSort.fieldId || unpinned.length < 2) {
    return pinned.length > 0 ? [...pinned, ...unpinned] : unpinned;
  }
  const { fieldId, dir = "asc" } = localSort;
  const mult = dir === "desc" ? -1 : 1;
  const decorated = unpinned.map((it, idx) => {
    let v;
    if (fieldId === "label") {
      const mod = it.instance || (it.occurrence?.moduleId ? leafModulesLookup?.[it.occurrence.moduleId] : null);
      v = mod?.label ?? "";
    } else {
      v = it.occurrence?.fields?.[fieldId]?.value ?? null;
    }
    return { it, idx, v };
  });
  decorated.sort((a, b) => {
    const an = _numericValue(a.v);
    const bn = _numericValue(b.v);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) {
      return (an - bn) * mult || (a.idx - b.idx);
    }
    // Fall through to string compare on missing/non-numeric.
    const as = a.v == null ? "" : String(a.v);
    const bs = b.v == null ? "" : String(b.v);
    return as.localeCompare(bs) * mult || (a.idx - b.idx);
  });
  const sorted = decorated.map(d => d.it);
  return pinned.length > 0 ? [...pinned, ...sorted] : sorted;
}

export function getContainerItems(container, occurrencesLookup, leafModulesLookup, currentFilterValue, containerOccurrence) {
  const ids = resolveChildOccurrenceIds(containerOccurrence);
  if (!ids.length) return [];
  return ids
    .map(occId => {
      const occ = getItemById(occId, occurrencesLookup);
      if (!occ) return null;
      return getItemById(occ.moduleId, leafModulesLookup);
    })
    .filter(Boolean);
}

/**
 * Gets leaf modules (instance | artifact | textblock) with their occurrences for a container.
 * Occurrence controls order via `containerOccurrence.occurrences`. Returns `{ instance, occurrence }`
 * tuples — the `instance` field is a misnomer kept for back-compat: it can be any leaf module.
 */
export function getContainerItemsWithOccurrences(container, occurrencesLookup, leafModulesLookup, currentFilterValue, containerOccurrence) {
  const ids = resolveChildOccurrenceIds(containerOccurrence);
  if (!ids.length) return [];
  const items = ids
    .map(occId => {
      const occ = getItemById(occId, occurrencesLookup);
      if (!occ) return null;
      const instance = getItemById(occ.moduleId, leafModulesLookup);
      if (!instance) return null;
      return { instance, occurrence: occ };
    })
    .filter(Boolean);
  return applyLocalSort(items, containerOccurrence?.meta?.localSort, leafModulesLookup);
}

/**
 * Gets the containers for a panel by looking up its occurrences
 * @param {Object} panel - Panel with occurrences array (of IDs)
 * @param {Object} occurrencesLookup - Lookup map for occurrences
 * @param {Object} containersLookup - Lookup map for containers
 * @returns {Array} Array of container objects
 */
/**
 * Gets the containers for a panel.
 * Occurrence controls order: prefers panelOccurrence.occurrences, falls back to panel.occurrences (legacy).
 */
export function getPanelContainers(panel, occurrencesLookup, containersLookup, panelOccurrence) {
  const ids = resolveChildOccurrenceIds(panelOccurrence);
  if (!ids.length) return [];
  return ids
    .map(occId => {
      const occ = getItemById(occId, occurrencesLookup);
      if (!occ) return null;
      return getItemById(occ.moduleId, containersLookup);
    })
    .filter(Boolean);
}

/**
 * Finds the occurrence ID for a given target (instance/container/panel) within a parent's occurrences
 * @param {string} targetId - The target entity ID (instance, container, or panel ID)
 * @param {Array} parentOccurrences - Array of occurrence IDs from the parent (container.occurrences or panel.occurrences)
 * @param {Object} occurrencesLookup - Lookup map for occurrences
 * @returns {string|null} The occurrence ID or null if not found
 */
export function findOccurrenceIdByTarget(targetId, parentOccurrences, occurrencesLookup) {
  if (!targetId || !Array.isArray(parentOccurrences) || !occurrencesLookup) return null;
  for (const occId of parentOccurrences) {
    const occ = occurrencesLookup[occId];
    if (occ && occ.moduleId === targetId) {
      return occId;
    }
  }
  return null;
}

/**
 * Gets the index of a target within a parent's occurrences array
 * @param {string} targetId - The target entity ID
 * @param {Array} parentOccurrences - Array of occurrence IDs from the parent
 * @param {Object} occurrencesLookup - Lookup map for occurrences
 * @returns {number} The index or -1 if not found
 */
export function getTargetIndexInOccurrences(targetId, parentOccurrences, occurrencesLookup) {
  if (!targetId || !Array.isArray(parentOccurrences) || !occurrencesLookup) return -1;
  for (let i = 0; i < parentOccurrences.length; i++) {
    const occ = occurrencesLookup[parentOccurrences[i]];
    if (occ && occ.moduleId === targetId) {
      return i;
    }
  }
  return -1;
}

// ============================================================================
// INTERNAL
// ============================================================================
function normalizeId(doc) {
  if (!doc) return doc;
  if (doc.id) return doc;
  if (doc._id) return { ...doc, id: String(doc._id) };
  return doc;
}

// ============================================================================
// LIST UTILS (pure) - work with occurrence IDs
// ============================================================================
export function removeId(list = [], id) {
  return (list || []).filter((x) => x !== id);
}

export function ensureId(list = [], id) {
  const arr = list || [];
  return arr.includes(id) ? arr : [...arr, id];
}

export function insertAt(list = [], index, value) {
  const arr = [...(list || [])];
  // Remove if already exists to prevent duplicates
  const cleaned = arr.filter(x => x !== value);
  const i = Math.max(0, Math.min(cleaned.length, index));
  cleaned.splice(i, 0, value);
  return cleaned;
}

export function arrayMove(list = [], from, to) {
  const arr = [...(list || [])];
  if (from === to) return arr;
  if (from < 0 || from >= arr.length) return arr;
  const [item] = arr.splice(from, 1);
  const t = Math.max(0, Math.min(arr.length, to));
  arr.splice(t, 0, item);
  return arr;
}

// ============================================================================
// OCCURRENCE CREATION HELPERS
// ============================================================================

/**
 * Creates a panel with its occurrence in the grid
 * @param {string} userId - Required user ID for the occurrence
 */
export function createPanelInGrid({
  dispatch,
  socket,
  grid,
  panel,
  placement,
  userId,
  emit = true,
}) {
  if (!grid || !panel?.id || !userId) return;

  const gridId = grid._id?.toString() || grid.id;
  const occurrenceId = uid();

  // 1. Create the panel entity as a module
  CommitHelpers.createModule({ dispatch, socket, module: { ...panel, role: "panel" }, emit });

  // 2. Create the occurrence (panels are persistent by default)
  const occurrence = {
    id: occurrenceId,
    userId,
    moduleId: panel.id,
    gridId,
    iteration: { key: "time", value: new Date(), timeValue: new Date(), timeFilter: "daily", mode: "persistent" },
    timestamp: new Date(),
    placement: placement || { row: 0, col: 0, width: 1, height: 1 },
    fields: {},
    meta: {},
  };

  CommitHelpers.createOccurrence({ dispatch, socket, occurrence, emit });

  // 3. Add occurrence to grid
  addPanelToGrid({ dispatch, socket, grid, occurrenceId, emit });

  return { panel, occurrence };
}

/**
 * Creates a container with its occurrence in a panel
 * @param {string} userId - Required user ID for the occurrence
 */
export function createContainerInPanel({
  dispatch,
  socket,
  gridId,
  panel,
  container,
  userId,
  index = null,
  emit = true,
}) {
  if (!gridId || !panel || !container?.id || !userId) return;

  const panelId = panel.id || panel._id?.toString();
  const occurrenceId = uid();

  // 1. Create the container entity as a module
  CommitHelpers.createModule({ dispatch, socket, module: { ...container, role: "container" }, emit });

  // 2. Create the occurrence (containers are persistent by default)
  const occurrence = {
    id: occurrenceId,
    userId,
    moduleId: container.id,
    gridId,
    iteration: { key: "time", value: new Date(), timeValue: new Date(), timeFilter: "daily", mode: "persistent" },
    timestamp: new Date(),
    fields: {},
    meta: { panelId },
  };

  CommitHelpers.createOccurrence({ dispatch, socket, occurrence, emit });

  // 3. Add occurrence to panel occurrence (ordering lives on the panel occurrence)
  const panelOccurrence = panel._occurrence || null;
  if (panelOccurrence) {
    addContainerToPanel({ dispatch, socket, panelOccurrence, occurrenceId, index, emit });
  } else {
    console.warn('[LayoutHelpers] createContainerInPanel: panel._occurrence is null — ordering skipped');
  }

  return { container, occurrence };
}

/**
 * Creates an instance with its occurrence in a container
 * @param {string} userId - Required user ID for the occurrence
 * @param {string} iterationMode - Persistence mode: 'persistent', 'specific', or 'untilDone'
 */
export function createInstanceInContainer({
  dispatch,
  socket,
  gridId,
  container,
  containerOccurrence = null,
  instance,
  userId,
  index = null,
  iterationMode = "specific",
  emit = true,
}) {
  if (!gridId || !container || !instance?.id || !userId) return;

  const occurrenceId = uid();

  // 1. Create the instance entity as a module
  CommitHelpers.createModule({ dispatch, socket, module: { ...instance, role: "instance" }, emit });

  // 2. Create the occurrence
  const occurrence = {
    id: occurrenceId,
    userId,
    moduleId: instance.id,
    gridId,
    iteration: { key: "time", value: new Date(), timeValue: new Date(), timeFilter: "daily", mode: iterationMode },
    timestamp: new Date(),
    fields: {},
    parentId: containerOccurrence?.id || null,
  };

  CommitHelpers.createOccurrence({ dispatch, socket, occurrence, emit });

  // 3. Add occurrence to container occurrence (ordering lives on the container occurrence)
  if (containerOccurrence) {
    addInstanceToContainer({ dispatch, socket, containerOccurrence, occurrenceId, index, emit });
  } else {
    console.warn('[LayoutHelpers] createInstanceInContainer: containerOccurrence is null — ordering skipped');
  }

  return { instance, occurrence };
}

// ============================================================================
// PAGE HELPERS
// ============================================================================

/**
 * Gets the pages for a panel by looking up its child occurrences that target page modules.
 * Returns [{ page, occurrence }] for all pages in a panel.
 */
export function getPanelPages(panelOccurrence, occurrencesLookup, modulesLookup) {
  const ids = resolveChildOccurrenceIds(panelOccurrence);
  if (!ids.length) return [];
  return ids
    .map(occId => {
      const occ = getItemById(occId, occurrencesLookup);
      if (!occ) return null;
      const mod = getItemById(occ.moduleId, modulesLookup);
      if (!mod || mod.role !== "page") return null;
      return { page: mod, occurrence: occ };
    })
    .filter(Boolean);
}

/**
 * Gets the child MODULES of a page occurrence, in order. Pages can host any
 * module role (containers, artifacts, textblocks, even nested pages) — pass a
 * combined `modulesLookup` (e.g. `state.modulesById`) so all child kinds resolve.
 * Caller can filter by role afterward if it wants only containers, etc.
 */
export function getPageChildrenModules(pageOccurrence, occurrencesLookup, modulesLookup) {
  const ids = resolveChildOccurrenceIds(pageOccurrence);
  if (!ids.length) return [];
  return ids
    .map(occId => {
      const occ = getItemById(occId, occurrencesLookup);
      if (!occ) return null;
      return getItemById(occ.moduleId, modulesLookup);
    })
    .filter(Boolean);
}

/**
 * Creates a page module + view + occurrence inside a panel.
 */
export function createPageInPanel({
  dispatch,
  socket,
  gridId,
  panelOccurrence,
  page,
  view,
  userId,
  folderId,
  index = null,
  emit = true,
}) {
  if (!gridId || !panelOccurrence || !page?.id || !userId) return;

  const occurrenceId = uid();

  const occurrence = {
    id: occurrenceId,
    userId,
    moduleId: page.id,
    gridId,
    timestamp: new Date(),
    fields: {},
    occurrences: [],
    ...(view?.id ? { viewId: view.id } : {}),
    ...(folderId ? { parentId: folderId } : {}),
  };

  CommitHelpers.createPage({
    dispatch, socket,
    module: { ...page, role: "page" },
    view: view || null,
    occurrence,
    panelOccurrenceId: panelOccurrence.id,
    emit,
  });

  return { page, occurrence, view };
}

// ============================================================================
// BEHAVIOR RESOLUTION (Phase 5.2)
// ============================================================================

const DEFAULT_BEHAVIOR = { sortable: true, draggable: true, droppable: true };

/**
 * Resolve effective behavior for a module, cascading from parent defaults.
 * If entity.behaviorMode === "own", use entity.behavior.
 * Otherwise, use parent.behavior (or global defaults if no parent).
 */
export function resolveBehavior(entity, parent = null) {
  if (!entity) return { ...DEFAULT_BEHAVIOR };
  if (entity.behaviorMode === "own" && entity.behavior) {
    return {
      sortable:  entity.behavior.sortable  ?? true,
      draggable: entity.behavior.draggable ?? true,
      droppable: entity.behavior.droppable ?? true,
    };
  }
  // Inherit from parent
  if (parent?.behavior) {
    return {
      sortable:  parent.behavior.sortable  ?? true,
      draggable: parent.behavior.draggable ?? true,
      droppable: parent.behavior.droppable ?? true,
    };
  }
  return { ...DEFAULT_BEHAVIOR };
}

// ============================================================================
// PANEL COPY / COPYLINK / SPLIT
// ============================================================================

/**
 * Copies a panel — creates a new panel entity with the same layout/style,
 * starting with no containers.
 */
export function copyPanel({ dispatch, socket, grid, panel, userId, emit = true }) {
  if (!grid || !panel?.id || !userId) return null;
  const newPanel = {
    ...panel,
    id: uid(),
    label: `${panel.label || "Panel"} (Copy)`,
    splitPartnerId: null,
  };
  return createPanelInGrid({ dispatch, socket, grid, panel: newPanel, userId, emit });
}

/**
 * Creates a linked occurrence of a panel in the grid.
 * The same panel entity appears in two grid cells — containers are shared.
 */
export function copylinkPanel({ dispatch, socket, grid, panel, userId, emit = true }) {
  if (!grid || !panel?.id || !userId) return null;
  const gridId = grid._id?.toString() || grid.id;
  const occurrenceId = uid();
  const occurrence = {
    id: occurrenceId,
    userId,
    moduleId: panel.id,
    gridId,
    iteration: { key: "time", value: new Date(), timeValue: new Date(), timeFilter: "daily", mode: "persistent" },
    timestamp: new Date(),
    placement: null,
    fields: {},
    meta: {},
  };
  CommitHelpers.createOccurrence({ dispatch, socket, occurrence, emit });
  addPanelToGrid({ dispatch, socket, grid, occurrenceId, emit });
  return { occurrence };
}

/**
 * Splits a panel's containers between the original panel and a new sibling panel.
 * Stores splitPartnerId on the original panel to enable un-splitting.
 */
export function splitPanel({ dispatch, socket, grid, panel, panelOccurrence, userId, emit = true }) {
  if (!grid || !panel?.id || !userId) return null;
  const containerOccIds = panelOccurrence?.occurrences || [];
  if (containerOccIds.length < 2) return null;

  const midpoint = Math.ceil(containerOccIds.length / 2);
  const firstHalf = containerOccIds.slice(0, midpoint);
  const secondHalf = containerOccIds.slice(midpoint);
  const newPanelId = uid();

  // Update original panel occurrence: keep first half
  if (panelOccurrence) {
    CommitHelpers.updateOccurrence({
      dispatch, socket, emit,
      occurrence: { ...panelOccurrence, occurrences: firstHalf },
    });
  }

  // Update original panel entity: record the split partner
  CommitHelpers.updateModule({
    dispatch, socket, emit,
    module: normalizeId({ ...panel, splitPartnerId: newPanelId }),
  });

  // Create split partner with second half, same layout settings
  const newPanel = {
    ...panel,
    id: newPanelId,
    label: `${panel.label || "Panel"} (Split)`,
    splitPartnerId: null,
  };
  const result = createPanelInGrid({ dispatch, socket, grid, panel: newPanel, userId, emit });

  // Set the new panel occurrence's ordering to secondHalf
  if (result?.occurrence) {
    CommitHelpers.updateOccurrence({
      dispatch, socket, emit,
      occurrence: { ...result.occurrence, occurrences: secondHalf },
    });
  }

  return result;
}

/**
 * Un-splits a panel — moves split partner's containers back, deletes the split panel.
 */
export function unsplitPanel({ dispatch, socket, grid, panel, panelOccurrence, splitPartnerPanel, splitPartnerPanelOccurrence, splitPartnerOccurrenceId, emit = true }) {
  if (!panel || !splitPartnerPanel) return;
  const mergedOccurrences = [
    ...(panelOccurrence?.occurrences || []),
    ...(splitPartnerPanelOccurrence?.occurrences || []),
  ];
  // Update occurrence ordering (merged)
  if (panelOccurrence) {
    CommitHelpers.updateOccurrence({
      dispatch, socket, emit,
      occurrence: { ...panelOccurrence, occurrences: mergedOccurrences },
    });
  }
  // Update panel entity: clear splitPartnerId
  CommitHelpers.updateModule({
    dispatch, socket, emit,
    module: normalizeId({ ...panel, splitPartnerId: null }),
  });
  CommitHelpers.deleteModule({ dispatch, socket, moduleId: splitPartnerPanel.id, emit });
  if (grid && splitPartnerOccurrenceId) {
    removePanelFromGrid({ dispatch, socket, grid, occurrenceId: splitPartnerOccurrenceId, emit });
  }
}

// ============================================================================
// COPY HELPERS (duplicate entity + create new occurrence)
// ============================================================================

/**
 * Copies a container (creates duplicate container + new occurrence)
 */
export function copyContainer({
  dispatch,
  socket,
  gridId,
  panel,
  sourceContainer,
  emit = true,
}) {
  if (!sourceContainer) return null;

  const newContainerId = uid();
  const newContainer = {
    ...sourceContainer,
    id: newContainerId,
    label: `${sourceContainer.label} (Copy)`,
  };

  return createContainerInPanel({
    dispatch,
    socket,
    gridId,
    panel,
    container: newContainer,
    emit,
  });
}

/**
 * Copies an instance (creates duplicate instance + new occurrence)
 */
export function copyInstance({
  dispatch,
  socket,
  gridId,
  container,
  sourceInstance,
  emit = true,
}) {
  if (!sourceInstance) return null;

  const newInstanceId = uid();
  const newInstance = {
    ...sourceInstance,
    id: newInstanceId,
    label: `${sourceInstance.label} (Copy)`,
  };

  return createInstanceInContainer({
    dispatch,
    socket,
    gridId,
    container,
    instance: newInstance,
    emit,
  });
}

/**
 * Creates a new occurrence for an existing instance in a container
 * Used for "copy-drag" mode where the same instance appears in multiple places
 * This does NOT duplicate the instance - just creates a new occurrence reference
 *
 * @param {Object} params
 * @param {string} params.userId - Required user ID for the occurrence
 * @param {string} params.iterationMode - Persistence mode: 'persistent', 'specific', or 'untilDone'
 * @param {Date|string} params.iterationValue - The date for this occurrence (for 'specific' mode)
 */
export function copyInstanceToContainer({
  dispatch,
  socket,
  gridId,
  sourceInstanceId,
  toContainer,
  userId,
  toIndex = null,
  emit = true,
  iterationMode = "specific",  // Default: specific to this iteration
  iterationValue = null,       // The date for this occurrence
  sourceOccurrence = null,     // Source occurrence to copy field values from
  initialMeta = null,          // Extra meta fields (e.g. { x, y } for canvas containers)
  toPanelId = null,            // Panel module ID — passed to createOccurrence for operation triggers
  toPanelLabel = "",           // Panel label — enriches the optimistic OccurrenceCreateOp
}) {
  if (!gridId || !sourceInstanceId || !toContainer || !userId) return null;

  const occurrenceId = uid();

  // Determine the iteration value - use provided date or current date
  const dateValue = iterationValue || new Date();

  // Deep-clone field values from source occurrence if available (D2 bug fix)
  let copiedFields = {};
  if (sourceOccurrence?.fields && typeof sourceOccurrence.fields === "object") {
    try {
      copiedFields = JSON.parse(JSON.stringify(sourceOccurrence.fields));
    } catch {
      copiedFields = { ...sourceOccurrence.fields };
    }
  }

  // Create the occurrence with persistence mode
  const occurrence = {
    id: occurrenceId,
    userId,
    moduleId: sourceInstanceId,
    gridId,
    iteration: {
      key: "time",
      value: dateValue,
      mode: iterationMode,  // 'persistent', 'specific', or 'untilDone'
    },
    timestamp: new Date(),
    fields: copiedFields,
    parentId: toContainer._occurrence?.id || null,
    ...(initialMeta ? { meta: initialMeta } : {}),
  };

  CommitHelpers.createOccurrence({
    dispatch, socket, occurrence, emit,
    panelId: toPanelId,
    containerLabel: toContainer.label || "",
    panelLabel: toPanelLabel,
    insertAtIndex: toIndex,
  });

  // Add occurrence to container occurrence (ordering lives on the container occurrence)
  const toContainerOcc = toContainer._occurrence || null;
  if (toContainerOcc) {
    addInstanceToContainer({ dispatch, socket, containerOccurrence: toContainerOcc, occurrenceId, index: toIndex, emit });
  } else {
    console.warn('[LayoutHelpers] copyInstanceToContainer: toContainer._occurrence is null — ordering skipped');
  }

  return { occurrence };
}

/**
 * Resolve the linkedGroupId for a copylink/fill operation and tag the source.
 * tagFn(sourceOccurrenceId, linkedGroupId) is called only when the source
 * exists but had no group yet. Returns { linkedGroupId }.
 */
export function assignLinkedGroup(sourceOccurrence, tagFn) {
  const sourceId = sourceOccurrence?.id || null;
  const existing = sourceOccurrence?.linkedGroupId || null;
  const linkedGroupId = existing || sourceId || uid();
  if (sourceId && !existing && typeof tagFn === "function") {
    tagFn(sourceId, linkedGroupId);
  }
  return { linkedGroupId };
}

/**
 * Creates a linked (copylink) occurrence for an instance in a container.
 * Linked occurrences share field values — editing one propagates to all
 * occurrences in the same linkedGroupId.
 */
export function copylinkInstanceToContainer({
  dispatch,
  socket,
  gridId,
  sourceInstanceId,
  sourceOccurrenceId,
  toContainer,
  userId,
  toIndex = null,
  emit = true,
  iterationMode = "specific",
  iterationValue = null,
  sourceOccurrence = null,
  initialMeta = null,
  dragMode = null,
  fireTrigger = true,
}) {
  if (!gridId || !sourceInstanceId || !toContainer || !userId) return null;

  const occurrenceId = uid();
  const dateValue = iterationValue || new Date();

  const { linkedGroupId } = assignLinkedGroup(
    sourceOccurrence || (sourceOccurrenceId ? { id: sourceOccurrenceId } : null),
    (sourceId, groupId) => {
      CommitHelpers.updateOccurrence({
        dispatch,
        socket,
        occurrence: { id: sourceId, linkedGroupId: groupId },
        emit,
      });
    }
  );

  // Copy field values from source occurrence
  let copiedFields = {};
  if (sourceOccurrence?.fields && typeof sourceOccurrence.fields === "object") {
    try {
      copiedFields = JSON.parse(JSON.stringify(sourceOccurrence.fields));
    } catch {
      copiedFields = { ...sourceOccurrence.fields };
    }
  }

  const occurrence = {
    id: occurrenceId,
    userId,
    moduleId: sourceInstanceId,
    gridId,
    iteration: {
      key: "time",
      value: dateValue,
      mode: iterationMode,
    },
    timestamp: new Date(),
    fields: copiedFields,
    linkedGroupId,
    parentId: toContainer._occurrence?.id || null,
    ...(initialMeta ? { meta: initialMeta } : {}),
    ...(dragMode ? { dragMode } : {}),
  };

  CommitHelpers.createOccurrence({ dispatch, socket, occurrence, emit, fireTrigger, insertAtIndex: toIndex });

  // Add occurrence to container occurrence (ordering lives on the container occurrence)
  const toContainerOcc = toContainer._occurrence || null;
  if (toContainerOcc) {
    addInstanceToContainer({ dispatch, socket, containerOccurrence: toContainerOcc, occurrenceId, index: toIndex, emit });
  } else {
    console.warn('[LayoutHelpers] copylinkInstanceToContainer: toContainer._occurrence is null — ordering skipped');
  }
  return { occurrence, linkedGroupId };
}

/**
 * Creates a new occurrence for an existing container in a panel
 * Used for "copy-drag" mode where the same container appears in multiple panels
 * This does NOT duplicate the container entity - just creates a new occurrence reference
 *
 * @param {Object} params
 * @param {string} params.userId - Required user ID for the occurrence
 * @param {string} params.sourceContainerId - The container entity ID to reference
 * @param {Object} params.toPanel - The target panel to add the occurrence to
 * @param {number} params.toIndex - Optional insertion index
 * @param {string} params.iterationMode - Persistence mode: 'persistent', 'specific', or 'untilDone'
 * @param {Date|string} params.iterationValue - The date for this occurrence
 */
export function copyContainerToPanel({
  dispatch,
  socket,
  gridId,
  sourceContainerId,
  toPanel,
  userId,
  toIndex = null,
  emit = true,
  iterationMode = "specific",
  iterationValue = null,
}) {
  if (!gridId || !sourceContainerId || !toPanel || !userId) return null;

  const panelId = toPanel.id || toPanel._id?.toString();
  const occurrenceId = uid();
  const dateValue = iterationValue || new Date();

  // Create the occurrence (referencing the existing container entity)
  const occurrence = {
    id: occurrenceId,
    userId,
    moduleId: sourceContainerId, // Same container, new occurrence
    gridId,
    iteration: {
      key: "time",
      value: dateValue,
      mode: iterationMode,
    },
    timestamp: new Date(),
    fields: {},
    meta: { panelId },
  };

  CommitHelpers.createOccurrence({ dispatch, socket, occurrence, emit });

  // Add occurrence to panel occurrence (ordering lives on the panel occurrence)
  const toPanelOcc = toPanel._occurrence || null;
  if (toPanelOcc) {
    addContainerToPanel({ dispatch, socket, panelOccurrence: toPanelOcc, occurrenceId, index: toIndex, emit });
  } else {
    console.warn('[LayoutHelpers] copyContainerToPanel: toPanel._occurrence is null — ordering skipped');
  }

  return { occurrence };
}

// ============================================================================
// GRID: add/remove panel occurrence
// ============================================================================
export function addPanelToGrid({ dispatch, socket, grid, occurrenceId, emit = true }) {
  if (!grid || !occurrenceId) return;
  const updatedGrid = { ...grid, occurrences: ensureId(grid.occurrences || [], occurrenceId) };
  const gridId = updatedGrid?._id ?? updatedGrid?.id;
  if (!gridId) return;
  CommitHelpers.updateGrid({ dispatch, socket, gridId: String(gridId), grid: updatedGrid, emit });
}

export function removePanelFromGrid({ dispatch, socket, grid, occurrenceId, emit = true }) {
  if (!grid || !occurrenceId) return;
  const updatedGrid = { ...grid, occurrences: removeId(grid.occurrences || [], occurrenceId) };
  const gridId = updatedGrid?._id ?? updatedGrid?.id;
  if (!gridId) return;
  CommitHelpers.updateGrid({ dispatch, socket, gridId: String(gridId), grid: updatedGrid, emit });
}

// ============================================================================
// PANEL: add/remove/reorder container occurrence
// All ordering stored on the panel OCCURRENCE — not the panel module entity.
// ============================================================================

/**
 * Find the container occurrence for a given container module ID within a parent occurrence.
 * Scans parentOccurrence.occurrences for a child occurrence with targetId === containerModuleId.
 */
export function findContainerOccurrence(containerModuleId, parentOccurrence, occurrencesById) {
  if (!parentOccurrence?.occurrences || !containerModuleId) return null;
  for (const childOccId of parentOccurrence.occurrences) {
    const occ = occurrencesById[childOccId];
    if (occ?.moduleId === containerModuleId) return occ;
  }
  return null;
}

export function addContainerToPanel({
  dispatch,
  socket,
  panelOccurrence,
  occurrenceId,
  index = null,
  emit = true,
}) {
  if (!panelOccurrence || !occurrenceId) {
    if (!panelOccurrence) console.warn('[LayoutHelpers] addContainerToPanel: panelOccurrence is null — ordering skipped');
    return;
  }

  const list = panelOccurrence.occurrences || [];
  const nextList =
    index == null
      ? ensureId(list, occurrenceId)
      : insertAt(list, index, occurrenceId);

  const updated = { ...panelOccurrence, occurrences: nextList };
  CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: updated, emit });
}

export function removeContainerFromPanel({
  dispatch,
  socket,
  panelOccurrence,
  occurrenceId,
  emit = true,
}) {
  if (!panelOccurrence || !occurrenceId) return;
  const updated = { ...panelOccurrence, occurrences: removeId(panelOccurrence.occurrences || [], occurrenceId) };
  CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: updated, emit });
}

export function reorderContainersInPanel({
  dispatch,
  socket,
  panelOccurrence,
  fromIndex,
  toIndex,
  emit = true,
}) {
  if (!panelOccurrence) return;
  const next = arrayMove(panelOccurrence.occurrences || [], fromIndex, toIndex);
  CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...panelOccurrence, occurrences: next }, emit });
}

/**
 * Moves a container occurrence between panels.
 * fromPanelOccurrence and toPanelOccurrence are panel OCCURRENCES (not module entities).
 */
export function moveContainerBetweenPanels({
  dispatch,
  socket,
  fromPanelOccurrence,
  toPanelOccurrence,
  occurrenceId,
  toIndex = null,
  emit = true,
}) {
  if (!fromPanelOccurrence || !toPanelOccurrence || !occurrenceId) return;

  const fromIds = removeId(fromPanelOccurrence.occurrences || [], occurrenceId);
  const toIdsRaw = removeId(toPanelOccurrence.occurrences || [], occurrenceId);

  let toIds;
  if (toIndex == null || toIndex < 0 || toIndex > toIdsRaw.length) {
    toIds = [...toIdsRaw, occurrenceId];
  } else {
    toIds = [...toIdsRaw];
    toIds.splice(toIndex, 0, occurrenceId);
  }

  CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...fromPanelOccurrence, occurrences: fromIds }, emit });
  CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...toPanelOccurrence, occurrences: toIds }, emit });
}

export function setPanelStackDisplay({
  dispatch,
  socket,
  panel,
  display,
  emit = true,
}) {
  const p = normalizeId(panel);
  if (!p?.id) return;

  const curr = p.layout || {};
  const style = curr.style && typeof curr.style === "object" ? curr.style : {};

  const nextPanel = {
    ...p,
    layout: {
      ...curr,
      style: {
        ...style,
        display: display ?? "block",
      },
    },
  };

  CommitHelpers.updateModule({ dispatch, socket, module: nextPanel, emit });
}

// ============================================================================
// CONTAINER: add/remove/reorder instance occurrences
// All ordering stored on the container OCCURRENCE — not the container module entity.
// ============================================================================
export function addInstanceToContainer({
  dispatch,
  socket,
  containerOccurrence,
  occurrenceId,
  index = null,
  emit = true,
}) {
  if (!containerOccurrence || !occurrenceId) {
    if (!containerOccurrence) console.warn('[LayoutHelpers] addInstanceToContainer: containerOccurrence is null — ordering skipped');
    return;
  }

  const list = containerOccurrence.occurrences || [];
  const nextList =
    index == null
      ? ensureId(list, occurrenceId)
      : insertAt(list, index, occurrenceId);

  const updated = { ...containerOccurrence, occurrences: nextList };
  CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: updated, emit });
}

export function removeInstanceFromContainer({
  dispatch,
  socket,
  containerOccurrence,
  occurrenceId,
  emit = true,
}) {
  if (!containerOccurrence || !occurrenceId) return;
  const updated = { ...containerOccurrence, occurrences: removeId(containerOccurrence.occurrences || [], occurrenceId) };
  CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: updated, emit });
}

export function reorderInstancesInContainer({
  dispatch,
  socket,
  containerOccurrence,
  fromIndex,
  toIndex,
  emit = true,
}) {
  if (!containerOccurrence) return;
  const prev = containerOccurrence.occurrences || [];
  const next = arrayMove(prev, fromIndex, toIndex);
  CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...containerOccurrence, occurrences: next }, emit });
}

/**
 * Moves an instance occurrence between containers.
 * fromContainerOccurrence and toContainerOccurrence are container OCCURRENCES (not module entities).
 */
export function moveInstanceBetweenContainers({
  dispatch,
  socket,
  fromContainerOccurrence,
  toContainerOccurrence,
  occurrenceId,
  toIndex = null,
  emit = true,
}) {
  if (!fromContainerOccurrence || !toContainerOccurrence || !occurrenceId) return;

  const fromIds = removeId(fromContainerOccurrence.occurrences || [], occurrenceId);
  const toIdsRaw = removeId(toContainerOccurrence.occurrences || [], occurrenceId);

  let toIds;
  if (toIndex == null || toIndex < 0 || toIndex > toIdsRaw.length) {
    toIds = [...toIdsRaw, occurrenceId];
  } else {
    toIds = [...toIdsRaw];
    toIds.splice(toIndex, 0, occurrenceId);
  }

  CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...fromContainerOccurrence, occurrences: fromIds }, emit });
  CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { ...toContainerOccurrence, occurrences: toIds }, emit });
}

// ============================================================================
// GRID RESIZE
// ============================================================================
export function resizeGrid({ dispatch, socket, grid, rows, cols, emit = true }) {
  if (!grid) return;
  const updatedGrid = { ...grid, rows, cols };
  const gridId = updatedGrid?._id ?? updatedGrid?.id;
  if (!gridId) return;
  CommitHelpers.updateGrid({ dispatch, socket, gridId: String(gridId), grid: updatedGrid, emit });
}
