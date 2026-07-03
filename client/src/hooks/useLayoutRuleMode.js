// hooks/useLayoutRuleMode.js
// Resolves the user-configured layout mode (grid.meta.layoutRules) against the
// live viewport. Returns "desktop" | "mobile" | null (null = no rules / no
// match → caller falls back to the useMobileDetect heuristic).
//
// Listens for resize ONLY while rules exist, debounced the same 200ms as
// useMobileDetect so a tablet rotation settles into ONE layout swap.
import { useEffect, useState } from "react";
import { resolveLayoutMode } from "../helpers/layoutRules";

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

export function useLayoutRuleMode(rules) {
  const hasRules = Array.isArray(rules) && rules.length > 0;
  const [mode, setMode] = useState(() => (hasRules ? resolveLayoutMode(rules, viewport()) : null));

  useEffect(() => {
    if (!hasRules) { setMode(null); return; }
    setMode(resolveLayoutMode(rules, viewport()));
    let timer = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setMode(resolveLayoutMode(rules, viewport()));
      }, 200);
    };
    window.addEventListener("resize", onResize);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [rules, hasRules]);

  return hasRules ? mode : null;
}
