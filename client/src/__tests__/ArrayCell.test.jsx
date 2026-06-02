import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// Isolate ArrayCell's descriptor dispatch from RepresentationView's internals.
vi.mock("../ui/RepresentationView", () => ({
  default: ({ occurrence }) => <span data-testid="rep">{occurrence?.label ?? occurrence?.id}</span>,
}));
vi.mock("../helpers/jumpToOccurrence", () => ({ jumpToOccurrence: vi.fn() }));

import { ArrayCell } from "../ui/Field";

const maps = {
  occurrencesById: {
    occ1: { id: "occ1", moduleId: "m1", label: "Inception", fields: { fRating: { value: 5 }, fPoster: { value: "user/poster.png" }, fTags: { value: ["a", "b"] } } },
  },
  modulesById: { m1: { id: "m1", label: "Inception", fieldBindings: [{ fieldId: "fPoster", role: "media" }] } },
  fieldsById: { fRating: { id: "fRating", name: "Rating" } },
};

describe("ArrayCell", () => {
  it("renders a scalar as plain text (back-compat)", () => {
    const { container } = render(<ArrayCell value="6:00am" maps={maps} />);
    expect(container.textContent).toBe("6:00am");
  });

  it("renders null/undefined as empty string", () => {
    const { container } = render(<ArrayCell value={null} maps={maps} />);
    expect(container.textContent).toBe("");
  });

  it("renders an explicit text descriptor", () => {
    const { container } = render(<ArrayCell value={{ kind: "text", text: "watched twice" }} maps={maps} />);
    expect(container.textContent).toBe("watched twice");
  });

  it("renders an occurrence descriptor as a representation chip", () => {
    const { getByTestId } = render(<ArrayCell value={{ kind: "occurrence", id: "occ1" }} maps={maps} />);
    expect(getByTestId("rep").textContent).toBe("Inception");
  });

  it("falls back to the id when the occurrence is missing", () => {
    const { container } = render(<ArrayCell value={{ kind: "occurrence", id: "ghost" }} maps={maps} />);
    expect(container.textContent).toBe("ghost");
  });

  it("projects a scalar field value off the referenced occurrence", () => {
    const { container } = render(<ArrayCell value={{ kind: "field", id: "occ1", fieldId: "fRating" }} maps={maps} />);
    expect(container.textContent).toBe("5");
  });

  it("renders an array field value as an N-selected summary", () => {
    const { container } = render(<ArrayCell value={{ kind: "field", id: "occ1", fieldId: "fTags" }} maps={maps} />);
    expect(container.textContent).toBe("2 selected");
  });

  it("renders a media descriptor with an explicit src as an img", () => {
    const { container } = render(<ArrayCell value={{ kind: "media", src: "user/poster.png" }} maps={maps} />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toContain("poster.png");
  });

  it("resolves a media descriptor from the occurrence's media-role field", () => {
    const { container } = render(<ArrayCell value={{ kind: "media", id: "occ1" }} maps={maps} />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toContain("poster.png");
  });
});
