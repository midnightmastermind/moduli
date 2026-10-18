// A PICTURE IN THE VIEWER CAN BE READ.
// User, 2026-10-18: "images need magic mode as well (ocr) put that in the viewer". A picture tile in the
// viewer carries the Image / OCR Reader / OCR Magic tabs its own page has; clicking the picture still
// opens it full screen (where the tabs are too); outside the viewer it stays a thumbnail.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

const STATE = {
  dispatch: vi.fn(), grid: {}, state: { grid: {} }, socket: {},
  getOcc: (id) => ({ id }), getOccMap: () => ({}), foldersById: {}, modulesById: {}, viewsById: {},
  occurrencesById: {}, fieldsById: {}, getState: () => ({ grid: {} }), getViewMap: () => ({}),
};
vi.mock("../GridActionsContext.js", () => ({
  useGridActions: () => STATE,
  useGridActionsSelector: (sel) => sel(STATE),
  useGridActionsSelectorShallow: (sel) => sel(STATE),
}));
vi.mock("../ui/ArtifactSpreadHost", () => ({ openArtifactSpread: vi.fn() }));

import ArtifactCard from "../modules/ArtifactCard";
import { InSpreadContext } from "../helpers/spreadDock";

const image = { id: "m-i", role: "artifact", kind: "image", label: "flyer.png", fileRef: "user/2026-10/flyer.png" };
const occ = { id: "o-i", moduleId: "m-i" };
const inSpread = (ui) => render(<div className="artifact-spread"><InSpreadContext.Provider value={true}>{ui}</InSpreadContext.Provider></div>);

describe("a picture in the viewer", () => {
  it("has the Image / OCR Reader / OCR Magic tabs", () => {
    inSpread(<ArtifactCard module={image} occurrence={occ} />);
    expect(screen.getByRole("button", { name: "Image" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "OCR Reader" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "OCR Magic" })).toBeTruthy();
  });

  it("clicking the picture opens it full screen, with the tabs there too", () => {
    const { container } = inSpread(<ArtifactCard module={image} occurrence={occ} />);
    fireEvent.click(container.querySelector(".artifact-ocr-tile-picture"));
    const full = document.querySelector(".artifact-card--expanded");
    expect(full).toBeTruthy();
    expect(full.querySelector("[data-testid='image-ocr-views']")).toBeTruthy();
  });

  it("a book row drawn as its cover has the tabs too, reading the cover", () => {
    const book = { id: "m-b", role: "artifact", kind: "book", label: "Become What You Are", fileRef: "", meta: { cover: "https://img.example/cover.jpg" } };
    const { container } = inSpread(<ArtifactCard module={book} occurrence={{ id: "o-b", moduleId: "m-b" }} />);
    expect(screen.getByRole("button", { name: "OCR Magic" })).toBeTruthy();
    expect(container.querySelector(".artifact-ocr-tile-picture img").getAttribute("src")).toContain("cover.jpg");
  });

  it("outside the viewer it stays a thumbnail with no tabs", () => {
    render(<ArtifactCard module={image} occurrence={occ} />);
    expect(screen.queryByRole("button", { name: "OCR Magic" })).toBeNull();
  });
});
