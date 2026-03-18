// state/useBoardState.js
import { useReducer } from "react";
import { masterReducer } from "./masterReducer";
import { initialState } from "./initialState";
import { useBroadcastSync } from "./useBroadcastSync";

export function useBoardState() {
  const [state, rawDispatch] = useReducer(masterReducer, initialState);
  // Wrap dispatch with BroadcastChannel sync for cross-tab coordination
  const dispatch = useBroadcastSync(rawDispatch);
  return { state, dispatch };
}
