// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../GridActionsContext", () => ({ useGridActions: () => ({ state: { grid: { id: "g" } }, occurrencesById: {}, modulesById: {}, viewsById: {}, manifestsById: {}, foldersById: {} }) }));
vi.mock("../PagePreviewApp.jsx", () => ({ PagePreviewBody: ({ occurrenceId }) => <div data-testid="preview">{occurrenceId}</div> }));
vi.mock("../helpers/readerPlan", () => ({ readerStateFromPlan: (plan) => ({ state: {}, rootOccurrenceId: plan.root }) }));
const createImportsDocPage = vi.fn(() => "page1");
vi.mock("../helpers/importsFolder", () => ({
  ensureImportsFolderAndPage: () => ({ folderId: "imports" }),
  createImportsDocPage: (...a) => createImportsDocPage(...a),
}));
const updateModule = vi.fn();
vi.mock("../helpers/CommitHelpers", () => ({ updateModule: (...a) => updateModule(...a) }));
// The PDF viewer reports page 3 of a 10-page document whose text is two lines.
const fakeDoc = {
  numPages: 10,
  getPage: () => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [
    { str: "Page three text.", transform: [1, 0, 0, 1, 0, 700], height: 10, hasEOL: true },
  ] }) }),
};
const pdfGo = vi.fn();
const pdfZoom = vi.fn();
vi.mock("../modules/PdfViewer.jsx", () => ({
  default: ({ onPage, initialPage, controlRef, onState }) => {
    if (controlRef) controlRef.current = { go: (d) => pdfGo(d), jump: () => {}, zoomBy: (d) => pdfZoom(d) };
    React.useEffect(() => { onPage?.(initialPage, fakeDoc); onState?.({ pageNum: initialPage, totalPages: 10, zoom: 1.2 }); }, []);
    return <div data-testid="pdf">pdf at {initialPage}</div>;
  },
}));

const openInPanel = vi.fn(() => ({ ok: true }));
vi.mock("../hooks/useOpenArtifactInPanel", () => ({ useOpenArtifactInPanel: () => openInPanel }));
let HOST = null;
const filePages = vi.fn(() => Promise.resolve(["# One\n\nFirst page.", "", "Second page."]));
vi.mock("../helpers/bookText", () => ({ filePages: (...a) => filePages(...a) }));
vi.mock("../helpers/spreadDock", () => ({ useSpreadHost: () => HOST }));

import BookReader from "../modules/BookReader.jsx";

function makeSocket() {
  const emits = [];
  return { emits, emit: vi.fn((event, payload, ack) => { emits.push({ event, payload }); ack?.({ ok: true, root: `${payload.shape}-root`, rootOccurrenceId: "imp1" }); }) };
}
const MOD = { id: "m1", label: "Dune", kind: "pdf", meta: { originalName: "dune.pdf", readingPosition: { page: 3 } } };
const mount = (socket) => render(
  <BookReader module={MOD} occurrence={{ id: "o1" }} src="/files/c/f" kind="pdf" socket={socket} dispatch={vi.fn()} gridId="g" />,
);

beforeEach(() => { updateModule.mockReset(); createImportsDocPage.mockClear(); });
afterEach(() => vi.useRealTimers());

