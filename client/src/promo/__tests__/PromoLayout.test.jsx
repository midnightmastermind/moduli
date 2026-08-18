import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import PromoLayout from "../PromoLayout.jsx";

const mount = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<PromoLayout />}>
          <Route path="/" element={<p>page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );

describe("PromoLayout", () => {
  // index.css pins html/body/#root to height:100% + overflow:hidden for the
  // grid. Without the opt-out the landing page cannot scroll: measured at
  // 1440x900 the document was 900px tall with content starting at y=916, and
  // every reveal stayed invisible forever. Both halves are pinned, because a
  // stamp that is never removed would leave the grid scrolling like a document.
  it("opts the document out of the app's fixed-viewport reset while mounted", () => {
    expect(document.documentElement.classList.contains("promo-html")).toBe(false);
    const { unmount } = mount();
    expect(document.documentElement.classList.contains("promo-html")).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains("promo-html")).toBe(false);
  });

  it("renders the nav, the route, and the footer", () => {
    const { getByRole, getByText } = mount();
    expect(getByRole("navigation", { name: "Main" })).toBeTruthy();
    expect(getByText("page")).toBeTruthy();
    expect(getByRole("contentinfo")).toBeTruthy();
  });
});
