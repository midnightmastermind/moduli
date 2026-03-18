import * as React from "react";
import { cn } from "@/lib/utils";
import { CONTROL_BASE, CONTROL_H } from "./control-base";

export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        "flex w-full px-2 py-0 items-center",
        CONTROL_H,
        CONTROL_BASE,
        className
      )}
      {...props}
    />
  );
}
