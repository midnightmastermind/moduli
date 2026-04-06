// hooks/useDrilldown.js
// Manages drilldown animation state for folder pages.
// Windows 7 date-picker style: drill in zooms in, drill out zooms out, peer nav crossfades.

import { useState, useRef, useCallback, useLayoutEffect } from "react";

const ANIM_DURATION = 2500; // ms

export default function useDrilldown({ onNavigate, containerRef }) {
  // Animation state: null | { direction: "in"|"out"|"peer", targetOccId, sourceRect }
  const [animState, setAnimState] = useState(null);
  // Navigation stack for drill-out
  const [drilldownStack, setDrilldownStack] = useState([]);
  const timerRef = useRef(null);

  const _clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  // Drill IN: user clicked a PreviewNode card
  const startDrillDown = useCallback((occId, cardElement) => {
    if (!occId) return;
    const sourceRect = cardElement?.getBoundingClientRect() ?? null;

    setDrilldownStack(prev => [...prev, occId]);
    onNavigate?.(occId);
    setAnimState({ direction: "in", targetOccId: occId, sourceRect });

    _clearTimer();
    timerRef.current = setTimeout(() => setAnimState(null), ANIM_DURATION);
  }, [onNavigate]);

  // Drill OUT: user clicked the header scope label (Windows 7 style)
  const startDrillOut = useCallback(() => {
    if (drilldownStack.length < 2) {
      setDrilldownStack([]);
      return;
    }

    // The card we're coming back FROM — it appears instantly (source priority)
    const sourceOccId = drilldownStack[drilldownStack.length - 1];

    const newStack = drilldownStack.slice(0, -1);
    const previousOccId = newStack[newStack.length - 1];
    setDrilldownStack(newStack);

    onNavigate?.(previousOccId);

    const containerRect = containerRef?.current?.getBoundingClientRect();
    setAnimState({ direction: "out", targetOccId: previousOccId, sourceOccId, sourceRect: containerRect });

    _clearTimer();
    timerRef.current = setTimeout(() => setAnimState(null), ANIM_DURATION);
  }, [drilldownStack, onNavigate, containerRef]);

  // Peer navigation: move to adjacent sibling at the SAME depth (replaces top of stack)
  const navigatePeer = useCallback((occId) => {
    if (!occId) return;
    setDrilldownStack(prev => {
      if (prev.length === 0) return [occId];
      return [...prev.slice(0, -1), occId];
    });
    onNavigate?.(occId);
    setAnimState({ direction: "peer", targetOccId: occId });

    _clearTimer();
    timerRef.current = setTimeout(() => setAnimState(null), ANIM_DURATION);
  }, [onNavigate]);

  // Reset/prime the stack (used for folder-first navigation)
  const resetStack = useCallback((initial = []) => {
    setDrilldownStack(initial);
  }, []);

  useLayoutEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    animState,
    drilldownStack,
    startDrillDown,
    startDrillOut,
    navigatePeer,
    resetStack,
    canDrillOut: drilldownStack.length >= 2,
  };
}

// Compute per-card animation styles based on animState
export function getCardAnimStyle(occId, animState) {
  if (!animState) return {};
  const { direction, targetOccId, sourceOccId } = animState;

  if (occId === targetOccId) {
    if (direction === "in") {
      // Drill in — card zooms in dramatically from tiny
      return {
        animation: `drilldown-fade-in ${ANIM_DURATION}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        zIndex: 10,
        position: "relative",
      };
    }
    if (direction === "peer") {
      // Peer nav — new card crossfades in
      return {
        animation: `drilldown-fade-in ${Math.round(ANIM_DURATION * 0.55)}ms ease`,
        zIndex: 10,
        position: "relative",
      };
    }
    return {};
  }

  // Drill OUT — source card (the one we drilled into) snaps back instantly
  if (direction === "out" && occId === sourceOccId) {
    return {
      animation: `drilldown-source-return ${Math.round(ANIM_DURATION * 0.25)}ms ease`,
      zIndex: 10,
      position: "relative",
    };
  }

  // Sibling cards
  if (direction === "in") {
    // Siblings vanish immediately when drilling in
    return {
      opacity: 0,
      transition: `opacity ${Math.round(ANIM_DURATION * 0.3)}ms ease`,
      pointerEvents: "none",
    };
  }
  if (direction === "out") {
    // Other siblings fade back in after a slight delay (source card already visible)
    return {
      animation: `drilldown-return ${ANIM_DURATION}ms cubic-bezier(0.22, 1, 0.36, 1) ${Math.round(ANIM_DURATION * 0.15)}ms both`,
    };
  }
  if (direction === "peer") {
    return {
      opacity: 0,
      transition: `opacity ${Math.round(ANIM_DURATION * 0.3)}ms ease`,
      pointerEvents: "none",
    };
  }

  return {};
}
