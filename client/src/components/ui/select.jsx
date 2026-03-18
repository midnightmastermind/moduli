import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "@/lib/utils";
import { CONTROL_BASE, CONTROL_H } from "./control-base";

export const Select = SelectPrimitive.Root;

export const SelectTrigger = React.forwardRef(
  ({ className, children, ...props }, ref) => (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex w-full px-2 items-center justify-between",
        CONTROL_H,
        CONTROL_BASE,
        className
      )}
      {...props}
    >
      {children}
    </SelectPrimitive.Trigger>
  )
);

export const SelectValue = SelectPrimitive.Value;

export const SelectContent = React.forwardRef(
  ({ className, children, ...props }, ref) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          "z-[1000005] min-w-[8rem] font-mono overflow-hidden rounded border border-borderScale-0 bg-inputScale-0 text-foreground shadow-md",
          className
        )}
        position="popper"
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1 text-xs">
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
);

export const SelectItem = React.forwardRef(
  ({ className, children, ...props }, ref) => (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded px-2 py-1.5 text-xs outline-none",
        "hover:bg-surface-2 focus:bg-surface-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
);
