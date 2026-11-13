// client/src/__tests__/shareImportPreview.test.jsx
//
// Plan Task 5 (smarter imports): Auto says what will be created; a link placed by hand can be kept as a
// bookmark, turned into its readable page, or both, with the page's body and pictures set in the window.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../ui/ImagePickerMenu.jsx", () => ({ default: () => null }));
vi.mock("../ui/FieldSelect.jsx", () => ({ default: () => null }));

const STAGED = { source: "extension", shape: "page", url: "https://en.wikipedia.org/wiki/Albert_Ellis", title: "Albert Ellis - Wikipedia" };
const PREVIEW = {
  where: "Imports", label: "Albert Ellis", kind: "link", type: "wikipedia", board: null, fields: {},
  bodyLines: ["Albert Ellis", "Albert Ellis was an American psychologist."], images: ["https://img/a.jpg", "https://img/b.jpg"],
  willBuildPage: true, aiNote: "AI clean-up will run after saving",
};
const BOARD = { id: "o-read", label: "Reading", role: "container", kind: "board", childCount: 3,
  shape: { role: "instance", kind: null, bindFields: [] } };

let calls, preview;
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const sharePost = () => calls.find((c) => c.opts?.method === "POST" && c.url.endsWith("/share"));

beforeEach(() => {
  calls = []; preview = PREVIEW;
  window.history.replaceState({}, "", "/share-place?stage=s1&k=k1");
  window.close = vi.fn();
  localStorage.setItem("moduli-token", "session-jwt");
  global.fetch = vi.fn(async (url, opts) => {
    const u = String(url);
    calls.push({ url: u, opts });
    if (u.includes("/share/stage/s1/import-preview")) return json(preview);
    if (u.includes("/share/stage/s1/cover")) return json({ cover: null, candidates: [] });
    if (u.includes("/share/stage/s1/preview")) return json({ gridId: "g1", ruleId: "r1", ruleName: "Share: link", lands: "Imports" });
    if (u.includes("/share/stage/s1")) return json({ payload: STAGED });
    if (u.includes("/me/share")) return json({ gridId: "g1" });
    if (u.includes("/grids")) return json({ grids: [{ id: "g1", name: "poms grid" }] });
    if (u.includes("/destinations")) return json({ destinations: [BOARD] });
    if (u.includes("/fields")) return json({ fields: [] });
    if (u.includes("/share/presets")) return json({ presets: [] });
    if (u.endsWith("/share")) return json({ ran: [{ ok: true, created: [{ occurrenceId: "n1" }] }] }, 201);
    return json({});
  });
});
afterEach(() => { cleanup(); localStorage.clear(); });

const { default: SharePlace } = await import("../ui/SharePlace.jsx");
const { default: ShareImportPreview } = await import("../ui/ShareImportPreview.jsx");
const { buildSharePayload } = await import("../helpers/sharePlacement.js");

const ready = async () => { render(<SharePlace />); await screen.findByText(/Share: link/); };
const pickBoard = async () => {
  fireEvent.click(screen.getByLabelText("New"));
  fireEvent.change(screen.getByPlaceholderText(/search containers/i), { target: { value: "read" } });
  fireEvent.click(await screen.findByText("Reading"));
};

describe("Auto says what it will create", () => {
  it("the heading, the page's lines and the AI note", async () => {
    await ready();
    expect(await screen.findByText("Will be created in Imports")).toBeTruthy();
    expect(await screen.findByText("Albert Ellis was an American psychologist.")).toBeTruthy();
    expect(screen.getByText("AI clean-up will run after saving")).toBeTruthy();
  });

  it("a page that could not be read says the bookmark is still saved", () => {
    render(<ShareImportPreview preview={{ ...PREVIEW, willBuildPage: false, bodyLines: [] }} />);
    expect(screen.getByText(/bookmark is still saved/)).toBeTruthy();
  });
});

describe("a link placed by hand", () => {
  it("offers the three choices; a page shows Body and Pictures", async () => {
    await ready();
    await pickBoard();
    expect(await screen.findByLabelText("Keep as bookmark")).toBeTruthy();
    expect(screen.getByLabelText("Both")).toBeTruthy();
    expect(screen.queryByLabelText("Body")).toBeNull();
    fireEvent.click(screen.getByLabelText("Turn into a page"));
    expect(screen.getByLabelText("Body")).toBeTruthy();
    expect(screen.getByText("Pictures")).toBeTruthy();
    expect(screen.getAllByLabelText("Leave this picture out")).toHaveLength(2);
  });

  it("Clip sends importAs page with the body and the pictures kept", async () => {
    await ready();
    await pickBoard();
    fireEvent.click(await screen.findByLabelText("Turn into a page"));
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "My summary." } });
    fireEvent.click(screen.getAllByLabelText("Leave this picture out")[0]);
    fireEvent.click(screen.getByText("Clip"));
    await screen.findByText(/Clipped/);
    const body = JSON.parse(sharePost().opts.body);
    expect(body.placement).toMatchObject({ importAs: "page", pageBody: "My summary.", images: ["https://img/b.jpg"] });
  });

  it("a clip that is not a link gets no link choices — the control", async () => {
    preview = { ...PREVIEW, kind: "text", type: "text" };
    await ready();
    await pickBoard();
    expect(screen.queryByLabelText("Keep as bookmark")).toBeNull();
  });
});

describe("buildSharePayload", () => {
  const base = { gridId: "g1", mode: "manual", stageId: "s", stageKey: "k", destination: { id: "d" }, shape: { role: "instance" }, mappings: {}, clip: {} };
  it("a bookmark sends no importAs — the default", () => {
    expect(buildSharePayload({ ...base, importAs: "bookmark", pageBody: "x" }).placement.importAs).toBeUndefined();
  });
  it("both carries the body and pictures", () => {
    expect(buildSharePayload({ ...base, importAs: "both", pageBody: " hi ", images: ["a"] }).placement)
      .toMatchObject({ importAs: "both", pageBody: "hi", images: ["a"] });
  });
});

describe("a shared photo", () => {
  it("is shown in the preview at a size you can see", () => {
    const { getByTestId } = render(<ShareImportPreview preview={{ label: "Photo", willBuildPage: true, bodyLines: ["text read off it"] }} photo="/api/v1/share/stage/s1/file?k=k1" />);
    const img = getByTestId("preview-photo");
    expect(img.getAttribute("src")).toBe("/api/v1/share/stage/s1/file?k=k1");
    expect(img.style.width).toBe("100%");
  });
  it("shows no photo for a share that is not one", () => {
    const { queryByTestId } = render(<ShareImportPreview preview={{ label: "A link", willBuildPage: false, kind: "link" }} />);
    expect(queryByTestId("preview-photo")).toBeNull();
  });
});
