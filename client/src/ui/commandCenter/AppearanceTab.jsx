// ui/commandCenter/AppearanceTab.jsx
// Global appearance settings: theme picker + CSS token customization

import React, { useState, useCallback } from "react";
import { Separator } from "@/components/ui/separator";
import { useTheme, SYSTEM_THEMES } from "../../helpers/useTheme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, RotateCcw } from "lucide-react";

const PRESET_TOKENS = [
  { name: "--text-primary", description: "Primary text" },
  { name: "--accent-blue", description: "Accent blue" },
  { name: "--accent-green", description: "Accent green" },
  { name: "--border-default", description: "Default border" },
  { name: "--input-bg", description: "Input background" },
];

const STORAGE_KEY = "moduli-token-overrides";

function getComputedTokenValue(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function applyTokenOverrides(overrides) {
  let tag = document.getElementById("moduli-token-overrides");
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "moduli-token-overrides";
    document.head.appendChild(tag);
  }
  const entries = Object.entries(overrides).filter(([, v]) => v.trim());
  if (entries.length === 0) {
    tag.textContent = "";
    return;
  }
  tag.textContent = `:root { ${entries.map(([k, v]) => `${k}: ${v};`).join(" ")} }`;
}

function ThemePicker({ theme, setTheme }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {SYSTEM_THEMES.map(t => {
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            title={t.description}
            className={[
              "flex-1 basis-[90px] min-w-[90px] p-2.5 pb-[9px] rounded-lg cursor-pointer flex flex-col items-start gap-1.5 transition-colors duration-100",
              active
                ? "border border-blue-500/80 bg-blue-500/10"
                : "border border-white/10 bg-white/[0.04] hover:bg-white/[0.07]",
            ].join(" ")}
          >
            <div className="flex gap-[3px] items-center">
              {t.swatches.map((hex, i) => (
                <span
                  key={i}
                  className="inline-block rounded-sm border border-white/10"
                  style={{ width: i === 0 ? 18 : 12, height: 12, background: hex }}
                />
              ))}
            </div>
            <span className={["text-[10px] font-mono leading-none", active ? "text-blue-300" : "text-white/55"].join(" ")}>
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();

  // Token overrides: { "--var-name": "value" }
  const [overrides, setOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
  });

  // Preset tokens: show current computed value as placeholder
  const [presetValues, setPresetValues] = useState(() => {
    const saved = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; } })();
    const vals = {};
    for (const { name } of PRESET_TOKENS) vals[name] = saved[name] || "";
    return vals;
  });

  // Custom token rows: [{ name, value }]
  const [customRows, setCustomRows] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const presetNames = new Set(PRESET_TOKENS.map(t => t.name));
      return Object.entries(saved)
        .filter(([k]) => !presetNames.has(k))
        .map(([name, value]) => ({ name, value }));
    } catch { return []; }
  });

  const save = useCallback(() => {
    const all = { ...presetValues };
    for (const row of customRows) {
      if (row.name.trim()) all[row.name.trim()] = row.value;
    }
    // Remove empty values
    for (const k of Object.keys(all)) { if (!all[k]?.trim()) delete all[k]; }
    setOverrides(all);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    applyTokenOverrides(all);
  }, [presetValues, customRows]);

  const reset = useCallback(() => {
    setPresetValues(Object.fromEntries(PRESET_TOKENS.map(t => [t.name, ""])));
    setCustomRows([]);
    setOverrides({});
    localStorage.removeItem(STORAGE_KEY);
    const tag = document.getElementById("moduli-token-overrides");
    if (tag) tag.textContent = "";
  }, []);

  return (
    <div className="p-4 flex flex-col gap-4 font-mono max-w-sm">
      {/* Theme */}
      <div>
        <h4 className="text-sm font-semibold text-foreground mb-0.5">Theme</h4>
        <p className="text-[10px] text-foregroundScale-2 mb-3">
          Sets the global color scheme for the entire workspace.
        </p>
        <ThemePicker theme={theme} setTheme={setTheme} />
      </div>

      <Separator />

      {/* CSS Token Editor */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-foreground">Token overrides</h4>
          <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 text-text-muted" onClick={reset}>
            <RotateCcw className="h-3 w-3" /> Reset
          </Button>
        </div>
        <p className="text-[10px] text-foregroundScale-2 mb-3 leading-relaxed">
          Override individual CSS tokens. Changes persist across reloads.
        </p>

        <div className="flex flex-col gap-1.5">
          {PRESET_TOKENS.map(({ name, description }) => (
            <div key={name} className="flex items-center gap-2">
              <span className="text-[10px] text-text-muted w-36 shrink-0 truncate" title={name}>{name}</span>
              <Input
                value={presetValues[name] || ""}
                onChange={(e) => setPresetValues(v => ({ ...v, [name]: e.target.value }))}
                placeholder={getComputedTokenValue(name) || "inherit"}
                className="h-6 text-[10px] flex-1"
              />
            </div>
          ))}

          {customRows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={row.name}
                onChange={(e) => setCustomRows(rows => rows.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                placeholder="--var-name"
                className="h-6 text-[10px] w-32 shrink-0"
              />
              <Input
                value={row.value}
                onChange={(e) => setCustomRows(rows => rows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                placeholder="value"
                className="h-6 text-[10px] flex-1"
              />
              <button
                onClick={() => setCustomRows(rows => rows.filter((_, j) => j !== i))}
                className="text-text-muted hover:text-danger shrink-0"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] gap-1 flex-1"
            onClick={() => setCustomRows(rows => [...rows, { name: "", value: "" }])}
          >
            <Plus className="h-3 w-3" /> Add token
          </Button>
          <Button
            size="sm"
            className="h-7 text-[10px] flex-1"
            onClick={save}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
