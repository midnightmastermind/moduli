// @vitest-environment jsdom
// A file's body opens BESIDE the file on its page (user 2026-10-17), from a Notes button, and only
// for a file that has one. Source guards for the viewer tile (mounting the spread needs the grid).
import { describe, it, expect, vi } from "vitest";
import React from "react";
import fs from "fs";
import path from "path";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../modules/ArtifactContent.jsx", () => ({ default: () => <div data-testid="file-view" /> }));
vi.mock("../modules/DocContent.jsx", () => ({ DocContent: ({ occurrence }) => <div data-testid="notes-doc">{occurrence.id}</div> }));
let MODULES = {};
vi.mock("../GridActionsContext", () => ({ useGridActionsSelector: (sel) => sel({ getOccMap: () => ({}), modulesById: MODULES }) }));
vi.mock("../ui/ArtifactSpreadHost", () => ({ openArtifactSpread: () => {} }));

const { default: PageDisplay } = await import("../modules/pages/PageDisplay.jsx");

describe("a file's notes beside the file", () => {
  it("the Notes button opens the body next to the file and closes it again", () => {
    MODULES = { m1: { id: "m1", role: "artifact", kind: "image" } };
    render(<PageDisplay occurrence={{ id: "o1", moduleId: "m1" }} pageView={{}} />);
    expect(screen.queryByTestId("notes-doc")).toBeNull();
    fireEvent.click(screen.getByLabelText("Show notes"));
    expect(screen.getByTestId("notes-doc").textContent).toBe("o1");
    expect(screen.getByTestId("file-view")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Hide notes"));
    expect(screen.queryByTestId("notes-doc")).toBeNull();
  });

  it("a markdown file has no Notes button", () => {
    MODULES = { m1: { id: "m1", role: "artifact", kind: "markdown" } };
    render(<PageDisplay occurrence={{ id: "o1", moduleId: "m1" }} pageView={{}} />);
    expect(screen.queryByLabelText("Show notes")).toBeNull();
  });

  it("in the viewer, the tile header carries the toggle and the row chevron stands down", () => {
    const src = fs.readFileSync(path.join(__dirname, "../modules/ModuleInstance.jsx"), "utf8");
    expect(src).toMatch(/inSpread && toggleDoc && \(\s*<FileNotesToggle/);
    expect(src).toMatch(/toggleDoc && !overlay && !inSpread/);
    const css = fs.readFileSync(path.join(__dirname, "../index.css"), "utf8");
    expect(css).toMatch(/\.artifact-spread-body \.instance-wrap:has\(> \.instance-doc-body\) \{\s*display: flex;\s*flex-direction: row/);
  });

  it("a folder-page card gets no body", () => {
    const src = fs.readFileSync(path.join(__dirname, "../modules/PreviewNode.jsx"), "utf8");
    expect(src).not.toMatch(/useBodyOpen|FileNotesEditor/);
  });
});
