// uid.js - Simple unique ID generator

/**
 * Generates a random unique ID
 * @returns {string} A unique identifier
 */
export function uid() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
