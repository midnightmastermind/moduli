// ImagePickerMenu `suggestions` — the pictures the CALLER already has.
//
// The share window passes the ones found on the clipped page (user,
// 2026-09-29: "or photos we get from the share"). The contract that matters is
// that every OTHER caller is unchanged: no suggestions means no tab, and the
// picker still opens on Search exactly as it did.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

vi.mock("../ui/LoadingImage.jsx", () => ({
  default: ({ src, alt }) => <img src={src} alt={alt} />,
}));
vi.mock("../helpers/authStorage", () => ({ sessionHeaders: () => ({}) }));

const ImagePickerMenu = (await import("../ui/ImagePickerMenu.jsx")).default;

const SUGGESTIONS = [
  { url: "https://img/og.jpg", via: "declared" },
  { url: "https://img/poster.jpg", via: "img", alt: "poster" },
];

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ results: [] }) }));
});

const open = (props = {}) =>
  render(<ImagePickerMenu open onClose={() => {}} onPick={() => {}} {...props} />);

describe("ImagePickerMenu suggestions", () => {
  it("opens ON the suggestions when the caller has some", () => {
    open({ suggestions: SUGGESTIONS });
    const grid = screen.getByTestId("picker-suggestions");
    expect(grid.querySelectorAll("img")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /from the page/i })).toBeInTheDocument();
  });

  it("picking one hands back its url and closes", () => {
    const onPick = vi.fn(); const onClose = vi.fn();
    render(<ImagePickerMenu open onClose={onClose} onPick={onPick} suggestions={SUGGESTIONS} />);
    fireEvent.click(screen.getByTestId("picker-suggestions").querySelectorAll("button")[1]);
    expect(onPick).toHaveBeenCalledWith("https://img/poster.jpg");
    expect(onClose).toHaveBeenCalled();
  });

  it("Search is still one click away", () => {
    open({ suggestions: SUGGESTIONS });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(screen.getByPlaceholderText(/search the web/i)).toBeInTheDocument();
    expect(screen.queryByTestId("picker-suggestions")).toBeNull();
  });

  it("uses the caller's own label for the tab", () => {
    open({ suggestions: SUGGESTIONS, suggestedLabel: "From this share" });
    expect(screen.getByRole("button", { name: /from this share/i })).toBeInTheDocument();
  });

  // THE CONTROL. Without it, "opens on suggestions" is equally satisfied by a
  // picker that always shows the tab — which would give every other call site
  // (the row menus, the field inputs, the artifact viewer) an empty first tab.
  it("with NO suggestions there is no tab, and it opens on Search", () => {
    open();
    expect(screen.queryByTestId("picker-suggestions")).toBeNull();
    expect(screen.queryByRole("button", { name: /from the page/i })).toBeNull();
    expect(screen.getByPlaceholderText(/search the web/i)).toBeInTheDocument();
  });

  it("an empty array is the same as none", () => {
    open({ suggestions: [] });
    expect(screen.queryByRole("button", { name: /from the page/i })).toBeNull();
    expect(screen.getByPlaceholderText(/search the web/i)).toBeInTheDocument();
  });
});
