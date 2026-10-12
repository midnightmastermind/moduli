// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const runOcrPage = vi.fn();
vi.mock("../helpers/ocr", () => ({ runOcrPage: (...a) => runOcrPage(...a) }));
vi.mock("../GridActionsContext", () => ({ useGridActions: () => ({ state: { grid: { id: "g" } }, occurrencesById: {}, modulesById: {}, viewsById: {}, manifestsById: {}, foldersById: {} }) }));
vi.mock("../PagePreviewApp.jsx", () => ({ PagePreviewBody: ({ occurrenceId }) => <div data-testid="preview">{occurrenceId}</div> }));
vi.mock("../helpers/readerPlan", () => ({ readerStateFromPlan: (plan) => ({ state: {}, rootOccurrenceId: plan.root }) }));
const createImportsDocPage = vi.fn(() => "page1");
vi.mock("../helpers/importsFolder", () => ({
  ensureImportsFolderAndPage: () => ({ folderId: "imports" }),
  createImportsDocPage: (...a) => createImportsDocPage(...a),
}));
const createModule = vi.fn(), createOccurrence = vi.fn(), updateOccurrence = vi.fn();
vi.mock("../helpers/CommitHelpers", () => ({
  createModule: (...a) => createModule(...a), createOccurrence: (...a) => createOccurrence(...a), updateOccurrence: (...a) => updateOccurrence(...a),
}));

import ImageOcrViews, { __resetOcrCache } from "../modules/ImageOcrViews.jsx";

const PAGE = { text: "", blocks: [{ paragraphs: [
  { confidence: 90, lines: [{ text: "Big Title", bbox: { x0: 0, y0: 0, x1: 10, y1: 40 } }] },
  { confidence: 90, lines: [{ text: "Body text here.", bbox: { x0: 0, y0: 0, x1: 10, y1: 20 } }] },
  { confidence: 90, lines: [{ text: "More body text.", bbox: { x0: 0, y0: 0, x1: 10, y1: 20 } }] },
] }] };

function makeSocket() {
  const emits = [];
  return { emits, emit: vi.fn((event, payload, ack) => { emits.push({ event, payload }); ack?.({ ok: true, root: `${payload.shape}-root`, rootOccurrenceId: "imp1" }); }) };
}
const mount = (socket) => render(
  <ImageOcrViews occurrence={{ id: "img1", occurrences: [] }} module={{ label: "Receipt" }} imgSrc="/x.png"
    socket={socket} dispatch={vi.fn()} gridId="g" userId="u">
    <div data-testid="picture">the picture</div>
  </ImageOcrViews>,
);

beforeEach(() => { __resetOcrCache(); runOcrPage.mockReset(); runOcrPage.mockResolvedValue(PAGE); createModule.mockReset(); createOccurrence.mockReset(); updateOccurrence.mockReset(); });

describe("ImageOcrViews", () => {
  it("opens on the picture and runs no OCR until a text tab is picked", () => {
    mount(makeSocket());
    expect(screen.getByTestId("picture")).toBeTruthy();
    for (const t of ["Image", "OCR Reader", "OCR Magic"]) expect(screen.getByRole("button", { name: t })).toBeTruthy();
    expect(runOcrPage).not.toHaveBeenCalled();
  });

  it("OCR Reader plans the text as reader, OCR Magic as magic, with one OCR run", async () => {
    const socket = makeSocket();
    mount(socket);
    fireEvent.click(screen.getByRole("button", { name: "OCR Reader" }));
    await waitFor(() => expect(screen.getByTestId("preview").textContent).toBe("reader-root"));
    const reader = socket.emits.find((e) => e.event === "import_plan");
    expect(reader.payload.shape).toBe("reader");
    expect(reader.payload.title).toBe("Receipt");
    expect(reader.payload.content).not.toMatch(/^#/m);

    fireEvent.click(screen.getByRole("button", { name: "OCR Magic" }));
    await waitFor(() => expect(screen.getByTestId("preview").textContent).toBe("magic-root"));
    const magic = socket.emits.filter((e) => e.event === "import_plan").at(-1);
    expect(magic.payload.shape).toBe("magic");
    expect(magic.payload.content).toMatch(/^# Big Title/);
    expect(runOcrPage).toHaveBeenCalledTimes(1);
  });

  it("+ Page imports the view in its shape", async () => {
    const socket = makeSocket();
    mount(socket);
    fireEvent.click(screen.getByRole("button", { name: "OCR Magic" }));
    await waitFor(() => screen.getByTestId("preview"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add as page" })); });
    const imp = socket.emits.find((e) => e.event === "import_text");
    expect(imp.payload.shape).toBe("magic");
    expect(imp.payload.format).toBe("markdown");
    expect(createImportsDocPage.mock.calls[0][0]).toMatchObject({ rootOccId: "imp1", folderId: "imports", label: "Receipt" });
  });

  it("Attach puts the text under the picture as a textblock and returns to the picture", async () => {
    mount(makeSocket());
    fireEvent.click(screen.getByRole("button", { name: "OCR Reader" }));
    await waitFor(() => screen.getByTestId("preview"));
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    expect(createModule.mock.calls[0][0].module.role).toBe("textblock");
    const occ = createOccurrence.mock.calls[0][0].occurrence;
    expect(occ.parentId).toBe("img1");
    expect(occ.textmap.content.map((p) => p.content[0].text)).toEqual(["Big Title", "Body text here.", "More body text."]);
    expect(updateOccurrence.mock.calls[0][0].occurrence.occurrences).toEqual([occ.id]);
    expect(screen.getByTestId("picture")).toBeTruthy();
  });

  it("says so when the picture has no words", async () => {
    runOcrPage.mockResolvedValue({ text: "", blocks: [] });
    mount(makeSocket());
    fireEvent.click(screen.getByRole("button", { name: "OCR Reader" }));
    await waitFor(() => expect(screen.getByText("No text found in this picture.")).toBeTruthy());
  });
});
