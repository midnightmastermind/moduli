// hooks/useAnimations.js
// ============================================================
// FLIP Animation System for undo/redo and move animations
// FLIP = First, Last, Invert, Play
//
// Works alongside Pragmatic DnD's flourish package which
// provides flash effects on drop.
// ============================================================

import { useCallback, useRef } from "react";
import { triggerPostMoveFlash } from "@atlaskit/pragmatic-drag-and-drop-flourish/trigger-post-move-flash";

// Animation duration (can be adjusted)
const ANIMATION_DURATION = 250; // ms

/**
 * useAnimations - Hook for FLIP-based animations
 *
 * Provides methods to:
 * - Capture element positions before state changes
 * - Animate elements to new positions after state changes
 * - Animate elements from center (for loading screen)
 * - Flash elements on drop (via flourish)
 */
export function useAnimations() {
  // Store captured positions: Map<occurrenceId, DOMRect>
  const positionsRef = useRef(new Map());

  /**
   * Capture current positions of elements by their occurrence ID
   * Call this BEFORE state changes
   */
  const capturePositions = useCallback((occurrenceIds = []) => {
    const positions = new Map();

    occurrenceIds.forEach((id) => {
      // Find element by data attribute
      const el = document.querySelector(`[data-occurrence-id="${id}"]`);
      if (el) {
        const rect = el.getBoundingClientRect();
        positions.set(id, {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          el: el, // Keep reference for animation
        });
      }
    });

    positionsRef.current = positions;
    return positions;
  }, []);

  /**
   * Capture ALL occurrence positions on the page
   * Useful for loading animations
   */
  const captureAllPositions = useCallback(() => {
    const positions = new Map();
    const elements = document.querySelectorAll("[data-occurrence-id]");

    elements.forEach((el) => {
      const id = el.getAttribute("data-occurrence-id");
      if (id) {
        const rect = el.getBoundingClientRect();
        positions.set(id, {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          el: el,
        });
      }
    });

    positionsRef.current = positions;
    return positions;
  }, []);

  /**
   * Animate elements from their old positions to new positions (FLIP)
   * Call this AFTER state changes and render
   *
   * @param {string[]} occurrenceIds - IDs of elements to animate
   * @returns {Promise} - Resolves when all animations complete
   */
  const animateToNewPositions = useCallback((occurrenceIds = []) => {
    return new Promise((resolve) => {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        const oldPositions = positionsRef.current;
        let animatingCount = 0;
        let resolved = false;

        const checkDone = () => {
          if (!resolved && animatingCount === 0) {
            resolved = true;
            resolve();
          }
        };

        occurrenceIds.forEach((id) => {
          const oldPos = oldPositions.get(id);
          if (!oldPos) return;

          // Find element in its NEW position
          const el = document.querySelector(`[data-occurrence-id="${id}"]`);
          if (!el) return;

          const newRect = el.getBoundingClientRect();
          const newPos = { x: newRect.left, y: newRect.top };

          // Calculate delta (INVERT)
          const deltaX = oldPos.x - newPos.x;
          const deltaY = oldPos.y - newPos.y;

          // Skip if no movement needed (less than 2px)
          if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return;

          animatingCount++;

          // Apply inverted transform (element appears in old position)
          el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
          el.style.transition = "none";

          // Force reflow
          el.offsetHeight;

          // Apply transition and remove transform (PLAY)
          el.style.transition = `transform ${ANIMATION_DURATION}ms ease-out`;
          el.style.transform = "";

          // Cleanup after animation
          const cleanup = () => {
            el.style.transition = "";
            el.style.transform = "";
            el.removeEventListener("transitionend", cleanup);
            animatingCount--;
            checkDone();
          };

          el.addEventListener("transitionend", cleanup);

          // Fallback cleanup if transitionend doesn't fire
          setTimeout(() => {
            if (el.style.transition) {
              cleanup();
            }
          }, ANIMATION_DURATION + 50);
        });

        // If nothing to animate, resolve immediately
        checkDone();
      });
    });
  }, []);

  /**
   * Flash an element after a move (uses Pragmatic DnD flourish)
   *
   * @param {string} occurrenceId - ID of element to flash
   */
  const flashElement = useCallback((occurrenceId) => {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-occurrence-id="${occurrenceId}"]`);
      if (el) {
        triggerPostMoveFlash(el);
        // Also apply a yellow background highlight that fades out over 900ms
        el.classList.remove("undo-flash"); // reset if already playing
        void el.offsetWidth; // force reflow to restart animation
        el.classList.add("undo-flash");
        el.addEventListener("animationend", () => el.classList.remove("undo-flash"), { once: true });
      }
    });
  }, []);

  /**
   * Animate elements from center of screen to their positions
   * For loading screen effect
   *
   * @returns {Promise} - Resolves when all animations complete
   */
  const animateFromCenter = useCallback(() => {
    return new Promise((resolve) => {
      // Get center of viewport
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;

      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        const elements = document.querySelectorAll("[data-occurrence-id]");
        let animatingCount = elements.length;

        if (animatingCount === 0) {
          resolve();
          return;
        }

        elements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const targetX = rect.left + rect.width / 2;
          const targetY = rect.top + rect.height / 2;

          // Calculate delta from center
          const deltaX = centerX - targetX;
          const deltaY = centerY - targetY;

          // Stagger delay based on distance from center
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
          const delay = (distance / maxDistance) * 150; // Max 150ms stagger

          // Start from center (INVERT)
          el.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(0.85)`;
          el.style.opacity = "0";
          el.style.transition = "none";

          // Force reflow
          el.offsetHeight;

          // Animate to final position after delay (PLAY)
          setTimeout(() => {
            el.style.transition = `transform ${ANIMATION_DURATION}ms ease-out, opacity ${ANIMATION_DURATION * 0.7}ms ease-out`;
            el.style.transform = "";
            el.style.opacity = "";

            // Cleanup after animation
            const cleanup = () => {
              el.style.transition = "";
              el.style.transform = "";
              el.style.opacity = "";
              animatingCount--;
              if (animatingCount === 0) {
                resolve();
              }
              el.removeEventListener("transitionend", cleanup);
            };

            el.addEventListener("transitionend", cleanup);

            // Fallback cleanup
            setTimeout(() => {
              if (el.style.transition) {
                cleanup();
              }
            }, ANIMATION_DURATION + delay + 50);
          }, delay);
        });
      });
    });
  }, []);

  /**
   * Handle undo animation for moves - captures, waits for render, animates
   *
   * @param {Array} moveOps - Array of { occurrenceId, from, to } operations
   * @returns {Promise} - Resolves when animations complete
   */
  const animateUndoMoves = useCallback(
    (moveOps) => {
      if (!moveOps || moveOps.length === 0) return Promise.resolve();

      // Get occurrence IDs that will be moving
      const occurrenceIds = moveOps.map((op) => op.occurrenceId);

      // Capture current positions BEFORE state changes
      capturePositions(occurrenceIds);

      // Return a promise that resolves after animation
      // The caller should trigger state update, then call this after render
      return new Promise((resolve) => {
        // Use a longer delay to ensure React has rendered the new positions
        setTimeout(() => {
          animateToNewPositions(occurrenceIds).then(() => {
            // Flash each element after animation
            occurrenceIds.forEach(flashElement);
            resolve();
          });
        }, 100);
      });
    },
    [capturePositions, animateToNewPositions, flashElement]
  );

  return {
    capturePositions,
    captureAllPositions,
    animateToNewPositions,
    animateFromCenter,
    animateUndoMoves,
    flashElement,
    ANIMATION_DURATION,
  };
}

export default useAnimations;
