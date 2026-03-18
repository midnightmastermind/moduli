// components/ui/list-wrapper.jsx
import * as React from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const listWrapperVariants = cva("relative w-full h-full min-h-0 overflow-hidden", {
  variants: {
    variant: { default: "", panel: "rounded-md" },
    padding: { none: "", sm: "p-1", md: "p-2" },
  },
  defaultVariants: { variant: "default", padding: "none" },
});

const viewportVariants = cva(
  cn(
    "h-full w-full",
    "overflow-hidden",
    "[scrollbar-gutter:stable]",
    "[overscroll-behavior:contain]",
    "touch-pan-y"
  ),
  {
    variants: { insetX: { none: "", panel: "px-[5px] pr-[20px]" } },
    defaultVariants: { insetX: "panel" },
  }
);

const listVariants = cva("min-w-0", {
  variants: {
    display: { grid: "grid", flex: "flex", columns: "" }, // ✅ NEW: columns masonry uses style, not a display class
    flow: { row: "", col: "" },
    wrap: { wrap: "flex-wrap", nowrap: "flex-nowrap" },

    // ✅ split align into items vs content
    alignItems: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
      baseline: "items-baseline", // flex-only meaningful
    },
    alignContent: {
      start: "content-start",
      center: "content-center",
      end: "content-end",
      between: "content-between",
      around: "content-around",
      evenly: "content-evenly",
      stretch: "content-stretch",
    },

    justify: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
      around: "justify-around",
      evenly: "justify-evenly",
    },

    gap: { none: "gap-0", sm: "gap-2", md: "gap-3", lg: "gap-4" },
    dense: { false: "", true: "gap-2" },
  },

  compoundVariants: [
    { display: "flex", flow: "row", className: "flex-row" },
    { display: "flex", flow: "col", className: "flex-col" },
    { display: "grid", flow: "row", className: "grid-flow-row" },
    { display: "grid", flow: "col", className: "grid-flow-col" },
    { display: "grid", dense: true, className: "grid-flow-dense" },

    // ✅ NEW: columns masonry (CSS columns)
    // NOTE: no "display" class needed; we apply column styles inline.
  ],

  defaultVariants: {
    display: "grid",
    flow: "row",
    wrap: "wrap",
    alignItems: "start",
    alignContent: "start",
    justify: "start",
    gap: "md",
    dense: false,
  },
});

function computeMinMaxWidth({ widthMode, fixedWidth, minWidthPx, maxWidthPx }) {
  const maxW = Number(maxWidthPx) || 0;

  if (widthMode === "fixed") {
    const w = Number(fixedWidth) || 0;
    const px = w > 0 ? `${w}px` : "170px"; // fallback
    return { min: px, max: px };
  }

  // auto
  const minW = Number(minWidthPx) || 0;
  const min = minW > 0 ? `${minW}px` : "170px";
  const max = maxW > 0 ? `${maxW}px` : "1fr";
  return { min, max };
}

function computeHeightStyle({ heightMode, fixedHeight, minHeightPx, maxHeightPx }) {
  const out = {};
  const maxH = Number(maxHeightPx) || 0;

  if (heightMode === "fixed") {
    const h = Number(fixedHeight) || 0;
    if (h > 0) out.height = `${h}px`;
    if (maxH > 0) out.maxHeight = `${maxH}px`;
    return out;
  }

  const minH = Number(minHeightPx) || 0;
  if (minH > 0) out.minHeight = `${minH}px`;
  if (maxH > 0) out.maxHeight = `${maxH}px`;
  return out;
}

