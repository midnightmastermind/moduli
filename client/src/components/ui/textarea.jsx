import * as React from "react";
import { cn } from "@/lib/utils";
import { CONTROL_BASE } from "./control-base";

export function Textarea({ className, ...props }) {
  return (
    <textarea
      className={cn(
        "flex w-full min-h-[60px] px-2 py-1.5 resize-y",
        CONTROL_BASE,
        // Override rounded to match multi-line feel
        "rounded",
        className
      )}
      {...props}
    />
  );
}
