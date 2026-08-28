/**
 * How a CONTAINER arranges its own children.
 *
 * `mode` has always been part of the layout-cascade vocabulary and the Layout
 * menu has always offered it — `layoutToSurfaceShape` maps the rich CSS editor's
 * "flex, no wrap" straight onto `"flex-row"`. But only `PageBoard` ever read
 * that value, so on a CONTAINER it was INERT: set it and nothing moved. That is
 * the same class as `childMaxWidth`, which was a declared key only PageBoard
 * consumed until 2026-08-25 — one mode over.
 *
 * It surfaced on the project kanban (user, 2026-08-28: *"can you make the
 * projects kanban look more like a kanban ... columns going across fixed
 * height, no wrap"* / *"right now they are stacked"*). The six columns ARE
 * containers, so with no mode the list fell to its default vertical stack and
 * the board read as six stacked strips.
 *
 * THREE MODES, and the split matters:
 *   stack     the default — full-width children, one per line
 *   wrap      a WRAPPING grid of tiles (the tracker squares)
 *   flex-row  a NON-wrapping row that scrolls horizontally (kanban columns,
 *             and what PageBoard has always given the Schedule's day columns)
 *
 * `wrap` and `flex-row` are opposites on exactly one axis and are easy to
 * confuse: both lay children out across, but a wrap tile flows onto the next
 * line while a column must not — a kanban whose columns wrap is not a kanban.
 *
 * DEFAULTS ARE PER MODE, because a tile and a column are different objects: a
 * 132px tile default would make a 280px kanban column, and PageBoard's own
 * 280/360 column defaults are what the Schedule and the Day Page already use.
 * Every number stays overridable through the same cascade keys the Layout menu
 * already edits, so this configures rather than hardcodes.
 */

/** Per-mode fallbacks. `flex-row` mirrors PageBoard's column defaults. */
export const CHILD_LAYOUT_DEFAULTS = Object.freeze({
  wrap:      Object.freeze({ minW: 132, maxW: null, gap: 8,  maxH: 200 }),
  "flex-row": Object.freeze({ minW: 280, maxW: 360, gap: 12, maxH: 420 }),
});

const CLASS_BY_MODE = Object.freeze({
  wrap: "container-items--wrap",
  "flex-row": "container-items--row",
});

const num = (v, min = 0) => (Number.isFinite(v) && v > min ? v : null);

/**
 * @param {Object|null} resolved  the resolved layout cascade (`layoutCascade.resolved`)
 * @returns {{ mode: "stack"|"wrap"|"flex-row", className: string, vars: Object|null }}
 *   `vars` is null for stack, so a container that states nothing renders exactly
 *   as it did before this existed.
 */
export function resolveContainerChildLayout(resolved) {
  const mode = resolved?.mode;
  const d = CHILD_LAYOUT_DEFAULTS[mode];
  if (!d) return { mode: "stack", className: "", vars: null };

  const minW = num(resolved?.childMinWidth) ?? d.minW;
  // A wrap tile with no configured max is capped at 100% rather than a pixel
  // value — a fixed-width tile in a narrower panel column used to overflow it
  // instead of shrinking (2026-08-25). A COLUMN has a real pixel default.
  const maxWNum = num(resolved?.childMaxWidth);
  const maxW = maxWNum ? `${maxWNum}px` : (d.maxW ? `${d.maxW}px` : "100%");
  // gap of 0 is meaningful, so it is the one key that accepts zero.
  const gap = Number.isFinite(resolved?.childGap) && resolved.childGap >= 0 ? resolved.childGap : d.gap;
  const maxH = num(resolved?.childMaxHeight) ?? d.maxH;

  return {
    mode,
    className: CLASS_BY_MODE[mode],
    vars: {
      "--child-w": `${minW}px`,
      "--child-max-w": maxW,
      "--child-h": `${maxH}px`,
      "--child-gap": `${gap}px`,
    },
  };
}
