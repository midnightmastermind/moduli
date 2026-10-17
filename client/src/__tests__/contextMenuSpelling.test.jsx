// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../helpers/textLookup.js", () => ({
  spellingSuggestions: vi.fn(async (w) => (w === "wrold" ? { misspelled: true, suggestions: ["world", "wold"] } : { misspelled: false, suggestions: [] })),
  ignoreSpelling: vi.fn(),
}));
import ContextMenu from "../ui/ContextMenu.jsx";

describe("ContextMenu spelling", () => {
  it("puts suggestions at the top and replaces the word", async () => {
    const onReplace = vi.fn();
    render(<ContextMenu ctx={{ x: 10, y: 10, items: [{ label: "Copy", onClick: () => {} }], spell: { word: "wrold", onReplace } }} onClose={() => {}} />);
    const sugg = await screen.findByText("world");
    const labels = [...document.querySelectorAll(".context-menu-item")].map((b) => b.textContent);
    expect(labels.indexOf("world")).toBeLessThan(labels.indexOf("Copy"));
    fireEvent.click(sugg);
    expect(onReplace).toHaveBeenCalledWith("world");
  });
  it("adds nothing for a word spelled right", async () => {
    render(<ContextMenu ctx={{ x: 10, y: 10, items: [{ label: "Copy", onClick: () => {} }], spell: { word: "world" } }} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Copy")).toBeTruthy());
    expect(screen.queryByText(/Ignore/)).toBeNull();
  });
});
