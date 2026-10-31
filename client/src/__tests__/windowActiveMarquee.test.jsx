// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { useWindowActive } from "../helpers/windowActive";

afterEach(() => vi.restoreAllMocks());

describe("useWindowActive", () => {
  it("is false when the window loses focus and true when it comes back", () => {
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderHook(() => useWindowActive());
    expect(result.current).toBe(true);
    focus.mockReturnValue(false);
    act(() => { window.dispatchEvent(new Event("blur")); });
    expect(result.current).toBe(false);
    focus.mockReturnValue(true);
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(result.current).toBe(true);
  });
});

describe("the notification marquee", () => {
  it("pauses (not removes) its animation when nobody is looking", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "../ui/TransactionNotificationStack.jsx"), "utf8");
    expect(src).toMatch(/animationPlayState: windowActive \? "running" : "paused"/);
    expect(src).toMatch(/tx-marquee \$\{durationSec\}s linear infinite/); // control: it still animates when active
  });
});
