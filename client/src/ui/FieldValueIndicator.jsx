// ui/FieldValueIndicator.jsx
// ============================================================
// Visual indicators for field value changes
// Shows arrows for increases/decreases and = for new values
// ============================================================

import React, { useState, useEffect, useRef } from "react";
import { ArrowUp, ArrowDown, Equal, TrendingUp, TrendingDown } from "lucide-react";

/**
 * FieldValueIndicator - Shows visual feedback for field value changes
 *
 * @param {string} type - "increase" | "decrease" | "set" | "neutral"
 * @param {boolean} show - Whether to show the indicator
 * @param {number} duration - How long to show (ms), 0 = permanent
 * @param {string} size - "sm" | "md"
 */
export function FieldValueIndicator({
  type = "neutral",
  show = true,
  duration = 2000,
  size = "sm",
  className = "",
}) {
  const [visible, setVisible] = useState(show);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (show && duration > 0) {
      setVisible(true);
      timeoutRef.current = setTimeout(() => setVisible(false), duration);
      return () => clearTimeout(timeoutRef.current);
    }
    setVisible(show);
  }, [show, duration]);

  if (!visible) return null;

  const sizeClasses = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
  };

  const config = {
    increase: {
      icon: ArrowUp,
      color: "text-green-400",
      bg: "bg-green-500/20",
      label: "Increased",
    },
    decrease: {
      icon: ArrowDown,
      color: "text-red-400",
      bg: "bg-red-500/20",
      label: "Decreased",
    },
    set: {
      icon: Equal,
      color: "text-blue-400",
      bg: "bg-blue-500/20",
      label: "Set",
    },
    neutral: {
      icon: null,
      color: "text-muted-foreground",
      bg: "bg-muted",
      label: "",
    },
  };

  const { icon: Icon, color, bg, label } = config[type] || config.neutral;

  if (!Icon) return null;

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full p-0.5 ${bg} ${color} ${className} animate-in fade-in zoom-in duration-200`}
      title={label}
    >
      <Icon className={sizeClasses[size]} />
    </span>
  );
}

/**
 * FieldValueWithIndicator - Wraps a field value display with change indicator
 *
 * @param {any} value - Current value
 * @param {any} previousValue - Previous value (for comparison)
 * @param {React.ReactNode} children - The value display content
 */
export function FieldValueWithIndicator({
  value,
  previousValue,
  showChange = true,
  duration = 2000,
  children,
  className = "",
}) {
  const [changeType, setChangeType] = useState(null);
  const prevValueRef = useRef(previousValue);

  useEffect(() => {
    // Compare values when they change
    if (previousValue !== undefined && previousValue !== value) {
      if (typeof value === "number" && typeof previousValue === "number") {
        setChangeType(value > previousValue ? "increase" : "decrease");
      } else {
        setChangeType("set");
      }

      // Clear after duration
      if (duration > 0) {
        const timeout = setTimeout(() => setChangeType(null), duration);
        return () => clearTimeout(timeout);
      }
    }
  }, [value, previousValue, duration]);

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {children}
      {showChange && changeType && (
        <FieldValueIndicator type={changeType} show duration={0} size="sm" />
      )}
    </span>
  );
}

/**
 * AnimatedValue - Shows value with animation on change
 */
export function AnimatedValue({
  value,
  previousValue,
  format = (v) => v,
  className = "",
}) {
  const [displayValue, setDisplayValue] = useState(value);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (previousValue !== undefined && previousValue !== value) {
      setAnimating(true);
      setDisplayValue(value);

      const timeout = setTimeout(() => setAnimating(false), 300);
      return () => clearTimeout(timeout);
    } else {
      setDisplayValue(value);
    }
  }, [value, previousValue]);

  const changeType =
    typeof value === "number" && typeof previousValue === "number"
      ? value > previousValue
        ? "increase"
        : value < previousValue
        ? "decrease"
        : null
      : previousValue !== undefined && previousValue !== value
      ? "set"
      : null;

  const colorClass =
    changeType === "increase"
      ? "text-green-400"
      : changeType === "decrease"
      ? "text-red-400"
      : changeType === "set"
      ? "text-blue-400"
      : "";

  return (
    <span
      className={`inline-flex items-center gap-1 ${className} ${animating ? colorClass : ""} transition-colors duration-300`}
    >
      <span className={animating ? "animate-pulse" : ""}>
        {format(displayValue)}
      </span>
      {animating && changeType && (
        <FieldValueIndicator type={changeType} show duration={2000} size="sm" />
      )}
    </span>
  );
}

/**
 * TrendIndicator - Shows trend over time (multiple values)
 */
export function TrendIndicator({
  values = [],
  size = "sm",
  className = "",
}) {
  if (values.length < 2) return null;

  const first = values[0];
  const last = values[values.length - 1];

  if (typeof first !== "number" || typeof last !== "number") return null;

  const trend = last > first ? "up" : last < first ? "down" : "flat";

  const sizeClasses = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
  };

  const config = {
    up: { icon: TrendingUp, color: "text-green-400" },
    down: { icon: TrendingDown, color: "text-red-400" },
    flat: { icon: null, color: "text-muted-foreground" },
  };

  const { icon: Icon, color } = config[trend];

  if (!Icon) return null;

  return (
    <span className={`inline-flex ${color} ${className}`} title={`Trend: ${trend}`}>
      <Icon className={sizeClasses[size]} />
    </span>
  );
}

export default FieldValueIndicator;
