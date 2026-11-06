// helpers/calendarA11y.jsx — what react-multi-date-picker leaves out for screen readers (axe, sweep row toolbar#11).
// Its month arrows are <button>s with no name, and the other month's blank filler days are divs carrying
// aria-label with no role. Both are hard-coded in the library; `renderButton` and a DOM pass are the seams it leaves.
import React from "react";

/** Calendar `renderButton`: the library's own arrow markup (its CSS and its keyboard focus query
 *  `.rmdp-arrow-container` rely on the classes), plus a name. */
export function calendarArrow(direction, handleClick, disabled, onKeyDown) {
  return (
    <button
      type="button"
      className={`rmdp-arrow-container rmdp-${direction} ${disabled ? "disabled" : ""}`}
      onClick={handleClick}
      onKeyDown={onKeyDown}
      aria-label={direction === "left" ? "Previous month" : "Next month"}
      aria-disabled={disabled ? "true" : undefined}
    >
      <i className="rmdp-arrow" />
    </button>
  );
}

/** A filler day shows nothing and cannot be picked: hide it, and drop the label it was given. */
export function quietHiddenDays(root) {
  if (!root) return;
  for (const d of root.querySelectorAll(".rmdp-day")) {
    if (d.classList.contains("rmdp-day-hidden")) {
      if (d.getAttribute("aria-hidden") !== "true") d.setAttribute("aria-hidden", "true");
      if (d.hasAttribute("aria-label")) d.removeAttribute("aria-label");
    } else if (d.getAttribute("aria-hidden") === "true") {
      d.removeAttribute("aria-hidden");
    }
  }
}

/** Keep it applied as the month changes. Returns a stop function. */
export function watchHiddenDays(root) {
  if (!root || typeof MutationObserver === "undefined") return () => {};
  quietHiddenDays(root);
  const mo = new MutationObserver(() => quietHiddenDays(root));
  mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "aria-label"] });
  return () => mo.disconnect();
}
