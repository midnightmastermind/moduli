import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cn } from "@/lib/utils"

export const Label = React.forwardRef(
  ({ className, ...props }, ref) => (
    <LabelPrimitive.Root
      ref={ref}
      className={cn("text-[11px] text-foregroundScale-2 font-medium content-center pr-[3px] leading-none", className)}
      {...props}
    />
  )
)
