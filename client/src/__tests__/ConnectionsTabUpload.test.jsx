// Connections tab upload: the file is filed by the SERVER in Files/<kind>
// (no parentFolderId — the tab used to send the first manifest's root, which
// could be the Templates manifest or another grid's), and the tab says where
// each file landed and on which storage.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../helpers/authStorage", () => ({ sessionHeaders: () => ({ Authorization: "Bearer S" }) }));
vi.mock("../ui/commandCenter/StorageConnections", () => ({ StorageConnections: () => null }));
vi.mock("../GridActionsContext", () => ({ useGridActions: () => ({
  state: { userId: "u1", gridId: "g1" },
  manifestsById: { tpl: { id: "tpl", rootFolderId: "TPL-ROOT" } },
  foldersById: { root: { id: "root", name: "Root", parentId: null }, files: { id: "files", name: "Files", parentId: "root" }, img: { id: "img", name: "Images", parentId: "files" } },
}) }));
import { ConnectionsTab } from "../ui/commandCenter/ConnectionsTab";

describe("ConnectionsTab upload", () => {
  it("sends no folder, and reports the Files path and the storage it landed on", async () => {
    let sent;
    globalThis.fetch = vi.fn(async (url, init) => {
      sent = init.body;
      return { ok: true, status: 200, json: async () => ({ module: { id: "m" }, occurrence: { parentId: "img" }, fileRef: "gdrive:c1:F9" }) };
    });
    const { container } = render(<ConnectionsTab />);
    const input = container.querySelector("input[type=file]");
    fireEvent.change(input, { target: { files: [new File(["x"], "cat.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByText(/cat\.png → Files › Images · Google Drive/)).toBeTruthy());
    expect(sent.get("parentFolderId")).toBeNull();
    expect(sent.get("gridId")).toBe("g1");
  });
});
