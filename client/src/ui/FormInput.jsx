import React from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  TooltipProvider,
  TooltipHelp,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";

/**
 * schema:
 * {
 *   type:
 *     | "button"
 *     | "text-input"
 *     | "number-input"
 *     | "select"
 *     | "toggle"
 *     | "checkbox"
 *     | "slider",
 *
 *   label?: React.ReactNode,
 *   key?: string, // required for inputs/select/toggle/checkbox/slider
 *   description?: React.ReactNode,
 *   placeholder?: string,
 *   disabled?: boolean,
 *
 *   // number input options
 *   min?: number, max?: number, step?: number,
 *
 *   // select options
 *   options?: Array<{ value: string; label: React.ReactNode }>,
 *
 *   // slider options
 *   sliderMin?: number,        // fallback to min ?? 0
 *   sliderMax?: number,        // fallback to max ?? 100
 *   sliderStep?: number,       // fallback to step ?? 1
 *   showValue?: boolean,       // show numeric value to the right
 *   valueSuffix?: string,      // e.g. "px"
 *
 *   // button options
 *   buttonText?: React.ReactNode,
 *   buttonVariant?: string,
 *   buttonSize?: string,
 *   onAction?: (ctx: { value: any }) => void,
 *
 *   className?: string,
 * }
 */
export default function FormInput({ schema, value, onChange }) {
  const s = schema ?? {};
  const type = s.type;

  const update = (k, next) => {
    onChange?.({ ...(value ?? {}), [k]: next });
  };

  const safeNum = (raw, fallback = 0) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  const renderDesc = () =>
    s.description ? (
      <TooltipProvider>
        <div className="flex justify-end pt-[2px]">
          <TooltipHelp>
            {s.description}
          </TooltipHelp>
        </div>
      </TooltipProvider>
    ) : null;

  // BUTTON
  if (type === "button") {
    return (
      <div className={s.className}>
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant={s.buttonVariant ?? "default"}
            size={s.buttonSize ?? "sm"}
            disabled={s.disabled}
            onClick={() => s.onAction?.({ value })}
          >
            {s.label ?? "Action"}
          </Button>
          {renderDesc()}
        </div>
      </div>
    );
  }

  // everything else needs a key
  if (!s.key) {
    return (
      <div className="text-xs text-red-500">
        FormInput schema missing <code>key</code>
      </div>
    );
  }

  const current = value?.[s.key];

  // FormInput.jsx (PATCH)

  // TEXT
  if (type === "text-input") {
    return (
      <div className={`${s.className ?? ""} text-xs`}>
        {(s.label || s.description) && (
          <div style={{ minHeight: "18px" }} className="flex items-center justify-between gap-2">
            {s.label && <Label>{s.label}</Label>}
            {renderDesc()}
          </div>
        )}
        <Input
          type="text"
          value={current ?? ""}
          placeholder={s.placeholder}
          disabled={s.disabled}
          onChange={(e) => update(s.key, e.target.value)}

          // ✅ forward handlers from schema
          onKeyDown={s.onKeyDown}
          onBlur={s.onBlur}
          onFocus={s.onFocus}
        />
      </div>
    );
  }

  // NUMBER
  if (type === "number-input") {
    return (
      <div className={`${s.className ?? ""}`}>
        {(s.label || s.description) && (
          <div style={{ minHeight: "18px" }} className="flex items-center justify-between gap-2">
            {s.label && <Label>{s.label}</Label>}
            {renderDesc()}
          </div>
        )}
        <Input
          type="number"
          value={Number.isFinite(current) ? current : current ?? 0}
          min={s.min}
          max={s.max}
          step={s.step}
          placeholder={s.placeholder}
          disabled={s.disabled}
          onChange={(e) => update(s.key, safeNum(e.target.value, current ?? 0))}

          // ✅ forward handlers from schema
          onKeyDown={s.onKeyDown}
          onBlur={s.onBlur}
          onFocus={s.onFocus}
        />
      </div>
    );
  }



  // SELECT
  if (type === "select") {
    const opts = s.options ?? [];
    return (
      <div className={`${s.className ?? ""}`}>
        {(s.label || s.description) && (
          <div style={{ minHeight: "18px" }} className="flex items-center justify-between gap-2">
            {s.label && <Label>{s.label}</Label>}
            {renderDesc()}
          </div>
        )}
        <Select
          value={current ?? undefined}
          onValueChange={(v) => update(s.key, v)}
          disabled={s.disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={s.placeholder ?? "Select…"} />
          </SelectTrigger>
          <SelectContent {...(s.contentProps ?? {})}>
            {opts.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // TOGGLE (boolean)
  if (type === "toggle") {
    const checked = !!current;
    return (
      <div className={`${s.className ?? ""}`}>
        <div style={{ minHeight: "18px" }} className="flex items-center gap-2">
          {s.label && <Label>{s.label}</Label>}
          {renderDesc()}
        </div>
        <Switch
          checked={checked}
          disabled={s.disabled}
          onCheckedChange={(v) => update(s.key, !!v)}
        />
      </div>
    );
  }

  // CHECKBOX (boolean)
  if (type === "checkbox") {
    const checked = !!current;
    return (
      <div className={`${s.className ?? ""}`}>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={checked}
            disabled={s.disabled}
            onCheckedChange={(v) => update(s.key, !!v)}
          />
          <div className="flex items-center gap-2">
            {s.label && <Label>{s.label}</Label>}
            {renderDesc()}
          </div>
        </div>
      </div>
    );
  }

  // SLIDER (number)
  if (type === "slider") {
    const min = safeNum(s.sliderMin ?? s.min, 0);
    const max = safeNum(s.sliderMax ?? s.max, 100);
    const step = safeNum(s.sliderStep ?? s.step, 1);
    const showValue = s.showValue !== false; // default true
    const suffix = s.valueSuffix ?? "";

    const curNum =
      Number.isFinite(Number(current)) ? Number(current) : safeNum(current, min);

    const clamped = Math.min(max, Math.max(min, curNum));

    return (
      <div className={`${s.className ?? ""}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {s.label && <Label>{s.label}</Label>}
            {renderDesc()}
          </div>

          {showValue && (
            <div className="text-[11px] text-foregroundScale-2 tabular-nums">
              {clamped}
              {suffix}
            </div>
          )}
        </div>

        <div className="pt-2">
          <Slider
            disabled={s.disabled}
            min={min}
            max={max}
            step={step}
            value={[clamped]}
            onValueChange={(arr) => {
              const next = Array.isArray(arr) ? arr[0] : arr;
              update(s.key, safeNum(next, clamped));
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="text-xs text-red-500">
      Unknown FormInput type: <code>{String(type)}</code>
    </div>
  );
}
