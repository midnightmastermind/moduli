import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { cn } from "@/lib/utils"
import { Z_POPOVER } from "@/helpers/zLayers"

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export const PopoverContent = React.forwardRef(
  ({ className, align = "start", sideOffset = 4, style, ...props }, ref) => (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        collisionPadding={16}  // ✅ Keep 16px from screen edges
        avoidCollisions={true} // ✅ Flip/shift to stay on screen
        sideOffset={sideOffset}
        className={cn(
          "p-3 rounded border border-borderScale-0 bg-popoverScale-2 text-popover-foreground shadow-md outline-none",
          // ✅ Compact width - reduced from 520px to 340px
          "max-w-[calc(100vw-32px)]",
          "w-[min(340px,calc(100vw-32px))]",
          // ✅ Prevent overflow on small screens
          "max-h-[calc(100vh-32px)] overflow-auto",
          className
        )}
        // Above every panel (60-1000). The level lives in helpers/zLayers.js
        // because a menu opened FROM this surface has to out-rank it, and
        // that relationship cannot be maintained across two files by hand.
        style={{ zIndex: Z_POPOVER, ...style }}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
)