// UI sweep 2026-10-19 (item 43): the @ picker focused its own search box, which blurred the editor —
// whose blur closes the picker 200ms later — so "@" never stayed open. It keeps the caret in the
// document now and reads its keys on window, like the "/" palette.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {};
vi.mock("../GridActionsContext", () => ({ useGridActions: () => ({ modulesById: {} }) }));
import FieldSuggestion from "../docs/suggestions/FieldSuggestion";
import { popupOwnsKey } from "../helpers/editorPopupLift";

const fields = [{ id: "f1", name: "Calories", type: "number" }, { id: "f2", name: "Protein", type: "number" }];

describe("FieldSuggestion keeps the caret in the editor", () => {
  it("does not take focus when it opens", () => {
    const ed = document.createElement("div"); ed.tabIndex = 0; document.body.appendChild(ed); ed.focus();
    render(<FieldSuggestion fields={fields} />);
    expect(document.activeElement).toBe(ed);
    ed.remove();
  });

  it("a press inside it does not blur the editor", () => {
    const { container } = render(<FieldSuggestion fields={fields} />);
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    container.querySelector(".field-suggestion").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("picks with the keyboard while focus is elsewhere", () => {
    const onSelect = vi.fn();
    render(<FieldSuggestion fields={fields} query="prot" onSelect={onSelect} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "f2" }));
  });
});

describe("popupOwnsKey", () => {
  it("claims the list keys and leaves the rest to the document", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Enter", "Tab"]) expect(popupOwnsKey({ key })).toBe(true);
    for (const key of ["a", "Backspace", "Escape", "ArrowLeft"]) expect(popupOwnsKey({ key })).toBe(false);
    expect(popupOwnsKey({ key: "Enter", ctrlKey: true })).toBe(false);
  });
});
