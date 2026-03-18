import React from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Reusable popover wrapper.
 *
 * Usage:
 * <ButtonPopover>
 *   <LayoutForm value={layout} onChange={setLayout} />
 * </ButtonPopover>
 *
 * Or controlled mode:
 * <ButtonPopover open={isOpen} onOpenChange={setIsOpen}>
 *   ...
 * </ButtonPopover>
 */
export default function ButtonPopover({
  children,
  label = "Layout",          // can now be string OR <Settings />, or null to hide trigger
  buttonVariant = "ghost",
  align = "start",
  side = "bottom",
  className = "",
  open,                      // controlled open state
  onOpenChange,              // controlled state handler
  triggerStyle,              // optional style for trigger button
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {label !== null && (
        <PopoverTrigger asChild>
          <Button variant={buttonVariant} size="sm" aria-label="Layout" style={triggerStyle}>
            {label}
          </Button>
        </PopoverTrigger>
      )}

      <PopoverContent align={align} side={side} className={` ${className}`}>
        {children}
      </PopoverContent>
    </Popover>
  );
}
