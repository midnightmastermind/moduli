"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef(function TooltipContent(
  { className, sideOffset = 6, ...props },
  ref
) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-[240px] rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground shadow-md",
          "animate-in fade-in-0 zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = "TooltipContent";

/* ------------------------------------------------------------
   TooltipHelp — defaults to a tiny ? pill
------------------------------------------------------------ */
/* ------------------------------------------------------------
   TooltipHelp — defaults to a tiny ? pill
   ✅ Includes its own TooltipProvider so it ALWAYS works
------------------------------------------------------------ */
function TooltipHelp({
  children,
  variant = "pill", // "pill" | "icon" (reserved)
  size = "sm",      // "sm" | "md"
  className,
  side = "top",
  sideOffset = 6,
  delayDuration = 150,
}) {
  const sizeClass =
    size === "md" ? "h-5 w-5 text-[11px]" : "h-4 w-4 text-[10px]";

  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center justify-center rounded-full cursor-help select-none",
              "border border-border bg-muted text-muted-foreground",
              "hover:bg-accent hover:text-accent-foreground",
              sizeClass,
              className
            )}
          >
            ?
          </span>
        </TooltipTrigger>

        <TooltipContent side={side} sideOffset={sideOffset}>
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}


export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  TooltipHelp,
};
