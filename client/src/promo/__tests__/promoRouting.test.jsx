import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import PromoLayout from "../PromoLayout.jsx";
import LandingPage from "../pages/LandingPage.jsx";
import FeaturePage from "../pages/FeaturePage.jsx";
import ExamplesPage from "../pages/ExamplesPage.jsx";
import NotFoundPage from "../pages/NotFoundPage.jsx";
import { FEATURES } from "../content/features.js";
import { EXAMPLES } from "../content/examples.js";

// Mirrors PromoApp's table without BrowserRouter, so a path can be forced.
function mount(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<PromoLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/features/:slug" element={<FeaturePage />} />
          <Route path="/examples" element={<ExamplesPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("promo routing", () => {
  it("renders every capability page from its slug", () => {
    for (const f of FEATURES) {
      const { unmount } = mount(`/features/${f.slug}`);
      expect(screen.getByRole("heading", { level: 1, name: f.title })).toBeTruthy();
      // The measured figure is the claim; it must reach the page.
      expect(screen.getAllByText(f.stat.value).length).toBeGreaterThan(0);
      for (const p of f.points) expect(screen.getByText(p.heading)).toBeTruthy();
      unmount();
    }
  });

  // An unknown slug must not render an empty shell that looks like a working
  // page — it is a 404.
  it("an unknown slug is not found", () => {
    mount("/features/does-not-exist");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/not found/i);
  });

  it("the examples page lists every example with its detail", () => {
    mount("/examples");
    for (const e of EXAMPLES) {
      expect(screen.getByRole("heading", { level: 2, name: e.name })).toBeTruthy();
      expect(screen.getByText(e.detail)).toBeTruthy();
    }
  });

  // The join between an example and the generic capabilities it is made of is
  // the whole argument of the page.
  //
  // SCOPED TO THE ARTICLE ON PURPOSE. The nav in PromoLayout renders a link to
  // /features/<slug> with the SAME accessible name as the chip, so a
  // screen-wide query passes on the nav link and never looks at the chip at
  // all — green while the feature is missing. Query within the example.
  it("each example links to the capabilities it is built from", () => {
    const { container } = mount("/examples");
    for (const e of EXAMPLES) {
      const article = [...container.querySelectorAll(".promo-example")].find(
        (el) => el.querySelector("h2")?.textContent === e.name
      );
      expect(article, `no article for ${e.id}`).toBeTruthy();
      const chips = within(article).getAllByRole("link");
      const hrefs = chips.map((c) => c.getAttribute("href"));
      for (const slug of e.built) {
        expect(hrefs, `${e.id} does not link to ${slug}`).toContain(`/features/${slug}`);
      }
    }
  });

  it("an unknown path is not found", () => {
    mount("/nonsense");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/not found/i);
  });
});
