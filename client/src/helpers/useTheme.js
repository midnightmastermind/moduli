// helpers/useTheme.js
// ============================================================
// Theme system — 3 system themes, persisted to localStorage.
// Applies data-theme attribute + dark class to <html> element.
// ============================================================

import { useState, useEffect } from "react";

export const SYSTEM_THEMES = [
  {
    id: "moduli-dark",
    label: "Moduli Dark",
    dark: true,
    description: "Deep navy workspace",
    swatches: ["#0c1220", "#141e30", "#1e3a5f"],
  },
  {
    id: "moduli-light",
    label: "Moduli Light",
    dark: false,
    description: "Clean light workspace",
    swatches: ["#f0f2f5", "#ffffff", "#2563eb"],
  },
  {
    id: "midnight",
    label: "Midnight",
    dark: true,
    description: "Pure black with violet accents",
    swatches: ["#09070f", "#130f1e", "#7c3aed"],
  },
];

const DEFAULT_THEME = "moduli-dark";

function applyTheme(id) {
  const theme = SYSTEM_THEMES.find(t => t.id === id) ?? SYSTEM_THEMES[0];
  const el = document.documentElement;
  el.setAttribute("data-theme", theme.id);
  if (theme.dark) {
    el.classList.add("dark");
  } else {
    el.classList.remove("dark");
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem("moduli-theme") || DEFAULT_THEME;
  });

  // Apply on mount and whenever theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = (id) => {
    localStorage.setItem("moduli-theme", id);
    setThemeState(id);
  };

  return { theme, setTheme, themes: SYSTEM_THEMES };
}
