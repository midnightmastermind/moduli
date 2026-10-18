// hooks/useMediaPlace.js
// ============================================================
// `const placeRef = useMediaPlace(moduleId)` → `<video ref={placeRef} …>`. On load the element seeks
// to the file's saved place (helpers/mediaPlace); while it plays the place is written every few
// seconds of movement, and on pause / seek / end / page hide. A derived write (not an undo step —
// watching is not an edit), reading the module live at write time because the server replaces
// `meta` whole.
// ============================================================
import { useCallback, useEffect, useRef } from "react";
import { useGridActionsSelector } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { runDerived } from "../helpers/actionScope";
import { makePlaybackPosition, resumeTimeFor, movedEnough } from "../helpers/mediaPlace";

export default function useMediaPlace(moduleId) {
  const dispatch = useGridActionsSelector((s) => s.dispatch);
  const socket = useGridActionsSelector((s) => s.socket);
  const getModMap = useGridActionsSelector((s) => s.getModMap);
  const live = useRef({ dispatch, socket, getModMap, moduleId });
  live.current = { dispatch, socket, getModMap, moduleId };
  const detach = useRef(null);

  const ref = useCallback((el) => {
    detach.current?.();
    detach.current = null;
    if (!el) return;
    let lastSaved = NaN;
    let restored = false;
    const moduleNow = () => {
      const { getModMap: gm, moduleId: id } = live.current;
      return id ? gm?.()?.[id] || null : null;
    };
    const save = (force) => {
      const { dispatch: d, socket: s } = live.current;
      const mod = moduleNow();
      if (!mod || !restored) return;
      const t = el.currentTime;
      if (!force && !movedEnough(lastSaved, t)) return;
      if (force && Math.abs(t - lastSaved) < 0.5) return;
      lastSaved = t;
      const pos = makePlaybackPosition({ time: t, duration: el.duration });
      runDerived(() => CommitHelpers.updateModule({ dispatch: d, socket: s, module: { id: mod.id, meta: { ...(mod.meta || {}), playbackPosition: pos } } }));
    };
    const restore = () => {
      if (restored) return;
      restored = true;
      const at = resumeTimeFor(moduleNow()?.meta?.playbackPosition, el.duration);
      lastSaved = at ?? el.currentTime;
      if (at != null) { try { el.currentTime = at; } catch { /* not seekable yet */ } }
    };
    const onTime = () => save(false);
    const onStop = () => save(true);
    const onHide = () => { if (document.visibilityState === "hidden") save(true); };
    if (el.readyState >= 1) restore();
    el.addEventListener("loadedmetadata", restore);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("pause", onStop);
    el.addEventListener("seeked", onStop);
    el.addEventListener("ended", onStop);
    document.addEventListener("visibilitychange", onHide);
    detach.current = () => {
      save(true);
      el.removeEventListener("loadedmetadata", restore);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("pause", onStop);
      el.removeEventListener("seeked", onStop);
      el.removeEventListener("ended", onStop);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  useEffect(() => () => detach.current?.(), []);
  return ref;
}
