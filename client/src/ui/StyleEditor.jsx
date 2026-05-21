// StyleEditor.jsx — Reusable cascading style editor
// ============================================================
// Shows inherit/own toggle + style controls when mode=own.
// Now kind-aware: pass `kind` ("grid" | "panel" | "page" |
// "container" | "instance" | "textblock" | "artifact") and the
// editor renders the field set tailored to that entity type
// (per STYLE_FIELDS_BY_KIND in StyleHelpers.js).
//
// Optional cascade view: pass `cascade` (output of
// `resolveStyleCascade` from StyleHelpers) and the editor renders a
// read-only list of every ancestor contribution + the resolved style.
// Lets the user see what's coming down from where before deciding to
// override.
//
// Props:
//   styleMode: "inherit" | "own"
//   ownStyle: { bg, textColor, ..., fontFamily, lineHeight, borderColor, ... }
//   onStyleModeChange: (mode) => void
//   onOwnStyleChange: (style) => void
//   label: string (section label)
//   inheritLabel: string (what it inherits from, e.g. "Panel")
//   kind: which entity type — drives the field filter
//   cascade: optional { levels, resolved } from resolveStyleCascade
//   customCss / onCustomCssChange / moduleId: scoped CSS textarea
// ============================================================

import React, { useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_ENTITY_STYLE, STYLE_FIELDS_BY_KIND } from "../helpers/StyleHelpers";

const PRESET_COLORS = [
  { value: null, label: "None", swatch: "transparent" },
  { value: "rgba(59,130,246,0.15)", label: "Blue", swatch: "rgba(59,130,246,0.5)" },
  { value: "rgba(34,197,94,0.15)", label: "Green", swatch: "rgba(34,197,94,0.5)" },
  { value: "rgba(168,85,247,0.15)", label: "Purple", swatch: "rgba(168,85,247,0.5)" },
  { value: "rgba(249,115,22,0.15)", label: "Orange", swatch: "rgba(249,115,22,0.5)" },
  { value: "rgba(236,72,153,0.15)", label: "Pink", swatch: "rgba(236,72,153,0.5)" },
  { value: "rgba(234,179,8,0.15)", label: "Yellow", swatch: "rgba(234,179,8,0.5)" },
  { value: "rgba(20,184,166,0.15)", label: "Teal", swatch: "rgba(20,184,166,0.5)" },
  { value: "rgba(239,68,68,0.15)", label: "Red", swatch: "rgba(239,68,68,0.5)" },
];

const TEXT_COLORS = [
  { value: null, label: "Default" },
  { value: "#ffffff", label: "White" },
  { value: "#94a3b8", label: "Slate" },
  { value: "#60a5fa", label: "Blue" },
  { value: "#4ade80", label: "Green" },
  { value: "#c084fc", label: "Purple" },
  { value: "#fb923c", label: "Orange" },
  { value: "#f472b6", label: "Pink" },
  { value: "#fbbf24", label: "Yellow" },
];

const FONT_FAMILIES = [
  { value: null, label: "Default" },
  { value: "var(--font-mono)",       label: "Mono (system)" },
  { value: "Inter, sans-serif",      label: "Inter" },
  { value: "Georgia, serif",         label: "Serif" },
  { value: "system-ui, sans-serif",  label: "System sans" },
  { value: "'JetBrains Mono', monospace", label: "JetBrains Mono" },
];

const FONT_SIZES = [
  { value: null, label: "Default" },
  { value: "10px", label: "10px" },
  { value: "11px", label: "11px" },
  { value: "12px", label: "12px" },
  { value: "13px", label: "13px" },
  { value: "14px", label: "14px" },
  { value: "16px", label: "16px" },
  { value: "18px", label: "18px" },
  { value: "20px", label: "20px" },
];

const FONT_WEIGHTS = [
  { value: null, label: "Default" },
  { value: "300", label: "Light (300)" },
  { value: "400", label: "Normal (400)" },
  { value: "500", label: "Medium (500)" },
  { value: "600", label: "Semibold (600)" },
  { value: "700", label: "Bold (700)" },
];

const LINE_HEIGHTS = [
  { value: null, label: "Default" },
  { value: "1",    label: "1.0" },
  { value: "1.2",  label: "1.2" },
  { value: "1.4",  label: "1.4" },
  { value: "1.6",  label: "1.6" },
  { value: "1.8",  label: "1.8" },
];

const BORDER_WIDTHS = [
  { value: null, label: "Default" },
  { value: "0",   label: "None" },
  { value: "1px", label: "1px" },
  { value: "2px", label: "2px" },
  { value: "3px", label: "3px" },
  { value: "4px", label: "4px" },
];

