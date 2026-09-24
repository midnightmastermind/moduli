// The Imports tab (share → import routing, Tasks 8–9), mounted with the grid
// store and the pipeline editor stubbed — the tab's own job is listing rules
// in run order, creating/saving them as onShare OPERATIONS, and showing the
// recent-shares log. The editor it reuses is tested where it lives.
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const created = [], updated = [], deleted = [];
vi.mock("../helpers/CommitHelpers", () => ({
  createOperation: ({ operation }) => created.push(operation),
  updateOperation: ({ operation }) => updated.push(operation),
  deleteOperation: ({ operationId }) => deleted.push(operationId),
}));
vi.mock("../blocks", () => ({
  PipelineEditor: ({ pipeline }) => <div data-testid="pipeline-editor">{(pipeline?.steps || []).length} steps</div>,
}));

let STATE;
vi.mock("../GridActionsContext", () => ({
  useGridActions: () => ({
    state: STATE, socket: null, dispatch: () => {},
    operationsById: {}, fieldsById: {}, foldersById: STATE.foldersById,
    occurrencesById: STATE.occurrencesById, modulesById: {},
  }),
}));

const { ImportsTab } = await import("../ui/commandCenter/ImportsTab");

const rule = (id, name, shareType, priority, extra = {}) => ({
  id, name, gridId: "g1", priority, enabled: true,
  triggerObjects: [{ eventType: "onShare", shareType }], pipeline: { steps: [] }, ...extra,
});

beforeEach(() => {
  created.length = 0; updated.length = 0; deleted.length = 0;
  STATE = {
    gridId: "g1",
    operations: [
      rule("c", "Share: anything else", "*", 99),
      rule("l", "Share: links", "link", 10),
      { id: "x", name: "Unrelated op", gridId: "g1", triggerObjects: [{ eventType: "onLoad" }] },
    ],
    fields: [],
    grid: { shareLog: [
      { at: "2026-09-24T12:00:00Z", type: "link", source: "extension", label: "Older", status: "landed",
        rules: [{ ruleId: "c", ruleName: "Share: anything else", ok: true, created: [{ occurrenceId: "o1", status: "created" }] }] },
      { at: "2026-09-24T13:00:00Z", type: null, source: "api", label: "Newer", status: "failed",
        error: "this grid has no Files folder", rules: [] },
    ]},
    occurrencesById: { o1: { id: "o1", label: "About Alan Watts", parentId: "files" } },
    foldersById: { files: { id: "files", name: "Files" } },
  };
});

describe("ImportsTab — rules", () => {
  it("lists only share rules, in run order (typed first, catch-all last)", () => {
    render(<ImportsTab />);
    const names = screen.getAllByRole("button").map(b => b.textContent);
    const links = names.findIndex(n => n.includes("Share: links"));
    const catchAll = names.findIndex(n => n.includes("Share: anything else"));
    expect(links).toBeGreaterThan(-1);
    expect(catchAll).toBeGreaterThan(links);
    expect(names.some(n => n.includes("Unrelated op"))).toBe(false);
  });

  it("adds a rule as an onShare OPERATION, and does not offer a type already taken (D8)", () => {
    render(<ImportsTab />);
    fireEvent.click(screen.getByText(/Rule for a type/));
    expect(screen.queryByRole("button", { name: "Link" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Calendar (.ics)" }));
    expect(created).toHaveLength(1);
    expect(created[0].triggerObjects).toEqual([{ eventType: "onShare", shareType: "ics" }]);
    expect(created[0].pipeline.steps).toEqual([]);
  });

  it("the halt checkbox adds the $share.handled step, and Save marks the rule the user's", () => {
    render(<ImportsTab />);
    fireEvent.click(screen.getByText("Share: links"));
    fireEvent.click(screen.getByLabelText(/stop here/));
    fireEvent.click(screen.getByText(/Save/));
    expect(updated).toHaveLength(1);
    expect(updated[0].pipeline.steps.at(-1).config).toEqual({ type: "SET_VAR", name: "$share.handled", value: "true" });
    expect(updated[0].meta.userEdited).toBe(true);
  });

  it("the catch-all cannot be deleted from here (D3) — only turned off", () => {
    render(<ImportsTab />);
    fireEvent.click(screen.getByText("Share: anything else"));
    expect(screen.queryByText(/Delete/)).toBeNull();
    expect(screen.getByText(/always kept/)).toBeTruthy();
  });
});

describe("ImportsTab — recent shares", () => {
  it("shows newest first, says where a row landed, and shows a failure's reason", () => {
    render(<ImportsTab />);
    fireEvent.click(screen.getByText(/Recent shares/));
    const text = screen.getByTestId("imports-tab").textContent;
    expect(text.indexOf("Newer")).toBeLessThan(text.indexOf("Older"));
    expect(text).toMatch(/no Files folder/);
    expect(text).toMatch(/created “About Alan Watts” in Files folder/);
  });

  it("offers no re-run — the log keeps no content to re-run (D16)", () => {
    render(<ImportsTab />);
    fireEvent.click(screen.getByText(/Recent shares/));
    expect(screen.queryByText(/re-?run/i)).toBeNull();
  });
});

describe("ImportsTab — source", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../ui/commandCenter/ImportsTab.jsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("reuses the operations editor rather than a second one (D6)", () => {
    expect(src).toMatch(/PipelineEditor/);
  });
  it("does not seed typed rules — bootstrap is catch-all only (D18)", () => {
    expect(src).not.toMatch(/shareType:\s*["'](ics|link|image)["']/);
  });
});

describe("ShareGridPicker (where a share lands when the sender names no grid)", () => {
  it("reads the share grid and saves a new one with the session token", async () => {
    const { ShareGridPicker } = await import("../ui/commandCenter/ImportsTab");
    localStorage.setItem("moduli-token", "sess");
    const fetchImpl = vi.fn(async (url, init) => ({ ok: true, status: 200,
      json: async () => (init?.method === "PATCH" ? JSON.parse(init.body) : { gridId: "g1" }) }));
    render(<ShareGridPicker fetchImpl={fetchImpl} grids={[{ id: "g1", name: "poms grid" }, { _id: "g2", name: "test grid 2" }]} />);
    const select = await screen.findByRole("combobox");
    await waitFor(() => expect(select.value).toBe("g1"));
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer sess");
    fireEvent.change(select, { target: { value: "g2" } });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe("/api/v1/me/share");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ gridId: "g2" });
    localStorage.removeItem("moduli-token");
  });
  it("signed out: renders nothing and fetches nothing", async () => {
    const { ShareGridPicker } = await import("../ui/commandCenter/ImportsTab");
    const fetchImpl = vi.fn();
    const { container } = render(<ShareGridPicker fetchImpl={fetchImpl} grids={[]} />);
    expect(container.innerHTML).toBe("");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
