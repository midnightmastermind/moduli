// StyleEditor.jsx — Reusable cascading style editor
// ============================================================
// Shows inherit/own toggle + style controls when mode=own.
// Props:
//   styleMode: "inherit" | "own"
//   ownStyle: { bg, textColor, border, borderRadius, opacity, fontSize, padding }
//   onStyleModeChange: (mode) => void
//   onOwnStyleChange: (style) => void
//   label: string (section label)
//   inheritLabel: string (what it inherits from, e.g. "Panel")
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
import { DEFAULT_ENTITY_STYLE } from "../helpers/StyleHelpers";

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

const FONT_SIZES = [
  { value: null, label: "Default" },
  { value: "10px", label: "10px" },
  { value: "11px", label: "11px" },
  { value: "12px", label: "12px" },
  { value: "13px", label: "13px" },
  { value: "14px", label: "14px" },
  { value: "16px", label: "16px" },
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
}) {
  const style = ownStyle || { ...DEFAULT_ENTITY_STYLE };

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

      {isOwn && (
        <div className="space-y-2.5 mt-1">
          {/* Background Color */}
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
              {/* Native color picker — same data path as the presets + text
                  input. Writes #rrggbb directly. */}
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

          {/* Text Color */}
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

          {/* Border */}
          <div>
            <Label className="text-[10px] text-muted-foreground">Border</Label>
            <Input
              type="text"
              value={style.border || ""}
              onChange={(e) => updateField("border", e.target.value || null)}
              placeholder="e.g. 1px solid #444"
              className="h-6 text-[10px]"
            />
          </div>

          {/* Border Radius */}
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

          {/* Opacity */}
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

          {/* Font Size */}
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

          {/* Padding */}
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
