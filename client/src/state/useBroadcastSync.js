// state/useBroadcastSync.js
// ============================================================
// BroadcastChannel-based cross-tab state sync
// Wraps dispatch to forward actions to other same-origin tabs
// ============================================================

import { useCallback, useEffect, useRef } from "react";
import { ActionTypes } from "./actions";

const CHANNEL_NAME = "moduli-sync";

// Actions that should be forwarded to other tabs
// (only optimistic/UI-relevant actions, not full state hydrations)
const SYNC_ACTIONS = new Set([
  ActionTypes.UPDATE_INSTANCE,
  ActionTypes.CREATE_INSTANCE,
  ActionTypes.DELETE_INSTANCE,
  ActionTypes.CREATE_INSTANCE_IN_CONTAINER,
  ActionTypes.UPDATE_CONTAINER,
  ActionTypes.UPDATE_CONTAINER_OCCURRENCES,
  ActionTypes.CREATE_CONTAINER,
  ActionTypes.DELETE_CONTAINER,
  ActionTypes.UPDATE_OCCURRENCE,
  ActionTypes.CREATE_OCCURRENCE,
  ActionTypes.DELETE_OCCURRENCE,
  ActionTypes.UPDATE_FIELD,
  ActionTypes.CREATE_FIELD,
  ActionTypes.DELETE_FIELD,
  ActionTypes.UPDATE_PANEL,
  ActionTypes.DELETE_PANEL,
  ActionTypes.UPDATE_GRID,
  ActionTypes.CREATE_MANIFEST,
  ActionTypes.UPDATE_MANIFEST,
  ActionTypes.DELETE_MANIFEST,
  ActionTypes.CREATE_VIEW,
  ActionTypes.UPDATE_VIEW,
  ActionTypes.DELETE_VIEW,
  ActionTypes.CREATE_DOC,
  ActionTypes.UPDATE_DOC,
  ActionTypes.DELETE_DOC,
  ActionTypes.CREATE_FOLDER,
  ActionTypes.UPDATE_FOLDER,
  ActionTypes.DELETE_FOLDER,
  ActionTypes.CREATE_ARTIFACT,
  ActionTypes.UPDATE_ARTIFACT,
  ActionTypes.DELETE_ARTIFACT,
]);

// Actions that should NOT be forwarded (local-only or full hydration)
// FULL_STATE, SET_USER_ID, LOGOUT, SET_GRID_ID, etc.

/**
 * useBroadcastSync - Wraps dispatch to sync actions across tabs
 *
 * @param {Function} rawDispatch - The original useReducer dispatch
 * @returns {Function} wrappedDispatch - Dispatch that also broadcasts to other tabs
 */
export function useBroadcastSync(rawDispatch) {
  const channelRef = useRef(null);
  const tabIdRef = useRef(`tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  // Set up the BroadcastChannel listener
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return; // SSR or unsupported

    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const { action, sourceTabId } = event.data || {};
      // Ignore messages from this tab
      if (sourceTabId === tabIdRef.current) return;
      // Dispatch the action locally (without re-broadcasting)
      if (action?.type) {
        rawDispatch(action);
      }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [rawDispatch]);

  // Wrapped dispatch that broadcasts sync-eligible actions
  const wrappedDispatch = useCallback((action) => {
    // Always dispatch locally first
    rawDispatch(action);

    // Broadcast to other tabs if eligible
    // Skip actions marked as _fromSocket (server already broadcasts to all tabs via socket)
    // Skip actions marked as _fromBroadcast (prevent infinite loops)
    if (
      channelRef.current &&
      action?.type &&
      SYNC_ACTIONS.has(action.type) &&
      !action._fromSocket &&
      !action._fromBroadcast
    ) {
      try {
        channelRef.current.postMessage({
          action,
          sourceTabId: tabIdRef.current,
        });
      } catch {
        // BroadcastChannel may fail on structured clone (e.g., functions in payload)
        // Silently ignore — server socket will eventually sync
      }
    }
  }, [rawDispatch]);

  return wrappedDispatch;
}
