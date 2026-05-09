// state/masterReducer.js
// =========================================
// masterReducer.js — UPDATED to match new ActionTypes
// Aligned with:
// - state/actions.js (single ActionTypes object)
// - bindSocketToStore.js (once you swap dispatch types)
// - server.js events
//
// Notes:
// - FULL_STATE stays the same.
// - Removed legacy HYDRATE + PATCH_* + ADD_* cases.
// - Added CREATE/UPDATE/DELETE for grid/panel/container/instance.
// - Kept list-based container/items + instances store behavior.
// =========================================

import { ActionTypes } from "./actions";
import { aliasOccurrence } from "../helpers/dragHitTesting";

// Helper: split a flat modules array into role-based derived arrays
function deriveRoleArrays(modules = []) {
  const panels = [], containers = [], instances = [], pages = [], artifacts = [], textblocks = [];
  for (const m of modules) {
    if (m.trashed) continue;
    if (m.role === "panel") panels.push(m);
    else if (m.role === "page") pages.push(m);
    else if (m.role === "container") containers.push(m);
    else if (m.role === "instance") instances.push(m);
    else if (m.role === "artifact") artifacts.push(m);
    else if (m.role === "textblock") textblocks.push(m);
  }
  return { panels, containers, instances, pages, artifacts, textblocks };
}