const BORDER_STYLES = [
  { value: null, label: "Default" },
  { value: "solid",  label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
  { value: "double", label: "Double" },
  { value: "none",   label: "None" },
];

const PADDING_OPTIONS = [
  { value: null, label: "Default" },
  { value: "0px", label: "None" },
  { value: "4px", label: "4px" },
  { value: "8px", label: "8px" },
  { value: "12px", label: "12px" },
  { value: "16px", label: "16px" },
];

const BORDER_RADIUS_OPTIONS = [
  { value: null, label: "Default" },
  { value: "0px", label: "None" },
  { value: "4px", label: "4px" },
  { value: "8px", label: "8px" },
  { value: "12px", label: "12px" },
  { value: "16px", label: "16px" },
];

// Renders one row of the cascade view: shows the level's contribution
// as a compact summary so the user can see what each ancestor is
// pushing down. Read-only.
function CascadeRow({ level }) {
  const { label, contribution } = level;
  const summary = Object.entries(contribution)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "string" && v.length > 24 ? v.slice(0, 21) + "…" : v}`)
    .join(" · ");
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 8, padding: "3px 6px",
      borderLeft: "2px solid var(--accent-blue-border)",
      background: "var(--input-bg)", borderRadius: 3,
      fontSize: 10, fontFamily: "monospace",
    }}>
      <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={summary}>
        {summary || "—"}
      </span>
    </div>
  );
}

export default function StyleEditor({
  styleMode = "inherit",
  ownStyle,
  onStyleModeChange,
  onOwnStyleChange,
  label = "Style",
  inheritLabel = "Parent",
  customCss = "",
  onCustomCssChange,
  moduleId,
  kind = "container",
  cascade = null,
}) {
  const style = ownStyle || { ...DEFAULT_ENTITY_STYLE };
  const fields = STYLE_FIELDS_BY_KIND[kind] || STYLE_FIELDS_BY_KIND.container;
  const fieldSet = new Set(fields);
  const show = (k) => fieldSet.has(k);

  const updateField = useCallback((key, value) => {
    onOwnStyleChange?.({ ...style, [key]: value });
  }, [style, onOwnStyleChange]);

  const isOwn = styleMode === "own";

  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-foregroundScale-2">{label}</h4>
        <Select value={styleMode} onValueChange={onStyleModeChange}>
          <SelectTrigger className="h-6 text-[10px] w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Inherit</SelectItem>
            <SelectItem value="own">Own</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!isOwn && (
        <p className="text-[10px] text-foregroundScale-2/80">
          Inherits style from {inheritLabel}.
        </p>
      )}

      {/* Cascade view — shows what every ancestor is pushing down so
          the user can see WHY this entity looks the way it does
          before deciding to override. Read-only; click any row's
          → toggle in a future revision to disable that level. */}
      {cascade && cascade.levels.length > 0 && (
        <div className="mb-2">
          <Label className="text-[10px] text-muted-foreground mb-1">Inherited cascade</Label>
          <div className="flex flex-col gap-1">
            {cascade.levels.map((lvl, i) => (
              <CascadeRow key={`${lvl.source}-${i}`} level={lvl} />
            ))}
          </div>
        </div>
      )}

      {isOwn && (
        <div className="space-y-2.5 mt-1">
          {/* Background Color */}
          {show("bg") && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Background</Label>
            <div className="flex flex-wrap gap-1 mt-1 items-center">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  className="w-5 h-5 rounded border border-border hover:ring-1 hover:ring-ring transition-all"
                  style={{
                    backgroundColor: c.swatch,
                    outline: style.bg === c.value ? "2px solid var(--accent-blue)" : "none",
                    outlineOffset: 1,
                  }}
                  title={c.label}
                  onClick={() => updateField("bg", c.value)}
                />
              ))}
              <input
                type="color"
                value={(typeof style.bg === "string" && /^#[0-9a-fA-F]{6}$/.test(style.bg)) ? style.bg : "#222428"}
                onChange={(e) => updateField("bg", e.target.value)}
                title="Pick custom color"
                style={{ width: 22, height: 22, padding: 0, border: "1px solid var(--border-default)", borderRadius: 4, background: "transparent", cursor: "pointer" }}
              />
            </div>
            <Input
              type="text"
              value={style.bg || ""}
              onChange={(e) => updateField("bg", e.target.value || null)}
              placeholder="Custom: rgba(...) or #hex"
              className="h-6 text-[10px] mt-1"
            />
          </div>
          )}

          {/* Text Color */}
          {show("textColor") && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Text Color</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  className="w-5 h-5 rounded border border-border hover:ring-1 hover:ring-ring transition-all"
                  style={{
                    backgroundColor: c.value || "transparent",
                    outline: style.textColor === c.value ? "2px solid var(--accent-blue)" : "none",
                    outlineOffset: 1,
                  }}
                  title={c.label}
                  onClick={() => updateField("textColor", c.value)}
                />
              ))}
            </div>
          </div>
          )}

          {/* Font Family */}
          {show("fontFamily") && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Font Family</Label>
            <Select value={style.fontFamily || "__default"} onValueChange={(v) => updateField("fontFamily", v === "__default" ? null : v)}>
              <SelectTrigger className="h-6 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_FAMILIES.map((o) => (
                  <SelectItem key={o.label} value={o.value || "__default"}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}

          {/* Font Size */}
          {show("fontSize") && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Font Size</Label>
            <Select value={style.fontSize || "__default"} onValueChange={(v) => updateField("fontSize", v === "__default" ? null : v)}>
              <SelectTrigger className="h-6 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_SIZES.map((o) => (
                  <SelectItem key={o.label} value={o.value || "__default"}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}

          {/* Font Weight */}
          {show("fontWeight") && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Font Weight</Label>
            <Select value={style.fontWeight || "__default"} onValueChange={(v) => updateField("fontWeight", v === "__default" ? null : v)}>
              <SelectTrigger className="h-6 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_WEIGHTS.map((o) => (
                  <SelectItem key={o.label} value={o.value || "__default"}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}

          {/* Line Height */}
          {show("lineHeight") && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Line Height</Label>
            <Select value={style.lineHeight || "__default"} onValueChange={(v) => updateField("lineHeight", v === "__default" ? null : v)}>
              <SelectTrigger className="h-6 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINE_HEIGHTS.map((o) => (
                  <SelectItem key={o.label} value={o.value || "__default"}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}

          {/* Border (shorthand — kept for back-compat seeds) */}
          {show("border") && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Border (shorthand)</Label>
            <Input
              type="text"
              value={style.border || ""}
              onChange={(e) => updateField("border", e.target.value || null)}
              placeholder="e.g. 1px solid #444"
              className="h-6 text-[10px]"
            />
          </div>
          )}

          {/* Granular border trio */}
          {show("borderColor") && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Border Color</Label>
            <Input
              type="text"
              value={style.borderColor || ""}
              onChange={(e) => updateField("borderColor", e.target.value || null)}
              placeholder="#444 or rgba(...)"
              className="h-6 text-[10px]"
            />
          </div>
          )}
          {show("borderWidth") && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Border Width</Label>
            <Select value={style.borderWidth || "__default"} onValueChange={(v) => updateField("borderWidth", v === "__default" ? null : v)}>
              <SelectTrigger className="h-6 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BORDER_WIDTHS.map((o) => (
                  <SelectItem key={o.label} value={o.value || "__default"}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}
          {show("borderStyle") && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Border Style</Label>
            <Select value={style.borderStyle || "__default"} onValueChange={(v) => updateField("borderStyle", v === "__default" ? null : v)}>
              <SelectTrigger className="h-6 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BORDER_STYLES.map((o) => (
                  <SelectItem key={o.label} value={o.value || "__default"}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}

          {/* Border Radius */}
          {show("borderRadius") && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Border Radius</Label>
            <Select value={style.borderRadius || "__default"} onValueChange={(v) => updateField("borderRadius", v === "__default" ? null : v)}>
              <SelectTrigger className="h-6 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BORDER_RADIUS_OPTIONS.map((o) => (
                  <SelectItem key={o.label} value={o.value || "__default"}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}

          {/* Opacity */}
          {show("opacity") && (
          <div>
            <Label className="text-[10px] text-muted-foreground">
              Opacity: {style.opacity != null ? style.opacity : "default"}
            </Label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={style.opacity ?? 1}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                updateField("opacity", v === 1 ? null : v);
              }}
              className="w-full h-4 accent-blue-500"
            />
          </div>
          )}

          {/* Padding */}
          {show("padding") && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Padding</Label>
            <Select value={style.padding || "__default"} onValueChange={(v) => updateField("padding", v === "__default" ? null : v)}>
              <SelectTrigger className="h-6 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PADDING_OPTIONS.map((o) => (
                  <SelectItem key={o.label} value={o.value || "__default"}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}

          {/* Reset */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-[10px] h-6 w-full"
            onClick={() => onOwnStyleChange?.({ ...DEFAULT_ENTITY_STYLE })}
          >
            Reset All
          </Button>
        </div>
      )}

      {/* CS6a — Custom CSS (always visible, scoped to this module) */}
      {onCustomCssChange && (
        <div className="mt-3 pt-2 border-t border-border-subtle">
          <Label className="text-[10px] text-muted-foreground">
            Custom CSS {moduleId && <span style={{ color: "var(--text-faint)" }}>(.mod-{String(moduleId).slice(-6)})</span>}
          </Label>
          <textarea
            value={customCss || ""}
            onChange={(e) => onCustomCssChange(e.target.value)}
            placeholder={`.mod-${moduleId || "id"} h2 { color: red; }`}
            rows={4}
            style={{
              width: "100%",
              marginTop: 4,
              fontSize: 10,
              fontFamily: "monospace",
              background: "var(--input-bg)",
              border: "1px solid var(--input-border)",
              borderRadius: 4,
              color: "var(--text-primary)",
              padding: "4px 6px",
              resize: "vertical",
              outline: "none",
            }}
          />
        </div>
      )}
    </div>
  );
}
