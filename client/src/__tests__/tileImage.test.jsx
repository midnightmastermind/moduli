// @vitest-environment jsdom
// A tile showed a 500px poster at ~180px, and every tile a scroll passed asked for one: the ones you stopped on queued behind them.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import fs from "node:fs";
import { render, act, cleanup } from "@testing-library/react";
import { tileImageSrc } from "../helpers/tileImage";
import DeferredTile, { lightTilePicture, LIGHT_PICTURE_DELAY_MS } from "../ui/DeferredTile";
import { rememberDecoded } from "../ui/LoadingImage";
import { noteScroll, _resetTileScheduler } from "../helpers/tileScheduler";

describe("tileImageSrc", () => {
  it("asks TMDB for the tile's size", () => {
    expect(tileImageSrc("https://image.tmdb.org/t/p/w500/a.jpg")).toBe("https://image.tmdb.org/t/p/w342/a.jpg");
    expect(tileImageSrc("https://image.tmdb.org/t/p/original/a.jpg")).toBe("https://image.tmdb.org/t/p/w342/a.jpg");
  });
  it("leaves a picture that is already small", () => {
    expect(tileImageSrc("https://image.tmdb.org/t/p/w185/a.jpg")).toBe("https://image.tmdb.org/t/p/w185/a.jpg");
  });
  it("leaves every other address and an empty one alone", () => {
    expect(tileImageSrc("/uploads/a.jpg")).toBe("/uploads/a.jpg");
    expect(tileImageSrc("https://example.com/t/p/w500/a.jpg")).toBe("https://example.com/t/p/w500/a.jpg");
    expect(tileImageSrc(null)).toBeNull();
  });
});

describe("the light tile and the real tile ask for the same picture", () => {
  it("a light tile's cover is the tile size", () => {
    expect(lightTilePicture({ meta: { cover: "https://image.tmdb.org/t/p/w500/a.jpg" } }, {})).toBe("https://image.tmdb.org/t/p/w342/a.jpg");
  });
  it("the card and the row use it, the viewer keeps the full picture", () => {
    const card = fs.readFileSync(`${process.cwd()}/src/modules/ArtifactCard.jsx`, "utf8");
    expect(card).toMatch(/renderThumbnail\(kind, src, label, thumb256Src, tileImageSrc\(coverSrc\)/);
    expect(card).toMatch(/const tilePicture = kind === "image" && src \? src : \(coverAppliesTo\(kind, coverSrc\) \? coverSrc : null\)/);
    expect(fs.readFileSync(`${process.cwd()}/src/modules/ModuleInstance.jsx`, "utf8")).toMatch(/tileImageSrc\(mediaSrc\)/);
  });
});

describe("a light tile's picture", () => {
  const occ = (cover) => ({ id: "o", label: "Dune", meta: { cover } });
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] }); vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", () => {}); _resetTileScheduler(); noteScroll(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const tile = (cover) => render(<DeferredTile occurrence={occ(cover)} module={{ id: "m" }} height={200}><div>real</div></DeferredTile>);
  it("is not requested by a tile the scroll is only passing", () => {
    const { container, unmount } = tile("/far.jpg");
    expect(container.querySelector("img")).toBeNull();
    act(() => { vi.advanceTimersByTime(LIGHT_PICTURE_DELAY_MS - 10); });
    expect(container.querySelector("img")).toBeNull();
    unmount();
  });
  it("is requested once the tile has stayed", () => {
    const { container } = tile("/stay.jpg");
    act(() => { vi.advanceTimersByTime(LIGHT_PICTURE_DELAY_MS + 1); });
    expect(container.querySelector("img").getAttribute("src")).toBe("/stay.jpg");
  });
  it("one already decoded shows at once", () => {
    rememberDecoded("/seen2.jpg");
    const { container } = tile("/seen2.jpg");
    expect(container.querySelector("img").getAttribute("src")).toBe("/seen2.jpg");
  });
});
