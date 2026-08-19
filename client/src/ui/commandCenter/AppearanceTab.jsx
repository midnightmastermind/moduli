// ui/commandCenter/AppearanceTab.jsx
// Global appearance settings: theme picker + CSS token customization

import React, { useState, useCallback } from "react";
import { Separator } from "@/components/ui/separator";
import { useTheme, SYSTEM_THEMES } from "../../helpers/useTheme";
import { useGridActions } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { SKINS, resolveSkinId, getSkin } from "../../helpers/skins";
import { readStoredSkin, writeStoredSkin, applySkin } from "../../hooks/useSkin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, RotateCcw, ChevronRight } from "lucide-react";
import StyleEditor from "../StyleEditor";
import { typeKeyFor } from "../../helpers/StyleHelpers";

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

// ── STYLE BY OCCURRENCE TYPE ───────────────────────────────────────────────
// User, 2026-08-19: *"maybe by occurance type … so i can change the lettering
// all at once."*
//
// This is NOT a second cascade. The cascade already existed (Grid → Panel →
// Page → Container → Instance, `StyleHelpers.resolveStyleCascade`, with a
// per-kind field whitelist and an editor mounted at six sites). What it could
// not express was "every doc container", because every level of it is a
// PLACEMENT — so this adds one level to the existing walk and reuses the same
// `StyleEditor` component the other six sites use.
//
// THE TYPE LIST IS READ FROM THE GRID, not hardcoded. A grid that has no canvas
// containers should not offer to style them, and a container kind added next
// year must appear here without anyone remembering to add it. Counts are shown
// because "container/board · 73" is what tells you the size of what you are
// about to change.
function TypeStylePanel() {
  const { state, dispatch, socket } = useGridActions();
  const grid = state?.grid;
  const gridId = state?.gridId;
  const [openKey, setOpenKey] = useState(null);

  const types = React.useMemo(() => {
    const tally = new Map();
    for (const m of state?.modules || []) {
      const key = typeKeyFor(m);
      if (!key) continue;
      tally.set(key, (tally.get(key) || 0) + 1);
    }
    return [...tally.entries()]
      .map(([key, count]) => ({ key, count, role: key.split("/")[0] }))
      .sort((a, b) => b.count - a.count);
  }, [state?.modules]);

  const typeStyles = grid?.meta?.typeStyles || {};

  const write = useCallback((key, next) => {
    if (!gridId) return;
    const all = { ...(grid?.meta?.typeStyles || {}) };
    // An empty style is REMOVED rather than stored as {}. A key that exists but
    // contributes nothing still shows as a row in every cascade view, which
    // reads as "something is set here" when nothing is.
    if (next && Object.values(next).some(v => v != null && v !== "")) all[key] = next;
    else delete all[key];
    const meta = { ...(grid?.meta || {}), typeStyles: all };
    CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { meta }, emit: true });
  }, [grid, gridId, dispatch, socket]);

  if (!types.length) {
    return <p className="text-[10px] text-text-faint">This grid has no modules yet.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {types.map(({ key, count, role }) => {
        const open = openKey === key;
        const set = !!typeStyles[key];
        return (
          <div key={key} className="border border-border-subtle rounded">
            <button
              onClick={() => setOpenKey(open ? null : key)}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-left hover:bg-accent/50"
            >
              <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
              <span className="text-[11px] font-mono text-foreground flex-1">{key}</span>
              {set && <span className="text-[9px] text-accent-blue-text">styled</span>}
              <span className="text-[10px] text-text-faint tabular-nums">{count}</span>
            </button>
            {open && (
              <div className="px-2 pb-2">
                <StyleEditor
                  kind={role}
                  label={`Every ${key}`}
                  inheritLabel="Grid default"
                  styleMode={set ? "own" : "inherit"}
                  ownStyle={typeStyles[key] || null}
                  onStyleModeChange={(mode) => write(key, mode === "own" ? (typeStyles[key] || {}) : null)}
                  onOwnStyleChange={(next) => write(key, next)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── SKIN PICKER ────────────────────────────────────────────────────────────
// The one "what does my grid look like" control. A skin is chosen PER GRID
// (user, 2026-08-19), which the theme picker below could never express — it
// writes localStorage, so a pick restyled every grid on the machine and did not
// follow the user to another device.
//
// The account-wide value is still written, as the fallback for any grid that
// has not chosen one. So picking a skin here answers both "this grid" and
// "grids I have not decided about yet".
function SkinPicker() {
  const { state, dispatch, socket } = useGridActions();
  const grid = state?.grid;
  const gridId = state?.gridId;
  const activeId = resolveSkinId(grid, readStoredSkin());

  const pick = useCallback((id) => {
    applySkin(getSkin(id));          // paint immediately; the echo confirms it
    writeStoredSkin(id);
    if (gridId) {
      const meta = { ...(grid?.meta || {}), skin: id };
      CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { meta }, emit: true });
    }
  }, [grid, gridId, dispatch, socket]);

  return (
    <div className="flex gap-2 flex-wrap">
      {SKINS.map(sk => {
        const active = activeId === sk.id;
        return (
          <button
            key={sk.id}
            onClick={() => pick(sk.id)}
            title={sk.description}
            className={`flex flex-col gap-1 p-2 rounded border text-left transition-colors ${
              active ? "border-accent-blue bg-accent" : "border-border-subtle hover:bg-accent/50"
            }`}
            style={{ minWidth: 128 }}
          >
            <span className="flex gap-1">
              {sk.swatches.map(c => (
                <span key={c} style={{ background: c, width: 16, height: 16, borderRadius: 3, display: "inline-block" }} />
              ))}
            </span>
            <span className="text-[11px] font-semibold text-foreground">{sk.label}</span>
            <span className="text-[9px] text-text-faint leading-tight">{sk.description}</span>
            {sk.theme && (
              <span className="text-[9px] text-text-faint italic">pins the {sk.theme} theme</span>
            )}
          </button>
        );
      })}
    </div>
  );
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
        <h4 className="text-sm font-semibold text-foreground mb-0.5">Skin</h4>
        <p className="text-[10px] text-foregroundScale-2 mb-2 leading-relaxed">
          The whole look of <strong>this grid</strong> — wallpaper, panel material and lettering.
          Stored on the grid, so it follows you to another device and other grids keep their own.
        </p>
        <SkinPicker />
        <Separator className="my-4" />
        <h4 className="text-sm font-semibold text-foreground mb-0.5">Theme</h4>
        <p className="text-[10px] text-foregroundScale-2 mb-3">
          Sets the global color scheme for the entire workspace.
        </p>
        <ThemePicker theme={theme} setTheme={setTheme} />
      </div>

      <Separator />

      {/* CSS Token Editor */}
      <div>
        <h4 className="text-sm font-semibold text-foreground mb-0.5">Style by occurrence type</h4>
        <p className="text-[10px] text-foregroundScale-2 mb-2 leading-relaxed">
          One entry per <span className="font-mono">role/kind</span>, applied to every module of
          that type wherever it sits. It is a <strong>default</strong> — a panel, a container or a
          single placement still overrides it. The count is how many modules it reaches.
        </p>
        <TypeStylePanel />
      </div>

      <Separator />

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
