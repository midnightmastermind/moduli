import React from "react";
import { cn } from "@/lib/utils";

/**
 * Spinner
 *
 * Props:
 * - size: "xs" | "sm" | "md" | "lg"
 * - className
 */
export function Spinner({ size = "md", className }) {
  const sizeMap = {
    xs: "h-3 w-3 border",
    sm: "h-4 w-4 border-2",
    md: "h-6 w-6 border-2",
    lg: "h-8 w-8 border-4",
  };

  return (
    <div
      className={cn(
        "animate-spin rounded-full border-muted border-t-foreground",
        sizeMap[size],
        className
      )}
      aria-label="Loading"
      role="status"
    />
  );
}

export function SpinnerOverlay({ label = "Loading…" }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/60 backdrop-blur-sm gap-4">
      <img src="/moduli_logo_true_vector.svg" alt="Moduli" className="w-16 h-16 opacity-80" />
      <div className="flex items-center gap-3 rounded-md border border-border bg-background px-4 py-2 shadow-lg">
        <Spinner />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
