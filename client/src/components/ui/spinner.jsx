import React from "react";
import { cn } from "@/lib/utils";

/**
 * Spinner — ring + Moduli logo counter-spinning inside.
 * Props:
 *  - size: "xs" | "sm" | "md" | "lg" | "xl"
 *  - className
 */
export function Spinner({ size = "md", className }) {
  const dims    = { xs: 16, sm: 20, md: 28, lg: 48, xl: 96 };
  const borders = { xs: 1.5, sm: 2, md: 2.5, lg: 3, xl: 4 };
  const d = dims[size] ?? 28;
  const b = borders[size] ?? 2.5;

  return (
    <div
      className={cn("moduli-spinner", className)}
      role="status"
      aria-label="Loading"
      style={{ width: d, height: d, position: "relative", flexShrink: 0 }}
    >
      {/* Outer ring — spins CW */}
      <div style={{
        position: "absolute", inset: 0,
        borderRadius: "50%",
        border: `${b}px solid rgba(255,255,255,0.10)`,
        borderTopColor: "#3ad2ff",
        animation: "spin-cw 0.85s linear infinite",
      }} />
      {/* Inner logo — 50% of diameter, vertically centered, counter-spins */}
      {/* Outer div: positioning only — flex centering avoids translateY being clobbered by animation */}
      <div style={{
        position: "absolute",
        left: "20%", right: "20%",
        top: 0, bottom: 0,
        display: "flex", alignItems: "center",
      }}>
        {/* Inner div: rotation only */}
        <div style={{ animation: "spin-ccw 2.4s linear infinite", width: "100%" }}>
          <img src="/moduli_logo.png" alt="" aria-hidden style={{ width: "100%", height: "auto", display: "block" }} />
        </div>
      </div>
    </div>
  );
}

export function SpinnerOverlay({ label = "Loading…" }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/60 backdrop-blur-sm gap-4">
      <div className="flex items-center gap-3 rounded-md border border-border bg-background px-4 py-2 shadow-lg">
        <Spinner size="md" />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
