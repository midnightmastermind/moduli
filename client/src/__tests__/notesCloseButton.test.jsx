import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

vi.mock("../modules/DocContent.jsx", () => ({ DocContent: () => <div data-testid="doc" /> }));
import { FileNotesEditor, NotesCloseButton } from "../modules/FileBody.jsx";

describe("notes sections close from an × in their corner", () => {
  it("the file notes beside a file have an × that calls onClose", () => {
    const onClose = vi.fn();
    render(<FileNotesEditor occurrence={{ id: "o1" }} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close notes" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("no onClose, no ×", () => {
    render(<FileNotesEditor occurrence={{ id: "o1" }} />);
    expect(screen.queryByRole("button", { name: "Close notes" })).toBeNull();
    const { container } = render(<NotesCloseButton />);
    expect(container.innerHTML).toBe("");
  });
  it("is wired to the page's notes and to a row's notes drawer", () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    expect(read("modules/pages/PageDisplay.jsx")).toMatch(/onClose=\{\(\) => setNotesOpen\(false\)\}/);
    expect(read("modules/ModuleInstance.jsx")).toMatch(/<NotesCloseButton onClose=\{toggleDoc\} \/>/);
  });
});
