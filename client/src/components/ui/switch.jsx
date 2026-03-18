import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"
import { cn } from "@/lib/utils"
import { CONTROL_BASE } from "./control-base"

export const Switch = React.forwardRef(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      // Toggle pill shape (overrides CONTROL_BASE width/height)
      "peer inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full",
      "border border-borderScale-0 bg-inputScale-2",
      "transition-colors",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-400",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-3 w-3 rounded-full bg-white shadow",
        "transition-transform data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5"
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = "Switch"