export function masterReducer(state, action) {
    switch (action.type) {
        // ======================================================
        // FULL STATE HYDRATE
        // ======================================================
        case ActionTypes.FULL_STATE:
        case ActionTypes.PRIORITY_STATE: {
            const {
                gridId = null,
                grid = null,
                modules: modulesPayload = [],
                grids: availableGrids = [],
                occurrences = [],
                fields = [],
                manifests = [],
                views = [],
                folders = [],
                operations = [],
            } = action.payload || {};

            const modules = modulesPayload;
            const derived = deriveRoleArrays(modules);
            const isFullLoad = action.type === ActionTypes.FULL_STATE;

            // Preserve textmaps already loaded (from priority_state viewport or lazy request_textmap)
            // Full_state occurrences come from cache with .select("-textmap") — no textmaps included.
            // Priority_state occurrences DO include textmaps (from targeted DB query).
            let mergedOccs = occurrences;
            if (isFullLoad && state.occurrences?.length > 0) {
                const existingTextmaps = {};
                for (const occ of state.occurrences) {
                    if (occ.textmap) existingTextmaps[occ.id] = occ.textmap;
                }
                if (Object.keys(existingTextmaps).length > 0) {
                    mergedOccs = occurrences.map(o =>
                        existingTextmaps[o.id] ? { ...o, textmap: existingTextmaps[o.id] } : o
                    );
                }
            }
            // Populate moduleId on every occurrence so the drag layer can read it
            // without falling back to targetId everywhere.
            mergedOccs = mergedOccs.map(aliasOccurrence);

            return {
                ...state,
                gridId: gridId ?? state.gridId,
                grid,
                modules,
                panels: derived.panels,
                containers: derived.containers,
                instances: derived.instances,
                artifacts: derived.artifacts,
                textblocks: derived.textblocks,
                availableGrids: availableGrids || [],
                occurrences: mergedOccs,
                fields: fields || [],
                manifests: manifests || [],
                views: views || [],
                folders: folders || [],
                operations: operations || [],
                computedValues: isFullLoad ? {} : state.computedValues,
                hydrated: true,
                fullStateLoaded: isFullLoad,
            };
        }

        // ======================================================
        // AUTH / SELECTION
        // ======================================================
        case ActionTypes.SET_GRID_ID: {
            // bindSocketToStore currently passes payload: payload.gridId (string)
            // actions.js creator passes { gridId }
            const gridId = typeof action.payload === "string" ? action.payload : action.payload?.gridId;
            return { ...state, gridId: gridId ?? state.gridId };
        }

        case ActionTypes.SET_USER_ID: {
            // allow either shape
            const userId = typeof action.payload === "string" ? action.payload : action.payload?.userId;
            return { ...state, userId: userId ?? state.userId };
        }
        case ActionTypes.LOGOUT: {
            return {
                ...state,
                userId: null,
                gridId: null,
                grid: null,
                modules: [],
                panels: [],
                pages: [],
                availableGrids: [],
                containers: [],
                instances: [],
                artifacts: [],
                textblocks: [],
                occurrences: [],
                fields: [],
                manifests: [],
                views: [],
                folders: [],
                operations: [],
                computedValues: {},
                filterNavState: {},
                hydrated: false,
            };
        }
        // ======================================================
        // GRIDS
        // ======================================================
        case ActionTypes.SET_AVAILABLE_GRIDS: {
            const availableGrids =
                action.payload?.availableGrids ??
                action.payload?.grids ??
                [];
            return { ...state, availableGrids };
        }

        case ActionTypes.SET_GRID: {
            const grid = action.payload?.grid ?? null;
            return { ...state, grid };
        }

        case ActionTypes.CREATE_GRID: {
            const grid = action.payload?.grid;
            if (!grid) return state;

            // if it includes an id, optionally set it
            const nextGridId = grid._id?.toString?.() || grid.id || state.gridId;

            // ensure available grids list includes it if you track that here
            // (server currently provides grids list on FULL_STATE, so this is optional)
            return {
                ...state,
                gridId: nextGridId,
                grid,
            };
        }

        case ActionTypes.UPDATE_GRID: {
            const { gridId, grid } = action.payload || {};
            if (!gridId || !grid) return state;

            // only apply patch to the currently active grid
            const activeId = state.gridId || state.grid?._id;
            if (activeId && gridId !== activeId) {
                // still update dropdown list name if present
                const nextAvailable = (state.availableGrids || []).map((g) =>
                    (g.id || g._id) === gridId ? { ...g, ...grid } : g
                );
                return { ...state, availableGrids: nextAvailable };
            }

            // merge patch into grid
            const nextGrid = { ...(state.grid || {}), ...grid };

            // also keep dropdown list in sync
            const nextAvailable = (state.availableGrids || []).map((g) =>
                (g.id || g._id) === gridId ? { ...g, ...grid } : g
            );

            return { ...state, grid: nextGrid, availableGrids: nextAvailable };
        }



        case ActionTypes.DELETE_GRID: {
            // minimal: if deleting current grid, clear
            const gridId = action.payload?.gridId ?? action.payload;
            if (!gridId) return state;

            if (state.gridId !== gridId) return state;

            return {
                ...state,
                gridId: null,
                grid: null,
                panels: [],
                // containers/instances are user-scoped in your server,
                // so we DO NOT wipe them on grid delete unless you change that model.
            };
        }

        // ======================================================
        // MODULES (unified Panel + Container + Instance)
        // ======================================================
        case ActionTypes.SET_MODULES: {
            const modules = action.payload?.modules ?? [];
            return { ...state, modules, ...deriveRoleArrays(modules) };
        }

        case ActionTypes.CREATE_MODULE:
        case ActionTypes.UPDATE_MODULE: {
            const module = action.payload?.module ?? action.payload;
            if (!module?.id) return state;

            const exists = (state.modules || []).some((m) => m.id === module.id);
            const nextModules = exists
                ? state.modules.map((m) => (m.id === module.id ? { ...m, ...module } : m))
                : [...(state.modules || []), module];

            return { ...state, modules: nextModules, ...deriveRoleArrays(nextModules) };
        }

        case ActionTypes.BATCH_UPDATE_MODULES: {
            const updates = action.payload?.modules;
            if (!Array.isArray(updates) || updates.length === 0) return state;
            const nextModules = [...(state.modules || [])];
            for (const mod of updates) {
                if (!mod?.id) continue;
                const idx = nextModules.findIndex(m => m.id === mod.id);
                if (idx >= 0) nextModules[idx] = { ...nextModules[idx], ...mod };
                else nextModules.push(mod);
            }
            return { ...state, modules: nextModules, ...deriveRoleArrays(nextModules) };
        }

        case ActionTypes.DELETE_MODULE: {
            const moduleId = action.payload?.moduleId ?? action.payload;
            if (!moduleId) return state;

            const nextModules = (state.modules || []).filter((m) => m.id !== moduleId);
            return { ...state, modules: nextModules, ...deriveRoleArrays(nextModules) };
        }

        case ActionTypes.CREATE_INSTANCE_IN_CONTAINER: {
            const instance = action.payload?.instance;
            if (!instance?.id) return state;
            const exists = (state.modules || []).some((m) => m.id === instance.id);
            if (exists) return state;
            const nextModules = [...(state.modules || []), { ...instance, role: "instance" }];
            return { ...state, modules: nextModules, ...deriveRoleArrays(nextModules) };
        }

        // ======================================================
        // OCCURRENCES
        // ======================================================
        case ActionTypes.SET_OCCURRENCES: {
            const occurrences = action.payload?.occurrences ?? [];
            return { ...state, occurrences };
        }

        case ActionTypes.CREATE_OCCURRENCE:
        case ActionTypes.UPDATE_OCCURRENCE: {
            const occurrence = action.payload?.occurrence ?? action.payload;
            if (!occurrence?.id) return state;

            // Handle _appendOcc / _removeOcc hints for optimistic parent updates
            const { _appendOcc, _removeOcc, ...occData } = occurrence;
            // Ensure both moduleId and targetId are populated (drag/drop layer
            // reads moduleId; legacy code reads targetId).
            const aliased = aliasOccurrence(occData);

            const exists = (state.occurrences || []).some((o) => o.id === aliased.id);

            let nextOccurrences;
            if (_appendOcc || _removeOcc) {
                // Optimistic: append or remove a child occ ID from this occurrence's list
                nextOccurrences = (state.occurrences || []).map((o) => {
                    if (o.id !== aliased.id) return o;
                    let children = [...(o.occurrences || [])];
                    if (_appendOcc && !children.includes(_appendOcc)) children.push(_appendOcc);
                    if (_removeOcc) children = children.filter(id => id !== _removeOcc);
                    return { ...o, ...aliased, occurrences: children };
                });
            } else {
                nextOccurrences = exists
                    ? state.occurrences.map((o) => (o.id === aliased.id ? { ...o, ...aliased } : o))
                    : [...(state.occurrences || []), aliased];
            }

            return { ...state, occurrences: nextOccurrences };
        }

        case ActionTypes.DELETE_OCCURRENCE: {
            const occurrenceId = action.payload?.occurrenceId ?? action.payload;
            if (!occurrenceId) return state;

            return {
                ...state,
                occurrences: (state.occurrences || []).filter((o) => o.id !== occurrenceId),
            };
        }

        // ======================================================
        // FIELDS
        // ======================================================
        case ActionTypes.SET_FIELDS: {
            const fields = action.payload?.fields ?? [];
            return { ...state, fields };
        }

        case ActionTypes.CREATE_FIELD:
        case ActionTypes.UPDATE_FIELD: {
            const field = action.payload?.field ?? action.payload;
            if (!field?.id) return state;

            const exists = (state.fields || []).some((f) => f.id === field.id);

            return {
                ...state,
                fields: exists
                    ? state.fields.map((f) => (f.id === field.id ? { ...f, ...field } : f))
                    : [...(state.fields || []), field],
            };
        }

        case ActionTypes.DELETE_FIELD: {
            const fieldId = action.payload?.fieldId ?? action.payload;
            if (!fieldId) return state;

            return {
                ...state,
                fields: (state.fields || []).filter((f) => f.id !== fieldId),
            };
        }

        // ======================================================
        // MANIFESTS
        // ======================================================
        case ActionTypes.CREATE_MANIFEST:
        case ActionTypes.UPDATE_MANIFEST: {
            const manifest = action.payload?.manifest ?? action.payload;
            if (!manifest?.id) return state;
            const exists = (state.manifests || []).some((m) => m.id === manifest.id);
            return {
                ...state,
                manifests: exists
                    ? state.manifests.map((m) => (m.id === manifest.id ? { ...m, ...manifest } : m))
                    : [...(state.manifests || []), manifest],
            };
        }
        case ActionTypes.DELETE_MANIFEST: {
            const manifestId = action.payload?.manifestId ?? action.payload;
            if (!manifestId) return state;
            return { ...state, manifests: (state.manifests || []).filter((m) => m.id !== manifestId) };
        }

        // ======================================================
        // VIEWS
        // ======================================================
        case ActionTypes.CREATE_VIEW:
        case ActionTypes.UPDATE_VIEW: {
            const view = action.payload?.view ?? action.payload;
            if (!view?.id) return state;
            const exists = (state.views || []).some((v) => v.id === view.id);
            return {
                ...state,
                views: exists
                    ? state.views.map((v) => (v.id === view.id ? { ...v, ...view } : v))
                    : [...(state.views || []), view],
            };
        }
        case ActionTypes.DELETE_VIEW: {
            const viewId = action.payload?.viewId ?? action.payload;
            if (!viewId) return state;
            return { ...state, views: (state.views || []).filter((v) => v.id !== viewId) };
        }

        // ======================================================
        // FOLDERS
        // ======================================================
        case ActionTypes.CREATE_FOLDER:
        case ActionTypes.UPDATE_FOLDER: {
            const folder = action.payload?.folder ?? action.payload;
            if (!folder?.id) return state;
            const exists = (state.folders || []).some((f) => f.id === folder.id);
            return {
                ...state,
                folders: exists
                    ? state.folders.map((f) => (f.id === folder.id ? { ...f, ...folder } : f))
                    : [...(state.folders || []), folder],
            };
        }
        case ActionTypes.DELETE_FOLDER: {
            const folderId = action.payload?.folderId ?? action.payload;
            if (!folderId) return state;
            return { ...state, folders: (state.folders || []).filter((f) => f.id !== folderId) };
        }

        // ======================================================
        // OPERATIONS
        // ======================================================
        case ActionTypes.CREATE_OPERATION:
        case ActionTypes.UPDATE_OPERATION: {
            const operation = action.payload?.operation ?? action.payload;
            if (!operation?.id) return state;
            const exists = (state.operations || []).some((o) => o.id === operation.id);
            return {
                ...state,
                operations: exists
                    ? state.operations.map((o) => (o.id === operation.id ? { ...o, ...operation } : o))
                    : [...(state.operations || []), operation],
            };
        }
        case ActionTypes.DELETE_OPERATION: {
            const operationId = action.payload?.operationId ?? action.payload;
            if (!operationId) return state;
            return { ...state, operations: (state.operations || []).filter((o) => o.id !== operationId) };
        }

        // ======================================================
        // COMPUTED VALUES (client-only, written by operation executor)
        // ======================================================
        case ActionTypes.SET_COMPUTED_VALUES: {
            const { updates } = action.payload || {};
            if (!Array.isArray(updates) || updates.length === 0) return state;

            const next = { ...(state.computedValues || {}) };
            for (const { fieldId, occurrenceId, value, target } of updates) {
                if (!fieldId) continue;
                const key = occurrenceId ? `${fieldId}:${occurrenceId}` : fieldId;
                next[key] = { value, target: target ?? null };
            }
            return { ...state, computedValues: next };
        }

        // ======================================================
        // FILTER NAV STATE (client-only)
        // ======================================================
        case ActionTypes.INIT_FILTER_NAV:
            return { ...state, filterNavState: action.payload || {} };

        case ActionTypes.SET_FILTER_NAV: {
            const { filterId, value } = action.payload || {};
            if (!filterId) return state;
            return { ...state, filterNavState: { ...(state.filterNavState || {}), [filterId]: value } };
        }

        // ======================================================
        // DND
        // ======================================================
        case ActionTypes.SET_ACTIVE_ID:
            return { ...state, activeId: action.payload?.activeId };

        case ActionTypes.SET_ACTIVE_SIZE:
            return { ...state, activeSize: action.payload?.activeSize };


        case ActionTypes.SOFT_TICK:
            return { ...state, softTick: (state.softTick || 0) + 1 };

        // ======================================================
        default:
            return state;
    }
}
