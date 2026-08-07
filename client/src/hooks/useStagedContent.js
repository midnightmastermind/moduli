import { useEffect, useState } from "react";
import { requestStagedMount, isStagedMountReleased, isStagedMountEnabled } from "../helpers/stagedMount";

/**
 * `[ready, showSpinner]` for a surface whose CONTENT is staged behind its chrome.
 *
 * `showSpinner` is deliberately NOT `!ready`. A spinner that appears and vanishes
 * inside a few frames reads as jank, not as progress — so nothing is shown until
 * the wait has actually lasted `spinnerDelayMs`. A panel that mounts quickly must
 * never flash one (plan Task 3, Step 3).
 */
export function useStagedContent(key, priority = 0, spinnerDelayMs = 150) {
  // Ready on the FIRST render when staging is off or this key has already been
  // released — a surface that never has to wait must not render a waiting state
  // even for one commit.
  const [ready, setReady] = useState(() => !isStagedMountEnabled() || isStagedMountReleased(key));
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    let alive = true;
    const off = requestStagedMount(key, priority, () => { if (alive) setReady(true); });
    return () => { alive = false; off(); };
    // priority is a hint for ordering; re-registering on every change would put
    // the surface back at the end of the queue, so it is read once per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (ready) { setShowSpinner(false); return; }
    const t = setTimeout(() => setShowSpinner(true), spinnerDelayMs);
    return () => clearTimeout(t);
  }, [ready, spinnerDelayMs]);

  return [ready, showSpinner];
}
