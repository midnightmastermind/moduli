// Play opens the FILE VIEWER (the artifact spread) for the instance, with a player tile first —
// not a second full-screen overlay (user, 2026-11-02: "it should be in the file viewer").
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, screen, fireEvent } from "@testing-library/react";

vi.mock("../modules/ModuleContainer", () => ({
  default: () => React.createElement("div", { "data-testid": "container" }),
}));
vi.mock("../ui/ImagePickerMenu", () => ({ openImagePicker: vi.fn() }));
vi.mock("../ui/JellyfinPlayer.jsx", () => ({
  default: ({ occurrenceId, onClose }) => React.createElement("div", { "data-testid": "jf-player", "data-occ": occurrenceId },
    React.createElement("button", { type: "button", "aria-label": "Close player", onClick: onClose })),
}));
const { commits } = vi.hoisted(() => ({
  commits: {
    createModule: vi.fn(), createOccurrence: vi.fn(), updateOccurrence: vi.fn(), updateModule: vi.fn(),
    addImageArtifactFromUrl: vi.fn(), addBookmarkOccurrence: vi.fn(() => ({})),
  },
}));
vi.mock("../helpers/occurrenceMedia", () => ({ filesOf: () => [{ occ: { id: "poster-1" } }] }));
vi.mock("../helpers/CommitHelpers", () => commits);
let STATE = {};
vi.mock("../GridActionsContext", () => ({
  useGridActionsSelector: (sel) => sel(STATE),
  useGridActionsSelectorShallow: (sel) => sel(STATE),
}));

import { ArtifactSpreadHost, openArtifactSpread } from "../ui/ArtifactSpreadHost";
import { openJellyfinPlayer } from "../helpers/jellyfinPlay";

const MOVIE = { id: "occ-movie", moduleId: "mod-movie", label: "John Wick", meta: { jellyfinId: "jf1", spreadPageId: "occ-page" } };
const PAGE = { id: "occ-page", moduleId: "mod-page", occurrences: ["poster-1"], meta: { spreadFor: "occ-movie", layoutCascade: { mode: "wrap" } } };

beforeEach(() => {
  Object.values(commits).forEach((fn) => fn.mockClear());
  STATE = {
    dispatch: vi.fn(), socket: {}, gridId: "grid-1", userId: "u",
    occurrencesById: { [MOVIE.id]: MOVIE, [PAGE.id]: PAGE, unlinked: { id: "unlinked", moduleId: "mod-movie", meta: {} } },
    modulesById: { "mod-movie": { id: "mod-movie", label: "Movie" }, "mod-page": { id: "mod-page", kind: "board", role: "container" } },
    fieldsById: {},
  };
  localStorage.clear();
});
afterEach(() => cleanup());

const viewers = () => document.querySelectorAll('[role="dialog"][aria-label^="Files"]');

describe("Play opens the player inside the file viewer", () => {
  it("Play on a linked instance opens the viewer with the player tile FIRST, beside the files", async () => {
    render(<ArtifactSpreadHost />);
    let ok;
    act(() => { ok = openJellyfinPlayer({ occurrence: MOVIE, label: "John Wick" }); });
    expect(ok).toBe(true);
    expect(viewers().length).toBe(1);
    const body = document.querySelector(".artifact-spread-body");
    expect(body.firstElementChild.classList.contains("spread-player-tile")).toBe(true);
    expect(screen.getByTestId("container")).toBeTruthy();
    const player = await screen.findByTestId("jf-player");
    expect(player.getAttribute("data-occ")).toBe("occ-movie");
  });

  it("Play while that instance's viewer is open adds the tile there — one viewer", async () => {
    render(<ArtifactSpreadHost />);
    act(() => { openArtifactSpread("occ-movie"); });
    expect(viewers().length).toBe(1);
    expect(document.querySelector(".spread-player-tile")).toBeNull();
    act(() => { openJellyfinPlayer({ occurrence: MOVIE, label: "John Wick" }); });
    expect(viewers().length).toBe(1);
    expect(await screen.findByTestId("jf-player")).toBeTruthy();
  });

  it("an unlinked instance has no Play: nothing opens", () => {
    render(<ArtifactSpreadHost />);
    let ok;
    act(() => { ok = openJellyfinPlayer({ occurrence: STATE.occurrencesById.unlinked }); });
    expect(ok).toBe(false);
    expect(viewers().length).toBe(0);
  });

  it("the player tile has a maximize control and closing it keeps the viewer", async () => {
    render(<ArtifactSpreadHost />);
    act(() => { openJellyfinPlayer({ occurrence: MOVIE, label: "John Wick" }); });
    const tile = document.querySelector(".spread-player-tile");
    expect(tile.querySelector(".spread-tile-maximize")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Close player" }));
    expect(document.querySelector(".spread-player-tile")).toBeNull();
    expect(viewers().length).toBe(1);
  });

  it("the player is not restored with the viewer after a reload", () => {
    render(<ArtifactSpreadHost />);
    act(() => { openJellyfinPlayer({ occurrence: MOVIE, label: "John Wick" }); });
    const saved = JSON.stringify(localStorage);
    expect(saved).not.toMatch(/jellyfin|player/i);
  });

  it("the overlay host is gone — the viewer is the only way to play (wiring)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const p = (rel) => path.resolve(process.cwd(), "src", rel);
    expect(fs.existsSync(p("ui/JellyfinPlayerHost.jsx"))).toBe(false);
    expect(fs.readFileSync(p("App.jsx"), "utf8")).not.toMatch(/JellyfinPlayerHost/);
    expect(fs.readFileSync(p("ui/ArtifactSpreadHost.jsx"), "utf8")).toMatch(/registerJellyfinPlayerHost\(/);
  });
});
