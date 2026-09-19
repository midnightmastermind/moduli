// The toolbar's toast stack collapses to its count pill when its full width
// does not fit the slot the toolbar measured for it (user, 2026-09-19: a fixed
// width cutoff both covered the filters and collapsed with room to spare).
import { describe, it, expect } from "vitest";
import React from "react";
import { render, act } from "@testing-library/react";
import TransactionNotificationStack from "../ui/TransactionNotificationStack.jsx";
import { pushTxNotification } from "../state/notificationStore";

const setup = (availableWidth) => {
  const r = render(<TransactionNotificationStack availableWidth={availableWidth} />);
  act(() => { pushTxNotification({ kind: "info", label: "Saved", duration: 60000 }); });
  return r;
};

describe("toast stack fit", () => {
  // One chip is CHIP_WIDTH (280px) wide; the compact pill shows only a count.
  it("shows the full chip when it fits", () => {
    const { container } = setup(600);
    expect(container.textContent).toContain("Saved");
  });

  it("collapses to the count pill when it does not", () => {
    const { container } = setup(120);
    expect(container.textContent).not.toContain("Saved");
    expect(container.textContent).toMatch(/\d/);
  });
});
