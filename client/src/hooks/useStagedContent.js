import { useEffect, useState } from "react";
import { requestStagedMount, isStagedMountReleased, isStagedMountEnabled } from "../helpers/stagedMount";

/**
 * Has this surface's CONTENT been let through yet?
 *
 * It used to also return a `showSpinner` flag driven by a 150ms timer, so a
 * panel that mounted quickly would not flash a loader. That was wrong in the way
 * that matters: a timer cannot fire while the main thread is busy, and during
 * load it is busy for seconds — the deployed build showed panel frames with
 * empty bodies and no loader for 2.6s. The hold's loader is now rendered
 * immediately and its delay lives in CSS (`.staged-hold-spinner`), where no
 * amount of blocked JavaScript can hold it up, and where a panel that becomes
 * ready inside the delay still never shows one because it unmounts first.
 */
export function useStagedContent(key, priority = 0) {
  // Ready on the FIRST render when staging is off or this key has already been
  // released — a surface that never has to wait must not render a waiting state
  // even for one commit.
  const [ready, setReady] = useState(() => !isStagedMountEnabled() || isStagedMountReleased(key));

  useEffect(() => {
    let alive = true;
    const off = requestStagedMount(key, priority, () => { if (alive) setReady(true); });
    return () => { alive = false; off(); };
    // priority is a hint for ordering; re-registering on every change would put
    // the surface back at the end of the queue, so it is read once per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return ready;
}
