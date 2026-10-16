// @vitest-environment jsdom
// The way back to the file viewer (user, 2026-10-16).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { rememberViewerOrigin, viewerOwnerFor, _resetViewerOrigins } from "../helpers/viewerReturn";

const openArtifactSpread = vi.fn();
vi.mock("../ui/ArtifactSpreadHost", () => ({ openArtifactSpread: (...a) => openArtifactSpread(...a) }));
let OCCS = {};
vi.mock("../GridActionsContext", () => ({ useGridActionsSelector: (sel) => sel({ getOccMap: () => OCCS }) }));
vi.mock("../modules/ArtifactContent.jsx", () => ({ default: () => <div data-testid="artifact" /> }));
import PageDisplay from "../modules/pages/PageDisplay.jsx";

beforeEach(() => { _resetViewerOrigins(); openArtifactSpread.mockClear(); OCCS = { row: { id: "row" }, file: { id: "file" } }; });

describe("viewerReturn", () => {
  it("reopens the viewer the file left from", () => {
    rememberViewerOrigin("file", "row");
    expect(viewerOwnerFor("file", OCCS)).toBe("row");
  });
  it("falls back to the file's own viewer when nothing is known, or the owner is gone", () => {
    expect(viewerOwnerFor("file", OCCS)).toBe("file");
    rememberViewerOrigin("file", "gone");
    expect(viewerOwnerFor("file", OCCS)).toBe("file");
  });
});

describe("PageDisplay", () => {
  it("Open in viewer reopens the remembered viewer", () => {
    rememberViewerOrigin("file", "row");
    render(<PageDisplay occurrence={{ id: "file" }} pageView={{ viewType: "display" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Open in viewer" }));
    expect(openArtifactSpread.mock.calls[0][0]).toBe("row");
  });
  it("opens the file's own viewer when it was opened another way", () => {
    render(<PageDisplay occurrence={{ id: "file" }} pageView={{ viewType: "display" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Open in viewer" }));
    expect(openArtifactSpread.mock.calls[0][0]).toBe("file");
  });
});
