// Tests for EditorBindingSection — the picker UI for editor↔field bindings.
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import EditorBindingSection from "../ui/EditorBindingSection.jsx";

const fields = [
  { id: "f1", name: "Question", type: "select" },
  { id: "f2", name: "Date", type: "date" },
  { id: "f3", name: "Answer", type: "text" },
];

describe("EditorBindingSection", () => {
  let onChange;
  beforeEach(() => {
    onChange = vi.fn();
  });

  it("renders 'No binding' when binding is null", () => {
    render(
      <EditorBindingSection slot="header" binding={null} onChange={onChange} fields={fields} />
    );
    expect(screen.getByText(/No binding/i)).toBeTruthy();
  });

  it("renders the current selfField/link selections when binding is set", () => {
    render(
      <EditorBindingSection
        slot="header"
        binding={{ selfField: "f1", link: "f2" }}
        onChange={onChange}
        fields={fields}
      />
    );
    expect(screen.getByLabelText(/Self field/i).value).toBe("f1");
    expect(screen.getByLabelText(/Link field/i).value).toBe("f2");
  });

  it("calls onChange with new binding when both selects are populated", () => {
    render(
      <EditorBindingSection slot="header" binding={null} onChange={onChange} fields={fields} />
    );
    fireEvent.change(screen.getByLabelText(/Self field/i), { target: { value: "f1" } });
    // Picking only selfField — not enough yet
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ selfField: "f1", link: expect.anything() }));
    fireEvent.change(screen.getByLabelText(/Link field/i), { target: { value: "f2" } });
    expect(onChange).toHaveBeenLastCalledWith({ selfField: "f1", link: "f2" });
  });

  it("calls onChange(null) when the Clear button is clicked", () => {
    render(
      <EditorBindingSection
        slot="header"
        binding={{ selfField: "f1", link: "f2" }}
        onChange={onChange}
        fields={fields}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("renders scope toggle when onScopeChange is provided", () => {
    render(
      <EditorBindingSection
        slot="header"
        binding={null}
        onChange={onChange}
        fields={fields}
        scope="module"
        onScopeChange={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /this template/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /this placement/i })).toBeTruthy();
  });

  it("calls onScopeChange when scope is toggled", () => {
    const onScopeChange = vi.fn();
    render(
      <EditorBindingSection
        slot="header"
        binding={null}
        onChange={onChange}
        fields={fields}
        scope="module"
        onScopeChange={onScopeChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /this placement/i }));
    expect(onScopeChange).toHaveBeenCalledWith("occurrence");
  });

  it("does NOT render scope toggle when onScopeChange is absent", () => {
    render(
      <EditorBindingSection slot="header" binding={null} onChange={onChange} fields={fields} />
    );
    expect(screen.queryByRole("button", { name: /this template/i })).toBeNull();
  });
});
