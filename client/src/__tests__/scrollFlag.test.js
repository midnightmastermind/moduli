// @vitest-environment jsdom
// Scrolling labels stop while anything scrolls: a running label anywhere on the page halved the frame
// rate of every scroll (measured 2026-10-19). The flag goes on the scroller AND the page, and clears
// after the scroll settles.
import { describe, it, expect, vi } from "vitest";
import { installScrollFlag, SETTLE_MS } from "../helpers/scrollFlag.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("scroll flag", () => {
  it("flags the scroller and the page while it scrolls, then clears", () => {
    vi.useFakeTimers();
    const off = installScrollFlag(document);
    const box = document.createElement("div"); document.body.appendChild(box);
    box.dispatchEvent(new Event("scroll"));
    expect(box.hasAttribute("data-scrolling")).toBe(true);
    expect(document.documentElement.hasAttribute("data-scrolling")).toBe(true);
    vi.advanceTimersByTime(SETTLE_MS + 10);
    expect(box.hasAttribute("data-scrolling")).toBe(false);
    expect(document.documentElement.hasAttribute("data-scrolling")).toBe(false);
    off(); vi.useRealTimers();
  });
  it("the CSS stops only the moving labels, keyed on the page flag", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    expect(css).toContain(":root[data-scrolling] .auto-marquee-inner--moving { animation: none !important; }");
    const mq = readFileSync(resolve(process.cwd(), "src/ui/AutoMarquee.jsx"), "utf8");
    expect(mq).toContain('"auto-marquee-inner auto-marquee-inner--moving"');
  });
});
