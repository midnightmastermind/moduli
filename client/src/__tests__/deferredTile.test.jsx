// @vitest-environment jsdom
// Scrolling a long board mounted ~15 heavy tiles at once, so the page could not paint for ~500ms and the view went black
// (measured on Movies, 2026-11-05). A tile that enters during a scroll draws its picture and name, and becomes the real row
// when the scroll settles, a few per frame.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, act, cleanup } from "@testing-library/react";
import DeferredTile, { lightTilePicture } from "../ui/DeferredTile";
import fs from "node:fs";
import { noteScroll, isScrollingNow, _resetTileScheduler, SCROLL_IDLE_MS, TILE_MAX_WAIT_MS, wantTileNow, WANT_TILE_MS } from "../helpers/tileScheduler";

let rafs;
const frame = () => act(() => { const q = rafs; rafs = []; q.forEach((f) => f(performance.now())); });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  rafs = []; vi.stubGlobal("requestAnimationFrame", (f) => { rafs.push(f); return rafs.length; }); vi.stubGlobal("cancelAnimationFrame", () => {});
  _resetTileScheduler();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const occ = { id: "o1", label: "Dune", meta: { cover: "/c.jpg" } };
const Tile = ({ id = "o1" }) => <DeferredTile occurrence={{ ...occ, id }} module={{ id: "m", role: "artifact" }} height={300}><div>{`real ${id}`}</div></DeferredTile>;

describe("DeferredTile", () => {
  it("not scrolling: the real row at once (a page opening, a test, a drop)", () => {
    render(<Tile />);
    expect(screen.getByText("real o1")).toBeTruthy();
  });
  it("during a scroll: a light tile holding the picture, the name, its box and the row's id", () => {
    noteScroll();
    const { container } = render(<Tile />);
    expect(screen.queryByText("real o1")).toBeNull();
    const el = container.querySelector(".instance-wrap--light");
    expect(el.getAttribute("data-occurrence-id")).toBe("o1");
    expect(el.style.minHeight).toBe("300px");
    act(() => { vi.advanceTimersByTime(200); });
    expect(container.querySelector("img").getAttribute("src")).toBe("/c.jpg");
    expect(el.textContent).toContain("Dune");
  });
  it("becomes the real row once the scroll settles, not while it is moving", () => {
    noteScroll();
    render(<Tile />);
    frame();
    expect(screen.queryByText("real o1")).toBeNull();
    act(() => { vi.advanceTimersByTime(SCROLL_IDLE_MS + 10); });
    frame();
    expect(screen.getByText("real o1")).toBeTruthy();
  });
  it("unmounting before its turn runs nothing", () => {
    noteScroll();
    const { unmount } = render(<Tile />);
    unmount();
    act(() => { vi.advanceTimersByTime(SCROLL_IDLE_MS + 10); });
    expect(() => frame()).not.toThrow();
  });
  it("many tiles spread over frames, so settling is not one long freeze", () => {
    noteScroll();
    render(<>{[1, 2, 3, 4, 5, 6].map((n) => <Tile key={n} id={`t${n}`} />)}</>);
    act(() => { vi.advanceTimersByTime(SCROLL_IDLE_MS + 10); });
    let t = performance.now();
    const realNow = performance.now.bind(performance);
    vi.spyOn(performance, "now").mockImplementation(() => { t += 6; return t; }); // each read costs 6ms: the budget runs out
    frame();
    performance.now.mockRestore?.(); void realNow;
    const first = screen.queryAllByText(/^real t/).length;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(6);
    for (let i = 0; i < 8; i++) frame();
    expect(screen.queryAllByText(/^real t/).length).toBe(6);
  });
});

describe("a scroll that never stops", () => {
  it("still gets its tiles built, a few per frame", () => {
    noteScroll();
    render(<Tile id="slow" />);
    frame();
    expect(screen.queryByText("real slow")).toBeNull();
    act(() => { vi.advanceTimersByTime(TILE_MAX_WAIT_MS + 1); noteScroll(); });
    frame();
    expect(screen.getByText("real slow")).toBeTruthy();
  });
});

