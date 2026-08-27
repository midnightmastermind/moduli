// helpers/outsideClick.js
//
// A click inside a PORTALLED popper is not an outside click.
//
// Every dismiss-on-outside-click menu in this app asks the same question the
// same way — `!menuRef.current.contains(e.target)` — and that test is a lie for
// any control the menu renders that portals its own layer to `document.body`.
//
// THE BUG THAT NAMED THIS (user, 2026-08-27): *"whenever i select anything from
// the quickadds field value selection, it closes out of the quickadd menu"* /
// *"i got to create an appointment and select the appointment type and it
// closes the quickadd menu"*. Reproduced by driving QuickAdd -> Item -> the
// Weekday dropdown -> "Monday", and instrumenting the handler's own predicate:
//
//   SPAN.text-muted-foreground   menuContains: true    <- the trigger, fine
//   SPAN.truncate                menuContains: FALSE   <- the option: closed it
//
// The option's ancestor chain ends `[data-radix-popper-content-wrapper]` ->
// BODY. The list is a sibling of the menu in the DOM, so containment says
// "outside" while the user is plainly still inside the menu they opened.
//
// IT CAN ONLY EVER PREVENT A CLOSE, never cause one, which is why it is safe to
// apply to every such handler rather than only the one that was reported.
//
// `role="listbox"`/`menu`/`dialog` are included so a portalled layer that is
// not Radix's is covered too — the rule is about portalled UI, not one library.
const PORTAL_LAYERS = [
  "[data-radix-popper-content-wrapper]",
  "[data-radix-portal]",
  "[role='listbox']",
  "[role='menu']",
  "[role='dialog']",
].join(",");

export function clickedInsidePortalLayer(target) {
  if (!target || typeof target.closest !== "function") return false;
  try {
    return !!target.closest(PORTAL_LAYERS);
  } catch {
    // A detached node, or a selector an older engine cannot parse. Failing
    // CLOSED here restores today's behaviour rather than wedging a menu open.
    return false;
  }
}
