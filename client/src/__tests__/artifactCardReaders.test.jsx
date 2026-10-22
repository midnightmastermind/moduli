// A text or book FILE placed on a doc or board shows its content in place (user, 2026-10-22).
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

const STATE = {
  dispatch: vi.fn(), grid: {}, state: { grid: {} }, socket: {},
  getOcc: (id) => ({ id }), getOccMap: () => ({}), foldersById: {}, modulesById: {}, viewsById: {},
  occurrencesById: {}, fieldsById: {}, occurrencesByModuleId: {}, foldersById: {}, getState: () => ({ grid: {} }), getViewMap: () => ({}),
};
vi.mock("../GridActionsContext.js", () => ({
  useGridActionsSelector: (sel) => sel(STATE),
  useGridActionsSelectorShallow: (sel) => sel(STATE),
}));
vi.mock("../modules/BookReader.jsx", () => ({ default: (p) => React.createElement("div", { "data-testid": "book", "data-kind": p.kind }) }));
vi.mock("../modules/FileTextReaders.jsx", async (orig) => {
  const real = await orig();
  return { ...real, default: (p) => React.createElement("div", { "data-testid": "text-reader", "data-reader": p.readerKind }) };
});
const openArtifactSpread = vi.fn();
vi.mock("../ui/ArtifactSpreadHost", () => ({ openArtifactSpread: (...a) => openArtifactSpread(...a) }));

import ArtifactCard from "../modules/ArtifactCard";

const mod = (kind, name) => ({ id: "m-" + name, role: "artifact", kind, label: name, fileRef: "user/2026-10/" + name, meta: { originalName: name } });
const occ = { id: "o1", moduleId: "m" };
afterEach(() => { cleanup(); openArtifactSpread.mockClear(); });

describe("file readers in place", () => {
  it("a code file shows the code reader, and a click in it does not open the viewer", () => {
    const { getByTestId } = render(<ArtifactCard module={mod("code", "a.js")} occurrence={occ} />);
    expect(getByTestId("text-reader").dataset.reader).toBe("code");
    fireEvent.click(getByTestId("text-reader"));
    expect(openArtifactSpread).not.toHaveBeenCalled();
  });
  it("csv → table, md → markdown", () => {
    expect(render(<ArtifactCard module={mod("markdown", "d.csv")} occurrence={occ} />).getByTestId("text-reader").dataset.reader).toBe("csv");
    cleanup();
    expect(render(<ArtifactCard module={mod("markdown", "n.md")} occurrence={occ} />).getByTestId("text-reader").dataset.reader).toBe("markdown");
  });
  it("a pdf and an e-book show the book reader in place", () => {
    expect(render(<ArtifactCard module={mod("pdf", "p.pdf")} occurrence={occ} />).getByTestId("book").dataset.kind).toBe("pdf");
    cleanup();
    expect(render(<ArtifactCard module={mod("ebook", "b.epub")} occurrence={occ} />).getByTestId("book").dataset.kind).toBe("ebook");
  });
  // Control: an unknown file (the "markdown" catch-all) keeps its icon card.
  it("an unknown file keeps its icon", () => {
    const { queryByTestId, container } = render(<ArtifactCard module={mod("markdown", "r.docx")} occurrence={occ} />);
    expect(queryByTestId("text-reader")).toBeNull();
    expect(container.querySelector(".artifact-card--reader")).toBeNull();
  });
});

describe("Go to file", () => {
  it("a copy of an uploaded file opens its home in Files", () => {
    const m = mod("video", "clip.mp4");
    STATE.foldersById = { "files-video": { id: "files-video" } };
    STATE.occurrencesByModuleId = { [m.id]: [{ id: "home", moduleId: m.id, parentId: "files-video" }, { id: "copy", moduleId: m.id, parentId: "doc" }] };
    const seen = [];
    const on = (e) => seen.push(e.detail);
    window.addEventListener("moduli:goto-occurrence", on);
    const { getByLabelText } = render(<ArtifactCard module={m} occurrence={{ id: "copy", moduleId: m.id, parentId: "doc" }} />);
    fireEvent.click(getByLabelText("Go to file"));
    window.removeEventListener("moduli:goto-occurrence", on);
    expect(seen[0]?.occId).toBe("home");
    expect(openArtifactSpread).not.toHaveBeenCalled();
    // Control: a file that was never uploaded (an external picture) has no home and no button.
    cleanup();
    const ext = { ...m, id: "m-ext", fileRef: "https://upload.wikimedia.org/x.mp4" };
    const r = render(<ArtifactCard module={ext} occurrence={{ id: "e", moduleId: "m-ext", parentId: "doc" }} />);
    expect(r.queryByLabelText("Go to file")).toBeNull();
  });
});
