// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../ui/Field.jsx", () => ({
  default: ({ field, value, onChange, onCommit }) => (
    <input aria-label={`field-${field.id}`} value={value ?? ""} onChange={(e) => { onChange?.(e.target.value); onCommit?.(e.target.value); }} />
  ),
}));

import FormModal from "../ui/FormModal.jsx";

const request = {
  form: true, title: "New movie", submitLabel: "Add",
  items: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "year", label: "Year", type: "number" },
    { key: "rating", label: "Rating", fieldId: "f1", field: { id: "f1", name: "Rating", type: "number" }, default: 4 },
  ],
};

describe("FormModal", () => {
  it("renders one control per item", () => {
    render(<FormModal request={request} onSubmit={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("New movie")).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Year")).toBeTruthy();
    expect(screen.getByLabelText("field-f1").value).toBe("4");
  });

  it("Submit stays off until the required item is filled, and names what is missing", () => {
    const onSubmit = vi.fn();
    render(<FormModal request={request} onSubmit={onSubmit} onCancel={() => {}} />);
    const btn = screen.getByRole("button", { name: "Add" });
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/Needs: Name/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dune" } });
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2021" } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onSubmit).toHaveBeenCalledWith({ name: "Dune", year: 2021, rating: 4 });
  });

  it("Escape cancels", () => {
    const onCancel = vi.fn();
    render(<FormModal request={request} onSubmit={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});