describe("BookReader", () => {
  it("opens the PDF at the stored page, in Book mode, and plans nothing until Magic", async () => {
    const socket = makeSocket();
    mount(socket);
    expect(screen.getByTestId("pdf").textContent).toBe("pdf at 3");
    for (const t of ["Document", "Magic page", "Magic file"]) expect(screen.getByRole("button", { name: t })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Dune — p. 3")).toBeTruthy());
    expect(socket.emits.some((e) => e.event === "import_plan")).toBe(false);
  });

  it("Magic plans the page on screen as magic, titled with the place in the book", async () => {
    const socket = makeSocket();
    mount(socket);
    await waitFor(() => expect(screen.getByText("Dune — p. 3")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Magic page" }));
    await waitFor(() => expect(screen.getByTestId("preview").textContent).toBe("magic-root"));
    const plan = socket.emits.find((e) => e.event === "import_plan");
    expect(plan.payload).toMatchObject({ content: "Page three text.", format: "markdown", shape: "magic", title: "Dune — p. 3" });
  });

  // User, 2026-10-16: "change save page to open in panel, if i want to save the page, i can drag
  // copy out of magic." The reader writes nothing of its own any more.
  it("Save page keeps the page in the current mode's shape and files it in Imports", async () => {
    const socket = makeSocket();
    mount(socket);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save page" }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save page" }));
    await waitFor(() => expect(createImportsDocPage).toHaveBeenCalled());
    const save = socket.emits.find((e) => e.event === "import_text");
    expect(save.payload).toMatchObject({ shape: "reader", title: "Dune — p. 3", content: "Page three text." });
    fireEvent.click(screen.getByRole("button", { name: "Magic page" }));
    fireEvent.click(screen.getByRole("button", { name: "Save page" }));
    await waitFor(() => expect(socket.emits.filter((e) => e.event === "import_text").length).toBe(2));
    expect(socket.emits.filter((e) => e.event === "import_text")[1].payload.shape).toBe("magic");
  });

  it("Open in panel opens the book's page in a panel (outside the viewer)", async () => {
    openInPanel.mockClear();
    mount(makeSocket());
    fireEvent.click(screen.getByRole("button", { name: "Open in panel" }));
    expect(openInPanel).toHaveBeenCalledWith("o1", { fromPanelModuleId: null });
  });

  it("in the viewer the tile's own Open in panel is used, on the same row (no second button)", () => {
    HOST = { originPanelModuleId: "pmod", close: vi.fn() };
    mount(makeSocket());
    expect(screen.getByRole("button", { name: "Save page" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open in panel" })).toBe(null);
    HOST = null;
  });

  it("one header row carries the PDF's page and zoom", async () => {
    pdfZoom.mockReset();
    const { container } = mount(makeSocket());
    expect(container.querySelectorAll(".book-reader-head")).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: "Page" }).value).toBe("3"));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(pdfZoom).toHaveBeenCalledWith(0.2);
  });

  it("the surrounding page's buttons sit on the reader's one header row", () => {
    render(<BookReader module={MOD} occurrence={{ id: "o1" }} src="/files/c/f" kind="pdf" inPanelPage socket={makeSocket()} dispatch={vi.fn()} gridId="g"
      headerExtra={<button type="button">Open in viewer</button>} />);
    const head = document.querySelector(".book-reader-head");
    expect(head.contains(screen.getByRole("button", { name: "Open in viewer" }))).toBe(true);
    expect(head.contains(screen.getByRole("button", { name: "Document" }))).toBe(true);
  });

  it("does not offer Open in panel where it already is the panel's page", () => {
    render(<BookReader module={MOD} occurrence={{ id: "o1" }} src="/files/c/f" kind="pdf" inPanelPage socket={makeSocket()} dispatch={vi.fn()} gridId="g" />);
    expect(screen.queryByRole("button", { name: "Open in panel" })).toBe(null);
  });

  it("does not write the position back when it has not moved, and keeps the rest of meta when it has", async () => {
    vi.useFakeTimers();
    const socket = makeSocket();
    const { rerender } = mount(socket);
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(updateModule).not.toHaveBeenCalled(); // page 3 was already stored
    const moved = { ...MOD, meta: { ...MOD.meta, readingPosition: { page: 1 } } };
    // a fresh reader that starts at page 1 then lands on page 1 -> unchanged; simulate a move by a new start page
    rerender(<BookReader key="b" module={{ ...moved, meta: { originalName: "dune.pdf" } }} occurrence={{ id: "o1" }} src="/files/c/f" kind="pdf" socket={socket} dispatch={vi.fn()} gridId="g" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(updateModule).toHaveBeenCalledTimes(1);
    const written = updateModule.mock.calls[0][0].module;
    expect(written.id).toBe("m1");
    expect(written.meta.originalName).toBe("dune.pdf");
    expect(written.meta.readingPosition.page).toBe(1);
  });

  it("previous / next sit in the header in both modes and turn the book", async () => {
    pdfGo.mockReset();
    mount(makeSocket());
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(pdfGo.mock.calls).toEqual([[1]]);
    pdfGo.mockReset();
    fireEvent.click(screen.getByRole("button", { name: "Magic page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(pdfGo.mock.calls).toEqual([[1], [-1]]);
  });

  // User, 2026-10-18: "a button next to magic that does the whole file, not just that one page".
  it("Magic file reads every page once and plans the whole file, titled with the book", async () => {
    filePages.mockClear();
    const socket = makeSocket();
    mount(socket);
    await waitFor(() => expect(screen.getByText("Dune — p. 3")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Magic file" }));
    await waitFor(() => expect(screen.getByTestId("preview").textContent).toBe("magic-root"));
    expect(filePages).toHaveBeenCalledTimes(1);
    expect(filePages.mock.calls[0][0]).toEqual({ src: "/files/c/f", kind: "pdf" });
    const plan = socket.emits.filter((e) => e.event === "import_plan").pop();
    expect(plan.payload).toMatchObject({ content: "# One\n\nFirst page.\n\nSecond page.", format: "markdown", shape: "magic", title: "Dune" });
    // nothing to turn when every page is on screen
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
    // Save keeps the whole file
    fireEvent.click(screen.getByRole("button", { name: "Save file" }));
    const saved = socket.emits.filter((e) => e.event === "import_text").pop();
    expect(saved.payload).toMatchObject({ content: "# One\n\nFirst page.\n\nSecond page.", title: "Dune", shape: "magic" });
    // going back to the page and to the file again does not read the file twice
    fireEvent.click(screen.getByRole("button", { name: "Magic page" }));
    fireEvent.click(screen.getByRole("button", { name: "Magic file" }));
    expect(filePages).toHaveBeenCalledTimes(1);
  });

  it("Magic file says so when the file cannot be read", async () => {
    filePages.mockImplementationOnce(() => Promise.reject(new Error("the file could not be fetched (404)")));
    mount(makeSocket());
    fireEvent.click(screen.getByRole("button", { name: "Magic file" }));
    await waitFor(() => expect(screen.getByText(/could not be read: the file could not be fetched/)).toBeTruthy());
  });

  it("says plainly when a file is not a book it can open", () => {
    render(<BookReader module={MOD} src="/x" kind="image" socket={makeSocket()} />);
    expect(screen.getByText(/not a book this reader can open/)).toBeTruthy();
  });
});