describe("only a grid's tiles go light", () => {
  // On a stacked board a light row is another height, the virtualizer corrects the scroll for it, the correction reads as
  // more scrolling, and it never settles. Measured on People: the scroll ran to 208,300px and no row became real.
  it("the board checks for a grid", () => {
    expect(fs.readFileSync(`${process.cwd()}/src/modules/ModuleContainer.jsx`, "utf8")).toMatch(/virtualRows\.active && virtualRows\.isGrid && instance && role !== "container"/);
  });
});

describe("a tile a search is jumping to", () => {
  it("one on screen becomes real at once, even mid-scroll", () => {
    noteScroll();
    render(<Tile id="target" />);
    expect(screen.queryByText("real target")).toBeNull();
    act(() => { wantTileNow("target"); });
    expect(screen.getByText("real target")).toBeTruthy();
  });
  it("one that has not mounted yet is real from its first render", () => {
    wantTileNow("later");
    noteScroll();
    render(<Tile id="later" />);
    expect(screen.getByText("real later")).toBeTruthy();
  });
  it("the wish expires, so later scrolls light that row again", () => {
    wantTileNow("old");
    vi.advanceTimersByTime(WANT_TILE_MS + 1);
    noteScroll();
    render(<Tile id="old" />);
    expect(screen.queryByText("real old")).toBeNull();
  });
  it("other tiles stay light", () => {
    noteScroll();
    render(<Tile id="other" />);
    act(() => { wantTileNow("target"); });
    expect(screen.queryByText("real other")).toBeNull();
  });
});

describe("the jump asks", () => {
  it("jumpToOccurrence wants the row real", () => {
    expect(fs.readFileSync(`${process.cwd()}/src/helpers/jumpToOccurrence.js`, "utf8")).toMatch(/wantTileNow\(/);
  });
});

describe("scroll state", () => {
  it("is over after the idle time", () => {
    noteScroll();
    expect(isScrollingNow()).toBe(true);
    vi.advanceTimersByTime(SCROLL_IDLE_MS + 1);
    expect(isScrollingNow()).toBe(false);
  });
});

describe("lightTilePicture", () => {
  // Movies keep their poster in a media field that points at an image artifact (the screenshot that found this: titles, no posters).
  it("a row's poster held in its media field", () => {
    const occ = { id: "o", moduleId: "m", fields: { pf: { value: ["a"] } } };
    const maps = {
      modulesById: { m: { id: "m", role: "artifact", kind: "movie", fieldBindings: [{ fieldId: "pf", role: "media" }] }, am: { id: "am", role: "artifact", kind: "image", fileRef: "p.jpg" } },
      occurrencesById: { a: { id: "a", moduleId: "am" } },
    };
    expect(lightTilePicture(occ, maps.modulesById.m, maps)).toBe("/uploads/p.jpg");
  });
  it("a cover on the shared module, for a kind that shows covers", () => {
    expect(lightTilePicture({ meta: {} }, { kind: "bookmark", meta: { cover: "/c.jpg" } })).toBe("/c.jpg");
    expect(lightTilePicture({ meta: {} }, { kind: "video", meta: { cover: "/c.jpg" }, fileRef: "v.mp4" })).toBeNull();
  });
  it("a placement's cover first, then a small thumbnail, then the file", () => {
    expect(lightTilePicture({ meta: { cover: "/a.jpg" } }, { meta: { thumb256: "t.jpg" }, fileRef: "f.jpg" })).toBe("/a.jpg");
    expect(lightTilePicture({ meta: {} }, { kind: "image", meta: { thumb256: "t.jpg" }, fileRef: "f.jpg" })).toBe("/uploads/t.jpg");
    expect(lightTilePicture({ meta: {} }, { kind: "image", fileRef: "f.jpg" })).toBe("/uploads/f.jpg");
  });
  it("a file that is not a picture has none", () => {
    expect(lightTilePicture({ meta: {} }, { kind: "pdf", fileRef: "f.pdf" })).toBeNull();
    expect(lightTilePicture({}, null)).toBeNull();
  });
});
