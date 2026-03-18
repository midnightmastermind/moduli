import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { cn } from "@/lib/utils"

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export const PopoverContent = React.forwardRef(
  ({ className, align = "start", sideOffset = 4, ...props }, ref) => (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        collisionPadding={16}  // ✅ Keep 16px from screen edges
        avoidCollisions={true} // ✅ Flip/shift to stay on screen
        sideOffset={sideOffset}
        className={cn(
          // ✅ High z-index to appear above panels (which can be 60-1000)
          "z-[10000] p-3 rounded border border-borderScale-0 bg-popoverScale-2 text-popover-foreground shadow-md outline-none",
          // ✅ Compact width - reduced from 520px to 340px
          "max-w-[calc(100vw-32px)]",
          "w-[min(340px,calc(100vw-32px))]",
          // ✅ Prevent overflow on small screens
          "max-h-[calc(100vh-32px)] overflow-auto",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
)