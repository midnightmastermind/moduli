import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PromoNav from "../PromoNav.jsx";
import { FEATURES } from "../content/features.js";

const mount = (path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <PromoNav />
    </MemoryRouter>
  );

describe("PromoNav", () => {
  it("links to every capability page", () => {
    mount();
    for (const f of FEATURES) {
      const link = screen.getByRole("link", { name: f.nav });
      expect(link.getAttribute("href")).toBe(`/features/${f.slug}`);
    }
  });

  it("offers a way to log in", () => {
    mount();
    expect(screen.getByRole("link", { name: /log in/i }).getAttribute("href")).toBe("/login");
  });

  it("marks the current page", () => {
    mount("/features/operations");
    const current = screen.getByRole("link", { name: "Operations" });
    expect(current.getAttribute("aria-current")).toBe("page");
  });

  it("the mobile toggle opens and closes the links", () => {
    mount();
    const toggle = screen.getByRole("button", { name: /menu/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  // Tapping a link on a phone must close the drawer, or the destination is
  // rendered underneath an open menu.
  it("closes the drawer when a link is followed", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("link", { name: FEATURES[0].nav }));
    expect(screen.getByRole("button", { name: /menu/i }).getAttribute("aria-expanded")).toBe("false");
  });
});
