// @vitest-environment jsdom
// A poster already decoded does not fade in again when its tile is rebuilt: that was a flash per tile while scrolling.
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import LoadingImage, { rememberDecoded } from "../ui/LoadingImage";

describe("LoadingImage and a picture it has already decoded", () => {
  it("shows at once, with no spinner and no fade", () => {
    rememberDecoded("/seen.jpg");
    const { container } = render(<LoadingImage src="/seen.jpg" alt="" />);
    const img = container.querySelector("img");
    expect(img.style.opacity).toBe("1");
    expect(img.style.transition).toBe("none");
    expect(container.querySelector(".img-load-status")).toBeNull();
  });
  it("a new picture still waits for its decode", () => {
    const { container } = render(<LoadingImage src="/new.jpg" alt="" />);
    expect(container.querySelector("img").style.opacity).toBe("0");
    expect(container.querySelector(".img-load-status")).not.toBeNull();
  });
});
