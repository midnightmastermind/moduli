// helpers/placeColumnMenu.js — where a table column's menu goes, against the window. Inside the table it was cut off at the
// table's edges, so on a short table Move and Remove column could not be reached.
const GAP = 2, EDGE = 8;

export function placeColumnMenu(button, menu, viewport) {
  const below = viewport.height - button.bottom - GAP - EDGE;
  const above = button.top - GAP - EDGE;
  const down = menu.height <= below || below >= above;
  const room = down ? below : above;
  const top = down ? button.bottom + GAP : button.top - GAP - Math.min(menu.height, room);
  const left = Math.max(EDGE, Math.min(button.right - menu.width, viewport.width - menu.width - EDGE));
  return { left, top, maxHeight: room };
}
