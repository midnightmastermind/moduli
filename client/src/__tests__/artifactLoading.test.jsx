// A FILE NOT LOADED YET SAYS SO. User 2026-10-17: "we need to have a loading icon for files not
// brought in yet, right now they say no file attached as it loads". Files arrive in the later half
// of the load, so a file page can render before its module exists.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

let MAPS = {};
vi.mock("../GridActionsContext.js", () => ({
  useGridActions: () => MAPS,
  useGridActionsSelector: (sel) => sel(MAPS),
  useGridActionsSelectorShallow: (sel) => sel(MAPS),
}));
import ArtifactContent from "../modules/ArtifactContent.jsx";

const occ = { id: "o1", moduleId: "m1" };
describe("ArtifactContent before its file arrives", () => {
  it("shows a loading state while the module has not arrived", () => {
    MAPS = { modulesById: {}, occurrencesById: {} };
    const { container } = render(<ArtifactContent occurrence={occ} viewType="display" artifactType="audio" />);
    expect(container.querySelector(".artifact-loading")).toBeTruthy();
    expect(container.textContent).not.toMatch(/No file attached/);
  });
  it("shows a loading state while an upload is pending", () => {
    MAPS = { modulesById: { m1: { id: "m1", meta: { uploadStatus: "pending" } } }, occurrencesById: {} };
    const { container } = render(<ArtifactContent occurrence={occ} viewType="display" artifactType="image" />);
    expect(container.querySelector(".artifact-loading")).toBeTruthy();
  });
  it("still says no file when the module is there and has none (control)", () => {
    MAPS = { modulesById: { m1: { id: "m1", meta: {} } }, occurrencesById: {} };
    const { container } = render(<ArtifactContent occurrence={occ} viewType="display" artifactType="audio" />);
    expect(container.textContent).toMatch(/No file attached/);
  });
});
