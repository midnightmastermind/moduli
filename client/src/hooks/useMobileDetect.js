import { useState, useEffect } from "react";

export const MOBILE_BREAKPOINT = 600;

const query = `(max-width: ${MOBILE_BREAKPOINT}px)`;

export function useMobileDetect() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return { isMobile };
}
