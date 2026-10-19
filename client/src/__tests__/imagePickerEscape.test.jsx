/**
 * imagePickerEscape.test.jsx — the image picker had no key handler, so Escape
 * left it open (UI sweep 2026-10-19). It closes now, and only while open.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import ImagePickerMenu from "../ui/ImagePickerMenu.jsx";

describe("ImagePickerMenu Escape", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<ImagePickerMenu open onClose={onClose} onPick={() => {}} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys, and listens to nothing while closed", () => {
    const onClose = vi.fn();
    const { rerender } = render(<ImagePickerMenu open onClose={onClose} onPick={() => {}} />);
    fireEvent.keyDown(document, { key: "Enter" });
    rerender(<ImagePickerMenu open={false} onClose={onClose} onPick={() => {}} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