export const ListWrapper = React.forwardRef(function ListWrapper(
  {
    className,
    viewportClassName,
    listClassName,

    // behavior
    display = "grid", // "grid" | "flex" | "columns"
    flow = "row",
    wrap, // ✅ no default here; we compute it below
    gap = "md",
    alignItems = "start",
    alignContent = "start",
    justify = "start",
    dense = false,

    insetX = "panel",

    // grid/columns columns (0 = auto)
    columns = 0,

    // ✅ grid rows (0 = auto / implicit rows)
    rows = 0,

    // ✅ ONE width/height system (no minItemWidth anymore)
    widthMode = "auto", // "auto" | "fixed"
    fixedWidth = 340,
    minWidthPx = 0,
    maxWidthPx = 0,

    heightMode = "auto", // "auto" | "fixed"
    fixedHeight = 0,
    minHeightPx = 0,
    maxHeightPx = 0,

    // shell variants
    variant = "default",
    padding = "none",

    // Radix passthrough
    scrollType = "auto",
    scrollHideDelay = 600,

    // axis scroll control
    scrollX = "none",
    scrollY = "auto",

    children,
    ...props
  },
  ref
) {
  const overflowX =
    scrollX === "none" ? "hidden" : scrollX === "always" ? "scroll" : "auto";
  const overflowY =
    scrollY === "none" ? "hidden" : scrollY === "always" ? "scroll" : "auto";

  const isGrid = display === "grid";
  const isFlex = display === "flex";
  const isColumns = display === "columns";

  // ✅ only apply wrap when flex; never leak flex-wrap classes into grid/columns
  const wrapFinal = isFlex ? wrap ?? "wrap" : undefined;

  // ✅ grid sizing is driven by tracks (repeat + minmax)
  const { min: trackMin, max: trackMax } = computeMinMaxWidth({
    widthMode,
    fixedWidth,
    minWidthPx,
    maxWidthPx,
  });

  // GRID: template columns/rows
  const gridTemplateColumns = isGrid
    ? columns && Number(columns) > 0
      ? `repeat(${Number(columns)}, minmax(${trackMin}, ${trackMax}))`
      : `repeat(auto-fill, minmax(${trackMin}, ${trackMax}))`
    : undefined;

  const gridTemplateRows =
    isGrid && Number(rows) > 0
      ? `repeat(${Number(rows)}, minmax(0, 1fr))`
      : undefined;

  // COLUMNS (masonry): use CSS columns
  // - If columns > 0: force count via column-count
  // - Else: use column-width baseline derived from trackMin
  const columnCount = isColumns && Number(columns) > 0 ? Number(columns) : undefined;
  const columnWidth = isColumns && (!columns || Number(columns) <= 0) ? trackMin : undefined;

  // ✅ height is always safe to apply to wrapper (grid/flex/columns)
  const itemHeightStyle = computeHeightStyle({
    heightMode,
    fixedHeight,
    minHeightPx,
    maxHeightPx,
  });

  // ✅ flex needs explicit width constraints on children; grid does NOT
  const flexChildWidthStyle = isFlex
    ? (() => {
      const s = {};
      if (widthMode === "fixed") {
        const w = Number(fixedWidth) || 0;
        if (w > 0) s.width = `${w}px`;
        const maxW = Number(maxWidthPx) || 0;
        if (maxW > 0) s.maxWidth = `${maxW}px`;
      } else {
        const minW = Number(minWidthPx) || 0;
        const maxW = Number(maxWidthPx) || 0;
        if (minW > 0) s.minWidth = `${minW}px`;
        if (maxW > 0) s.maxWidth = `${maxW}px`;
      }
      return s;
    })()
    : null;

  return (
    <div
      className={cn(listWrapperVariants({ variant, padding }), className)}
      {...props}
    >
      <ScrollArea.Root
        type={scrollType}
        scrollHideDelay={scrollHideDelay}
        className="h-full w-full"
      >
        <ScrollArea.Viewport
          ref={ref}
          className={cn(viewportVariants({ insetX }), viewportClassName, " pl-[20px] pr-[25px]")}
          style={{ overflowX, overflowY }}
        >
          <div
            className={cn(
              listVariants({
                display,
                flow,
                wrap: wrapFinal,
                gap,
                alignItems,
                alignContent,
                justify,
                dense,
              }),
              listClassName,
            )}
            style={{
              ...(gridTemplateColumns ? { gridTemplateColumns } : {}),
              ...(gridTemplateRows ? { gridTemplateRows } : {}),

              // ✅ NEW: masonry columns styles
              ...(isColumns
                ? {
                  columnCount,
                  columnWidth,
                  // mimic gap using column-gap
                  columnGap:
                    gap === "none"
                      ? "0px"
                      : gap === "sm"
                        ? "8px"
                        : gap === "lg"
                          ? "16px"
                          : "12px", // md default
                }
                : {}),
            }}
          >
            {React.Children.map(children, (child, i) => {
              if (child == null) return null;
              if (typeof child === "string" || typeof child === "number") return child;

              const wrapperStyle =
                isFlex
                  ? { ...flexChildWidthStyle, ...itemHeightStyle }
                  : { ...itemHeightStyle }; // grid/columns width handled by tracks/columns

              return (
                <div
                  key={child.key ?? i}
                  style={{
                    ...wrapperStyle,

                    // ✅ NEW: make each child its own column item
                    ...(isColumns
                      ? {
                        breakInside: "avoid",
                        WebkitColumnBreakInside: "avoid",
                        marginBottom:
                          gap === "none"
                            ? "0px"
                            : gap === "sm"
                              ? "8px"
                              : gap === "lg"
                                ? "16px"
                                : "12px",
                      }
                      : {}),
                  }}
                  className={cn("min-w-0", (isFlex || isColumns) ? "w-full" : "h-full")}
                >
                  {child}
                </div>
              );
            })}
          </div>
        </ScrollArea.Viewport>

        {scrollY !== "none" && (
          <ScrollArea.Scrollbar
            orientation="vertical"
            className="flex h-full w-4 select-none touch-none p-[2px]"
          >
            <ScrollArea.Thumb className="flex-1 rounded-full bg-border/60" />
          </ScrollArea.Scrollbar>
        )}

        {scrollX !== "none" && (
          <ScrollArea.Scrollbar
            orientation="horizontal"
            className="flex h-4 w-full select-none touch-none p-[2px]"
          >
            <ScrollArea.Thumb className="flex-1 rounded-full bg-border/60" />
          </ScrollArea.Scrollbar>
        )}

        <ScrollArea.Corner />
      </ScrollArea.Root>
    </div>
  );
});

ListWrapper.displayName = "ListWrapper";
