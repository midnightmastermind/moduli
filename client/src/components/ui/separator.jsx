import * as React from "react"
import * as SeparatorPrimitive from "@radix-ui/react-separator"
import { cn } from "@/lib/utils"

export function Separator({ className, ...props }) {
  return (
    <SeparatorPrimitive.Root
      className={cn(" h-px mt-3 mb-5 w-full bg-borderScale-0", className)}
      {...props}
    />
  )
}
