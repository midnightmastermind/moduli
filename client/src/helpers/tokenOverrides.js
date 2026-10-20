// helpers/tokenOverrides.js — the user's CSS token overrides (Command Center › Appearance ›
// Token overrides), kept per browser in localStorage. One writer for the app's boot and the
// Apply button; they were two copies of the same rule.
export const TOKEN_OVERRIDES_KEY = "moduli-token-overrides";
const TAG_ID = "moduli-token-overrides";

// !important: a skin sets tokens on `:root[data-skin=…]`, which outranks a bare `:root`, so a user
// override of a token the skin also sets (the viewer's, in Terminal) silently lost (2026-10-19).
export function tokenOverrideCss(overrides = {}) {
  const entries = Object.entries(overrides || {}).filter(([k, v]) => k && typeof v === "string" && v.trim());
  if (!entries.length) return "";
  return `:root { ${entries.map(([k, v]) => `${k}: ${v.trim()} !important;`).join(" ")} }`;
}

export function applyTokenOverrides(overrides) {
  if (typeof document === "undefined") return;
  let tag = document.getElementById(TAG_ID);
  if (!tag) { tag = document.createElement("style"); tag.id = TAG_ID; document.head.appendChild(tag); }
  tag.textContent = tokenOverrideCss(overrides);
}

export function loadTokenOverrides() {
  try { return JSON.parse(localStorage.getItem(TOKEN_OVERRIDES_KEY) || "{}") || {}; } catch { return {}; }
}
